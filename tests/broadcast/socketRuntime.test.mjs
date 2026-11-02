// The broadcast socket + runtime (lead spec §3, C1, R9) against a fake
// socket.io client and a manual clock: subscribe on every connect, resync on a
// gap, a refused key falls back to the keyless public feed, the worker health
// contract, the reload rule, and the key never leaves the handshake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBroadcastSocket, retryDelayFor, notYetValidRetryMs, keyNotBeforeMs } from '../../src/broadcast/net/broadcastSocket.js';
import { createBroadcastRuntime } from '../../src/broadcast/net/broadcastRuntime.js';
import { parseBroadcastConfig } from '../../src/broadcast/model/urlConfig.js';
import { makeFakeIo, makeTimers } from './helpers/fakeIo.mjs';
import { KEY_REFUSALS, KEY_RETRY_REFUSALS, HANDSHAKE_REFUSALS } from '../../src/broadcast/model/contract.js';

const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6ImJjYXN0K2p3dCJ9.eyJqdGkiOiJhYmMifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
const PUBLIC = { mode: 'public', delayMs: 0, holeCards: false, policy: 'off' };
const program = (extra = {}) => ({
  v: 1, channel: 'weekly', eventKey: 'q:wq1', onAir: true, rehearsal: false, programNow: 0,
  event: { kind: 'weekly', qualifierId: 'wq1', tournamentId: 'tq1', name: 'Weekly Qualifier', status: 'running' },
  scene: { id: 'table', auto: true, since: 0 }, featured: { tableId: 'tb2', mode: 'auto' },
  standings: { playersLeft: 23, leaders: [] }, ticker: [], ...extra,
});
const snapshot = (seq = 10, extra = {}) => ({ v: 1, seq, serverNow: 5_000_000, feed: PUBLIC, program: program(), table: null, ...extra });

function setup(search = '?ch=weekly&role=output', hash = '', { reload } = {}) {
  const io = makeFakeIo();
  const timers = makeTimers();
  const logs = [];
  const config = parseBroadcastConfig(search, hash);
  const rt = createBroadcastRuntime({
    io, serverUrl: 'https://game.example', config, now: timers.now,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    log: (...a) => logs.push(a), reload,
  });
  rt.start();
  return { io, timers, rt, logs, sock: io.sockets[0] };
}

test('the page opens its own /broadcast socket: retries forever, websocket first, key only in auth', () => {
  const { sock, logs } = setup('?ch=weekly', `#k=${KEY}`);
  assert.equal(sock.url, 'https://game.example/broadcast');
  assert.equal(sock.opts.reconnectionAttempts, Infinity);
  assert.equal(sock.opts.reconnectionDelayMax, 5000);
  assert.deepEqual(sock.opts.transports, ['websocket', 'polling']);
  assert.deepEqual(sock.opts.auth, { key: KEY });
  sock.serverConnect();
  const sub = sock.lastEmit('bc:subscribe');
  assert.ok(sub, 'bc:subscribe on connect');
  assert.equal(JSON.stringify(sub.payload).includes(KEY), false);
  assert.equal(JSON.stringify(logs).includes(KEY), false, 'the key is never logged');
});

test('bc:subscribe on EVERY connect, with lastSeq after the first snapshot; ack carries the snapshot', () => {
  const { sock, rt } = setup();
  sock.serverConnect();
  const first = sock.lastEmit('bc:subscribe');
  assert.deepEqual(first.payload, { v: 1, layout: '16x9', role: 'output', follow: 'program', channel: 'weekly' });
  first.ack({ ok: true, snapshot: snapshot(10) });
  assert.equal(rt.getState().program.ready, true);
  assert.equal(rt.getState().health.status, 'ok');
  sock.fire('disconnect');
  sock.serverConnect();
  assert.equal(sock.emitsOf('bc:subscribe').length, 2);
  assert.equal(sock.lastEmit('bc:subscribe').payload.lastSeq, 10);
});

test('a seq gap sends bc:resync at once (throttled) and logs [broadcast] resync', () => {
  const { sock, rt, logs, timers } = setup();
  sock.serverConnect();
  sock.lastEmit('bc:subscribe').ack({ ok: true, snapshot: snapshot(10) });
  sock.fire('bc:frame', { v: 1, seq: 11, kind: 'program', program: program() });
  assert.equal(sock.emitsOf('bc:resync').length, 0);
  sock.fire('bc:frame', { v: 1, seq: 14, kind: 'program', program: program() });
  assert.equal(sock.emitsOf('bc:resync').length, 1);
  assert.equal(rt.getState().program.needsResync, false);
  assert.equal(logs.filter((l) => l[0] === '[broadcast] resync').length, 1);
  sock.fire('bc:frame', { v: 1, seq: 16, kind: 'program', program: program() });
  assert.equal(sock.emitsOf('bc:resync').length, 1, 'throttled to one per 2 s');
  timers.advance(2100);
  sock.fire('bc:heartbeat', { seq: 20, serverNow: 5_002_000, programNow: 5_002_000, delayMs: 0, onAir: true });
  assert.equal(sock.emitsOf('bc:resync').length, 2, 'a heartbeat ahead of us also resyncs');
});

function refuse(sock, code) {
  const err = new Error('refused');
  err.data = { code };
  sock.active = false;
  sock.fire('connect_error', err);
}

// A JWT-shaped key whose payload carries nbf (seconds); the page reads nbf only to time a retry.
function keyWithNbf(nbfSec) {
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64u({ alg: 'HS256', typ: 'bcast+jwt' })}.${b64u({ jti: 'j1', ev: 'q:wq1', scp: ['delayed', 'output'], nbf: nbfSec, exp: nbfSec + 3600 })}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;
}

test('a dead key at the handshake (bad_token / expired) drops the key at once and reconnects keyless (public feed)', () => {
  for (const code of ['bad_token', 'expired']) {
    const { sock, rt, timers } = setup('?ch=weekly', `#k=${KEY}`);
    refuse(sock, code);
    assert.deepEqual(sock.auth, {});
    assert.equal(rt.getState().socket.keyRefused, code);
    assert.equal(rt.getState().socket.keyed, false);
    timers.advance(1000);
    assert.equal(sock.connects, 1);
  }
});

test('review 2026-11-02: registry_loading keeps the key and retries it with backoff (server restart)', () => {
  const { sock, rt, timers } = setup('?ch=weekly', `#k=${KEY}`);
  refuse(sock, 'registry_loading');
  assert.deepEqual(sock.auth, { key: KEY }, 'the key is kept');
  assert.equal(rt.getState().socket.keyed, true);
  assert.equal(rt.getState().socket.keyRefused, null);
  assert.equal(rt.getState().socket.keyHeld, 'registry_loading');
  timers.advance(5000);
  assert.equal(sock.connects, 1, 'retried with the same key');
  refuse(sock, 'registry_loading');
  timers.advance(9_000);
  assert.equal(sock.connects, 1, 'backoff grows');
  timers.advance(1_000);
  assert.equal(sock.connects, 2);
  for (let i = 0; i < 40; i += 1) { refuse(sock, 'registry_loading'); timers.advance(20_000); }
  assert.deepEqual(sock.auth, { key: KEY }, 'never dropped while the registry loads');
  sock.serverConnect();
  assert.equal(rt.getState().socket.keyHeld, null, 'a connect clears the hold');
  assert.equal(rt.getState().socket.keyed, true);
});

test('fix round 2026-11-02: "starting" (an older server\'s registry-loading code) also keeps the key and retries it with backoff', () => {
  assert.ok(KEY_RETRY_REFUSALS.includes('registry_loading'), 'the code the server sends');
  assert.ok(KEY_RETRY_REFUSALS.includes('starting'), 'kept for compatibility');
  assert.ok(HANDSHAKE_REFUSALS.includes('starting'));
  assert.equal(KEY_REFUSALS.includes('starting'), false, 'never a key-dropping refusal');
  const { sock, rt, timers } = setup('?ch=weekly', `#k=${KEY}`);
  refuse(sock, 'starting');
  assert.deepEqual(sock.auth, { key: KEY }, 'the key is kept');
  assert.equal(rt.getState().socket.keyed, true);
  assert.equal(rt.getState().socket.keyRefused, null);
  assert.equal(rt.getState().socket.keyHeld, 'starting', 'held, not a generic refusal');
  timers.advance(5000);
  assert.equal(sock.connects, 1, 'retried with the same key');
  refuse(sock, 'starting');
  timers.advance(9_000);
  assert.equal(sock.connects, 1, 'backoff grows');
  timers.advance(1_000);
  assert.equal(sock.connects, 2);
  // Mixed with the new code (a server upgraded mid-restart): still one backoff run, key kept.
  refuse(sock, 'registry_loading');
  timers.advance(15_000);
  assert.equal(sock.connects, 3);
  for (let i = 0; i < 40; i += 1) { refuse(sock, i % 2 ? 'starting' : 'registry_loading'); timers.advance(20_000); }
  assert.deepEqual(sock.auth, { key: KEY }, 'never dropped while the registry loads');
  sock.serverConnect();
  assert.equal(rt.getState().socket.keyHeld, null, 'a connect clears the hold');
  assert.equal(rt.getState().socket.keyed, true);
});

test('review 2026-11-02: a handshake "revoked" right after a restart keeps the key through the grace; the key works once the registry loads', () => {
  const { sock, rt, timers } = setup('?ch=weekly', `#k=${KEY}`);
  refuse(sock, 'revoked');                       // the server is up but its key registry is not loaded yet
  assert.deepEqual(sock.auth, { key: KEY });
  assert.equal(rt.getState().socket.keyHeld, 'revoked');
  assert.equal(rt.getState().socket.keyRefused, null);
  timers.advance(5000);
  assert.equal(sock.connects, 1);
  refuse(sock, 'revoked');
  timers.advance(10_000);
  assert.equal(sock.connects, 2);
  sock.serverConnect();                          // registry loaded: the same key is accepted
  assert.equal(rt.getState().socket.keyed, true);
  assert.equal(rt.getState().socket.keyHeld, null);
  assert.deepEqual(sock.auth, { key: KEY });
});

test('review 2026-11-02: a handshake "revoked" that outlasts the grace drops the key (a really revoked key)', () => {
  const { sock, rt, timers } = setup('?ch=weekly', `#k=${KEY}`);
  const start = timers.now();
  let guard = 0;
  while (rt.getState().socket.keyed && guard < 50) {
    refuse(sock, 'revoked');
    timers.advance(20_000);
    guard += 1;
  }
  assert.equal(rt.getState().socket.keyed, false);
  assert.equal(rt.getState().socket.keyRefused, 'revoked');
  assert.deepEqual(sock.auth, {});
  const took = timers.now() - start;
  assert.ok(took >= 90_000 && took <= 130_000, `dropped after the 90 s grace (took ${took} ms)`);
});

test('review 2026-11-02: a mid-session revoke (bc:authExpired revoked) still drops the key at once', () => {
  const { sock, rt } = setup('?ch=weekly', `#k=${KEY}`);
  sock.serverConnect();
  sock.fire('bc:authExpired', { code: 'revoked' });
  assert.equal(rt.getState().socket.keyRefused, 'revoked');
  assert.deepEqual(sock.auth, {});
});

test('review 2026-11-02: not_yet_valid keeps a future-dated key and retries it at its nbf', () => {
  const timers0 = makeTimers();
  const nbfSec = Math.floor(timers0.now() / 1000) + 120;    // the show starts in 2 minutes
  const key = keyWithNbf(nbfSec);
  const { sock, rt, timers } = setup('?ch=weekly', `#k=${key}`);
  refuse(sock, 'not_yet_valid');
  assert.deepEqual(sock.auth, { key });
  assert.equal(rt.getState().socket.keyHeld, 'not_yet_valid');
  assert.equal(rt.getState().socket.keyRefused, null);
  timers.advance(110_000);
  assert.equal(sock.connects, 0, 'not before nbf');
  timers.advance(15_000);
  assert.equal(sock.connects, 1, 'retried right after nbf');
  sock.serverConnect();
  assert.equal(rt.getState().socket.keyed, true);
});

test('not_yet_valid retry timing: nbf from the key, clamped; an unreadable key waits 30 s', () => {
  const now = 1_700_000_000_000;
  assert.equal(notYetValidRetryMs(keyWithNbf(now / 1000 + 60), now), 61_000);
  assert.equal(notYetValidRetryMs(keyWithNbf(now / 1000 + 86_400), now), 300_000, 'a key for tomorrow re-checks every 5 min');
  assert.equal(notYetValidRetryMs(keyWithNbf(now / 1000 - 60), now), 5_000, 'clock skew: at least 5 s');
  assert.equal(notYetValidRetryMs('not-a-jwt', now), 30_000);
  assert.equal(keyNotBeforeMs(keyWithNbf(1234)), 1_234_000);
  assert.equal(keyNotBeforeMs(KEY), null);
});

test('a middleware refusal (feed_off) is retried by hand after a backoff', () => {
  const { sock, timers } = setup();
  const err = new Error('feed off');
  err.data = { code: 'feed_off' };
  sock.active = false;
  sock.fire('connect_error', err);
  timers.advance(29_000);
  assert.equal(sock.connects, 0);
  timers.advance(1_500);
  assert.equal(sock.connects, 1);
  assert.equal(retryDelayFor('feed_off', 9), 120000);
});

test('subscribe refused because of the key (holecards_off) -> keyless retry; channel_unknown -> retry later', () => {
  const { sock, rt, timers } = setup('?ch=weekly', `#k=${KEY}`);
  sock.serverConnect();
  sock.lastEmit('bc:subscribe').ack({ ok: false, code: 'holecards_off' });
  assert.equal(rt.getState().socket.keyRefused, 'holecards_off');
  assert.equal(sock.disconnects, 1);
  timers.advance(1000);
  assert.equal(sock.connects, 1);
  sock.serverConnect();
  sock.lastEmit('bc:subscribe').ack({ ok: false, code: 'channel_unknown' });
  const before = sock.emitsOf('bc:subscribe').length;
  timers.advance(5000);
  assert.equal(sock.emitsOf('bc:subscribe').length, before + 1);
});

test('bc:authExpired mid-session drops the key; bc:sessionReplaced never reconnects', () => {
  const { sock, rt, timers } = setup('?ch=weekly', `#k=${KEY}`);
  sock.serverConnect();
  sock.fire('bc:authExpired', { code: 'expired' });
  assert.equal(rt.getState().socket.keyRefused, 'expired');
  timers.advance(1000);
  assert.equal(sock.connects, 1);
  sock.fire('bc:sessionReplaced', {});
  assert.equal(rt.getState().socket.replaced, true);
  timers.advance(600_000);
  assert.equal(sock.connects, 1);
});

test('feed health in the runtime: amber at 6 s, slate at 15 s without heartbeats', () => {
  const { sock, rt, timers } = setup();
  sock.serverConnect();
  sock.lastEmit('bc:subscribe').ack({ ok: true, snapshot: snapshot(10) });
  timers.advance(6250);
  assert.equal(rt.getState().health.status, 'amber');
  timers.advance(9000);
  assert.equal(rt.getState().health.status, 'stale');
  assert.equal(rt.health().scene, 'slate');
  sock.fire('bc:heartbeat', { seq: 10, serverNow: 1, programNow: 1, delayMs: 0, onAir: true });
  timers.advance(2000);
  sock.fire('bc:heartbeat', { seq: 10, serverNow: 1, programNow: 1, delayMs: 0, onAir: true });
  assert.equal(rt.getState().health.status, 'ok');
});

test('window.__apkBroadcast.health() has exactly the §3 fields', () => {
  const { sock, rt, timers } = setup();
  const before = rt.health();
  assert.equal(before.ready, false);
  assert.equal(before.socketConnected, false);
  timers.advance(4000);
  assert.equal(before.feedAgeMs >= 0, true);
  assert.equal(rt.health().feedAgeMs, 4000, 'age since page start before the first beat');
  sock.serverConnect();
  sock.lastEmit('bc:subscribe').ack({ ok: true, snapshot: snapshot(10, { table: { t: 1, tableId: 'tb2', featured: true, handNumber: 1, phase: 'Flop', seats: [], handResult: null } }) });
  rt.markReady();
  const h = rt.health();
  assert.deepEqual(Object.keys(h).sort(), ['eventKey', 'eventStatus', 'feedAgeMs', 'feedMode', 'playersLeft', 'ready', 'scene', 'socketConnected', 'tableId', 'tournamentId'].sort());
  assert.equal(h.ready, true);
  assert.equal(h.socketConnected, true);
  assert.equal(h.scene, 'table');
  assert.equal(h.eventKey, 'q:wq1');
  assert.equal(h.tournamentId, 'tq1');
  assert.equal(h.tableId, 'tb2');
  assert.equal(h.eventStatus, 'running');
  assert.equal(h.playersLeft, 23);
  assert.equal(h.feedMode, 'public');
  rt.setShownScene('break');
  assert.equal(rt.health().scene, 'break');
});

test('bc:command reload is honoured only in the slate or the break; identify shows for 5 s', () => {
  let reloads = 0;
  const { sock, rt, timers } = setup('?ch=weekly', '', { reload: () => { reloads += 1; } });
  sock.serverConnect();
  sock.lastEmit('bc:subscribe').ack({ ok: true, snapshot: snapshot(10) });
  rt.setShownScene('table');
  sock.fire('bc:command', { cmd: 'reload', id: 'c1' });
  assert.equal(reloads, 0);
  assert.equal(rt.getState().lastCommand.done, false);
  rt.setShownScene('break');
  sock.fire('bc:command', { cmd: 'reload', id: 'c2' });
  assert.equal(reloads, 1);
  sock.fire('bc:command', { cmd: 'identify', id: 'c3' });
  assert.equal(rt.getState().identifyUntil, timers.now() + 5000);
});

test('close() unsubscribes and stops every timer', () => {
  const { sock, rt, timers } = setup();
  sock.serverConnect();
  rt.stop();
  assert.ok(sock.lastEmit('bc:unsubscribe'));
  assert.equal(timers.pending(), 0);
});

test('createBroadcastSocket works on its own (producer monitor reuse)', () => {
  const io = makeFakeIo();
  const timers = makeTimers();
  const got = [];
  const s = createBroadcastSocket({ io, serverUrl: 'https://g', config: parseBroadcastConfig('?q=wq1', ''), on: { snapshot: (x) => got.push(x) }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, now: timers.now, log: () => {} });
  io.sockets[0].serverConnect();
  assert.equal(io.sockets[0].lastEmit('bc:subscribe').payload.event, 'q:wq1');
  io.sockets[0].lastEmit('bc:subscribe').ack({ ok: true, snapshot: snapshot(1) });
  assert.equal(got.length, 1);
  assert.equal(s.status().subscribed, true);
});
