/**
 * American Pub Poker — Service Worker
 * Strategy:
 *   - Navigation (HTML / '/') → Network First, falls back to cached '/' then /offline.html.
 *     HTML must NOT go stale: the freshly-hashed /assets/*.js references live inside
 *     it, and a stale shell points at asset URLs that no longer exist on the CDN.
 *   - Hashed build assets (/assets/*.{js,css,woff2,...}) → Cache First, treated as
 *     immutable. Vite emits content-hashed filenames so the URL itself changes on
 *     any content change — we never need to revalidate.
 *   - Other static assets (favicons, models, loose images in /public) → Cache First
 *     with background refresh (URLs are stable; refresh catches in-place edits).
 *   - Socket.io / API / auth calls → Network Only (never cache live game data).
 *   - Offline fallback → dedicated /offline.html precached at install; navigation
 *     falls back to it when both network and cached '/' are unavailable.
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
const CACHE_NAME = 'pub-poker-v3-' + (BUILD_TOKEN_OK ? BUILD_TOKEN : 'broken');
// Include /offline.html so navigation has a sensible fallback even when '/' is
// unavailable (e.g. first-ever offline load before '/' was successfully
// cached). '/' is still precached to serve the full SPA shell when reachable.
const SHELL_URLS = ['/', '/offline.html', '/manifest.json', '/favicon.svg'];

// Asset types that benefit from aggressive caching
const CACHE_FIRST_EXTS = ['.js', '.css', '.woff2', '.woff', '.ttf', '.glb', '.jpg', '.png', '.svg', '.webp'];

// Vite emits hashed filenames into /assets/. Those URLs are immutable — the
// hash changes whenever the content changes, so we can treat cache hits as
// authoritative and never revalidate. Non-hashed static files (favicons, /models,
// loose images in /public) keep the cache-first-with-background-refresh path.
function isImmutableAsset(url) {
  try {
    const u = new URL(url);
    if (!u.pathname.startsWith('/assets/')) return false;
    return CACHE_FIRST_EXTS.some((ext) => u.pathname.endsWith(ext));
  } catch {
    return false;
  }
}

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

  // Navigation / HTML → Network First. A stale index.html is worse than a
  // network round-trip because its inline <script type="module" src="/assets/xxx-<hash>.js">
  // tags reference files that no longer exist after a redeploy. On network
  // failure we fall back to the last-cached '/', then to the dedicated
  // /offline.html shell so the user sees *something* instead of a browser error.
  if (isNavigationRequest(request)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        // Opportunistically refresh the cached '/' shell so future offline
        // loads get the latest HTML.
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('/', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('/')) || (await cache.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // Cache-first IMMUTABLE for hashed /assets/* — URL changes on content change,
  // so a cache hit is always correct. No background refresh (the file can't
  // have changed without the URL changing).
  if (isImmutableAsset(request.url)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  // Cache-first WITH background refresh for other static assets (favicons,
  // models, loose images under /public — URLs are stable; content may change
  // in-place across deploys).
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
//
// 2026-05-05 audit fix: same-origin URL whitelist (P1 open-redirect). The
// previous handler passed `data.url` directly to `clients.openWindow` and
// `client.navigate`, so a malicious or compromised dispatcher payload
// could navigate the user off-site. Now any URL is normalized to either
// a same-origin path or rejected back to '/'. Mirrors the guard player
// SW (apps/web/public/sw.js:418) already has.
function sanitizeUrl(input) {
  if (!input || typeof input !== 'string') return '/';
  if (input.startsWith('/') && !input.startsWith('//')) return input;
  try {
    const u = new URL(input, self.location.origin);
    if (u.origin === self.location.origin) return u.pathname + u.search + u.hash;
  } catch (_) { /* ignore */ }
  return '/';
}

self.addEventListener('push', (e) => {
  let data = {};
  if (e.data) {
    try { data = e.data.json(); } catch { data = { title: 'American Pub Poker', body: e.data.text() }; }
  }
  // 2026-05-05 round-6 audit fix P1: cap body + tag lengths to match
  // web/admin/marketing SWs. A 50KB push body bypassing the cap would
  // make APNS reject the notification entirely.
  //
  // 2026-05-05 round-8 audit fix: use code-point-aware slicing so we
  // never split an emoji's surrogate pair (which would produce a lone
  // surrogate that APNS rejects as invalid UTF-16). `Array.from` on a
  // string yields code-point chunks (each emoji = 1 chunk regardless
  // of byte width).
  const cpSlice = (s, n) => Array.from(String(s)).slice(0, n).join('');
  const title = cpSlice(data.title || 'American Pub Poker', 200);
  const body = cpSlice(data.body || '', 500);
  const tag = cpSlice((data.tag || data.threadTag || 'poker-notification'), 64);
  // Sanitize URLs at construction time so click handlers can trust them.
  const safeUrl = sanitizeUrl(data.url || data.deepLink);
  // 2026-05-05 round-9 audit P1 fix: use cpSlice for action button
  // `action` and `title` — emoji are common in CTA labels (🃏 View hand)
  // and a UTF-16 .slice(64) at a 4-byte emoji boundary produces a broken
  // surrogate that some browsers reject or render as `�`. The other 3
  // SWs (web, admin, marketing) already use cpSlice consistently — this
  // is the only drift in action-label handling.
  const safeActions = Array.isArray(data.actions)
    ? data.actions.slice(0, 2).map((a) => ({
        action: cpSlice(a.action || '', 32),
        title: cpSlice(a.title || '', 64),
        icon: typeof a.icon === 'string' ? a.icon : undefined,
        url: a.url ? sanitizeUrl(a.url) : undefined,
      }))
    : undefined;
  // Use `title` (already sliced above) instead of redeclaring it
  const options = {
    body,
    icon: data.icon || '/poker-icon-192.svg',
    badge: data.badge || '/poker-icon-192.svg',
    tag,
    renotify: data.renotify !== undefined ? !!data.renotify : true,
    requireInteraction: data.requireInteraction !== undefined
      ? !!data.requireInteraction
      : data.priority === 'urgent',
    silent: !!data.silent,
    vibrate: data.vibrate || [200, 100, 200],
    image: data.image || data.imageUrl || undefined,
    actions: safeActions,
    data: {
      url: safeUrl,
      actions: safeActions,
      eventType: data.eventType,
      metadata: data.metadata || data.data || {},
    },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = sanitizeUrl(e.notification.data?.url || '/');
  const targetAction = e.action || '';
  // If the click was on an action button with a URL, prefer that — but
  // sanitize again, defense-in-depth.
  const actionUrlRaw = e.notification.data?.actions?.find?.((a) => a.action === targetAction)?.url;
  const target = actionUrlRaw ? sanitizeUrl(actionUrlRaw) : url;
  e.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = all.find((c) => {
        try { return new URL(c.url).origin === self.location.origin; }
        catch (_) { return false; }
      });
      if (existing) {
        existing.focus();
        existing.navigate?.(target);
      } else {
        await clients.openWindow(target);
      }
    })()
  );
});

// 2026-05-05 audit fix P1: pushsubscriptionchange listener was missing
// from this SW. Browsers emit this event when they rotate the user's
// endpoint URL (push-service maintenance, profile change, etc.); without
// a handler the new endpoint is never sent to the server and pushes
// silently die for that device until manual re-enable.
//
// 2026-05-05 re-audit fix P0 #9: API base must be ABSOLUTE. The 3D site
// is hosted at americanpubpoker.online — relative `/poker-api/...`
// resolves to the wrong origin (the .online site has no /poker-api
// route) and every rotation request 404'd silently. Now uses the same
// hardcoded Cloud Run base URL as the player SW.
const POKER_API_BASE = 'https://poker-prod-api-azeg4kcklq-uc.a.run.app/poker-api';

self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const oldEndpoint = e.oldSubscription && e.oldSubscription.endpoint;
      // Re-subscribe with the same VAPID key. The browser hands us the
      // old keys via oldSubscription so we can re-derive applicationServerKey
      // (or fetch fresh from /vapid-key — fetch is more robust against
      // VAPID rotation but requires network here).
      const reg = self.registration;
      let appServerKey;
      try {
        const res = await fetch(`${POKER_API_BASE}/notifications/vapid-key`, { credentials: 'omit' });
        if (res.ok) {
          const j = await res.json();
          if (j && j.publicKey) {
            const padding = '='.repeat((4 - j.publicKey.length % 4) % 4);
            const base64 = (j.publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
            const raw = atob(base64);
            appServerKey = Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
          }
        }
      } catch (_) { /* fallback: rely on the existing subscription's options */ }
      // 2026-05-05 round-6 audit fix P1: bail if vapid-key fetch failed
      // (matches the marketing SW). Calling pushManager.subscribe with
      // applicationServerKey=undefined is rejected by Chrome.
      if (!appServerKey) {
        // eslint-disable-next-line no-console
        console.warn('[sw] pushsubscriptionchange skipped — vapid-key fetch failed');
        return;
      }
      const newSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
      // POST old + new endpoints to the resubscribe endpoint. It's
      // intentionally unauthenticated (the SW has no JWT) — the server
      // resolves user identity via the old endpoint as a capability.
      // 2026-05-05 round-8 audit fix: include oldKeys for server-side
      // proof-of-possession (see web SW comment). Backward-compat —
      // server accepts missing oldKeys until PUSH_RESUBSCRIBE_REQUIRE_POP=1.
      const oldSubJson = e.oldSubscription && typeof e.oldSubscription.toJSON === 'function'
        ? e.oldSubscription.toJSON()
        : null;
      await fetch(`${POKER_API_BASE}/notifications/push-resubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldEndpoint,
          oldKeys: oldSubJson && oldSubJson.keys ? oldSubJson.keys : null,
          subscription: newSub.toJSON(),
        }),
      }).catch(() => null);
    } catch (err) {
      // Silent — there's no UI to surface this in. Once the next push
      // attempt hits the old endpoint and 410s, the dispatcher will
      // clean up the stale row.
      // eslint-disable-next-line no-console
      console.warn('[sw] pushsubscriptionchange failed:', err && err.message);
    }
  })());
});

self.addEventListener('notificationclose', (e) => {
  // Analytics hook — no-op for now, but present so the push dispatcher can
  // later track dismissals if we start sending a trackingId.
  const _ = e.notification?.data;
  void _;
});
