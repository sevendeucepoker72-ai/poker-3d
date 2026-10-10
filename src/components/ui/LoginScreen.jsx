import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { startLogin, detectInAppBrowser } from '../../services/authService';
import { isKeepSignedIn, setKeepSignedIn } from '../../services/tokenStorage';
import CreateAccountLink from './CreateAccountLink';
import './LoginScreen.css';

// 2026-10-07 — GUEST PLAY RETIRED (owner decision: nobody plays .online without
// an American Pub Poker account). The "Play as Guest" button, its socket
// `register` emit (random GuestNNNN name + random password), the
// `registerResult` listener and the LOGIN-11 guest watchdog are gone. The only
// way in is the American Pub Poker account (OIDC) below. poker-server refuses
// a guest `register` (code guest_disabled) and any play attempt without an
// account (code login_required); services/playRefusal.js shows those refusals
// with this same sign-in action.
export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // "Remember me" — previously set silently to 1 by the SSO path; now the
  // user controls it. Defaults ON (matches previous behavior for returning
  // users) and the SSO path honors the checkbox.
  // "Keep me signed in" now reads from localStorage (via tokenStorage helper)
  // so the preference survives browser restart, matching the token it gates.
  const [rememberMe, setRememberMe] = useState(() => isKeepSignedIn());

  // 2026-07-06 P2 auth fix — set by the 'poker:session-expired' teardown
  // (main.jsx listener) when the refresh token is revoked (logged out
  // elsewhere / admin revoke). Rendered as a visible notice below so the
  // user isn't silently yanked to this screen with no explanation. Cleared
  // by gameStore.login/oauthLogin on the next successful sign-in.
  const sessionExpiredNotice = useGameStore((s) => s.sessionExpiredNotice);
  const tables = useTableStore((s) => s.tables);
  const totalOnline = tables.reduce((sum, t) => sum + (t.playerCount || 0), 0);

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

            {/* 2026-10-09 (contract R3) — no account yet (e.g. a former guest):
                create one on americanpubpoker.com, then come back and Sign In.
                Same in-app-browser guard as the button above. */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <CreateAccountLink inApp={inApp.inApp} style={{ width: '100%' }} />
            </div>

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
