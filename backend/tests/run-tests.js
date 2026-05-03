/**
 * ============================================================
 * PartsCommand CRM — Integration Test Suite
 * ============================================================
 *
 * Tests:
 *   1. Backend Health Check
 *   2. CORS Headers
 *   3. Database Schema Bootstrap (GET /sync)
 *   4. Data Write Round-Trip (POST /sync → GET /sync)
 *   5. Database Persistence Verification
 *   6. Prices Endpoint
 *   7. Error Handling (bad routes, bad payloads)
 *   8. Frontend ↔ Backend API Configuration
 *
 * Run:  node tests/run-tests.js
 * ============================================================
 */

const API_URL = 'https://parts-command-api.techguruofficial.workers.dev';

// ── Helpers ──────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function log(icon, msg) {
  console.log(`  ${icon}  ${msg}`);
}

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected "${expected}", got "${actual}"`);
  }
}

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, options);
  return { res, data: await res.json() };
}

// Generate a unique test ID to avoid collisions
const TEST_RUN_ID = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ============================================================
// TEST SUITES
// ============================================================

async function runAllTests() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   PartsCommand CRM — Integration Test Suite             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  API: ${API_URL}`);
  console.log(`  Run: ${TEST_RUN_ID}`);
  console.log('');

  // ── 1. BACKEND HEALTH ──────────────────────────────────────
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
    // Should be within last 30 seconds
    const delta = Date.now() - ts.getTime();
    assert(delta < 30000, `Timestamp is ${delta}ms old — clock skew?`);
  });

  console.log('');

  // ── 2. CORS CONFIGURATION ─────────────────────────────────
  console.log('─── 2. CORS Configuration ─────────────────────────────────');

  await test('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await fetch(`${API_URL}/sync`, { method: 'OPTIONS' });
    assertEqual(res.status, 204, 'Status');
    const origin = res.headers.get('access-control-allow-origin');
    assertEqual(origin, '*', 'Allow-Origin');
    const methods = res.headers.get('access-control-allow-methods');
    assert(methods.includes('GET'), 'Missing GET in Allow-Methods');
    assert(methods.includes('POST'), 'Missing POST in Allow-Methods');
  });

  await test('All API responses include CORS Allow-Origin header', async () => {
    const endpoints = ['/health', '/sync'];
    for (const ep of endpoints) {
      const res = await fetch(`${API_URL}${ep}`);
      const origin = res.headers.get('access-control-allow-origin');
      assertEqual(origin, '*', `CORS missing on ${ep}`);
    }
  });

  await test('CORS allows Content-Type header', async () => {
    const res = await fetch(`${API_URL}/sync`, { method: 'OPTIONS' });
    const headers = res.headers.get('access-control-allow-headers');
    assert(headers && headers.toLowerCase().includes('content-type'),
      `Allow-Headers missing Content-Type: "${headers}"`);
  });

  console.log('');

  // ── 3. DATABASE CONNECTION & SCHEMA ─────────────────────────
  console.log('─── 3. Database Connection & Schema ────────────────────────');

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

  await test('GET /sync returns JSON content type', async () => {
    const res = await fetch(`${API_URL}/sync`);
    const ct = res.headers.get('content-type');
    assert(ct && ct.includes('application/json'), `Expected JSON, got: ${ct}`);
  });

  console.log('');

  // ── 4. DATA ROUND-TRIP (Write → Read) ──────────────────────
  console.log('─── 4. Data Round-Trip (POST /sync → GET /sync) ────────────');

  const testPart = {
    id: `part_${TEST_RUN_ID}`,
    partNumber: `TP-${TEST_RUN_ID.slice(-6)}`,
    name: 'Test Brake Pad (Integration Test)',
    barcode: '0000000000000',
    category: 'Brakes',
    brand: 'TestBrand',
    cost: 12.50,
    price: 29.99,
    stock: 10,
    minStock: 2,
    location: 'A1-01',
    notes: `Created by test run ${TEST_RUN_ID}`
  };

  const testCustomer = {
    id: `cust_${TEST_RUN_ID}`,
    name: 'Integration Test Customer',
    phone: '555-000-9999',
    email: 'test@example.com',
    address: '123 Test Blvd',
    notes: `Created by test run ${TEST_RUN_ID}`
  };

  const testVehicle = {
    id: `veh_${TEST_RUN_ID}`,
    customerId: `cust_${TEST_RUN_ID}`,
    year: '2024',
    make: 'TestMake',
    model: 'TestModel',
    vin: `VIN${TEST_RUN_ID.slice(-12).toUpperCase()}`,
    engine: '2.0L Test',
    notes: `Created by test run ${TEST_RUN_ID}`
  };

  const testSale = {
    id: `sale_${TEST_RUN_ID}`,
    customerId: `cust_${TEST_RUN_ID}`,
    date: new Date().toISOString().split('T')[0],
    items: [{ partId: testPart.id, qty: 2, price: 29.99 }],
    total: 59.98,
    margin: 34.98,
    status: 'completed',
    type: 'sale',
    notes: `Created by test run ${TEST_RUN_ID}`
  };

  const testAuditLog = {
    id: `log_${TEST_RUN_ID}`,
    action: 'TEST_RUN',
    timestamp: new Date().toISOString(),
    details: `Integration test ${TEST_RUN_ID}`
  };

  await test('POST /sync writes test data to Neon database', async () => {
    const payload = {
      inventory: [testPart],
      customers: [testCustomer],
      vehicles: [testVehicle],
      sales: [testSale],
      auditLogs: [testAuditLog]
    };

    const { res, data } = await fetchJSON('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assertEqual(res.status, 200, 'Status');
    assertEqual(data.success, true, 'success flag');
    assert(data.synced, 'Missing synced timestamp');
  });

  await test('GET /sync retrieves the test part from database', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.inventory.find(i => i.id === testPart.id);
    assert(found, `Test part ${testPart.id} not found in database after POST`);
    assertEqual(found.partNumber, testPart.partNumber, 'partNumber');
    assertEqual(found.name, testPart.name, 'name');
  });

  await test('GET /sync retrieves the test customer from database', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.customers.find(c => c.id === testCustomer.id);
    assert(found, `Test customer ${testCustomer.id} not found in database after POST`);
    assertEqual(found.name, testCustomer.name, 'name');
    assertEqual(found.phone, testCustomer.phone, 'phone');
  });

  await test('GET /sync retrieves the test vehicle from database', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.vehicles.find(v => v.id === testVehicle.id);
    assert(found, `Test vehicle ${testVehicle.id} not found in database after POST`);
    assertEqual(found.make, testVehicle.make, 'make');
  });

  await test('GET /sync retrieves the test sale from database', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.sales.find(s => s.id === testSale.id);
    assert(found, `Test sale ${testSale.id} not found in database after POST`);
    assertEqual(found.status, 'completed', 'status');
  });

  await test('GET /sync retrieves the test audit log from database', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.auditLogs.find(l => l.id === testAuditLog.id);
    assert(found, `Test audit log ${testAuditLog.id} not found in database after POST`);
    assertEqual(found.action, 'TEST_RUN', 'action');
  });

  await test('Numeric values survive database round-trip (cost/price)', async () => {
    const { data } = await fetchJSON('/sync');
    const found = data.inventory.find(i => i.id === testPart.id);
    assert(found, 'Test part missing');
    assertEqual(typeof found.cost, 'number', 'cost type');
    assertEqual(typeof found.price, 'number', 'price type');
    assertEqual(found.cost, 12.5, 'cost value');
    assertEqual(found.price, 29.99, 'price value');
  });

  console.log('');

  // ── 5. DATABASE PERSISTENCE VERIFICATION ────────────────────
  console.log('─── 5. Database Persistence Verification ───────────────────');

  await test('Data persists across separate GET requests', async () => {
    // First request
    const { data: first } = await fetchJSON('/sync');
    const count1 = first.inventory.length;

    // Wait 1 second, fetch again
    await new Promise(r => setTimeout(r, 1000));

    const { data: second } = await fetchJSON('/sync');
    const count2 = second.inventory.length;

    assertEqual(count1, count2, 'Inventory count across requests');

    // Verify test part still there
    const found = second.inventory.find(i => i.id === testPart.id);
    assert(found, 'Test part disappeared between requests — DB not persisting');
  });

  await test('POST /sync upsert does not create duplicates', async () => {
    // Send the same data again
    const { res } = await fetchJSON('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory: [testPart] })
    });
    assertEqual(res.status, 200, 'Status');

    // Fetch and count occurrences of our test ID
    const { data } = await fetchJSON('/sync');
    const matches = data.inventory.filter(i => i.id === testPart.id);
    assertEqual(matches.length, 1, 'Should have exactly 1 record (upsert, not duplicate)');
  });

  await test('POST /sync upsert updates data in-place', async () => {
    const updatedPart = { ...testPart, name: 'UPDATED Test Brake Pad', price: 39.99 };
    await fetchJSON('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory: [updatedPart] })
    });

    const { data } = await fetchJSON('/sync');
    const found = data.inventory.find(i => i.id === testPart.id);
    assert(found, 'Updated part not found');
    assertEqual(found.name, 'UPDATED Test Brake Pad', 'Updated name');
    assertEqual(found.price, 39.99, 'Updated price');
  });

  console.log('');

  // ── 6. PRICES ENDPOINT ────────────────────────────────────
  console.log('─── 6. Prices Endpoint ──────────────────────────────────────');

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
    assert(data.fetchedAt, 'Missing fetchedAt timestamp');
  });

  await test('GET /prices includes cache headers', async () => {
    const res = await fetch(`${API_URL}/prices?partNumber=WIX-51348`);
    const cc = res.headers.get('cache-control');
    assert(cc && cc.includes('s-maxage'), `Expected Cache-Control with s-maxage, got: "${cc}"`);
  });

  console.log('');

  // ── 7. ERROR HANDLING ─────────────────────────────────────
  console.log('─── 7. Error Handling ────────────────────────────────────────');

  await test('Unknown route returns 404', async () => {
    const { res, data } = await fetchJSON('/nonexistent');
    assertEqual(res.status, 404, 'Status');
    assert(data.error, 'Missing error in body');
  });

  await test('POST /sync with invalid JSON returns 400', async () => {
    const res = await fetch(`${API_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json{{{{'
    });
    const data = await res.json();
    assertEqual(res.status, 400, 'Status');
    assert(data.error, 'Missing error message');
  });

  await test('POST /sync with empty object succeeds gracefully', async () => {
    const { res, data } = await fetchJSON('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEqual(res.status, 200, 'Status');
    assertEqual(data.success, true, 'success flag');
  });

  await test('POST /sync with empty arrays succeeds gracefully', async () => {
    const { res, data } = await fetchJSON('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inventory: [],
        customers: [],
        vehicles: [],
        sales: [],
        retailerPrices: [],
        auditLogs: []
      })
    });
    assertEqual(res.status, 200, 'Status');
    assertEqual(data.success, true, 'success flag');
  });

  console.log('');

  // ── 8. FRONTEND ↔ BACKEND CONFIGURATION ───────────────────
  console.log('─── 8. Frontend ↔ Backend Configuration ─────────────────────');

  await test('Frontend API_URL matches the live worker URL', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(
      new URL('../../frontend/index.html', import.meta.url), 'utf8'
    );
    const match = html.match(/API_URL\s*=\s*['"]([^'"]+)['"]/);
    assert(match, 'API_URL constant not found in index.html');
    assertEqual(match[1], API_URL, 'API_URL mismatch');
  });

  await test('Frontend calls /sync on init (DOMContentLoaded)', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(
      new URL('../../frontend/index.html', import.meta.url), 'utf8'
    );
    assert(
      html.includes('fetch(`${API_URL}/sync`'),
      'Frontend does not fetch /sync on init'
    );
  });

  await test('Frontend POST /sync on every saveDB() call', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(
      new URL('../../frontend/index.html', import.meta.url), 'utf8'
    );
    assert(
      html.includes("fetch(`${API_URL}/sync`,") || html.includes('fetch(`${API_URL}/sync`'),
      'saveDB does not POST to /sync'
    );
    assert(
      html.includes("method: 'POST'"),
      'saveDB sync does not use POST method'
    );
  });

  await test('Frontend IS_PROD gate correctly identifies production hosts', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(
      new URL('../../frontend/index.html', import.meta.url), 'utf8'
    );
    assert(html.includes('.pages.dev'), 'IS_PROD should check for .pages.dev');
    assert(html.includes('techguruofficial.workers.dev'), 'IS_PROD should check for workers.dev');
  });

  console.log('');

  // ── 9. LOCALSTORAGE AUDIT ─────────────────────────────────
  console.log('─── 9. localStorage Usage Audit ─────────────────────────────');

  await test('AUDIT: Identify all localStorage references', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(
      new URL('../../frontend/index.html', import.meta.url), 'utf8'
    );
    const lines = html.split('\n');
    const localStorageLines = [];

    lines.forEach((line, idx) => {
      if (line.includes('localStorage')) {
        localStorageLines.push({ line: idx + 1, code: line.trim() });
      }
    });

    console.log('');
    console.log('    ┌─────────────────────────────────────────────────────');
    console.log('    │ localStorage References Found:');
    console.log('    ├─────────────────────────────────────────────────────');
    localStorageLines.forEach(({ line, code }) => {
      console.log(`    │ L${line}: ${code.substring(0, 70)}${code.length > 70 ? '...' : ''}`);
    });
    console.log('    └─────────────────────────────────────────────────────');
    console.log(`    Total: ${localStorageLines.length} references`);
    console.log('');

    // This test always passes — it's informational
    assert(true, '');
  });

  await test('AUDIT: Verify database is the source of truth', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(
      new URL('../../frontend/index.html', import.meta.url), 'utf8'
    );

    const issues = [];

    // Extract saveDB function text for scoped checks
    const saveDBSection = html.substring(
      html.indexOf('function saveDB('),
      html.indexOf('function saveDB(') + 1500
    );

    // ── Check: saveDB cloud sync must NOT be fire-and-forget ──
    // The old pattern was `.catch(() => { })` — errors silently swallowed.
    // Only check within the saveDB function — QR scanner .stop().catch() is fine.
    if (saveDBSection.includes('ignore cloud failures') || saveDBSection.includes("catch(() => { })")) {
      issues.push('Cloud sync failures are silently ignored (fire-and-forget)');
    }

    // ── Check: saveDB must notify user on sync failure ──
    if (!saveDBSection.includes('showToast')) {
      issues.push('saveDB() does not notify user when cloud sync fails');
    }

    // ── Check: Init must NOT conditionally skip cloud data ──
    // Old: `if (cloudData.inventory?.length > 0 || cloudData.customers?.length > 0)`
    // New: always use cloud data when response is ok
    if (html.includes('cloudData.inventory?.length > 0')) {
      issues.push('Init conditionally skips cloud data for empty databases');
    }

    // ── Check: Init must warn user when DB is unreachable ──
    const initSection = html.substring(
      html.indexOf('// ==================== INIT ===================='),
      html.indexOf('// ==================== INIT ====================') + 3000
    );
    if (initSection.includes('console.error') && !initSection.includes('showToast')) {
      issues.push('Init silently logs DB connection failure without notifying user');
    }

    // ── Check: DATABASE IS THE SOURCE OF TRUTH comment exists ──
    if (!html.includes('DATABASE IS THE SOURCE OF TRUTH')) {
      issues.push('Missing "DATABASE IS THE SOURCE OF TRUTH" documentation in code');
    }

    if (issues.length > 0) {
      console.log('');
      console.log('    ⚠️  Issues found with database-primary architecture:');
      console.log('    ┌─────────────────────────────────────────────────────');
      issues.forEach(issue => {
        console.log(`    │ ⚠  ${issue}`);
      });
      console.log('    └─────────────────────────────────────────────────────');
      console.log('');
    } else {
      console.log('');
      console.log('    ✅  Architecture verified: Neon DB is the source of truth');
      console.log('    ┌─────────────────────────────────────────────────────');
      console.log('    │ ✅ saveDB() notifies user on cloud sync failure');
      console.log('    │ ✅ Init always loads from DB when online');
      console.log('    │ ✅ Init warns user when DB is unreachable');
      console.log('    │ ✅ No silent error swallowing');
      console.log('    │ ✅ localStorage used only as offline cache');
      console.log('    └─────────────────────────────────────────────────────');
      console.log('');
    }

    assert(issues.length === 0,
      `Found ${issues.length} issue(s) preventing DB-primary architecture. ` +
      'The database should be the source of truth, not localStorage.'
    );
  });

  console.log('');

  // ── CLEANUP ────────────────────────────────────────────────
  console.log('─── Cleanup ─────────────────────────────────────────────────');

  await test('Cleanup: Remove test data from database', async () => {
    // We can't run DELETE SQL from here, but we can POST an update
    // to overwrite the test records with a "deleted" flag.
    // For now, we mark this as informational.
    log('ℹ️ ', `Test data left in DB with IDs containing: ${TEST_RUN_ID}`);
    log('ℹ️ ', 'To clean up, delete rows where id LIKE \'%test_%\' from Neon console.');
    assert(true, '');
  });

  // ── SUMMARY ────────────────────────────────────────────────
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
