/**
 * PartsCommand CRM — Service Worker v2.1
 * Offline-first strategy: Cache Shell on install, Network-first for API,
 * Cache-first for static assets.
 */

const CACHE_NAME = 'partscommand-v2.2.1';
const API_ORIGIN = 'https://parts-command-api.techguruofficial.workers.dev';

// Same-origin assets that MUST be cached (hard fail is acceptable)
const PRECACHE_CORE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/z-auto-9.jpeg',
  '/assets/favicon-cropped1.PNG',
  '/assets/jspdf.umd.min.js',
  '/assets/jspdf.plugin.autotable.min.js',
  '/assets/styles.css',
];

// External CDN assets — cached opportunistically, failures are ignored
const PRECACHE_OPTIONAL = [
  'https://unpkg.com/@phosphor-icons/web',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap',
];

// ── Install: precache app shell ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 1. Cache core same-origin assets (must succeed)
      try {
        await cache.addAll(PRECACHE_CORE);
      } catch (err) {
        console.warn('[SW] Core precache failed:', err);
      }

      // 2. Cache external CDN assets individually — ignore any failures
      await Promise.allSettled(
        PRECACHE_OPTIONAL.map(url =>
          cache.add(new Request(url, { mode: 'no-cors' })).catch(() => {})
        )
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

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // API calls — Network first, fall back to cached response if offline
  if (url.origin === new URL(API_ORIGIN).origin) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  // Google Fonts / CDN assets — Cache first (no-cors opaque response)
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'unpkg.com'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // App shell & local assets — Stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Strategy: Network first (API) ─────────────────────────────────────────────
async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline — no cached data available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── Strategy: Cache first (CDN assets) ───────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request, { mode: 'no-cors' });
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch {
    return new Response('', { status: 408 });
  }
}

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
