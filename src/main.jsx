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

// 2026-07-06 P2 auth fix — the ONE listener for 'poker:session-expired'
// (dispatched by authScheduler.js when a proactive refresh fails with
// RefreshTokenRevokedError, i.e. the session is genuinely dead: logged out
// elsewhere, admin-revoked, or rotation race lost). Before this listener
// existed the event was dispatched into the void and each dispatcher did its
// own inline logout — a silent yank to the login screen with a still-live
// authenticated socket. Now every revoked-session teardown routes through
// gameStore.logout({ skipRedirect: true }) (which also cycles the socket so
// the server runs its reserved-seat flow and the next user on this tab can't
// inherit the session) and surfaces a visible notice on the login screen
// (gameStore.sessionExpiredNotice → LoginScreen). Registered at module level
// so it exists before first render and never unmounts.
window.addEventListener('poker:session-expired', (e) => {
  try {
    const s = useGameStore.getState()
    if (s.isLoggedIn && typeof s.logout === 'function') {
      s.logout({ skipRedirect: true })
    }
    // Set AFTER logout — logout()'s set() doesn't touch this field, and the
    // next successful login/oauthLogin clears it.
    useGameStore.setState({
      sessionExpiredNotice: 'Your session ended — please sign in again.',
    })
    console.warn('[session-expired] teardown complete:', e?.detail?.reason || 'unknown')
  } catch (err) {
    console.error('[session-expired] teardown failed:', err)
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

  // 2026-07-06 audit P2 — bridge handoff is now owned SOLELY by App.jsx's
  // consumeBridgeIfPresent (App.jsx ~1016). That path is purpose-built: it
  // exchanges the token, persists it (keep-signed-in aware, `!= null` expiry),
  // AND drives the socket-side oauthLogin with a persistent connect handler +
  // 25s timeout. The old inline exchange here did NOT authenticate the socket
  // and stripped the hash before App.jsx could run — so the app rendered a
  // logged-in lobby over an UNAUTHENTICATED game socket. We now leave the
  // #bridge_id_token in the hash for App.jsx to consume; the only thing main
  // must do is NOT fire the cold-start silent-SSO redirect over it (guarded
  // below with `!bridgeToken`), and App shows a "Signing you in…" spinner
  // (keyed on the bridge token present at mount) so there is no LoginScreen
  // flash during the exchange.

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
      || !!sessionStorage.getItem('poker_auth_token')
      // keep-signed-in-OFF sessions store the id_token in sessionStorage (F1).
      || !!sessionStorage.getItem('poker_oauth_id_token');
    const triedSilent = sessionStorage.getItem('oauth_silent_attempted') === '1';
    const path = window.location.pathname || '/';
    const isAuthCallback = path.startsWith('/auth/callback');

    if (!hasLocalToken && !triedSilent && !isAuthCallback && !bridgeToken) {
      const { startSilentLogin, bounceToCanonicalOriginIfUnregistered } =
        await import('./services/authService.js');
      // 2026-07-06 P2 auth fix (.club canonical bounce) — this bundle is also
      // served on https://sevendeucepoker.club, which is NOT a registered
      // OAuth origin. Starting the silent prompt=none flow from there sends
      // an unregistered redirect_uri and oidc-provider hard-400s on the auth
      // origin — a dead-end. Bounce to the canonical .online origin
      // (preserving path+search) instead of starting OAuth here. Checked
      // BEFORE stamping oauth_silent_attempted so the canonical origin gets
      // its own clean silent-SSO attempt after the bounce. Full rationale +
      // the un-bounce checklist live next to REGISTERED_OAUTH_ORIGINS in
      // services/authService.js.
      if (bounceToCanonicalOriginIfUnregistered()) {
        return; // navigating to the canonical origin — do not mount
      }
      sessionStorage.setItem('oauth_silent_attempted', '1');
      try {
        sessionStorage.setItem('oauth_silent_return_to',
          window.location.pathname + window.location.search + window.location.hash);
      } catch {}
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
