/**
 * Price Sync v1.0.0
 * Wires live competitor price fetching into the Price Comparison view.
 * - Auto-fetches live prices when adding a new part
 * - Adds per-row refresh buttons
 * - Adds "Refresh All" bulk update from live data
 */
(function () {
  'use strict';

  var API_URL = 'https://parts-command-api.techguruofficial.workers.dev';

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

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
  }

  function getToken() {
    try { return localStorage.getItem('partscommand_token') || sessionStorage.getItem('partscommand_token') || ''; }
    catch (e) { return ''; }
  }

  async function fetchLivePrices(partNumber) {
    var token = getToken();
    var headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var res = await fetch(API_URL + '/prices?partNumber=' + encodeURIComponent(partNumber), { headers: headers });
    if (!res.ok) throw new Error('Price fetch failed: ' + res.status);
    return res.json();
  }

  // ── Auto-fetch when adding a part ──
  function enhanceAddModal() {
    if (typeof window.openAddRetailerPrice !== 'function') {
      setTimeout(enhanceAddModal, 2000);
      return;
    }
    var orig = window.openAddRetailerPrice;
    window.openAddRetailerPrice = function () {
      orig.call(this);
      setTimeout(function () {
        var partSelect = document.querySelector('select[name="partNumber"]');
        if (!partSelect || partSelect.dataset.liveBound) return;
        partSelect.dataset.liveBound = '1';

        // Add fetch button next to part select
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mt-2 w-full py-2.5 rounded-lg text-sm font-medium text-cyan-400 border border-cyan-400/30 hover:bg-cyan-400/10 flex items-center justify-center gap-2';
        btn.innerHTML = '🔄 Fetch Live Prices';
        btn.onclick = async function () {
          var pn = partSelect.value;
          if (!pn) { toast('Select a part first', 'warning'); return; }
          btn.disabled = true;
          btn.innerHTML = '⏳ Fetching...';
          try {
            var data = await fetchLivePrices(pn);
            var form = partSelect.closest('form');
            if (!form) return;
            var fields = ['rockauto', 'oreilly', 'napa', 'autozone', 'advance', 'carquest'];
            var found = 0;
            fields.forEach(function (f) {
              var input = form.querySelector('input[name="' + f + '"]');
              if (input && data[f] != null && Number(data[f]) > 0) {
                input.value = Number(data[f]).toFixed(2);
                found++;
              }
            });
            // Auto-fill name if available
            if (data.name) {
              toast('Found ' + found + ' live prices for ' + pn, 'success');
            } else {
              toast(found ? 'Updated ' + found + ' prices' : 'No live prices found', found ? 'success' : 'warning');
            }
          } catch (err) {
            toast('Failed to fetch prices', 'danger');
          }
          btn.disabled = false;
          btn.innerHTML = '🔄 Fetch Live Prices';
        };
        partSelect.parentNode.appendChild(btn);
      }, 300);
    };
  }

  // ── Per-row refresh in comparison table ──
  function addRowRefreshButtons() {
    var observer = new MutationObserver(function () {
      // Find comparison table rows
      var table = document.querySelector('table');
      if (!table || !document.body.textContent.includes('Price Comparison')) return;
      var rows = table.querySelectorAll('tbody tr');
      rows.forEach(function (row) {
        if (row.dataset.refreshBtn) return;
        var cells = row.querySelectorAll('td');
        if (!cells.length) return;
        var partNum = cells[0].textContent.trim();
        if (!partNum) return;
        row.dataset.refreshBtn = '1';

        // Add refresh button to last cell or create action cell
        var lastCell = cells[cells.length - 1];
        var rbtn = document.createElement('button');
        rbtn.className = 'ml-2 text-cyan-400 hover:text-cyan-300 text-xs';
        rbtn.innerHTML = '🔄';
        rbtn.title = 'Refresh live prices for ' + partNum;
        rbtn.onclick = async function (e) {
          e.stopPropagation();
          rbtn.innerHTML = '⏳';
          try {
            var data = await fetchLivePrices(partNum);
            var db = getDB();
            if (!db) return;
            var entry = (db.retailerPrices || []).find(function (r) { return r.partNumber === partNum; });
            if (entry) {
              ['rockauto', 'oreilly', 'napa', 'autozone', 'advance', 'carquest'].forEach(function (f) {
                if (data[f] != null && Number(data[f]) > 0) entry[f] = Number(data[f]);
              });
              entry.lastFetched = new Date().toISOString();
              saveDB(db);
              toast('Prices updated for ' + partNum, 'success');
              if (typeof window.renderView === 'function') window.renderView();
            }
          } catch (err) {
            toast('Fetch failed', 'danger');
          }
          rbtn.innerHTML = '🔄';
        };
        lastCell.appendChild(rbtn);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Refresh All button ──
  function addRefreshAllButton() {
    var observer = new MutationObserver(function () {
      clearTimeout(window._pcPriceSyncT);
      window._pcPriceSyncT = setTimeout(function () {
        if (document.getElementById('pc-refresh-all-prices')) return;
        // Find the comparison toolbar (has Add Part button)
        var addBtn = document.querySelector('button[onclick*="openAddRetailerPrice"]');
        if (!addBtn || !addBtn.parentNode) return;

        var btn = document.createElement('button');
        btn.id = 'pc-refresh-all-prices';
        btn.className = 'glass-input px-4 py-2.5 rounded-lg text-sm text-cyan-300 hover:text-white flex items-center gap-2 whitespace-nowrap border border-cyan-400/30';
        btn.innerHTML = '🔄 Refresh All Live';
        btn.onclick = async function () {
          var db = getDB();
          if (!db || !(db.retailerPrices || []).length) {
            toast('No parts to refresh', 'warning');
            return;
          }
          btn.disabled = true;
          var total = db.retailerPrices.length;
          var done = 0, updated = 0;
          for (var i = 0; i < db.retailerPrices.length; i++) {
            var entry = db.retailerPrices[i];
            btn.innerHTML = '⏳ ' + (i + 1) + '/' + total;
            try {
              var data = await fetchLivePrices(entry.partNumber);
              ['rockauto', 'oreilly', 'napa', 'autozone', 'advance', 'carquest'].forEach(function (f) {
                if (data[f] != null && Number(data[f]) > 0) { entry[f] = Number(data[f]); updated++; }
              });
              entry.lastFetched = new Date().toISOString();
              done++;
            } catch (e) { /* skip failed */ }
            // Small delay to avoid rate limiting
            await new Promise(function (r) { setTimeout(r, 500); });
          }
          saveDB(db);
          btn.disabled = false;
          btn.innerHTML = '🔄 Refresh All Live';
          toast('Refreshed ' + done + '/' + total + ' parts', 'success');
          if (typeof window.renderView === 'function') window.renderView();
        };
        addBtn.parentNode.insertBefore(btn, addBtn.nextSibling);
      }, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    enhanceAddModal();
    addRowRefreshButtons();
    addRefreshAllButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1500); });
  } else {
    setTimeout(boot, 1500);
  }

  window.pcFetchLivePrices = fetchLivePrices;
  console.log('[PriceSync] Initialized');
})();
