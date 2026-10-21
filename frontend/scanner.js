/* PartsCommand — Unified Scanner (2026-10-20)
 *
 * ONE barcode scanner for the whole app. Before this module there were three
 * separate camera pipelines in index.html (a modal scanner, a second scanner
 * inside the Add Part form, and a raw-getUserMedia OCR camera), each with its
 * own instance, globals, and stop logic — which is why scanning felt different
 * (or broken) depending on where you launched it.
 *
 * This module replaces all entry points with a single overlay and a single
 * Html5Qrcode instance (native BarcodeDetector when available, 15 fps, wide
 * adaptive scan box — the configuration scanner-fix.js proved out). What a
 * scan DOES depends on where you launched it:
 *   - Quick Sale modal open -> part is added to the sale (pcQuickAdd)
 *   - Add Part modal open   -> barcode fills the form + price lookup runs
 *   - anywhere else         -> inventory lookup: open the part, or offer to add it
 * The "Part #" tab keeps photo OCR of a printed part number inside the same
 * overlay, reusing the app's loadTesseract/extractPartNumber helpers and the
 * exact downstream flow the old OCR pane used.
 *
 * Entry points routed here: openBarcodeScanner() (Dashboard + Inventory
 * buttons) and toggleAddPartScanner() (Add Part form). A Scan button is also
 * injected into the Quick Sale modal, which never had one.
 */
(function () {
  'use strict';

  var state = {
    open: false,
    mode: 'barcode', // 'barcode' | 'part'
    ctx: 'lookup',   // 'lookup' | 'add' | 'sale'
    inst: null,      // the one Html5Qrcode instance
    stream: null,    // OCR camera stream
    handled: false,  // one-shot guard per camera session
    built: false
  };

  function el(id) { return document.getElementById(id); }
  function toast(text, kind) {
    if (typeof window.showToast === 'function') { try { window.showToast(text, kind); } catch (e) {} }
  }
  function camHelp(err) {
    if (typeof window.pcCamHelp === 'function') { try { return window.pcCamHelp(); } catch (e) {} }
    return 'Camera unavailable — check the browser camera permission for this site, or use manual entry below.';
  }

  // ── Overlay DOM ────────────────────────────────────────────────────────────
  function build() {
    if (state.built) return;
    state.built = true;
    var wrap = document.createElement('div');
    wrap.id = 'pc-uni-scan';
    wrap.hidden = true;
    wrap.setAttribute('style', 'position:fixed;inset:0;z-index:80000;background:rgba(2,6,23,.88);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px;');
    wrap.innerHTML =
      '<div class="w-full max-w-xl rounded-2xl p-4" style="background:#0f172a;border:1px solid rgba(255,255,255,.08);">' +
        '<div class="flex items-center justify-between mb-3">' +
          '<h3 class="text-base font-bold text-white">Scan</h3>' +
          '<button id="pc-uni-close" aria-label="Close scanner" class="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition"><i class="ph ph-x text-lg"></i></button>' +
        '</div>' +
        '<div class="flex bg-white/5 rounded-full p-1 mb-3" role="tablist" aria-label="Scan mode">' +
          '<button id="pc-uni-tab-barcode" role="tab" aria-selected="true" class="flex-1 py-2 rounded-full text-xs font-semibold text-white bg-white/10 transition">Barcode</button>' +
          '<button id="pc-uni-tab-part" role="tab" aria-selected="false" class="flex-1 py-2 rounded-full text-xs font-semibold text-slate-400 transition">Part #</button>' +
        '</div>' +
        '<div id="pc-uni-pane-barcode">' +
          '<div id="pc-uni-reader" style="width:100%;max-width:560px;margin:0 auto;"></div>' +
          '<p id="pc-uni-status" class="text-center text-sm text-slate-400 my-3">Starting camera…</p>' +
          '<div class="flex gap-2">' +
            '<input id="pc-uni-manual" type="text" inputmode="text" autocomplete="off" placeholder="Or type a barcode / part #" class="glass-input flex-1 px-3 py-3 rounded-lg text-sm text-white">' +
            '<button id="pc-uni-manual-btn" class="px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition">Look up</button>' +
          '</div>' +
        '</div>' +
        '<div id="pc-uni-pane-part" hidden>' +
          '<video id="pc-uni-ocr-video" autoplay playsinline muted style="width:100%;max-width:560px;margin:0 auto;display:block;border-radius:12px;background:#000;"></video>' +
          '<p id="pc-uni-ocr-status" class="text-center text-sm text-slate-400 my-3">Photograph the printed part number, then tap Capture.</p>' +
          '<button id="pc-uni-ocr-capture" class="w-full py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition"><i class="ph-bold ph-camera"></i> Capture Part #</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    el('pc-uni-close').addEventListener('click', closeScanner);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeScanner(); });
    el('pc-uni-tab-barcode').addEventListener('click', function () { setMode('barcode'); });
    el('pc-uni-tab-part').addEventListener('click', function () { setMode('part'); });
    el('pc-uni-manual-btn').addEventListener('click', submitManual);
    el('pc-uni-manual').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitManual(); } });
    el('pc-uni-ocr-capture').addEventListener('click', capturePartNumberPhoto);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) closeScanner();
    });
  }

  function setStatus(text, isErr) {
    var s = el('pc-uni-status');
    if (s) { s.textContent = text; s.className = 'text-center text-sm my-3 ' + (isErr ? 'text-red-400' : 'text-slate-400'); }
  }
  function setOcrStatus(text) {
    var s = el('pc-uni-ocr-status');
    if (s) s.textContent = text;
  }

  // ── Camera lifecycle (exactly one camera active at a time) ────────────────
  function scanCfg() {
    var w = Math.min(window.innerWidth - 64, 560);
    var cfg = {
      fps: 15,
      qrbox: { width: w, height: Math.max(120, Math.round(w * 0.45)) },
      aspectRatio: 1.7,
      useBarCodeDetectorIfSupported: true
    };
    if (window.Html5QrcodeSupportedFormats) {
      var F = window.Html5QrcodeSupportedFormats;
      cfg.formatsToSupport = [F.CODE_128, F.CODE_39, F.EAN_13, F.UPC_A, F.UPC_E, F.EAN_8, F.CODE_93, F.ITF, F.QR_CODE];
    }
    return cfg;
  }

  function startBarcode() {
    stopOcrStream();
    if (typeof window.ensureHtml5Qrcode !== 'function') {
      setStatus('Scanner library unavailable. Use manual entry below.', true);
      return;
    }
    window.ensureHtml5Qrcode().then(function () {
      if (!state.open || state.mode !== 'barcode') return;
      if (!state.inst) state.inst = new window.Html5Qrcode('pc-uni-reader');
      if (state.inst.isScanning) return;
      state.handled = false;
      state.inst.start({ facingMode: 'environment' }, scanCfg(), onScan, function () {})
        .then(function () { if (state.open && state.mode === 'barcode') setStatus('Point camera at barcode'); })
        .catch(function (err) {
          console.error('[UniScan] camera start', err);
          setStatus(camHelp(err) + ' Use manual entry below.', true);
        });
    }).catch(function (err) {
      console.error('[UniScan] library load', err);
      setStatus('Scanner library failed to load. Use manual entry below.', true);
    });
  }

  function stopBarcode() {
    if (state.inst && state.inst.isScanning) {
      var inst = state.inst;
      state.inst = null; // next open builds a fresh instance, like the legacy code did
      return inst.stop().then(function () {
        try { inst.clear(); } catch (e) {}
      }).catch(function () {});
    }
    state.inst = null;
    return Promise.resolve();
  }

  function startOcr() {
    stopBarcode().then(function () {
      if (!state.open || state.mode !== 'part') return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setOcrStatus('Camera is not available in this browser. Type the part # in the Barcode tab instead.');
        return;
      }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(function (stream) {
          if (!state.open || state.mode !== 'part') {
            stream.getTracks().forEach(function (t) { t.stop(); });
            return;
          }
          state.stream = stream;
          var v = el('pc-uni-ocr-video');
          if (v) { v.srcObject = stream; v.play().catch(function () {}); }
          setOcrStatus('Photograph the printed part number, then tap Capture.');
        })
        .catch(function (err) {
          console.error('[UniScan] OCR camera', err);
          setOcrStatus(camHelp(err));
        });
    });
  }

  function stopOcrStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { t.stop(); });
      state.stream = null;
    }
    var v = el('pc-uni-ocr-video');
    if (v) { try { v.srcObject = null; } catch (e) {} }
  }

  function setMode(mode) {
    if (!state.open || state.mode === mode) return;
    state.mode = mode;
    var isB = mode === 'barcode';
    var tb = el('pc-uni-tab-barcode'), tp = el('pc-uni-tab-part');
    tb.setAttribute('aria-selected', String(isB));
    tp.setAttribute('aria-selected', String(!isB));
    tb.className = 'flex-1 py-2 rounded-full text-xs font-semibold transition ' + (isB ? 'text-white bg-white/10' : 'text-slate-400');
    tp.className = 'flex-1 py-2 rounded-full text-xs font-semibold transition ' + (!isB ? 'text-white bg-white/10' : 'text-slate-400');
    el('pc-uni-pane-barcode').hidden = !isB;
    el('pc-uni-pane-part').hidden = isB;
    if (isB) startBarcode(); else startOcr();
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  function isShown(node) {
    // The app closes modals by hiding the container WITHOUT clearing its
    // content, so dialog fields (qsSearch, addPartBarcode) linger invisibly
    // for the rest of the session. Existence checks would misroute every
    // later Dashboard/Inventory scan into those hidden forms — require the
    // element to be actually rendered on screen instead.
    return !!(node && node.getClientRects().length > 0);
  }
  function detectCtx() {
    if (isShown(el('qsSearch'))) return 'sale';
    if (isShown(el('addPartBarcode'))) return 'add';
    return 'lookup';
  }

  function stopLegacyScanners() {
    try {
      if (window.html5QrCode && window.html5QrCode.isScanning) {
        window.html5QrCode.stop().then(function () {
          try { window.html5QrCode.clear(); } catch (e) {}
          window.html5QrCode = null;
        }).catch(function () {});
      }
    } catch (e) {}
    try { if (typeof window.stopAddPartScanner === 'function') window.stopAddPartScanner(); } catch (e) {}
    try { if (typeof window.stopOcrCamera === 'function') window.stopOcrCamera(); } catch (e) {}
    var legacyBox = el('add-part-scanner-container');
    if (legacyBox) legacyBox.classList.add('hidden');
  }

  function openScanner(forceCtx) {
    build();
    stopLegacyScanners();
    state.ctx = forceCtx || detectCtx();
    state.mode = 'barcode';
    state.open = true;
    state.handled = false;
    el('pc-uni-pane-barcode').hidden = false;
    el('pc-uni-pane-part').hidden = true;
    var tb = el('pc-uni-tab-barcode'), tp = el('pc-uni-tab-part');
    tb.setAttribute('aria-selected', 'true');
    tp.setAttribute('aria-selected', 'false');
    tb.className = 'flex-1 py-2 rounded-full text-xs font-semibold transition text-white bg-white/10';
    tp.className = 'flex-1 py-2 rounded-full text-xs font-semibold transition text-slate-400';
    var manual = el('pc-uni-manual');
    if (manual) manual.value = '';
    el('pc-uni-scan').hidden = false;
    setStatus('Starting camera…');
    // Wait one frame so the reader element has layout before the lib measures it.
    requestAnimationFrame(function () { setTimeout(startBarcode, 30); });
  }

  function closeScanner() {
    if (!state.open) return;
    state.open = false;
    stopOcrStream();
    stopBarcode();
    el('pc-uni-scan').hidden = true;
  }

  // ── Result routing ─────────────────────────────────────────────────────────
  function findPart(code) {
    var db = { inventory: [] };
    try { if (typeof window.getDB === 'function') db = window.getDB() || db; } catch (e) {}
    return (db.inventory || []).find(function (t) {
      return t.barcode === code || String(t.partNumber || '').toLowerCase() === String(code).toLowerCase();
    }) || null;
  }

  function routeResult(code) {
    var ctx = state.ctx;
    if (ctx === 'add') {
      var b = el('addPartBarcode');
      if (b) b.value = code;
      toast('Barcode captured - looking up part details...', 'info');
      if (typeof window.fetchPriceInfoFromBarcode === 'function') {
        try { window.fetchPriceInfoFromBarcode(code); } catch (e) { console.error('[UniScan] price lookup', e); }
      }
      return;
    }
    var part = findPart(code);
    if (ctx === 'sale') {
      if (part && typeof window.pcQuickAdd === 'function') {
        window.pcQuickAdd(part.id);
        toast('Added to sale: ' + part.name, 'success');
      } else {
        toast('Part not in inventory: ' + code, 'warning');
      }
      return;
    }
    // lookup (Dashboard / Inventory)
    if (part) {
      if (typeof window.openPartDetail === 'function') window.openPartDetail(part.id);
      toast('Found: ' + part.name, 'success');
    } else {
      toast('Part not found. Would you like to add it?', 'warning');
      if (typeof window.openAddPartModal === 'function') window.openAddPartModal(code);
    }
  }

  function onScan(code) {
    if (state.handled || !state.open) return;
    state.handled = true;
    setStatus('✓ Scanned: ' + code);
    stopBarcode().then(function () {
      closeScanner();
      try { routeResult(code); } catch (e) { console.error('[UniScan] route', e); }
    });
  }

  function submitManual() {
    var input = el('pc-uni-manual');
    var code = input ? input.value.trim() : '';
    if (!code) return;
    closeScanner();
    try { routeResult(code); } catch (e) { console.error('[UniScan] manual route', e); }
  }

  // ── Part # OCR (same downstream flow the legacy OCR pane used) ─────────────
  function capturePartNumberPhoto() {
    var v = el('pc-uni-ocr-video');
    var btn = el('pc-uni-ocr-capture');
    if (!v || !v.videoWidth) { setOcrStatus('Camera not ready — try again'); return; }
    if (typeof window.loadTesseract !== 'function' || typeof window.extractPartNumber !== 'function' || !window.Tesseract) {
      // Tesseract loads lazily through the app's helper; without it OCR is unavailable.
      if (typeof window.loadTesseract !== 'function') {
        setOcrStatus('Text reader unavailable in this build. Type the part # in the Barcode tab instead.');
        return;
      }
    }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Reading...'; }
    setOcrStatus('Loading text reader (first time only)...');
    var finish = function () {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph-bold ph-camera"></i> Capture Part #'; }
    };
    window.loadTesseract().then(function () {
      setOcrStatus('Reading part #...');
      var c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      return window.Tesseract.recognize(c, 'eng', { logger: function () {} });
    }).then(function (r) {
      var pn = window.extractPartNumber((r && r.data && r.data.text) || '');
      finish();
      if (pn) {
        closeScanner();
        if (typeof window.openAddPartModal === 'function') window.openAddPartModal('');
        setTimeout(function () {
          try {
            var i = el('addPartNumber');
            if (i) {
              i.value = pn;
              if (typeof window.fetchPriceInfoFromBarcode === 'function') window.fetchPriceInfoFromBarcode(pn);
            }
            toast('Part # ' + pn + ' captured', 'success');
          } catch (e) { console.error('[UniScan] OCR fill', e); }
        }, 150);
      } else {
        setOcrStatus("Couldn't read it — try again: closer, steadier, better light.");
      }
    }).catch(function (err) {
      console.error('[UniScan] OCR', err);
      finish();
      setOcrStatus('Text reader failed to load. Type the part # in the Barcode tab instead.');
    });
  }

  // ── Entry-point overrides (poll, like the other patch modules) ─────────────
  function install() {
    if (typeof window.openBarcodeScanner === 'function' && window.openBarcodeScanner !== openScannerShim) {
      window.openBarcodeScanner = openScannerShim;
    }
    if (typeof window.toggleAddPartScanner === 'function' && window.toggleAddPartScanner !== addPartShim) {
      window.toggleAddPartScanner = addPartShim;
    }
    if (window.__pcUniScanInstalled) return true;
    if (typeof window.openBarcodeScanner === 'function' && typeof window.toggleAddPartScanner === 'function') {
      window.__pcUniScanInstalled = true;
      console.log('[UniScan] Unified scanner active (single instance, context-aware routing)');
      return true;
    }
    return false;
  }
  function openScannerShim() { openScanner(); }
  function addPartShim() { openScanner('add'); }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (install() || tries > 50) clearInterval(timer);
  }, 300);
  install();

  // ── Quick Sale: inject the Scan button it never had ────────────────────────
  function injectQsButton() {
    var search = el('qsSearch');
    if (!search || el('pc-qs-scan-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'pc-qs-scan-btn';
    btn.type = 'button';
    btn.className = 'glass-input w-full px-3 py-3 rounded-lg text-sm text-white mb-3';
    btn.innerHTML = '📷 Scan barcode';
    btn.addEventListener('click', function () { openScanner('sale'); });
    search.parentNode.insertBefore(btn, search.nextSibling);
  }
  var mo = new MutationObserver(function () { injectQsButton(); });
  function observe() {
    if (document.body) {
      mo.observe(document.body, { childList: true, subtree: true });
      injectQsButton();
    } else {
      setTimeout(observe, 300);
    }
  }
  observe();

  window.pcUnifiedScanner = { open: openScanner, close: closeScanner };
})();
