/**
 * Shop Mode v1.0.0
 * Adds a card-based inventory view with big touch targets for shop use.
 * Toggle via the "Shop Mode" button injected into the inventory toolbar.
 */
(function () {
  'use strict';

  var shopMode = false;

  function getDB() {
    try {
      if (typeof window.getDB === 'function') return window.getDB();
      return { inventory: [] };
    } catch (e) { return { inventory: [] }; }
  }

  function renderShopMode(container) {
    var db = getDB();
    var items = db.inventory || [];
    // Apply current search filter if set
    var searchInput = document.querySelector('input[placeholder*="earch"]');
    var q = searchInput ? searchInput.value.toLowerCase() : '';
    if (q) items = items.filter(function (i) {
      return (i.name + ' ' + i.partNumber + ' ' + (i.brand || '')).toLowerCase().indexOf(q) !== -1;
    });

    var html = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">';
    items.forEach(function (item) {
      var low = (Number(item.stock) || 0) <= (Number(item.minStock) || 0);
      html += '<div class="glass-card rounded-xl p-4 flex items-center gap-4 cursor-pointer active:scale-95 transition-transform" ' +
        'onclick="pcShopAdd(\'' + item.id + '\')">' +
        '<div class="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">' +
        '<span class="text-2xl">🔧</span></div>' +
        '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-semibold text-white truncate">' + escapeHtml(item.name) + '</p>' +
        '<p class="text-xs text-slate-400 font-mono">' + escapeHtml(item.partNumber) + '</p>' +
        '<p class="text-xs mt-1 ' + (low ? 'text-amber-400' : 'text-slate-500') + '">' +
        (Number(item.stock) || 0) + ' in stock' + (low ? ' ⚠️' : '') + '</p></div>' +
        '<div class="text-right flex-shrink-0">' +
        '<p class="text-lg font-bold text-green-400">$' + (Number(item.salePrice || item.price) || 0).toFixed(2) + '</p>' +
        '<p class="text-[10px] text-blue-400 font-medium">TAP TO ADD +</p></div></div>';
    });
    html += '</div>';
    if (!items.length) html = '<p class="text-center text-slate-500 py-8">No parts found</p>';
    container.innerHTML = html;
  }

  function toggleShopMode() {
    shopMode = !shopMode;
    var btn = document.getElementById('pc-shopmode-btn');
    if (btn) {
      btn.classList.toggle('bg-blue-500/20', shopMode);
      btn.querySelector('span').textContent = shopMode ? '📋 Table' : '🛒 Shop';
    }
    // Re-render inventory view
    if (typeof window.renderView === 'function') window.renderView();
    // After render, if shop mode, replace table with cards
    if (shopMode) {
      setTimeout(function () {
        var table = document.querySelector('table');
        if (table && table.parentNode) {
          var wrapper = document.createElement('div');
          wrapper.id = 'pc-shopmode-view';
          table.parentNode.insertBefore(wrapper, table);
          table.style.display = 'none';
          renderShopMode(wrapper);
        }
      }, 300);
    }
  }

  function injectButton() {
    if (document.getElementById('pc-shopmode-btn')) return;
    // Find inventory toolbar
    var toolbar = document.querySelector('[data-view="inventory"] .flex.gap-2, #inventory-toolbar');
    if (!toolbar) {
      // Try to find by looking for export buttons
      var exportBtn = document.querySelector('button[onclick*="exportInventory"]');
      if (exportBtn && exportBtn.parentNode) toolbar = exportBtn.parentNode;
    }
    if (!toolbar) { setTimeout(injectButton, 3000); return; }

    var btn = document.createElement('button');
    btn.id = 'pc-shopmode-btn';
    btn.className = 'glass-input px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white flex items-center gap-1';
    btn.innerHTML = '<span>🛒 Shop</span>';
    btn.addEventListener('click', toggleShopMode);
    toolbar.appendChild(btn);
  }

  // Add to sale from shop mode
  window.pcShopAdd = function (itemId) {
    var db = getDB();
    var item = (db.inventory || []).find(function (i) { return i.id === itemId; });
    if (!item) return;
    // Open new estimate with this part pre-added
    if (typeof window.openNewEstimate === 'function') {
      window.openNewEstimate();
      setTimeout(function () {
        if (typeof window.addEstimateLine === 'function') {
          window.addEstimateLine();
          // Try to fill the last line with this part
          var lines = document.querySelectorAll('#estimateLines > div');
          var last = lines[lines.length - 1];
          if (last) {
            var nameInput = last.querySelector('input[name*="name"], input[placeholder*="Part"]');
            var priceInput = last.querySelector('input[name*="price"], input[type="number"]');
            if (nameInput) nameInput.value = item.name;
            if (priceInput) priceInput.value = item.salePrice || item.price || 0;
          }
        }
        if (typeof window.showToast === 'function') window.showToast(item.name + ' added to estimate', 'success');
      }, 500);
    }
  };

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var observer = new MutationObserver(function () {
    clearTimeout(window._pcShopT);
    window._pcShopT = setTimeout(injectButton, 800);
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

  window.pcToggleShopMode = toggleShopMode;
  console.log('[ShopMode] Initialized');
})();
