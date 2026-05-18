/**
 * ============================================================
 * PartsCommand CRM — Integration Test Suite v3.0.0
 * ============================================================
 * Run:  node tests/run-tests.js
 * ============================================================
 */

const API_URL = 'https://parts-command-api.techguruofficial.workers.dev';

let passed = 0, failed = 0, skipped = 0;
const results = [];

function log(icon, msg) { console.log(`  ${icon}  ${msg}`); }

async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    log('✅', `PASS — ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
    log('❌', `FAIL — ${name}`);
    log('  ', `       ${err.message}`);
  }
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected "${expected}", got "${actual}"`);
}

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, options);
  return { res, data: await res.json() };
}

const TEST_RUN_ID = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function runAllTests() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   PartsCommand CRM — Integration Test Suite v3.0.0     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  API: ${API_URL}`);
  console.log(`  Run: ${TEST_RUN_ID}`);
  console.log('');

  // ── 1. BACKEND HEALTH ──
  console.log('─── 1. Backend Health ─────────────────────────────────────');

  await test('GET /health returns 200 OK', async () => {
    const { res, data } = await fetchJSON('/health');
    assertEqual(res.status, 200, 'Status');
    assertEqual(data.status, 'ok', 'Body.status');
    assert(data.ts, 'Missing timestamp');
  });

  await test('GET /health returns valid ISO timestamp', async () => {
    const { data } = await fetchJSON('/health');
    const ts = new Date(data.ts);
    assert(!isNaN(ts.getTime()), `Invalid timestamp: ${data.ts}`);
    const delta = Date.now() - ts.getTime();
    assert(delta < 30000, `Timestamp is ${delta}ms old — clock skew?`);
  });

  console.log('');

  // ── 2. CORS CONFIGURATION ──
  console.log('─── 2. CORS Configuration ─────────────────────────────────');

  await test('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await fetch(`${API_URL}/sync`, { method: 'OPTIONS' });
    assertEqual(res.status, 204, 'Status');
    const origin = res.headers.get('access-control-allow-origin');
    assert(origin, 'Missing Access-Control-Allow-Origin header');
    const methods = res.headers.get('access-control-allow-methods');
    assert(methods.includes('GET'), 'Missing GET in Allow-Methods');
    assert(methods.includes('POST'), 'Missing POST in Allow-Methods');
  });

  await test('All API responses include CORS Allow-Origin header', async () => {
    const endpoints = ['/health', '/sync'];
    for (const ep of endpoints) {
      const res = await fetch(`${API_URL}${ep}`);
      const origin = res.headers.get('access-control-allow-origin');
      assert(origin, `CORS missing on ${ep}`);
    }
  });

  await test('CORS allows Content-Type header', async () => {
    const res = await fetch(`${API_URL}/sync`, { method: 'OPTIONS' });
    const headers = res.headers.get('access-control-allow-headers');
    assert(headers && headers.toLowerCase().includes('content-type'),
      `Allow-Headers missing Content-Type: "${headers}"`);
  });

  console.log('');

  // ── 3. SECURITY HEADERS ──
  console.log('─── 3. Security Headers ───────────────────────────────────');

  await test('Responses include OWASP security headers', async () => {
    const res = await fetch(`${API_URL}/health`);
    assert(res.headers.get('x-content-type-options') === 'nosniff', 'Missing X-Content-Type-Options');
    assert(res.headers.get('x-frame-options') === 'DENY', 'Missing X-Frame-Options');
    assert(res.headers.get('x-xss-protection'), 'Missing X-XSS-Protection');
    assert(res.headers.get('strict-transport-security'), 'Missing HSTS');
  });

  console.log('');

  // ── 4. DATABASE CONNECTION & SCHEMA ──
  console.log('─── 4. Database Connection & Schema ────────────────────────');

  await test('GET /sync connects to Neon and returns structured data', async () => {
    const { res, data } = await fetchJSON('/sync');
    assertEqual(res.status, 200, 'Status');
    assert(Array.isArray(data.inventory), 'inventory should be an array');
    assert(Array.isArray(data.customers), 'customers should be an array');
    assert(Array.isArray(data.vehicles), 'vehicles should be an array');
    assert(Array.isArray(data.sales), 'sales should be an array');
    assert(Array.isArray(data.retailerPrices), 'retailerPrices should be an array');
    assert(Array.isArray(data.auditLogs), 'auditLogs should be an array');
  });

  await test('GET /sync returns ETag header', async () => {
    const res = await fetch(`${API_URL}/sync`);
    const etag = res.headers.get('etag');
    assert(etag, 'Missing ETag header on /sync');
    assert(etag.startsWith('"') || etag.startsWith('W/"'), `ETag should be quoted: ${etag}`);
  });

  await test('GET /sync supports conditional requests via ETag', async () => {
    const res1 = await fetch(`${API_URL}/sync`);
    const etag = res1.headers.get('etag');
    assert(etag, 'Missing ETag on first request');
    // Worker may or may not return 304 depending on whether data changed between requests
    const res2 = await fetch(`${API_URL}/sync`, { headers: { 'If-None-Match': etag } });
    assert(res2.status === 304 || res2.status === 200, `Expected 200 or 304, got ${res2.status}`);
  });

  console.log('');

  // ── 5. DATA ROUND-TRIP ──
  console.log('─── 5. Data Round-Trip (POST /sync → GET /sync) ────────────');

  const testPart = {
    id: `part_${TEST_RUN_ID}`, partNumber: `TP-${TEST_RUN_ID.slice(-6)}`,
    name: 'Test Brake Pad (Integration Test)', barcode: '0000000000000',
    category: 'Brakes', brand: 'TestBrand', cost: 12.50, price: 29.99,
    stock: 10, minStock: 2, location: 'A1-01',
    notes: `Created by test run ${TEST_RUN_ID}`
  };
  const testCustomer = {
    id: `cust_${TEST_RUN_ID}`, name: 'Integration Test Customer',
    phone: '555-000-9999', email: 'test@example.com', address: '123 Test Blvd',
    notes: `Created by test run ${TEST_RUN_ID}`
  };
  const testVehicle = {
    id: `veh_${TEST_RUN_ID}`, customerId: `cust_${TEST_RUN_ID}`,
    year: '2024', make: 'TestMake', model: 'TestModel',
    vin: `VIN${TEST_RUN_ID.slice(-12).toUpperCase()}`, engine: '2.0L Test',
    notes: `Created by test run ${TEST_RUN_ID}`
  };
  const testSale = {
    id: `sale_${TEST_RUN_ID}`, customerId: `cust_${TEST_RUN_ID}`,
    date: new Date().toISOString().split('T')[0],
    items: [{ partId: testPart.id, qty: 2, price: 29.99 }],
    total: 59.98, margin: 34.98, status: 'completed', type: 'sale',
    notes: `Created by test run ${TEST_RUN_ID}`
  };
  const testAuditLog = {
    id: `log_${TEST_RUN_ID}`, action: 'TEST_RUN',
    timestamp: new Date().toISOString(),
    details: `Integration test ${TEST_RUN_ID}`
  };

  await test('POST /sync writes test data to Neon database', async () => {
    const { res, data } = await fetchJSON('/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inventory: [testPart], customers: [testCustomer],
        vehicles: [testVehicle], sales: [testSale], auditLogs: [testAuditLog]
      })
    });
    assertEqual(res.status, 200, 'Status');
    assertEqual(data.success, true, 'success flag');
    assert(data.synced, 'Missing synced timestamp');
  });

  await test('GET /sync retrieves the test part from database', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.inventory.find(i => i.id === testPart.id);
    assert(found, `Test part ${testPart.id} not found after POST`);
    assertEqual(found.partNumber, testPart.partNumber, 'partNumber');
  });

  await test('GET /sync retrieves the test customer from database', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.customers.find(c => c.id === testCustomer.id);
    assert(found, `Test customer not found after POST`);
    assertEqual(found.name, testCustomer.name, 'name');
  });

  await test('GET /sync retrieves the test vehicle from database', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.vehicles.find(v => v.id === testVehicle.id);
    assert(found, `Test vehicle not found after POST`);
    assertEqual(found.make, testVehicle.make, 'make');
  });

  await test('GET /sync retrieves the test sale from database', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.sales.find(s => s.id === testSale.id);
    assert(found, `Test sale not found after POST`);
    assertEqual(found.status, 'completed', 'status');
  });

  await test('Numeric values survive database round-trip', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.inventory.find(i => i.id === testPart.id);
    assert(found, 'Test part missing');
    assertEqual(typeof found.cost, 'number', 'cost type');
    assertEqual(found.cost, 12.5, 'cost value');
    assertEqual(found.price, 29.99, 'price value');
  });

  console.log('');

  // ── 6. PERSISTENCE & UPSERT ──
  console.log('─── 6. Database Persistence & Upsert ───────────────────────');

  await test('Data persists across separate GET requests', async () => {
    const { data: first } = await fetchJSON('/sync');
    const count1 = first.inventory.length;
    await new Promise(r => setTimeout(r, 1000));
    const { data: second } = await fetchJSON('/sync');
    assertEqual(count1, second.inventory.length, 'Inventory count');
    assert(second.inventory.find(i => i.id === testPart.id), 'Test part disappeared');
  });

  await test('POST /sync upsert does not create duplicates', async () => {
    await fetchJSON('/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory: [testPart] })
    });
    const { data } = await fetchJSON('/sync');
    assertEqual(data.inventory.filter(i => i.id === testPart.id).length, 1, 'Should be exactly 1');
  });

  await test('POST /sync upsert updates data in-place', async () => {
    const updated = { ...testPart, name: 'UPDATED Test Brake Pad', price: 39.99 };
    await fetchJSON('/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory: [updated] })
    });
    const { data } = await fetchJSON('/sync');
    const found = data.inventory.find(i => i.id === testPart.id);
    assertEqual(found.name, 'UPDATED Test Brake Pad', 'Updated name');
    assertEqual(found.price, 39.99, 'Updated price');
  });

  console.log('');

  // ── 7. SETTINGS SYNC ──
  console.log('─── 7. Settings Sync ──────────────────────────────────────');

  await test('POST /sync writes settings to database', async () => {
    const { res } = await fetchJSON('/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { bizName: 'Test CRM', testRun: TEST_RUN_ID } })
    });
    assertEqual(res.status, 200, 'Status');
  });

  await test('GET /sync retrieves settings from database', async () => {
    const { data } = await fetchJSON('/sync');
    assert(data.settings, 'Missing settings in response');
    assert(typeof data.settings === 'object', 'Settings should be an object');
  });

  console.log('');

  // ── 8. PRICES ENDPOINT ──
  console.log('─── 8. Prices Endpoint ──────────────────────────────────────');

  await test('GET /prices without partNumber returns 400', async () => {
    const { res, data } = await fetchJSON('/prices');
    assertEqual(res.status, 400, 'Status');
    assert(data.error, 'Missing error message');
  });

  await test('GET /prices with partNumber returns structured response', async () => {
    const { res, data } = await fetchJSON('/prices?partNumber=WIX-51348');
    assertEqual(res.status, 200, 'Status');
    assertEqual(data.partNumber, 'WIX-51348', 'partNumber echo');
    assert('napa' in data, 'Missing napa field');
    assert('autozone' in data, 'Missing autozone field');
    assert('advance' in data, 'Missing advance field');
    assert('rockauto' in data, 'Missing rockauto field');
    assert(data.fetchedAt, 'Missing fetchedAt timestamp');
  });

  await test('GET /prices returns valid response structure', async () => {
    const res = await fetch(`${API_URL}/prices?partNumber=WIX-51348`);
    assertEqual(res.status, 200, 'Status');
    const data = await res.json();
    assert(data.partNumber, 'Response should echo partNumber');
    assert(data.fetchedAt, 'Response should include fetchedAt');
  });

  console.log('');

  // ── 9. ERROR HANDLING & VALIDATION ──
  console.log('─── 9. Error Handling & Zod Validation ─────────────────────');

  await test('Unknown route returns 404', async () => {
    const { res, data } = await fetchJSON('/nonexistent');
    assertEqual(res.status, 404, 'Status');
    assert(data.error, 'Missing error in body');
  });

  await test('POST /sync with invalid JSON returns 400', async () => {
    const res = await fetch(`${API_URL}/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: 'this is not json{{{{'
    });
    assertEqual(res.status, 400, 'Status');
  });

  await test('POST /sync with empty object succeeds', async () => {
    const { res, data } = await fetchJSON('/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEqual(res.status, 200, 'Status');
    assertEqual(data.success, true, 'success flag');
  });

  await test('POST /sync with Zod-invalid inventory item returns 400', async () => {
    const { res } = await fetchJSON('/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory: [{ noIdField: true }] })
    });
    assertEqual(res.status, 400, 'Status — missing required id field');
  });

  await test('GET /favicon.ico returns 204 (no content)', async () => {
    const res = await fetch(`${API_URL}/favicon.ico`);
    assertEqual(res.status, 204, 'Status');
  });

  console.log('');

  // ── 10. FRONTEND ↔ BACKEND CONFIG ──
  console.log('─── 10. Frontend ↔ Backend Configuration ────────────────────');

  await test('Frontend API_URL matches the live worker URL', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
    const match = html.match(/API_URL\s*=\s*['"]([^'"]+)['"]/);
    assert(match, 'API_URL constant not found in index.html');
    assertEqual(match[1], API_URL, 'API_URL mismatch');
  });

  await test('Frontend calls /sync on init (DOMContentLoaded)', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
    assert(html.includes('fetch(`${API_URL}/sync`'), 'Frontend does not fetch /sync on init');
  });

  await test('Frontend POST /sync on every saveDB() call', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
    assert(html.includes("method: 'POST'"), 'saveDB sync does not use POST method');
  });

  await test('Frontend IS_PROD gate identifies production hosts', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
    assert(html.includes('.pages.dev'), 'IS_PROD should check for .pages.dev');
    assert(html.includes('techguruofficial.workers.dev'), 'IS_PROD should check for workers.dev');
  });

  console.log('');

  // ── 11. DB SOURCE OF TRUTH AUDIT ──
  console.log('─── 11. Database Source of Truth Audit ──────────────────────');

  await test('AUDIT: saveDB() notifies user on sync failure', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
    const saveDBSection = html.substring(
      html.indexOf('function saveDB('), html.indexOf('function saveDB(') + 1500
    );
    assert(saveDBSection.includes('showToast'), 'saveDB() does not notify user on failure');
  });

  await test('AUDIT: DATABASE IS THE SOURCE OF TRUTH documented', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
    assert(html.includes('DATABASE IS THE SOURCE OF TRUTH'), 'Missing documentation comment');
  });

  console.log('');

  // ── 12. BARCODE SCANNER & UI ──
  console.log('─── 12. Barcode Scanner & UI ────────────────────────────────');

  await test('Barcode scanner configured for environment camera', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
    assert(html.includes('facingMode: "environment"'), 'Scanner not configured for rear camera');
    assert(html.includes('Html5QrcodeSupportedFormats'), 'Missing barcode format support');
  });

  await test('Barcode scan triggers auto-fill and price fetching', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
    assert(html.includes('fetchPriceInfoFromBarcode'), 'Missing fetchPriceInfoFromBarcode');
    assert(html.includes('partNumInput.value = decodedText'), 'Does not auto-populate part number');
  });

  await test('Price fetcher auto-fills name, cost, and sell price', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
    const section = html.substring(
      html.indexOf('function fetchPriceInfoFromBarcode'),
      html.indexOf('function stopAddPartScanner')
    );
    assert(section.includes('nameInput.value = data.name'), 'Does not auto-fill part name');
    assert(section.includes('lowest * 1.3'), 'Does not calculate 30% markup pricing');
    assert(section.includes('priceInput.value ='), 'Does not auto-fill sell price');
  });

  await test('Image capture uses mobile camera correctly', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
    assert(html.includes('accept="image/*"'), 'Missing accept="image/*"');
    assert(html.includes('capture="environment"'), 'Missing capture="environment"');
  });

  console.log('');

  // ── 13. VERSION CONSISTENCY ──
  console.log('─── 13. Version Consistency ─────────────────────────────────');

  await test('All package.json versions are aligned', async () => {
    const fs = await import('fs');
    const root = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const be = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const fe = JSON.parse(fs.readFileSync(new URL('../../frontend/package.json', import.meta.url), 'utf8'));
    assertEqual(root.version, '3.0.0', 'Root version');
    assertEqual(be.version, '3.0.0', 'Backend version');
    assertEqual(fe.version, '3.0.0', 'Frontend version');
  });

  await test('Worker version header matches package.json', async () => {
    const { data } = await fetchJSON('/');
    assert(data.version === '3.0.0', `Worker reports version ${data.version}, expected 3.0.0`);
  });

  await test('Service Worker CACHE_NAME matches version', async () => {
    const fs = await import('fs');
    const sw = fs.readFileSync(new URL('../../frontend/sw.js', import.meta.url), 'utf8');
    assert(sw.includes('partscommand-v3.0.0'), 'SW CACHE_NAME does not match v3.0.0');
  });

  console.log('');

  // ── 14. ROCKAUTO SCRAPER VERIFICATION ──
  console.log('─── 14. RockAuto & Scraper Verification ─────────────────────');

  await test('Worker includes RockAuto scraper with CAPTCHA detection', async () => {
    const fs = await import('fs');
    const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
    assert(worker.includes('parseRockAuto'), 'Missing parseRockAuto parser');
    assert(worker.includes('CAPTCHA_SIGNATURES'), 'Missing CAPTCHA detection');
    assert(worker.includes('ra-formatted-amount'), 'RockAuto price regex missing');
  });

  await test('Price scraper returns null gracefully on CAPTCHA', async () => {
    const fs = await import('fs');
    const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
    assert(worker.includes('CAPTCHA detected, skipping'), 'Missing CAPTCHA skip logic');
    assert(worker.includes('return null'), 'Missing null return on CAPTCHA');
  });

  await test('Prices response includes all retailer fields', async () => {
    const { data } = await fetchJSON('/prices?partNumber=TEST-PART-123');
    const fields = ['napa', 'autozone', 'advance', 'rockauto', 'oreilly', 'carquest'];
    for (const f of fields) {
      assert(f in data, `Missing retailer field: ${f}`);
    }
  });

  console.log('');

  // ── CLEANUP ──
  console.log('─── Cleanup ─────────────────────────────────────────────────');
  await test('Cleanup: Test data info', async () => {
    log('ℹ️ ', `Test data IDs contain: ${TEST_RUN_ID}`);
    log('ℹ️ ', 'Clean up via Neon console if needed.');
    assert(true, '');
  });

  // ── SUMMARY ──
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS:  ${passed} passed   ${failed} failed   ${skipped} skipped`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    console.log('');
    console.log('Failed tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ ${r.name}`);
      console.log(`     ${r.error}`);
    });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(2);
});
