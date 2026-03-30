/**
 * American Pub Poker — Service Worker
 * Strategy:
 *   - App shell (HTML, CSS, JS chunks) → Cache First, with background refresh
 *   - Socket.io / API calls → Network Only (never cache live game data)
 *   - 3D model assets (.glb, textures) → Cache First (large, rarely change)
 *   - Offline fallback → serve cached index.html for navigation requests
 */

const CACHE_NAME = 'pub-poker-v2';
const SHELL_URLS = ['/', '/manifest.json', '/favicon.svg'];

// Asset types that benefit from aggressive caching
const CACHE_FIRST_EXTS = ['.js', '.css', '.woff2', '.woff', '.ttf', '.glb', '.jpg', '.png', '.svg', '.webp'];

function isCacheFirst(url) {
  try {
    const u = new URL(url);
    // Never cache socket.io, API, or WebSocket upgrade requests
    if (u.pathname.startsWith('/socket.io') || u.pathname.startsWith('/api')) return false;
    return CACHE_FIRST_EXTS.some((ext) => u.pathname.endsWith(ext));
  } catch {
    return false;
  }
}

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

// ── Install: pre-cache shell ──────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

// ── Activate: evict old caches ────────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  e.waitUntil(self.clients.claim());
});

// ── Fetch ──────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;

  // Navigation → serve cached index.html as fallback (SPA offline support)
  if (isNavigationRequest(request)) {
    e.respondWith(
      fetch(request).catch(() => caches.match('/'))
    );
    return;
  }

  // Cache-first for static assets
  if (isCacheFirst(request.url)) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          // Background refresh
          fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); }).catch(() => {});
          return cached;
        }
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // Network-only for everything else (live game data, socket.io, auth)
  e.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ── Push notifications (future use) ──────────────────────────────────────────
self.addEventListener('push', (e) => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title || 'Pub Poker', {
      body: data.body || "It's your turn!",
      icon: '/poker-icon-192.svg',
      badge: '/poker-icon-192.svg',
      tag: 'poker-notification',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(clients.openWindow(url));
});
