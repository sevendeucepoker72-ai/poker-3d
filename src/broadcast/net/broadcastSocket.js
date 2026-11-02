/**
 * The broadcast page's OWN socket to poker-server's `/broadcast` namespace (lead
 * spec §3 + C1, 2026-11-01). It never uses services/socketService (that socket
 * gives up after 20 tries and carries the player's sign-in); this one retries
 * forever (reconnectionAttempts Infinity, delay at most 5 s) and has no sign-in.
 *
 * - On EVERY connect it sends `bc:subscribe` (with lastSeq) and the ack carries
 *   the full snapshot.
 * - `bc:resync` asks for a fresh snapshot after a seq gap ('[broadcast] resync').
 * - A refused KEY (bad_token / expired, or a mid-session `bc:authExpired`)
 *   drops the key and reconnects keyless: the public feed needs none, and it
 *   shows strictly less than a keyed feed.
 * - Review 2026-11-02 — "this key, but not now" keeps the key and retries it:
 *   'not_yet_valid' (a key for a scheduled show: retried until its nbf) and
 *   'registry_loading' (the server's key registry is still loading after a
 *   restart; 'starting' is the same code from an older server build, kept for
 *   compatibility). A HANDSHAKE 'revoked' is retried for KEY_REVOKED_GRACE_MS first,
 *   because a server that has not loaded its registry yet refuses every key as
 *   'revoked'; only a refusal that outlasts the grace drops the key. Before,
 *   a restart turned every delayed OBS source into the LIVE public feed (about
 *   5 minutes ahead) and a future-dated key never activated.
 * - A namespace middleware refusal does not auto-reconnect in socket.io v4, so
 *   this module calls connect() again after a backoff that suits the code.
 * - The key is only ever in the handshake `auth`; it is never logged.
 *
 * `io` is injected (socket.io-client's io in the page, a fake in node:test).
 */
import { KEY_REFUSALS, KEY_RETRY_REFUSALS, KEY_REVOKED, KEY_REVOKED_GRACE_MS, isObj } from '../model/contract.js';
import { subscribePayload } from '../model/urlConfig.js';
import { RESYNC_LOG } from '../model/programStore.js';

export const NAMESPACE = '/broadcast';
export const SUBSCRIBE_EVENT = 'bc:subscribe';
export const HEARTBEAT_EVENT = 'bc:heartbeat';
export const SUBSCRIBE_ACK_TIMEOUT_MS = 10000;
export const RESYNC_MIN_GAP_MS = 2000;

// A not-yet-valid key is retried at its nbf, but at least this often and never
// more than this far apart (the page's clock may be off from the server's).
export const NOT_YET_VALID_MIN_RETRY_MS = 5000;
export const NOT_YET_VALID_MAX_RETRY_MS = 5 * 60 * 1000;

function b64urlJson(part) {
  const b64 = String(part).replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const text = typeof globalThis.atob === 'function'
    ? globalThis.atob(padded)
    : globalThis.Buffer.from(padded, 'base64').toString('binary');
  return JSON.parse(text);
}

/**
 * The key's `nbf` as epoch ms, read WITHOUT verifying (the server verifies;
 * this only times the retry). null when the key is not a readable JWT.
 */
export function keyNotBeforeMs(key) {
  try {
    const parts = typeof key === 'string' ? key.split('.') : [];
    if (parts.length !== 3) return null;
    const p = b64urlJson(parts[1]);
    return isObj(p) && Number.isFinite(p.nbf) ? p.nbf * 1000 : null;
  } catch {
    return null;
  }
}

/** How long to wait before retrying a 'not_yet_valid' key. */
export function notYetValidRetryMs(key, now) {
  const nbf = keyNotBeforeMs(key);
  if (nbf === null || !Number.isFinite(now)) return 30000;
  return Math.min(NOT_YET_VALID_MAX_RETRY_MS, Math.max(NOT_YET_VALID_MIN_RETRY_MS, nbf - now + 1000));
}

// Backoff before a manual connect() after a middleware refusal, by code.
const REFUSAL_RETRY_MS = {
  feed_off: 30000,
  rate_limited: 15000,
  too_many_connections: 30000,
  banned: 120000,
  secret_unset: 60000,
};
const DEFAULT_RETRY_MS = 5000;

export function retryDelayFor(code, attempt = 1) {
  const base = REFUSAL_RETRY_MS[code] || DEFAULT_RETRY_MS;
  return Math.min(120000, base * Math.max(1, Math.min(4, attempt)));
}

function warn(...args) {
  console.warn(...args);
}

/**
 * @param {object} opts
 * @param {Function} opts.io            socket.io-client `io`
 * @param {string}   opts.serverUrl     poker-server origin
 * @param {object}   opts.config        parseBroadcastConfig() result (holds the key)
 * @param {Function} opts.getLastSeq    () => the store's current seq
 * @param {object}   opts.on            {snapshot, frame, heartbeat, command, status, refused}
 */
export function createBroadcastSocket(opts) {
  const { io, serverUrl, config, getLastSeq = () => null, on = {} } = opts;
  const log = typeof opts.log === 'function' ? opts.log : warn;
  const setT = opts.setTimeout || setTimeout;
  const clearT = opts.clearTimeout || clearTimeout;
  const now = opts.now || (() => Date.now());

  let key = config.key || null;
  let closed = false;
  let retryTimer = null;
  let subscribeTimer = null;
  let refusalAttempts = 0;
  let keyRetryAttempts = 0;
  let revokedSince = null;   // first of a run of handshake 'revoked' refusals (ms), else null
  let lastResyncAt = -Infinity;
  const status = {
    connected: false,
    subscribed: false,
    keyed: !!key,
    keyRefused: null,      // the code that made the page drop its key
    keyHeld: null,         // a refusal the page is retrying WITH its key (not_yet_valid / registry_loading / starting / revoked in grace)
    refused: null,         // the last handshake / subscribe refusal code
    replaced: false,       // bc:sessionReplaced — another page holds this key's session
  };

  const emitStatus = () => { try { on.status && on.status({ ...status }); } catch { /* never throws into the socket */ } };

  const socket = io(`${serverUrl}${NAMESPACE}`, {
    auth: key ? { key } : {},
    transports: ['websocket', 'polling'],
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 5000,
    forceNew: true,
  });

  function scheduleConnect(ms) {
    if (closed) return;
    if (retryTimer) clearT(retryTimer);
    retryTimer = setT(() => {
      retryTimer = null;
      if (!closed && !socket.connected) socket.connect();
    }, ms);
  }

  function dropKey(code) {
    key = null;
    socket.auth = {};
    status.keyed = false;
    status.keyRefused = code;
    status.keyHeld = null;
    revokedSince = null;
    keyRetryAttempts = 0;
  }

  /** Keep the key and try it again after `ms` (a "not now" refusal). */
  function holdKey(code, ms) {
    status.keyHeld = code;
    emitStatus();
    scheduleConnect(ms);
  }

  function subscribe() {
    if (closed || !socket.connected) return;
    const payload = subscribePayload(config, getLastSeq());
    let answered = false;
    const onAck = (ack) => {
      if (answered) return;
      answered = true;
      if (subscribeTimer) { clearT(subscribeTimer); subscribeTimer = null; }
      if (isObj(ack) && ack.ok === true && isObj(ack.snapshot)) {
        status.subscribed = true;
        status.refused = null;
        emitStatus();
        try { on.snapshot && on.snapshot(ack.snapshot); } catch (e) { log('[broadcast] snapshot handler failed', e && e.message); }
        return;
      }
      status.subscribed = false;
      status.refused = isObj(ack) && typeof ack.code === 'string' ? ack.code : 'no_answer';
      emitStatus();
      try { on.refused && on.refused(status.refused); } catch { /* ignore */ }
      // A refusal the key caused: try again as a keyless public viewer.
      if (key && (status.refused === 'holecards_off' || status.refused === 'wrong_event' || status.refused === 'entrant')) {
        dropKey(status.refused);
        socket.disconnect();
        scheduleConnect(1000);
        return;
      }
      if (status.refused !== 'version_unsupported') {
        subscribeTimer = setT(() => { subscribeTimer = null; subscribe(); }, retryDelayFor(status.refused, 1));
      }
    };
    socket.emit(SUBSCRIBE_EVENT, payload, onAck);
    subscribeTimer = setT(() => { subscribeTimer = null; if (!answered) { answered = true; subscribe(); } }, SUBSCRIBE_ACK_TIMEOUT_MS);
  }

  socket.on('connect', () => {
    status.connected = true;
    status.keyHeld = null;
    refusalAttempts = 0;
    keyRetryAttempts = 0;
    revokedSince = null;
    emitStatus();
    subscribe();
  });

  socket.on('disconnect', () => {
    status.connected = false;
    status.subscribed = false;
    if (subscribeTimer) { clearT(subscribeTimer); subscribeTimer = null; }
    emitStatus();
  });

  socket.on('connect_error', (err) => {
    const code = err && isObj(err.data) && typeof err.data.code === 'string' ? err.data.code : null;
    status.connected = false;
    status.refused = code;
    if (code && key && KEY_REFUSALS.includes(code)) {
      dropKey(code);
      emitStatus();
      scheduleConnect(1000);
      return;
    }
    if (code && key && KEY_RETRY_REFUSALS.includes(code)) {
      keyRetryAttempts += 1;
      revokedSince = null;
      holdKey(code, code === 'not_yet_valid' ? notYetValidRetryMs(key, now()) : retryDelayFor(code, keyRetryAttempts));
      return;
    }
    if (code === KEY_REVOKED && key) {
      const t = now();
      if (revokedSince === null) revokedSince = t;
      if (t - revokedSince >= KEY_REVOKED_GRACE_MS) {
        dropKey(code);
        emitStatus();
        scheduleConnect(1000);
        return;
      }
      keyRetryAttempts += 1;
      holdKey(code, Math.min(retryDelayFor(code, keyRetryAttempts), Math.max(1000, revokedSince + KEY_REVOKED_GRACE_MS - t)));
      return;
    }
    emitStatus();
    // socket.active false = a middleware refusal: socket.io will not retry by itself.
    if (!socket.active) {
      refusalAttempts += 1;
      scheduleConnect(retryDelayFor(code, refusalAttempts));
    }
  });

  socket.on('bc:snapshot', (snap) => { try { on.snapshot && on.snapshot(snap); } catch (e) { log('[broadcast] snapshot handler failed', e && e.message); } });
  socket.on('bc:frame', (frame) => { try { on.frame && on.frame(frame); } catch (e) { log('[broadcast] frame handler failed', e && e.message); } });
  socket.on(HEARTBEAT_EVENT, (hb) => { try { on.heartbeat && on.heartbeat(hb); } catch (e) { log('[broadcast] heartbeat handler failed', e && e.message); } });
  socket.on('bc:command', (cmd) => { try { on.command && on.command(cmd); } catch { /* ignore */ } });
  socket.on('bc:sessionReplaced', () => {
    status.replaced = true;
    emitStatus();
    closed = true;           // another page holds this session: never fight it
    socket.disconnect();
  });
  socket.on('bc:authExpired', (data) => {
    const code = isObj(data) && typeof data.code === 'string' ? data.code : 'expired';
    if (!key) return;
    dropKey(code);
    emitStatus();
    socket.disconnect();
    scheduleConnect(1000);
  });

  return {
    /** Ask the server for a fresh snapshot (throttled). */
    resync(reason = 'seq_gap') {
      if (closed || !socket.connected) return false;
      const t = now();
      if (t - lastResyncAt < RESYNC_MIN_GAP_MS) return false;
      lastResyncAt = t;
      log(RESYNC_LOG, { reason });
      socket.emit('bc:resync', {});
      return true;
    },
    status: () => ({ ...status }),
    get connected() { return socket.connected; },
    close() {
      closed = true;
      if (retryTimer) clearT(retryTimer);
      if (subscribeTimer) clearT(subscribeTimer);
      try { socket.emit('bc:unsubscribe', {}); } catch { /* ignore */ }
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
