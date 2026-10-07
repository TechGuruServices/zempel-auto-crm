/**
 * Offline Queue v1.0.0
 * Auto-retries cloud sync when back online. Works with sync-status.js.
 * Since syncs are full-DB POSTs, the "queue" is a dirty flag + retry loop.
 */
(function () {
  'use strict';

  var PENDING_KEY = 'pc_pending_sync_count';
  var RETRY_INTERVAL_MS = 30000;
  var retryTimer = null;

  function getPending() {
    try { return parseInt(localStorage.getItem(PENDING_KEY) || '0', 10); } catch (e) { return 0; }
  }

  function trySync() {
    if (!navigator.onLine) return;
    if (getPending() <= 0) return;
    if (typeof window.forceSyncCloud === 'function') {
      console.log('[OfflineQueue] Retrying cloud sync (' + getPending() + ' pending)');
      window.forceSyncCloud();
    }
  }

  function startRetryLoop() {
    if (retryTimer) return;
    retryTimer = setInterval(trySync, RETRY_INTERVAL_MS);
  }

  // Sync immediately when coming back online
  window.addEventListener('online', function () {
    console.log('[OfflineQueue] Back online — attempting sync');
    setTimeout(trySync, 2000); // small delay for network to stabilize
  });

  // Also try on page visibility regain (user returns to tab)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) trySync();
  });

  // Expose manual trigger
  window.pcOfflineQueue = { trySync: trySync };

  startRetryLoop();
  console.log('[OfflineQueue] Initialized');
})();
