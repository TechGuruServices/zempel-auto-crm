/* PartsCommand — UI Refresh (2026-10)
 * - Replaces the dashboard renderer (renderDashboard) with the new shop-floor dashboard
 * - Keeps header title / body[data-view] in sync with navigation
 * - Adds instant filtering to RockAuto lists (makes / models / categories)
 * Loaded after the inline app script and all feature modules.
 * No inline handlers — everything is wired with addEventListener / delegation.
 */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function money(n, d) {
    return '$' + num(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function compact(n) {
    n = num(n);
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return '$' + Math.round(n);
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(offset) {
    var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (offset || 0));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function keyToDate(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function rel(dateStr) {
    var k = String(dateStr || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return '';
    var diff = Math.round((keyToDate(dayKey(0)) - keyToDate(k)) / 864e5);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return diff + ' days ago';
    return keyToDate(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function fn(name) { return typeof window[name] === 'function' ? window[name] : null; }
  function totalsOf(inv) {
    var t = fn('_invTotals');
    if (t) { try { return t(inv).total; } catch (e) { /* fall through */ } }
    var parts = (inv.lineItems || []).reduce(function (s, l) { return s + num(l.qty) * num(l.unitPrice); }, 0);
    var labor = (inv.laborItems || []).reduce(function (s, l) { return s + num(l.hours) * num(l.rate); }, 0);
    var base = Math.max(0, parts + labor - num(inv.discount));
    return base * (1 + num(inv.taxRate) / 100);
  }
  function bizName() {
    try { var s = typeof getAppSettings === 'function' ? getAppSettings() : null; if (s && s.bizName) return s.bizName; } catch (e) { /* noop */ }
    return 'Zempel Auto';
  }

  // ---------- count-up ----------
  function countUp(root) {
    root.querySelectorAll('[data-count]').forEach(function (el) {
      var to = num(el.getAttribute('data-count')), fmt = el.getAttribute('data-fmt') || 'int';
      var show = function (v) {
        el.textContent = fmt === 'money' ? money(v) : fmt === 'pct' ? v.toFixed(1) + '%' : Math.round(v).toLocaleString('en-US');
      };
      if (REDUCED || to === 0) { show(to); return; }
      var t0 = null, dur = 1000;
      show(0);
      (function step(ts) {
        if (!el.isConnected) return;
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 4);
        show(to * e);
        if (p < 1) requestAnimationFrame(step); else show(to);
      })(performance.now());
    });
  }

  // ---------- svg helpers ----------
  function smooth(pts, top, bottom) {
    if (pts.length < 3) return 'M' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join('L');
    var d = 'M' + pts[0][0] + ',' + pts[0][1], t = 0.17;
    var clampY = function (y) { return Math.max(top, Math.min(bottom, y)); };
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += 'C' + (p1[0] + (p2[0] - p0[0]) * t) + ',' + clampY(p1[1] + (p2[1] - p0[1]) * t) + ' ' +
        (p2[0] - (p3[0] - p1[0]) * t) + ',' + clampY(p2[1] - (p3[1] - p1[1]) * t) + ' ' + p2[0] + ',' + p2[1];
    }
    return d;
  }
  function niceMax(v) {
    if (v <= 0) return 100;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function drawChart(host, labels, values) {
    var W = Math.max(280, host.clientWidth), H = Math.max(180, host.clientHeight);
    var padL = 46, padR = 14, padT = 14, padB = 30;
    var max = niceMax(Math.max.apply(null, values.concat([1])));
    var iw = W - padL - padR, ih = H - padT - padB, n = values.length;
    var X = function (i) { return padL + (n === 1 ? iw / 2 : (iw * i) / (n - 1)); };
    var Y = function (v) { return padT + ih - (v / max) * ih; };
    var pts = values.map(function (v, i) { return [+X(i).toFixed(1), +Y(v).toFixed(1)]; });
    var line = smooth(pts, padT, padT + ih);
    var area = line + 'L' + pts[n - 1][0] + ',' + (padT + ih) + 'L' + pts[0][0] + ',' + (padT + ih) + 'Z';
    var every = n > 10 ? Math.ceil(n / (W < 500 ? 4 : 7)) : 1;
    var grid = [0, 0.5, 1].map(function (f) {
      var y = padT + ih - ih * f;
      return '<line class="grid-line" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>' +
        '<text class="axis" x="' + (padL - 10) + '" y="' + (y + 4) + '" text-anchor="end">' + (f === 0 ? '$0' : compact(max * f)) + '</text>';
    }).join('');
    var xl = labels.map(function (l, i) {
      return (i % every === 0 || i === n - 1) ? '<text class="axis" x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(l) + '</text>' : '';
    }).join('');
    host.innerHTML =
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Revenue trend chart">' +
      '<defs>' +
      '<linearGradient id="chartStroke" x1="0" x2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>' +
      '<linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82f6" stop-opacity=".30"/><stop offset="1" stop-color="#06b6d4" stop-opacity="0"/></linearGradient>' +
      '</defs>' + grid + xl +
      '<path class="area" d="' + area + '"/>' +
      '<path class="line" pathLength="1" d="' + line + '"/>' +
      '<line class="cursor" y1="' + padT + '" y2="' + (padT + ih) + '"/>' +
      '<circle class="dot" r="5.5"/>' +
      '<rect x="' + padL + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent"/>' +
      '</svg><div class="chart-tip"></div>';
    var svg = host.querySelector('svg'), cur = svg.querySelector('.cursor'), dot = svg.querySelector('.dot'), tip = host.querySelector('.chart-tip');
    function at(ev) {
      var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * (W / r.width);
      var i = Math.max(0, Math.min(n - 1, Math.round(((x - padL) / iw) * (n - 1))));
      cur.setAttribute('x1', pts[i][0]); cur.setAttribute('x2', pts[i][0]); cur.style.opacity = 1;
      dot.setAttribute('cx', pts[i][0]); dot.setAttribute('cy', pts[i][1]); dot.style.opacity = 1;
      tip.innerHTML = '<small>' + esc(labels[i]) + '</small>' + money(values[i]);
      tip.style.left = (pts[i][0] * (r.width / W)) + 'px';
      tip.style.top = (pts[i][1] * (r.height / H)) + 'px';
      tip.style.opacity = 1;
    }
    function off() { cur.style.opacity = 0; dot.style.opacity = 0; tip.style.opacity = 0; }
    svg.addEventListener('pointermove', at);
    svg.addEventListener('pointerdown', at);
    svg.addEventListener('pointerleave', off);
  }

  function sparkSvg(values) {
    var W = 200, H = 64, n = values.length, max = Math.max.apply(null, values.concat([1]));
    var pts = values.map(function (v, i) { return [+(i * (W / (n - 1))).toFixed(1), +(H - 8 - (v / max) * (H - 18)).toFixed(1)]; });
    var line = smooth(pts, 4, H - 4);
    return '<svg class="kpi-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><defs>' +
      '<linearGradient id="sparkStroke" x1="0" x2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#34d399"/></linearGradient>' +
      '<linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34d399" stop-opacity=".22"/><stop offset="1" stop-color="#34d399" stop-opacity="0"/></linearGradient></defs>' +
      '<path class="area" d="' + line + 'L' + W + ',' + H + 'L0,' + H + 'Z"/><path class="line" pathLength="1" d="' + line + '"/></svg>';
  }

  // ---------- dashboard ----------
  function compute() {
    var db = getDB();
    var sales = db.sales || [], inv = db.inventory || [], invoices = db.invoices || [];
    var done = sales.filter(function (s) { return String(s.status).toLowerCase() === 'completed'; });
    var open = sales.filter(function (s) { return String(s.status).toLowerCase() === 'pending'; });
    var byDay = {};
    done.forEach(function (s) { var k = String(s.date || '').slice(0, 10); byDay[k] = (byDay[k] || 0) + num(s.total); });
    var sumRange = function (from, to) { var t = 0; for (var i = from; i <= to; i++) t += byDay[dayKey(i)] || 0; return t; };
    var last30 = sumRange(0, 29), prev30 = sumRange(30, 59);
    var delta = prev30 > 0 ? ((last30 - prev30) / prev30) * 100 : null;
    var daily14 = [], dLabels14 = [];
    for (var i = 13; i >= 0; i--) { daily14.push(byDay[dayKey(i)] || 0); dLabels14.push(keyToDate(dayKey(i)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })); }
    var spark = []; for (var j = 29; j >= 0; j--) spark.push(byDay[dayKey(j)] || 0);
    var weekly = [], wLabels = [];
    for (var w = 7; w >= 0; w--) {
      weekly.push(sumRange(w * 7, w * 7 + 6));
      wLabels.push(keyToDate(dayKey(w * 7 + 6)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }
    var allTime = done.reduce(function (s, x) { return s + num(x.total); }, 0);
    var margins = done.filter(function (s) { return num(s.margin) > 0; });
    var avgMargin = margins.length ? margins.reduce(function (s, x) { return s + num(x.margin); }, 0) / margins.length : 0;
    var avgTicket = done.length ? allTime / done.length : 0;
    var wd = [0, 0, 0, 0, 0, 0, 0];
    done.forEach(function (s) { var d = keyToDate(String(s.date).slice(0, 10)); if (!isNaN(d)) wd[d.getDay()] += num(s.total); });
    var names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var best = wd.indexOf(Math.max.apply(null, wd));
    var low = inv.filter(function (i) { return num(i.stock) <= num(i.minStock); })
      .sort(function (a, b) { return (num(a.stock) / Math.max(1, num(a.minStock))) - (num(b.stock) / Math.max(1, num(b.minStock))); });
    var units = inv.reduce(function (s, i) { return s + num(i.stock); }, 0);
    var todayK = dayKey(0);
    var unpaid = invoices.filter(function (i) { return i.status === 'sent' || i.status === 'overdue'; });
    var unpaidVal = unpaid.reduce(function (s, i) { return s + totalsOf(i); }, 0);
    var overdue = invoices.filter(function (i) {
      if (i.status === 'paid' || i.status === 'void' || i.status === 'draft') return false;
      return i.status === 'overdue' || (i.dueDate && String(i.dueDate).slice(0, 10) < todayK);
    });
    var partQty = {};
    sales.forEach(function (s) { (s.lineItems || []).forEach(function (li) { var k = li.name || li.partNumber; if (k) partQty[k] = (partQty[k] || 0) + num(li.qty); }); });
    var top = Object.keys(partQty).map(function (k) { return { name: k, qty: partQty[k] }; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
    var byDate = function (a, b) { return String(b.date).localeCompare(String(a.date)); };
    return {
      db: db, done: done.slice().sort(byDate), open: open.slice().sort(byDate), last30: last30, delta: delta, spark: spark,
      daily14: daily14, dLabels14: dLabels14, weekly: weekly, wLabels: wLabels, allTime: allTime, avgMargin: avgMargin, avgTicket: avgTicket,
      bestDay: wd[best] > 0 ? names[best] : '—', low: low, units: units, partsCount: inv.length, unpaid: unpaid, unpaidVal: unpaidVal,
      overdue: overdue, top: top, openVal: open.reduce(function (s, x) { return s + num(x.total); }, 0)
    };
  }

  function custName(db, id) { var c = (db.customers || []).find(function (x) { return x.id === id; }); return c ? c.name : 'Walk-in customer'; }
  function vehName(db, id) { var v = (db.vehicles || []).find(function (x) { return x.id === id; }); return v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : ''; }

  var TILES = [
    ['estimate', 'blue', 'ph-file-plus', 'New estimate', 'Quote a job'],
    ['quicksale', 'green', 'ph-lightning', 'Quick sale', 'Counter ticket'],
    ['scan', 'amber', 'ph-barcode', 'Scan part', 'Lookup by barcode'],
    ['customer', 'violet', 'ph-user-plus', 'Add customer', 'New client'],
    ['invoice', 'cyan', 'ph-receipt', 'New invoice', 'Bill a job'],
    ['catalog', 'rose', 'ph-wrench', 'Parts catalog', 'Find by vehicle']
  ];

  function renderDashboard(el) {
    var a = compute(), db = a.db, h = new Date().getHours();
    var greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    var i = 0, step = function () { return 'style="--i:' + (i++) + '"'; };
    var deltaChip = a.delta == null ? '<span class="chip flat">30-day total</span>' :
      '<span class="chip ' + (a.delta >= 0 ? 'up' : 'down') + '"><i class="ph-bold ' + (a.delta >= 0 ? 'ph-trend-up' : 'ph-trend-down') + '"></i>' + Math.abs(a.delta).toFixed(0) + '%</span><span>vs prior 30 days</span>';

    var openRows = a.open.slice(0, 5).map(function (s) {
      var v = vehName(db, s.vehicleId), cn = custName(db, s.customerId), n = (s.lineItems || []).length;
      return '<button type="button" class="row" data-sale="' + esc(s.id) + '"><span class="avatar amber">' + esc(initials(cn)) + '</span>' +
        '<span class="main"><strong>' + esc(cn) + '</strong><span>' + esc([v, n + (n === 1 ? ' item' : ' items'), rel(s.date)].filter(Boolean).join(' · ')) + '</span></span>' +
        '<span class="end"><strong>' + money(s.total, 2) + '</strong><span>Pending</span></span></button>';
    }).join('');
    var lowRows = a.low.slice(0, 6).map(function (p) {
      var ratio = Math.min(1, num(p.stock) / Math.max(1, num(p.minStock))), crit = num(p.stock) <= 3 || ratio < .4;
      return '<button type="button" class="row" data-part="' + esc(p.id) + '"><span class="avatar ' + (crit ? 'red' : 'amber') + '"><i class="ph-bold ph-package"></i></span>' +
        '<span class="main"><strong>' + esc(p.name) + '</strong><span>' + esc(p.partNumber) + ' · min ' + num(p.minStock) + '</span><div class="bar-track"><div class="bar-fill ' + (crit ? 'bad' : 'warn') + '" style="width:' + Math.max(6, ratio * 100) + '%"></div></div></span>' +
        '<span class="end"><strong>' + num(p.stock) + '</strong><span>left</span></span></button>';
    }).join('');
    var recent = a.done.slice(0, 5).map(function (s) {
      var cn = custName(db, s.customerId);
      return '<button type="button" class="row" data-sale="' + esc(s.id) + '"><span class="avatar green">' + esc(initials(cn)) + '</span>' +
        '<span class="main"><strong>' + esc(cn) + '</strong><span>' + esc([vehName(db, s.vehicleId), rel(s.date)].filter(Boolean).join(' · ')) + '</span></span>' +
        '<span class="end"><strong class="money">' + money(s.total, 2) + '</strong></span></button>';
    }).join('');
    var topMax = a.top.length ? a.top[0].qty : 1;
    var topRows = a.top.map(function (t, k) {
      return '<div class="row" style="cursor:default"><span class="avatar violet">' + (k + 1) + '</span><span class="main"><strong>' + esc(t.name) + '</strong><div class="bar-track"><div class="bar-fill blue" style="width:' + Math.max(8, (t.qty / topMax) * 100) + '%"></div></div></span><span class="end"><strong>' + t.qty + '</strong><span>sold</span></span></div>';
    }).join('');

    el.innerHTML =
      '<div class="dx" data-view="dashboard">' +
      '<section class="dx-hero" ' + step() + '>' +
        '<div style="position:relative;z-index:1"><div class="dx-eyebrow">' + new Date().toLocaleDateString('en-US', { weekday: 'long' }) + '</div>' +
        '<h2 class="dx-greet">' + greet + ', <b>' + esc(bizName()) + '</b></h2>' +
        '<div class="dx-status">' +
          '<button type="button" class="dx-pill info" data-go="sales"><i class="ph-bold ph-wrench"></i><b>' + a.open.length + '</b> open ' + (a.open.length === 1 ? 'job' : 'jobs') + '</button>' +
          '<button type="button" class="dx-pill ' + (a.low.length ? 'warn' : 'ok') + '" data-go="lowstock"><i class="ph-bold ph-' + (a.low.length ? 'warning' : 'check-circle') + '"></i><b>' + a.low.length + '</b> low stock</button>' +
          '<button type="button" class="dx-pill ' + (a.overdue.length ? 'bad' : 'ok') + '" data-go="invoices"><i class="ph-bold ph-' + (a.overdue.length ? 'clock-countdown' : 'check-circle') + '"></i><b>' + a.overdue.length + '</b> overdue ' + (a.overdue.length === 1 ? 'invoice' : 'invoices') + '</button>' +
        '</div></div>' +
        '<div class="dx-time"><div class="dx-clock" id="digitalClock">' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</div>' +
        '<div class="dx-date">' + new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + '</div></div>' +
      '</section>' +

      '<section class="dx-actions" ' + step() + '>' + TILES.map(function (t) {
        return '<button type="button" class="dx-tile" data-act="' + t[0] + '"><span class="dx-ico ' + t[1] + '"><i class="ph-bold ' + t[2] + '"></i></span><span><strong>' + t[3] + '</strong><small>' + t[4] + '</small></span></button>';
      }).join('') + '</section>' +

      '<section class="dx-kpis" ' + step() + '>' +
        '<button type="button" class="kpi" data-go="sales">' + sparkSvg(a.spark) +
          '<div class="kpi-top"><span class="kpi-label"><span class="dx-ico green"><i class="ph-bold ph-currency-dollar"></i></span>Revenue · 30 days</span></div>' +
          '<div class="kpi-val" data-count="' + a.last30 + '" data-fmt="money">' + money(a.last30) + '</div>' +
          '<div class="kpi-sub">' + deltaChip + '</div></button>' +
        '<button type="button" class="kpi" data-go="sales"><div class="kpi-top"><span class="kpi-label"><span class="dx-ico blue"><i class="ph-bold ph-wrench"></i></span>Open jobs</span></div>' +
          '<div class="kpi-val" data-count="' + a.open.length + '">' + a.open.length + '</div>' +
          '<div class="kpi-sub"><span class="chip flat">' + money(a.openVal) + '</span><span>in pending estimates</span></div></button>' +
        '<button type="button" class="kpi" data-go="invoices"><div class="kpi-top"><span class="kpi-label"><span class="dx-ico cyan"><i class="ph-bold ph-receipt"></i></span>Unpaid invoices</span></div>' +
          '<div class="kpi-val" data-count="' + a.unpaidVal + '" data-fmt="money">' + money(a.unpaidVal) + '</div>' +
          '<div class="kpi-sub">' + (a.overdue.length ? '<span class="chip warn">' + a.overdue.length + ' overdue</span>' : '<span class="chip up">All current</span>') + '<span>' + a.unpaid.length + ' outstanding</span></div></button>' +
        '<button type="button" class="kpi" data-go="lowstock"><div class="kpi-top"><span class="kpi-label"><span class="dx-ico amber"><i class="ph-bold ph-package"></i></span>Low stock</span></div>' +
          '<div class="kpi-val" data-count="' + a.low.length + '">' + a.low.length + '</div>' +
          '<div class="kpi-sub"><span>' + a.partsCount + ' parts · ' + a.units.toLocaleString('en-US') + ' units on hand</span></div></button>' +
      '</section>' +

      '<div class="dx-main" ' + step() + '>' +
        '<div class="dx-col">' +
          '<section class="panel" id="pc-analytics"><div class="panel-head"><div class="panel-title"><i class="ph-bold ph-chart-line-up"></i>Revenue trend</div>' +
            '<div class="seg" role="tablist"><button type="button" class="seg-btn active" data-range="14d">14 days</button><button type="button" class="seg-btn" data-range="8w">8 weeks</button></div></div>' +
            '<div class="chart-wrap" id="dxChart"></div>' +
            '<div class="mini-stats"><div><label>Avg ticket</label><strong>' + money(a.avgTicket, 2) + '</strong></div><div><label>Avg margin</label><strong>' + a.avgMargin.toFixed(1) + '%</strong></div><div><label>Best day</label><strong>' + a.bestDay + '</strong></div></div></section>' +
          '<section class="panel"><div class="panel-head"><div class="panel-title"><i class="ph-bold ph-wrench"></i>Open jobs</div><button type="button" class="panel-link" data-go="sales">View all<i class="ph-bold ph-caret-right"></i></button></div>' +
            '<div class="rows">' + (openRows || '<div class="empty"><i class="ph-bold ph-check-circle"></i>No open jobs — you\'re all caught up</div>') + '</div></section>' +
        '</div>' +
        '<div class="dx-col">' +
          '<section class="panel"><div class="panel-head"><div class="panel-title"><i class="ph-bold ph-warning"></i>Needs restocking</div><button type="button" class="panel-link" data-go="lowstock">All ' + a.low.length + '<i class="ph-bold ph-caret-right"></i></button></div>' +
            '<div class="rows">' + (lowRows || '<div class="empty"><i class="ph-bold ph-check-circle"></i>All stock levels healthy</div>') + '</div></section>' +
          '<section class="panel"><div class="panel-head"><div class="panel-title"><i class="ph-bold ph-clock-counter-clockwise"></i>Recent sales</div></div>' +
            '<div class="rows">' + (recent || '<div class="empty">No completed sales yet</div>') + '</div></section>' +
        '</div>' +
      '</div>' +
      (a.top.length ? '<section class="panel" ' + step() + '><div class="panel-head"><div class="panel-title"><i class="ph-bold ph-trophy"></i>Top selling parts</div></div><div class="rows">' + topRows + '</div></section>' : '') +
      '</div>';

    var root = el.querySelector('.dx');
    countUp(root);

    // chart + range switch
    var host = root.querySelector('#dxChart'), range = '14d';
    var paint = function () {
      if (!host.isConnected) return;
      range === '14d' ? drawChart(host, a.dLabels14, a.daily14) : drawChart(host, a.wLabels, a.weekly);
    };
    paint();
    if (window.ResizeObserver) {
      var last = host.clientWidth, t;
      new ResizeObserver(function () {
        if (!host.isConnected) return;
        if (Math.abs(host.clientWidth - last) < 4) return;
        last = host.clientWidth; clearTimeout(t); t = setTimeout(paint, 120);
      }).observe(host);
    }

    // delegation for everything clickable on the dashboard
    root.addEventListener('click', function (ev) {
      var seg = ev.target.closest('[data-range]');
      if (seg) {
        range = seg.getAttribute('data-range');
        root.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.toggle('active', b === seg); });
        paint(); return;
      }
      var t = ev.target.closest('[data-act],[data-go],[data-sale],[data-part]');
      if (!t) return;
      var act = t.getAttribute('data-act'), go = t.getAttribute('data-go');
      if (act) {
        var map = {
          estimate: function () { fn('openNewEstimate') && openNewEstimate(); },
          quicksale: function () { fn('pcQuickSale') ? pcQuickSale() : (fn('openNewEstimate') && openNewEstimate()); },
          scan: function () { fn('openBarcodeScanner') && openBarcodeScanner(); },
          customer: function () { fn('openAddCustomerModal') && openAddCustomerModal(); },
          invoice: function () { fn('openInvoiceEditor') && openInvoiceEditor(null); },
          catalog: function () { navigate('rockauto'); }
        };
        map[act] && map[act]();
      } else if (go === 'lowstock') {
        navigate('inventory');
        var tries = 0, setLow = function () {
          var f = document.getElementById('stockFilter');
          if (f) { f.value = 'low'; f.dispatchEvent(new Event('change', { bubbles: true })); }
          else if (tries++ < 10) setTimeout(setLow, 80);
        };
        setTimeout(setLow, 60);
      } else if (go) {
        navigate(go);
      } else if (t.hasAttribute('data-sale')) {
        fn('openSaleDetail') && openSaleDetail(t.getAttribute('data-sale'));
      } else if (t.hasAttribute('data-part')) {
        fn('openPartDetail') && openPartDetail(t.getAttribute('data-part'));
      }
    });
  }

  // ---------- navigation sync: titles, body[data-view], scroll-linked header title ----------
  var TITLES = {
    dashboard: 'Dashboard', inventory: 'Inventory', customers: 'Customers', vehicles: 'Vehicles', rockauto: 'RockAuto Catalog',
    sales: 'Sales & Estimates', comparison: 'Price Comparison', invoices: 'Invoices', audit: 'Audit Logs', settings: 'Settings'
  };
  function syncShell() {
    try {
      document.body.setAttribute('data-view', currentView);
      var t = document.getElementById('pageTitle');
      if (t) t.textContent = TITLES[currentView] || 'PartsCommand';
      var m = document.getElementById('mainContent');
      if (m) m.scrollTop = 0;
      document.body.classList.remove('scrolled-main');
    } catch (e) { /* currentView not ready yet */ }
  }
  var _renderView = window.renderView;
  if (typeof _renderView === 'function') {
    window.renderView = function () {
      var r = _renderView.apply(this, arguments);
      syncShell();
      return r;
    };
  }
  window.renderDashboard = renderDashboard;

  document.addEventListener('DOMContentLoaded', function () {
    var m = document.getElementById('mainContent'), ticking = false;
    if (m) m.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () { document.body.classList.toggle('scrolled-main', m.scrollTop > 70); ticking = false; });
    }, { passive: true });
    syncShell();
  });

  // ---------- RockAuto: instant filter for long lists ----------
  var raBusy = false;
  function raEnhance() {
    if (raBusy) return; raBusy = true;
    requestAnimationFrame(function () {
      raBusy = false;
      var content = document.getElementById('rockauto-content');
      if (!content) return;
      var list = content.querySelector('ul.rockauto-makes-list,ul.rockauto-models-list,ul.rockauto-categories-list');
      if (!list || list.dataset.filtered) return;
      list.dataset.filtered = '1';
      var label = list.className.indexOf('makes') > -1 ? 'makes' : list.className.indexOf('models') > -1 ? 'models' : 'categories';
      var box = document.createElement('div');
      box.className = 'ra-filter';
      box.innerHTML = '<i class="ph ph-magnifying-glass"></i><input type="search" inputmode="search" autocomplete="off" placeholder="Type to filter ' + label + '…" aria-label="Filter ' + label + '">';
      list.parentNode.insertBefore(box, list);
      var input = box.querySelector('input');
      input.addEventListener('input', function () {
        var q = input.value.trim().toLowerCase();
        list.querySelectorAll('li').forEach(function (li) { li.style.display = !q || li.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none'; });
      });
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    var m = document.getElementById('mainContent');
    if (m && window.MutationObserver) new MutationObserver(raEnhance).observe(m, { childList: true, subtree: true });
  });
})();
