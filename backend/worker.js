import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

/**
 * ============================================================
 * PartsCommand CRM — Cloudflare Worker v3.0.0
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
  retailerPrices: z.array(z.object({ partNumber: z.string() }).passthrough()).optional(),
  auditLogs: z.array(z.object({ id: z.string(), action: z.string() }).passthrough()).optional(),
  settings: z.record(z.string(), z.any()).optional(),
}).passthrough();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ── Main Handler ─────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

    const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || '*'; 
    const origin = request.headers.get('Origin') || '';
    const corsOrigin = ALLOWED_ORIGIN === '*' ? '*' : ALLOWED_ORIGIN;

    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-None-Match',
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
    if (ALLOWED_ORIGIN !== '*' && origin && origin !== ALLOWED_ORIGIN) {
      return json({ error: 'Forbidden origin' }, hdrs, 403);
    }

    try {
      // ── Rate Limiting (5 req/s per IP via KV) ──
      if (env.CRM_KV) {
        const rlKey = `rl:${clientIP}:${Math.floor(Date.now() / 1000)}`;
        const cur = parseInt(await env.CRM_KV.get(rlKey) || '0');
        if (cur >= 5) return json({ error: 'Rate limit exceeded' }, hdrs, 429);
        ctx.waitUntil(env.CRM_KV.put(rlKey, String(cur + 1), { expirationTtl: 2 }));
      }

      // ── Public Routes ──
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '') {
        return json({ message: 'PartsCommand CRM API', status: 'online', version: '3.0.0' }, hdrs);
      }
      if (url.pathname === '/favicon.ico') return new Response(null, { status: 204, headers: hdrs });
      if (url.pathname === '/health') return json({ status: 'ok', ts: new Date().toISOString() }, hdrs);
      if (url.pathname === '/auth/login' && request.method === 'POST') return handleLogin(request, env, hdrs);
      if (url.pathname === '/auth/logout' && request.method === 'POST') return handleLogout(request, env, hdrs);

      // ── JWT Auth Middleware (enforced when JWT_SECRET is set) ──
      let user = null;
      if (env.JWT_SECRET) {
        const authH = request.headers.get('Authorization');
        if (!authH || !authH.startsWith('Bearer ')) {
          return json({ error: 'Authorization required' }, hdrs, 401);
        }
        try {
          user = jwt.verify(authH.substring(7), env.JWT_SECRET);
        } catch {
          return json({ error: 'Invalid or expired token' }, hdrs, 401);
        }
        if (env.CRM_KV) {
          const sess = await env.CRM_KV.get(`session:${user.id}`);
          if (!sess || sess !== authH.substring(7)) {
            return json({ error: 'Session expired or revoked' }, hdrs, 401);
          }
        }
      }

      // ── Protected Routes ──
      if (url.pathname === '/sync') {
        if (request.method === 'GET') return handleSyncGet(env, request, hdrs);
        if (request.method === 'POST') return handleSyncPost(request, env, hdrs, user, clientIP, ctx);
      }
      if (url.pathname === '/prices' && request.method === 'GET') {
        return handlePriceLookup(url, env, hdrs, ctx);
      }

      return json({ error: 'Not found', path: url.pathname }, hdrs, 404);
    } catch (err) {
      console.error('[Worker] Unhandled:', err);
      return json({ error: 'Internal server error', detail: err.message }, hdrs, 500);
    }
  }
};

// ── DB Helper ────────────────────────────────────────────────
async function query(env, sqlStr, params = []) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL not configured');
  const sql = neon(env.DATABASE_URL);
  const result = await sql.query(sqlStr, params);
  return { rows: result };
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
    const [inv, cust, veh, sales, prices, logs, settings] = await Promise.all([
      query(env, 'SELECT data FROM inventory ORDER BY created_at'),
      query(env, 'SELECT data FROM customers ORDER BY created_at'),
      query(env, 'SELECT data FROM vehicles ORDER BY created_at'),
      query(env, 'SELECT data FROM sales ORDER BY created_at'),
      query(env, 'SELECT data FROM retailer_prices ORDER BY fetched_at DESC'),
      query(env, 'SELECT data FROM audit_logs ORDER BY created_at DESC LIMIT 500'),
      query(env, 'SELECT data FROM settings WHERE id = $1', ['app_settings']),
    ]);

    const db = {
      inventory:      (inv.rows    || []).map(r => r.data),
      customers:      (cust.rows   || []).map(r => r.data),
      vehicles:       (veh.rows    || []).map(r => r.data),
      sales:          (sales.rows  || []).map(r => r.data),
      retailerPrices: (prices.rows || []).map(r => r.data),
      auditLogs:      (logs.rows   || []).map(r => r.data),
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
      headers: { ...hdrs, 'Content-Type': 'application/json', ETag: etag }
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
      }
    };
    ops.push(query(env,
      `INSERT INTO audit_logs (id, data, created_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id) DO NOTHING`, [auditEntry.id, JSON.stringify(auditEntry)]));

    await Promise.allSettled(ops);
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

  // Sequential scraping with 2s delays + CAPTCHA detection
  const scrapers = [
    () => scrapeRetailer('napa', `https://www.napaonline.com/en/search?q=${encodeURIComponent(partNumber)}`, parseNapa),
    () => scrapeRetailer('autozone', `https://www.autozone.com/searchresult?searchText=${encodeURIComponent(partNumber)}`, parseAutozone),
    () => scrapeRetailer('advance', `https://shop.advanceautoparts.com/find/${encodeURIComponent(partNumber)}`, parseAdvance),
    () => scrapeRetailer('rockauto', `https://www.rockauto.com/en/partsearch/?partnum=${encodeURIComponent(partNumber)}`, parseRockAuto),
  ];

  const results = {};
  let bestName = null;
  for (let i = 0; i < scrapers.length; i++) {
    if (i > 0) await delay(2000); // 2s between retailer requests
    try {
      const r = await scrapers[i]();
      if (r) {
        results[r.retailer] = r.price;
        if (r.name && !bestName) bestName = r.name;
      }
    } catch { /* scraper failed, continue */ }
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
  // Persist to Neon asynchronously
  ctx.waitUntil(
    query(env, `INSERT INTO retailer_prices (part_number, data, fetched_at) VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (part_number) DO UPDATE SET data = $2::jsonb, fetched_at = NOW()`,
      [partNumber, JSON.stringify(prices)]).catch(() => {})
  );

  return json(prices, { ...hdrs, 'Cache-Control': 'public, s-maxage=3600', 'X-Cache': 'MISS' });
}

// ── Hardened Scraper Core ────────────────────────────────────
const CAPTCHA_SIGNATURES = ['g-recaptcha', 'cf-browser-verification', 'hCaptcha', 'captcha-delivery', 'challenge-form', 'px-captcha'];
const SCRAPER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrapeRetailer(retailer, searchUrl, parser) {
  const res = await fetch(searchUrl, {
    headers: {
      'User-Agent': SCRAPER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
    cf: { cacheTtl: 3600 }
  });
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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Schema Bootstrap ─────────────────────────────────────────
async function ensureSchema(env) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS vehicles (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
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
