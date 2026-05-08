/**
 * Silent OAuth (prompt=none) for .online — port of player-web's
 * services/silentLogin.js. Earned 2026-05-07 OAuth-audit follow-up:
 * .online previously showed the "Sign In with American Pub Poker" intro
 * screen on every cold launch even when the auth-server SSO cookie was
 * still valid, which felt broken next to player-web/admin/marketing
 * (all of which silently SSO).
 *
 * Flow:
 *   1. Generate state + PKCE verifier (matches startLogin in authService)
 *   2. Open a HIDDEN iframe pointing at AUTH_SERVER/auth?prompt=none&...
 *   3. Auth server checks its own session cookie:
 *        - Valid session → redirects iframe to redirect_uri?code=...&state=...
 *        - No session    → redirects iframe to redirect_uri?error=login_required
 *   4. Iframe lands on /auth/silent-callback (separate from /auth/callback)
 *   5. Silent-callback page postMessages the URL params back to opener
 *      and renders nothing
 *   6. trySilentLogin() reads the postMessage, exchanges code for tokens,
 *      stashes them in localStorage with poker-3d's existing keys
 *      (poker_oauth_refresh / poker_oauth_id_token / poker_token_expiry
 *      / poker_auth_token), resolves { ok: true, tokens }
 *
 * Storage key parity:
 *   - Player-web uses oauth_access_token / oauth_refresh_token /
 *     oauth_id_token / oauth_expires_at
 *   - Poker-3d uses poker_auth_token (via tokenStorage) / poker_oauth_refresh
 *     / poker_oauth_id_token / poker_token_expiry
 *   This file writes the poker-3d keys so the existing App.jsx boot path
 *   picks the tokens up the same way it does after a regular /auth/callback.
 *
 * Caveats:
 *   - 5s timeout. Cross-origin iframe + auth-server cold start can be slow;
 *     5s is the same budget player-web uses. Caller should treat any
 *     timeout as "show the login screen" — no worse than today.
 *   - iOS Safari ITP may block the iframe in strict modes. We bail and
 *     let the LoginScreen render — same behavior as the status quo.
 *   - On success the caller is responsible for the socket-side
 *     `oauthLogin` emit (App.jsx boot effect already does this).
 */

import { setAuthToken, isKeepSignedIn } from './tokenStorage';

const AUTH_SERVER = import.meta.env.VITE_AUTH_SERVER_URL || 'https://auth.americanpubpoker.online';
const CLIENT_ID = 'poker-3d';
const SILENT_REDIRECT_URI = `${window.location.origin}/auth/silent-callback`;
const SCOPES = 'openid profile offline_access';
const SILENT_TIMEOUT_MS = 5_000;

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64urlEncode(digest);
}

/**
 * Attempt a silent (no UI) sign-in. Returns:
 *   { ok: true, tokens } on success — tokens persisted to storage
 *   { ok: false, reason } otherwise — caller should show LoginScreen
 *
 * Reasons:
 *   'no-session' | 'timeout' | 'iframe-blocked' | 'state-mismatch'
 *   'no-code' | 'token-exchange-failed' | 'message-listener-blocked'
 */
export async function trySilentLogin() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = (typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: SILENT_REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'none',
  });
  const authUrl = `${AUTH_SERVER}/auth?${params}`;

  return new Promise((resolve) => {
    let resolved = false;
    let iframe = null;
    let timer = null;
    let messageHandler = null;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      if (messageHandler) {
        try { window.removeEventListener('message', messageHandler); } catch {}
      }
      if (iframe && iframe.parentNode) {
        try { iframe.parentNode.removeChild(iframe); } catch {}
      }
      resolve(result);
    };

    messageHandler = async (e) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data;
      if (!data || data.type !== 'poker3d:silent-callback') return;

      const { code, state: returnedState, error: oauthError } = data;
      if (oauthError) {
        finish({ ok: false, reason: 'no-session', detail: oauthError });
        return;
      }
      if (returnedState !== state) {
        finish({ ok: false, reason: 'state-mismatch' });
        return;
      }
      if (!code) {
        finish({ ok: false, reason: 'no-code' });
        return;
      }

      try {
        const response = await fetch(`${AUTH_SERVER}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: SILENT_REDIRECT_URI,
            client_id: CLIENT_ID,
            code_verifier: codeVerifier,
          }),
        });
        if (!response.ok) {
          finish({ ok: false, reason: 'token-exchange-failed', status: response.status });
          return;
        }
        const tokens = await response.json();
        // Persist using poker-3d's storage keys to match what AuthCallback
        // writes — App.jsx's boot refreshAccessToken path keys off these.
        try {
          setAuthToken(tokens.access_token);
          const keep = isKeepSignedIn();
          const store = keep ? localStorage : sessionStorage;
          if (tokens.refresh_token) store.setItem('poker_oauth_refresh', tokens.refresh_token);
          store.setItem('poker_oauth_id_token', tokens.id_token || '');
          if (tokens.expires_in) {
            store.setItem('poker_token_expiry', String(Date.now() + tokens.expires_in * 1000));
          }
        } catch {}
        finish({ ok: true, tokens, reason: 'silent-auth' });
      } catch (err) {
        finish({ ok: false, reason: 'token-exchange-failed', detail: err?.message });
      }
    };

    try { window.addEventListener('message', messageHandler); } catch {
      finish({ ok: false, reason: 'message-listener-blocked' });
      return;
    }

    try {
      iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('title', 'Silent auth');
      iframe.src = authUrl;
      document.body.appendChild(iframe);
    } catch {
      finish({ ok: false, reason: 'iframe-blocked' });
      return;
    }

    timer = setTimeout(() => {
      finish({ ok: false, reason: 'timeout' });
    }, SILENT_TIMEOUT_MS);
  });
}

/**
 * Page handler — called by SilentCallback.jsx inside the iframe to post
 * the OAuth result back to the parent window. Type is namespaced
 * 'poker3d:silent-callback' to avoid confusion with player-web's
 * 'poker:silent-callback' (different origins, but explicit is better).
 */
export function postSilentCallbackToParent() {
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { type: 'poker3d:silent-callback', code, state, error, errorDescription },
        window.location.origin
      );
    }
  } catch {}
}

export function isSilentCallback() {
  return typeof window !== 'undefined'
    && window.location.pathname === '/auth/silent-callback';
}
