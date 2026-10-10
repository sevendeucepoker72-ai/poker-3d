/**
 * tokenStorage — auth token persistence honoring the "Keep me signed in"
 * checkbox. Routes the token (and the flag itself) to localStorage when
 * "keep signed in" is on so the session survives tab-close / browser
 * restart; otherwise uses sessionStorage so it dies with the tab.
 *
 * Background: the rest of the app uses sessionStorage (per "nothing
 * should be localStorage anymore"), but sessionStorage by definition is
 * wiped when the tab closes — breaking "Keep me signed in". The auth
 * token is the one exception: when the user explicitly asks the device
 * to remember them, the token MUST outlive the tab lifecycle.
 *
 * The flag itself ("poker_keep_signed_in") also lives in localStorage
 * so the next visit can know which storage to read from.
 */
import { getTabSession } from './tabSession';

const TOKEN_KEY = 'poker_auth_token';
const FLAG_KEY  = 'poker_keep_signed_in';
const USERNAME_KEY = 'poker_username';

function safeGet(store, key) {
  try { return store?.getItem?.(key); } catch { return null; }
}
function safeSet(store, key, val) {
  try { store?.setItem?.(key, val); return true; } catch { return false; }
}
function safeRemove(store, key) {
  try { store?.removeItem?.(key); } catch { /* ignore */ }
}

/** Read the "Keep me signed in" flag — defaults ON if never set. */
export function isKeepSignedIn() {
  // Check localStorage first (persistent), then sessionStorage as fallback.
  const fromLocal   = safeGet(typeof window !== 'undefined' ? window.localStorage   : null, FLAG_KEY);
  const fromSession = safeGet(typeof window !== 'undefined' ? window.sessionStorage : null, FLAG_KEY);
  const val = fromLocal ?? fromSession;
  return val !== '0';
}

/** Persist the "Keep me signed in" preference. */
export function setKeepSignedIn(enabled) {
  const bool = enabled ? '1' : '0';
  safeSet(typeof window !== 'undefined' ? window.localStorage   : null, FLAG_KEY, bool);
  safeSet(typeof window !== 'undefined' ? window.sessionStorage : null, FLAG_KEY, bool);
}

/** Read the auth token — localStorage first, then sessionStorage fallback. */
export function getAuthToken() {
  return (
    safeGet(typeof window !== 'undefined' ? window.localStorage   : null, TOKEN_KEY) ||
    safeGet(typeof window !== 'undefined' ? window.sessionStorage : null, TOKEN_KEY) ||
    null
  );
}

/**
 * Bearer token for MASTER-API HTTP calls (avatars, push, notifications).
 *
 * 2026-07-14 platform-auth-uniformity fix — align .online with the three web
 * SPAs (player-app tokenSelect.readBearerToken / admin readToken), which prefer
 * the JWT access token but FALL BACK to the JWT id_token when the access token
 * is OPAQUE (bridge / ticket / legacy grants that didn't carry
 * resource=API_RESOURCE). The master API's requireAuth can't verify an opaque
 * bearer ("Invalid Compact JWS" -> 401 under enforce), but it DOES accept the
 * id_token (RS256 JWT, aud=client_id which is in REQUIRE_AUTH_AUDIENCES). The
 * primary bearer (poker_auth_token) is the ACCESS token — a JWT for the common
 * resource=API_RESOURCE login, so this is a no-op there.
 *
 * IMPORTANT: HTTP-ONLY. The Socket.io transport (socketService /
 * multiTableManager) MUST keep sending the ACCESS token via getAuthToken():
 * poker-server's JWKS path requires typ='at+jwt' and REJECTS id_tokens, so an
 * id_token would break socket auth. Never route the socket through this.
 *
 * 2026-10-10 (F5) — in a "Play Online" TICKET tab only a token that provably
 * belongs to THIS tab's own account is returned (bearerForThisTab), else
 * null: the tab holds no OIDC credential of its own, and the device-wide
 * stored tokens can be a DIFFERENT account's sign-in (shared browser). The
 * call then goes out without a bearer — degraded, never as another account.
 * Every other tab: unchanged.
 */
export function getHttpBearer() {
  const isJwt = (t) => typeof t === 'string' && t.split('.').length === 3;
  const at = getAuthToken();
  const id = getOAuthItem('poker_oauth_id_token');
  if (isTicketTab()) {
    const own = [at, id].find((t) => isJwt(t) && bearerForThisTab(t));
    if (own) return own;
    warnNoOwnBearerOnce();
    return null;
  }
  if (isJwt(at)) return at;   // JWT access token (RFC 9068) — preferred
  if (isJwt(id)) return id;   // opaque AT -> fall back to the JWT id_token
  return at || id || null;    // last resort
}

// ── Whose OIDC sign-in a token / this device holds (F5, 2026-10-10) ──────────
// A shared browser can hold account B's OIDC sign-in (localStorage, keep me
// signed in) while a "Play Online" ticket tab is account A's session. The
// device-wide tokens are only ever used by such a tab when they provably name
// the same account. Identity = the `sub` claim (the master users.id the
// auth-server issues as the subject) of an OIDC JWT. Decoded, never verified:
// this only decides whether to SEND a token, the server still verifies it.

/**
 * The master user id (`sub`) an auth-server JWT names, or null. Only
 * asymmetrically signed JWTs count (the auth-server's RS256 / ES256): an
 * HS256 poker-server token (legacy login, resume token) or an unsigned one is
 * never an OIDC identity.
 */
export function oidcSubject(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodeJwtSegment(parts[0]);
  const alg = header && typeof header.alg === 'string' ? header.alg : '';
  if (!alg || /^(HS\d+|none)$/i.test(alg)) return null;
  const payload = decodeJwtSegment(parts[1]);
  const sub = payload && (typeof payload.sub === 'string' || typeof payload.sub === 'number')
    ? String(payload.sub).trim()
    : '';
  return sub || null;
}

/**
 * The OIDC sign-in this DEVICE holds: `{ signedIn, masterUserId }`.
 *   signedIn      a refresh token is stored (what the boot's refresh path
 *                 signs in with);
 *   masterUserId  the one master user id every stored OIDC JWT (id_token,
 *                 access tokens) names — null when none is readable or they
 *                 disagree (then it is not provably anyone's).
 */
export function getStoredOidcAccount() {
  const subjects = new Set();
  for (const t of [getOAuthItem('poker_oauth_id_token'), getOAuthItem('poker_oauth_access'), getAuthToken()]) {
    const s = oidcSubject(t);
    if (s) subjects.add(s);
  }
  return {
    signedIn: !!getOAuthItem('poker_oauth_refresh'),
    masterUserId: subjects.size === 1 ? [...subjects][0] : null,
  };
}

/**
 * 2026-10-10 — true when this browser holds ANY stored OIDC credential (a
 * refresh token, an id / access token) that is not provably the account
 * `masterUserId` (another account's, an unreadable one, or no master id to
 * compare with). The same test a ticket tab's Sign Out uses to leave such a
 * sign-in alone (gameStore.ticketTabLeavesDeviceSignIn); App.jsx uses it to
 * keep a Play Online ticket out of that sign-in's device-wide
 * poker_auth_token.
 */
export function deviceHoldsOtherOidcSignIn(masterUserId) {
  try {
    const dev = getStoredOidcAccount();
    const holds = dev.signedIn || !!dev.masterUserId
      || !!getOAuthItem('poker_oauth_id_token') || !!getOAuthItem('poker_oauth_access');
    if (!holds) return false;
    const mine = masterUserId === null || masterUserId === undefined ? '' : String(masterUserId).trim();
    return !(mine && dev.masterUserId === mine);
  } catch {
    return true;
  }
}

/** True when THIS TAB is a "Play Online" ticket session (tabSession kind). */
export function isTicketTabSession() {
  return isTicketTab();
}

function isTicketTab() {
  try {
    const tab = getTabSession();
    return !!(tab && tab.kind === 'ticket');
  } catch {
    return false;
  }
}

/**
 * May THIS TAB send `token` as an HTTP bearer? Returns the token, or null.
 * Always the token, except in a "Play Online" TICKET tab: there only an OIDC
 * JWT whose `sub` is this tab's own master user id (tabSession.masterUserId)
 * is sent — never another account's stored sign-in, never a token whose
 * owner cannot be read.
 */
export function bearerForThisTab(token) {
  if (!token) return null;
  let tab = null;
  try { tab = getTabSession(); } catch { tab = null; }
  if (!tab || tab.kind !== 'ticket') return token;
  const mine = tab.masterUserId;
  return mine && oidcSubject(token) === mine ? token : null;
}

/**
 * True in a TICKET tab that holds no bearer of its own account: master-API
 * calls that need the caller's identity (push enrollment, photo upload) are
 * skipped there instead of being sent unauthenticated (F5).
 */
export function isTicketTabWithoutOwnBearer() {
  return isTicketTab() && !getHttpBearer();
}

let _warnedNoOwnBearer = false;
function warnNoOwnBearerOnce() {
  if (_warnedNoOwnBearer) return;
  _warnedNoOwnBearer = true;
  try { console.warn('[http-bearer] Play Online tab holds no sign-in of its own account; master-API calls go out without a bearer'); } catch { /* ignore */ }
}

// ── Legacy guest credential (2026-10-09, guest carry-over) ──────────────────
// Before 2026-10-07 "Play as Guest" registered a local poker-server account
// (GuestNNNN, random password the player never saw) and stored the server's
// legacy token in poker_auth_token via setAuthToken. That token — an HS256 JWT
// `{ userId: <local int>, username, tokenVersion }` (poker-server
// authManager.generateToken) — is the ONLY key to that guest's chips and
// progress. Signing in with an American Pub Poker account overwrites
// poker_auth_token, so the guest token is set aside here first and offered for
// a one-time carry-over (services/guestCarryOver.js → socket
// peekGuestProgress / claimGuestProgress). poker-server decides whether it
// really is an unclaimed guest; this only keeps the key from being thrown away.
// Only a token whose `username` claim is GuestNNNN is ever kept: pre-OIDC
// phone/password ACCOUNTS hold the very same token shape (isGuestLegacyToken).
//
// Never confused with the other things poker_auth_token can hold:
//   - OIDC access tokens: opaque, or RS256/ES256 JWTs (alg is not HS256);
//   - deep-link tickets: TWO-part `payload.sig` (master onlineLinkToken);
//   - resume tokens never go in poker_auth_token (services/sessionResume.js).
const GUEST_CLAIM_KEY = 'poker_guest_claim';

function decodeJwtSegment(segment) {
  try {
    const b64 = String(segment).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    const json = typeof atob === 'function' ? atob(padded) : '';
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Decoded payload of a JWT-shaped (3-part) token, or null. Never verifies. */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  return decodeJwtSegment(parts[1]);
}

/**
 * True when `token` is poker-server's legacy local-account token (the
 * credential the retired guest flow stored). Shape check only — the server is
 * the judge of whether it is valid, a guest, or already claimed.
 */
export function isLegacyLocalToken(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const header = decodeJwtSegment(parts[0]);
  if (!header || header.alg !== 'HS256') return false;
  const payload = decodeJwtSegment(parts[1]);
  if (!payload) return false;
  if (!Number.isInteger(payload.userId)) return false;
  // OIDC / resume / other server tokens carry these; the legacy token never does.
  if (payload.kind || payload.iss || payload.sub || payload.localUserId) return false;
  return true;
}

// The retired guest flow's generated username (GuestNNNN — the display name may
// have been changed since, the username never is). Same pattern poker-server
// uses to decide what a guest row is (contract R2, guestClaim.ts).
const GUEST_USERNAME_RE = /^Guest\d+$/i;

/**
 * True when `token` is a legacy local token whose `username` claim is a
 * retired-guest username (GuestNNNN). poker-server's generateToken makes the
 * SAME token shape for accounts that signed in with phone + password before
 * OIDC, so the shape alone is not enough: only a GuestNNNN token is ever set
 * aside as a guest credential. An account's legacy token is never kept for
 * the carry-over (and never offered to whoever signs in next on the device).
 */
export function isGuestLegacyToken(token) {
  if (!isLegacyLocalToken(token)) return false;
  const payload = decodeJwtPayload(token);
  const username = payload && typeof payload.username === 'string' ? payload.username.trim() : '';
  return GUEST_USERNAME_RE.test(username);
}

/**
 * Set a legacy guest credential aside for the one-time carry-over offer.
 * Stored where the keep-signed-in flag says (same rule as every credential
 * here: a session-only device keeps it for this tab only), the other store
 * swept. Ignores anything that is not a GUEST legacy token (isGuestLegacyToken).
 */
export function stashGuestCredential(token) {
  if (!isGuestLegacyToken(token)) return false;
  const win = typeof window !== 'undefined' ? window : null;
  if (!win) return false;
  const keep = isKeepSignedIn();
  // T7 — re-stashing the SAME token keeps the account it was deferred to; a
  // different token (another guest) starts unbound.
  const prev = readStashedGuestRecord();
  const deferredBy = prev && prev.token === token && prev.deferredBy ? prev.deferredBy : undefined;
  const value = JSON.stringify({ token, savedAt: Date.now(), ...(deferredBy ? { deferredBy } : {}) });
  const ok = safeSet(keep ? win.localStorage : win.sessionStorage, GUEST_CLAIM_KEY, value);
  safeRemove(keep ? win.sessionStorage : win.localStorage, GUEST_CLAIM_KEY);
  if (ok) {
    try { console.warn('[guest-carry] guest credential set aside for a one-time carry-over offer'); } catch { /* ignore */ }
  }
  return ok;
}

// The stored stash record `{ token, savedAt, deferredBy? }` and the store it
// lives in, or null (nothing stored, unreadable, or not a GUEST token — those
// are dropped).
function readStashedGuestRecord() {
  const win = typeof window !== 'undefined' ? window : null;
  if (!win) return null;
  let store = win.localStorage;
  let raw = safeGet(store, GUEST_CLAIM_KEY);
  if (!raw) { store = win.sessionStorage; raw = safeGet(store, GUEST_CLAIM_KEY); }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const token = parsed && typeof parsed.token === 'string' ? parsed.token : null;
    if (isGuestLegacyToken(token)) {
      const deferredBy = typeof parsed.deferredBy === 'string' && parsed.deferredBy.trim()
        ? parsed.deferredBy.trim()
        : null;
      return { token, savedAt: parsed.savedAt, deferredBy, store };
    }
  } catch { /* fall through: unreadable → drop it */ }
  clearStashedGuestCredential();
  return null;
}

/** The set-aside legacy guest token, or null. */
export function getStashedGuestCredential() {
  const rec = readStashedGuestRecord();
  return rec ? rec.token : null;
}

/**
 * T7 (2026-10-09) — the account (local user id, string) that put the
 * carry-over offer for the set-aside guest token off with "Not now", or null
 * when the token is not bound to anyone yet. A bound token is offered again
 * ONLY to that account (guestCarryOver.maybeOfferGuestCarryOver), and only
 * THAT account's explicit Sign Out forgets it
 * (clearStashedGuestCredentialOnSignOut, from gameStore.tearDownSession).
 */
export function getStashedGuestDeferredBy() {
  const rec = readStashedGuestRecord();
  return rec ? rec.deferredBy : null;
}

/**
 * T7 — bind the set-aside guest token to `userId`, the account that just put
 * the offer off ("Not now"). Only when the stash still holds `expectToken`
 * (when given) — never re-binds a token the offer was not about. Written back
 * to the store it already lives in. Returns true when bound.
 */
export function deferGuestCredentialFor(userId, expectToken) {
  const id = userId === null || userId === undefined ? '' : String(userId).trim();
  if (!id) return false;
  const rec = readStashedGuestRecord();
  if (!rec) return false;
  if (expectToken && rec.token !== expectToken) return false;
  return safeSet(rec.store, GUEST_CLAIM_KEY, JSON.stringify({ token: rec.token, savedAt: rec.savedAt, deferredBy: id }));
}

/** Forget the set-aside guest token (answered, claimed, or not a guest). */
export function clearStashedGuestCredential() {
  const win = typeof window !== 'undefined' ? window : null;
  if (!win) return;
  safeRemove(win.localStorage, GUEST_CLAIM_KEY);
  safeRemove(win.sessionStorage, GUEST_CLAIM_KEY);
}

/**
 * T7 / U6 (2026-10-09) — the explicit Sign Out of the account `userId` (local
 * user id): forget the set-aside guest token ONLY when it is unbound or bound
 * to `userId` itself. A token another account put off with "Not now" is KEPT
 * for that account — it is the only key to that guest's chips, it is never
 * offered to anyone else (guestCarryOver), and that account's own Sign Out
 * forgets it. Returns true when the token was forgotten.
 */
export function clearStashedGuestCredentialOnSignOut(userId) {
  const rec = readStashedGuestRecord();
  if (!rec) return false; // nothing set aside (an unreadable entry is dropped by the read)
  const id = userId === null || userId === undefined ? '' : String(userId).trim();
  if (rec.deferredBy && rec.deferredBy !== id) {
    try { console.warn('[guest-carry] sign-out kept a guest key bound to another account on this device'); } catch { /* ignore */ }
    return false;
  }
  clearStashedGuestCredential();
  return true;
}

/**
 * Persist the auth token. If keep-signed-in is on (default), writes to
 * localStorage so the token survives tab close; otherwise writes to
 * sessionStorage only (dies with the tab).
 *
 * 2026-10-09 — when an account credential (OIDC access token, deep-link
 * ticket) replaces a legacy GUEST token (GuestNNNN username claim), the guest
 * token is set aside first (stashGuestCredential) so its progress can still be
 * carried over. A legacy ACCOUNT token is simply replaced, never kept.
 *
 * @param {string} token
 * @param {boolean} [remember] — explicit override of the stored flag
 */
export function setAuthToken(token, remember) {
  if (!token) return;
  try {
    const prev = getAuthToken();
    if (prev && prev !== token && isGuestLegacyToken(prev) && !isLegacyLocalToken(token)) {
      stashGuestCredential(prev);
    }
  } catch { /* never block the write */ }
  const keep = remember === undefined ? isKeepSignedIn() : !!remember;
  if (keep) {
    safeSet(typeof window !== 'undefined' ? window.localStorage : null, TOKEN_KEY, token);
    // Mirror to sessionStorage so anything still reading sessionStorage
    // directly sees a fresh value this session.
    safeSet(typeof window !== 'undefined' ? window.sessionStorage : null, TOKEN_KEY, token);
  } else {
    // Not persisting — ensure no stale localStorage copy lingers.
    safeRemove(typeof window !== 'undefined' ? window.localStorage : null, TOKEN_KEY);
    safeSet(typeof window !== 'undefined' ? window.sessionStorage : null, TOKEN_KEY, token);
  }
  // Update the flag too in case it wasn't set.
  if (remember !== undefined) setKeepSignedIn(keep);
}

// ── OAuth token persistence (poker_oauth_access / _refresh / _id_token /
// poker_token_expiry) ──────────────────────────────────────────────────────
// These must obey the SAME "Keep me signed in" flag as the primary auth token.
// F1 (2026-07-01 audit): the token-refresh scheduler wrote them unconditionally
// to localStorage, so a session-only login (keep-signed-in OFF) had its refresh
// token persisted to localStorage on the first proactive refresh → it survived
// tab close → the next user on a shared/kiosk/venue terminal auto-logged-in as
// the previous user. Route to sessionStorage when session-only, and sweep the
// other store so no persistent copy ever lingers.
const OAUTH_KEYS = [
  'poker_oauth_access',
  'poker_oauth_refresh',
  'poker_oauth_id_token',
  'poker_token_expiry',
];

/** Write one OAuth token to the store the keep-signed-in flag dictates,
 *  sweeping the other store to prevent a persistent leak. */
export function setOAuthItem(key, value) {
  const win = typeof window !== 'undefined' ? window : null;
  if (!win || value == null) return;
  const keep = isKeepSignedIn();
  safeSet(keep ? win.localStorage : win.sessionStorage, key, String(value));
  safeRemove(keep ? win.sessionStorage : win.localStorage, key);
}

/** Read an OAuth token from whichever store currently holds it. */
export function getOAuthItem(key) {
  const win = typeof window !== 'undefined' ? window : null;
  if (!win) return null;
  return safeGet(win.localStorage, key) || safeGet(win.sessionStorage, key) || null;
}

/** Clear every OAuth token from BOTH stores — used on logout (also fixes F2:
 *  poker_oauth_access previously survived logout). */
export function clearOAuthTokens() {
  const win = typeof window !== 'undefined' ? window : null;
  if (!win) return;
  for (const k of OAUTH_KEYS) {
    safeRemove(win.localStorage, k);
    safeRemove(win.sessionStorage, k);
  }
}

/** Clear the auth token from both stores — used on explicit logout. */
export function clearAuthToken() {
  safeRemove(typeof window !== 'undefined' ? window.localStorage   : null, TOKEN_KEY);
  safeRemove(typeof window !== 'undefined' ? window.sessionStorage : null, TOKEN_KEY);
  // Also clear the persisted username so shared-device accounts don't
  // leak across users (see getAuthUsername rationale below).
  safeRemove(typeof window !== 'undefined' ? window.localStorage   : null, USERNAME_KEY);
  safeRemove(typeof window !== 'undefined' ? window.sessionStorage : null, USERNAME_KEY);
}

/**
 * Persist the last-used username so the login screen can pre-fill it.
 *
 * Scoped to sessionStorage ONLY — writing to localStorage on a shared
 * device (kiosk, household, venue terminal) would expose the previous
 * user's handle to the next person, which violates the "never auto-fill
 * member logins" rule. sessionStorage dies with the tab, so the hint is
 * only useful within a single session.
 */
export function setAuthUsername(username) {
  if (!username) return;
  // Defensive: sweep any stale localStorage copy from earlier builds that
  // wrote there, so upgrading clients don't keep surfacing old usernames.
  safeRemove(typeof window !== 'undefined' ? window.localStorage : null, USERNAME_KEY);
  safeSet(typeof window !== 'undefined' ? window.sessionStorage : null, USERNAME_KEY, username);
}

/** Read the last-used username (for pre-filling the login form). */
export function getAuthUsername() {
  // Match the write path — sessionStorage is authoritative now.
  // Fall back to localStorage only to be swept+returned for one read so
  // users mid-migration aren't hit with an empty field; the sweep on
  // setAuthUsername / clearAuthToken will remove it over time.
  const fromSession = safeGet(typeof window !== 'undefined' ? window.sessionStorage : null, USERNAME_KEY);
  if (fromSession) return fromSession;
  const fromLocal = safeGet(typeof window !== 'undefined' ? window.localStorage : null, USERNAME_KEY);
  if (fromLocal) {
    safeRemove(typeof window !== 'undefined' ? window.localStorage : null, USERNAME_KEY);
    return fromLocal;
  }
  return null;
}
