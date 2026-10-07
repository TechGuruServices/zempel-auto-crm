/**
 * Perf Loader v1.0.0
 * Lazy-loads non-critical enhancement modules on demand instead of all upfront.
 * Critical modules (auth, sync, error tracking) load immediately.
 * Feature modules load when their view is first accessed.
 */
(function () {
  'use strict';

  var loaded = {};
  var loading = {};

  // Map views to their enhancement modules
  var viewModules = {
    'dashboard': ['dashboard-analytics.js', 'dashboard-links.js'],
    'inventory': ['shop-mode.js', 'barcode-enhancer.js'],
    'sales': ['quick-sale.js'],
    'customers': [],
    'vehicles': ['vehicle-timeline.js'],
    'comparison': ['price-sync.js'],
    'settings': ['db-backup.js'],
    'default': ['quote-share.js', 'inline-edit.js']
  };

  // Modules that should load immediately (critical)
  var critical = ['sync-status.js', 'offline-queue.js', 'error-tracker.js'];

  // The page also loads modules via static <script> tags (frontend/index.html).
  // Never inject a second copy of a module the document already has —
  // double-execution caused duplicate fetch wrappers, intervals and listeners.
  function alreadyPresent(src) {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i].getAttribute('src') || '';
      if (s.split('/').pop().split('?')[0] === src) return true;
    }
    return false;
  }

  function loadScript(src) {
    if (loaded[src] || alreadyPresent(src)) { loaded[src] = true; return Promise.resolve(); }
    if (loading[src]) return loading[src];
    loading[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.setAttribute('data-cfasync', 'false');
      s.onload = function () { loaded[src] = true; resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.body.appendChild(s);
    });
    return loading[src];
  }

  function loadForView(view) {
    var modules = viewModules[view] || [];
    var defaults = viewModules['default'] || [];
    var all = modules.concat(defaults);
    return Promise.all(all.map(loadScript)).catch(function (e) {
      console.warn('[PerfLoader] Module load failed:', e.message);
    });
  }

  // Hook into navigate() to lazy-load
  function hookNavigate() {
    if (typeof window.navigate !== 'function') {
      setTimeout(hookNavigate, 1000);
      return;
    }
    var origNavigate = window.navigate;
    window.navigate = function (view) {
      var result = origNavigate.call(this, view);
      // Load modules for this view in background
      setTimeout(function () { loadForView(view); }, 100);
      return result;
    };
    console.log('[PerfLoader] Hooked into navigate()');
  }

  // Load critical modules immediately
  function boot() {
    critical.forEach(function (src) { loadScript(src); });
    hookNavigate();
    // Preload default modules after initial render
    setTimeout(function () { loadForView('default'); }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.pcPerfLoader = { load: loadScript, loadForView: loadForView };
  console.log('[PerfLoader] Initialized');
})();
