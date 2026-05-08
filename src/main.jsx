import { createRoot } from 'react-dom/client'
// a11y.css first so global :focus-visible + prefers-reduced-motion rules
// are registered before component-specific `outline: 0` stylesheets
// override them. See src/a11y.css for rationale.
import './a11y.css'
import './index.css'
import './themes.css'
import './mobile.css'

// Global error catch-alls (2026-04-22 audit fixes). These sit OUTSIDE the
// React tree so they pick up errors that React's ErrorBoundary can't see:
// rejected promises from socket handlers, async listeners, dynamic imports
// that fail offline, and anything thrown from vanilla DOM code.
//
// 2026-05-05 — installErrorReporting() now POSTs the same events to
// /auth-events/log so silent crashes (frozen scene, no console) become
// visible server-side. The console.error listeners below are KEPT for
// local-dev visibility — both the reporter and the console handlers are
// independent listeners, so they fire additively.
import { installErrorReporting } from './services/errorReporting.js'
installErrorReporting()

window.addEventListener('unhandledrejection', (e) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledrejection]', e.reason);
});
window.addEventListener('error', (e) => {
  // eslint-disable-next-line no-console
  console.error('[window.onerror]', e.error || e.message);
});

// mobile-overrides.css carries the PWA mobile-specific rules (modal
// positioning fixes, kill backdrop-filter for paint perf, etc.). It
// was previously only imported from main-mobile.jsx (a separate
// mobile-only entry point), so those overrides never reached the
// actual PWA on americanpubpoker.online — latest example was the
// 767px blur-kill rule that "shipped" but never ran in production.
import './mobile-overrides.css'
import App from './App.jsx'
// 2026-05-05 Phase 1 — session lifecycle handler. Listens for
// visibilitychange / focus / pageshow events and force-reconnects the
// socket if it dropped while the tab was backgrounded. Started here at
// module top-level (before React mounts) so the listener is in place
// for any pre-mount tab state changes too.
import * as sessionLifecycle from './services/sessionLifecycle.js'
sessionLifecycle.start()

// 2026-05-05 Phase 2 #5 — proactive OIDC token refresh scheduler.
// Fires 5 min before access-token expiry so an idle .online tab never
// sits on a stale token. Cooperates with sessionLifecycle (which calls
// refreshNow on tab resume).
import * as authScheduler from './services/authScheduler.js'
authScheduler.start()

// 2026-05-05 Phase 3 — cross-tab logout sync. When ANY same-origin .online
// tab logs out, we tear down THIS tab's session immediately instead of
// waiting for it to discover the lost session via a failing API call or
// socket disconnect.
import { onAuthEvent } from './services/authBroadcast.js'
import { useGameStore } from './store/gameStore.js'
onAuthEvent((evt) => {
  if (evt.type === 'logout') {
    try {
      // Skip the redirect-to-auth-server side-effect (originating tab
      // already did it). Just clear local state by setting isLoggedIn=false
      // and zeroing tokens — same shape as the logout() action's set().
      useGameStore.setState({
        isLoggedIn: false,
        userId: null,
        authToken: null,
        oauthAccessToken: null,
        oauthRefreshToken: null,
        oauthIdToken: null,
        oauthTokenExpiry: null,
        playerName: '',
        chips: 10000,
        screen: 'login',
      })
    } catch (_) {
      // If state shape changes, fall back to a hard reload so we don't
      // leave the tab in a half-logged-out state.
      try { window.location.reload() } catch {}
    }
  }
})

// Register the service worker early so push-enrollment UI doesn't race on
// `navigator.serviceWorker.ready`.
//
// PWA audit #4: show a "new version available" toast when a new SW
// finishes installing in the background. The new SW waits (we removed
// self.skipWaiting from sw.js to keep it from auto-activating), and we
// message it to SKIP_WAITING when the user taps the toast. Without this
// pattern, installed PWAs stay on stale JS chunks across deploys.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Watch for an updated SW reaching "installed" while an old one
      // still controls the page.
      const showUpdateToast = () => {
        // Deferred import — this runs once in the app lifetime and we
        // don't want to ship the toast helper with main.jsx bundle.
        const html = `
          <div id="sw-update-toast" style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;
               background:linear-gradient(180deg,#1F2937,#0B0F19);color:#E5E7EB;
               border:1px solid rgba(34,211,238,0.6);border-radius:12px;
               padding:14px 20px;box-shadow:0 10px 28px rgba(0,0,0,0.6),0 0 20px rgba(34,211,238,0.3);
               font-family:system-ui,-apple-system,sans-serif;font-size:0.92rem;font-weight:600;
               display:flex;gap:12px;align-items:center;cursor:pointer;max-width:calc(100vw - 32px);
               animation:swToastSlide 0.25s ease-out">
            <span>🔄 New version available</span>
            <span style="padding:4px 10px;background:rgba(34,211,238,0.2);border:1px solid rgba(34,211,238,0.5);border-radius:6px;font-size:0.8rem">Reload</span>
          </div>
          <style>@keyframes swToastSlide { from { transform: translate(-50%, 40px); opacity:0 } to { transform: translate(-50%, 0); opacity:1 } }</style>
        `;
        const host = document.createElement('div');
        host.innerHTML = html;
        document.body.appendChild(host);
        host.addEventListener('click', () => {
          const waiting = reg.waiting;
          if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
          // Reload once the new SW takes control.
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
          });
        });
      };
      if (reg.waiting) showUpdateToast();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          // "installed" + existing controller = fresh update waiting
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });
    }).catch((err) => {
      console.warn('[sw] registration failed:', err);
    });
  });
}

// 2026-05-07 — Cross-site SSO bridge bootstrap (poker-3d edition).
// If URL fragment has bridge_id_token=<jwt> from another APK site, exchange
// for our own tokens BEFORE React mounts and seed the auth state directly
// so the user lands logged in instead of seeing the LoginScreen.
async function bootstrapBridgeOrMount() {
  let bridgeToken = ''
  try {
    const hash = (window.location.hash || '').replace(/^#/, '')
    if (hash) bridgeToken = new URLSearchParams(hash).get('bridge_id_token') || ''
  } catch {}

  if (bridgeToken) {
    // Strip the fragment immediately so a refresh doesn't reprocess.
    try {
      const hash = (window.location.hash || '').replace(/^#/, '')
      const params = new URLSearchParams(hash)
      params.delete('bridge_id_token')
      const remaining = params.toString()
      const newUrl = window.location.pathname + window.location.search +
        (remaining ? '#' + remaining : '')
      window.history.replaceState({}, '', newUrl)
    } catch {}

    try {
      const response = await fetch('https://auth.americanpubpoker.online/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:apk:bridge',
          subject_token: bridgeToken,
          client_id: 'poker-3d',
        }),
      })
      if (response.ok) {
        const tokens = await response.json()
        try {
          // poker-3d's localStorage convention (matches what AuthCallback writes)
          if (tokens.access_token) localStorage.setItem('poker_auth_token', tokens.access_token)
          if (tokens.id_token) localStorage.setItem('poker_oauth_id_token', tokens.id_token)
          if (tokens.refresh_token) localStorage.setItem('poker_oauth_refresh', tokens.refresh_token)
          if (tokens.expires_in) {
            localStorage.setItem('poker_token_expiry', String(Date.now() + tokens.expires_in * 1000))
          }
          // Seed gameStore zustand state so the LoginScreen doesn't render.
          // Decode id_token claims for username + sub.
          if (tokens.id_token) {
            const parts = tokens.id_token.split('.')
            const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
            const padded = payloadB64 + '=='.slice(0, (4 - payloadB64.length % 4) % 4)
            const claims = JSON.parse(atob(padded))
            useGameStore.setState({
              isLoggedIn: true,
              userId: claims.sub,
              playerName: claims.preferred_username || claims.username || 'Player',
              authToken: tokens.access_token,
              oauthAccessToken: tokens.access_token,
              oauthIdToken: tokens.id_token,
              oauthRefreshToken: tokens.refresh_token,
              oauthTokenExpiry: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
              screen: 'lobby',
            })
          }
        } catch {}
      }
    } catch {}
  }

  // 2026-05-08 — Cold-start cross-site silent SSO. Same pattern as
  // player-web index.js. If we have no local OAuth tokens AND no bridge
  // token AND we're not on /auth/callback AND we haven't already tried
  // this session, fire a top-level prompt=none redirect to the auth-server.
  // The shared 30-day SSO session cookie auto-issues a code → AuthCallback
  // exchanges → user lands logged-in. If no session, AuthCallback handles
  // login_required by routing back to the login screen (no error UI).
  try {
    const hasLocalToken = !!localStorage.getItem('poker_auth_token')
      || !!localStorage.getItem('poker_oauth_id_token')
      || !!sessionStorage.getItem('poker_auth_token');
    const triedSilent = sessionStorage.getItem('oauth_silent_attempted') === '1';
    const path = window.location.pathname || '/';
    const isAuthCallback = path.startsWith('/auth/callback');

    if (!hasLocalToken && !triedSilent && !isAuthCallback) {
      sessionStorage.setItem('oauth_silent_attempted', '1');
      try {
        sessionStorage.setItem('oauth_silent_return_to',
          window.location.pathname + window.location.search + window.location.hash);
      } catch {}
      const { startSilentLogin } = await import('./services/authService.js');
      try {
        await startSilentLogin({ returnTo: path });
        return; // navigation fires inside; we don't reach here
      } catch (err) {
        console.warn('[silent-sso] cold-start failed:', err && err.message);
      }
    }
  } catch (err) {
    console.warn('[silent-sso] cold-start guard error:', err && err.message);
  }

  createRoot(document.getElementById('root')).render(<App />)
}
bootstrapBridgeOrMount()
