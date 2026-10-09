import { useState } from 'react';
import { usePlayRefusalStore } from '../../store/playRefusalStore';
import { refusalNeedsSignIn, startAccountSignIn } from '../../services/playRefusal';
import { detectInAppBrowser } from '../../services/authService';

/**
 * Shared notice for a server play refusal (2026-10-07 owner decisions: game
 * suspension + guest play OFF). Rendered once per screen by App.jsx; fed only
 * by services/playRefusal.js:reportPlayRefusal.
 *
 * Shows the server's text verbatim. Blue + gold, never red (owner preference).
 * For login_required / guest_disabled it offers the normal sign-in action, the
 * same OIDC redirect as the login screen's button.
 */
export default function PlayRefusalNotice() {
  const refusal = usePlayRefusalStore((s) => s.refusal);
  const clear = usePlayRefusalStore((s) => s.clear);
  if (!refusal) return null;
  // Keyed per refusal so a fresh refusal starts with a fresh sign-in state.
  return <RefusalCard key={refusal.at} refusal={refusal} onDismiss={clear} />;
}

function RefusalCard({ refusal, onDismiss }) {
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState(null);
  const needsSignIn = refusalNeedsSignIn(refusal.code);
  // Same rule as LoginScreen: OAuth can't complete inside FB/IG/TikTok webviews.
  const inApp = needsSignIn ? detectInAppBrowser() : { inApp: false };

  const handleSignIn = () => {
    if (inApp.inApp) return;
    setSignInError(null);
    setSigningIn(true);
    startAccountSignIn().catch((e) => {
      setSigningIn(false);
      setSignInError(String(e?.message || e || 'Sign-in failed'));
    });
  };

  return (
    <div
      className="play-refusal-notice"
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 80px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10050,
        width: 'min(92vw, 380px)',
        boxSizing: 'border-box',
        padding: '16px 18px',
        borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(12,28,72,0.98), rgba(8,18,48,0.98))',
        border: '1px solid rgba(255,210,74,0.55)',
        boxShadow: '0 10px 36px rgba(0,0,0,0.6)',
        color: '#e8eefc',
        textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <div style={{ color: '#ffd24a', fontWeight: 700, fontSize: 15, lineHeight: 1.4 }}>
        {refusal.message}
      </div>

      {/* Same in-app-browser guard (and wording) as LoginScreen's Sign In. */}
      {needsSignIn && inApp.inApp && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: '#cfe0ff', lineHeight: 1.4 }}>
          You're inside the {inApp.app} app. Tap the <strong>•••</strong> menu and choose <strong>Open in Safari</strong> or <strong>Open in Chrome</strong> — sign-in won't keep your session in the in-app browser.
        </div>
      )}
      {signInError && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: '#cfe0ff', lineHeight: 1.4 }}>
          {signInError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
        {needsSignIn && (
          <button
            type="button"
            className="play-refusal-signin"
            onClick={handleSignIn}
            disabled={signingIn || inApp.inApp}
            title={inApp.inApp ? 'Open this page in your full browser to sign in' : undefined}
            style={{
              padding: '10px 16px', borderRadius: 10, border: 'none',
              cursor: signingIn || inApp.inApp ? 'default' : 'pointer',
              background: 'linear-gradient(135deg, #ffd24a, #e6b422)',
              color: '#0a1628', fontWeight: 700, fontSize: 14,
              opacity: signingIn || inApp.inApp ? 0.6 : 1,
            }}
          >
            {signingIn ? 'Opening sign-in…' : 'Sign In with American Pub Poker'}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          style={{
            padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
            background: 'transparent', color: '#cfe0ff', fontSize: 14,
            border: '1px solid rgba(120,160,255,0.45)',
          }}
        >
          {needsSignIn ? 'Not now' : 'OK'}
        </button>
      </div>
    </div>
  );
}
