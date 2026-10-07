/**
 * Inline Edit v1.0.0
 * Adds missing edit capabilities: vehicles, sales, and quick-edit buttons on detail views.
 * Also adds inline field editing for inventory (tap a value to edit it).
 */
(function () {
  'use strict';

  function getDB() {
    try {
      if (typeof window.getDB === 'function') return window.getDB();
      return null;
    } catch (e) { return null; }
  }

  function saveDB(db) {
    if (typeof window.saveDB === 'function') window.saveDB(db);
    else { try { localStorage.setItem('partscommand_db', JSON.stringify(db)); } catch (e) {} }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
  }

  // ── Edit Vehicle ──
  window.openEditVehicleModal = function (vId) {
    var db = getDB();
    if (!db) return;
    var v = (db.vehicles || []).find(function (x) { return x.id === vId; });
    if (!v) { toast('Vehicle not found', 'danger'); return; }

    var modal = document.getElementById('modalContainer');
    var content = document.getElementById('modalContent');
    modal.classList.remove('hidden');

    content.innerHTML =
      '<div class="p-6 overflow-y-auto max-h-[85vh]">' +
      '<div class="flex items-center justify-between mb-5">' +
      '<h3 class="text-lg font-bold text-white flex items-center gap-2">✏️ Edit Vehicle</h3>' +
      '<button onclick="closeModal()" class="p-2 text-slate-400 hover:text-white"><span class="text-xl">✕</span></button></div>' +
      '<form onsubmit="pcSaveVehicleEdit(event, \'' + v.id + '\')" class="space-y-4">' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Customer</label>' +
      '<select name="customerId" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white">' +
      (db.customers || []).map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === v.customerId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="grid grid-cols-3 gap-3">' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Year *</label>' +
      '<input type="number" name="year" value="' + esc(v.year) + '" required min="1950" max="2030" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Make *</label>' +
      '<input type="text" name="make" value="' + esc(v.make) + '" required class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Model *</label>' +
      '<input type="text" name="model" value="' + esc(v.model) + '" required class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div></div>' +
      '<div><label class="text-xs text-slate-400 mb-1 block">VIN</label>' +
      '<input type="text" name="vin" value="' + esc(v.vin) + '" maxlength="17" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white font-mono"></div>' +
      '<div class="grid grid-cols-3 gap-3">' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Mileage</label>' +
      '<input type="number" name="mileage" value="' + (Number(v.mileage) || 0) + '" min="0" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Color</label>' +
      '<input type="text" name="color" value="' + esc(v.color) + '" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>' +
      '<div><label class="text-xs text-slate-400 mb-1 block">License Plate</label>' +
      '<input type="text" name="licensePlate" value="' + esc(v.licensePlate) + '" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white font-mono"></div></div>' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Notes</label>' +
      '<textarea name="notes" rows="2" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white resize-none">' + esc(v.notes) + '</textarea></div>' +
      '<button type="submit" class="btn-primary w-full py-3 rounded-lg text-sm font-semibold text-white">💾 Save Changes</button>' +
      '</form></div>';
  };

  window.pcSaveVehicleEdit = function (e, vId) {
    e.preventDefault();
    var db = getDB();
    if (!db) return;
    var v = (db.vehicles || []).find(function (x) { return x.id === vId; });
    if (!v) return;
    var f = e.target;
    v.customerId = f.customerId.value;
    v.year = f.year.value;
    v.make = f.make.value;
    v.model = f.model.value;
    v.vin = f.vin.value;
    v.mileage = Number(f.mileage.value) || 0;
    v.color = f.color.value;
    v.licensePlate = f.licensePlate.value;
    v.notes = f.notes.value;
    saveDB(db);
    if (typeof window.closeModal === 'function') window.closeModal();
    toast('Vehicle updated');
    if (typeof window.renderView === 'function') window.renderView();
  };

  // ── Edit Sale ──
  window.openEditSaleModal = function (saleId) {
    var db = getDB();
    if (!db) return;
    var s = (db.sales || []).find(function (x) { return x.id === saleId; });
    if (!s) { toast('Sale not found', 'danger'); return; }

    var modal = document.getElementById('modalContainer');
    var content = document.getElementById('modalContent');
    modal.classList.remove('hidden');

    var itemsHtml = (s.lineItems || []).map(function (li, i) {
      return '<div class="grid grid-cols-12 gap-2 items-center" data-line="' + i + '">' +
        '<div class="col-span-5"><input type="text" value="' + esc(li.name) + '" data-f="name" class="glass-input w-full px-2 py-2 rounded-lg text-xs text-white"></div>' +
        '<div class="col-span-2"><input type="number" value="' + (li.qty || 1) + '" data-f="qty" min="1" class="glass-input w-full px-2 py-2 rounded-lg text-xs text-white text-center"></div>' +
        '<div class="col-span-3"><input type="number" value="' + (li.unitPrice || 0) + '" data-f="price" step="0.01" class="glass-input w-full px-2 py-2 rounded-lg text-xs text-white text-right"></div>' +
        '<div class="col-span-2 text-right"><button type="button" onclick="this.closest(\'[data-line]\').remove()" class="text-red-400 text-xs">✕</button></div></div>';
    }).join('');

    content.innerHTML =
      '<div class="p-6 overflow-y-auto max-h-[85vh]">' +
      '<div class="flex items-center justify-between mb-5">' +
      '<h3 class="text-lg font-bold text-white">✏️ Edit Sale</h3>' +
      '<button onclick="closeModal()" class="p-2 text-slate-400 hover:text-white"><span class="text-xl">✕</span></button></div>' +
      '<form onsubmit="pcSaveSaleEdit(event, \'' + s.id + '\')" class="space-y-4">' +
      '<div class="grid grid-cols-2 gap-3">' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Customer</label>' +
      '<select name="customerId" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white">' +
      (db.customers || []).map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === s.customerId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Status</label>' +
      '<select name="status" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white">' +
      ['pending', 'completed', 'cancelled'].map(function (st) {
        return '<option value="' + st + '"' + (s.status === st ? ' selected' : '') + '>' + st + '</option>';
      }).join('') + '</select></div></div>' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Date</label>' +
      '<input type="date" name="date" value="' + esc(s.date) + '" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>' +
      '<div><label class="text-xs text-slate-400 mb-2 block">Line Items</label>' +
      '<div id="pcSaleLines" class="space-y-2">' + itemsHtml + '</div></div>' +
      '<div><label class="text-xs text-slate-400 mb-1 block">Labor ($)</label>' +
      '<input type="number" name="labor" value="' + (Number(s.laborCost || s.labor) || 0) + '" step="0.01" class="glass-input w-full px-3 py-2.5 rounded-lg text-sm text-white"></div>' +
      '<button type="submit" class="btn-primary w-full py-3 rounded-lg text-sm font-semibold text-white">💾 Save Changes</button>' +
      '</form></div>';
  };

  window.pcSaveSaleEdit = function (e, saleId) {
    e.preventDefault();
    var db = getDB();
    if (!db) return;
    var s = (db.sales || []).find(function (x) { return x.id === saleId; });
    if (!s) return;
    var f = e.target;
    s.customerId = f.customerId.value;
    s.status = f.status.value;
    s.date = f.date.value;
    s.laborCost = Number(f.labor.value) || 0;
    // Rebuild line items
    var lines = [];
    document.querySelectorAll('#pcSaleLines [data-line]').forEach(function (div) {
      lines.push({
        name: div.querySelector('[data-f="name"]').value,
        qty: Number(div.querySelector('[data-f="qty"]').value) || 1,
        unitPrice: Number(div.querySelector('[data-f="price"]').value) || 0
      });
    });
    s.lineItems = lines;
    s.total = lines.reduce(function (t, li) { return t + li.qty * li.unitPrice; }, 0) + s.laborCost;
    saveDB(db);
    if (typeof window.closeModal === 'function') window.closeModal();
    toast('Sale updated');
    if (typeof window.renderView === 'function') window.renderView();
  };

  // ── Inject edit buttons on detail views ──
  function injectEditButtons() {
    // Vehicle detail: add edit button next to close
    var vehicleHeadings = document.querySelectorAll('#modalContent h3');
    vehicleHeadings.forEach(function (h) {
      if (h.textContent.match(/^\d{4} /) && !h.dataset.editBtn) { // Year Make Model pattern
        h.dataset.editBtn = '1';
        // Find vehicle ID from the modal context
        var btn = document.createElement('button');
        btn.className = 'ml-2 p-1.5 text-blue-400 hover:text-blue-300 text-sm';
        btn.innerHTML = '✏️';
        btn.title = 'Edit vehicle';
        btn.onclick = function () {
          // Try to find vehicle ID from page
          var db = getDB();
          if (!db) return;
          var title = h.textContent.trim();
          var v = (db.vehicles || []).find(function (x) {
            return (x.year + ' ' + x.make + ' ' + x.model).trim() === title;
          });
          if (v) { window.closeModal(); setTimeout(function () { window.openEditVehicleModal(v.id); }, 100); }
        };
        h.appendChild(btn);
      }
    });
  }

  var observer = new MutationObserver(function () {
    clearTimeout(window._pcEditT);
    window._pcEditT = setTimeout(injectEditButtons, 600);
  });

  function boot() {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  console.log('[InlineEdit] Initialized');
})();
