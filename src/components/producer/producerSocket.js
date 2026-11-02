/**
 * The producer panel's two connections (lead spec C6 + R3 + §3, 2026-11-02).
 *
 * 1. requestProducerToken(mainSocket): on the SIGNED-IN default-namespace
 *    socket, emit `broadcastIssueToken` {ev:'ch:*', scopes:['producer'],
 *    label:'Producer panel', ttlHours:2}; the server (isUserAdmin AND the
 *    login's is_admin claim; never an entrant) replies `broadcastTokenIssued`.
 *    An ack callback is passed as well, so either reply style works; the first
 *    answer wins, 10 s without one is 'no_answer'. The token is returned to the
 *    caller and kept in memory only — never stored, never logged.
 * 2. createProducerSocket: its OWN socket to `/broadcast` with that token as
 *    the handshake key (retries forever, like the page's). On every connect:
 *    `bc:producer:hello`, then `bc:producer:watch` {channel} again, so a
 *    reconnect resumes the push of `bc:producer:state`. Producer calls are
 *    `bc:producer:<name>` with an ack; 10 s without one is 'no_answer'. A
 *    refused key (bad_token / expired / revoked / not_yet_valid /
 *    not_producer, or `bc:authExpired`) stops this socket and tells the panel
 *    `tokenRefused(code, via)` (via 'handshake' | 'session' | 'call'); the
 *    panel decides (producerModel panelTokenRefusalAction) whether to mint a
 *    fresh token or wait for "Try again" (a key someone revoked).
 * 3. Review 2026-11-02 — the panel REVOKES its own key when it is done with it:
 *    retire({jti}) sends `bc:producer:revokeKey` {jti} and closes the socket
 *    only once that is answered (or after a timeout): socket.io's server drops
 *    an event that is still queued when the disconnect arrives.
 *    revokeNow(jti) is the page-unload variant (no wait is possible there).
 *
 * `io` is injected (socket.io-client's io in the app, a fake in node:test).
 */
import { PRODUCER_TOKEN_REQUEST, TOKEN_REFUSALS, tokenReply, ackReply, isObj } from './producerModel.js';

export const NAMESPACE = '/broadcast';
export const TOKEN_EVENT = 'broadcastIssueToken';
export const TOKEN_REPLY_EVENT = 'broadcastTokenIssued';
export const STATE_EVENT = 'bc:producer:state';
export const CALL_TIMEOUT_MS = 10000;
export const RETIRE_TIMEOUT_MS = 3000;

/**
 * Every producer call by name (spec §3). Written out in full so each event
 * name is a literal in the bundle (canonical-features locks some of them).
 */
export const PRODUCER_EVENTS = Object.freeze({
  hello: 'bc:producer:hello',
  watch: 'bc:producer:watch',
  setEvent: 'bc:producer:setEvent',
  setScene: 'bc:producer:setScene',
  setAuto: 'bc:producer:setAuto',
  feature: 'bc:producer:feature',
  lowerThird: 'bc:producer:lowerThird',
  setFeed: 'bc:producer:setFeed',
  onAir: 'bc:producer:onAir',
  command: 'bc:producer:command',
  mintKey: 'bc:producer:mintKey',
  revokeKey: 'bc:producer:revokeKey',
  listKeys: 'bc:producer:listKeys',
  delayedPin: 'bc:producer:delayedPin',
  holeCardsSwitch: 'bc:producer:holeCardsSwitch',
  recapHands: 'bc:producer:recapHands',
});

/** The /broadcast event name of a producer call ('feature' -> 'bc:producer:feature'); null for an unknown call. */
export function producerEvent(name) {
  return Object.prototype.hasOwnProperty.call(PRODUCER_EVENTS, name) ? PRODUCER_EVENTS[name] : null;
}

/**
 * Mint the panel's producer token on the main socket.
 * Resolves (never rejects) to tokenReply(): {ok:true, token, jti, scopes, nbf, exp} | {ok:false, code}.
 */
export function requestProducerToken(mainSocket, opts = {}) {
  const setT = opts.setTimeout || setTimeout;
  const clearT = opts.clearTimeout || clearTimeout;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : CALL_TIMEOUT_MS;
  const request = { ...PRODUCER_TOKEN_REQUEST, scopes: [...PRODUCER_TOKEN_REQUEST.scopes] };
  return new Promise((resolve) => {
    if (!mainSocket || typeof mainSocket.emit !== 'function' || mainSocket.connected === false) {
      resolve({ ok: false, code: 'not_connected' });
      return;
    }
    let done = false;
    let timer = null;
    const finish = (res) => {
      if (done) return;
      done = true;
      if (timer) clearT(timer);
      try { mainSocket.off(TOKEN_REPLY_EVENT, onReply); } catch { /* ignore */ }
      resolve(tokenReply(res));
    };
    const onReply = (res) => finish(res);
    mainSocket.on(TOKEN_REPLY_EVENT, onReply);
    timer = setT(() => finish({ ok: false, code: 'no_answer' }), timeoutMs);
    try {
      mainSocket.emit(TOKEN_EVENT, request, (ack) => { if (isObj(ack)) finish(ack); });
    } catch {
      finish({ ok: false, code: 'not_connected' });
    }
  });
}

/**
 * @param {object} opts
 * @param {Function} opts.io         socket.io-client `io`
 * @param {string}   opts.serverUrl  poker-server origin
 * @param {string}   opts.token      the producer token (handshake key)
 * @param {object}   opts.on         {status(s), hello(res), state(payload), tokenRefused(code)}
 */
export function createProducerSocket(opts) {
  const { io, serverUrl, token, on = {} } = opts;
  const setT = opts.setTimeout || setTimeout;
  const clearT = opts.clearTimeout || clearTimeout;
  let closed = false;
  let watching = null;
  const status = { connected: false, refused: null };
  const emitStatus = () => { try { on.status && on.status({ ...status }); } catch { /* never throws into the socket */ } };

  const socket = io(`${serverUrl}${NAMESPACE}`, {
    auth: { key: token },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 5000,
    forceNew: true,
  });

  function stopForToken(code, via) {
    if (closed) return;
    closed = true;
    status.connected = false;
    status.refused = code;
    emitStatus();
    try { socket.removeAllListeners(); socket.disconnect(); } catch { /* ignore */ }
    try { on.tokenRefused && on.tokenRefused(code, via); } catch { /* ignore */ }
  }

  function call(name, payload = {}, timeoutMs = CALL_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const event = producerEvent(name);
      if (!event) {
        resolve({ ok: false, code: 'unknown_call' });
        return;
      }
      if (closed || !socket.connected) {
        resolve({ ok: false, code: 'not_connected' });
        return;
      }
      let answered = false;
      const timer = setT(() => {
        if (answered) return;
        answered = true;
        resolve({ ok: false, code: 'no_answer' });
      }, timeoutMs);
      try {
        socket.emit(event, payload, (res) => {
          if (answered) return;
          answered = true;
          clearT(timer);
          const r = ackReply(res);
          if (!r.ok && TOKEN_REFUSALS.includes(r.code)) stopForToken(r.code, 'call');
          resolve(r);
        });
      } catch {
        answered = true;
        clearT(timer);
        resolve({ ok: false, code: 'not_connected' });
      }
    });
  }

  async function hello() {
    const res = await call('hello', {});
    try { on.hello && on.hello(res); } catch { /* ignore */ }
    return res;
  }

  socket.on('connect', () => {
    status.connected = true;
    status.refused = null;
    emitStatus();
    hello();
    if (watching) call('watch', { channel: watching });
  });
  socket.on('disconnect', () => {
    status.connected = false;
    emitStatus();
  });
  socket.on('connect_error', (err) => {
    const code = err && isObj(err.data) && typeof err.data.code === 'string' ? err.data.code : null;
    status.connected = false;
    status.refused = code;
    if (code && TOKEN_REFUSALS.includes(code)) {
      stopForToken(code, 'handshake');
      return;
    }
    emitStatus();
    // A namespace middleware refusal does not auto-retry in socket.io v4.
    if (!socket.active && !closed) setT(() => { if (!closed && !socket.connected) socket.connect(); }, 5000);
  });
  socket.on(STATE_EVENT, (payload) => { try { on.state && on.state(payload); } catch { /* ignore */ } });
  socket.on('bc:authExpired', (data) => stopForToken(isObj(data) && typeof data.code === 'string' ? data.code : 'expired', 'session'));

  function shut() {
    try { socket.removeAllListeners(); socket.disconnect(); } catch { /* ignore */ }
  }

  return {
    call,
    hello,
    /** Watch a channel (and re-watch it after every reconnect). */
    watch(channel) {
      watching = channel;
      return call('watch', { channel });
    },
    get connected() { return socket.connected; },
    close() {
      closed = true;
      shut();
    },
    /**
     * Revoke this panel's own key, then close. Resolves true when the server
     * confirmed the revoke; false when it could not be sent (not connected,
     * already closed, no jti) or got no answer in RETIRE_TIMEOUT_MS. Closing
     * waits for the answer: an event still queued on the server when the
     * disconnect lands is dropped ("ignore packet received after disconnection").
     */
    retire({ jti, timeoutMs = RETIRE_TIMEOUT_MS } = {}) {
      if (closed) return Promise.resolve(false);
      closed = true;
      if (typeof jti !== 'string' || !jti || !socket.connected) {
        shut();
        return Promise.resolve(false);
      }
      return new Promise((resolve) => {
        let done = false;
        let timer = null;
        const end = (ok) => {
          if (done) return;
          done = true;
          if (timer) clearT(timer);
          shut();
          resolve(ok);
        };
        timer = setT(() => end(false), timeoutMs);
        // The server drops every session on the revoked key (this one too):
        // bc:authExpired {code:'revoked'} and a server disconnect usually
        // arrive BEFORE the ack could, so that is the confirmation.
        socket.on('bc:authExpired', (data) => { if (isObj(data) && data.code === 'revoked') end(true); });
        try {
          socket.emit(PRODUCER_EVENTS.revokeKey, { jti }, (res) => end(isObj(res) && res.ok === true));
        } catch {
          end(false);
        }
      });
    },
    /** The page is going away: send the revoke now (best effort, no wait possible). */
    revokeNow(jti) {
      if (closed || typeof jti !== 'string' || !jti || !socket.connected) return false;
      try { socket.emit(PRODUCER_EVENTS.revokeKey, { jti }); return true; } catch { return false; }
    },
  };
}
