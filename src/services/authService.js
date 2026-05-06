// OAuth2 Authorization Code + PKCE flow for American Pub Poker SSO

const AUTH_SERVER = import.meta.env.VITE_AUTH_SERVER_URL || 'https://auth.americanpubpoker.online';
const CLIENT_ID = 'poker-3d';
const REDIRECT_URI = `${window.location.origin}/auth/callback`;
const SCOPES = 'openid profile offline_access';

// Default timeout for every OAuth fetch (token exchange, refresh, revocation).
// Beyond this we throw a transient error so callers can retry rather than
// hang the UI behind a stalled auth-server request.
const FETCH_TIMEOUT_MS = 10000;

// --- Error classes ------------------------------------------------------

/**
 * The refresh_token is no longer valid (user logged out elsewhere, admin
 * revoked, rotation race lost, etc.). Callers MUST force logout — retrying
 * will not help.
 */
export class RefreshTokenRevokedError extends Error {
  constructor(message = 'Refresh token revoked', details = {}) {
    super(message);
    this.name = 'RefreshTokenRevokedError';
    this.details = details;
  }
}

/**
 * The refresh attempt failed transiently (network glitch, 5xx, timeout).
 * Callers SHOULD retry — the refresh_token is probably still valid.
 */
export class RefreshTokenTransientError extends Error {
  constructor(message = 'Refresh token transient error', details = {}) {
    super(message);
    this.name = 'RefreshTokenTransientError';
    this.details = details;
  }
}

// --- PKCE helpers ---

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(digest);
}

// --- fetch with AbortController timeout ---------------------------------

async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Auth flow ---

// OAuth state + PKCE verifier in localStorage (cross-tab) with
// sessionStorage fallback. See player-web authService.js comment for
// rationale. Incident 2026-04-22: callback round-tripping to a different
// tab hit "OAuth state mismatch — possible CSRF attack" (not actually
// CSRF; just a per-tab storage scoping mismatch).

function readOAuthItem(key) {
  try {
    const v = localStorage.getItem(key);
    if (v != null) return v;
  } catch {}
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearOAuthItem(key) {
  try { localStorage.removeItem(key); } catch {}
  try { sessionStorage.removeItem(key); } catch {}
}

// 2026-05-05 Phase 2 #5 — multi-flow safe state storage. See
// apps/web/src/services/authService.js for full design notes. Each
// in-flight OAuth flow gets its own keyed entry under `oauth_pending`,
// so concurrent sign-ins across multiple .online tabs don't clobber
// each other.
const OAUTH_PENDING_KEY = 'oauth_pending';
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;

function readPendingMap() {
  try {
    const raw = localStorage.getItem(OAUTH_PENDING_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch { return {}; }
}
function writePendingMap(map) {
  try { localStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify(map)); } catch {}
}
function gcPendingMap(map) {
  const now = Date.now();
  for (const k of Object.keys(map)) {
    const e = map[k];
    if (!e || typeof e !== 'object' || !e.createdAt || (now - e.createdAt) > OAUTH_PENDING_TTL_MS) {
      delete map[k];
    }
  }
  return map;
}
function consumePending(state) {
  const pending = gcPendingMap(readPendingMap());
  const entry = pending[state];
  if (entry) {
    delete pending[state];
    writePendingMap(pending);
    return entry;
  }
  // Backward-compat fallback: pre-2026-05-05 single-key storage drained
  // ONCE so any in-flight sign-ins from the previous bundle complete.
  let legacyState = null, legacyVerifier = null;
  try { legacyState = readOAuthItem('oauth_state'); } catch {}
  try { legacyVerifier = readOAuthItem('oauth_code_verifier'); } catch {}
  if (legacyState === state && legacyVerifier) {
    clearOAuthItem('oauth_state');
    clearOAuthItem('oauth_code_verifier');
    return { verifier: legacyVerifier, createdAt: Date.now() };
  }
  return null;
}

export async function startLogin() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  // Add THIS flow to the pending map without disturbing any other
  // concurrent flows. GC stale entries while we're here.
  const pending = gcPendingMap(readPendingMap());
  pending[state] = { verifier: codeVerifier, createdAt: Date.now() };
  writePendingMap(pending);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${AUTH_SERVER}/auth?${params}`;
}

export async function handleCallback(code, state) {
  const entry = consumePending(state);
  if (!entry) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }
  const codeVerifier = entry.verifier;

  let response;
  try {
    response = await fetchWithTimeout(`${AUTH_SERVER}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: codeVerifier,
      }),
    });
  } catch (err) {
    // Network error or AbortController timeout — transient.
    throw new RefreshTokenTransientError(
      `Token exchange network error: ${err?.message || err}`,
      { cause: err },
    );
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Token exchange failed (${response.status}): ${errBody}`);
  }

  // { access_token, id_token, refresh_token, expires_in, token_type, scope }
  return response.json();
}

// Module-level singleton so concurrent callers (e.g. parallel API retries
// hitting 401 at the same time as the scheduled refresh timer) dedupe onto
// a single in-flight request. Without this you race two refreshes, one
// succeeds rotating the refresh_token, the other sees the now-invalidated
// token and kicks the user to logout.
let _inflightRefresh = null;

export async function refreshAccessToken(refreshToken) {
  if (_inflightRefresh) return _inflightRefresh;

  _inflightRefresh = (async () => {
    let response;
    try {
      response = await fetchWithTimeout(`${AUTH_SERVER}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
          // Re-assert the original scope so the auth server doesn't silently
          // narrow it on rotation (RFC 6749 §6). Must match initial grant.
          scope: SCOPES,
        }),
      });
    } catch (err) {
      // fetch rejected (network down, DNS, CORS, or AbortController timeout).
      // Classify as transient — the refresh_token is probably still valid,
      // so the caller should retry rather than force-logout.
      throw new RefreshTokenTransientError(
        `Refresh network error: ${err?.message || err}`,
        { cause: err },
      );
    }

    if (response.ok) {
      return response.json();
    }

    // Try to parse a JSON error body so we can distinguish `invalid_grant`
    // (refresh token revoked / expired / reused) from generic 4xx/5xx noise.
    let errBody = null;
    try {
      errBody = await response.json();
    } catch {
      // Non-JSON body — fall through with errBody = null.
    }
    const oauthError = errBody && typeof errBody.error === 'string' ? errBody.error : null;

    // `invalid_grant` is the OIDC signal that this refresh_token will never
    // work again. 400/401 without an explicit error are treated the same
    // because that's what the auth server returns for revoked sessions.
    if (oauthError === 'invalid_grant' || response.status === 400 || response.status === 401) {
      throw new RefreshTokenRevokedError(
        `Refresh token revoked (${response.status}${oauthError ? `: ${oauthError}` : ''})`,
        { status: response.status, oauthError, body: errBody },
      );
    }

    // 5xx / 429 / anything else — transient. Caller should retry.
    throw new RefreshTokenTransientError(
      `Refresh failed (${response.status}${oauthError ? `: ${oauthError}` : ''})`,
      { status: response.status, oauthError, body: errBody },
    );
  })();

  try {
    return await _inflightRefresh;
  } finally {
    _inflightRefresh = null;
  }
}

/**
 * Best-effort refresh-token revocation at the auth server.
 *
 * Fire-and-forget on logout so the token can't be replayed if it leaks from
 * localStorage (e.g. device handoff, shared kiosk). Must not block the
 * browser redirect to /session/end — uses sendBeacon where available,
 * otherwise fetch({ keepalive: true }) with a short abort guard.
 */
function revokeRefreshTokenFireAndForget(refreshToken) {
  if (!refreshToken) return;
  const url = `${AUTH_SERVER}/token/revoke`;
  const body = new URLSearchParams({
    token: refreshToken,
    token_type_hint: 'refresh_token',
    client_id: CLIENT_ID,
  });

  // sendBeacon guarantees the request survives the page unload that our
  // subsequent `window.location.href = ...` triggers. It accepts a Blob for
  // form-url-encoded bodies.
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body.toString()], { type: 'application/x-www-form-urlencoded' });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) return;
    }
  } catch {
    // sendBeacon blocked (Safari private mode, CSP quirks) — fall through.
  }

  // Fallback: keepalive fetch with a 2s abort cap so a stuck request can't
  // delay the logout redirect.
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 2000);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      keepalive: true,
      signal: controller.signal,
    }).catch(() => { /* fire-and-forget */ });
  } catch {
    // Last resort — ignore; browser is already redirecting.
  }
}

export function startLogout(idToken, refreshToken) {
  // Revoke the refresh_token server-side BEFORE the browser redirect so a
  // leaked token can't be replayed after the user thinks they logged out.
  // Resolves the "refresh_token lives forever in localStorage" gap — even
  // if localStorage is wiped client-side on logout, anything that already
  // exfiltrated the token before logout is now useless.
  //
  // Back-compat: existing callers (gameStore.logout) invoke startLogout with
  // just the idToken, and the refresh_token may already have been cleared
  // from storage by the time we run. Prefer an explicit argument; fall back
  // to reading storage directly so we still get the revocation whenever
  // possible.
  let tokenToRevoke = refreshToken;
  if (!tokenToRevoke) {
    try {
      tokenToRevoke =
        localStorage.getItem('poker_oauth_refresh') ||
        sessionStorage.getItem('poker_oauth_refresh');
    } catch {
      tokenToRevoke = null;
    }
  }
  if (tokenToRevoke) {
    revokeRefreshTokenFireAndForget(tokenToRevoke);
  }

  const params = new URLSearchParams({
    id_token_hint: idToken,
    post_logout_redirect_uri: window.location.origin,
  });
  window.location.href = `${AUTH_SERVER}/session/end?${params}`;
}

export function isAuthCallback() {
  return window.location.pathname === '/auth/callback';
}

export function getCallbackParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    errorDescription: params.get('error_description'),
  };
}
