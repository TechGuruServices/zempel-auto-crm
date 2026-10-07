/**
 * Database Backup v1.0.0
 * One-click full database export as JSON. Adds button to Settings.
 */
(function () {
  'use strict';

  function getDB() {
    try {
      if (typeof window.getDB === 'function') return window.getDB();
      var raw = localStorage.getItem('partscommand_db');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function exportFullBackup() {
    var db = getDB();
    if (!db) {
      if (typeof window.showToast === 'function') window.showToast('No data to export', 'warning');
      return;
    }
    var backup = {
      exportedAt: new Date().toISOString(),
      app: 'Zempel Auto CRM',
      version: '1.0',
      data: db
    };
    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'zempel-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    if (typeof window.showToast === 'function') window.showToast('Full backup downloaded', 'success');
  }

  function injectButton() {
    // Find settings export section; add backup button if not present
    if (document.getElementById('pc-backup-btn')) return;
    var settingsBtns = document.querySelectorAll('button[onclick*="export"]');
    if (!settingsBtns.length) { setTimeout(injectButton, 3000); return; }

    var btn = document.createElement('button');
    btn.id = 'pc-backup-btn';
    btn.className = 'w-full flex items-center justify-between glass-card rounded-xl px-4 py-3 hover:border-purple-400/40 transition-all group';
    btn.innerHTML = '<span class="flex items-center gap-3"><span class="text-purple-400">💾</span>' +
      '<span class="text-left"><span class="block text-sm font-medium text-white">Full Database Backup</span>' +
      '<span class="block text-xs text-slate-400">Download all data as JSON</span></span></span>' +
      '<span class="text-slate-500">→</span>';
    btn.addEventListener('click', exportFullBackup);

    // Insert after last export button's parent
    var last = settingsBtns[settingsBtns.length - 1];
    if (last.parentNode) last.parentNode.appendChild(btn);
  }

  window.pcExportBackup = exportFullBackup;

  // Try to inject when settings view renders
  var observer = new MutationObserver(function () {
    if (!document.getElementById('pc-backup-btn')) {
      clearTimeout(window._pcBackupT);
      window._pcBackupT = setTimeout(injectButton, 800);
    }
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

  console.log('[DBBackup] Initialized');
})();
