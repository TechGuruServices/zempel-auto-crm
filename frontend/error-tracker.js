/**
 * Error Tracker v1.0.0
 * Self-hosted error logging. Captures JS errors and unhandled rejections,
 * stores last 50 in localStorage, viewable via pcErrorLog.getAll().
 */
(function () {
  'use strict';

  var KEY = 'pc_error_log';
  var MAX = 50;

  function getAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (e) { return []; }
  }

  function save(log) {
    try { localStorage.setItem(KEY, JSON.stringify(log.slice(0, MAX))); }
    catch (e) {}
  }

  function capture(type, message, source, lineno, stack) {
    var entry = {
      t: new Date().toISOString(),
      type: type,
      message: String(message || '').slice(0, 500),
      source: String(source || '').slice(0, 200),
      lineno: lineno || 0,
      stack: String(stack || '').slice(0, 1000)
    };
    var log = getAll();
    log.unshift(entry);
    save(log);
    // Update badge if visible
    if (window.pcErrorBadge) window.pcErrorBadge();
  }

  window.addEventListener('error', function (e) {
    // Ignore script-load errors from extensions
    if (e.filename && e.filename.indexOf('chrome-extension') !== -1) return;
    capture('error', e.message, e.filename, e.lineno, e.error && e.error.stack);
  });

  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    var msg = reason && reason.message ? reason.message : String(reason);
    var stack = reason && reason.stack ? reason.stack : '';
    capture('unhandledrejection', msg, '', 0, stack);
  });

  window.pcErrorLog = {
    getAll: getAll,
    clear: function () { save([]); },
    count: function () { return getAll().length; }
  };

  console.log('[ErrorTracker] Initialized');
})();
