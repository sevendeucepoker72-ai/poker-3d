import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { getSocket } from '../../services/socketService';
import { startLogin, detectInAppBrowser } from '../../services/authService';
import { setAuthToken, setAuthUsername, isKeepSignedIn, setKeepSignedIn } from '../../services/tokenStorage';
import './LoginScreen.css';

// Generate a cryptographically-random password for guest accounts. The previous
// scheme (`guest_${Date.now()}_Xk9`) had only millisecond entropy and a static
// suffix — two guests registered in the same tick could collide.
function randomGuestPassword() {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return 'guest_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Ultra-old browser fallback — still not a secret that leaves the device
    return `guest_${Date.now()}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // "Remember me" — previously set silently to 1 by the SSO path; now the
  // user controls it. Defaults ON (matches previous behavior for returning
  // users) but SSO + guest now both honor the checkbox.
  // "Keep me signed in" now reads from localStorage (via tokenStorage helper)
  // so the preference survives browser restart, matching the token it gates.
  const [rememberMe, setRememberMe] = useState(() => isKeepSignedIn());

  const login = useGameStore((s) => s.login);
  // 2026-07-06 P2 auth fix — set by the 'poker:session-expired' teardown
  // (main.jsx listener) when the refresh token is revoked (logged out
  // elsewhere / admin revoke). Rendered as a visible notice below so the
  // user isn't silently yanked to this screen with no explanation. Cleared
  // by gameStore.login/oauthLogin on the next successful sign-in.
  const sessionExpiredNotice = useGameStore((s) => s.sessionExpiredNotice);
  const tables = useTableStore((s) => s.tables);
  const totalOnline = tables.reduce((sum, t) => sum + (t.playerCount || 0), 0);

  // 2026-08-17 LOGIN-11 — guest-play watchdog. handleGuestPlay used to
  // setLoading(true) and fire-and-forget `register`; the ONLY thing that ever
  // cleared the flag was a registerResult that came back. If the socket died
  // between the `.connected` precheck and the reply (Railway cold start,
  // network blip, backgrounded tab), the spinner ran forever with BOTH buttons
  // disabled and no error — the page had to be reloaded. Every other socket-auth
  // path in this app carries a watchdog; this one didn't.
  const guestTimerRef = useRef(null);
  // 2026-08-17 — ABORT flag for the guest attempt. The watchdog fixed the
  // forever-spinner but introduced its mirror image: a `registerResult` that
  // arrives AFTER the 25s timeout still ran the full success path and called
  // login(...), signing the user in underneath a visible
  // "Couldn't reach the game server" error — the UI says failed, the app says
  // signed in. Once an attempt is abandoned (timeout or disconnect) its late
  // reply must be ignored entirely; the user has already been told to retry,
  // and the retry starts a fresh attempt.
  const guestAbortedRef = useRef(false);
  const clearGuestTimer = () => {
    if (guestTimerRef.current) { clearTimeout(guestTimerRef.current); guestTimerRef.current = null; }
  };
  useEffect(() => clearGuestTimer, []);

  // Listen for guest register result
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleRegisterResult = (result) => {
      // Late reply to an abandoned attempt — the user is already looking at an
      // error and may have moved on. Do not sign them in behind it.
      if (guestAbortedRef.current) return;
      clearGuestTimer();
      setLoading(false);
      if (result.success) {
        // Route the token to localStorage when "Keep me signed in" is on
        // (survives browser restart), sessionStorage otherwise (tab-only).
        setKeepSignedIn(rememberMe);
        setAuthToken(result.token, rememberMe);
        setAuthUsername(result.userData.username);
        login(result.userData, result.token);
      } else {
        setError(result.error || 'Guest login failed');
      }
    };

    // A server-forced or transient disconnect must also release the UI —
    // otherwise the buttons stay disabled until a reload.
    const handleDisconnect = () => {
      if (!guestTimerRef.current) return; // no guest attempt in flight
      guestAbortedRef.current = true;
      clearGuestTimer();
      setLoading(false);
      setError('Lost connection to the game server — please try again.');
    };

    socket.on('registerResult', handleRegisterResult);
    socket.on('disconnect', handleDisconnect);
    return () => {
      socket.off('registerResult', handleRegisterResult);
      socket.off('disconnect', handleDisconnect);
    };
  }, [login, rememberMe]);

  const handleSSOLogin = () => {
    // Persist the keep-signed-in choice BEFORE starting the OAuth flow;
    // the callback handler will read it to decide where to store the
    // returned token (localStorage vs sessionStorage).
    setKeepSignedIn(rememberMe);
    setLoading(true);
    // 2026-05-07 device-audit P0 — startLogin can throw synchronously
    // for crypto_unsupported / storage_unavailable. Catch and surface
    // instead of leaving the spinner forever.
    Promise.resolve()
      .then(() => startLogin())
      .catch((e) => {
        setLoading(false);
        setError(String(e?.message || e || 'Sign-in failed'));
      });
  };

  // 2026-05-07 device-audit P0 — in-app webview detection (FB/IG/TikTok
  // strip third-party cookies and break OAuth callback). Show users an
  // "open in your browser" CTA instead of letting the redirect silently
  // fail.
  const inApp = detectInAppBrowser();

  const handleGuestPlay = () => {
    const guestName = `Guest${Math.floor(Math.random() * 9000) + 1000}`;
    const socket = getSocket();
    if (!socket?.connected) {
      setError('Not connected to server. Please wait...');
      return;
    }
    setError('');
    setLoading(true);
    // Fresh attempt — re-arm the abort flag so a previous abandoned attempt's
    // state can't suppress this one's result.
    guestAbortedRef.current = false;
    socket.emit('register', { username: guestName, password: randomGuestPassword() });
    // 25s matches the OAuth paths (AuthCallback + App boot). Fires only as a
    // safety net — registerResult or 'disconnect' normally clears it first.
    clearGuestTimer();
    guestTimerRef.current = setTimeout(() => {
      guestTimerRef.current = null;
      // Abandon this attempt: a registerResult that arrives after this point
      // must NOT call login() beneath the error we're about to show.
      guestAbortedRef.current = true;
      setLoading(false);
      setError("Couldn't reach the game server — please try again.");
    }, 25000);
  };

  return (
    <div className="login-screen">
      {/* Background floating suits */}
      <div className="login-bg-cards">
        {['♠','♥','♦','♣','♠','♥','♦','♣'].map((s, i) => (
          <span key={i} className="login-bg-card">{s}</span>
        ))}
      </div>

      {/* Glow orbs */}
      <div className="login-glow-orb" />
      <div className="login-glow-orb" />

      {/* Social proof strip */}
      {totalOnline > 0 && (
        <div className="login-social-proof">
          <span className="login-social-dot" />
          {totalOnline.toLocaleString()} players online · {tables.length} tables running
        </div>
      )}

      {/* Card wrapper */}
      <div className="login-flip-wrap">
        <div className="login-card">
          {/* Corner suits */}
          <span className="login-corner-suit top-left">♠</span>
          <span className="login-corner-suit top-right">♥</span>
          <span className="login-corner-suit bottom-left">♦</span>
          <span className="login-corner-suit bottom-right">♣</span>

          {/* Branding */}
          <div className="login-branding">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="American Pub Poker"
              className="login-logo-img"
            />
            <h1 className="login-title">American Pub Poker</h1>
            <p className="login-subtitle">Welcome to the table</p>
          </div>

          {/* SSO Login */}
          <div className="login-form">
            {/* Session-expired notice — informational (blue+gold), not an
                error: the user's refresh token was revoked (signed out on
                another device / admin action) and we brought them here
                deliberately. Reuses the .login-error layout with the same
                gold override pattern as the in-app-browser banner below. */}
            {sessionExpiredNotice && !error && (
              <div className="login-error" style={{ background: 'rgba(72,110,255,0.12)', borderColor: 'rgba(255,210,74,0.45)', color: '#ffd24a' }}>
                {sessionExpiredNotice}
              </div>
            )}
            {error && <div className="login-error">{error}</div>}

            {/* 2026-05-07 device-audit P0 — in-app webview banner. */}
            {inApp.inApp && (
              <div className="login-error" style={{ background: 'rgba(252,211,77,0.12)', borderColor: 'rgba(252,211,77,0.4)', color: '#fcd34d' }}>
                You're inside the {inApp.app} app. Tap the <strong>•••</strong> menu and choose <strong>Open in Safari</strong> or <strong>Open in Chrome</strong> — sign-in won't keep your session in the in-app browser.
              </div>
            )}

            <button
              type="button"
              className="login-submit-btn"
              onClick={handleSSOLogin}
              disabled={loading || inApp.inApp}
              title={inApp.inApp ? 'Open this page in your full browser to sign in' : undefined}
            >
              {loading && <span className="login-spinner" />}
              Sign In with American Pub Poker
            </button>

            <div style={{
              textAlign: 'center',
              color: 'rgba(255,255,255,0.3)',
              fontSize: '12px',
              margin: '12px 0',
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}>
              or
            </div>

            {/* Guest play */}
            <button
              type="button"
              className="login-guest-btn"
              onClick={handleGuestPlay}
              disabled={loading}
            >
              Play as Guest
            </button>

            {/* Remember me */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 14,
              fontSize: 13, color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
              userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#B388FF' }}
              />
              Keep me signed in on this device
            </label>
          </div>

          {/* Info text */}
          <div className="login-toggle" style={{ fontSize: '12px', opacity: 0.5 }}>
            Sign in once to play across all American Pub Poker sites
          </div>
        </div>
      </div>
    </div>
  );
}
