/**
 * crossTabSignOut — which tabs follow a sign-out made in ANOTHER tab of this
 * browser (2026-10-10, P7). Imports only tabSession and authBroadcast (neither
 * imports anything), so the store and main.jsx can use it without a cycle.
 *
 * Every same-origin tab hears every other tab's sign-out: BroadcastChannel
 * 'poker-auth' (main.jsx) and the localStorage storage events — the
 * `poker_logout_broadcast` marker and the stored-token keys (authCrossTab,
 * App.jsx).
 *
 *   - An OIDC or legacy tab runs on the browser's STORED sign-in, which that
 *     sign-out wiped: it always follows (unchanged).
 *   - A "Play Online" TICKET tab runs on its own ticket + tab-scoped resume
 *     record, on a shared browser possibly as a DIFFERENT account from the
 *     stored one. It follows ONLY a sign-out that names its own account:
 *     another account's sign-out or session expiry never logs it out or
 *     clears its record. A sign-out whose account cannot be told (an older
 *     bundle's marker, a stored-token key being removed) is not provably its
 *     own, so it does not follow that either.
 *
 * The other way round (gameStore.tearDownSession): a ticket tab whose browser
 * holds ANOTHER (or an unprovable) account's stored sign-in leaves that
 * sign-in alone when it signs out — no stored-key wipe, no marker, no global
 * /session/end — and announces itself as TICKET_TAB_SIGN_OUT_EVENT, which
 * only tabs of the SAME account follow. Older bundles ignore the unknown
 * event type, so they never sign the other account out over it either.
 *
 * "KEEP ME SIGNED IN" OFF (2026-10-10). Such a sign-in lives ONLY in its own
 * tab's sessionStorage, which no other tab can see — so a ticket tab cannot
 * find it in the browser's stored keys. Two rules close that gap:
 *   - the ticket tab's Sign Out first asks the other open tabs who is signed
 *     in there (requestSignInCensus, BroadcastChannel); another account
 *     signed in on the browser's sign-in (OIDC / legacy) counts exactly like
 *     another account's stored sign-in: it is left alone;
 *   - a tab whose sign-in lives only in its own sessionStorage
 *     (signInLivesInThisTabOnly) follows only a sign-out of its OWN account
 *     (or one naming nobody — an older bundle's marker): another account's
 *     sign-out cannot have wiped its credentials, and a stored-token key
 *     removed from localStorage is not its credential either.
 */
import { getTabSession } from './tabSession';
import { broadcastAuth, onAuthEvent } from './authBroadcast';

export const TICKET_TAB_SIGN_OUT_EVENT = 'ticket-tab-sign-out';
export const LOGOUT_MARKER_KEY = 'poker_logout_broadcast';
// The sign-in census (see above): a request, and each other tab's answer.
export const SIGN_IN_CENSUS_EVENT = 'sign-in-census';
export const SIGN_IN_CENSUS_REPLY_EVENT = 'sign-in-census-reply';
// How long a Sign Out waits for the other tabs' answers (it runs alongside
// the 'revokeSignInTokens' acknowledgement wait, gameStore.logout).
export const SIGN_IN_CENSUS_WAIT_MS = 250;
const CREDENTIAL_KEYS = ['poker_oauth_refresh', 'poker_auth_token'];

function idString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * The `poker_logout_broadcast` value: a fresh timestamp (a storage event
 * fires only on a CHANGE) plus the account that signed out. Older bundles
 * only test it for truthiness, so the JSON shape is compatible.
 */
export function logoutMarkerValue(userId) {
  return JSON.stringify({ at: Date.now(), userId: idString(userId) });
}

/** The account a `poker_logout_broadcast` value names, or null (older bundle / unreadable). */
export function logoutMarkerUserId(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? idString(parsed.userId) : null;
  } catch {
    return null;
  }
}

/**
 * True when THIS tab's sign-in lives ONLY in its own sessionStorage ("keep me
 * signed in" off): every one of `ownCredentials` (the store's refresh token /
 * auth token) that is stored at all is stored in this tab's sessionStorage
 * and NOT in localStorage. Another tab's sign-out can never wipe it.
 */
export function signInLivesInThisTabOnly(ownCredentials) {
  const creds = (Array.isArray(ownCredentials) ? ownCredentials : []).filter((c) => typeof c === 'string' && c);
  if (!creds.length) return false;
  try {
    const read = (store) => new Set(CREDENTIAL_KEYS.map((k) => {
      try { return store.getItem(k); } catch { return null; }
    }).filter(Boolean));
    const local = read(window.localStorage);
    const session = read(window.sessionStorage);
    const stored = creds.filter((c) => local.has(c) || session.has(c));
    return stored.length > 0 && stored.every((c) => session.has(c) && !local.has(c));
  } catch {
    return false;
  }
}

/**
 * Should THIS tab apply a sign-out another tab announced?
 *   evt       { type: 'logout' | TICKET_TAB_SIGN_OUT_EVENT, userId? }
 *             userId = the signing-out tab's local user id (null = unknown)
 *   myUserId  this tab's signed-in local user id (the store's userId)
 *   opts.ownCredentials   this tab's own credentials (store refresh token /
 *                         auth token) — for the "keep me signed in" OFF rule
 *   opts.deviceKeyRemoved the signal is a stored-token key removed from
 *                         localStorage (authCrossTab 'token-key'), not an
 *                         announced sign-out
 */
export function shouldApplyRemoteSignOut(evt, myUserId, opts = {}) {
  if (!evt || typeof evt !== 'object') return false;
  let tab = null;
  try { tab = getTabSession(); } catch { tab = null; }
  const mine = idString(myUserId) || (tab ? tab.userId : null);
  const theirs = idString(evt.userId);
  if (evt.type === TICKET_TAB_SIGN_OUT_EVENT) {
    // A ticket tab's own sign-out: only its own account's tabs follow.
    return !!(mine && theirs && mine === theirs);
  }
  if (evt.type !== 'logout') return false;
  if (tab && tab.kind === 'ticket') {
    return !!(theirs && theirs === tab.userId);
  }
  // A sign-in kept only in this tab's sessionStorage (keep me signed in OFF):
  // another account's sign-out, or a localStorage key removal, cannot have
  // touched it.
  if (signInLivesInThisTabOnly(opts && opts.ownCredentials)) {
    if (opts.deviceKeyRemoved) return false;
    if (theirs && mine && theirs !== mine) return false;
  }
  return true;
}

// ── The sign-in census ──────────────────────────────────────────────────────

/** This tab's census answer (main.jsx supplies the game store's state). */
export function describeThisTabSignIn(storeState) {
  let tab = null;
  try { tab = getTabSession(); } catch { tab = null; }
  const userId = storeState && storeState.isLoggedIn ? idString(storeState.userId) : null;
  return {
    signedIn: !!userId,
    userId,
    kind: userId ? (tab ? tab.kind : 'unknown') : null,
    tabScoped: userId ? signInLivesInThisTabOnly([storeState.oauthRefreshToken, storeState.authToken]) : false,
  };
}

/** Answer other tabs' census requests (main.jsx, once). Returns an unsubscribe. */
export function installSignInCensusResponder(getStoreState) {
  return onAuthEvent((evt) => {
    if (!evt || evt.type !== SIGN_IN_CENSUS_EVENT || !evt.requestId) return;
    let me = null;
    try { me = describeThisTabSignIn(getStoreState()); } catch { return; }
    broadcastAuth({ type: SIGN_IN_CENSUS_REPLY_EVENT, requestId: String(evt.requestId), ...me });
  });
}

/**
 * Ask the browser's other open tabs who is signed in there. Resolves (never
 * rejects) after `waitMs` with `{ supported, replies }`; `supported` is false
 * when this browser has no BroadcastChannel (nothing could answer).
 */
export function requestSignInCensus(waitMs = SIGN_IN_CENSUS_WAIT_MS) {
  return new Promise((resolve) => {
    if (typeof BroadcastChannel === 'undefined') {
      resolve({ supported: false, replies: [] });
      return;
    }
    const requestId = `census-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const replies = [];
    let off = () => {};
    try {
      off = onAuthEvent((evt) => {
        if (evt && evt.type === SIGN_IN_CENSUS_REPLY_EVENT && evt.requestId === requestId) replies.push(evt);
      });
      broadcastAuth({ type: SIGN_IN_CENSUS_EVENT, requestId });
    } catch { /* answer with what arrived */ }
    setTimeout(() => {
      try { off(); } catch { /* ignore */ }
      resolve({ supported: true, replies });
    }, Math.max(0, Number(waitMs) || 0));
  });
}

/**
 * True when the census found ANOTHER account signed in on this browser's
 * sign-in in some other open tab (an OIDC / legacy tab — e.g. keep me signed
 * in OFF, invisible in the stored keys). Play Online ticket tabs of other
 * accounts do not count: they run on their own ticket, not on the browser's
 * sign-in.
 */
export function censusFindsOtherAccount(census, myUserId) {
  const mine = idString(myUserId);
  const replies = census && Array.isArray(census.replies) ? census.replies : [];
  return replies.some((r) => r && r.signedIn && r.kind !== 'ticket'
    && idString(r.userId) && idString(r.userId) !== mine);
}

let _lastIgnored = '';
/** One console line per distinct ignored sign-out (lock tokens in the manifest). */
export function noteIgnoredRemoteSignOut(evt, via) {
  const key = `${via}|${evt && evt.type}|${evt && evt.userId}`;
  if (_lastIgnored === key) return;
  _lastIgnored = key;
  try {
    let tab = null;
    try { tab = getTabSession(); } catch { tab = null; }
    if (evt && evt.type === TICKET_TAB_SIGN_OUT_EVENT) {
      console.warn('[cross-tab] a Play Online tab of another account signed out — this tab stays signed in', { via });
    } else if (!tab || tab.kind !== 'ticket') {
      // A "keep me signed in" OFF tab (signInLivesInThisTabOnly).
      console.warn('[cross-tab] another account signed out on this browser — this tab keeps its own sign-in (keep me signed in is off)', { via });
    } else {
      console.warn('[cross-tab] another account signed out on this browser — this Play Online tab stays signed in', { via });
    }
  } catch { /* ignore */ }
}
