import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getSocket } from '../../services/socketService';
import { handleCallback, getCallbackParams, clearCallbackParamsCache } from '../../services/authService';
import { setAuthToken, isKeepSignedIn } from '../../services/tokenStorage';

export default function AuthCallback() {
  const [status, setStatus] = useState('Signing in...');

  useEffect(() => {
    const { code, state, error, errorDescription } = getCallbackParams();

    // Track every timeout + socket listener + 'connect' deferred emit so
    // unmount-mid-callback doesn't leak handlers or fire setState on dead component.
    const pendingTimeouts = new Set();
    let activeLoginListener = null;
    let activeConnectHandler = null;

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
        try { clearCallbackParamsCache(); } catch {}
        try { sessionStorage.removeItem('oauth_silent_return_to'); } catch {}
        window.history.replaceState({}, '', '/');
        useGameStore.getState().setScreen('login');
        return () => {
          cancelled = true;
          pendingTimeouts.forEach(clearTimeout);
          pendingTimeouts.clear();
        };
      }
      console.error('OAuth error:', error, errorDescription);
      setStatus(`Login failed: ${errorDescription || error}`);
      try { clearCallbackParamsCache(); } catch {}
      schedule(() => {
        window.history.replaceState({}, '', '/');
        useGameStore.getState().setScreen('login');
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
      try { clearCallbackParamsCache(); } catch {}
      schedule(() => {
        window.history.replaceState({}, '', '/');
        useGameStore.getState().setScreen('login');
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
          const keep = isKeepSignedIn();
          const store = keep ? localStorage : sessionStorage;
          store.setItem('poker_oauth_refresh', tokens.refresh_token);
          store.setItem('poker_oauth_id_token', tokens.id_token || '');
          store.setItem('poker_token_expiry', String(Date.now() + tokens.expires_in * 1000));
        } catch { /* ignore */ }

        // Authenticate with poker-server via socket
        const socket = getSocket();
        if (!socket) {
          setStatus('Server connection not ready — please try again');
          return;
        }

        const doSocketAuth = () => {
          socket.emit('oauthLogin', { accessToken: tokens.access_token });
        };

        const handleResult = (result) => {
          if (cancelled) return;
          socket.off('loginResult', handleResult);
          activeLoginListener = null;
          // 2026-05-19 — also remove the 'connect' re-emit listener now
          // that login is resolved. Otherwise it stays attached and would
          // re-fire oauthLogin on every future reconnect of this socket,
          // duplicating audit events and (worse) potentially racing with
          // a graceful logout the user might trigger seconds later.
          if (activeConnectHandler) {
            socket.off('connect', activeConnectHandler);
            activeConnectHandler = null;
          }

          if (result?.success && result.userData) {
            useGameStore.getState().oauthLogin(tokens, result.userData);
          } else {
            setStatus('Server authentication failed — please try again');
            schedule(() => {
              useGameStore.getState().setScreen('login');
            }, 2000);
          }
        };

        activeLoginListener = handleResult;
        socket.on('loginResult', handleResult);

        // 2026-05-19 — fix the "Login timed out" race documented in this
        // session: the server emits `loginResult` on the SAME socket that
        // received `oauthLogin`. If that socket disconnects between emit
        // and response (Railway scale-up, transient network, Safari
        // backgrounding), the emit goes to a dead socket and the client
        // never receives it — 10s timeout fires, user sees
        // "Login timed out — please try again" and "Play Online" appears
        // broken on americanpubpoker.online.
        //
        // Fix: register a PERSISTENT 'connect' listener (was `.once` —
        // only fired once) that re-emits oauthLogin on EVERY connect of
        // this socket. socket.io's Manager keeps the listener across its
        // own reconnect loop, so each fresh connection triggers a fresh
        // oauthLogin, and the server's next loginResult emit lands on
        // the live socket. handleResult above removes both listeners on
        // success so we don't keep re-emitting forever.
        activeConnectHandler = doSocketAuth;
        socket.on('connect', doSocketAuth);
        if (socket.connected) {
          doSocketAuth();
        }

        // Timeout
        schedule(() => {
          if (activeLoginListener) {
            socket.off('loginResult', activeLoginListener);
            activeLoginListener = null;
          }
          if (activeConnectHandler) {
            socket.off('connect', activeConnectHandler);
            activeConnectHandler = null;
          }
          setStatus('Login timed out — please try again');
          schedule(() => {
            window.history.replaceState({}, '', '/');
            useGameStore.getState().setScreen('login');
          }, 2000);
        }, 10000);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('OAuth callback error:', err);
        // Clear cached callback params — the auth-code is single-use, so even
        // a transient error means it's burned. Next attempt must re-start the flow.
        try { clearCallbackParamsCache(); } catch {}
        setStatus(`Authentication failed: ${err.message}`);
        schedule(() => {
          window.history.replaceState({}, '', '/');
          useGameStore.getState().setScreen('login');
        }, 3000);
      });

    return () => {
      cancelled = true;
      pendingTimeouts.forEach(clearTimeout);
      pendingTimeouts.clear();
      const sock = getSocket();
      if (sock) {
        if (activeLoginListener) sock.off('loginResult', activeLoginListener);
        if (activeConnectHandler) sock.off('connect', activeConnectHandler);
      }
      activeLoginListener = null;
      activeConnectHandler = null;
    };
  }, []);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
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
