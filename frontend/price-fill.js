/**
 * Price Fill v1.0.0 — Zempel Auto CRM
 * ---------------------------------------------------------------
 * After a barcode scan, fetches the eBay sold-listings AVERAGE for the
 * part (via the Worker's /v1/market-price endpoint) and pre-fills the
 * Sell Price field. Shows a small source badge under the field so you
 * can see it's a real market lookup, not a guess.
 *
 * Behavior:
 *  - Runs AFTER the app's own fetchPriceInfoFromBarcode (same wrap
 *    pattern as barcode-enhancer.js), so partNumber/brand fields are
 *    already populated when we build the query.
 *  - Fills Sell Price ONLY if the field is empty/0 — never overwrites
 *    a price you typed yourself.
 *  - Cost is intentionally left alone: your cost is your business.
 *  - If eBay has no sold listings for the part, it says so instead of
 *    inventing a number.
 *
 * INSTALL: add one <script> tag AFTER the main app scripts (and after
 * barcode-enhancer.js if you use it):
 *   <script src="price-fill.js"></script>
 * No other changes needed. Requires the /v1/market-price Worker route
 * (see market-price-worker.ts) and the EBAY_APP_ID Worker secret.
 */
(function () {
  'use strict';

  var API_URL = 'https://parts-command-api.techguruofficial.workers.dev';

  function toast(msg, type) {
    if (typeof window.showToast === 'function') {
      try { window.showToast(msg, type || 'info'); } catch (e) { /* noop */ }
    }
  }

  // Read a field from the Add-Part form. The live DOM gives the part
  // number field the id #addPartNumber; everything else uses name= selectors
  // (scoped to the open modal first, like the app's own autofill).
  function formVal(name) {
    var el = null;
    if (name === 'partNumber') el = document.getElementById('addPartNumber');
    if (!el) {
      el = document.querySelector('#modalContent input[name="' + name + '"]') ||
           document.querySelector('input[name="' + name + '"]');
    }
    return el && el.value ? String(el.value).trim() : '';
  }

  function sellPriceInput() {
    return document.querySelector('#modalContent input[name="price"]') ||
           document.querySelector('input[name="price"]');
  }

  function showBadge(input, avg, count) {
    var badge = document.getElementById('market-price-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'market-price-badge';
      badge.style.cssText = 'font-size:11px;color:#94a3b8;margin-top:4px;';
      input.parentNode.insertBefore(badge, input.nextSibling);
    }
    badge.textContent = 'Market avg $' + Number(avg).toFixed(2) +
      ' · ' + count + ' eBay sold listings';
  }

  function fillSellPrice(avg, count) {
    var input = sellPriceInput();
    if (!input) return false;
    var cur = parseFloat(input.value);
    if (input.value !== '' && !(isNaN(cur) || cur === 0)) return false; // don't clobber manual entry
    input.value = Number(avg).toFixed(2);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    showBadge(input, avg, count);
    return true;
  }

  function enhance() {
    if (typeof window.fetchPriceInfoFromBarcode !== 'function') {
      setTimeout(enhance, 2000); // wait for the main app to load
      return;
    }
    var orig = window.fetchPriceInfoFromBarcode;

    window.fetchPriceInfoFromBarcode = async function (barcode) {
      // 1. Let the app do its normal scan handling first (fills partNumber/brand/etc.)
      await orig.call(this, barcode);

      // 2. Build the market-price query from the populated form (best),
      //    falling back to the raw scanned barcode.
      var partNumber = formVal('partNumber') || (barcode ? String(barcode).trim() : '');
      var brand = formVal('brand');
      if (!partNumber) return;

      try {
        var res = await fetch(
          API_URL + '/v1/market-price?partNumber=' + encodeURIComponent(partNumber) +
          '&brand=' + encodeURIComponent(brand),
          { signal: AbortSignal.timeout(20000) }
        );
        if (!res.ok) {
          var errBody = null;
          try { errBody = await res.json(); } catch (e) { /* noop */ }
          if (res.status === 500 && errBody && errBody.hint) {
            toast('Market price not set up yet: ' + errBody.hint, 'warning');
          }
          return;
        }
        var data = await res.json();
        if (data && data.count > 0 && data.average > 0) {
          if (fillSellPrice(data.average, data.count)) {
            toast('Sell price set from market avg ($' + Number(data.average).toFixed(2) + ')', 'success');
          } else {
            toast('Market avg $' + Number(data.average).toFixed(2) +
              ' (' + data.count + ' sold) — Sell Price already filled', 'info');
          }
        } else {
          toast('No eBay sold listings for this part — enter price manually', 'warning');
          console.log('[PriceFill] no market data for', partNumber);
        }
      } catch (e) {
        console.log('[PriceFill] lookup skipped:', e && e.message);
      }
    };

    console.log('[PriceFill] Initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(enhance, 1000); });
  } else {
    setTimeout(enhance, 1000);
  }
})();
