/**
 * Barcode Enhancer v1.0.0
 * Extends the existing barcode scan flow with RockAuto catalog lookup.
 * Hooks into fetchPriceInfoFromBarcode to add catalog data.
 */
(function () {
  'use strict';

  var API_URL = 'https://parts-command-api.techguruofficial.workers.dev';

  // Wrap the existing function if it exists
  function enhance() {
    if (typeof window.fetchPriceInfoFromBarcode !== 'function') {
      // Retry until the main app loads
      setTimeout(enhance, 2000);
      return;
    }

    var orig = window.fetchPriceInfoFromBarcode;
    window.fetchPriceInfoFromBarcode = async function (barcode) {
      // Run original (price scraping + autofill)
      await orig.call(this, barcode);

      // Additional: RockAuto catalog search for part details
      if (!barcode) return;
      try {
        var res = await fetch(API_URL + '/v1/rockauto/search?q=' + encodeURIComponent(barcode), {
          signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) return;
        var data = await res.json();
        if (data.source === 'live-rockauto' && data.results && data.results.length > 0) {
          var first = data.results[0];
          console.log('[BarcodeEnhancer] RockAuto catalog hit:', first.partNumber);

          // Autofill description if empty
          var descInput = document.querySelector('textarea[name="description"], input[name="description"]');
          if (descInput && !descInput.value && first.description) {
            descInput.value = first.description.slice(0, 500);
          }

          // Show catalog confirmation
          if (typeof window.showToast === 'function') {
            window.showToast('✓ RockAuto catalog match: ' + first.partNumber, 'success');
          }
        }
      } catch (e) {
        console.log('[BarcodeEnhancer] Catalog lookup skipped:', e.message);
      }
    };

    console.log('[BarcodeEnhancer] Initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(enhance, 1000); });
  } else {
    setTimeout(enhance, 1000);
  }
})();
