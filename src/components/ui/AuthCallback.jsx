import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getSocket } from '../../services/socketService';
import { handleCallback, getCallbackParams, clearCallbackParamsCache } from '../../services/authService';
import { setAuthToken, setOAuthItem } from '../../services/tokenStorage';
import { logAuthEvent } from '../../services/authEvents';
import { runSocketLogin, isDefinitiveLoginFailure } from '../../services/socketAuth';

/**
 * @param {object}   props
 * @param {Function} [props.onExit] App.jsx's handleAuthCallbackExit. App latches
 *   `isOAuthCallback` at mount and renders THIS component until that latch is
 *   reset, so `useGameStore.setScreen(...)` on its own has no visible effect
 *   here. Every terminal branch below must leave via exitCallback() (reset the
 *   latch) or reloadHome() (full page load). Calls: onExit({ signedIn }) after a
 *   successful login, onExit({ notice }) after a definitive refusal, onExit()
 *   to fall back to the login screen.
 */
export default function AuthCallback({ onExit } = {}) {
  const [status, setStatus] = useState('Signing in...');
  // Latest onExit, read at call time by the mount-only effect below (a ref, so
  // it is not an effect dependency and the single-use auth code never re-runs).
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);

  useEffect(() => {
    const { code, state, error, errorDescription } = getCallbackParams();

    // 2026-10-06 — the two ways out of this screen (see the props doc above).
    //
    // reloadHome(): full page load at '/'. Used whenever we hold freshly stored
    // tokens but the socket login did not complete: the fresh load's boot
    // refresh path retries with them (HEAD's only exit, via its 25s timer).
    const reloadHome = () => {
      console.warn('[auth-callback-reload] leaving callback view via reload to /');
      try { window.location.replace('/'); return; } catch { /* fall through */ }
      try { window.location.href = '/'; return; } catch { /* fall through */ }
      try { onExitRef.current?.(); } catch { /* ignore */ }
    };
    // exitCallback(): reset App's latch in place (no reload). Falls back to a
    // reload if the parent did not pass onExit.
    const exitCallback = (opts) => {
      const exit = onExitRef.current;
      if (typeof exit === 'function') {
        try { exit(opts); return; } catch (err) { console.error('[auth-callback] onExit threw:', err); }
      }
      reloadHome();
    };

    // Track every timeout + socket listener + 'connect' deferred emit so
    // unmount-mid-callback doesn't leak handlers or fire setState on dead component.
    const pendingTimeouts = new Set();
    // 2026-08-17 — the raw loginResult/connect listener pair was replaced by
    // runSocketLogin (services/socketAuth.js), which owns registration,
    // requestId attribution, the persistent connect re-emit and the watchdog.
    let cancelSocketLogin = null;
    let resolved = false;

    const schedule = (fn, ms) => {
      const id = setTimeout(() => {
        pendingTimeouts.delete(id);
        if (cancelled) return;
        fn();
      }, ms);
      pendingTimeouts.add(id);
      return id;
    };

    let cancelled = false;

    if (error) {
      // 2026-05-08 — silent SSO returned login_required (no auth-server
      // session). This was an expected outcome of the cold-start
      // prompt=none redirect, NOT a real failure. Don't show "Login
      // failed"; quietly route the user back to the login screen so they
      // can sign in normally. The session-scoped flag in main.jsx's
      // cold-start guard prevents a re-attempt loop.
      if (error === 'login_required' || error === 'interaction_required' || error === 'consent_required') {
        try { logAuthEvent('silent_no_session', { error }); } catch {}
        try { clearCallbackParamsCache(); } catch {}
        try { sessionStorage.removeItem('oauth_silent_return_to'); } catch {}
        window.history.replaceState({}, '', '/');
        useGameStore.getState().setScreen('login');
        // 2026-10-06 — setScreen alone left this screen up forever (App
        // renders AuthCallback for as long as its latch is set).
        exitCallback();
        return () => {
          cancelled = true;
          pendingTimeouts.forEach(clearTimeout);
          pendingTimeouts.clear();
        };
      }
      console.error('OAuth error:', error, errorDescription);
      try { logAuthEvent('login_failed', { reason: 'oauth_error', error, errorDescription }); } catch {}
      setStatus(`Login failed: ${errorDescription || error}`);
      try { clearCallbackParamsCache(); } catch {}
      schedule(() => {
        window.history.replaceState({}, '', '/');
        useGameStore.getState().setScreen('login');
        exitCallback();
      }, 2000);
      return () => {
        cancelled = true;
        pendingTimeouts.forEach(clearTimeout);
        pendingTimeouts.clear();
      };
    }

    if (!code || !state) {
      // 2026-05-07 OAuth audit: this is the iOS-PWA failure mode — getCallbackParams
      // already tried every URL source and the sessionStorage cache. If we still
      // have nothing, the redirect arrived without query params at all (rare) or
      // the user navigated to /auth/callback by hand. Show a clear message.
      setStatus('Sign-in link is incomplete — please try logging in again');
      try { logAuthEvent('login_failed', { reason: 'incomplete_callback' }); } catch {}
      try { clearCallbackParamsCache(); } catch {}
      schedule(() => {
        window.history.replaceState({}, '', '/');
        useGameStore.getState().setScreen('login');
        exitCallback();
      }, 2500);
      return () => {
        cancelled = true;
        pendingTimeouts.forEach(clearTimeout);
        pendingTimeouts.clear();
      };
    }

    // Scrub `code` + `state` from the URL bar immediately so they don't sit
    // in history / bookmarks / page title / referrer headers.
    try { window.history.replaceState({}, '', '/'); } catch { /* ignore */ }

    handleCallback(code, state)
      .then((tokens) => {
        if (cancelled) return;
        // Successful exchange — clear the cached callback params so a subsequent
        // visit to /auth/callback in the same tab doesn't replay stale state.
        try { clearCallbackParamsCache(); } catch {}

        // Route tokens to localStorage or sessionStorage based on the
        // keep-signed-in flag the user set on the login screen (already
        // persisted by LoginScreen.handleSSOLogin before startLogin).
        // tokenStorage.setAuthToken uses that flag internally.
        try {
          setAuthToken(tokens.access_token);
          // 2026-08-17 LOGIN-4 — was a raw setItem on the keep-signed-in store,
          // which left the OTHER store's copy untouched. Since the read path
          // prefers localStorage, a session-only sign-in on a shared venue
          // laptop left the PREVIOUS user's persistent refresh token in place
          // and the next boot signed in as them. setOAuthItem writes one store
          // and sweeps the other, so exactly one copy can ever exist.
          setOAuthItem('poker_oauth_refresh', tokens.refresh_token);
          setOAuthItem('poker_oauth_id_token', tokens.id_token || '');
          setOAuthItem('poker_token_expiry', String(Date.now() + tokens.expires_in * 1000));
        } catch { /* ignore */ }

        // Authenticate with poker-server via socket
        const socket = getSocket();
        if (!socket) {
          setStatus('Server connection not ready — please try again');
          // The tokens above are stored; a fresh load's boot refresh path
          // signs in with them once the socket exists.
          schedule(reloadHome, 2000);
          return;
        }

        // 2026-08-17 — routed through runSocketLogin so this flow ignores any
        // `loginResult` that belongs to a DIFFERENT auth flow on the same
        // socket (see services/socketAuth.js for the outage that forced it).
        // It also owns the persistent 'connect' re-emit that fixes the
        // "Login timed out" race: the server answers on the socket that
        // received the emit, so a socket that drops mid-login must
        // re-authenticate on its replacement.
        cancelSocketLogin = runSocketLogin({
          socket,
          event: 'oauthLogin',
          payload: { accessToken: tokens.access_token },
          label: 'callback',
          // See the timeout rationale below — 25s covers a cold Railway edge.
          timeoutMs: 25000,
          isCancelled: () => cancelled,
          onResult: (result) => {
            resolved = true;
            if (result?.success && result.userData) {
              try { logAuthEvent('login_success'); } catch {}
              useGameStore.getState().oauthLogin(tokens, result.userData);
              // 2026-10-06 — LEAVE the callback view. runSocketLogin clears its
              // watchdog on success, and HEAD's only exit was that watchdog's
              // reload, so without this a successful sign-in sat on
              // "Signing in..." forever. Tokens are persisted (above) and the
              // store is logged in, so App can render the lobby in place.
              exitCallback({ signedIn: true });
              return;
            }
            // Carry the server's labelled reason into telemetry instead of
            // discarding it — the bare 'socket_auth_failed' row is what made
            // the 2026-08-17 outage undiagnosable from the dashboard.
            try {
              logAuthEvent('login_failed', {
                reason: 'socket_auth_failed',
                code: String(result?.code || 'unlabelled').slice(0, 64),
                error: String(result?.error || '').slice(0, 200),
              });
            } catch {}
            // 2026-10-06 — RECOVER instead of a setScreen('login') that had no
            // visible effect (App keeps rendering this component).
            if (isDefinitiveLoginFailure(result)) {
              // identity_conflict: every credential this browser holds will be
              // refused for the same reason, so a reload would only repeat it.
              // Go to the login screen with the reason, and skip boot auto-login.
              const notice = 'This account could not be matched securely. Please contact support.';
              setStatus(notice);
              schedule(() => {
                useGameStore.getState().setScreen('login');
                exitCallback({ notice });
              }, 2500);
              return;
            }
            // Anything else is recoverable. The tokens from the /token exchange
            // are stored, so reload to '/' and let the boot refresh path retry
            // with them on a fresh socket — what HEAD did via its 25s reload.
            setStatus('Server authentication failed — retrying…');
            schedule(reloadHome, 2000);
          },
          onTimeout: () => {
            resolved = true;
            try { logAuthEvent('login_failed', { reason: 'socket_timeout' }); } catch {}
            setStatus('Login timed out — reconnecting…');
            // Reload to '/' rather than setScreen: App.jsx only leaves this
            // view via onExit or a page load. The tokens from the successful
            // /token exchange are already stored, so the fresh load's refresh
            // path signs the user in transparently.
            schedule(reloadHome, 1500);
          },
        });

        // 2026-06-14 — staged feedback so a cold Railway socket doesn't look
        // FROZEN on "Signing in…" for up to 25s (the #1 .online "can't log in"
        // complaint). Status text only. We deliberately do NOT flip the lobby
        // to logged-in early: the lobby renders the chip balance from the
        // server's loginResult (gameStore.oauthLogin → userData.chips), and
        // showing a wrong/zero balance would violate the "never show a wrong
        // balance" rule. Better to wait with honest status.
        //
        // The 25s watchdog itself now lives in runSocketLogin above. Rationale
        // for that figure (2026-05-26, after live-reproducing "Login timed
        // out" on .online): click "Sign In" → auth-server silent SSO (1–3s) →
        // 302 to /auth/callback → SPA cold-load + lazy chunk parse (1–4s) →
        // /token POST (~150ms) → socket.io handshake to Railway (1–8s on a
        // cold edge POP). p99 is 15–18s on a slow mobile uplink against a cold
        // Railway revision; 10s used to fire BEFORE the socket connected.
        schedule(() => {
          if (!cancelled && !resolved) setStatus('Waking up the game server…');
        }, 7000);
        schedule(() => {
          if (!cancelled && !resolved) setStatus('Almost there — connecting you to the table…');
        }, 14000);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('OAuth callback error:', err);
        try {
          const t = /state mismatch/i.test(err?.message || '') ? 'state_mismatch' : 'login_failed';
          logAuthEvent(t, { reason: 'callback_exchange', message: (err?.message || '').slice(0, 120) });
        } catch {}
        // Clear cached callback params — the auth-code is single-use, so even
        // a transient error means it's burned. Next attempt must re-start the flow.
        try { clearCallbackParamsCache(); } catch {}
        setStatus(`Authentication failed: ${err.message}`);
        schedule(() => {
          window.history.replaceState({}, '', '/');
          useGameStore.getState().setScreen('login');
          exitCallback();
        }, 3000);
      });

    return () => {
      cancelled = true;
      pendingTimeouts.forEach(clearTimeout);
      pendingTimeouts.clear();
      if (cancelSocketLogin) cancelSocketLogin();
      cancelSocketLogin = null;
    };
    // Mount-only by design: the auth code is single-use, so this must never
    // re-run. `onExit` is read through onExitRef at call time.
  }, []);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100dvh', /* 2026-07-05 mobile audit: dvh so the callback screen isn't clipped by mobile browser chrome */
      background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%)',
      color: '#e0e0e0',
      fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
    }}>
      <div style={{
        textAlign: 'center',
        padding: '40px',
        background: 'rgba(22, 33, 62, 0.95)',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid rgba(233, 69, 96, 0.3)',
          borderTopColor: '#e94560',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto 16px',
        }} />
        <p style={{ fontSize: '16px' }}>{status}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
