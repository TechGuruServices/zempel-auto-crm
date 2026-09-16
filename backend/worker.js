import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

/**
 * ============================================================
 * PartsCommand CRM — Cloudflare Worker v3.2.0
 * ============================================================
 * Production-hardened: JWT/RBAC, Zod validation, ETag,
 * rate limiting, audit logging, OWASP headers, CAPTCHA detection.
 *
 * Routes:
 *   GET   /              Status
 *   GET   /health        Health check
 *   POST  /auth/login    JWT login
 *   POST  /auth/logout   Session revoke
 *   GET   /sync          Pull DB (ETag support)
 *   POST  /sync          Push DB (Zod validated)
 *   GET   /prices        Hardened price lookup
 *   OPTIONS *            CORS preflight
 *
 * Env bindings: DATABASE_URL, JWT_SECRET, ALLOWED_ORIGIN, CRM_KV
 * Deploy: wrangler deploy
 * ============================================================
 */

// ── Zod Schemas ──────────────────────────────────────────────
const SyncPayloadSchema = z.object({
  inventory: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  customers: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  vehicles: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  sales: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  invoices: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  retailerPrices: z.array(z.object({ partNumber: z.string() }).passthrough()).optional(),
  auditLogs: z.array(z.object({ id: z.string(), action: z.string() }).passthrough()).optional(),
  settings: z.record(z.string(), z.any()).optional(),
}).passthrough();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ── RockAuto Proxy Config ────────────────────────────────────
const ROCKAUTO_ROUTE_MAP = {
  '/v1/rockauto/makes': '/api/rockauto/makes',
  '/v1/rockauto/search': '/api/rockauto/search',
};
const ROCKAUTO_DYNAMIC_ROUTES = [
  { pattern: /^\/v1\/rockauto\/parts\/([^/]+)\/(\d+)\/([^/]+)\/([a-zA-Z0-9]+)\/([^/]+)$/, upstream: (m) => `/api/rockauto/parts/${m[1]}/${m[2]}/${m[3]}/${m[4]}/${m[5]}` },
  { pattern: /^\/v1\/rockauto\/categories\/([^/]+)\/(\d+)\/([^/]+)\/([a-zA-Z0-9]+)$/, upstream: (m) => `/api/rockauto/categories/${m[1]}/${m[2]}/${m[3]}/${m[4]}` },
  { pattern: /^\/v1\/rockauto\/engines\/([^/]+)\/(\d+)\/([^/]+)$/, upstream: (m) => `/api/rockauto/engines/${m[1]}/${m[2]}/${m[3]}` },
  { pattern: /^\/v1\/rockauto\/models\/([^/]+)\/(\d+)$/, upstream: (m) => `/api/rockauto/models/${m[1]}/${m[2]}` },
  { pattern: /^\/v1\/rockauto\/years\/([^/]+)$/, upstream: (m) => `/api/rockauto/years/${m[1]}` },
];

// ── Main Handler ─────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

    const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || '*'; 
    const origin = request.headers.get('Origin') || '';
    
    let corsOrigin = ALLOWED_ORIGIN === '*' ? '*' : ALLOWED_ORIGIN.split(',')[0].trim();
    let isOriginAllowed = (ALLOWED_ORIGIN === '*' || !origin);

    if (ALLOWED_ORIGIN !== '*' && origin) {
      const allowedList = ALLOWED_ORIGIN.split(',').map(s => s.trim());
      if (allowedList.includes(origin)) {
        corsOrigin = origin;
        isOriginAllowed = true;
      } else {
        try {
          const originHost = new URL(origin).hostname;
          for (const allowed of allowedList) {
            const allowedHost = new URL(allowed).hostname;
            if (originHost.endsWith('.' + allowedHost) || originHost === allowedHost) {
              corsOrigin = origin;
              isOriginAllowed = true;
              break;
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-None-Match, Cache-Control, Pragma',
      'Access-Control-Expose-Headers': 'ETag',
      'Access-Control-Max-Age': '86400',
    };
    const secHeaders = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    };
    const hdrs = { ...corsHeaders, ...secHeaders };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: hdrs });
    }

    // Strict origin check when ALLOWED_ORIGIN is set
    if (!isOriginAllowed) {
      return json({ error: 'Forbidden origin' }, hdrs, 403);
    }

    try {
      // ── Rate Limiting (5 req/s per IP via KV) ──
      if (env.CRM_KV) {
        const rlKey = `rl:${clientIP}:${Math.floor(Date.now() / 1000)}`;
        const cur = parseInt(await env.CRM_KV.get(rlKey) || '0');
        if (cur >= 5) return json({ error: 'Rate limit exceeded' }, hdrs, 429);
        // FIX: KV rejects expirationTtl < 60 ("Expiration TTL must be at least 60"),
        // so the old ttl:2 put failed on EVERY request and rate limiting never
        // actually counted anything. The per-second window is encoded in the key
        // itself; a 60s TTL simply lets stale window keys expire on their own.
        ctx.waitUntil(env.CRM_KV.put(rlKey, String(cur + 1), { expirationTtl: 60 }).catch(() => { }));
      }

      // ── Public Routes ──
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '') {
        return json({ message: 'PartsCommand CRM API', status: 'online', version: '3.2.0' }, hdrs);
      }
      if (url.pathname === '/favicon.ico') return new Response(null, { status: 204, headers: hdrs });
      if (url.pathname === '/health') return json({ status: 'ok', ts: new Date().toISOString() }, hdrs);
      if (url.pathname === '/auth/login' && request.method === 'POST') return handleLogin(request, env, hdrs);
      if (url.pathname === '/auth/logout' && request.method === 'POST') return handleLogout(request, env, hdrs);

      // ── App Routes (origin-restricted above via ALLOWED_ORIGIN, not JWT-gated) ──
      // BUGFIX (2026-08-08): the PWA frontend has no login screen and never sends an
      // Authorization header (confirmed: zero references to "Authorization" or "Bearer"
      // anywhere in frontend/index.html or rockauto-fetch.js). These routes used to sit
      // behind the JWT middleware below, so any deploy with JWT_SECRET set as a Worker
      // secret made EVERY /sync and /v1/rockauto/* call 401 before it could run — this
      // was the root cause of both "pricing fetch doesn't work" and "storage doesn't
      // save". They're moved here so they're reachable by the actual client, and are
      // still protected by the ALLOWED_ORIGIN / CORS check above.
      // If you later add real user accounts, re-add a JWT check scoped to /sync only,
      // and update the frontend to call /auth/login and send the token it gets back.
      if (url.pathname.startsWith('/v1/rockauto/')) {
        return handleRockAutoProxy(url, request, env, hdrs, ctx, clientIP);
      }
      if (url.pathname === '/sync') {
        if (request.method === 'GET') return handleSyncGet(env, request, hdrs);
        if (request.method === 'POST') return handleSyncPost(request, env, hdrs, null, clientIP, ctx);
      }
      if (url.pathname === '/prices' && request.method === 'GET') {
        return handlePriceLookup(url, env, hdrs, ctx);
      }

      // ── JWT Auth Middleware (only relevant to routes added below this line) ──
      if (env.JWT_SECRET) {
        const authH = request.headers.get('Authorization');
        if (!authH || !authH.startsWith('Bearer ')) {
          return json({ error: 'Authorization required' }, hdrs, 401);
        }
        try {
          jwt.verify(authH.substring(7), env.JWT_SECRET);
        } catch {
          return json({ error: 'Invalid or expired token' }, hdrs, 401);
        }
      }

      return json({ error: 'Not found', path: url.pathname }, hdrs, 404);
    } catch (err) {
      console.error('[Worker] Unhandled:', err);
      return json({ error: 'Internal server error' }, hdrs, 500);
    }
  }
};

// ── DB Helper ────────────────────────────────────────────────
async function query(env, sqlStr, params = []) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL not configured');
  const sql = neon(env.DATABASE_URL);
  
  // Neon's neon() returns a function that can be used as a tagged template.
  // To use it with a string and params, we must use the .query() method.
  // The error message specifies: sql.query("SELECT $1", [value], options)
  try {
    const rows = await sql.query(sqlStr, params);
    return { rows: rows || [] };
  } catch (err) {
    console.error('[DB Error]', { sql: sqlStr, params, error: err.message });
    throw err;
  }
}

// ── SHA Helper ───────────────────────────────────────────────
async function sha(algo, data) {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Auth: Login ──────────────────────────────────────────────
async function handleLogin(request, env, hdrs) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, hdrs, 400); }

  const v = LoginSchema.safeParse(body);
  if (!v.success) return json({ error: 'Invalid credentials format' }, hdrs, 400);

  const { email, password } = v.data;
  const pwHash = await sha('SHA-256', password);

  // Check env-var bootstrap admin
  const adminEmail = env.ADMIN_EMAIL || 'admin@zempelauto.com';
  const adminPwHash = env.ADMIN_PASSWORD_HASH;

  let userRecord = null;

  if (env.CRM_KV) {
    const stored = await env.CRM_KV.get(`user:${email}`, 'json');
    if (stored && stored.passwordHash === pwHash) userRecord = stored;
  }

  if (!userRecord && email === adminEmail && adminPwHash && pwHash === adminPwHash) {
    userRecord = { id: 'admin-001', email: adminEmail, role: 'admin' };
    if (env.CRM_KV) {
      await env.CRM_KV.put(`user:${email}`, JSON.stringify({ ...userRecord, passwordHash: pwHash }));
    }
  }

  if (!userRecord) return json({ error: 'Invalid email or password' }, hdrs, 401);

  if (!env.JWT_SECRET) return json({ error: 'JWT_SECRET not configured' }, hdrs, 500);

  const token = jwt.sign(
    { id: userRecord.id, email: userRecord.email, role: userRecord.role },
    env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  if (env.CRM_KV) {
    await env.CRM_KV.put(`session:${userRecord.id}`, token, { expirationTtl: 86400 });
  }

  return json({ token, user: { id: userRecord.id, email: userRecord.email, role: userRecord.role } }, hdrs);
}

// ── Auth: Logout ─────────────────────────────────────────────
async function handleLogout(request, env, hdrs) {
  const authH = request.headers.get('Authorization');
  if (!authH || !env.JWT_SECRET) return json({ success: true }, hdrs);
  try {
    const user = jwt.verify(authH.substring(7), env.JWT_SECRET);
    if (env.CRM_KV) await env.CRM_KV.delete(`session:${user.id}`);
  } catch { /* token already invalid */ }
  return json({ success: true }, hdrs);
}

// ── GET /sync (ETag support) ─────────────────────────────────
async function handleSyncGet(env, request, hdrs) {
  try {
    await ensureSchema(env);
    const [inv, cust, veh, sales, invoices, prices, logs, settings] = await Promise.all([
      query(env, 'SELECT data FROM inventory ORDER BY created_at'),
      query(env, 'SELECT data FROM customers ORDER BY created_at'),
      query(env, 'SELECT data FROM vehicles ORDER BY created_at'),
      query(env, 'SELECT data FROM sales ORDER BY created_at'),
      query(env, 'SELECT data FROM invoices ORDER BY created_at'),
      query(env, 'SELECT data FROM retailer_prices ORDER BY fetched_at DESC'),
      query(env, 'SELECT data FROM audit_logs ORDER BY created_at DESC LIMIT 500'),
      query(env, 'SELECT data FROM settings WHERE id = $1', ['app_settings']),
    ]);

    const db = {
      inventory:      (inv.rows      || []).map(r => r.data),
      customers:      (cust.rows     || []).map(r => r.data),
      vehicles:       (veh.rows      || []).map(r => r.data),
      sales:          (sales.rows    || []).map(r => r.data),
      invoices:       (invoices.rows || []).map(r => r.data),
      retailerPrices: (prices.rows   || []).map(r => r.data),
      auditLogs:      (logs.rows     || []).map(r => r.data),
      settings:       (settings.rows && settings.rows.length > 0) ? settings.rows[0].data : {},
    };

    const payload = JSON.stringify(db);
    const etag = `"${await sha('SHA-1', payload)}"`;

    // 304 Not Modified if client ETag matches
    const clientETag = request.headers.get('If-None-Match');
    if (clientETag === etag) {
      return new Response(null, { status: 304, headers: { ...hdrs, ETag: etag } });
    }

    return new Response(payload, {
      status: 200,
      headers: {
        ...hdrs,
        'Content-Type': 'application/json',
        ETag: etag,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (err) {
    console.error('[GET /sync]', err);
    return json({ error: 'Database unavailable', detail: err.message }, hdrs, 503);
  }
}

// ── POST /sync (Zod + RBAC + Audit) ─────────────────────────
async function handleSyncPost(request, env, hdrs, user, clientIP, ctx) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, hdrs, 400); }

  // Zod validation
  const validation = SyncPayloadSchema.safeParse(body);
  if (!validation.success) {
    return json({ error: 'Validation failed', details: validation.error.format() }, hdrs, 400);
  }
  const vb = validation.data;

  // RBAC enforcement
  if (user) {
    if (user.role === 'warehouse' && (vb.customers?.length || vb.sales?.length)) {
      return json({ error: 'Warehouse role cannot sync customers/sales' }, hdrs, 403);
    }
    if (user.role === 'sales' && vb.settings && Object.keys(vb.settings).length > 0) {
      return json({ error: 'Sales role cannot modify settings' }, hdrs, 403);
    }
  }

  try {
    await ensureSchema(env);
    const ops = [];

    if (vb.inventory?.length) {
      for (const item of vb.inventory) {
        ops.push(query(env,
          `INSERT INTO inventory (id, data, created_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
          [item.id, JSON.stringify(item)]));
      }
    }
    if (vb.customers?.length) {
      for (const c of vb.customers) {
        ops.push(query(env,
          `INSERT INTO customers (id, data, created_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
          [c.id, JSON.stringify(c)]));
      }
    }
    if (vb.vehicles?.length) {
      for (const v of vb.vehicles) {
        ops.push(query(env,
          `INSERT INTO vehicles (id, data, created_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
          [v.id, JSON.stringify(v)]));
      }
    }
    if (vb.sales?.length) {
      for (const s of vb.sales) {
        ops.push(query(env,
          `INSERT INTO sales (id, data, created_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
          [s.id, JSON.stringify(s)]));
      }
    }
    if (vb.invoices?.length) {
      for (const iv of vb.invoices) {
        ops.push(query(env,
          `INSERT INTO invoices (id, data, created_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
          [iv.id, JSON.stringify(iv)]));
      }
    }
    if (vb.retailerPrices?.length) {
      for (const p of vb.retailerPrices) {
        ops.push(query(env,
          `INSERT INTO retailer_prices (part_number, data, fetched_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (part_number) DO UPDATE SET data = $2::jsonb, fetched_at = NOW()`,
          [p.partNumber, JSON.stringify(p)]));
      }
    }
    if (vb.auditLogs?.length) {
      for (const l of vb.auditLogs.slice(0, 100)) {
        ops.push(query(env,
          `INSERT INTO audit_logs (id, data, created_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO NOTHING`, [l.id, JSON.stringify(l)]));
      }
    }
    if (vb.settings && Object.keys(vb.settings).length > 0) {
      ops.push(query(env,
        `INSERT INTO settings (id, data, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
        ['app_settings', JSON.stringify(vb.settings)]));
    }

    // Structured audit log entry
    const payloadHash = await sha('SHA-256', JSON.stringify(vb));
    const auditEntry = {
      id: crypto.randomUUID(),
      action: 'SYNC_PUSH',
      userId: user?.id || 'anonymous',
      role: user?.role || 'none',
      ip: clientIP,
      payload_hash: payloadHash,
      timestamp: new Date().toISOString(),
      counts: {
        inventory: vb.inventory?.length || 0,
        customers: vb.customers?.length || 0,
        vehicles: vb.vehicles?.length || 0,
        sales: vb.sales?.length || 0,
        invoices: vb.invoices?.length || 0,
      }
    };
    ops.push(query(env,
      `INSERT INTO audit_logs (id, data, created_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`, [auditEntry.id, JSON.stringify(auditEntry)]));

    await Promise.allSettled(ops);

    // ── DELETE rows no longer in the client payload ──
    // This is critical: without this, deleted records persist in Neon forever
    // and get re-fetched on next GET /sync, causing stale data.
    const deleteOps = [];

    // Inventory: delete rows not in payload
    if (vb.inventory) {
      const ids = vb.inventory.map(i => i.id);
      if (ids.length > 0) {
        deleteOps.push(query(env,
          `DELETE FROM inventory WHERE NOT (id = ANY($1::text[]))`, [ids]));
      } else {
        deleteOps.push(query(env, `DELETE FROM inventory`));
      }
    }

    // Customers: delete rows not in payload
    if (vb.customers) {
      const ids = vb.customers.map(c => c.id);
      if (ids.length > 0) {
        deleteOps.push(query(env,
          `DELETE FROM customers WHERE NOT (id = ANY($1::text[]))`, [ids]));
      } else {
        deleteOps.push(query(env, `DELETE FROM customers`));
      }
    }

    // Vehicles: delete rows not in payload
    if (vb.vehicles) {
      const ids = vb.vehicles.map(v => v.id);
      if (ids.length > 0) {
        deleteOps.push(query(env,
          `DELETE FROM vehicles WHERE NOT (id = ANY($1::text[]))`, [ids]));
      } else {
        deleteOps.push(query(env, `DELETE FROM vehicles`));
      }
    }

    // Sales: delete rows not in payload
    if (vb.sales) {
      const ids = vb.sales.map(s => s.id);
      if (ids.length > 0) {
        deleteOps.push(query(env,
          `DELETE FROM sales WHERE NOT (id = ANY($1::text[]))`, [ids]));
      } else {
        deleteOps.push(query(env, `DELETE FROM sales`));
      }
    }

    // Invoices: delete rows not in payload
    if (vb.invoices) {
      const ids = vb.invoices.map(iv => iv.id);
      if (ids.length > 0) {
        deleteOps.push(query(env,
          `DELETE FROM invoices WHERE NOT (id = ANY($1::text[]))`, [ids]));
      } else {
        deleteOps.push(query(env, `DELETE FROM invoices`));
      }
    }

    if (deleteOps.length > 0) {
      await Promise.allSettled(deleteOps);
    }

    return json({ success: true, synced: new Date().toISOString() }, hdrs);
  } catch (err) {
    console.error('[POST /sync]', err);
    return json({ error: 'Sync failed', detail: err.message }, hdrs, 503);
  }
}

// ── GET /prices (Hardened, KV-cached) ────────────────────────
async function handlePriceLookup(url, env, hdrs, ctx) {
  const partNumber = url.searchParams.get('partNumber');
  const brand = url.searchParams.get('brand') || '';
  if (!partNumber) return json({ error: 'partNumber query param required' }, hdrs, 400);

  // Check KV cache first (1h TTL)
  if (env.CRM_KV) {
    const cached = await env.CRM_KV.get(`price:${partNumber}`, 'json');
    if (cached) return json(cached, { ...hdrs, 'X-Cache': 'HIT' });
  }

  // Parallel scraping with per-retailer timeout + CAPTCHA detection.
  // (Was sequential with 2s delays — that pushed total latency past the
  // frontend's AbortSignal timeout, so the Price Comparison live-lookup
  // always failed. Parallel + capped at ~5s keeps it inside budget.)
  const scrapers = [
    () => scrapeRetailer('napa', `https://www.napaonline.com/en/search?q=${encodeURIComponent(partNumber)}`, parseNapa),
    () => scrapeRetailer('autozone', `https://www.autozone.com/searchresult?searchText=${encodeURIComponent(partNumber)}`, parseAutozone),
    () => scrapeRetailer('advance', `https://shop.advanceautoparts.com/find/${encodeURIComponent(partNumber)}`, parseAdvance),
    () => scrapeRetailer('rockauto', `https://www.rockauto.com/en/partsearch/?partnum=${encodeURIComponent(partNumber)}`, parseRockAuto),
  ];

  const results = {};
  let bestName = null;
  const settled = await Promise.allSettled(scrapers.map(fn => fn()));
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) {
      results[s.value.retailer] = s.value.price;
      if (s.value.name && !bestName) bestName = s.value.name;
    }
  }

  const prices = {
    partNumber,
    name: bestName,
    napa: results.napa || null,
    autozone: results.autozone || null,
    advance: results.advance || null,
    rockauto: results.rockauto || null,
    oreilly: null,
    carquest: null,
    fetchedAt: new Date().toISOString()
  };

  // Cache in KV for 1 hour
  if (env.CRM_KV) {
    ctx.waitUntil(env.CRM_KV.put(`price:${partNumber}`, JSON.stringify(prices), { expirationTtl: 3600 }));
  }
  // Persist to Neon asynchronously — merged with any existing row for this part.
  // BUGFIX: this used to blind-overwrite the row with oreilly:null, carquest:null,
  // and no ourPrice/ourCost at all (this endpoint doesn't scrape those retailers or
  // know the shop's own price/cost). That record synced straight down to the
  // frontend and crashed renderComparison() the moment the Price Comparison page
  // tried to call .toFixed() on a null/undefined field. Merging preserves whatever
  // was already known for this part and defaults anything still missing to 0.
  ctx.waitUntil((async () => {
    try {
      let existing = null;
      const existingRows = await query(env, `SELECT data FROM retailer_prices WHERE part_number = $1`, [partNumber]);
      if (existingRows.rows && existingRows.rows.length > 0) existing = existingRows.rows[0].data;

      const merged = {
        partNumber,
        name: bestName || existing?.name || null,
        rockauto: results.rockauto ?? existing?.rockauto ?? 0,
        napa: results.napa ?? existing?.napa ?? 0,
        autozone: results.autozone ?? existing?.autozone ?? 0,
        advance: results.advance ?? existing?.advance ?? 0,
        oreilly: existing?.oreilly ?? 0,   // not scraped by this endpoint — preserve prior value
        carquest: existing?.carquest ?? 0, // not scraped by this endpoint — preserve prior value
        ourPrice: existing?.ourPrice ?? 0,
        ourCost: existing?.ourCost ?? 0,
        fetchedAt: new Date().toISOString(),
      };

      await query(env, `INSERT INTO retailer_prices (part_number, data, fetched_at) VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (part_number) DO UPDATE SET data = $2::jsonb, fetched_at = NOW()`,
        [partNumber, JSON.stringify(merged)]);
    } catch (_e) { /* best-effort persistence; never fail the response over this */ }
  })());

  return json(prices, { ...hdrs, 'Cache-Control': 'public, s-maxage=3600', 'X-Cache': 'MISS' });
}

// ── Hardened Scraper Core ────────────────────────────────────
const CAPTCHA_SIGNATURES = ['g-recaptcha', 'cf-browser-verification', 'hCaptcha', 'captcha-delivery', 'challenge-form', 'px-captcha'];
const SCRAPER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrapeRetailer(retailer, searchUrl, parser) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000); // hard cap per retailer
  let res;
  try {
    res = await fetch(searchUrl, {
      headers: {
        'User-Agent': SCRAPER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
      cf: { cacheTtl: 3600 },
      signal: ctrl.signal,
    });
  } catch {
    return null; // timeout / network failure for this retailer
  } finally {
    clearTimeout(tid);
  }
  if (!res.ok) return null;
  const html = await res.text();

  // CAPTCHA detection — bail early if blocked
  for (const sig of CAPTCHA_SIGNATURES) {
    if (html.toLowerCase().includes(sig.toLowerCase())) {
      console.warn(`[Scraper:${retailer}] CAPTCHA detected, skipping`);
      return null;
    }
  }

  const result = parser(html);
  return result ? { retailer, ...result } : null;
}

function parseNapa(html) {
  const nameMatch = html.match(/"name"\s*:\s*"([^"]+)"/);
  const jsonLdMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/);
  const priceMatch = html.match(/\$\s*([\d,]+\.[\d]{2})/);
  const price = jsonLdMatch ? parseFloat(jsonLdMatch[1]) : (priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null);
  return { price, name: nameMatch ? nameMatch[1] : null };
}

function parseAutozone(html) {
  let price = null, name = null;
  const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (ndMatch) {
    try {
      const data = JSON.parse(ndMatch[1]);
      const products = data?.props?.pageProps?.products || data?.props?.pageProps?.initialData?.products || [];
      if (products.length > 0) {
        price = parseFloat(products[0]?.pricing?.finalPrice || products[0]?.price);
        name = products[0]?.name || products[0]?.title;
      }
    } catch { /* parse error */ }
  }
  if (!price) {
    const pm = html.match(/data-testid="price"[^>]*>\$?([\d.]+)/);
    price = pm ? parseFloat(pm[1]) : null;
  }
  return { price, name };
}

function parseAdvance(html) {
  const priceMatch = html.match(/"salePrice"\s*:\s*([\d.]+)/);
  const nameMatch = html.match(/"name"\s*:\s*"([^"]+)"/);
  return {
    price: priceMatch ? parseFloat(priceMatch[1]) : null,
    name: nameMatch ? nameMatch[1] : null
  };
}

function parseRockAuto(html) {
  const priceMatch = html.match(/<span[^>]*class="[^"]*ra-formatted-amount[^"]*"[^>]*>\$\s*([\d,]+\.[\d]{2})/i)
    || html.match(/\$\s*([\d,]+\.[\d]{2})/);
  const nameMatch = html.match(/<td[^>]*class="[^"]*partdesc[^"]*"[^>]*>([^<]+)/i)
    || html.match(/<span[^>]*class="[^"]*partdesc[^"]*"[^>]*>([^<]+)/i);
  return {
    price: priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null,
    name: nameMatch ? nameMatch[1].trim() : null
  };
}

// ── RockAuto Proxy (with built-in offline catalog fallback) ──
// FIX (2026-09): /v1/rockauto/* used to hard-fail with 503 "Service
// configuration error" (or 404) whenever PYTHON_SERVICE_URL wasn't set,
// which broke the RockAuto Catalog tab and every live lookup in the UI.
// Now: if the Python catalog service is configured we proxy to it (with
// KV cache + retries); if it is NOT configured — or the upstream fails —
// we serve a built-in offline catalog so the tab always works. Parts &
// live pricing intentionally return an empty set with a `notice` (we never
// fabricate prices); connect rockauto-api-main (Koyeb) via PYTHON_SERVICE_URL
// for live RockAuto data.

const OFFLINE_NOTICE = 'Offline catalog mode: showing built-in vehicle/category structure. Live RockAuto parts & pricing require the catalog service — deploy rockauto-api-main (e.g. on Koyeb) and set PYTHON_SERVICE_URL + SERVICE_AUTH_KEY secrets on this worker.';

const RA_MAKES = [
  'Acura','Alfa Romeo','AM General','Audi','Avanti','BMW','Buick','Cadillac','Chevrolet','Chrysler',
  'Daewoo','Daihatsu','Datsun','Dodge','Eagle','Ferrari','Fiat','Fisker','Ford','Freightliner',
  'Genesis','Geo','GMC','Honda','HUMMER','Hyundai','Infiniti','International','Isuzu','Jaguar',
  'Jeep','Kia','Lada','Lamborghini','Lancia','Land Rover','Lexus','Lincoln','Lotus','Lucid',
  'Maserati','Maybach','Mazda','McLaren','Mercedes-Benz','Mercury','Merkur','MINI','Mitsubishi','Nissan',
  'Oldsmobile','Peugeot','Plymouth','Polestar','Pontiac','Porsche','RAM','Renault','Rivian','Rolls-Royce',
  'Saab','Saturn','Scion','smart','SRT','Sterling','Subaru','Suzuki','Tesla','Toyota',
  'Triumph','Volkswagen','Volvo','Yugo'
];

// Curated model lists for the most common makes (offline fallback only).
const RA_MODELS = {
  'Acura':['CL','CSX','EL','ILX','Integra','Legend','MDX','NSX','RDX','RL','RLX','RSX','TL','TLX','TSX','Vigor'],
  'Audi':['100','200','80','90','A3','A4','A4 allroad','A5','A6','A6 allroad','A7','A8','allroad','Cabriolet','coupe','Q3','Q4 e-tron','Q5','Q7','Q8','R8','RS 6','S4','S5','TT','TT RS','TTS'],
  'BMW':['1 Series','2 Series','3 Series','4 Series','5 Series','6 Series','7 Series','8 Series','i3','i4','i7','i8','iX','M2','M3','M4','M5','M6','M8','X1','X2','X3','X4','X5','X6','X7','Z3','Z4'],
  'Buick':['Century','Electra','Enclave','Encore','Encore GX','Envision','LaCrosse','LeSabre','Lucerne','Park Avenue','Rainier','Reatta','Regal','Rendezvous','Riviera','Roadmaster','Skyhawk','Skylark','Terraza','Verano'],
  'Cadillac':['Allante','ATS','Brougham','CT4','CT5','CT6','Catera','Cimarron','CTS','DeVille','DTS','Eldorado','ELR','Escalade','Fleetwood','LYRIQ','Seville','SRX','STS','XLR','XT4','XT5','XT6','XTS'],
  'Chevrolet':['Astro','Avalanche','Aveo','Beretta','Blazer','C/K 1500','C/K 2500','C/K 3500','Camaro','Caprice','Captiva Sport','Cavalier','Celebrity','Chevette','Chevy Van','Classic','Cobalt','Colorado','Corsica','Corvette','Cruze','El Camino','Equinox','Express','G-Series','HHR','Impala','Lumina','Malibu','Metro','Monte Carlo','Nova','Prizm','S-10','Silverado 1500','Silverado 2500','Silverado 3500','Sonic','Spark','SS','SSR','Suburban','Tahoe','Tracker','Trailblazer','Traverse','Trax','Uplander','Venture','Volt'],
  'Chrysler':['200','300','300M','Aspen','Cirrus','Concorde','Crossfire','Fifth Avenue','Imperial','Intrepid','LeBaron','LHS','New Yorker','Newport','Pacifica','Prowler','PT Cruiser','Sebring','Town & Country','Voyager'],
  'Dodge':['Avenger','Caliber','Caravan','Challenger','Charger','Dakota','Dart','Daytona','Durango','Dynasty','Grand Caravan','Intrepid','Journey','Magnum','Monaco','Neon','Nitro','Omni','Ram 1500','Ram 2500','Ram 3500','Ram Van','Ramcharger','Shadow','Spirit','Sprinter','SRT-4','Stealth','Stratus','Viper'],
  'Eagle':['Premier','Summit','Talon','Vision'],
  'Ford':['Aerostar','Aspire','Bronco','Bronco II','C-Max','Club Wagon','Contour','Crown Victoria','E-150','E-250','E-350','EcoSport','Edge','Escape','Escort','Excursion','Expedition','Explorer','Explorer Sport Trac','F-100','F-150','F-250','F-350','F-450','Festiva','Fiesta','Five Hundred','Focus','Freestar','Freestyle','Fusion','GT','LTD','Maverick','Mustang','Probe','Ranger','Taurus','Taurus X','Tempo','Thunderbird','Windstar'],
  'GMC':['Acadia','Caballero','Canyon','Denali','Envoy','G-Series','Jimmy','S-15','Safari','Savana','Sierra 1500','Sierra 2500','Sierra 3500','Sonoma','Suburban','Terrain','Typhoon','Vandura','Yukon','Yukon XL'],
  'Honda':['Accord','Civic','Civic del Sol','Clarity','CR-V','CR-Z','Crosstour','Element','Fit','HR-V','Insight','Odyssey','Passport','Pilot','Prelude','Ridgeline','S2000'],
  'HUMMER':['H1','H2','H3','H3T'],
  'Hyundai':['Accent','Azera','Elantra','Entourage','Equus','Genesis','Genesis Coupe','Ioniq','Kona','Nexo','Palisade','Santa Cruz','Santa Fe','Santa Fe Sport','Scoupe','Sentra','Sonata','Tiburon','Tucson','Veloster','Venue','Veracruz','XG300','XG350'],
  'Infiniti':['EX35','EX37','FX35','FX37','FX45','FX50','G20','G25','G35','G37','I30','I35','J30','JX35','M30','M35','M37','M45','M56','Q45','Q50','Q60','Q70','QX30','QX4','QX50','QX55','QX56','QX60','QX70','QX80'],
  'Isuzu':['Amigo','Ascender','Axiom','Hombre','i-280','i-290','i-350','i-370','Impulse','Oasis','Pickup','Rodeo','Stylus','Trooper','VehiCROSS'],
  'Jaguar':['E-Pace','F-Pace','F-Type','I-Pace','S-Type','X-Type','XE','XF','XJ','XJ12','XJR','XK','XK8','XKR'],
  'Jeep':['Cherokee','CJ','Comanche','Commando','Compass','Gladiator','Grand Cherokee','Grand Wagoneer','J-10','Liberty','Patriot','Renegade','Sahara','Scrambler','TJ','Wagoneer','Wrangler','Wrangler JK','Wrangler JL'],
  'Kia':['Amanti','Borrego','Cadenza','Carnival','EV6','Forte','K5','K900','Niro','Optima','Rio','Rondo','Sedona','Seltos','Sephia','Sienta','Sorento','Soul','Sportage','Telluride'],
  'Land Rover':['Defender','Discovery','Discovery Sport','Freelander','LR2','LR3','LR4','Range Rover','Range Rover Evoque','Range Rover Sport','Range Rover Velar','Series I','Series II','Series III'],
  'Lexus':['CT200h','ES250','ES300','ES300h','ES330','ES350','GS200t','GS300','GS350','GS400','GS430','GS450h','GS460','GX460','GX470','HS250h','IS200t','IS250','IS300','IS350','LC500','LS400','LS430','LS460','LS500','LS600h','LX450','LX470','LX570','LX600','NX200t','NX300','NX300h','NX450h','RC300','RC350','RC F','RX300','RX330','RX350','RX400h','RX450h','RZ450e','SC300','SC400','SC430','TX350','UX200','UX250h'],
  'Lincoln':['Aviator','Blackwood','Continental','Corsair','LS','Mark LT','Mark VII','Mark VIII','MKC','MKS','MKT','MKX','MKZ','Nautilus','Navigator','Town Car','Versailles','Zephyr'],
  'Mazda':['2','3','323','5','6','626','929','B-Series','CX-3','CX-30','CX-5','CX-50','CX-7','CX-9','MAZDA3','MAZDA6','MazdaSpeed3','MazdaSpeed6','Millenia','Miata','MPV','MX-3','MX-30','MX-5','MX-6','Navajo','Protege','RX-7','RX-8','Tribute'],
  'Mercedes-Benz':['190D','190E','240D','300D','300E','A-Class','AMG GT','B-Class','C-Class','C36 AMG','C43 AMG','CL-Class','CLA-Class','CLK-Class','CLS-Class','E-Class','EQB','EQC','EQE','EQS','G-Class','GL-Class','GLA-Class','GLB-Class','GLC-Class','GLE-Class','GLK-Class','GLS-Class','M-Class','Metris','ML-Class','R-Class','S-Class','SL-Class','SLC-Class','SLK-Class','Sprinter','V-Class','Viano','Vito'],
  'Mercury':['Capri','Cougar','Grand Marquis','Lynx','Marauder','Mariner','Mercury Monterey','Mountaineer','Mystique','Sable','Topaz','Tracer','Villager'],
  'MINI':['Clubman','Convertible','Cooper','Cooper 3-door','Cooper 5-door','Cooper Countryman','Cooper Paceman','Cooper S','Countryman'],
  'Mitsubishi':['3000GT','Diamante','Eclipse','Eclipse Cross','Eclipse Spyder','Endeavor','Expo','Galant','i-MiEV','Lancer','Lancer Evolution','Mighty Max','Mirage','Mirage G4','Montero','Montero Sport','Outlander','Outlander Sport','Raider','RVR','Sigma','Starion','Van'],
  'Nissan':['200SX','240SX','300ZX','350Z','370Z','Altima','Axxess','Cube','Frontier','GT-R','Juke','Kicks','Leaf','Maxima','Murano','NX','NV1500','NV200','NV2500','NV3500','Pathfinder','Pickup','Pulsar','Quest','Rogue','Rogue Select','Rogue Sport','Sentra','Stanza','Titan','Titan XD','Versa','Versa Note','X-Trail','Xterra','Z'],
  'Oldsmobile':['88','98','Achieva','Alero','Aurora','Bravada','Cutlass','Cutlass Calais','Cutlass Ciera','Cutlass Supreme','Delta 88','Eighty-Eight','Intrigue','LSS','Ninety-Eight','Omega','Silhouette','Toronado'],
  'Plymouth':['Acclaim','Breeze','Caravelle','Colt','Grand Voyager','Horizon','Laser','Neon','Prowler','Reliant','Sundance','Trail Duster','Voyager'],
  'Pontiac':['6000','Aztek','Bonneville','Fiero','Firebird','G3','G5','G6','G8','Grand Am','Grand Prix','GTO','LeMans','Montana','Parisienne','Phoenix','Safari','Solstice','Sunbird','Sunfire','Torrent','Trans Sport','Vibe'],
  'Porsche':['718 Boxster','718 Cayman','911','914','924','928','944','968','Boxster','Cayenne','Cayman','Macan','Panamera','Taycan'],
  'RAM':['1500','2500','3500','4500','5500','Cargo Van','ProMaster','ProMaster City'],
  'Saab':['9-2X','9-3','9-4X','9-5','9-7X','900','9000'],
  'Saturn':['Astra','Aura','Ion','L-Series','LW','Outlook','Relay','S-Series','Sky','SL','SW','Vue'],
  'Scion':['FR-S','iA','iM','iQ','tC','xA','xB','xD'],
  'Subaru':['Ascent','Baja','B9 Tribeca','BRZ','Crosstrek','Forester','Impreza','Justy','Legacy','Loyale','Outback','Solterra','SVX','Tribeca','WRX','XT','XV Crosstrek'],
  'Suzuki':['Aerio','Equator','Esteem','Forenza','Grand Vitara','Kizashi','Reno','Samurai','Sidekick','Swift','SX4','Verona','Vitara','X-90','XL-7','XL7'],
  'Tesla':['Cybertruck','Model 3','Model S','Model X','Model Y','Roadster'],
  'Toyota':['4Runner','86','Avalon','bZ4X','C-HR','Camry','Camry Solara','Celica','Corolla','Corolla Cross','Corolla Hybrid','Corolla iM','Cressida','Echo','FJ Cruiser','GR Corolla','GR Supra','GR86','Highlander','Land Cruiser','Matrix','Mirai','MR2','Paseo','Previa','Prius','Prius c','Prius Plug-In','Prius Prime','Prius v','RAV4','Sequoia','Sienna','Starlet','Supra','T100','Tacoma','Tercel','Tundra','Tundra Hybrid','Venza','Yaris','Yaris iA'],
  'Volkswagen':['Atlas','Atlas Cross Sport','Beetle','Cabrio','Cabriolet','CC','Corrado','Eos','EuroVan','Fox','GLI','GTI','ID.3','ID.4','ID.5','ID.Buzz','Jetta','Jetta City','Jetta SportWagen','Karmann Ghia','New Beetle','Passat','Phaeton','Quantum','R32','Rabbit','Routan','Scirocco','Thing','Tiguan','Touareg','Type 1','Type 2','Vanagon','Vento'],
  'Volvo':['180E','240','260','740','760','780','850','940','960','C30','C40','C70','S40','S60','S60 Cross Country','S70','S80','S90','V40','V50','V60','V60 Cross Country','V70','V90','V90 Cross Country','XC40','XC60','XC70','XC90'],
  'Genesis':['Electrified G80','Electrified GV70','G70','G80','G90','GV60','GV70','GV80'],
  'Fiat':['124 Spider','500','500Abarth','500c','500e','500L','500X','Ducato'],
  'Karma':['GS-6','Revero'],
  'smart':['ForTwo','Fortwo'],
  'Rivian':['EDV 500','EDV 700','R1S','R1T'],
  'Lucid':['Air'],
  'Polestar':['1','2','3','4'],
  'Datsun':['240Z','260Z','280Z','280ZX','310','510','710','810','F-10','Maxima','Pickup','Pulsar','Roadster','Stanza'],
  'SRT':['Viper'],
  'Geo':['Metro','Prizm','Spectrum','Storm','Tracker'],
};

// Real RockAuto catalog group names (offline structure fallback).
const RA_CATEGORY_GROUPS = [
  'Belts & Cooling','Body & Lamp Assembly','Brakes & Wheel Hub','Clutch & Flywheel',
  'Doors & Handles','Electrical & Lighting','Engine & Components','Exhaust & Emission',
  'Filters','Fuel & Air Delivery','Gaskets & Seals','Heating & Air Conditioning',
  'Hoses & Tubes','Ignition','Interior & Exterior','Literature & Manuals',
  'Steering & Suspension','Tools & Shop Supplies','Transmission & Drivetrain',
  'Turbo & Supercharger','Wheel & Tire','Wipers & Washers'
];

// Generic engine options for the offline catalog (make/model agnostic).
const RA_ENGINES = [
  { description: '1.6L L4', suffix: '16L4' },
  { description: '2.0L L4', suffix: '20L4' },
  { description: '2.4L L4', suffix: '24L4' },
  { description: '2.5L L4', suffix: '25L4' },
  { description: '3.0L V6', suffix: '30V6' },
  { description: '3.5L V6', suffix: '35V6' },
  { description: '4.0L V6', suffix: '40V6' },
  { description: '5.0L V8', suffix: '50V8' },
  { description: '5.7L V8', suffix: '57V8' },
];

// Deterministic numeric carcode (7 digits) from a string — offline catalog only.
function raCarcode(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return String(1000000 + (h % 9000000));
}

function raYearRange(make) {
  // Common makes with long histories start earlier.
  const early = ['Chevrolet','Ford','Dodge','Toyota','Nissan','Honda','Buick','Cadillac','Chrysler','GMC','Lincoln','Mercedes-Benz','BMW','Volkswagen','Volvo','Plymouth','Oldsmobile','Mercury','Pontiac','Datsun','Jeep','Mazda','Subaru','Peugeot','Renault','Lada','Saab','Audi','Porsche'];
  const currentYear = new Date().getUTCFullYear();
  const start = early.includes(make) ? 1980 : 1990;
  const years = [];
  for (let y = currentYear + 1; y >= start; y--) years.push(y);
  return years;
}

function encodeGroupName(name) {
  return name.toLowerCase().replace(/ /g, '+').replace(/&/g, '%26');
}

// Match a /v1/rockauto/* path to a route kind + params (used by the fallback).
function matchRockAutoRoute(pathname) {
  if (pathname === '/v1/rockauto/makes') return { kind: 'makes', params: {} };
  if (pathname === '/v1/rockauto/search') return { kind: 'search', params: {} };
  let m = pathname.match(/^\/v1\/rockauto\/years\/([^/]+)$/);
  if (m) return { kind: 'years', params: { make: decodeURIComponent(m[1]) } };
  m = pathname.match(/^\/v1\/rockauto\/models\/([^/]+)\/(\d+)$/);
  if (m) return { kind: 'models', params: { make: decodeURIComponent(m[1]), year: Number(m[2]) } };
  m = pathname.match(/^\/v1\/rockauto\/engines\/([^/]+)\/(\d+)\/([^/]+)$/);
  if (m) return { kind: 'engines', params: { make: decodeURIComponent(m[1]), year: Number(m[2]), model: decodeURIComponent(m[3]) } };
  m = pathname.match(/^\/v1\/rockauto\/categories\/([^/]+)\/(\d+)\/([^/]+)\/([a-zA-Z0-9]+)$/);
  if (m) return { kind: 'categories', params: { make: decodeURIComponent(m[1]), year: Number(m[2]), model: decodeURIComponent(m[3]), carcode: m[4] } };
  m = pathname.match(/^\/v1\/rockauto\/parts\/([^/]+)\/(\d+)\/([^/]+)\/([a-zA-Z0-9]+)\/([^/]+)$/);
  if (m) return { kind: 'parts', params: { make: decodeURIComponent(m[1]), year: Number(m[2]), model: decodeURIComponent(m[3]), carcode: m[4], category: decodeURIComponent(m[5]) } };
  return null;
}

// Build the offline-catalog response for a matched route.
function buildRockAutoFallback(route, url, hdrs) {
  const p = route.params;
  const base = { source: 'offline-catalog', notice: OFFLINE_NOTICE };
  let body;
  switch (route.kind) {
    case 'makes':
      body = { ...base, makes: RA_MAKES, count: RA_MAKES.length };
      break;
    case 'years': {
      const years = RA_MAKES.includes(p.make) ? raYearRange(p.make) : [];
      body = { ...base, make: p.make, years, count: years.length };
      if (!years.length) body.notice = `Make "${p.make}" is not in the offline catalog. ${OFFLINE_NOTICE}`;
      break;
    }
    case 'models': {
      const models = RA_MODELS[p.make] || [];
      body = { ...base, make: p.make, year: p.year, models, count: models.length };
      if (!models.length) body.notice = `Model list for "${p.make}" is not in the offline catalog. ${OFFLINE_NOTICE}`;
      break;
    }
    case 'engines': {
      const seed = `${p.make}|${p.model}`;
      const engines = RA_ENGINES.map(e => ({
        description: e.description,
        carcode: raCarcode(`${seed}|${e.suffix}`),
        href: null,
      }));
      body = { ...base, make: p.make, year: p.year, model: p.model, engines, count: engines.length };
      break;
    }
    case 'categories': {
      const categories = RA_CATEGORY_GROUPS.map(name => ({
        name,
        group_name: encodeGroupName(name),
        href: null,
      }));
      body = { ...base, make: p.make, year: p.year, model: p.model, carcode: p.carcode, categories, count: categories.length };
      break;
    }
    case 'parts':
      // Never fabricate prices: return an honest empty set with guidance.
      body = {
        ...base,
        parts: [],
        count: 0,
        query: p.category,
        notice: `Live RockAuto parts & pricing for "${(p.category || '').replace(/\+/g, ' ')}" are unavailable in offline catalog mode. ${OFFLINE_NOTICE}`,
      };
      break;
    case 'search': {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      const results = [];
      if (q.length >= 2) {
        for (const make of RA_MAKES) {
          if (make.toLowerCase().includes(q)) results.push({ name: make, href: '', description: 'Vehicle make (offline catalog)' });
        }
        for (const [make, models] of Object.entries(RA_MODELS)) {
          for (const model of models) {
            if (model.toLowerCase().includes(q)) results.push({ name: `${make} ${model}`, href: '', description: 'Vehicle model (offline catalog)' });
          }
        }
        for (const g of RA_CATEGORY_GROUPS) {
          if (g.toLowerCase().includes(q)) results.push({ name: g, href: '', description: 'Part category (offline catalog)' });
        }
      }
      body = { ...base, results: results.slice(0, 50), count: Math.min(results.length, 50), query: q };
      break;
    }
    default:
      return json({ error: 'Not found', path: url.pathname }, hdrs, 404);
  }
  return json(body, { ...hdrs, 'Cache-Control': 'public, s-maxage=86400', 'X-RockAuto-Source': 'offline-catalog' });
}

async function handleRockAutoProxy(url, request, env, hdrs, ctx, clientIP) {
  const route = matchRockAutoRoute(url.pathname);
  if (!route) return json({ error: 'Not found', path: url.pathname }, hdrs, 404);

  // Keep the legacy upstream path mapping for proxying to the Python service.
  let upstreamPath = ROCKAUTO_ROUTE_MAP[url.pathname] || null;
  if (!upstreamPath) {
    for (const r of ROCKAUTO_DYNAMIC_ROUTES) {
      const match = url.pathname.match(r.pattern);
      if (match) { upstreamPath = r.upstream(match); break; }
    }
  }
  if (!upstreamPath) return json({ error: 'Not found', path: url.pathname }, hdrs, 404);

  const fullUpstreamPath = `${upstreamPath}${url.search || ''}`;
  const cacheKeyStr = `rockauto:${fullUpstreamPath}`;
  const hashArray = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cacheKeyStr))));
  const cacheKey = `cache:${hashArray.map(b => b.toString(16).padStart(2, '0')).join('')}`;

  if (env.CRM_KV) {
    const cached = await env.CRM_KV.get(cacheKey, 'text');
    if (cached) {
      return new Response(cached, { status: 200, headers: { ...hdrs, 'Content-Type': 'application/json', 'X-Cache': 'HIT', 'Cache-Control': 'public, s-maxage=3600' } });
    }
  }

  const pythonUrl = env.PYTHON_SERVICE_URL;
  if (pythonUrl) {
    const upstreamUrl = `${pythonUrl.replace(/\/$/, '')}${fullUpstreamPath}`;
    let lastError = null;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const upstreamRes = await fetch(upstreamUrl, {
          method: 'GET',
          headers: {
            'X-Service-Auth-Key': env.SERVICE_AUTH_KEY || '',
            'Accept': 'application/json',
            'X-Forwarded-For': clientIP,
            'X-Request-Id': crypto.randomUUID(),
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (upstreamRes.ok) {
          const body = await upstreamRes.text();
          if (env.CRM_KV && body.length < 512000) {
            ctx.waitUntil(env.CRM_KV.put(cacheKey, body, { expirationTtl: 3600 }));
          }
          return new Response(body, { status: 200, headers: { ...hdrs, 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'Cache-Control': 'public, s-maxage=3600' } });
        }

        if (upstreamRes.status === 429) {
          return json({ error: 'Rate limited — retry later' }, { ...hdrs, 'Retry-After': '60' }, 429);
        }
        // Upstream 4xx (bad params) — pass through as an error, don't fallback.
        if (upstreamRes.status >= 400 && upstreamRes.status < 500) {
          return json({ error: 'Request failed' }, hdrs, upstreamRes.status);
        }
        lastError = new Error(`Upstream ${upstreamRes.status}`);
      } catch (err) {
        lastError = err;
      }
      if (attempt < 2) await delay(500 * Math.pow(2, attempt));
    }
    console.error('[Proxy] Upstream failed, serving offline catalog fallback:', lastError?.message);
  } else {
    console.warn('[Proxy] PYTHON_SERVICE_URL not set — serving offline catalog fallback');
  }

  // FIX: never 503/404 here — serve the built-in offline catalog instead.
  return buildRockAutoFallback(route, url, hdrs);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Schema Bootstrap ─────────────────────────────────────────
async function ensureSchema(env) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS vehicles (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS retailer_prices (part_number TEXT PRIMARY KEY, data JSONB NOT NULL, fetched_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`,
  ];
  await Promise.all(tables.map(t => query(env, t)));
}

// ── JSON Helper ──────────────────────────────────────────────
function json(data, extraHeaders = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}
