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
 * Persist the auth token. If keep-signed-in is on (default), writes to
 * localStorage so the token survives tab close; otherwise writes to
 * sessionStorage only (dies with the tab).
 *
 * @param {string} token
 * @param {boolean} [remember] — explicit override of the stored flag
 */
export function setAuthToken(token, remember) {
  if (!token) return;
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
