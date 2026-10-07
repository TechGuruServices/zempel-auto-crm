/**
 * Push Notify v1.0.0
 * Subscribes to push notifications for low-stock alerts and sale notifications.
 * Uses VAPID for authentication (no third-party service needed).
 */
(function () {
  'use strict';

  var API_URL = 'https://parts-command-api.techguruofficial.workers.dev';
  // VAPID public key (generated 2026-10-07)
  var VAPID_PUBLIC = 'BIzV5h_CAhZWPk-vrD54ocPY3LsAbI-w1c2Mf_jCxWVKoi-tOErQnkDIcpPygshrrauw8HU9gH3dYc05Hu1Sg4g';

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function getToken() {
    try { return localStorage.getItem('pc_token') || sessionStorage.getItem('pc_token') || ''; }
    catch (e) { return ''; }
  }

  async function subscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[PushNotify] Push not supported');
      return null;
    }
    var permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[PushNotify] Permission denied');
      return null;
    }
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
    });

    // Send subscription to backend
    var token = getToken();
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    try {
      await fetch(API_URL + '/push/subscribe', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ subscription: sub.toJSON() })
      });
      console.log('[PushNotify] Subscribed');
      localStorage.setItem('pc_push_subscribed', '1');
    } catch (e) {
      console.warn('[PushNotify] Failed to register subscription:', e.message);
    }
    return sub;
  }

  async function unsubscribe() {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    localStorage.removeItem('pc_push_subscribed');
  }

  // Check low stock and trigger local notification
  function checkLowStock() {
    try {
      var db = typeof window.getDB === 'function' ? window.getDB() : null;
      if (!db) return;
      var low = (db.inventory || []).filter(function (i) {
        return (Number(i.stock) || 0) <= (Number(i.minStock) || 0);
      });
      if (low.length > 0 && Notification.permission === 'granted') {
        // Only notify if not notified recently (once per hour)
        var last = localStorage.getItem('pc_lowstock_notified');
        var now = Date.now();
        if (!last || now - Number(last) > 3600000) {
          new Notification('⚠️ Low Stock Alert', {
            body: low.length + ' item(s) below minimum stock',
            icon: '/assets/favicon-cropped1.PNG',
            tag: 'lowstock'
          });
          localStorage.setItem('pc_lowstock_notified', String(now));
        }
      }
    } catch (e) {}
  }

  // Notify on sale completion
  function notifySale(total, itemCount) {
    if (Notification.permission !== 'granted') return;
    try {
      new Notification('✅ Sale Completed', {
        body: '$' + Number(total).toFixed(2) + ' — ' + itemCount + ' item(s)',
        icon: '/assets/favicon-cropped1.PNG',
        tag: 'sale-' + Date.now()
      });
    } catch (e) {}
  }

  // Add toggle to settings
  function addSettingsToggle() {
    var observer = new MutationObserver(function () {
      clearTimeout(window._pcPushT);
      window._pcPushT = setTimeout(function () {
        if (document.getElementById('pc-push-toggle')) return;
        // Find settings notifications section or general settings
        var settingsView = document.querySelector('[data-view="settings"]');
        if (!settingsView) return;

        var toggle = document.createElement('div');
        toggle.id = 'pc-push-toggle';
        toggle.className = 'glass-card rounded-xl p-4 mb-4 flex items-center justify-between';
        var isOn = localStorage.getItem('pc_push_subscribed') === '1';
        toggle.innerHTML =
          '<div><p class="text-sm font-medium text-white">Push Notifications</p>' +
          '<p class="text-xs text-slate-400">Low-stock alerts & sale notifications</p></div>' +
          '<button id="pc-push-btn" class="px-4 py-2 rounded-lg text-sm font-medium ' +
          (isOn ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-300') + '">' +
          (isOn ? '✓ On' : 'Enable') + '</button>';

        settingsView.insertBefore(toggle, settingsView.firstChild);

        document.getElementById('pc-push-btn').onclick = async function () {
          if (localStorage.getItem('pc_push_subscribed') === '1') {
            await unsubscribe();
            this.textContent = 'Enable';
            this.className = 'px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 text-slate-300';
          } else {
            var sub = await subscribe();
            if (sub) {
              this.textContent = '✓ On';
              this.className = 'px-4 py-2 rounded-lg text-sm font-medium bg-green-500/20 text-green-400';
            }
          }
        };
      }, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    addSettingsToggle();
    // Check low stock periodically (every 5 min when app is open)
    setInterval(checkLowStock, 300000);
    setTimeout(checkLowStock, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 2000); });
  } else {
    setTimeout(boot, 2000);
  }

  window.pcPush = { subscribe: subscribe, unsubscribe: unsubscribe, notifySale: notifySale, checkLowStock: checkLowStock };
  console.log('[PushNotify] Initialized');
})();
