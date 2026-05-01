/**
 * PartsCommand CRM — Service Worker
 * Offline-first strategy: Cache Shell on install, Network-first for API,
 * Cache-first for static assets.
 */

const CACHE_NAME = 'partscommand-v2.0.0';
const API_ORIGIN = 'https://parts-command-api.techguruofficial.workers.dev';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/z-auto-7.PNG',
  '/assets/z-auto-8.png',
  '/assets/favicon-cropped.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/@phosphor-icons/web',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap'
];

// ── Install: precache app shell ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS.map(url => new Request(url, { mode: 'no-cors' })))
        .catch((err) => {
          console.warn('[SW] Precache partial failure (external CDN URLs expected):', err);
        });
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

  // Google Fonts / CDN assets — Cache first
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdn.tailwindcss.com' ||
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
      icon: '/assets/favicon-cropped.png',
      badge: '/assets/favicon-cropped.png',
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
