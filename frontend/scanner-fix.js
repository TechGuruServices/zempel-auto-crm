/* Scanner Fix v1.0.0 — Zempel Auto CRM
 *
 * The Barcode tab was missing most scans while the OCR Part# tab worked fine.
 * Root cause: html5-qrcode fell back to its JS ZXing 1D decoder (slow, misses
 * a lot) with a small 250x150 scan box at 10fps. This overrides the global
 * pcScanCfg() used by both camera scanners:
 *  - useBarCodeDetectorIfSupported: native detector (ML Kit on Android),
 *    ZXing fallback otherwise — the single biggest accuracy win
 *  - fps 10 -> 15 (more decode attempts per second)
 *  - wider adaptive scan box (up to 640x280) for long 1D codes
 */
(function () {
  'use strict';
  function improvedCfg() {
    var F = (typeof Html5QrcodeSupportedFormats !== 'undefined')
      ? Html5QrcodeSupportedFormats : null;
    return {
      fps: 15,
      qrbox: function (w, h) {
        return { width: Math.min(640, Math.floor(w * 0.9)),
                 height: Math.min(280, Math.floor(h * 0.4)) };
      },
      aspectRatio: 1.777778,
      useBarCodeDetectorIfSupported: true,
      formatsToSupport: F ? [F.CODE_128, F.CODE_39, F.EAN_13, F.UPC_A, F.UPC_E,
                             F.EAN_8, F.CODE_93, F.ITF, F.QR_CODE] : undefined
    };
  }
  // pcScanCfg is a top-level function declaration in the main bundle, so the
  // binding lives on window. The scanners call it lazily at scan start, so
  // replacing it here (loaded at boot) always wins.
  function apply() {
    try { window.pcScanCfg = improvedCfg; } catch (e) { /* noop */ }
  }
  if (typeof window.pcScanCfg === 'function') { apply(); }
  else {
    var tries = 0;
    var iv = setInterval(function () {
      tries += 1;
      if (typeof window.pcScanCfg === 'function' || tries > 50) { apply(); clearInterval(iv); }
    }, 100);
  }
  console.log('[ScannerFix] improved 1D barcode config active');
})();
