/**
 * Quote Share v1.0.0
 * Adds "Share Quote" button to sales — generates a public quote.html URL with encoded data.
 */
(function () {
  'use strict';

  function getDB() {
    try {
      if (typeof window.getDB === 'function') return window.getDB();
      return { sales: [], customers: [], vehicles: [] };
    } catch (e) { return { sales: [], customers: [], vehicles: [] }; }
  }

  function buildQuoteUrl(saleId) {
    var db = getDB();
    var s = (db.sales || []).find(function (x) { return x.id === saleId; });
    if (!s) return null;

    var cust = (db.customers || []).find(function (c) { return c.id === s.customerId; });
    var veh = (db.vehicles || []).find(function (v) { return v.id === s.vehicleId; });

    var quote = {
      id: s.id,
      date: s.date || new Date().toLocaleDateString(),
      customer: cust ? cust.name : 'Valued Customer',
      vehicle: veh ? (veh.year + ' ' + veh.make + ' ' + veh.model) : '',
      items: (s.lineItems || []).map(function (li) {
        return { name: li.name, qty: li.qty, unitPrice: li.unitPrice, desc: li.desc || '' };
      }),
      labor: Number(s.laborCost || s.labor || 0),
      total: Number(s.total || 0)
    };

    var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(quote))));
    var base = location.origin + location.pathname.replace(/[^/]*$/, '');
    return base + 'quote.html#' + encoded;
  }

  function shareQuote(saleId) {
    var url = buildQuoteUrl(saleId);
    if (!url) {
      if (typeof window.showToast === 'function') window.showToast('Could not build quote link', 'danger');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        if (typeof window.showToast === 'function') window.showToast('Quote link copied! Share it with the customer.', 'success');
      }).catch(function () {
        prompt('Copy this quote link:', url);
      });
    } else {
      prompt('Copy this quote link:', url);
    }
  }

  // Expose globally for use in sale detail views
  window.pcShareQuote = shareQuote;

  console.log('[QuoteShare] Initialized');
})();
