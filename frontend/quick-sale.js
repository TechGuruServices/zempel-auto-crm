/**
 * Quick Sale v1.0.0
 * Streamlined sale builder: search parts by typing, tap to add, sticky total bar.
 * Opens via pcQuickSale() — designed for speed in the shop.
 */
(function () {
  'use strict';

  var cart = [];

  function getDB() {
    try {
      if (typeof window.getDB === 'function') return window.getDB();
      return { inventory: [], customers: [], vehicles: [] };
    } catch (e) { return { inventory: [], customers: [], vehicles: [] }; }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Escapes an ID interpolated into an inline handler: onclick="fn('ID')".
  // Escapes for the JS string context first, then the HTML attribute context.
  function escId(v) {
    return String(v == null ? '' : v)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function openQuickSale() {
    cart = [];
    var db = getDB();
    var modal = document.getElementById('modalContainer');
    var content = document.getElementById('modalContent');
    modal.classList.remove('hidden');

    content.innerHTML =
      '<div class="p-4 flex flex-col overflow-y-auto" style="max-height:85vh">' +
      '<div class="flex items-center justify-between mb-4">' +
      '<h3 class="text-lg font-bold text-white">⚡ Quick Sale</h3>' +
      '<button onclick="closeModal()" class="p-2 text-slate-400 hover:text-white"><span class="text-xl">✕</span></button></div>' +

      '<select id="qsCustomer" class="glass-input w-full px-3 py-3 rounded-lg text-sm text-white mb-3">' +
      '<option value="">Select customer...</option>' +
      db.customers.map(function (c) { return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>'; }).join('') +
      '</select>' +

      '<input id="qsSearch" placeholder="🔍 Search parts..." class="glass-input w-full px-3 py-3 rounded-lg text-sm text-white mb-3" autocomplete="off">' +
      '<div id="qsResults" class="space-y-2 overflow-y-auto flex-1 mb-3" style="min-height:120px;max-height:30vh"></div>' +

      '<div id="qsCart" class="border-t border-slate-700/50 pt-3 mb-3"></div>' +

      '<div class="sticky bottom-0 bg-slate-900/95 backdrop-blur pt-3 border-t border-slate-700/50">' +
      '<div class="flex items-center justify-between mb-3">' +
      '<span class="text-sm text-slate-400">Total</span>' +
      '<span id="qsTotal" class="text-2xl font-bold text-green-400">$0.00</span></div>' +
      '<button onclick="pcCompleteQuickSale()" class="w-full py-4 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold text-base">✓ Complete Sale</button>' +
      '</div></div>';

    var search = document.getElementById('qsSearch');
    search.addEventListener('input', function () { renderResults(search.value); });
    search.focus();
    renderResults('');
    renderCart();
  }

  function renderResults(q) {
    var db = getDB();
    q = (q || '').toLowerCase();
    var items = (db.inventory || []).filter(function (i) {
      if (!q) return true;
      return ((i.name || '') + ' ' + (i.partNumber || '') + ' ' + (i.brand || '')).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 20);

    var html = items.map(function (i) {
      return '<div class="glass-card rounded-lg p-3 flex items-center justify-between cursor-pointer active:scale-95 transition-transform" ' +
        'onclick="pcQuickAdd(\'' + escId(i.id) + '\')">' +
        '<div><p class="text-sm font-medium text-white">' + escapeHtml(i.name) + '</p>' +
        '<p class="text-xs text-slate-400 font-mono">' + escapeHtml(i.partNumber) + ' • ' + (i.stock || 0) + ' in stock</p></div>' +
        '<span class="text-green-400 font-bold">$' + (Number(i.salePrice || i.price) || 0).toFixed(2) + '</span></div>';
    }).join('');
    document.getElementById('qsResults').innerHTML = html || '<p class="text-slate-500 text-sm text-center py-4">No parts found</p>';
  }

  window.pcQuickAdd = function (itemId) {
    var db = getDB();
    var item = (db.inventory || []).find(function (i) { return i.id === itemId; });
    if (!item) return;
    var existing = cart.find(function (c) { return c.id === itemId; });
    if (existing) { existing.qty++; }
    else { cart.push({ id: itemId, name: item.name, price: Number(item.salePrice || item.price) || 0, qty: 1 }); }
    renderCart();
  };

  window.pcQuickRemove = function (itemId) {
    cart = cart.filter(function (c) { return c.id !== itemId; });
    renderCart();
  };

  function renderCart() {
    var total = cart.reduce(function (s, c) { return s + c.price * c.qty; }, 0);
    var el = document.getElementById('qsTotal');
    if (el) el.textContent = '$' + total.toFixed(2);

    var cartEl = document.getElementById('qsCart');
    if (!cartEl) return;
    if (!cart.length) {
      cartEl.innerHTML = '<p class="text-slate-500 text-xs text-center">Cart is empty — search and tap parts to add</p>';
      return;
    }
    cartEl.innerHTML = cart.map(function (c) {
      return '<div class="flex items-center justify-between py-2 border-b border-slate-700/30">' +
        '<span class="text-sm text-white">' + c.qty + '× ' + escapeHtml(c.name) + '</span>' +
        '<div class="flex items-center gap-2">' +
        '<span class="text-sm text-green-400 font-medium">$' + (c.price * c.qty).toFixed(2) + '</span>' +
        '<button onclick="pcQuickRemove(\'' + c.id + '\')" class="text-red-400 text-xs px-2">✕</button></div></div>';
    }).join('');
  }

  window.pcCompleteQuickSale = function () {
    var custId = (document.getElementById('qsCustomer') || {}).value;
    if (!custId) {
      if (typeof window.showToast === 'function') window.showToast('Select a customer first', 'warning');
      return;
    }
    if (!cart.length) {
      if (typeof window.showToast === 'function') window.showToast('Add at least one part', 'warning');
      return;
    }
    var db = getDB();
    var total = cart.reduce(function (s, c) { return s + c.price * c.qty; }, 0);
    var sale = {
      id: 'SALE' + Date.now(),
      date: new Date().toISOString().slice(0, 10),
      customerId: custId,
      vehicleId: '',
      lineItems: cart.map(function (c) { return { name: c.name, qty: c.qty, unitPrice: c.price }; }),
      total: total,
      status: 'completed'
    };
    db.sales = db.sales || [];
    db.sales.unshift(sale);
    // Decrement stock
    cart.forEach(function (c) {
      var item = (db.inventory || []).find(function (i) { return i.id === c.id; });
      if (item) item.stock = Math.max(0, (Number(item.stock) || 0) - c.qty);
    });
    if (typeof window.saveDB === 'function') window.saveDB(db);
    else { try { localStorage.setItem('partscommand_db', JSON.stringify(db)); } catch (e) {} }

    if (typeof window.closeModal === 'function') window.closeModal();
    if (typeof window.showToast === 'function') window.showToast('Sale completed: $' + total.toFixed(2), 'success');
    cart = [];
  };

  window.pcQuickSale = openQuickSale;

  // Add Quick Sale button to sales view toolbar
  function injectButton() {
    if (document.getElementById('pc-quicksale-btn')) return;
    var newBtn = document.querySelector('button[onclick*="openNewEstimate"]');
    if (!newBtn || !newBtn.parentNode) { setTimeout(injectButton, 3000); return; }
    var btn = document.createElement('button');
    btn.id = 'pc-quicksale-btn';
    btn.className = newBtn.className;
    btn.innerHTML = '⚡ Quick Sale';
    btn.addEventListener('click', openQuickSale);
    newBtn.parentNode.insertBefore(btn, newBtn.nextSibling);
  }

  var observer = new MutationObserver(function () {
    clearTimeout(window._pcQsT);
    window._pcQsT = setTimeout(injectButton, 800);
  });

  function boot() {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(injectButton, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  console.log('[QuickSale] Initialized');
})();
