// Fails the build if sw.js CACHE_NAME and the index.html service-worker guard disagree.
// (A mismatch used to silently disable offline support.)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/CACHE_NAME\s*=\s*'(partscommand-v[\d.]+)'/);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/e\.includes\("(partscommand-v[\d.]+)"\)/);
if (!sw || !html) { console.error('[version-check] could not find version strings'); process.exit(1); }
if (sw[1] !== html[1]) { console.error(`[version-check] MISMATCH: sw.js=${sw[1]} index.html=${html[1]} - bump both`); process.exit(1); }
console.log('[version-check] OK', sw[1]);
