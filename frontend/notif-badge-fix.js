/* Notification badge fix — red dot clears after viewing, only returns for new issues */
(function () {
  'use strict';

  var SEEN_KEY = 'pc_notif_seen_ids';

  function getSeenIds() {
    try {
      return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    } catch (e) { return []; }
  }

  function saveSeenIds(ids) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
    } catch (e) {}
  }

  function getUnseenCounts() {
    var db = typeof getDB === 'function' ? getDB() : { inventory: [], sales: [] };
    var seen = getSeenIds();
    var lowStock = (db.inventory || []).filter(function (i) {
      return i.stock <= i.minStock && seen.indexOf('inv:' + i.id) === -1;
    });
    var pendingSales = (db.sales || []).filter(function (s) {
      return s.status === 'Pending' && seen.indexOf('sale:' + s.id) === -1;
    });
    return { lowStock: lowStock, pendingSales: pendingSales };
  }

  function markAllSeen() {
    var db = typeof getDB === 'function' ? getDB() : { inventory: [], sales: [] };
    var ids = [];
    (db.inventory || []).forEach(function (i) {
      if (i.stock <= i.minStock) ids.push('inv:' + i.id);
    });
    (db.sales || []).forEach(function (s) {
      if (s.status === 'Pending') ids.push('sale:' + s.id);
    });
    saveSeenIds(ids);
  }

  // Override the badge updater
  window.updateNotificationBadge = function () {
    var counts = getUnseenCounts();
    var badge = document.getElementById('notifBadge');
    if (badge) {
      if (counts.lowStock.length > 0 || counts.pendingSales.length > 0) {
        badge.classList.remove('hidden');
        // Show count if badge supports it
        var total = counts.lowStock.length + counts.pendingSales.length;
        badge.textContent = total > 9 ? '9+' : total;
      } else {
        badge.classList.add('hidden');
      }
    }
  };

  // Override toggle to mark as seen when opened
  var origToggle = window.toggleNotifications;
  window.toggleNotifications = function () {
    var counts = getUnseenCounts();
    var db = typeof getDB === 'function' ? getDB() : { inventory: [], sales: [] };
    var allLow = (db.inventory || []).filter(function (i) { return i.stock <= i.minStock; });
    var allPending = (db.sales || []).filter(function (s) { return s.status === 'Pending'; });

    var hasNotifs = false;
    if (allLow.length > 0) {
      if (typeof showToast === 'function') showToast(allLow.length + ' item(s) below minimum stock. Check Inventory.', 'warning');
      hasNotifs = true;
    }
    if (allPending.length > 0) {
      setTimeout(function () {
        if (typeof showToast === 'function') showToast(allPending.length + ' estimate(s) waiting for approval.', 'info');
      }, hasNotifs ? 600 : 0);
      hasNotifs = true;
    }
    if (!hasNotifs) {
      if (typeof showToast === 'function') showToast('No new notifications', 'success');
    }

    // Mark everything as seen, then update badge (which will now hide it)
    markAllSeen();
    setTimeout(function () { window.updateNotificationBadge(); }, 100);
  };

  // Run once on load to fix any stuck badge
  setTimeout(function () { window.updateNotificationBadge(); }, 1500);
})();
