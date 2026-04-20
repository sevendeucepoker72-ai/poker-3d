import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getSocket } from '../../services/socketService';
import { handleCallback, getCallbackParams } from '../../services/authService';

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
      console.error('OAuth error:', error, errorDescription);
      setStatus(`Login failed: ${errorDescription || error}`);
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
      setStatus('Invalid callback — missing parameters');
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

    // Scrub `code` + `state` from the URL bar immediately so they don't sit
    // in history / bookmarks / page title / referrer headers.
    try { window.history.replaceState({}, '', '/'); } catch { /* ignore */ }

    handleCallback(code, state)
      .then((tokens) => {
        if (cancelled) return;

        // Store tokens (short-lived access in sessionStorage; refresh stays
        // in sessionStorage because it survives tab close / "keep me signed in")
        try {
          sessionStorage.setItem('poker_auth_token', tokens.access_token);
          sessionStorage.setItem('poker_oauth_id_token', tokens.id_token || '');
          sessionStorage.setItem('poker_token_expiry', String(Date.now() + tokens.expires_in * 1000));
        } catch { /* ignore */ }
        // Legacy mirrors so code paths that still read sessionStorage keep working
        sessionStorage.setItem('poker_auth_token', tokens.access_token);
        sessionStorage.setItem('poker_oauth_refresh', tokens.refresh_token);
        sessionStorage.setItem('poker_oauth_id_token', tokens.id_token || '');
        sessionStorage.setItem('poker_keep_signed_in', '1');
        sessionStorage.setItem('poker_token_expiry', String(Date.now() + tokens.expires_in * 1000));

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

        if (socket.connected) {
          doSocketAuth();
        } else {
          activeConnectHandler = doSocketAuth;
          socket.once('connect', doSocketAuth);
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
