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

  function barChart(values, labels, color) {
    var max = Math.max.apply(null, values.concat([1]));
    var bars = values.map(function (v, i) {
      var h = Math.round((v / max) * 60);
      var title = labels[i] + ': $' + v.toFixed(0);
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;" title="' + title + '">' +
        '<div style="width:100%;max-width:28px;height:' + h + 'px;background:' + color + ';border-radius:4px 4px 0 0;min-height:3px;"></div>' +
        '<span style="font-size:9px;color:#64748b;">' + labels[i].slice(5) + '</span></div>';
    }).join('');
    return '<div style="display:flex;align-items:flex-end;gap:4px;height:90px;">' + bars + '</div>';
  }

  function renderAnalytics() {
    // Find dashboard element
    var dash = document.querySelector('[data-view="dashboard"], #dashboard-view, main');
    if (!dash || document.getElementById('pc-analytics')) return;

    var a = computeAnalytics();
    if (a.weeks.values.every(function (v) { return v === 0; }) && a.topParts.length === 0) return;

    var section = document.createElement('div');
    section.id = 'pc-analytics';
    section.className = 'glass-card rounded-xl p-5 mt-4';
    section.innerHTML =
      '<h3 class="text-sm font-semibold text-white mb-4 flex items-center gap-2">' +
      '<span>📊</span> Sales Analytics</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-6">' +
      '<div><p class="text-xs text-slate-400 mb-2">Revenue — last 8 weeks</p>' +
      barChart(a.weeks.values, a.weeks.labels, 'linear-gradient(180deg,#3b82f6,#1d4ed8)') + '</div>' +
      '<div><p class="text-xs text-slate-400 mb-2">Top selling parts</p>' +
      (a.topParts.length ? a.topParts.map(function (p, i) {
        return '<div class="flex justify-between text-sm py-1.5 border-b border-slate-700/30">' +
          '<span class="text-slate-300">' + (i + 1) + '. ' + escapeHtml(p.name) + '</span>' +
          '<span class="text-white font-medium">' + p.qty + ' sold</span></div>';
      }).join('') : '<p class="text-slate-500 text-sm">No part sales yet</p>') +
      '</div></div>' +
      (a.busyDays[0] && a.busyDays[0].revenue > 0 ?
        '<p class="text-xs text-slate-400 mt-4">🔥 Busiest day: <span class="text-white font-medium">' +
        a.busyDays[0].day + '</span> ($' + a.busyDays[0].revenue.toFixed(0) + ' revenue)</p>' : '');

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
