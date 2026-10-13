/* Price Fill v1.0.2 — Zempel Auto CRM
 *
 * After a barcode scan, fetches the eBay listings AVERAGE for the
 * part number and fills the COST field with it.
 *
 * Field semantics (per Lucas):
 *  - Cost       = what the part costs on the market  -> AUTO-FILLED from eBay avg
 *  - Sell Price = what you/Darwin would sell it for  -> MANUAL, never touched
 *
 * Behavior:
 *  - Wraps the app's own fetchPriceInfoFromBarcode (runs after it).
 *  - A scan always refreshes Cost with the fresh average
 *    (explicit scan = explicit refresh).
 *  - Shows a small badge under the Cost field:
 *      "Market avg $X · N eBay listings"
 *  - If eBay has no listings for the part, it says so instead of
 *    inventing a number.
 *  - Sell Price is never written by this script.
 */
(function () {
  'use strict';

  var API_BASE = 'https://parts-command-api.techguruofficial.workers.dev';

  function formVal(name) {
    var el = document.querySelector('#modalContent input[name="' + name + '"]') ||
             document.querySelector('input[name="' + name + '"]');
    return el ? (el.value || '').trim() : '';
  }

  function costInput() {
    return document.querySelector('#modalContent input[name="cost"]') ||
           document.querySelector('input[name="cost"]');
  }

  function showBadge(input, avg, count) {
    var badge = document.getElementById('market-price-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'market-price-badge';
      badge.style.cssText = 'font-size:11px;color:#7dd3fc;margin-top:2px;';
      input.parentNode.insertBefore(badge, input.nextSibling);
    }
    badge.textContent =
      'Market avg $' + Number(avg).toFixed(2) +
      ' · ' + count + ' eBay listings';
  }

  function fillCost(avg, count) {
    var input = costInput();
    if (!input) return false;
    // A scan is an explicit refresh: the fresh market average always wins,
    // even if the field already holds a value (e.g. from an inventory record).
    input.value = Number(avg).toFixed(2);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    showBadge(input, avg, count);
    return true;
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    if (typeof window.toast === 'function') { window.toast(msg, type); return; }
    console.log('[PriceFill][' + (type || 'info') + '] ' + msg);
  }

  async function fetchMarketPrice(partNumber, brand) {
    var url = API_BASE + '/v1/market-price?partNumber=' + encodeURIComponent(partNumber) +
              '&brand=' + encodeURIComponent(brand || '');
    var res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  }

  function enhance() {
    if (typeof window.fetchPriceInfoFromBarcode !== 'function') return false;
    if (window.fetchPriceInfoFromBarcode.__priceFillV2) return true;
    var orig = window.fetchPriceInfoFromBarcode;
    window.fetchPriceInfoFromBarcode = async function (barcode) {
      await orig.call(this, barcode);
      try {
        var partNumber = formVal('partNumber') || String(barcode || '').trim();
        if (!partNumber) return;
        var brand = formVal('brand');
        var data = await fetchMarketPrice(partNumber, brand);
        if (data && data.count > 0 && data.average > 0) {
          fillCost(data.average, data.count);
          toast('Cost set from market avg ($' + Number(data.average).toFixed(2) + ')', 'success');
        } else {
          toast('No eBay listings for this part — enter cost manually', 'warning');
        }
      } catch (err) {
        console.error('[PriceFill]', err);
      }
    };
    window.fetchPriceInfoFromBarcode.__priceFillV2 = true;
    console.log('[PriceFill] v1.0.2 active — Cost auto-fills from eBay market avg');
    return true;
  }

  if (!enhance()) {
    var tries = 0;
    var iv = setInterval(function () {
      tries += 1;
      if (enhance() || tries > 100) clearInterval(iv);
    }, 200);
  }
})();
