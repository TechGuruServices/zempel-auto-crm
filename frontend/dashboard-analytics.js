/**
 * Dashboard Analytics v1.0.0
 * Adds revenue trends, top parts, and busy-day insights to the dashboard.
 * Self-initializing; hooks into renderDashboard via MutationObserver.
 */
(function () {
  'use strict';

  function getDB() {
    try {
      if (typeof window.getDB === 'function') return window.getDB();
      var raw = localStorage.getItem('partscommand_db');
      return raw ? JSON.parse(raw) : { sales: [], inventory: [] };
    } catch (e) { return { sales: [], inventory: [] }; }
  }

  function parseDate(s) {
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function weekKey(d) {
    var monday = new Date(d);
    var day = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - day);
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString().slice(0, 10);
  }

  function computeAnalytics() {
    var db = getDB();
    var sales = db.sales || [];

    // Revenue by week (last 8 weeks)
    var weeks = {};
    var now = new Date();
    for (var i = 0; i < 8; i++) {
      var d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      weeks[weekKey(d)] = 0;
    }
    // Top parts
    var partSales = {};
    // Sales by weekday
    var weekdaySales = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    var weekdayCount = [0, 0, 0, 0, 0, 0, 0];

    sales.forEach(function (s) {
      var d = parseDate(s.date || s.createdAt || s.timestamp);
      var total = Number(s.total) || 0;
      if (d) {
        var wk = weekKey(d);
        if (wk in weeks) weeks[wk] += total;
        weekdaySales[d.getDay()] += total;
        weekdayCount[d.getDay()]++;
      }
      // Parts from sale items
      var items = s.items || s.parts || [];
      items.forEach(function (it) {
        var name = it.name || it.partNumber || 'Unknown';
        var qty = Number(it.quantity || it.qty || 1);
        partSales[name] = (partSales[name] || 0) + qty;
      });
    });

    var weekLabels = Object.keys(weeks).sort();
    var weekValues = weekLabels.map(function (k) { return weeks[k]; });

    var topParts = Object.entries(partSales)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 5)
      .map(function (e) { return { name: e[0], qty: e[1] }; });

    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var busyDays = dayNames.map(function (n, i) {
      return { day: n, revenue: weekdaySales[i], count: weekdayCount[i] };
    }).sort(function (a, b) { return b.revenue - a.revenue; });

    return { weeks: { labels: weekLabels, values: weekValues }, topParts: topParts, busyDays: busyDays };
  }

  function barChart(values, labels) {
    var max = Math.max.apply(null, values.concat([1]));
    var bars = values.map(function (v, i) {
      var h = Math.max(5, Math.round((v / max) * 96));
      var isMax = v === max && v > 0;
      var title = labels[i] + ': $' + v.toFixed(0);
      var barBg = isMax
        ? 'linear-gradient(180deg,#7db4ff 0%,#2563eb 100%)'
        : 'linear-gradient(180deg,rgba(125,180,255,0.9) 0%,rgba(37,99,235,0.5) 100%)';
      var glow = isMax ? 'box-shadow:0 0 18px rgba(59,130,246,0.6);'
                       : 'box-shadow:0 0 8px rgba(59,130,246,0.25);';
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;min-width:0;" title="' + title + '">' +
        '<div style="width:100%;max-width:34px;height:' + h + 'px;background:' + barBg + ';' + glow +
        'border-radius:8px 8px 3px 3px;border:1px solid rgba(147,197,253,0.35);border-bottom:none;"></div>' +
        '<span style="font-size:10px;font-weight:600;color:' + C.label + ';letter-spacing:0.02em;">' + labels[i].slice(5) + '</span></div>';
    }).join('');
    return '<div style="display:flex;align-items:flex-end;gap:8px;height:132px;padding:6px 2px 0;">' + bars + '</div>';
  }

  function renderAnalytics() {
    var light = document.documentElement.classList.contains('light-mode');
    var C = light ? {
      title:'#0f172a', sub:'rgba(100,116,139,0.95)', header:'#334155',
      name:'#0f172a', qty:'#0f172a', empty:'#94a3b8', divider:'rgba(203,213,225,0.7)',
      label:'#64748b', medal:['#b45309','#475569','#a16207']
    } : {
      title:'#ffffff', sub:'rgba(148,163,184,0.9)', header:'#cbd5e1',
      name:'#e2e8f0', qty:'#ffffff', empty:'#64748b', divider:'rgba(255,255,255,0.07)',
      label:'#94a3b8', medal:['#fcd34d','#e2e8f0','#f59e0b']
    };
    // Find dashboard element
    var dash = document.getElementById('mainContent');
    // Only inject on the dashboard view — never on other pages (Settings About cards use .metric-card too)
    if (!dash || document.getElementById('pc-analytics')) return;
    if (window.currentView !== 'dashboard') return;
    // Verify dashboard-specific content: cards enhanced by dashboard-links.js
    if (!dash.querySelector('.metric-card[data-linked]')) return;

    var a = computeAnalytics();
    if (a.weeks.values.every(function (v) { return v === 0; }) && a.topParts.length === 0) return;

    var section = document.createElement('div');
    section.id = 'pc-analytics';
    section.className = 'glass-frost p-5 md:p-6 mt-4';
    section.innerHTML =
      '<div class="flex items-center gap-3 mb-1">' +
      '<span class="mc-icon-badge blue" style="width:38px;height:38px;border-radius:12px;">' +
      '<i class="ph-bold ph-chart-bar text-xl"></i></span>' +
      '<div><h3 class="text-base font-bold" style="letter-spacing:-0.01em;color:' + C.title + ';">Sales Analytics</h3>' +
      '<p class="text-xs" style="color:' + C.sub + ';">Performance at a glance</p></div></div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">' +
      '<div><p class="text-[11px] font-bold mb-3" style="color:' + C.header + ';letter-spacing:0.08em;">REVENUE &middot; LAST 8 WEEKS</p>' +
      barChart(a.weeks.values, a.weeks.labels) + '</div>' +
      '<div><p class="text-[11px] font-bold mb-2" style="color:' + C.header + ';letter-spacing:0.08em;">TOP SELLING PARTS</p>' +
      (a.topParts.length ? a.topParts.map(function (p, i) {
        var medal = C.medal[i] || '#7d8aa0';
        return '<div class="flex items-center gap-3 py-2.5" style="border-bottom:1px solid ' + C.divider + ';">' +
          '<span style="width:26px;height:26px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;' +
          'font-size:11px;font-weight:800;color:#0f172a;background:linear-gradient(135deg,' + medal + ',rgba(255,255,255,0.65));' +
          'box-shadow:0 2px 8px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.5);">' + (i + 1) + '</span>' +
          '<span class="text-sm flex-1 truncate" style="color:' + C.name + ';">' + escapeHtml(p.name) + '</span>' +
          '<span class="text-sm font-bold" style="color:' + C.qty + ';">' + p.qty +
          ' <span class="font-normal" style="color:#94a3b8;">sold</span></span></div>';
      }).join('') : '<p class="text-sm py-4 text-center" style="color:' + C.empty + ';">No part sales yet</p>') +
      '</div></div>' +
      (a.busyDays[0] && a.busyDays[0].revenue > 0 ?
        '<div class="mt-4 flex items-center gap-2 text-xs" style="color:#94a3b8;">' +
        '<i class="ph-bold ph-fire text-base" style="color:#fb923c;text-shadow:0 0 12px rgba(251,146,60,0.7);"></i>' +
        '<span>Busiest day:</span> <span class="font-semibold" style="color:' + C.title + ';">' + a.busyDays[0].day + '</span>' +
        '<span style="color:#475569;">&middot;</span><span>$' + a.busyDays[0].revenue.toFixed(0) + ' revenue</span></div>' : '');

    // Insert after metrics grid
    var metrics = dash.querySelector('.grid');
    if (metrics && metrics.nextSibling) {
      metrics.parentNode.insertBefore(section, metrics.nextSibling.nextSibling);
    } else {
      dash.appendChild(section);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Watch for dashboard renders
  var observer = new MutationObserver(function () {
    if (!document.getElementById('pc-analytics')) {
      // Debounce
      clearTimeout(window._pcAnalyticsT);
      window._pcAnalyticsT = setTimeout(renderAnalytics, 500);
    }
  });

  function boot() {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(renderAnalytics, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.pcAnalytics = { render: renderAnalytics, compute: computeAnalytics };
})();
