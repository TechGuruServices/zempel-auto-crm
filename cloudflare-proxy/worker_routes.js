/**
 * ============================================================
 * Zempel Auto Parts CRM — Cloudflare Worker Proxy v3.1.0
 * ============================================================
 * Proxy layer between PWA frontend and Python FastAPI service.
 *
 * Features:
 *   - KV cache with SHA-256 hashed keys and configurable TTL
 *   - Strict origin matching (no wildcards)
 *   - Per-request session isolation
 *   - Fetch timeout + retry with exponential backoff
 *   - Proxy error masking (never leak upstream details)
 *   - Rate limiting (5 req/s/IP via KV)
 *   - OWASP security headers
 *
 * Routes:
 *   GET  /health                                  Proxy health
 *   GET  /v1/rockauto/makes                       → Python /api/rockauto/makes
 *   GET  /v1/rockauto/years/:make                 → Python /api/rockauto/years/:make
 *   GET  /v1/rockauto/models/:make/:year          → Python /api/rockauto/models/:make/:year
 *   GET  /v1/rockauto/engines/:make/:year/:model  → Python /api/rockauto/engines/:make/:year/:model
 *   GET  /v1/rockauto/parts/:carcode              → Python /api/rockauto/parts/:carcode
 *   GET  /v1/rockauto/search?q=                   → Python /api/rockauto/search?q=
 *   OPTIONS *                                     CORS preflight
 *
 * Env bindings: PYTHON_SERVICE_URL, SERVICE_AUTH_KEY, PROXY_KV
 * Secrets: wrangler secret put SERVICE_AUTH_KEY
 *          wrangler secret put PYTHON_SERVICE_URL
 * ============================================================
 */

// ── Config ───────────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 5; // requests per second per IP
const KV_CACHE_TTL_S = 3600; // 1 hour cache TTL
const FETCH_TIMEOUT_MS = 15000; // 15s upstream timeout
const MAX_RETRIES = 2; // retry count on 5xx/timeout
const BASE_RETRY_DELAY_MS = 500;

// Strict CORS — only these origins are allowed (no wildcards ever)
const ALLOWED_ORIGINS = [
  'https://zempel-auto-crm.pages.dev',
  'https://zempelauto.techguruofficial.us',
];

// Route mapping: proxy path → upstream path
const ROUTE_MAP = {
  '/v1/rockauto/makes': '/api/rockauto/makes',
  '/v1/rockauto/search': '/api/rockauto/search',
};

// Dynamic route patterns (order matters — most specific first)
const DYNAMIC_ROUTES = [
  { pattern: /^\/v1\/rockauto\/engines\/([^/]+)\/(\d+)\/([^/]+)$/, upstream: (m) => `/api/rockauto/engines/${m[1]}/${m[2]}/${m[3]}` },
  { pattern: /^\/v1\/rockauto\/models\/([^/]+)\/(\d+)$/, upstream: (m) => `/api/rockauto/models/${m[1]}/${m[2]}` },
  { pattern: /^\/v1\/rockauto\/years\/([^/]+)$/, upstream: (m) => `/api/rockauto/years/${m[1]}` },
  { pattern: /^\/v1\/rockauto\/parts\/([a-zA-Z0-9]+)$/, upstream: (m) => `/api/rockauto/parts/${m[1]}` },
];

// ── Main Handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

    // ── CORS: strict origin matching ─────────────────────────
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';

    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    const secHeaders = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    };

    const hdrs = { ...corsHeaders, ...secHeaders };

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: hdrs });
    }

    // Reject disallowed origins (when Origin header is present)
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return jsonResponse({ error: 'Forbidden origin' }, hdrs, 403);
    }

    // Only GET is proxied
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, hdrs, 405);
    }

    // ── Rate Limiting (5 req/s/IP via KV) ────────────────────
    if (env.PROXY_KV) {
      const rlKey = `rl:${clientIP}:${Math.floor(Date.now() / 1000)}`;
      const cur = parseInt(await env.PROXY_KV.get(rlKey) || '0', 10);
      if (cur >= RATE_LIMIT_MAX) {
        return jsonResponse(
          { error: 'Rate limit exceeded' },
          { ...hdrs, 'Retry-After': '1' },
          429,
        );
      }
      ctx.waitUntil(env.PROXY_KV.put(rlKey, String(cur + 1), { expirationTtl: 2 }));
    }

    // ── Health ────────────────────────────────────────────────
    if (url.pathname === '/health' || url.pathname === '/') {
      return jsonResponse(
        { status: 'ok', service: 'cloudflare-proxy', version: '3.1.0', ts: new Date().toISOString() },
        hdrs,
      );
    }

    // ── Route Resolution ─────────────────────────────────────
    let upstreamPath = ROUTE_MAP[url.pathname] || null;

    if (!upstreamPath) {
      for (const route of DYNAMIC_ROUTES) {
        const match = url.pathname.match(route.pattern);
        if (match) {
          upstreamPath = route.upstream(match);
          break;
        }
      }
    }

    if (!upstreamPath) {
      return jsonResponse({ error: 'Not found' }, hdrs, 404);
    }

    // Passthrough query string (for /search?q=)
    const queryString = url.search || '';
    const fullUpstreamPath = `${upstreamPath}${queryString}`;

    // ── KV Cache Check ───────────────────────────────────────
    const cacheKey = await hashCacheKey(fullUpstreamPath);

    if (env.PROXY_KV) {
      const cached = await env.PROXY_KV.get(cacheKey, 'text');
      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: {
            ...hdrs,
            'Content-Type': 'application/json',
            'X-Cache': 'HIT',
            'Cache-Control': `public, s-maxage=${KV_CACHE_TTL_S}`,
          },
        });
      }
    }

    // ── Upstream Fetch with Retry ────────────────────────────
    const pythonUrl = env.PYTHON_SERVICE_URL;
    if (!pythonUrl) {
      return jsonResponse({ error: 'Service configuration error' }, hdrs, 503);
    }

    const upstreamUrl = `${pythonUrl.replace(/\/$/, '')}${fullUpstreamPath}`;

    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const upstreamResponse = await fetch(upstreamUrl, {
          method: 'GET',
          headers: {
            'X-Service-Auth-Key': env.SERVICE_AUTH_KEY || '',
            'Accept': 'application/json',
            'X-Forwarded-For': clientIP,
            'X-Request-Id': crypto.randomUUID(),
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Success — cache and return
        if (upstreamResponse.ok) {
          const body = await upstreamResponse.text();

          // Cache in KV (fire-and-forget)
          if (env.PROXY_KV && body.length < 512_000) {
            ctx.waitUntil(
              env.PROXY_KV.put(cacheKey, body, { expirationTtl: KV_CACHE_TTL_S }),
            );
          }

          return new Response(body, {
            status: 200,
            headers: {
              ...hdrs,
              'Content-Type': 'application/json',
              'X-Cache': 'MISS',
              'Cache-Control': `public, s-maxage=${KV_CACHE_TTL_S}`,
            },
          });
        }

        // 4xx — don't retry client errors
        if (upstreamResponse.status >= 400 && upstreamResponse.status < 500) {
          // Mask upstream error details
          const status = upstreamResponse.status === 429 ? 429 : upstreamResponse.status;
          const retryHeaders = status === 429 ? { 'Retry-After': '60' } : {};
          return jsonResponse(
            { error: status === 429 ? 'Rate limited — retry later' : 'Request failed' },
            { ...hdrs, ...retryHeaders },
            status,
          );
        }

        // 5xx — retry with backoff
        lastError = new Error(`Upstream ${upstreamResponse.status}`);

      } catch (err) {
        lastError = err;
      }

      // Exponential backoff before retry
      if (attempt < MAX_RETRIES) {
        await delay(BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
      }
    }

    // All retries exhausted
    console.error('[Proxy] Upstream failed after retries:', lastError?.message);
    return jsonResponse(
      { error: 'Service temporarily unavailable' },
      { ...hdrs, 'Retry-After': '30' },
      503,
    );
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * SHA-256 hash a cache key for KV storage.
 * Prevents key injection and normalizes key length.
 */
async function hashCacheKey(input) {
  const encoded = new TextEncoder().encode(`rockauto:${input}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return `cache:${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function jsonResponse(data, extraHeaders = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
