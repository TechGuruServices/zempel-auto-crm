/**
 * SW Cache Update Utility v3.1.0 — Zempel Auto Parts CRM
 * Coordinates cache invalidation between main thread and service worker.
 * Used by rockauto-fetch.js to bust stale KV-cached proxy responses.
 */
const SWCacheUpdate = (() => {
  'use strict';

  // NOTE: intentionally NOT hardcoding the cache name here. A hardcoded
  // version string in this file had drifted out of sync with the real
  // CACHE_NAME in sw.js before, which silently made every purge* call
  // below a no-op (it opened/created an empty cache instead of the real
  // one). Instead, look up whatever cache the active service worker is
  // actually using at call time.
  const CACHE_PREFIX = 'partscommand-';
  const ROCKAUTO_PATH_PREFIX = '/v1/rockauto/';

  async function _getActiveCacheNames() {
    if (!('caches' in window)) return [];
    const names = await caches.keys();
    return names.filter(n => n.startsWith(CACHE_PREFIX));
  }

  /**
   * Purge all cached RockAuto proxy responses from the SW cache.
   * Call after a known data change or stale-data detection.
   * @returns {Promise<number>} Number of entries purged.
   */
  async function purgeRockAutoCache() {
    if (!('caches' in window)) return 0;
    try {
      let purged = 0;
      for (const cacheName of await _getActiveCacheNames()) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const req of keys) {
          const url = new URL(req.url);
          if (url.pathname.startsWith(ROCKAUTO_PATH_PREFIX)) {
            await cache.delete(req);
            purged++;
          }
        }
      }
      return purged;
    } catch {
      return 0;
    }
  }

  /**
   * Purge a single cached response by path.
   * @param {string} path - e.g., '/v1/rockauto/makes'
   * @returns {Promise<boolean>}
   */
  async function purgeEntry(path) {
    if (!('caches' in window)) return false;
    try {
      for (const cacheName of await _getActiveCacheNames()) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        for (const req of keys) {
          if (new URL(req.url).pathname === path) {
            await cache.delete(req);
            return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Request the service worker to skip waiting and activate immediately.
   * Useful after a new SW version is detected.
   */
  function forceActivate() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  }

  /**
   * Register a listener for SW-triggered sync events.
   * @param {function} callback - Called when SW requests a sync.
   */
  function onSyncRequest(callback) {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SYNC_REQUESTED') {
        callback(event.data);
      }
    });
  }

  /**
   * Check if a newer service worker is available and trigger update.
   * @returns {Promise<boolean>} True if update found and installing.
   */
  async function checkForUpdate() {
    if (!('serviceWorker' in navigator)) return false;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return false;
      await reg.update();
      return !!reg.installing;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    purgeRockAutoCache,
    purgeEntry,
    forceActivate,
    onSyncRequest,
    checkForUpdate,
  });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SWCacheUpdate;
