import { ACCOUNT_SIGNUP_URL } from '../../services/playRefusal';

/**
 * "Create a free account" (2026-10-09, contract R3). Shown next to every
 * "Sign In with American Pub Poker" action that answers a login_required /
 * guest_disabled refusal, and on the login screen — so a former guest can get
 * an account without hunting for it.
 *
 * Opens americanpubpoker.com/signup in a new tab, so this tab (and anything it
 * still holds, e.g. a guest session waiting to be carried over) stays put;
 * after signing up the player comes back here and taps Sign In.
 *
 * In-app-browser guarded exactly like Sign In: inside FB/IG/TikTok webviews the
 * account would not carry back into this page, so the control is disabled and
 * the caller's existing "Open in Safari / Chrome" guidance explains why.
 *
 * Blue + gold (owner preference: no red).
 */
export default function CreateAccountLink({ inApp = false, style = null }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    boxSizing: 'border-box',
    padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 700,
    textDecoration: 'none', lineHeight: 1.2,
    background: 'rgba(72,110,255,0.18)', color: '#ffd24a',
    border: '1px solid rgba(255,210,74,0.6)',
    ...(style || {}),
  };
  if (inApp) {
    return (
      <button
        type="button"
        className="play-refusal-signup"
        disabled
        title="Open this page in your full browser to create an account"
        style={{ ...base, cursor: 'default', opacity: 0.6 }}
      >
        Create a free account
      </button>
    );
  }
  return (
    <a
      className="play-refusal-signup"
      href={ACCOUNT_SIGNUP_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={{ ...base, cursor: 'pointer' }}
    >
      Create a free account
    </a>
  );
}
