/* Admin Wipe — adds a server wipe button for admin users only */
(function () {
  'use strict';

  var API = 'https://parts-command-api.techguruofficial.workers.dev';

  function isAdmin() {
    try {
      if (window.PCAuth && window.PCAuth.getUser) {
        var u = window.PCAuth.getUser();
        return u && u.role === 'admin';
      }
      var raw = localStorage.getItem('partscommand_user');
      if (raw) {
        var u2 = JSON.parse(raw);
        return u2 && u2.role === 'admin';
      }
    } catch (e) {}
    return false;
  }

  function getToken() {
    try {
      if (window.PCAuth && window.PCAuth.getToken) return window.PCAuth.getToken();
      return localStorage.getItem('partscommand_token');
    } catch (e) { return null; }
  }

  async function doWipe() {
    if (!confirm('WIPE ALL SERVER DATA?\n\nThis permanently deletes all inventory, customers, vehicles, sales, invoices, and settings from the cloud database. This cannot be undone.\n\nAre you sure?')) return;
    if (!confirm('Final confirmation: wipe the entire cloud database?')) return;

    var token = getToken();
    if (!token) { alert('Not authenticated'); return; }

    try {
      var res = await fetch(API + '/admin/wipe', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      var data = await res.json();
      if (res.ok && data.success) {
        alert('Server data wiped successfully. ' + (data.wiped || []).length + ' tables cleared.');
        if (typeof showToast === 'function') showToast('Server wiped — all cloud data cleared', 'success');
      } else {
        alert('Wipe failed: ' + (data.error || res.status));
      }
    } catch (e) {
      alert('Wipe failed: ' + e.message);
    }
  }

  function addWipeButton() {
    if (!isAdmin()) return;
    if (document.getElementById('pc-wipe-btn')) return;

    // Find the Data Management section in settings
    var headers = document.querySelectorAll('h3');
    var dmHeader = null;
    headers.forEach(function (h) {
      if (h.textContent.indexOf('Data Management') !== -1) dmHeader = h;
    });
    if (!dmHeader) return;
    var card = dmHeader.closest('.glass-card');
    if (!card) return;

    var btn = document.createElement('button');
    btn.id = 'pc-wipe-btn';
    btn.type = 'button';
    btn.className = 'w-full flex items-center justify-between glass-card rounded-xl px-4 py-3 hover:border-red-500/40 transition-all group mt-2 cursor-pointer';
    btn.style.border = '1px solid rgba(239,68,68,0.3)';
    btn.style.pointerEvents = 'auto';
    btn.style.position = 'relative';
    btn.style.zIndex = '10';
    btn.innerHTML =
      '<div class="flex items-center gap-3">' +
      '<div class="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center">' +
      '<i class="ph-bold ph-trash text-red-400"></i></div>' +
      '<div class="text-left"><p class="text-sm font-medium text-red-400">Wipe Server Data</p>' +
      '<p class="text-xs text-slate-500">Permanently delete all cloud data (admin only)</p></div></div>' +
      '<i class="ph ph-warning text-red-400"></i>';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      doWipe();
    });
    // Also handle touch for mobile
    btn.addEventListener('touchend', function (e) {
      e.preventDefault();
      doWipe();
    });
    card.appendChild(btn);
  }

  // Watch for settings view
  var observer = new MutationObserver(function () {
    clearTimeout(window._pcWipeT);
    window._pcWipeT = setTimeout(addWipeButton, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(addWipeButton, 2000);
})();
