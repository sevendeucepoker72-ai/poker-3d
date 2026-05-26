// OAuth2 Authorization Code + PKCE flow for American Pub Poker SSO

const AUTH_SERVER = import.meta.env.VITE_AUTH_SERVER_URL || 'https://auth.americanpubpoker.online';
const CLIENT_ID = 'poker-3d';
const REDIRECT_URI = `${window.location.origin}/auth/callback`;
const SCOPES = 'openid profile offline_access';

// Default timeout for every OAuth fetch (token exchange, refresh, revocation).
// Beyond this we throw a transient error so callers can retry rather than
// hang the UI behind a stalled auth-server request.
//
// 2026-05-07 device-audit P0 — bumped 10000 → 12000 to match marketing/
// player-web. Cold-start Cloud Run can take 2-3s; on slow 3G the double
// round-trip can blow past 10s. 12s is permissive enough for real network
// slowness while still ending the spinner before users assume breakage.
const FETCH_TIMEOUT_MS = 12000;

// 2026-05-07 device-audit P0 — `crypto.randomUUID` requires Safari 15.4 /
// Chrome 92. Older devices throw TypeError. Fall back to v4 UUID via
// getRandomValues, then to Math.random as a last resort.
function _safeRandomUUID() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// 2026-05-07 device-audit P0 — clear-error gate for browsers without
// WebCrypto (insecure context, very old Safari, embedded webviews with
// crypto disabled). Pre-fix, login failed with a generic toast.
function _assertCryptoAvailable() {
  const ok = typeof crypto !== 'undefined'
    && crypto.subtle
    && typeof crypto.subtle.digest === 'function'
    && typeof crypto.getRandomValues === 'function';
  if (!ok) {
    const e = new Error(
      'Secure sign-in is not available in this browser. Open this page in Chrome, Safari, or Firefox and make sure the URL starts with https://'
    );
    e.code = 'crypto_unsupported';
    throw e;
  }
}

// 2026-05-07 device-audit P0 — best-effort detection for in-app webviews
// (Facebook, Instagram, TikTok, Line, etc.). These browsers strip third-
// party cookies, block popups, and frequently break OAuth redirects in
// ways the user can't recover from. Detect them so the UI can show an
// "Open in Safari/Chrome" CTA instead of letting the login silently fail.
export function detectInAppBrowser() {
  try {
    const ua = String(navigator.userAgent || '');
    if (/fbav|fban|fbios|fbsv|fb_iab/i.test(ua)) return { inApp: true, app: 'Facebook' };
    if (/instagram/i.test(ua))                   return { inApp: true, app: 'Instagram' };
    if (/twitter\b/i.test(ua))                   return { inApp: true, app: 'Twitter / X' };
    if (/tiktok|musical_ly|aweme/i.test(ua))     return { inApp: true, app: 'TikTok' };
    if (/linkedinapp/i.test(ua))                 return { inApp: true, app: 'LinkedIn' };
    if (/line\//i.test(ua))                      return { inApp: true, app: 'Line' };
    if (/micromessenger/i.test(ua))              return { inApp: true, app: 'WeChat' };
    if (/snapchat/i.test(ua))                    return { inApp: true, app: 'Snapchat' };
    return { inApp: false };
  } catch {
    return { inApp: false };
  }
}

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

export async function startLogin({ prompt = null, returnTo = null } = {}) {
  // 2026-05-07 device-audit P0 — bail with a clear, actionable message
  // for browsers without WebCrypto instead of a generic toast.
  _assertCryptoAvailable();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = _safeRandomUUID();

  // Add THIS flow to the pending map without disturbing any other
  // concurrent flows. GC stale entries while we're here.
  const pending = gcPendingMap(readPendingMap());
  pending[state] = {
    verifier: codeVerifier,
    createdAt: Date.now(),
    returnTo: returnTo || null,
    silent: prompt === 'none',
  };
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
  // 2026-05-08 — see player-web authService.js for prompt= rationale.
  if (prompt === 'none' || prompt === 'login') {
    params.set('prompt', prompt);
  }

  window.location.href = `${AUTH_SERVER}/auth?${params}`;
}

// 2026-05-08 — cold-start cross-site SSO entry point for .online.
// See full design comment in apps/web/src/services/authService.js.
export async function startSilentLogin({ returnTo = null } = {}) {
  return startLogin({ prompt: 'none', returnTo });
}

// 2026-05-07 OAuth audit P0 — silent re-auth via the OIDC server's SSO cookie.
//
// When the refresh_token has expired (>30d on .online) but the SSO session
// cookie at auth.americanpubpoker.online is still valid, redirecting through
// /authorize returns a fresh code WITHOUT prompting the user — the auth-server
// recognizes the SSO cookie and immediately redirects back to /auth/callback.
//
// User-visible: a brief flash to auth.americanpubpoker.online and back. No
// login form unless the cookie is genuinely gone, in which case the regular
// login form appears (which is the right behavior — better than dropping the
// user with "your session expired" and forcing them to click Login).
//
// Used by App.jsx and authScheduler when a refresh fails with
// RefreshTokenRevokedError. Equivalent to player-web's silentReauth().
export function silentReauth() {
  return startLogin();
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

// 2026-05-07 OAuth audit P1 — cross-tab refresh single-flight, ported from
// player-web/authService.js. Without it, two .online tabs whose access
// tokens expire near-simultaneously each fire their own /token POST. Even
// with rotation off (current auth-server config), this churns network +
// emits paired refresh_success events and dispatches duplicate
// poker:token-refreshed customEvents. With rotation eventually enabled,
// it would invalidate the refresh-token family for the lagging tab.
//
// Pattern: localStorage lock keyed by per-attempt UUID so cross-tab waiters
// can verify which lock signaled completion (defends against a leader tab
// crashing mid-refresh). 5s TTL — well above the FETCH_TIMEOUT_MS for the
// network call.
export const REFRESH_LOCK_KEY = 'oauth_refresh_in_flight_at';
export const REFRESH_DONE_KEY = 'oauth_refresh_completed_at';
export const REFRESH_LOCK_TTL_MS = 5000;

function _generateLockToken() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function _readLock() {
  try {
    const raw = localStorage.getItem(REFRESH_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        token: parsed.token || null,
        startedAt: Number(parsed.startedAt) || 0,
      };
    }
  } catch {}
  return null;
}

function _readDone() {
  try {
    const raw = localStorage.getItem(REFRESH_DONE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        token: parsed.token || null,
        completedAt: Number(parsed.completedAt) || 0,
      };
    }
  } catch {}
  return null;
}

export function isRefreshInFlight() {
  const lock = _readLock();
  if (!lock || !lock.startedAt) return false;
  return (Date.now() - lock.startedAt) < REFRESH_LOCK_TTL_MS;
}

export async function waitForRefreshCompletion(timeoutMs = REFRESH_LOCK_TTL_MS) {
  const startedAt = Date.now();
  const initialLock = _readLock();
  const watchedToken = initialLock?.token || null;

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
    const done = _readDone();
    if (done) {
      if (watchedToken && done.token && done.token === watchedToken) return true;
      if (!watchedToken || !done.token) {
        if (done.completedAt >= startedAt) return true;
      }
    }
    if (!isRefreshInFlight()) return false;
    if (watchedToken) {
      const currentLock = _readLock();
      if (currentLock?.token && currentLock.token !== watchedToken) return false;
    }
  }
  return false;
}

export async function refreshAccessToken(refreshToken) {
  // In-tab dedup first — cheapest possible path.
  if (_inflightRefresh) return _inflightRefresh;

  // Cross-tab dedup: if another .online tab is already refreshing, wait for
  // it to complete then read its result from localStorage. This avoids two
  // tabs each consuming the refresh_token (which under rotation would burn
  // one of them).
  if (isRefreshInFlight()) {
    const completed = await waitForRefreshCompletion();
    if (completed) {
      try {
        const fresh = localStorage.getItem('poker_oauth_access');
        const expRaw = localStorage.getItem('poker_token_expiry');
        if (fresh) {
          const expiresIn = expRaw
            ? Math.max(0, Math.floor((parseInt(expRaw, 10) - Date.now()) / 1000))
            : null;
          return { access_token: fresh, expires_in: expiresIn };
        }
      } catch {}
    }
    // Fall through and try our own refresh — the leader tab probably crashed.
  }

  // Acquire the cross-tab lock BEFORE the network call.
  const lockToken = _generateLockToken();
  try {
    localStorage.setItem(
      REFRESH_LOCK_KEY,
      JSON.stringify({ token: lockToken, startedAt: Date.now() })
    );
  } catch {}

  _inflightRefresh = (async () => {
    let response;
    try {
      response = await fetchWithTimeout(`${AUTH_SERVER}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        // 2026-05-26 — dropped the explicit `scope` param.
        //
        // RFC 6749 §6 allows clients to re-assert scope on refresh to
        // prevent silent narrowing, but oidc-provider was rejecting
        // matched scopes with `400 invalid_scope` for refresh_tokens
        // originally minted before offline_access was forced into every
        // grant (see config.ts loadExistingGrant). Every returning user
        // on .online hit this and got force-logged-out via
        // RefreshTokenRevokedError, which then triggered the SSO
        // round-trip that ran into the AuthCallback 10s timeout
        // (now bumped to 25s).
        //
        // Per RFC 6749 §6 omitting `scope` is "treated as equal to the
        // scope originally granted" — exactly the behavior we want, and
        // it bypasses the provider's strict-equality check.
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
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
      const data = await response.json();
      // Persist the new tokens to localStorage so any tab that was waiting
      // on our cross-tab lock (waitForRefreshCompletion) can read them.
      try {
        if (data.access_token) {
          // Mirror to a stable key the waiter polls. Keep also writing
          // poker_token_expiry so the existing scheduler keeps working.
          localStorage.setItem('poker_oauth_access', data.access_token);
        }
        if (data.expires_in) {
          const expiresAt = Date.now() + Number(data.expires_in) * 1000;
          localStorage.setItem('poker_token_expiry', String(expiresAt));
        }
        if (data.refresh_token) {
          localStorage.setItem('poker_oauth_refresh', data.refresh_token);
        }
        if (data.id_token) {
          localStorage.setItem('poker_oauth_id_token', data.id_token);
        }
        // Order matters: drop the lock AFTER tokens land, then stamp completion.
        localStorage.removeItem(REFRESH_LOCK_KEY);
        localStorage.setItem(
          REFRESH_DONE_KEY,
          JSON.stringify({ token: lockToken, completedAt: Date.now() })
        );
      } catch {}
      return data;
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
  } catch (err) {
    // On any failure, drop the lock so other tabs don't sit waiting for a
    // completion stamp that will never come.
    try { localStorage.removeItem(REFRESH_LOCK_KEY); } catch {}
    throw err;
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
  // 2026-05-15 — corrected path from `/token/revoke` to `/token/revocation`.
  // The auth-server's discovery doc advertises revocation_endpoint as
  // /token/revocation (RFC 7009 standard for oidc-provider). The old
  // /token/revoke was returning 404 silently, which fire-and-forget
  // swallowed — meaning every poker-3d logout for months left the
  // refresh token alive for its full 30-day TTL. Verified via
  // curl https://auth.americanpubpoker.online/.well-known/openid-configuration.
  const url = `${AUTH_SERVER}/token/revocation`;
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
  // 2026-05-19 — DO NOT call revokeRefreshTokenFireAndForget here.
  //
  // The 2026-05-15 attempt to fire a sendBeacon /token/revocation BEFORE
  // navigating to /session/end re-introduced the EXACT race documented
  // in auth-server/src/config.ts:41-54 (2026-05-07 P0). /token/revocation
  // calls Grant.destroy() (RFC 7009 — revoking an RT revokes the entire
  // token family), which DELETEs every oidc_payloads row where
  // grant_id = X. /session/end is then reached while the grant is in
  // the process of being torn down; the Logout interaction it creates
  // can't find its parent grant by the time /session/end/confirm runs,
  // and the auto-submit returns
  //   "Authentication Error: invalid_request: could not find logout details"
  //
  // The revoke is also redundant: auth-server's postLogoutSuccessSource
  // destroys the grant for the requesting client AFTER /session/end/confirm
  // completes successfully. That kills the refresh_token row alongside the
  // access_token row — without racing.
  // (refreshToken parameter kept for back-compat with existing callers.)
  void refreshToken;

  const params = new URLSearchParams({
    post_logout_redirect_uri: window.location.origin,
  });
  // 2026-05-15 — guard against literal 'undefined' in URL; matches player + admin behavior.
  if (idToken) {
    params.set('id_token_hint', idToken);
  }
  window.location.href = `${AUTH_SERVER}/session/end?${params}`;
}

export function isAuthCallback() {
  return window.location.pathname === '/auth/callback';
}

// 2026-05-07 OAuth audit P0 — iOS PWA recurring-login fix.
//
// On iOS Safari, when a user launches the app from the Home Screen and the
// auth-server redirects back to /auth/callback, `window.location.search` is
// frequently EMPTY by the time JS runs even though the URL bar visually
// contains `?code=...&state=...`. This is iOS's "PWA cold launch URL
// stripping" — the OS hands the WebKit view a stripped URL, then `pushState`s
// the full URL into the bar shortly after. By then `URLSearchParams(search)`
// has already returned nothing.
//
// Symptoms (matches user complaint "tired of not being able to login to
// .online"): callback fires with code=null/state=null, the flow aborts with
// "Invalid callback — missing parameters", user is bounced back to login.
// Lather, rinse, repeat.
//
// Fix: try multiple sources in priority order, the FIRST that yields a code
// wins, and cache the successful read in sessionStorage so any re-mount of
// AuthCallback (StrictMode double-mount, route remount) sees the same params
// even after `history.replaceState({}, '', '/')` scrubs them from the URL.
//
// Sources tried (the union of every place iOS / Safari / PWA may have the
// query string):
//   1. window.location.search     — normal browsers
//   2. window.location.href       — sometimes search is empty but href is full
//   3. document.URL               — Safari occasionally only populates this
//   4. sessionStorage cache       — for re-mounts after replaceState scrub
//   5. window.location.hash       — fragment-encoded code (some PWA configs)
const CALLBACK_CACHE_KEY = 'oauth_callback_params_cache';

function _readCallbackFromAnySource() {
  // 1. Standard search string.
  try {
    const sp = new URLSearchParams(window.location.search || '');
    if (sp.get('code') || sp.get('error')) return sp;
  } catch {}

  // 2. Parse out of the full href (catches the iOS PWA edge case where
  //    `search` is empty but `href` has the query string).
  try {
    const href = window.location.href || '';
    const qIdx = href.indexOf('?');
    if (qIdx >= 0) {
      const after = href.slice(qIdx + 1);
      const hashCut = after.indexOf('#');
      const qs = hashCut >= 0 ? after.slice(0, hashCut) : after;
      const sp = new URLSearchParams(qs);
      if (sp.get('code') || sp.get('error')) return sp;
    }
  } catch {}

  // 3. document.URL — independent of window.location's flakiness in PWA.
  try {
    const docUrl = (typeof document !== 'undefined' && document.URL) || '';
    const qIdx = docUrl.indexOf('?');
    if (qIdx >= 0) {
      const after = docUrl.slice(qIdx + 1);
      const hashCut = after.indexOf('#');
      const qs = hashCut >= 0 ? after.slice(0, hashCut) : after;
      const sp = new URLSearchParams(qs);
      if (sp.get('code') || sp.get('error')) return sp;
    }
  } catch {}

  // 4. sessionStorage cache from an earlier read this navigation.
  try {
    const raw = sessionStorage.getItem(CALLBACK_CACHE_KEY);
    if (raw) {
      const sp = new URLSearchParams(raw);
      if (sp.get('code') || sp.get('error')) return sp;
    }
  } catch {}

  // 5. Hash fragment fallback. Some PWA setups encode the response in the
  //    fragment (response_mode=fragment). We don't request that mode but
  //    iOS can rewrite the URL into one in rare cases. Strip leading '#'.
  try {
    const hash = (window.location.hash || '').replace(/^#/, '');
    if (hash) {
      const sp = new URLSearchParams(hash);
      if (sp.get('code') || sp.get('error')) return sp;
    }
  } catch {}

  // Nothing — return an empty params object so callers see code=null.
  return new URLSearchParams('');
}

export function getCallbackParams() {
  const params = _readCallbackFromAnySource();
  // Cache for any subsequent call (e.g. AuthCallback re-mount after
  // replaceState scrubs the URL bar). Best-effort.
  try {
    if (params.get('code') || params.get('error')) {
      sessionStorage.setItem(CALLBACK_CACHE_KEY, params.toString());
    }
  } catch {}
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    errorDescription: params.get('error_description'),
  };
}

// Clear the callback cache. Called by AuthCallback after the token exchange
// completes (success OR terminal failure) so a subsequent /auth/callback
// navigation in the same browser tab starts fresh.
export function clearCallbackParamsCache() {
  try { sessionStorage.removeItem(CALLBACK_CACHE_KEY); } catch {}
}
