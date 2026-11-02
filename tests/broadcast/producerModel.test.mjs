// Producer panel rules (lead spec C6 + R3 + §3 producer events, 2026-11-02):
// the panel token request, key URLs (key in the fragment only), delay floor
// 5 minutes, refusal texts, the checklist, the live view (no cards), the
// producer socket (fake io), and the scoped broadcast stylesheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PRODUCER_TOKEN_REQUEST, sourceUrl, eventKeyParams, clampDelayMin, clampTtlHours, tokenReply, ackReply,
  refusalText, delayedKeyEvent, liveTiles, onAirVsLive, goLiveChecklist, lowerThirdItem, lowerThirdPresets,
  keyRowsOf, keyTimeMs, DEFAULT_DELAY_MIN, MIN_DELAY_MIN, SCENE_BUTTONS, RELOAD_SCENES,
  panelRenewDelayMs, panelTokenRefusalAction, panelKeyIsDead, FEED_DELAY_HINT, spotlightEntrants,
} from '../../src/components/producer/producerModel.js';
import {
  requestProducerToken, createProducerSocket, producerEvent, PRODUCER_EVENTS, TOKEN_EVENT, TOKEN_REPLY_EVENT,
} from '../../src/components/producer/producerSocket.js';
import { scopeBroadcastCss, isScopedSelector } from '../../src/components/producer/broadcastCssScope.js';
import { makeFakeIo, makeTimers } from './helpers/fakeIo.mjs';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzY3AiOlsicHJvZHVjZXIiXX0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
const ORIGIN = 'https://americanpubpoker.online';

test('the panel token request: ch:*, producer, "Producer panel", 2 h (review 2026-11-02; spec said 12)', () => {
  assert.deepEqual({ ...PRODUCER_TOKEN_REQUEST, scopes: [...PRODUCER_TOKEN_REQUEST.scopes] },
    { ev: 'ch:*', scopes: ['producer'], label: 'Producer panel', ttlHours: 2 });
});

test('review 2026-11-02: the feed-delay hint says only delayed-key sources follow it; the public URL stays live', () => {
  assert.match(FEED_DELAY_HINT, /only to OBS sources opened with a delayed key/);
  assert.match(FEED_DELAY_HINT, /public URL \(no key\) always stays live/);
  assert.doesNotMatch(FEED_DELAY_HINT, /Everything on air/);
  const src = fs.readFileSync(new URL('../../src/components/producer/FeedControl.jsx', import.meta.url), 'utf8');
  assert.match(src, /<div className="bcp-hint">\{FEED_DELAY_HINT\}<\/div>/);
  assert.doesNotMatch(src, /Everything on air/);
});

test('review 2026-11-02: panel key renewal is timed on the server lifetime (clock-skew proof)', () => {
  const nbf = 1_800_000_000_000;
  assert.equal(panelRenewDelayMs({ nbf, exp: nbf + 2 * 3600_000 }), 110 * 60_000, '10 minutes before a 2 h key runs out');
  assert.equal(panelRenewDelayMs({ nbf: nbf / 1000, exp: nbf / 1000 + 7200 }), 110 * 60_000, 'JWT seconds work too');
  assert.equal(panelRenewDelayMs({ nbf, exp: nbf + 5 * 60_000 }), 60_000, 'never sooner than a minute');
  assert.equal(panelRenewDelayMs({}), 110 * 60_000, 'no times: the 2 h default');
});

test('review 2026-11-02: a key someone revoked is never re-minted behind their back; a restart refusal is', () => {
  assert.equal(panelTokenRefusalAction('revoked', 'session'), 'stop', 'KeyManager revoke while the panel is open');
  assert.equal(panelTokenRefusalAction('not_producer', 'call'), 'stop', 'a call after the key stopped being valid');
  assert.equal(panelTokenRefusalAction('revoked', 'handshake'), 'remint', 'server restart: registry not loaded yet');
  assert.equal(panelTokenRefusalAction('expired', 'session'), 'remint');
  assert.equal(panelTokenRefusalAction('bad_token', 'handshake'), 'remint');
  assert.equal(panelKeyIsDead('revoked', 'session'), true);
  assert.equal(panelKeyIsDead('expired', 'handshake'), true);
  assert.equal(panelKeyIsDead('revoked', 'handshake'), false, 'maybe only unloaded: still revoked later');
  assert.match(refusalText('panel_key_revoked'), /revoked[^]*Try again/);
});

test('OBS URLs: the key only ever in the #k= fragment, never the query string', () => {
  const u = sourceUrl({ origin: ORIGIN, target: 'weekly', layout: '16x9', key: TOKEN });
  const url = new URL(u);
  assert.equal(url.pathname, '/broadcast.html');
  assert.equal(url.searchParams.get('ch'), 'weekly');
  assert.equal(url.searchParams.get('layout'), '16x9');
  assert.equal(url.searchParams.get('role'), 'output');
  assert.equal(url.searchParams.get('tally'), '0');
  assert.equal(url.searchParams.has('k'), false);
  assert.ok(!url.search.includes(TOKEN), 'not in the query');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('k'), TOKEN);
  const noKey = sourceUrl({ origin: ORIGIN, target: 'weekly', layout: '9x16' });
  assert.equal(new URL(noKey).hash, '', 'public output needs no key');
  assert.equal(new URL(noKey).searchParams.get('layout'), '9x16');
});

test('URL targets: channels and q:/t:/ch: keys; junk gives no URL', () => {
  assert.deepEqual(eventKeyParams('q:wq-1108'), { q: 'wq-1108' });
  assert.deepEqual(eventKeyParams('t:tq-1'), { t: 'tq-1' });
  assert.deepEqual(eventKeyParams('ch:monthly'), { ch: 'monthly' });
  assert.equal(eventKeyParams('ch:*'), null, 'the producer wildcard is never an OBS URL');
  assert.equal(eventKeyParams('q:../x'), null);
  assert.equal(sourceUrl({ origin: ORIGIN, target: 'nope' }), null);
  assert.equal(sourceUrl({ origin: 'javascript:alert(1)', target: 'main' }), null);
  assert.match(sourceUrl({ origin: ORIGIN, target: 'q:wq-1108', key: TOKEN }), /\?q=wq-1108&/);
});

test('delay: floor and default are 5 minutes (owner 2026-11-02), configurable upward', () => {
  assert.equal(MIN_DELAY_MIN, 5);
  assert.equal(DEFAULT_DELAY_MIN, 5);
  assert.equal(clampDelayMin(1), 5);
  assert.equal(clampDelayMin('abc'), 5);
  assert.equal(clampDelayMin(30), 30);
  assert.equal(clampDelayMin(9999), 240);
  assert.equal(clampTtlHours(48), 12, 'a key never lives past 12 h');
  assert.equal(clampTtlHours(0), 12);
  assert.equal(clampTtlHours(3), 3);
});

test('token replies and acks', () => {
  assert.deepEqual(tokenReply({ ok: true, token: TOKEN, jti: 'j1', scopes: ['producer'], nbf: 1, exp: 2 }),
    { ok: true, token: TOKEN, jti: 'j1', scopes: ['producer'], nbf: 1, exp: 2 });
  assert.deepEqual(tokenReply({ ok: false, code: 'not_admin' }), { ok: false, code: 'not_admin' });
  assert.deepEqual(tokenReply({ ok: true }), { ok: false, code: 'refused' }, 'no token string = refused');
  assert.deepEqual(tokenReply(null), { ok: false, code: 'no_answer' });
  assert.deepEqual(ackReply([{ jti: 'a' }]), { ok: true, list: [{ jti: 'a' }] });
  assert.equal(ackReply({ ok: false }).code, 'refused');
  assert.equal(keyRowsOf({ ok: true, list: [{ jti: 'a', scopes: ['output'], token: 'SHOULD-NOT-SHOW' }] })[0].token, undefined);
  assert.equal(keyTimeMs(1_800_000_000), 1_800_000_000_000, 'JWT seconds');
  assert.equal(keyTimeMs(1_800_000_000_000), 1_800_000_000_000, 'already ms');
});

test('every spec refusal code has plain words; holecards_off and delay_below_minimum say why', () => {
  for (const code of ['not_producer', 'producer_is_entrant', 'issuer_not_allowlisted', 'holecards_off', 'delay_below_minimum',
    'event_not_found', 'table_not_in_event', 'scene_not_allowed', 'event_not_finished', 'not_captured', 'secret_unset',
    'not_admin', 'issuer_is_entrant']) {
    assert.doesNotMatch(refusalText(code), /^Refused/, code);
  }
  assert.match(refusalText('delay_below_minimum'), /5 minutes/);
  assert.match(refusalText('holecards_off'), /security review/);
  assert.match(refusalText('mystery'), /Refused \(mystery\)/);
});

test('review 2026-11-02: a Player spotlight names only an entrant the server already named (First L. / Player), never typed text', () => {
  const program = {
    standings: { leaders: [{ pid: 'p1', name: 'John S.', chips: 61200, rank: 1 }, { pid: 'p2', name: 'Player', chips: 40000, rank: 2 }] },
    finalTable: { seats: [{ seatIndex: 0, pid: 'p1', name: 'John S.', chips: 61200 }, { seatIndex: 3, pid: 'p3', name: 'Ana R.', chips: 12000 }] },
  };
  const table = { seats: [{ seatIndex: 5, pid: 'p4', name: 'Bo T.', chips: 9000 }, { seatIndex: 6, pid: '', name: 'X' }, { pid: 'p5', name: '   ' }] };
  const entrants = spotlightEntrants(program, table);
  assert.deepEqual(entrants.map((e) => e.pid), ['p1', 'p2', 'p3', 'p4'], 'one row per pid; junk rows dropped');
  // A typed full name is ignored: the caption carries the server's name for the picked pid.
  const it = lowerThirdItem({ id: 's1', kind: 'player', title: 'John Smith', sub: 'Chip leader', pid: 'p1', entrants, durationSec: 10, programNow: 5000 });
  assert.equal(it.title, 'John S.');
  assert.equal(it.kind, 'player');
  // An opted-out player stays "Player".
  assert.equal(lowerThirdItem({ id: 's2', kind: 'player', title: 'Jane Doe', pid: 'p2', entrants }).title, 'Player');
  // No pick (or a pid not on the program) = nothing goes on air, whatever was typed.
  assert.equal(lowerThirdItem({ id: 's3', kind: 'player', title: 'John Smith', entrants }), null);
  assert.equal(lowerThirdItem({ id: 's4', kind: 'player', title: 'John Smith', pid: 'nobody', entrants }), null);
  assert.equal(lowerThirdItem({ id: 's5', kind: 'player', title: 'John Smith' }), null);
  // Other kinds keep their free text.
  assert.equal(lowerThirdItem({ id: 'h', kind: 'host', title: 'Josh' }).title, 'Josh');
  assert.deepEqual(spotlightEntrants(null), []);
  const src = fs.readFileSync(new URL('../../src/components/producer/LowerThirdComposer.jsx', import.meta.url), 'utf8');
  assert.match(src, /kind === 'player' \? \(\s*<select className="bcp-input bcp-spotlight-pick"/, 'a picker, not a text box, for the player kind');
  assert.match(src, /lowerThirdItem\(\{[^}]*pid, entrants \}\)/);
});

test('a delayed key is bound to q: or t: only', () => {
  assert.equal(delayedKeyEvent({ event: { qualifierId: 'wq-1', tournamentId: 'tq-1' } }), 'q:wq-1');
  assert.equal(delayedKeyEvent({ event: { qualifierId: null, tournamentId: 'tq-1' } }), 't:tq-1');
  assert.equal(delayedKeyEvent({ event: {} }), null);
  assert.equal(delayedKeyEvent(null), null);
});

test('live view: table summaries only, sorted, featured marked; nothing card-shaped', () => {
  const tiles = liveTiles({ tables: [
    { tableId: 't3', tableNo: 3, players: 6, handNumber: 9, pot: 900, allIn: true, biggestStack: 40000, chipLeaderHere: false, holeCards: [{ rank: 14, suit: 0 }] },
    { tableId: 't1', tableNo: 1, players: 8, handNumber: 5, pot: 100, allIn: false, biggestStack: 61200, chipLeaderHere: true },
  ] }, 't3');
  assert.deepEqual(tiles.map((t) => t.tableId), ['t1', 't3']);
  assert.equal(tiles[1].featured, true);
  assert.equal(tiles[1].allIn, true);
  assert.doesNotMatch(JSON.stringify(tiles), /holeCards|rank|suit/);
});

test('on air vs live hand numbers', () => {
  const state = { program: { table: { tableId: 'a', handNumber: 212 } }, live: { featuredLive: { tableId: 'a', handNumber: 215 } } };
  assert.equal(onAirVsLive(state), 'On air: hand #212 · live: hand #215 (3 behind)');
  assert.equal(onAirVsLive(null), '');
});

test('go-live checklist: auto items from the state, manual ticks', () => {
  const program = { event: { status: 'running' }, legal: { line: 'Free to play · Play money only · No purchase necessary · 21+ to enter.' } };
  const notReady = goLiveChecklist({ program, channel: { subscribers: { '16x9': 1, '9x16': 0 }, outputs: 1 }, stateAgeMs: 500 });
  assert.equal(notReady.ready, false);
  assert.ok(notReady.items.filter((i) => i.auto).every((i) => i.ok));
  const ready = goLiveChecklist({ program, channel: { subscribers: { '16x9': 1 } }, stateAgeMs: 500, manual: { names: true, voice: true, freeze: true, rehearsal: true } });
  assert.equal(ready.ready, true);
  const stale = goLiveChecklist({ program, channel: null, stateAgeMs: 30_000 });
  assert.equal(stale.items.find((i) => i.id === 'feed').ok, false);
  assert.equal(stale.items.find((i) => i.id === 'sources').ok, false);
});

test('lower thirds: plain, clipped, until on the program clock', () => {
  const it = lowerThirdItem({ id: 'x', kind: 'host', title: '  Josh  ', sub: 'Host', durationSec: 15, programNow: 1000 });
  assert.deepEqual(it, { id: 'x', kind: 'host', title: 'Josh', until: 16000, sub: 'Host', durationMs: 15000 });
  assert.equal(lowerThirdItem({ id: 'y', title: 'A', durationSec: 0, programNow: 1000 }).until, null);
  assert.equal(lowerThirdItem({ id: 'z', title: '   ' }), null);
  assert.equal(lowerThirdItem({ id: 'k', kind: 'evil', title: 'A' }).kind, 'info');
  const presets = lowerThirdPresets({ legal: { line: 'L 21+' } });
  assert.ok(presets.some((p) => p.title === 'L 21+'));
  assert.ok(presets.some((p) => /not sponsored, endorsed or run by Meta/.test(p.title)));
});

test('fix round 2026-11-02: the "How to enter" lower third defaults to the established qualifier wording (top 5), never "Play free at"', () => {
  const enter = (program) => lowerThirdPresets(program).find((p) => p.key === 'enter');
  for (const program of [{}, null, { event: { howToEnter: null } }, { event: { howToEnter: '   ' } }]) {
    assert.equal(enter(program).title, 'How to enter');
    assert.equal(enter(program).sub, 'Top 5 in any game gets you in · Free to play at americanpubpoker.online');
  }
  assert.doesNotMatch(JSON.stringify(lowerThirdPresets({})), /Play free at/);
  assert.equal(enter({ event: { howToEnter: ' Sign up at the bar ' } }).sub, 'Sign up at the bar', 'a set howToEnter still wins');
  // It fits a lower third (lowerThirdItem keeps 120 characters of sub).
  const item = lowerThirdItem({ id: 'enter', kind: 'info', title: 'How to enter', sub: enter({}).sub, durationSec: 0, programNow: 0 });
  assert.equal(item.sub, enter({}).sub);
  // Every preset is kept.
  assert.deepEqual(lowerThirdPresets({}).map((p) => p.key), ['host', 'enter', 'legal', 'meta', 'venue', 'player']);
});

test('scene buttons cover every contract scene; reload only from slate / break', () => {
  assert.deepEqual(SCENE_BUTTONS.map((s) => s.id).sort(),
    ['break', 'finalIntro', 'hfh', 'recap', 'results', 'room', 'slate', 'starting', 'table']);
  assert.deepEqual([...RELOAD_SCENES], ['slate', 'break']);
});

test('producer event names are the spec literals', () => {
  assert.equal(producerEvent('feature'), 'bc:producer:feature');
  assert.equal(producerEvent('setScene'), 'bc:producer:setScene');
  assert.equal(producerEvent('delayedPin'), 'bc:producer:delayedPin');
  assert.equal(producerEvent('holeCardsSwitch'), 'bc:producer:holeCardsSwitch');
  assert.equal(producerEvent('__proto__'), null);
  assert.equal(producerEvent('evil'), null);
  assert.ok(Object.values(PRODUCER_EVENTS).every((e) => e.startsWith('bc:producer:')));
});

function fakeMain() {
  const listeners = new Map();
  return {
    connected: true,
    emits: [],
    on(ev, fn) { listeners.set(ev, [...(listeners.get(ev) || []), fn]); },
    off(ev, fn) { listeners.set(ev, (listeners.get(ev) || []).filter((f) => f !== fn)); },
    emit(ev, payload, ack) { this.emits.push({ ev, payload, ack }); },
    fire(ev, ...a) { (listeners.get(ev) || []).forEach((fn) => fn(...a)); },
    count(ev) { return (listeners.get(ev) || []).length; },
  };
}

test('token on the main socket: the reply event resolves it once; the listener is removed', async () => {
  const main = fakeMain();
  const timers = makeTimers();
  const p = requestProducerToken(main, timers);
  assert.equal(main.emits[0].ev, TOKEN_EVENT);
  assert.deepEqual(main.emits[0].payload, { ev: 'ch:*', scopes: ['producer'], label: 'Producer panel', ttlHours: 2 });
  main.fire(TOKEN_REPLY_EVENT, { ok: true, token: TOKEN, jti: 'j', scopes: ['producer'], nbf: 1, exp: 2 });
  main.emits[0].ack({ ok: false, code: 'late' });
  const res = await p;
  assert.equal(res.ok, true);
  assert.equal(res.token, TOKEN);
  assert.equal(main.count(TOKEN_REPLY_EVENT), 0);
});

test('token: an ack works too; no answer in 10 s is no_answer; no socket is not_connected', async () => {
  const main = fakeMain();
  const p1 = requestProducerToken(main, makeTimers());
  main.emits[0].ack({ ok: false, code: 'issuer_is_entrant' });
  assert.deepEqual(await p1, { ok: false, code: 'issuer_is_entrant' });
  const timers = makeTimers();
  const p2 = requestProducerToken(fakeMain(), timers);
  timers.advance(10_000);
  assert.deepEqual(await p2, { ok: false, code: 'no_answer' });
  assert.deepEqual(await requestProducerToken(null), { ok: false, code: 'not_connected' });
  assert.deepEqual(await requestProducerToken({ ...fakeMain(), connected: false }), { ok: false, code: 'not_connected' });
});

test('producer socket: /broadcast with the token as the handshake key; hello + re-watch on every connect', async () => {
  const io = makeFakeIo();
  const timers = makeTimers();
  const seen = { hello: [], state: [], status: [] };
  const ps = createProducerSocket({
    io, serverUrl: 'https://srv.example', token: TOKEN, ...timers,
    on: { hello: (r) => seen.hello.push(r), state: (s) => seen.state.push(s), status: (s) => seen.status.push(s) },
  });
  const sock = io.sockets[0];
  assert.equal(sock.url, 'https://srv.example/broadcast');
  assert.deepEqual(sock.opts.auth, { key: TOKEN });
  assert.equal(sock.opts.reconnectionAttempts, Infinity);
  sock.serverConnect();
  const hello = sock.lastEmit('bc:producer:hello');
  hello.ack({ ok: true, channels: [], events: [] });
  await Promise.resolve();
  assert.equal(seen.hello[0].ok, true);
  const w = ps.watch('weekly');
  sock.lastEmit('bc:producer:watch').ack({ ok: true });
  assert.equal((await w).ok, true);
  // reconnect: hello and watch again
  sock.disconnect();
  sock.serverConnect();
  assert.equal(sock.emitsOf('bc:producer:hello').length, 2);
  assert.deepEqual(sock.lastEmit('bc:producer:watch').payload, { channel: 'weekly' });
  sock.fire('bc:producer:state', { program: { v: 1 }, live: { tables: [] } });
  assert.equal(seen.state.length, 1);
});

test('producer socket: a call with no ack in 10 s is no_answer; an unknown call never emits', async () => {
  const io = makeFakeIo();
  const timers = makeTimers();
  const ps = createProducerSocket({ io, serverUrl: 'https://srv.example', token: TOKEN, ...timers, on: {} });
  const sock = io.sockets[0];
  sock.serverConnect();
  const p = ps.call('feature', { channel: 'main', tableId: 't1', lockMinutes: 0 });
  assert.deepEqual(sock.lastEmit('bc:producer:feature').payload, { channel: 'main', tableId: 't1', lockMinutes: 0 });
  timers.advance(10_000);
  assert.deepEqual(await p, { ok: false, code: 'no_answer' });
  assert.deepEqual(await ps.call('evil', {}), { ok: false, code: 'unknown_call' });
  assert.equal(sock.emitsOf('evil').length, 0);
});

test('producer socket: a refused / expired key stops it and asks for a fresh token', async () => {
  for (const trigger of ['handshake', 'authExpired', 'ack']) {
    const io = makeFakeIo();
    const timers = makeTimers();
    const refused = [];
    const ps = createProducerSocket({ io, serverUrl: 'https://srv.example', token: TOKEN, ...timers, on: { tokenRefused: (c, via) => refused.push([c, via]) } });
    const sock = io.sockets[0];
    if (trigger === 'handshake') {
      sock.active = false;
      sock.fire('connect_error', Object.assign(new Error('x'), { data: { code: 'expired' } }));
    } else if (trigger === 'authExpired') {
      sock.serverConnect();
      sock.fire('bc:authExpired', { code: 'revoked' });
    } else {
      sock.serverConnect();
      const p = ps.call('setScene', { channel: 'main', scene: 'table' });
      sock.lastEmit('bc:producer:setScene').ack({ ok: false, code: 'not_producer' });
      assert.equal((await p).code, 'not_producer');
    }
    assert.equal(refused.length, 1, trigger);
    // Review 2026-11-02: the panel is told HOW the key was refused.
    assert.deepEqual(refused[0], { handshake: ['expired', 'handshake'], authExpired: ['revoked', 'session'], ack: ['not_producer', 'call'] }[trigger]);
    timers.advance(120_000);
    assert.equal(sock.connects, 0, `${trigger}: no retry of a dead key`);
    assert.ok(sock.disconnects >= 1, `${trigger}: the socket is closed`);
    assert.deepEqual(await ps.call('hello', {}), { ok: false, code: 'not_connected' });
  }
});

test('review 2026-11-02: retire() revokes the panel key and closes only after the server answered', async () => {
  const io = makeFakeIo();
  const timers = makeTimers();
  const refused = [];
  const ps = createProducerSocket({ io, serverUrl: 'https://srv.example', token: TOKEN, ...timers, on: { tokenRefused: (c) => refused.push(c) } });
  const sock = io.sockets[0];
  sock.serverConnect();
  const p = ps.retire({ jti: 'jti-panel-1' });
  const rev = sock.lastEmit('bc:producer:revokeKey');
  assert.deepEqual(rev.payload, { jti: 'jti-panel-1' });
  assert.equal(sock.disconnects, 0, 'not closed before the answer (the server drops a queued event after a disconnect)');
  rev.ack({ ok: true, jti: 'jti-panel-1', dropped: 1, persisted: true });
  assert.equal(await p, true);
  assert.equal(sock.disconnects, 1);
  assert.deepEqual(refused, [], 'its own revoke is not reported as a refusal');
});

test('review 2026-11-02: retire() takes the server dropping this session (bc:authExpired revoked) as the confirmation', async () => {
  const io = makeFakeIo();
  const timers = makeTimers();
  const refused = [];
  const ps = createProducerSocket({ io, serverUrl: 'https://srv.example', token: TOKEN, ...timers, on: { tokenRefused: (c) => refused.push(c) } });
  const sock = io.sockets[0];
  sock.serverConnect();
  const p = ps.retire({ jti: 'j2' });
  sock.fire('bc:authExpired', { code: 'revoked' });   // dropSessionsOf runs before the ack is sent
  assert.equal(await p, true);
  assert.deepEqual(refused, []);
});

test('review 2026-11-02: retire() gives up after 3 s, and cannot revoke while disconnected; revokeNow is fire-and-forget', async () => {
  const io = makeFakeIo();
  const timers = makeTimers();
  const ps = createProducerSocket({ io, serverUrl: 'https://srv.example', token: TOKEN, ...timers, on: {} });
  io.sockets[0].serverConnect();
  const p = ps.retire({ jti: 'j3' });
  timers.advance(3000);
  assert.equal(await p, false);
  assert.equal(io.sockets[0].disconnects, 1);
  assert.equal(await ps.retire({ jti: 'j3' }), false, 'a second retire is a no-op');

  const ps2 = createProducerSocket({ io, serverUrl: 'https://srv.example', token: TOKEN, ...timers, on: {} });
  assert.equal(await ps2.retire({ jti: 'j4' }), false, 'not connected: nothing sent');
  assert.equal(io.sockets[1].emitsOf('bc:producer:revokeKey').length, 0);

  const ps3 = createProducerSocket({ io, serverUrl: 'https://srv.example', token: TOKEN, ...timers, on: {} });
  io.sockets[2].serverConnect();
  assert.equal(ps3.revokeNow('j5'), true);
  assert.deepEqual(io.sockets[2].lastEmit('bc:producer:revokeKey').payload, { jti: 'j5' });
});

test('review 2026-11-02: ProducerPanel revokes its key on close / unmount / page leave and does not re-mint a revoked key', () => {
  const src = fs.readFileSync(new URL('../../src/components/producer/ProducerPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /sock\.retire\(\{ jti: mine \}\)/, 'cleanup (Close, unmount, renewal) revokes the key');
  assert.match(src, /addEventListener\('pagehide', onHide\)/);
  assert.match(src, /s\.revokeNow\(j\)/);
  assert.match(src, /panelTokenRefusalAction\(code, via\) === 'stop'/);
  assert.match(src, /setErrorCode\('panel_key_revoked'\)/);
  assert.match(src, /scheduleRenew\(panelRenewDelayMs\(res\)\)/, 'renewed while open');
  assert.match(src, /revokeOrphanKey\(res\)/, 'a key minted after close is revoked too');
});

const CSS = fs.readFileSync(new URL('../../src/broadcast/broadcast.css', import.meta.url), 'utf8');

test('scoped broadcast CSS for the app: no html / body / #bc-root / * rules, every rule .bc-scoped', () => {
  const out = scopeBroadcastCss(CSS);
  assert.ok(out.length > 1000);
  assert.doesNotMatch(out, /(^|[\s,}])(html|body)\s*[,{]/m);
  assert.doesNotMatch(out, /#bc-root/);
  assert.match(CSS, /html, body \{/, 'the source file does have the page rules this drops');
  // Every rule outside @keyframes / :root starts with a .bc- class.
  const noFrames = out.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const m of noFrames.matchAll(/(^|})\s*([^{}@]+?)\s*\{/g)) {
    const sel = m[2].trim();
    if (sel === ':root') continue;
    for (const part of sel.split(',')) assert.ok(isScopedSelector(part), `unscoped: ${part}`);
  }
  // :root keeps only --bc-* tokens.
  for (const m of out.matchAll(/:root\{([^}]*)\}/g)) {
    for (const d of m[1].split(';').filter((x) => x.trim())) assert.match(d.trim(), /^--bc-/);
  }
  assert.match(out, /@keyframes bc-fade-in/);
  assert.match(out, /\.bc-stage \.bc-tournament-bar\{/);
});

test('scoped CSS: mixed selector lists keep only their .bc- parts; @media recurses; @import dropped', () => {
  const out = scopeBroadcastCss('@import url(x.css);\nhtml, .bc-a { color: #fff; }\n@media (max-width: 9px) { body { x: 1 } .bc-b { y: 2 } }\n* { margin: 0 }\n:root { --bc-x: 1px; --app: 2px; }');
  assert.match(out, /^\.bc-a\{color: #fff;\}/m);
  assert.match(out, /@media \(max-width: 9px\)\{\n\.bc-b\{y: 2\}\n\}/);
  assert.doesNotMatch(out, /@import|html|body|\*|--app/);
  assert.match(out, /:root\{--bc-x: 1px;\}/);
});

test('no red in the producer panel stylesheet or components', () => {
  const dir = new URL('../../src/components/producer/', import.meta.url);
  const hits = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(css|jsx?|mjs)$/.test(name)) continue;
    const src = fs.readFileSync(new URL(name, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
    for (const m of src.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
      const n = parseInt(hex, 16);
      if (redHex((n >> 16) & 255, (n >> 8) & 255, n & 255)) hits.push(`${name}: ${m[0]}`);
    }
    for (const m of src.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
      if (redHex(+m[1], +m[2], +m[3])) hits.push(`${name}: ${m[0]}`);
    }
    if (/(color|background)[\w-]*\s*:\s*(red|crimson|firebrick|tomato|orangered)\b/i.test(src)) hits.push(`${name}: named red`);
  }
  assert.deepEqual(hits, []);
});

function redHex(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return false;
  const d = max - min;
  const l = (max + min) / 2;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  const R = r / 255; const G = g / 255; const B = b / 255;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
  else if (max === G) h = ((B - R) / d + 2) * 60;
  else h = ((R - G) / d + 4) * 60;
  return (h < 20 || h >= 340) && s >= 0.3 && l >= 0.1 && l <= 0.95;
}
