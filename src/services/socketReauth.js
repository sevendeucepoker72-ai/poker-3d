/**
 * socketReauth — keep the game socket signed in across reconnects.
 *
 * WHY (2026-10-07 review finding, verified MAJOR). poker-server ignores
 * handshake auth: a socket is signed in only by an `oauthLogin` (or
 * tokenLogin / ticket) emit, and every reconnect — PWA resume, phone unlock,
 * a Railway blip — is a NEW server-side socket with no session. App.jsx's
 * connect handler used to fire `oauthLogin` once with whatever access token
 * was stored, WITHOUT refreshing it first and WITHOUT listening for the
 * answer. Access tokens live 15 minutes, so a phone that slept longer than
 * that reconnected with an expired token, the server rejected it, nobody
 * noticed, and the socket stayed signed-out for the rest of the page's life.
 * Since guest play went off (2026-10-07) every play attempt on such a socket
 * is refused `login_required` — a signed-in player told to sign in.
 *
 * What this module does instead, on every (re)connect of a signed-in tab:
 *   1. refresh the access token FIRST when it is expired or about to expire
 *      (authScheduler.refreshNowAndApply — same single-flight + same
 *      revoked-session policy as the proactive scheduler);
 *   2. emit `oauthLogin` through runSocketLogin (requestId-scoped, so it can't
 *      consume another auth flow's frame) and WAIT for its loginResult;
 *   3. if the server rejected the token itself (token_invalid / no_token),
 *      force one refresh and re-run oauthLogin once.
 *
 * services/playRefusal.js also uses recoverSignedInSocket() when a play
 * attempt is refused `login_required` while this tab still holds a signed-in
 * account: re-auth silently, then replay the attempt once, and only show the
 * Sign In notice if that fails.
 *
 * The answer is not used to change screens or the stored profile (that is
 * what the boot / callback flows do); success only means the server-side
 * socket is signed in again.
 *
 * RESUMABLE TICKET SESSIONS (2026-10-09, contract R1 / decision D1). A player
 * who came in through the player app's "Play Online" ticket has no OIDC
 * refresh token, so step 1–3 above had nothing to present and every reconnect
 * left the socket signed out. poker-server now hands such a session (and ONLY
 * such a session) a 12h `resumeToken` (services/sessionResume.js); a reconnect
 * presents it with `resumeSession` before any play attempt. Per (re)connect,
 * by the kind of session THIS TAB is in:
 *   - ticket session → resumeSession with the stored record, and only when
 *     that record is bound to this tab's user. Nothing else: a ticket tab
 *     never falls through to OIDC credentials the device may hold for some
 *     other account, so a reconnect can never switch its socket's account.
 *   - any other session (OIDC, legacy) → the OIDC path exactly as before. An
 *     OIDC session never presents a resume token (D1).
 * `resume_invalid` deletes the record.
 *
 * SAME-ACCOUNT FALLBACK (2026-10-10). A ticket tab whose resume chain has
 * ENDED (no usable record, or `resume_invalid`) re-authenticates through the
 * browser's own stored OIDC sign-in — but ONLY when that sign-in is provably
 * the SAME account (its OIDC `sub` = the tab's master id from the
 * server-signed resume token): refresh with it, oauthLogin, and the tab
 * becomes that OIDC session ('oidc'), which outlives the 24h resume cap. On a
 * browser holding another (or an unprovable) account's sign-in nothing
 * changes: the ticket tab stays signed out rather than switch accounts.
 *
 * DROPPED SIGN-IN FENCE (2026-10-10). When the boot's stored-credential
 * sign-in of ANOTHER account answered while this tab was already signed in
 * (App.jsx dropStoredSignInForOtherUser), the browser's stored keys may BE
 * that account's credentials. fenceDroppedSignIn() records them; from then on
 * this tab's OIDC re-auth never presents (or refreshes with) a fenced
 * credential — only the tab's own store tokens — and settles `no_token`
 * instead of signing the socket in as the other account.
 */
import { getAuthToken, getStoredOidcAccount, oidcSubject } from './tokenStorage';
import { runSocketLogin, isCredentialDead } from './socketAuth';
import { isTokenExpiringSoon, refreshNowAndApply, hasRefreshToken } from './authScheduler';
import { getSocket } from './socketService';
import { useGameStore } from '../store/gameStore';
import {
  readResumeRecordForUser, isTicketSessionTab, saveTicketResume, clearResumeRecord,
  setTabSession, getTabSession, RESUME_INVALID, RESUME_EVENT,
} from './sessionResume';

function idString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// ── Dropped sign-in fence ───────────────────────────────────────────────────
let _fence = null; // { userId, tokens: Set, subjects: Set }

/**
 * App.jsx — the stored sign-in of another account (`tokens` = its raw
 * credentials, `subjects` = its OIDC subjects) was dropped while this tab is
 * signed in as `tabUserId`. Bound to that user: a later sign-in as someone
 * else on this page load is not fenced by it.
 */
export function fenceDroppedSignIn(tabUserId, { tokens = [], subjects = [] } = {}) {
  const uid = idString(tabUserId);
  if (!uid) return;
  if (!_fence || _fence.userId !== uid) _fence = { userId: uid, tokens: new Set(), subjects: new Set() };
  for (const t of tokens) if (typeof t === 'string' && t) _fence.tokens.add(t);
  for (const s of subjects) { const v = idString(s); if (v) _fence.subjects.add(v); }
  try { console.warn('[socket-reauth] another account\'s dropped sign-in is fenced off for this tab'); } catch { /* ignore */ }
}

function fenceFor(st) {
  return _fence && st && _fence.userId === idString(st.userId) ? _fence : null;
}

function isFenced(fence, token) {
  if (!fence || typeof token !== 'string' || !token) return false;
  if (fence.tokens.has(token)) return true;
  const sub = oidcSubject(token);
  return !!(sub && fence.subjects.has(sub));
}

// ── Same-account fallback ───────────────────────────────────────────────────

/**
 * True when THIS tab is a ticket tab and the browser's stored OIDC sign-in
 * (a refresh token, every readable OIDC JWT naming one account) is provably
 * the tab's OWN account (its master id). Never on a guess.
 */
export function ticketTabOwnsDeviceSignIn() {
  try {
    const tab = getTabSession();
    if (!tab || tab.kind !== 'ticket' || !tab.masterUserId) return false;
    const dev = getStoredOidcAccount();
    return !!(dev.signedIn && dev.masterUserId && dev.masterUserId === tab.masterUserId);
  } catch {
    return false;
  }
}

// Refresh before re-auth when the access token has less than this left. Covers
// clock skew and the time oauthLogin itself takes.
const NEAR_EXPIRY_MS = 2 * 60_000;
// Watchdog for one oauthLogin answer (introspection + upsert + loadProgress,
// plus a Railway cold start).
const OAUTH_LOGIN_TIMEOUT_MS = 15_000;
// Watchdog for one resumeSession answer (signature + DB row + master link
// check, plus a Railway cold start).
const RESUME_TIMEOUT_MS = 15_000;

let _seq = 0;
// The re-auth for the CURRENT connection: { id, socketId, done, promise, supersede }.
let _current = null;

/**
 * True when this tab holds a signed-in American Pub Poker account session —
 * an OIDC session (a refresh token or an OAuth access token) or, since
 * 2026-10-09, a resumable ticket session whose record is bound to this tab's
 * user (services/sessionResume.js) — as opposed to no session or a
 * legacy/guest token. Only such a session can be recovered silently.
 */
export function hasSignedInAccountSession() {
  try {
    const st = useGameStore.getState();
    if (!st.isLoggedIn) return false;
    if (isTicketSessionTab(st.userId)) return !!readResumeRecordForUser(st.userId) || ticketTabOwnsDeviceSignIn();
    if (getAuthToken() && (hasRefreshToken() || !!st.oauthAccessToken)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Refresh the access token first when it is expired / about to expire (or
 * always, with `force`). Resolves `{ status, accessToken }`, never rejects:
 *   status       'fresh' | 'refreshed' | 'no_refresh_token' | 'revoked' | 'refresh_failed'
 *   accessToken  the token to present — the one a refresh just returned (it
 *                is also written to storage, but a session-only tab that took
 *                a peer tab's refresh result can lag), else the stored one.
 */
async function ensureFreshAccessToken(force, fence = null) {
  // Without a fence: exactly as before. With one (a dropped sign-in of
  // another account): only the tab's OWN credentials — the stored access
  // token unless it is fenced, else the store's own; the store's own refresh
  // token, never the browser's (fenced) one.
  const stored = () => {
    if (!fence) return { accessToken: getAuthToken() };
    const st = useGameStore.getState();
    const own = [getAuthToken(), st.oauthAccessToken, st.authToken].find((t) => t && !isFenced(fence, t));
    return { accessToken: own || null };
  };
  const canRefresh = fence
    ? (() => { const r = useGameStore.getState().oauthRefreshToken; return !!r && !isFenced(fence, r); })()
    : hasRefreshToken();
  if (!canRefresh) return { status: 'no_refresh_token', ...stored() };
  if (!force && !isTokenExpiringSoon(NEAR_EXPIRY_MS)) return { status: 'fresh', ...stored() };
  try {
    const tokens = await refreshNowAndApply();
    if (!tokens) return { status: 'no_refresh_token', ...stored() };
    const fresh = typeof tokens.access_token === 'string' && tokens.access_token ? tokens.access_token : null;
    if (fence && (isFenced(fence, fresh) || isFenced(fence, tokens.id_token))) {
      return { status: 'refresh_failed', ...stored() };
    }
    return { status: 'refreshed', accessToken: fresh || stored().accessToken };
  } catch (e) {
    return { status: e?.name === 'RefreshTokenRevokedError' ? 'revoked' : 'refresh_failed', ...stored() };
  }
}

/**
 * Same-account fallback (see the header): sign `socket` in through the
 * browser's own stored OIDC sign-in, which ticketTabOwnsDeviceSignIn proved
 * to be this tab's account. A FRESH token only (forced refresh — the stored
 * poker_auth_token of a ticket tab can be its burned ticket); on success for
 * this same local user the tab becomes that OIDC session.
 */
async function runOwnOidcFallback(socket, entry, st, why) {
  const fresh = await ensureFreshAccessToken(true);
  if (entry.done) return { done: true };
  if (fresh.status !== 'refreshed' || !fresh.accessToken) {
    return { result: { success: false, code: `own_oidc_${fresh.status}` } };
  }
  // The refreshed token must still be this tab's own account.
  const tab = getTabSession();
  const sub = oidcSubject(fresh.accessToken);
  if (sub && tab && tab.masterUserId && sub !== tab.masterUserId) {
    return { result: { success: false, code: 'own_oidc_account_changed' } };
  }
  const result = await oauthLoginOnce(socket, fresh.accessToken, entry);
  if (entry.done) return { done: true };
  if (result?.success && result.userData && idString(result.userData.id) === idString(st.userId)) {
    clearResumeRecord();
    setTabSession('oidc', st.userId);
    try { console.warn('[socket-reauth] Play Online tab re-signed-in with this account\'s own browser sign-in', { why }); } catch { /* ignore */ }
    return { result, ok: true };
  }
  return { result: result?.success ? { success: false, code: 'own_oidc_user_mismatch' } : result };
}

function oauthLoginOnce(socket, accessToken, entry) {
  return new Promise((resolve) => {
    const cancel = runSocketLogin({
      socket,
      event: 'oauthLogin',
      payload: { accessToken },
      label: 'reauth',
      timeoutMs: OAUTH_LOGIN_TIMEOUT_MS,
      // One emit per connection: a reconnect starts a NEW re-auth (App.jsx
      // connect handler), which supersedes this one.
      reemitOnReconnect: false,
      armWatchdogOnEmit: true,
      keepListeningAfterTimeout: false,
      onResult: (r) => resolve(r || { success: false, code: 'empty_result' }),
      onTimeout: () => resolve({ success: false, code: 'timeout' }),
    });
    entry.cancelLogin = () => {
      try { cancel(); } catch { /* ignore */ }
      resolve({ success: false, code: 'superseded' });
    };
  });
}

function resumeSessionOnce(socket, resumeToken, entry) {
  return new Promise((resolve) => {
    const cancel = runSocketLogin({
      socket,
      event: RESUME_EVENT,
      payload: { resumeToken },
      label: 'resume',
      timeoutMs: RESUME_TIMEOUT_MS,
      // One emit per connection (a reconnect starts a new re-auth), and never
      // a blind re-send: the server may treat a resume token as single-use.
      reemitOnReconnect: false,
      armWatchdogOnEmit: true,
      keepListeningAfterTimeout: false,
      onResult: (r) => resolve(r || { success: false, code: 'empty_result' }),
      onTimeout: () => resolve({ success: false, code: 'timeout' }),
    });
    entry.cancelLogin = () => {
      try { cancel(); } catch { /* ignore */ }
      resolve({ success: false, code: 'superseded' });
    };
  });
}

/**
 * Present the stored resume record. Resolves the server's loginResult (or a
 * local failure) and keeps the record in step with the answer: a fresh token
 * replaces it, `resume_invalid` deletes it.
 */
async function runResume(socket, rec, entry) {
  const result = await resumeSessionOnce(socket, rec.token, entry);
  if (entry.done) return result;
  if (result?.success) {
    saveTicketResume(result, { keepIfMissing: true, expectUserId: rec.userId });
    try { console.warn('[session-resume] socket re-authenticated with the resume token'); } catch { /* ignore */ }
  } else if (result?.code === RESUME_INVALID) {
    clearResumeRecord();
    try { console.warn('[session-resume] resume token refused (resume_invalid) — cleared'); } catch { /* ignore */ }
  }
  return result;
}

/**
 * Re-authenticate `socket` (default: the app socket). Resolves to
 * `{ ok, reason, result? }` and never rejects. While a re-auth for the same
 * connection is already running it is joined, not repeated; a re-auth for a
 * newer connection supersedes an older one. A FINISHED re-auth is never
 * reused, so a call after one has completed always runs a fresh oauthLogin
 * (play-refusal recovery relies on that: the server says it has no session).
 */
export function reauthSocket(socket = getSocket(), { reason = 'connect' } = {}) {
  if (!socket) return Promise.resolve({ ok: false, reason: 'no_socket' });
  const cur = _current;
  if (cur && !cur.done && cur.socketId === socket.id) return cur.promise;
  if (cur && !cur.done) cur.supersede();

  const entry = { id: ++_seq, socketId: socket.id, done: false, cancelLogin: null };
  let settle;
  entry.promise = new Promise((resolve) => {
    settle = (value) => {
      if (entry.done) return;
      entry.done = true;
      resolve(value);
    };
  });
  entry.supersede = () => {
    if (entry.done) return;
    try { entry.cancelLogin?.(); } catch { /* ignore */ }
    settle({ ok: false, reason: 'superseded' });
  };
  _current = entry;

  (async () => {
    const st = useGameStore.getState();
    if (!st.isLoggedIn) return settle({ ok: false, reason: 'not_signed_in' });

    // 2026-10-09 (R1 / D1) — a TICKET session re-authenticates with its own
    // resume record only (bound to this tab's user), never through OIDC
    // credentials the device may hold for another account.
    if (isTicketSessionTab(st.userId)) {
      const rec = readResumeRecordForUser(st.userId);
      if (!rec) {
        // 2026-10-10 — the resume chain has ended: fall back to the browser's
        // own sign-in only when it is provably THIS account.
        if (ticketTabOwnsDeviceSignIn()) {
          const fb = await runOwnOidcFallback(socket, entry, st, 'no_resume_record');
          if (fb.done || entry.done) return undefined;
          if (fb.ok) return settle({ ok: true, reason, result: fb.result, via: 'own_oidc' });
        }
        try { console.warn('[socket-reauth] failed', { reason, code: 'no_resume_record' }); } catch { /* ignore */ }
        return settle({ ok: false, reason: 'no_resume_record' });
      }
      const result = await runResume(socket, rec, entry);
      if (entry.done) return undefined;
      if (result?.success) return settle({ ok: true, reason, result, via: 'resume' });
      if (result?.code === RESUME_INVALID && ticketTabOwnsDeviceSignIn()) {
        const fb = await runOwnOidcFallback(socket, entry, st, RESUME_INVALID);
        if (fb.done || entry.done) return undefined;
        if (fb.ok) return settle({ ok: true, reason, result: fb.result, via: 'own_oidc' });
      }
      try { console.warn('[socket-reauth] failed', { reason, code: result?.code || 'unlabelled' }); } catch { /* ignore */ }
      return settle({ ok: false, reason: String(result?.code || 'login_failed'), result });
    }

    // Every other session: the pre-2026-10-09 OIDC re-auth — with the
    // dropped-sign-in fence (2026-10-10) when this tab has one.
    const fence = fenceFor(st);
    const first = await ensureFreshAccessToken(false, fence);
    if (entry.done) return undefined;
    if (first.status === 'revoked') return settle({ ok: false, reason: 'revoked' });

    let token = first.accessToken;
    if (!token) {
      if (fence) { try { console.warn('[socket-reauth] failed', { reason, code: 'no_own_token' }); } catch { /* ignore */ } }
      return settle({ ok: false, reason: 'no_token' });
    }
    let result = await oauthLoginOnce(socket, token, entry);
    if (entry.done) return undefined;

    // The server rejected the token itself (expired / invalid): refresh once
    // — unless we just did — and try again.
    if (!result?.success && isCredentialDead(result) && first.status !== 'refreshed') {
      const forced = await ensureFreshAccessToken(true, fence);
      if (entry.done) return undefined;
      if (forced.status === 'refreshed') {
        token = forced.accessToken;
        if (token) {
          result = await oauthLoginOnce(socket, token, entry);
          if (entry.done) return undefined;
        }
      } else if (forced.status === 'revoked') {
        return settle({ ok: false, reason: 'revoked', result });
      }
    }
    if (result?.success) {
      return settle({ ok: true, reason, result });
    }
    try { console.warn('[socket-reauth] failed', { reason, code: result?.code || 'unlabelled' }); } catch { /* ignore */ }
    return settle({ ok: false, reason: String(result?.code || 'login_failed'), result });
  })().catch((e) => {
    try { console.warn('[socket-reauth] exception', e?.message || e); } catch { /* ignore */ }
    settle({ ok: false, reason: 'exception' });
  });

  return entry.promise;
}

/**
 * Wait for the re-auth of the CURRENT connection. If a newer connection's
 * re-auth replaced the one being waited on, wait for that one instead.
 * Resolves `{ ok:false, reason:'none' }` when no re-auth has run.
 */
export async function awaitCurrentReauth() {
  let entry = _current;
  if (!entry) return { ok: false, reason: 'none' };
  for (let hops = 0; hops < 5; hops += 1) {
    const r = await entry.promise;
    if (_current === entry || !_current) return r;
    entry = _current;
  }
  return entry.promise;
}

/**
 * Play-refusal recovery: the server refused a play attempt `login_required`
 * but this tab still holds a signed-in account. Join the re-auth already
 * running for this connection, or run a fresh one (refresh-if-needed +
 * oauthLogin). Resolves `{ ok, reason }`, never rejects.
 */
export async function recoverSignedInSocket(socket = getSocket()) {
  if (!socket || !socket.connected) return { ok: false, reason: 'not_connected' };
  if (!hasSignedInAccountSession()) return { ok: false, reason: 'no_account_session' };
  const cur = _current;
  if (!(cur && !cur.done && cur.socketId === socket.id)) {
    reauthSocket(socket, { reason: 'play_refused_login_required' });
  }
  // Follow a reconnect that supersedes this re-auth to the newer one.
  return awaitCurrentReauth();
}
