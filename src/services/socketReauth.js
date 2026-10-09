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
 */
import { getAuthToken } from './tokenStorage';
import { runSocketLogin, isCredentialDead } from './socketAuth';
import { isTokenExpiringSoon, refreshNowAndApply, hasRefreshToken } from './authScheduler';
import { getSocket } from './socketService';
import { useGameStore } from '../store/gameStore';

// Refresh before re-auth when the access token has less than this left. Covers
// clock skew and the time oauthLogin itself takes.
const NEAR_EXPIRY_MS = 2 * 60_000;
// Watchdog for one oauthLogin answer (introspection + upsert + loadProgress,
// plus a Railway cold start).
const OAUTH_LOGIN_TIMEOUT_MS = 15_000;

let _seq = 0;
// The re-auth for the CURRENT connection: { id, socketId, done, promise, supersede }.
let _current = null;

/**
 * True when this tab holds a signed-in American Pub Poker account session
 * (an OIDC session: a refresh token or an OAuth access token), as opposed to
 * no session or a legacy/guest token. Only such a session can be recovered
 * silently.
 */
export function hasSignedInAccountSession() {
  try {
    const st = useGameStore.getState();
    if (!st.isLoggedIn) return false;
    if (!getAuthToken()) return false;
    return hasRefreshToken() || !!st.oauthAccessToken;
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
async function ensureFreshAccessToken(force) {
  const stored = () => ({ accessToken: getAuthToken() });
  if (!hasRefreshToken()) return { status: 'no_refresh_token', ...stored() };
  if (!force && !isTokenExpiringSoon(NEAR_EXPIRY_MS)) return { status: 'fresh', ...stored() };
  try {
    const tokens = await refreshNowAndApply();
    if (!tokens) return { status: 'no_refresh_token', ...stored() };
    const fresh = typeof tokens.access_token === 'string' && tokens.access_token ? tokens.access_token : null;
    return { status: 'refreshed', accessToken: fresh || getAuthToken() };
  } catch (e) {
    return { status: e?.name === 'RefreshTokenRevokedError' ? 'revoked' : 'refresh_failed', ...stored() };
  }
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
    if (!useGameStore.getState().isLoggedIn) return settle({ ok: false, reason: 'not_signed_in' });
    const first = await ensureFreshAccessToken(false);
    if (entry.done) return undefined;
    if (first.status === 'revoked') return settle({ ok: false, reason: 'revoked' });

    let token = first.accessToken;
    if (!token) return settle({ ok: false, reason: 'no_token' });
    let result = await oauthLoginOnce(socket, token, entry);
    if (entry.done) return undefined;

    // The server rejected the token itself (expired / invalid): refresh once
    // — unless we just did — and try again.
    if (!result?.success && isCredentialDead(result) && first.status !== 'refreshed') {
      const forced = await ensureFreshAccessToken(true);
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
