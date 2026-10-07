/**
 * RockAuto Categories Fix v1.0.0
 * Normalizes live category strings to the object format rockauto-ui.js expects.
 * The live API returns ["BELT DRIVE", ...] but the UI expects [{name, group_name}].
 */
(function () {
  'use strict';

  function normalizeCategories(data) {
    if (!data || !Array.isArray(data.categories)) return data;
    data.categories = data.categories.map(function (cat) {
      if (typeof cat === 'string') {
        return {
          name: cat,
          group_name: cat.toLowerCase().replace(/[^a-z0-9]+/g, '+'),
          href: null
        };
      }
      return cat;
    });
    return data;
  }

  // Hook into the fetch layer to normalize before render
  function hook() {
    // Patch via MutationObserver is fragile; instead patch the global
    // renderCategories if exposed, or intercept at the data layer
    //
    // The rockauto-ui.js renderCategories is not global, so we patch
    // by wrapping the fetch that loads categories.
    //
    // Simplest robust approach: periodically check for the error condition
    // and re-normalize any string arrays in flight.
    //
    // Actually the cleanest: override window.fetch for the categories endpoint
    var origFetch = window.fetch;
    window.fetch = function (url, opts) {
      var result = origFetch.call(this, url, opts);
      if (typeof url === 'string' && url.includes('/v1/rockauto/categories/')) {
        return result.then(function (res) {
          // Clone and normalize
          return res.clone().json().then(function (data) {
            normalizeCategories(data);
            // Return a new response with normalized data
            return new Response(JSON.stringify(data), {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers
            });
          }).catch(function () { return res; });
        });
      }
      return result;
    };
    console.log('[RACategoriesFix] Fetch hook installed');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(hook, 1000); });
  } else {
    setTimeout(hook, 1000);
  }
})();
