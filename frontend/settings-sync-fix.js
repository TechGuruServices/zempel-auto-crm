/**
 * Settings Sync Fix v1.0.0
 * Fixes forceSyncCloud to include settings and auth header.
 * The original function sent raw DB JSON without settings attached
 * and without Authorization, causing settings loss on cache clear.
 */
(function () {
  'use strict';

  function getToken() {
    try { return localStorage.getItem('pc_token') || sessionStorage.getItem('pc_token') || ''; }
    catch (e) { return ''; }
  }

  function getAppSettings() {
    try { return JSON.parse(localStorage.getItem('pc_app_settings')) || {}; }
    catch (e) { return {}; }
  }

  // Override the broken forceSyncCloud
  function waitForOverride() {
    if (typeof window.forceSyncCloud === 'undefined') {
      setTimeout(waitForOverride, 500);
      return;
    }

    window.forceSyncCloud = function () {
      if (typeof window.showToast === 'function') window.showToast('Syncing to cloud...', 'info');

      var db = null;
      try {
        if (typeof window.getDB === 'function') db = window.getDB();
      } catch (e) {}
      if (!db) {
        if (typeof window.showToast === 'function') window.showToast('No data to sync', 'warning');
        return;
      }

      // Attach settings like saveDB does
      db.settings = getAppSettings();

      var token = getToken();
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      var API_URL = 'https://parts-command-api.techguruofficial.workers.dev';

      fetch(API_URL + '/sync', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(db)
      }).then(function (r) {
        if (r.ok) {
          if (typeof window.showToast === 'function') window.showToast('Cloud sync complete', 'success');
          // Update sync status badge
          if (window.pcSyncStatus && typeof window.pcSyncStatus.update === 'function') {
            window.pcSyncStatus.update(true);
          }
        } else if (r.status === 401) {
          if (typeof window.showToast === 'function') window.showToast('Not logged in — sync failed', 'danger');
        } else {
          if (typeof window.showToast === 'function') window.showToast('Sync failed', 'danger');
        }
      }).catch(function () {
        if (typeof window.showToast === 'function') window.showToast('Cloud unreachable - data safe locally', 'warning');
      });
    };

    console.log('[SettingsSyncFix] forceSyncCloud patched');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(waitForOverride, 2000); });
  } else {
    setTimeout(waitForOverride, 2000);
  }
})();
