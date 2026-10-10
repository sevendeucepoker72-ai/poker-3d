/**
 * .online proactive refresh scheduler — the ONLY proactive refresher.
 *
 * Mirror of apps/web/src/services/authScheduler.js for the poker-3d frontend.
 * Reads tokens from poker-3d's authService + tokenStorage helpers.
 *
 * 2026-07-06 P2 auth fix — App.jsx used to run a SECOND, overlapping refresh
 * timer with a divergent failure policy (force-logout after one 30s retry);
 * that timer is gone. This module's policy is authoritative: transient
 * failures retry indefinitely and never log out; a revoked refresh token
 * dispatches 'poker:session-expired' (single teardown in main.jsx). Also
 * ported from player-web: document.hidden deferral + visibilitychange
 * catch-up + cross-tab storage-event resync.
 *
 * .online stores OAuth tokens in the gameStore (Zustand) and mirrors them
 * to localStorage via persistence — the canonical fields are:
 *   - poker_oauth_refresh   (refresh token)
 *   - poker_token_expiry    (expiresAt epoch ms)
 *   - poker_oauth_id_token  (id_token)
 *
 * On every refresh success we update both the store and these legacy
 * keys so the ecosystem stays consistent.
 */

import { refreshAccessToken, RefreshTokenRevokedError, REFRESH_DONE_KEY } from './authService';
import { useGameStore } from '../store/gameStore';
import { setOAuthItem, getOAuthItem, getStoredOidcAccount, oidcSubject } from './tokenStorage';
import { getTabSession } from './tabSession';
import { deepLinkTicketPending, onDeepLinkTicketSettled } from './deepLinkBootGate';

const REFRESH_LEAD_MS = 5 * 60 * 1000;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 30 * 60 * 1000;

let _timerId = null;
let _started = false;
let _refreshing = false;
// 2026-07-06 P2 auth fix (ported from apps/web/src/services/authScheduler.js)
// — set when a scheduled refresh was deferred because the tab was hidden;
// _onVisibilityChange fires the deferred refresh the moment we're visible.
let _pendingRefreshOnVisible = false;

function _readExpiresAt() {
  // Prefer the in-memory store value (most recent post-login), fall back
  // to the persisted localStorage copy that survives reload.
  try {
    const fromStore = useGameStore.getState().oauthTokenExpiry;
    if (typeof fromStore === 'number' && fromStore > 0) return fromStore;
  } catch {}
  try {
    const raw = getOAuthItem('poker_token_expiry');
    if (raw) return parseInt(raw, 10) || 0;
  } catch {}
  return 0;
}
function _readRefreshToken() {
  try {
    const fromStore = useGameStore.getState().oauthRefreshToken;
    if (fromStore) return fromStore;
  } catch {}
  try {
    return getOAuthItem('poker_oauth_refresh') || null;
  } catch { return null; }
}

// F5 (2026-10-10) — a "Play Online" TICKET tab is account A's game session
// and holds no OIDC sign-in of its own; on a shared browser the device's
// stored OIDC sign-in can be account B's. Such a tab must never refresh B's
// tokens into its own state (socket A, store B), nor end A's session because
// B's refresh token was revoked. True when THIS tab is a ticket session and
// the device's stored OIDC sign-in is not provably the same account. B's own
// tabs keep refreshing B; B's next boot refreshes with the stored token.
function _ticketTabForeignToDeviceOidc() {
  try {
    const tab = getTabSession();
    if (!tab || tab.kind !== 'ticket') return false;
    const dev = getStoredOidcAccount();
    return !(tab.masterUserId && dev.masterUserId === tab.masterUserId);
  } catch {
    return false;
  }
}
let _warnedForeignSkip = false;
function _warnForeignSkipOnce() {
  if (_warnedForeignSkip) return;
  _warnedForeignSkip = true;
  try { console.warn('[auth-scheduler] Play Online tab: not refreshing another account\'s stored sign-in'); } catch { /* ignore */ }
}

/**
 * Q5 (2026-10-10) — the 'poker:session-expired' teardown (main.jsx) asks this
 * before ending the tab's session: true when THIS tab is a "Play Online"
 * TICKET tab and the browser's stored OIDC sign-in — the only thing a revoked
 * refresh token can say is dead — is not provably the tab's own account
 * (another account's, an unreadable one, or none at all). Such a tab runs on
 * its own ticket / resume record, which that expiry says nothing about.
 * Unlike _ticketTabForeignToDeviceOidc, a ticket tab whose device sign-in
 * cannot be read counts as "not its own" (never tear it down on a guess).
 */
export function ticketTabOutlivesDeviceSignIn() {
  let tab = null;
  try { tab = getTabSession(); } catch { return false; }
  if (!tab || tab.kind !== 'ticket') return false;
  try {
    const dev = getStoredOidcAccount();
    return !(tab.masterUserId && dev.masterUserId === tab.masterUserId);
  } catch {
    return true;
  }
}

// Q5 — hold every proactive refresh while this page load's deep-link ticket
// is unanswered and the tab has no session yet (deepLinkBootGate): the
// browser's stored sign-in can be ANOTHER account's, and its answer must not
// land on the tab the ticket is about to sign in. A tab that is already
// signed in (e.g. a bridge hand-off succeeded) is not held.
let _heldForDeepLink = false;
let _unsubDeepLink = null;
function _deepLinkHold() {
  try {
    if (!deepLinkTicketPending()) return false;
    return !getTabSession();
  } catch {
    return false;
  }
}
function _onDeepLinkSettled() {
  const wasHeld = _heldForDeepLink;
  _heldForDeepLink = false;
  if (!_started) return;
  if (wasHeld) {
    try { console.warn('[auth-scheduler] Play Online ticket answered — token refresh resumed'); } catch { /* ignore */ }
  }
  // Never synchronously: the tab's session marker is set by the deep-link
  // flow right after the gate settles (_computeDelay is >= MIN_DELAY_MS).
  _scheduleNext();
}

/**
 * Q5 — a refresh that the auth-server REFUSED (RefreshTokenRevokedError) in a
 * tab that, by the time it settled, is a ticket tab whose browser sign-in is
 * another account's: that dead sign-in is the other account's, never this
 * tab's — no session-expired. Only the dead credential itself is dropped from
 * the browser, and only while the browser still holds the very refresh token
 * that was refused (a peer tab may have rotated it meanwhile) — exactly what
 * the boot's refresh path would have wiped on the same answer. Never this
 * tab's own ticket in poker_auth_token, never another live credential.
 */
function _dropDeadDeviceSignIn(deadRefresh) {
  try {
    if (!deadRefresh || getOAuthItem('poker_oauth_refresh') !== deadRefresh) return false;
    const tab = getTabSession();
    const mine = tab && tab.masterUserId ? tab.masterUserId : null;
    // An OIDC JWT naming another (or no provable) account than this tab's.
    const othersJwt = (t) => { const s = oidcSubject(t); return !!(s && s !== mine); };
    // The dead sign-in's access-token copies (from every store that holds
    // the refused refresh token), read before anything is removed.
    const deadAccess = new Set();
    for (const store of [localStorage, sessionStorage]) {
      try { if (store.getItem('poker_oauth_refresh') === deadRefresh) { const a = store.getItem('poker_oauth_access'); if (a) deadAccess.add(a); } } catch { /* ignore */ }
    }
    try { if (localStorage.getItem('poker_oauth_refresh') === deadRefresh || sessionStorage.getItem('poker_oauth_refresh') === deadRefresh) { const a = localStorage.getItem('poker_oauth_access'); if (a) deadAccess.add(a); } } catch { /* ignore */ }
    for (const store of [localStorage, sessionStorage]) {
      try {
        const holdsDead = store.getItem('poker_oauth_refresh') === deadRefresh;
        if (holdsDead) {
          store.removeItem('poker_oauth_refresh');
          store.removeItem('poker_token_expiry');
        }
        for (const k of ['poker_oauth_access', 'poker_oauth_id_token']) {
          const v = store.getItem(k);
          if (v && (holdsDead || deadAccess.has(v) || othersJwt(v))) store.removeItem(k);
        }
        const at = store.getItem('poker_auth_token');
        if (at && (deadAccess.has(at) || othersJwt(at))) store.removeItem('poker_auth_token');
      } catch { /* ignore */ }
    }
    try { console.warn('[auth-scheduler] another account\'s stored sign-in on this browser was refused (revoked) — dropped; this Play Online tab stays signed in'); } catch { /* ignore */ }
    return true;
  } catch {
    return false;
  }
}

// After a RefreshTokenRevokedError: true when the teardown must NOT run here
// (the tab became a ticket tab of another account while the refresh was in
// flight — or already was one). Drops the dead device sign-in (see above).
function _revokedBelongsToAnotherAccount(refreshToken) {
  if (!_ticketTabForeignToDeviceOidc()) return false;
  _dropDeadDeviceSignIn(refreshToken);
  return true;
}

// May THIS tab's store hold `tokens`? Always, except in a ticket tab, where
// only tokens naming the tab's own account (sub === its masterUserId) may.
function _storeMayHold(tokens) {
  try {
    const tab = getTabSession();
    if (!tab || tab.kind !== 'ticket') return true;
    const sub = oidcSubject(tokens && tokens.id_token) || oidcSubject(tokens && tokens.access_token);
    return !!(tab.masterUserId && sub === tab.masterUserId);
  } catch {
    return true;
  }
}

// Write a successful refresh into the store + persistence so the rest of the
// app (socket re-auth, HTTP bearer, the next refresh) reads fresh values.
// Shared by the scheduled refresh and refreshNowAndApply.
function _applyRefreshedTokens(tokens, refreshToken) {
  try {
    const expiresAt = Date.now() + (Number(tokens.expires_in) || 3600) * 1000;
    // F5 — never another account's tokens into a ticket tab's store.
    if (_storeMayHold(tokens)) {
      useGameStore.setState({
        oauthAccessToken: tokens.access_token,
        oauthRefreshToken: tokens.refresh_token || refreshToken,
        oauthIdToken: tokens.id_token || useGameStore.getState().oauthIdToken,
        oauthTokenExpiry: expiresAt,
        authToken: tokens.access_token,
      });
    }
    // F1: refresh + id_token honor keep-signed-in (setOAuthItem); expiry is a
    // short-lived cross-tab-coordination value and stays in localStorage.
    try { localStorage.setItem('poker_token_expiry', String(expiresAt)); } catch {}
    try {
      if (tokens.refresh_token) setOAuthItem('poker_oauth_refresh', tokens.refresh_token);
    } catch {}
    try {
      if (tokens.id_token) setOAuthItem('poker_oauth_id_token', tokens.id_token);
    } catch {}
  } catch {}
}

function _dispatchSessionExpired(reason) {
  try {
    window.dispatchEvent(new CustomEvent('poker:session-expired', { detail: { reason } }));
  } catch {}
}

function _computeDelay() {
  const expiresAt = _readExpiresAt();
  if (!expiresAt) return MAX_DELAY_MS;
  const fireAt = expiresAt - REFRESH_LEAD_MS;
  const delay = fireAt - Date.now();
  if (delay < MIN_DELAY_MS) return MIN_DELAY_MS;
  if (delay > MAX_DELAY_MS) return MAX_DELAY_MS;
  return delay;
}

async function _doRefresh() {
  if (!_started || _refreshing) return;

  // 2026-07-06 (ported from player-web authScheduler) — Android Chrome /
  // iOS Safari suspend background-tab network: a fetch started while hidden
  // hangs until the AbortController timeout fires, producing a FALSE
  // 'network' (transient) failure and pointless retry churn. Defer instead;
  // _onVisibilityChange calls us the moment the tab is foregrounded.
  if (typeof document !== 'undefined' && document.hidden) {
    _pendingRefreshOnVisible = true;
    return;
  }
  _pendingRefreshOnVisible = false;

  // Q5 — a Play Online ticket is being answered on this page load and the
  // tab has no session yet: hold (no timer); _onDeepLinkSettled resumes.
  if (_deepLinkHold()) {
    if (!_heldForDeepLink) {
      _heldForDeepLink = true;
      try { console.warn('[auth-scheduler] token refresh held until the Play Online ticket is answered'); } catch { /* ignore */ }
    }
    return;
  }

  // F5 — a ticket tab whose device sign-in is another account's: skip, and
  // look again later (the tab may sign in to an OIDC session of its own).
  // A fixed delay — B's stored expiry may be in the past, which would make
  // _computeDelay fire every second.
  if (_ticketTabForeignToDeviceOidc()) {
    _warnForeignSkipOnce();
    if (_started) {
      if (_timerId) { clearTimeout(_timerId); _timerId = null; }
      _timerId = setTimeout(_doRefresh, MAX_DELAY_MS);
    }
    return;
  }

  const refreshToken = _readRefreshToken();
  if (!refreshToken) return;
  _refreshing = true;
  try {
    const tokens = await refreshAccessToken(refreshToken);
    // (Q5) If the tab became a ticket tab of another account meanwhile, the
    // store write below is refused by _storeMayHold; the rotated tokens still
    // go to the browser (they are that account's sign-in), and the next fire
    // skips (F5).
    _applyRefreshedTokens(tokens, refreshToken);
    _scheduleNext();
  } catch (e) {
    if (e instanceof RefreshTokenRevokedError || e?.name === 'RefreshTokenRevokedError') {
      // Q5 — re-checked AFTER the refresh settled: while it was in flight the
      // tab may have become a "Play Online" ticket tab of ANOTHER account (the
      // deep-link ticket answered). The dead sign-in is the browser's other
      // account's: no session-expired here (it would sign THIS tab out and
      // broadcast a logout naming it). Keep looking later, as the F5 skip does.
      if (_revokedBelongsToAnotherAccount(refreshToken)) {
        if (_started) {
          if (_timerId) { clearTimeout(_timerId); _timerId = null; }
          _timerId = setTimeout(_doRefresh, MAX_DELAY_MS);
        }
        return;
      }
      _started = false;
      // 2026-07-06 P2 auth fix — dispatch ONLY. The single teardown lives in
      // main.jsx's 'poker:session-expired' listener, which calls
      // gameStore.logout({ skipRedirect: true }) (now including the socket
      // disconnect) and sets the login-screen "session ended" notice. The
      // inline store.logout() that used to follow this dispatch was a second,
      // divergent teardown path — it double-fired logout for the same expiry
      // and predated the socket-disconnect + visible-notice flow.
      _dispatchSessionExpired('refresh-revoked-by-scheduler');
      return;
    }
    // Transient — retry sooner, with jitter so multiple tabs (or a fleet of
    // clients behind the same flaky network) don't retry in lockstep.
    // NEVER logs out: only an explicit RefreshTokenRevokedError above ends
    // the session (2026-07-06 — the old App.jsx twin scheduler force-logged-
    // out after one 30s retry, kicking seated players on a ~60s blip).
    if (_started) {
      const jitter = Math.floor(Math.random() * 10_000);
      _timerId = setTimeout(_doRefresh, 20_000 + jitter);
    }
  } finally {
    _refreshing = false;
  }
}

function _scheduleNext() {
  if (!_started) return;
  if (_timerId) { clearTimeout(_timerId); _timerId = null; }
  _timerId = setTimeout(_doRefresh, _computeDelay());
}

// 2026-07-06 (ported from player-web authScheduler) — run a deferred refresh
// as soon as the tab is foregrounded, or refresh immediately if the token
// slid into the near-expiry window while we were hidden (browsers throttle
// background setTimeout, so the timer may not have fired on time).
function _onVisibilityChange() {
  if (!_started || (typeof document !== 'undefined' && document.hidden)) return;
  const expiresAt = _readExpiresAt();
  const nearExpiry = expiresAt && Date.now() > (expiresAt - REFRESH_LEAD_MS);
  if (_pendingRefreshOnVisible || nearExpiry) {
    _pendingRefreshOnVisible = false;
    if (_timerId) { clearTimeout(_timerId); _timerId = null; }
    _doRefresh();
  }
}

// 2026-07-06 (ported from player-web authScheduler) — cross-tab resync.
// Another tab completed a refresh → it wrote a fresh poker_token_expiry and
// stamped the completion marker → reschedule OUR timer to the new expiry so
// all tabs share one refresh per cycle (the cross-tab lock in authService
// already guarantees only one tab performs it). Another tab logging out
// removes poker_oauth_access (always-localStorage) → stop scheduling here;
// the app-level session teardown is authCrossTab's job, this only kills the
// timer.
function _onStorageEvent(e) {
  if (!_started || !e) return;
  if (e.key === 'poker_token_expiry' || e.key === REFRESH_DONE_KEY) {
    _scheduleNext();
  }
  if (e.key === 'poker_oauth_access' && e.newValue == null) {
    stop();
  }
}

export function start() {
  if (_started) return;
  _started = true;
  try { window.addEventListener('storage', _onStorageEvent); } catch {}
  try { document.addEventListener('visibilitychange', _onVisibilityChange); } catch {}
  if (!_unsubDeepLink) _unsubDeepLink = onDeepLinkTicketSettled(_onDeepLinkSettled);
  _scheduleNext();
}

export function stop() {
  _started = false;
  _pendingRefreshOnVisible = false;
  _heldForDeepLink = false;
  if (_timerId) { clearTimeout(_timerId); _timerId = null; }
  if (_unsubDeepLink) { try { _unsubDeepLink(); } catch { /* ignore */ } _unsubDeepLink = null; }
  try { window.removeEventListener('storage', _onStorageEvent); } catch {}
  try { document.removeEventListener('visibilitychange', _onVisibilityChange); } catch {}
}

export async function refreshNow() {
  // F5 — the tab-resume refresh (sessionLifecycle) never touches another
  // account's stored sign-in from a ticket tab either.
  if (_ticketTabForeignToDeviceOidc()) return null;
  // Q5 — nor the browser's stored sign-in while a deep-link ticket is being
  // answered on this page load (no session yet).
  if (_deepLinkHold()) return null;
  const refreshToken = _readRefreshToken();
  if (!refreshToken) return null;
  return await refreshAccessToken(refreshToken);
}

/** True when this tab holds an OIDC refresh token (a signed-in account session). */
export function hasRefreshToken() {
  return !!_readRefreshToken();
}

/**
 * 2026-10-07 — refresh NOW and apply the result exactly like a scheduled
 * refresh does (store + persistence + next timer). Used by socket re-auth
 * (services/socketReauth.js) so a reconnecting socket never presents an
 * expired access token to oauthLogin. Funnels through refreshAccessToken's
 * in-tab + cross-tab single-flight, so it never races the scheduler.
 *
 * Resolves to the token response, or null when there is no refresh token.
 * Rejects with the refresh error. A RefreshTokenRevokedError also dispatches
 * 'poker:session-expired' (the one teardown, main.jsx) — the same policy as
 * the scheduler: only a revoked refresh token ends the session.
 */
export async function refreshNowAndApply() {
  // F5 — same rule as the scheduled refresh (socketReauth never asks from a
  // ticket tab; belt-and-braces).
  if (_ticketTabForeignToDeviceOidc()) return null;
  const refreshToken = _readRefreshToken();
  if (!refreshToken) return null;
  try {
    const tokens = await refreshAccessToken(refreshToken);
    _applyRefreshedTokens(tokens, refreshToken);
    if (_started) _scheduleNext();
    return tokens;
  } catch (e) {
    if (e instanceof RefreshTokenRevokedError || e?.name === 'RefreshTokenRevokedError') {
      // Q5 — same re-check as the scheduled refresh, after the refresh settled.
      if (!_revokedBelongsToAnotherAccount(refreshToken)) {
        _dispatchSessionExpired('refresh-revoked-on-socket-reauth');
      }
    }
    throw e;
  }
}

export function isTokenExpiringSoon(thresholdMs = 60_000) {
  const expiresAt = _readExpiresAt();
  if (!expiresAt) return false;
  return Date.now() > (expiresAt - thresholdMs);
}
