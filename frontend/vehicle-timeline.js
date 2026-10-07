/**
 * Vehicle Timeline Enhancer v1.0.0
 * Merges sales/invoices into the vehicle repair history for a unified chronological timeline.
 */
(function () {
  'use strict';

  function getDB() {
    try {
      if (typeof window.getDB === 'function') return window.getDB();
      var raw = localStorage.getItem('partscommand_db');
      return raw ? JSON.parse(raw) : { sales: [], vehicles: [] };
    } catch (e) { return { sales: [], vehicles: [] }; }
  }

  function enhance() {
    if (typeof window.openVehicleDetail !== 'function') {
      setTimeout(enhance, 2000);
      return;
    }

    var orig = window.openVehicleDetail;
    window.openVehicleDetail = function (vId) {
      orig.call(this, vId);

      // After original renders, inject linked sales into the timeline
      setTimeout(function () {
        var db = getDB();
        var sales = (db.sales || []).filter(function (s) { return s.vehicleId === vId; });
        if (!sales.length) return;

        // Find the Repair History section
        var headings = document.querySelectorAll('#modalContent h4');
        var repairHeading = null;
        headings.forEach(function (h) {
          if (h.textContent.indexOf('Repair History') !== -1) repairHeading = h;
        });
        if (!repairHeading) return;

        // Build sales timeline entries
        var salesHtml = sales
          .sort(function (a, b) { return new Date(b.date) - new Date(a.date); })
          .map(function (s) {
            var items = (s.lineItems || []).map(function (li) {
              return (li.qty || 1) + 'x ' + (li.name || 'Part');
            }).join(', ');
            return '<div class="glass-card rounded-lg p-3 border-l-2 border-l-blue-500">' +
              '<div class="flex items-center justify-between mb-1">' +
              '<span class="text-sm font-medium text-white">🧾 ' + escapeHtml(s.status || 'Sale') + '</span>' +
              '<span class="text-xs text-slate-400">' + escapeHtml(s.date || '') + '</span></div>' +
              (items ? '<p class="text-xs text-slate-400">' + escapeHtml(items) + '</p>' : '') +
              '<p class="text-sm font-bold text-green-400 mt-1">$' + (Number(s.total) || 0).toFixed(2) + '</p></div>';
          }).join('');

        var container = document.createElement('div');
        container.className = 'space-y-2 mb-4';
        container.innerHTML = '<h4 class="text-sm font-semibold text-white mb-3 flex items-center gap-2">' +
          '<span>🧾</span> Linked Sales & Invoices</h4>' + salesHtml;

        repairHeading.parentNode.insertBefore(container, repairHeading.nextSibling);
      }, 300);
    };

    console.log('[VehicleTimeline] Initialized');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(enhance, 1500); });
  } else {
    setTimeout(enhance, 1500);
  }
})();
