/**
 * Sync Status Indicator v1.0.0
 * Header badge showing cloud sync state: synced time, pending changes, offline.
 * Self-initializing. Requires no changes to existing code — hooks into fetch().
 */
(function () {
  'use strict';

  var LAST_SYNC_KEY = 'pc_last_sync';
  var PENDING_KEY = 'pc_pending_sync_count';
  var BADGE_ID = 'pc-sync-badge';

  function getLastSync() {
    try { return parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10); } catch (e) { return 0; }
  }
  function setLastSync(t) {
    try { localStorage.setItem(LAST_SYNC_KEY, String(t)); } catch (e) {}
  }
  function getPending() {
    try { return parseInt(localStorage.getItem(PENDING_KEY) || '0', 10); } catch (e) { return 0; }
  }
  function setPending(n) {
    try { localStorage.setItem(PENDING_KEY, String(Math.max(0, n))); } catch (e) {}
  }

  function timeAgo(ts) {
    if (!ts) return 'never';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function render() {
    var badge = document.getElementById(BADGE_ID);
    if (!badge) return;
    var pending = getPending();
    var lastSync = getLastSync();
    var online = navigator.onLine;

    var dot, text, cls;
    if (!online) {
      dot = '#f59e0b'; text = 'Offline' + (pending ? ' · ' + pending + ' pending' : '');
      cls = 'pc-sync-offline';
    } else if (pending > 0) {
      dot = '#f59e0b'; text = pending + ' pending sync';
      cls = 'pc-sync-pending';
    } else {
      dot = '#22c55e'; text = 'Synced ' + timeAgo(lastSync);
      cls = 'pc-sync-ok';
    }
    badge.className = 'pc-sync-badge ' + cls;
    badge.innerHTML = '<span class="pc-sync-dot" style="background:' + dot + '"></span><span>' + text + '</span>';
    badge.title = lastSync ? 'Last synced: ' + new Date(lastSync).toLocaleString() : 'Not synced yet';
  }

  function injectBadge() {
    if (document.getElementById(BADGE_ID)) return;
    var badge = document.createElement('button');
    badge.id = BADGE_ID;
    badge.className = 'pc-sync-badge';
    badge.setAttribute('aria-label', 'Sync status');
    badge.addEventListener('click', function () {
      // Manual sync trigger if available
      if (typeof window.forceSyncCloud === 'function') { window.forceSyncCloud(); }
      else { render(); }
    });
    // Prefer the dedicated header slots (desktop + mobile); fall back to header/body
    var slot = document.getElementById('syncBadgeSlot') || document.getElementById('syncBadgeSlotMobile');
    if (slot) {
      slot.appendChild(badge);
    } else {
      var header = document.querySelector('header');
      if (header) { header.appendChild(badge); }
      else {
        badge.style.cssText += ';position:fixed;top:12px;right:12px;z-index:99999;';
        document.body.appendChild(badge);
      }
    }
    render();
  }

  function injectStyles() {
    if (document.getElementById('pc-sync-styles')) return;
    var s = document.createElement('style');
    s.id = 'pc-sync-styles';
    s.textContent = [
      '.pc-sync-badge{display:inline-flex;align-items:center;gap:6px;',
      'font-size:11px;font-weight:600;padding:5px 10px;border-radius:999px;',
      'border:1px solid rgba(148,163,184,.25);background:rgba(15,23,42,.6);',
      'color:#cbd5e1;cursor:pointer;white-space:nowrap;margin-left:8px;}',
      '.pc-sync-badge:hover{background:rgba(30,41,59,.8);}',
      '.pc-sync-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}',
      '.pc-sync-pending .pc-sync-dot,.pc-sync-offline .pc-sync-dot{animation:pc-pulse 1.6s infinite;}',
      '@keyframes pc-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
      '@media(max-width:640px){.pc-sync-badge{font-size:10px;padding:4px 8px;}}'
    ].join('');
    document.head.appendChild(s);
  }

  // Hook into fetch to track /sync POST outcomes
  var origFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var urlStr = '';
    try { urlStr = typeof url === 'string' ? url : (url && url.url) || ''; } catch (e) {}
    var isSyncPost = urlStr.indexOf('/sync') !== -1 &&
      opts && opts.method && opts.method.toUpperCase() === 'POST';
    if (!isSyncPost) return origFetch(url, opts);
    return origFetch(url, opts).then(function (res) {
      if (res && res.ok) { setLastSync(Date.now()); setPending(0); }
      else { setPending(getPending() + 1); }
      setTimeout(render, 50);
      return res;
    }).catch(function (err) {
      setPending(getPending() + 1);
      setTimeout(render, 50);
      throw err;
    });
  };

  window.addEventListener('online', render);
  window.addEventListener('offline', render);

  // Expose for manual refresh
  window.pcSyncStatus = { render: render, getPending: getPending, getLastSync: getLastSync };

  function boot() {
    injectStyles();
    injectBadge();
    // Re-render periodically so "Xm ago" stays fresh
    setInterval(render, 30000);
    // Re-inject if header re-renders (SPA navigation)
    setInterval(function () {
      if (!document.getElementById(BADGE_ID)) injectBadge();
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
