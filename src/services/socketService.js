import { io } from 'socket.io-client';
import { getAuthToken } from './tokenStorage';
import { watchOutgoingSeatEmits } from './leftTables';
import { SERVER_URL } from '../config';

if (!SERVER_URL) {
  console.error('[socketService] VITE_SERVER_URL is not configured for production build');
}

// Module-level socket reference. Document/window listeners (visibilitychange,
// online, pageshow) are attached ONCE at module load (see bottom of file) and
// read through this ref, so they don't stack every time connectToServer()
// creates a fresh socket on reconnect.
let _socket = null;
// Back-compat alias so existing code paths that reference `socket` below keep
// working. Kept in sync in connectToServer / disconnectFromServer.
let socket = null;

// 2026-10-09 (CONTRACTS.md C5, U7) — this client NEVER emits the socket
// 'logout' event. poker-server up to 5ea0f80 (and any rollback past S1)
// handles 'logout' by deleting the socket's auth session BEFORE the
// disconnect, and that disconnect then stands a seated player up WITHOUT
// crediting his stack; the server keeps its 'logout' handler for
// compatibility only. The explicit Sign Out's revocation is
// 'revokeSignInTokens' (gameStore REVOKE_SIGN_IN_TOKENS_EVENT). Every socket
// this client opens (primary here, extra tables in multiTableManager) goes
// through this guard: an emit of 'logout' never leaves the client — it is
// logged, any ack is answered as a refusal, and the call returns like a
// normal emit. The log text is locked in canonical-features.txt, so the guard
// cannot be dropped silently.
const NEVER_EMITTED_SOCKET_EVENT = 'logout';
export function guardNeverEmittedEvents(sock) {
  if (!sock || typeof sock.emit !== 'function' || sock.__neverEmitLogoutGuard) return sock;
  const emitOriginal = sock.emit;
  sock.emit = function emitExceptLogout(ev, ...args) {
    const self = this || sock;
    if (ev !== NEVER_EMITTED_SOCKET_EVENT) return emitOriginal.call(self, ev, ...args);
    try { console.error('[sign-out] blocked a socket logout emit: this client never sends it (C5)'); } catch { /* ignore */ }
    // What a real emit leaves behind: flags (.timeout() / .volatile) consumed.
    const errorFirst = !!(self.flags && self.flags.timeout !== undefined);
    self.flags = {};
    const ack = args.length ? args[args.length - 1] : null;
    if (typeof ack === 'function') {
      setTimeout(() => {
        try {
          if (errorFirst || ack.withError) ack(new Error('socket logout is never emitted'));
          else ack({ success: false, code: 'not_emitted' });
        } catch { /* ignore */ }
      }, 0);
    }
    return self;
  };
  sock.__neverEmitLogoutGuard = true;
  return sock;
}

// Pending-action queue. A single slot: only one turn-action can be pending
// at a time (you can't act twice on the same turn). If the socket drops
// right as the user taps, we hold the action here and flush it once the
// reconnected socket has its SEAT back ('reconnectedToTable' — see R1 below;
// it used to flush on 'connect', before the re-auth). The server dedupes by
// nonce so a retry after a successful-but-unack'd action is a no-op. Stale
// actions expire after QUEUE_TTL_MS so a 30s disconnect doesn't replay a fold
// from two hands ago.
const QUEUE_TTL_MS = 10_000;
let _pendingAction = null; // { type, amount, nonce, stateVersion, queuedAt }

function makeNonce() {
  // Prefer crypto.randomUUID — globally unique, CSPRNG-backed. The server
  // still only needs locally-unique-per-table:seat, but UUIDs cost the same
  // and eliminate any Math.random() birthday-collision worries. Fall back to
  // a timestamp+random hex string on the rare runtime (old Safari, jsdom)
  // that lacks randomUUID.
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  // Fallback: 16 hex chars + timestamp.
  return Math.random().toString(16).slice(2, 10) + Date.now().toString(16);
}

// R1 (TABLEUI-12, 2026-10-11) — a queued action waits for the SEAT, not for
// the raw socket. Every reconnect is a NEW server-side socket with no session:
// the seat comes back only when the re-auth (oauthLogin / resumeSession, run by
// App.jsx on 'connect') restores the reservation, and the server announces that
// with 'reconnectedToTable' (always BEFORE that login's loginResult). Flushing
// on 'connect' reached the server before the seat and was refused
// "Not at a table". So after a RE-connect:
//   - new actions queue too (not only while disconnected) until the seat is back;
//   - 'reconnectedToTable' flushes the queue;
//   - a successful loginResult with no seat restored before it, or no restore
//     within SEAT_RESTORE_WAIT_MS, drops the queued action and tells the table
//     (window event 'poker:queued-action-dropped') so the player can act again.
const SEAT_RESTORE_WAIT_MS = 15_000;
const QUEUED_ACTION_DROPPED_EVENT = 'poker:queued-action-dropped';
let _hadConnection = false;   // a connect after this one is a RE-connect
let _awaitingSeat = false;    // re-connected; the seat is not restored yet
let _awaitingSeatTimer = null;

function dropPendingAction(reason) {
  const p = _pendingAction;
  _pendingAction = null;
  if (!p) return;
  console.warn('[socketService] queued action dropped (' + reason + '):', p.type);
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(QUEUED_ACTION_DROPPED_EVENT, { detail: { type: p.type, reason } }));
    }
  } catch { /* ignore */ }
}

function stopAwaitingSeat() {
  _awaitingSeat = false;
  if (_awaitingSeatTimer) { clearTimeout(_awaitingSeatTimer); _awaitingSeatTimer = null; }
}

function startAwaitingSeat() {
  stopAwaitingSeat();
  _awaitingSeat = true;
  _awaitingSeatTimer = setTimeout(() => {
    _awaitingSeatTimer = null;
    if (!_awaitingSeat) return;
    _awaitingSeat = false;
    dropPendingAction('seat_not_restored');
  }, SEAT_RESTORE_WAIT_MS);
}

function flushPendingAction(reason = 'seat_restored') {
  if (!_pendingAction || !socket?.connected || _awaitingSeat) return;
  if (Date.now() - _pendingAction.queuedAt > QUEUE_TTL_MS) {
    dropPendingAction('stale');
    return;
  }
  const p = _pendingAction;
  _pendingAction = null;
  console.warn('[socketService] queued action sent after the seat was restored (' + reason + '):', p.type);
  // Echo the stateVersion captured at click time (2026-07-05). If the table
  // moved on during the disconnect, the server rejects this as stale and pushes
  // fresh state — exactly the behaviour we want for a queued action that may no
  // longer be valid. If nothing changed, the version still matches and it lands.
  // 2026-07-07 gap-fill [5]: carry the active tableId so a queued action from a
  // secondary (multi-table) tab flushes to the RIGHT table, not the primary.
  socket.emit('action', { type: p.type, amount: p.amount, nonce: p.nonce, stateVersion: p.stateVersion, tableId: p.tableId });
}

/**
 * Emit a player action with automatic queue-on-disconnect + nonce dedup.
 * If the socket is connected (and, after a reconnect, its seat is restored),
 * emit immediately. If not, stash as the single pending action (overwriting
 * any prior queued one — only the user's latest intent is valid) and flush
 * when the server restores the seat ('reconnectedToTable').
 *
 * `stateVersion` (2026-07-05) is the server's monotonic decision-point version
 * the user acted on, echoed back so the server can reject a stale click (the
 * table advanced underneath us — timeout-fold, new hand). It's read from the
 * store's current gameState by the caller; undefined is fine (server treats a
 * missing version as "don't check", so older builds keep working).
 */
export const emitPlayerAction = (type, amount, stateVersion, tableId) => {
  const payload = { type, amount, nonce: makeNonce(), stateVersion, tableId, queuedAt: Date.now() };
  // R1 — connected but the seat is not restored yet (re-auth in flight): queue.
  if (socket?.connected && !_awaitingSeat) {
    // 2026-07-07 gap-fill [5]: include the active tableId so multi-table players'
    // actions apply to the table they're looking at. Omitting it (single-table
    // callers) keeps the server on the primary-session path exactly as before.
    socket.emit('action', { type, amount, nonce: payload.nonce, stateVersion, tableId });
    return { sent: true, nonce: payload.nonce };
  }
  _pendingAction = payload;
  return { sent: false, queued: true, nonce: payload.nonce };
};

export const hasPendingAction = () => !!_pendingAction;

// Connection status — subscribers get notified on change
let _connectionStatus = 'disconnected'; // 'connected' | 'disconnected' | 'error'
let _connectionError = '';
const _statusSubscribers = new Set();

function setStatus(status, error = '') {
  _connectionStatus = status;
  _connectionError = error;
  _statusSubscribers.forEach((fn) => fn(status, error));
}

export const subscribeConnectionStatus = (fn) => {
  _statusSubscribers.add(fn);
  fn(_connectionStatus, _connectionError); // immediate call with current state
  return () => _statusSubscribers.delete(fn);
};

export const getConnectionStatus = () => ({ status: _connectionStatus, error: _connectionError });

export const connectToServer = () => {
  if (socket?.connected) return socket;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    _socket = null;
  }

  // Attach auth on the handshake so the server sees the access token on
  // the very first connect packet instead of relying on a post-connect
  // `oauthLogin` emit (which still runs for backward compat — either
  // path is accepted server-side). This shrinks the unauthenticated
  // window to zero and lets the server-side session bind as part of
  // the handshake.
  const token = (() => {
    try { return getAuthToken(); } catch { return null; }
  })();

  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    // PWA audit #1: iOS backgrounds socket.io for ≥30s during swipe-up /
    // take a call / notification lockscreen. Bump attempts to 20 and
    // extend initial delay so the exponential backoff doesn't exhaust
    // inside a normal backgrounding window. With randomizationFactor the
    // retries spread nicely 1s → 2s → 4s → … up to 20s max.
    reconnectionAttempts: 20,
    reconnectionDelay: 800,
    reconnectionDelayMax: 20_000,
    randomizationFactor: 0.5,
    // 20s connect timeout. Railway free-tier servers cold-start in 3–8s,
    // and on flaky mobile networks the TLS + websocket upgrade handshake
    // can take another few seconds on top. 10s was causing the socket to
    // abort mid-handshake, making every login feel like a timeout.
    timeout: 20_000,
    auth: token ? { token } : undefined,
  });
  guardNeverEmittedEvents(socket); // U7 — never 'logout' (see above)
  // S2 round 2 (V3) — an emit that can seat this socket somewhere ends the
  // "ignore late frames of a table this socket left" marks (leftTables.js).
  watchOutgoingSeatEmits(socket);
  _socket = socket;

  socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    setStatus('connected');
    // R1 (TABLEUI-12) — NOT a flush: the new server-side socket has no seat
    // until the re-auth restores it ('reconnectedToTable' below). Only a
    // recovered connection (socket.io state recovery: same session) is ready.
    if (socket.recovered) {
      stopAwaitingSeat();
      flushPendingAction('session_recovered');
    } else if (_hadConnection) {
      startAwaitingSeat();
      if (_pendingAction) console.warn('[socketService] queued action held until the seat is restored after re-auth:', _pendingAction.type);
    }
    _hadConnection = true;
  });
  // The re-auth put this socket back in its seat: send what was queued.
  socket.on('reconnectedToTable', () => {
    stopAwaitingSeat();
    flushPendingAction('seat_restored');
  });
  // A successful sign-in answer with no seat restore before it: no seat to act
  // in on this connection (a failed one may still be retried, so keep waiting).
  socket.on('loginResult', (res) => {
    if (!_awaitingSeat || !(res && res.success)) return;
    stopAwaitingSeat();
    dropPendingAction('no_seat_restored');
  });
  socket.on('disconnect', (reason) => {
    stopAwaitingSeat();
    console.log('Disconnected:', reason);
    // `io server disconnect` means the server explicitly closed the socket
    // (kick, auth rejection, server shutdown). socket.io will NOT auto-
    // reconnect in that case — we have to kick it ourselves after a short
    // delay, otherwise the client sits disconnected forever. Surface a
    // distinct status so the banner / UI can reflect the server-forced
    // close if desired; we still attempt a reconnect so casual drops
    // (hand-off between Railway revisions) recover transparently.
    if (reason === 'io server disconnect') {
      setStatus('disconnected', 'Disconnected by server');
      setTimeout(() => {
        try { if (_socket && !_socket.connected) _socket.connect(); } catch { /* ignore */ }
      }, 1500);
      return;
    }
    setStatus('disconnected');
  });
  socket.on('connect_error', (err) => { console.log('Connection error:', err.message); setStatus('error', err.message); });
  // (socket.io v4 fires 'reconnect' on the Manager, not here; 'connect' above
  // covers every reconnect. Kept for older clients — status only, no flush.)
  socket.on('reconnect', () => { setStatus('connected'); });
  socket.on('reconnecting', () => setStatus('disconnected'));

  // 2026-05-05 Phase 3 — re-attach the LATEST auth token before each
  // reconnect attempt. socket.io persists the auth payload from the
  // initial connect across reconnects, so if the access token was
  // refreshed (or cleared, or replaced by a different user logging in
  // on another tab) while we were disconnected, the stale token would
  // be sent on reconnect and the server would reject the handshake.
  // Reading from storage on every reconnect_attempt picks up whatever
  // the current value is.
  if (socket.io && typeof socket.io.on === 'function') {
    socket.io.on('reconnect_attempt', () => {
      try {
        const latestToken = getAuthToken();
        if (latestToken) {
          socket.auth = { ...(socket.auth || {}), token: latestToken };
        } else if (socket.auth) {
          // Token was cleared (logout while disconnected). Drop the
          // stale auth payload so the server gets a clean handshake
          // instead of one with a known-invalid token.
          delete socket.auth.token;
        }
      } catch { /* ignore */ }
    });
  }

  // Terminal reconnect state — fires after `reconnectionAttempts` exhausts.
  // socket.io stops retrying on its own; the user needs an explicit tap to
  // resume. Surface `failed` status so the banner stays up with a CTA, and
  // `forceReconnect()` below is the sanctioned path to kick it back to life.
  // Listen on `socket.io` (the Manager) — the engine-level event isn't
  // re-emitted on the Socket instance.
  if (socket.io && typeof socket.io.on === 'function') {
    socket.io.on('reconnect_failed', () => {
      console.warn('[socketService] reconnect attempts exhausted');
      setStatus('failed', 'Connection lost — tap to reconnect');
    });
  }

  return socket;
};

/**
 * Trigger a manual reconnect. Called from the app-resume handler and from
 * the "tap to reconnect" banner CTA after the `failed` terminal state.
 *
 * 2026-10-11 (.online R1 client review, R1C-REV-1): ALWAYS reuse the SAME
 * socket instance. App.jsx and GameHUD bind their game listeners (connect ->
 * re-auth, gameState, loginResult, error, insurance, reveals...) to this
 * instance in mount-once effects; the old 'failed' branch nulled it and built
 * a new one, so the banner went away and the dot turned green while nothing
 * re-authenticated, no state arrived and every action was dropped — a frozen
 * table until a full reload. Verified against socket.io-client 4.8.3: after
 * `reconnect_failed`, Socket.connect() on the same instance calls io.open()
 * and reconnects, and every listener registered before the outage keeps
 * receiving events. Lock token: forceReconnectSameInstance
 */
export const forceReconnect = () => {
  if (_socket && _socket.connected) return;
  if (_connectionStatus === 'failed' && _socket) {
    try { console.info('[forceReconnectSameInstance] reconnecting the existing socket after reconnect_failed'); } catch { /* ignore */ }
    try { _socket.connect(); } catch { /* ignore */ }
    return;
  }
  if (!_socket) {
    connectToServer();
    return;
  }
  try {
    _socket.connect();
  } catch { /* ignore */ }
};

export const getSocket = () => socket;

export const disconnectFromServer = () => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    _socket = null;
  }
};

/**
 * 2026-07-06 P2 auth fix — logout teardown: kill the authenticated socket
 * SESSION without destroying the socket INSTANCE.
 *
 * Why not disconnectFromServer()? App.jsx attaches all its game listeners to
 * the instance in mount-once effects, and connectToServer() runs once per
 * page load — nulling the instance would orphan every listener until a full
 * reload, breaking a re-login on the same tab. We only cycle the CONNECTION:
 *
 *   1. Strip the auth token from the handshake payload so any reconnect
 *      (manual, or via the module-level visibility/online handlers below)
 *      handshakes UNAUTHENTICATED — token storage was already wiped by
 *      gameStore.logout() before this is called.
 *   2. socket.disconnect() closes the transport. Server-side, the
 *      'disconnect' handler (poker-server index.ts ~10374) deletes the
 *      authSession for the old socket.id and runs the existing
 *      reserved-seat flow (seat held ~10 min; at-table stack cashed out
 *      additively on expiry — it never overwrites wallet chips).
 *   3. Reconnect immediately so the login screen has a live socket for
 *      guest login / online-count — the fresh connection has a NEW
 *      socket.id with no auth session, so a different user logging in on
 *      this tab can never inherit the previous user's server-side session.
 */
export const disconnect = () => {
  if (!socket) return;
  // 2026-07-06 audit P3 — drop any queued player action on logout. Otherwise a
  // fold/call the previous user queued while disconnected would flush on the
  // post-logout reconnect (or, worse, after a different user signs in on this
  // tab). Logout must not carry an action across the session boundary.
  _pendingAction = null;
  stopAwaitingSeat();
  try { if (socket.auth) delete socket.auth.token; } catch { /* ignore */ }
  try { socket.disconnect(); } catch { /* ignore */ }
  try { socket.connect(); } catch { /* ignore */ }
};

// -----------------------------------------------------------------------
// Attach-once document/window listeners.
//
// PWA audit #1: explicit visibility-change / online / pageshow kick so an
// iOS PWA resumed from background re-establishes the socket immediately
// instead of waiting for socket.io's reconnect loop to tick.
//
// IMPORTANT: these must attach exactly ONCE at module load, NOT inside
// connectToServer(). Previously the listeners were added every time
// connectToServer() ran, stacking a new handler on every reconnect /
// remount cycle. That leaked listeners across every background-resume,
// and each leaked listener would call .connect() on a socket that no
// longer existed. The handlers below reference the current socket via
// the module-level `_socket` ref that connectToServer keeps in sync.
// -----------------------------------------------------------------------
// Gameplay audit F155 (2026-10-21) — what the resume resync names: App
// registers a function returning `{ tableId, wasSeated }` for the table on
// screen (null otherwise). This module must not import the stores (the table
// store imports it), hence the registration. A newer server answers a socket
// whose seat is gone with a spectator view + a notice, and a table that is
// gone with `tableClosed` — instead of nothing (a frozen table).
let _resyncHint = null;
export const setResyncHint = (fn) => { _resyncHint = typeof fn === 'function' ? fn : null; };
const resyncPayload = () => {
  try {
    const p = _resyncHint ? _resyncHint() : null;
    return p && typeof p === 'object' ? p : null;
  } catch { return null; }
};

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (!_socket) return;
    if (!_socket.connected) {
      // Dropped while backgrounded (mobile / OS suspend) — kick the reconnect
      // now instead of waiting out socket.io's backoff. Fresh full state then
      // arrives via the server's reconnect path.
      try { _socket.connect(); } catch { /* ignore */ }
    } else {
      // 2026-06-12 — Still connected, but the render loop was frozen while the
      // tab was hidden, so the table can look a few frames stale. Pull a fresh
      // full snapshot so we snap to the live hand instead of catching up
      // frame-by-frame. (Server handler: socket.on('requestState').)
      // F155 — with the table on screen (an older server ignores it).
      try {
        // (Always an object: a payload-taking server handler refuses a
        // missing one; an older server ignores it.)
        _socket.emit('requestState', resyncPayload() || {});
      } catch { /* ignore */ }
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  // Also on explicit online/pageshow for iOS Safari quirks (BFCache resume,
  // network-up after airplane mode, etc.).
  window.addEventListener('online', onVisible);
  window.addEventListener('pageshow', onVisible);
}
