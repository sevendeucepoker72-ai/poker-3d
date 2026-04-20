/**
 * American Pub Poker — Service Worker
 * Strategy:
 *   - App shell (HTML, CSS, JS chunks) → Cache First, with background refresh
 *   - Socket.io / API calls → Network Only (never cache live game data)
 *   - 3D model assets (.glb, textures) → Cache First (large, rarely change)
 *   - Offline fallback → serve cached index.html for navigation requests
 */

// Cache name is suffixed with a build-time token — the `build` npm script runs
// a postbuild step that replaces `__BUILD_TIME__` with `Date.now()`. If that
// replacement never ran, we are shipping a broken artifact: every deploy would
// share a single cache and stale JS/CSS would stick on clients forever. Detect
// the literal token and FAIL LOUDLY: during install we reject the SW so the
// browser falls back to network, and we log to console for ops visibility.
const BUILD_TOKEN = '__BUILD_TIME__';
const LITERAL_TOKEN = '__BUILD' + '_TIME__';
const BUILD_TOKEN_OK = BUILD_TOKEN !== LITERAL_TOKEN && /^\d+$/.test(BUILD_TOKEN);
if (!BUILD_TOKEN_OK) {
  // eslint-disable-next-line no-console
  console.error('[sw] BUILD_TIME token was not injected at build. Refusing to install.');
}
const CACHE_NAME = 'pub-poker-v2-' + (BUILD_TOKEN_OK ? BUILD_TOKEN : 'broken');
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
  if (!BUILD_TOKEN_OK) {
    e.waitUntil(Promise.reject(new Error('sw: BUILD_TIME token not injected')));
    return;
  }
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  // PWA audit #4: don't skipWaiting automatically — we want to notify
  // the running client first so it can toast "New version available".
  // The client messages us back with {type:'SKIP_WAITING'} after the
  // user accepts (or on next soft-reload).
  // self.skipWaiting();  // ← intentionally disabled; controlled by client
});

// Accept SKIP_WAITING from client when user confirms the update.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
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

// ── Push notifications ───────────────────────────────────────────────────────
// Supports the rich-payload shape the master-API dispatcher sends:
// { title, body, icon, badge, tag, vibrate, image, actions, data: { url, deepLink, ... } }
self.addEventListener('push', (e) => {
  let data = {};
  if (e.data) {
    try { data = e.data.json(); } catch { data = { title: 'American Pub Poker', body: e.data.text() }; }
  }
  const title = data.title || 'American Pub Poker';
  const options = {
    body: data.body || '',
    icon: data.icon || '/poker-icon-192.svg',
    badge: data.badge || '/poker-icon-192.svg',
    tag: data.tag || data.threadTag || 'poker-notification',
    renotify: !!data.renotify,
    requireInteraction: data.priority === 'urgent',
    silent: !!data.silent,
    vibrate: data.vibrate || [200, 100, 200],
    image: data.image || data.imageUrl || undefined,
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : undefined,
    data: {
      url: data.url || data.deepLink || '/',
      eventType: data.eventType,
      metadata: data.metadata || data.data || {},
    },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  const targetAction = e.action || '';
  // If the click was on an action button with a URL, prefer that.
  const actionUrl = e.notification.data?.actions?.find?.((a) => a.action === targetAction)?.url;
  const target = actionUrl || url;
  e.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = all.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate?.(target);
      } else {
        await clients.openWindow(target);
      }
    })()
  );
});

self.addEventListener('notificationclose', (e) => {
  // Analytics hook — no-op for now, but present so the push dispatcher can
  // later track dismissals if we start sending a trackingId.
  const _ = e.notification?.data;
  void _;
});
