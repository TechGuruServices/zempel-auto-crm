  import { neon } from '@neondatabase/serverless';

/**
 * ============================================================
 * PartsCommand CRM — Cloudflare Worker (Full API)
 * ============================================================
 *
 * Routes:
 *   GET  /               Welcome/Status message
 *   GET  /sync          Pull full database from Neon Postgres
 *   POST /sync          Push full database to Neon Postgres
 *   GET  /prices        Live competitor price lookup (scraper)
 *   GET  /health        Health check
 *   OPTIONS *           CORS preflight
 *
 * Environment bindings (set in Cloudflare dashboard or wrangler.toml):i
 *   DATABASE_URL        Neon Postgres connection string (pooled)
 *
 * Deploy: wrangler deploy --config wrangler.toml
 * ============================================================
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '') {
        return json({
          message: 'PartsCommand CRM API — Running',
          status: 'online',
          endpoints: ['/health', '/sync', '/prices'],
          docs: 'https://github.com/TechGuruServices/zempel-auto-crm'
        }, corsHeaders);
      }

      if (url.pathname === '/favicon.ico') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (url.pathname === '/health') {
        return json({ status: 'ok', ts: new Date().toISOString() }, corsHeaders);
      }

      if (url.pathname === '/sync') {
        if (request.method === 'GET') return handleSyncGet(env, corsHeaders);
        if (request.method === 'POST') return handleSyncPost(request, env, corsHeaders);
      }

      if (url.pathname === '/prices' && request.method === 'GET') {
        return handlePriceLookup(request, url, corsHeaders);
      }

      return json({ error: 'Not found', path: url.pathname }, corsHeaders, 404);
    } catch (err) {
      console.error('[Worker] Unhandled error:', err);
      return json({ error: 'Internal server error', detail: err.message }, corsHeaders, 500);
    }
  }
};


// ============================================================
// Neon Postgres helper (uses @neondatabase/serverless)
// ============================================================
async function query(env, sql, params = []) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL not configured');

  const sqlClient = neon(env.DATABASE_URL);

  // Executing the query using the official library
  const result = await sqlClient(sql, params);

  // existing code expects { rows: [...] }
  return { rows: result };
}

// ============================================================
// GET /sync — Pull full DB
// ============================================================
async function handleSyncGet(env, corsHeaders) {
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
      inventory:     (inv.rows    || []).map(r => r.data),
      customers:     (cust.rows   || []).map(r => r.data),
      vehicles:      (veh.rows    || []).map(r => r.data),
      sales:         (sales.rows  || []).map(r => r.data),
      retailerPrices:(prices.rows || []).map(r => r.data),
      auditLogs:     (logs.rows   || []).map(r => r.data),
      settings:      (settings.rows && settings.rows.length > 0) ? settings.rows[0].data : {},
    };

    return json(db, corsHeaders);
  } catch (err) {
    console.error('[GET /sync] DB error:', err);
    return json({ error: 'Database unavailable', detail: err.message }, corsHeaders, 503);
  }
}

// ============================================================
// POST /sync — Push full DB (upsert all records)
// ============================================================
async function handleSyncPost(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, corsHeaders, 400);
  }

  try {
    await ensureSchema(env);

    const ops = [];

    if (body.inventory?.length) {
      for (const item of body.inventory) {
        ops.push(query(env,
          `INSERT INTO inventory (id, data, created_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
          [item.id, JSON.stringify(item)]
        ));
      }
    }

    if (body.customers?.length) {
      for (const c of body.customers) {
        ops.push(query(env,
          `INSERT INTO customers (id, data, created_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
          [c.id, JSON.stringify(c)]
        ));
      }
    }

    if (body.vehicles?.length) {
      for (const v of body.vehicles) {
        ops.push(query(env,
          `INSERT INTO vehicles (id, data, created_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
          [v.id, JSON.stringify(v)]
        ));
      }
    }

    if (body.sales?.length) {
      for (const s of body.sales) {
        ops.push(query(env,
          `INSERT INTO sales (id, data, created_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
          [s.id, JSON.stringify(s)]
        ));
      }
    }

    if (body.retailerPrices?.length) {
      for (const p of body.retailerPrices) {
        ops.push(query(env,
          `INSERT INTO retailer_prices (part_number, data, fetched_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (part_number) DO UPDATE SET data = $2::jsonb, fetched_at = NOW()`,
          [p.partNumber, JSON.stringify(p)]
        ));
      }
    }

    if (body.auditLogs?.length) {
      for (const l of body.auditLogs.slice(0, 100)) {
        ops.push(query(env,
          `INSERT INTO audit_logs (id, data, created_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [l.id, JSON.stringify(l)]
        ));
      }
    }

    if (body.settings && Object.keys(body.settings).length > 0) {
      ops.push(query(env,
        `INSERT INTO settings (id, data, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
        ['app_settings', JSON.stringify(body.settings)]
      ));
    }

    await Promise.allSettled(ops);

    return json({ success: true, synced: new Date().toISOString() }, corsHeaders);
  } catch (err) {
    console.error('[POST /sync] DB error:', err);
    return json({ error: 'Sync failed', detail: err.message }, corsHeaders, 503);
  }
}

// ============================================================
// GET /prices — Competitor price lookup
// ============================================================
async function handlePriceLookup(request, url, corsHeaders) {
  const partNumber = url.searchParams.get('partNumber');
  const brand = url.searchParams.get('brand') || '';

  if (!partNumber) {
    return json({ error: 'partNumber query param required' }, corsHeaders, 400);
  }

  const results = await Promise.allSettled([
    scrapeNapa(partNumber, brand),
    scrapeAutozone(partNumber, brand),
    scrapeAdvanceAuto(partNumber, brand),
  ]);

  const napa = results[0].status === 'fulfilled' ? results[0].value : null;
  const autozone = results[1].status === 'fulfilled' ? results[1].value : null;
  const advance = results[2].status === 'fulfilled' ? results[2].value : null;

  // Extract the best name available from any of the scrapers
  const bestName = napa?.name || autozone?.name || advance?.name || null;

  const prices = {
    partNumber,
    name: bestName,
    napa:      napa?.price || null,
    autozone:  autozone?.price || null,
    advance:   advance?.price || null,
    rockauto:  null,
    oreilly:   null,
    carquest:  null,
    fetchedAt: new Date().toISOString()
  };

  return json(prices, {
    ...corsHeaders,
    'Cache-Control': 'public, s-maxage=3600'
  });
}

// ── Retailer scrapers ─────────────────────────────────────────────────────────

async function scrapeNapa(partNumber, brand) {
  try {
    const searchUrl = `https://www.napaonline.com/en/search?q=${encodeURIComponent(partNumber)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cf: { cacheTtl: 3600 }
    });
    if (!res.ok) return null;
    const html = await res.text();

    const nameMatch = html.match(/"name"\s*:\s*"([^"]+)"/);
    const jsonLdMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/);
    const priceMatch = html.match(/\$\s*([\d,]+\.[\d]{2})/);

    return {
      price: jsonLdMatch ? parseFloat(jsonLdMatch[1]) : (priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null),
      name: nameMatch ? nameMatch[1] : null
    };
  } catch {
    return null;
  }
}

async function scrapeAutozone(partNumber, brand) {
  try {
    const searchUrl = `https://www.autozone.com/searchresult?searchText=${encodeURIComponent(partNumber)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html',
      },
      cf: { cacheTtl: 3600 }
    });
    if (!res.ok) return null;
    const html = await res.text();

    let price = null;
    let name = null;

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const products = data?.props?.pageProps?.products ||
                         data?.props?.pageProps?.initialData?.products || [];
        if (products.length > 0) {
          price = parseFloat(products[0]?.pricing?.finalPrice || products[0]?.price);
          name = products[0]?.name || products[0]?.title;
        }
      } catch { }
    }

    if (!price) {
      const priceMatch = html.match(/data-testid="price"[^>]*>\$?([\d.]+)/);
      price = priceMatch ? parseFloat(priceMatch[1]) : null;
    }

    return { price, name };
  } catch {
    return null;
  }
}

async function scrapeAdvanceAuto(partNumber, brand) {
  try {
    const searchUrl = `https://shop.advanceautoparts.com/find/${encodeURIComponent(partNumber)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      cf: { cacheTtl: 3600 }
    });
    if (!res.ok) return null;
    const html = await res.text();

    const priceMatch = html.match(/"salePrice"\s*:\s*([\d.]+)/);
    const nameMatch = html.match(/"name"\s*:\s*"([^"]+)"/);

    return {
      price: priceMatch ? parseFloat(priceMatch[1]) : null,
      name: nameMatch ? nameMatch[1] : null
    };
  } catch {
    return null;
  }
}


// ============================================================
// Schema bootstrap — idempotent, runs on first request
// ============================================================
async function ensureSchema(env) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS inventory (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS customers (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS vehicles (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS sales (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS retailer_prices (
      part_number TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      fetched_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )`
  ];

  await Promise.all(tables.map(t => query(env, t)));
}

// ── JSON helper ───────────────────────────────────────────────────────────────
function json(data, extraHeaders = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    }
  });
}
