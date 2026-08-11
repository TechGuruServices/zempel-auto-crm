/**
 * PartsCommand CRM — Service Worker v3.3.0
 * Offline-first. API calls are network-only; app shell + core JS are
 * network-first (see NETWORK_FIRST_PATHS) so deploys are picked up
 * immediately instead of lagging a version behind.
 */

const CACHE_NAME = 'partscommand-v3.4.0'; // bumped: stop intercepting cross-origin CDN requests (CSP fix)
const API_ORIGIN = 'https://parts-command-api.techguruofficial.workers.dev';

const PRECACHE_CORE = [
  '/manifest.json',
  '/assets/z-auto-9.jpeg',
  '/assets/favicon-cropped1.PNG',
  '/assets/jspdf.umd.min.js',
  '/assets/jspdf.plugin.autotable.min.js',
  '/assets/html5-qrcode.min.js',
  '/assets/styles.css',
];

// App shell HTML + core logic files that must never be served stale.
// These change on every deploy and directly drive dashboard/data logic,
// so they always go to the network first (falling back to cache only offline).
const NETWORK_FIRST_PATHS = [
  '/',
  '/index.html',
  '/rockauto-fetch.js',
  '/rockauto-ui.js',
  '/invoices.js',
  '/sw_cache_update.js',
];

const PRECACHE_OPTIONAL = [];
// (Previously precached unpkg.com URLs that the app doesn't even load —
// Phosphor icons come from cdn.jsdelivr.net and html5-qrcode is self-hosted
// under /assets/. Those unpkg entries were dead weight that also failed
// every install due to the CSP issue described below.)

// ── Install: precache app shell ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        await cache.addAll(PRECACHE_CORE);
      } catch (err) {
        console.warn('[SW] Core precache failed:', err);
      }
      // Seed an offline fallback copy of the network-first files, but never
      // let this block install (network-first will overwrite them anyway).
      await Promise.allSettled(
        NETWORK_FIRST_PATHS.map(path => cache.add(path).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ───────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // ALL API calls — Network ONLY (never cache API responses)
  // The database is the source of truth. Caching API data causes stale records.
  if (url.origin === new URL(API_ORIGIN).origin) {
    event.respondWith(networkOnly(request));
    return;
  }

  // Any other cross-origin request (CDN scripts/styles/fonts: cdnjs.cloudflare.com,
  // cdn.jsdelivr.net, fonts.googleapis.com, etc.) — do NOT intercept.
  // If we call fetch() on these ourselves, that fetch is evaluated against the
  // page's CSP `connect-src`, which is intentionally locked down to 'self' plus
  // the API origin. But a plain, un-intercepted <script>/<link> load is evaluated
  // against script-src/style-src/font-src instead, which DO allow these CDNs.
  // Intercepting here was silently turning every CDN library (localforage,
  // pdf.js, papaparse, Phosphor icon fonts) into a CSP violation + synthetic
  // 503 on every load after the first. Letting the browser handle these
  // natively fixes that.
  if (url.origin !== self.location.origin) {
    return;
  }


  // App shell (index.html) & core logic files — Network FIRST.
  // These drive dashboard stats and app behavior; serving a stale cached
  // copy while "revalidating in the background" is exactly what made the
  // app appear frozen on an old version. Only fall back to cache offline.
  const isNavigation = request.mode === 'navigate';
  if (isNavigation || NETWORK_FIRST_PATHS.includes(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Other local static assets (images, vendored libs) — Stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Strategy: Network ONLY (API calls — never cache dynamic data) ─────────────
async function networkOnly(request) {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch {
    // Offline — return error (do NOT serve stale cached API data)
    return new Response(JSON.stringify({ error: 'Offline — database unreachable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── Strategy: Network first (app shell + core JS — always fetch latest) ──────
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request, { cache: 'no-store' });
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

// (cacheFirst removed — cross-origin CDN requests are no longer intercepted
// by this service worker at all; see the origin check in the fetch handler
// above. That avoids the CSP connect-src violations these caused.)

// ── Strategy: Stale-while-revalidate (app shell) ─────────────────────────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => null);

  return cached || (await networkFetch) || new Response('Offline', { status: 503 });
}

// ── Background sync (queue failed writes) ────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-db') {
    event.waitUntil(syncPendingWrites());
  }
});

async function syncPendingWrites() {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_REQUESTED' });
  });
}

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'PartsCommand CRM', {
      body: data.body || '',
      icon: '/assets/favicon-cropped1.PNG',
      badge: '/assets/favicon-cropped1.PNG',
      tag: data.tag || 'partscommand-notif',
      data: data.url ? { url: data.url } : {}
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data?.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});

// ── Message handler (SKIP_WAITING from sw_cache_update.js) ───────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
