// Broadcast program store (lead spec §3 / R10): snapshot then frames replace,
// stale seqs are ignored, a gap asks for a resync, buffers stay bounded, an
// unknown contract version shows the slate, and a public feed never keeps a
// live hole card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialProgramState, applySnapshot, applyFrame, applyHeartbeat, markResyncSent,
  estimateServerNow, estimateProgramNow, reduceProgram, TICKER_MAX, EVENTS_MAX, RESYNC_LOG,
} from '../../src/broadcast/model/programStore.js';

const PUBLIC = { mode: 'public', delayMs: 0, holeCards: false, policy: 'off' };
const DELAYED = { mode: 'delayed', delayMs: 300000, holeCards: true, policy: 'delayed' };
const program = (extra = {}) => ({ v: 1, channel: 'main', eventKey: 'next:weekly', onAir: true, rehearsal: false, programNow: 5000, scene: { id: 'table', auto: true, since: 0 }, ticker: [], ...extra });
const seat = (i, extra = {}) => ({ seatIndex: i, name: `P${i}`, chips: 1, bet: 0, folded: false, allIn: false, sittingOut: false, eliminated: false, hasCards: true, holeCards: null, ...extra });
const table = (extra = {}) => ({ t: 1, tableId: 'tb', featured: true, handNumber: 3, phase: 'Flop', seats: [seat(0), seat(1)], handResult: null, ...extra });
const snap = (extra = {}) => ({ v: 1, seq: 10, serverNow: 100000, feed: PUBLIC, program: program(), table: table(), ...extra });

test('a snapshot replaces everything and sets the clock', () => {
  const s = applySnapshot(initialProgramState(), snap(), 40000);
  assert.equal(s.ready, true);
  assert.equal(s.seq, 10);
  assert.equal(s.skewMs, 60000);
  assert.equal(estimateServerNow(s, 41000), 101000);
  assert.equal(estimateProgramNow(s, 41000), 6000);
  assert.equal(s.onAir, true);
});

test('frames apply in order; a frame at or below the seq is ignored', () => {
  let s = applySnapshot(initialProgramState(), snap(), 0);
  s = applyFrame(s, { v: 1, seq: 11, kind: 'program', program: program({ onAir: false }) }, 1);
  assert.equal(s.seq, 11);
  assert.equal(s.onAir, false);
  const same = applyFrame(s, { v: 1, seq: 11, kind: 'program', program: program({ onAir: true }) }, 2);
  assert.equal(same, s, 'duplicate seq ignored');
  const older = applyFrame(s, { v: 1, seq: 5, kind: 'table', table: table({ handNumber: 99 }) }, 3);
  assert.equal(older, s, 'a frame older than the snapshot is ignored');
});

test('frames replace, never merge', () => {
  let s = applySnapshot(initialProgramState(), snap(), 0);
  s = applyFrame(s, { v: 1, seq: 11, kind: 'table', table: { t: 2, tableId: 'tb2', featured: true, handNumber: 1, phase: 'PreFlop', seats: [seat(4)], handResult: null } }, 1);
  assert.equal(s.table.tableId, 'tb2');
  assert.deepEqual(s.table.seats.map((x) => x.seatIndex), [4]);
});

test('a seq gap marks needsResync (and still applies the newer frame)', () => {
  let s = applySnapshot(initialProgramState(), snap(), 0);
  s = applyFrame(s, { v: 1, seq: 13, kind: 'program', program: program({ rehearsal: true }) }, 1);
  assert.equal(s.needsResync, true);
  assert.equal(s.resyncReason, 'seq_gap');
  assert.equal(s.program.rehearsal, true);
  s = markResyncSent(s);
  assert.equal(s.needsResync, false);
  assert.equal(RESYNC_LOG, '[broadcast] resync');
});

test('a heartbeat ahead of our seq asks for a resync; it updates the clock and onAir', () => {
  let s = applySnapshot(initialProgramState(), snap(), 0);
  s = applyHeartbeat(s, { seq: 10, serverNow: 200000, programNow: 199000, delayMs: 0, onAir: false }, 50000);
  assert.equal(s.needsResync, false);
  assert.equal(s.onAir, false);
  assert.equal(estimateServerNow(s, 51000), 201000);
  s = applyHeartbeat(s, { seq: 12, serverNow: 202000, programNow: 201000, delayMs: 0, onAir: true }, 52000);
  assert.equal(s.needsResync, true);
  assert.equal(s.resyncReason, 'heartbeat_ahead');
});

test('an unknown major version is unsupported (the page shows the slate)', () => {
  const s = applySnapshot(initialProgramState(), snap({ v: 2 }), 0);
  assert.equal(s.unsupported, true);
  assert.equal(s.ready, false);
  let ok = applySnapshot(initialProgramState(), snap(), 0);
  ok = applyFrame(ok, { v: 3, seq: 11, kind: 'program', program: program() }, 1);
  assert.equal(ok.unsupported, true);
});

test('buffers stay bounded after 100k frames (a 6-hour run)', () => {
  let s = applySnapshot(initialProgramState(), snap(), 0);
  const ticker = Array.from({ length: 80 }, (_, i) => ({ id: `t${i}`, t: i, kind: 'bust' }));
  for (let i = 0; i < 100000; i += 1) {
    const seq = 11 + i;
    if (i % 3 === 0) s = applyFrame(s, { seq, kind: 'event', event: { id: `e${i}`, t: i, kind: 'bust' } }, i);
    else if (i % 3 === 1) s = applyFrame(s, { seq, kind: 'program', program: program({ ticker }) }, i);
    else s = applyFrame(s, { seq, kind: 'table', table: table({ handNumber: i }) }, i);
  }
  assert.equal(s.events.length, EVENTS_MAX);
  assert.equal(s.program.ticker.length, TICKER_MAX);
  assert.equal(s.seq, 100010);
  assert.equal(s.needsResync, false);
});

test('event frames de-duplicate by id', () => {
  let s = applySnapshot(initialProgramState(), snap(), 0);
  s = applyFrame(s, { seq: 11, kind: 'event', event: { id: 'a', kind: 'bust' } }, 1);
  s = applyFrame(s, { seq: 12, kind: 'event', event: { id: 'a', kind: 'bust' } }, 2);
  assert.equal(s.events.length, 1);
});

test('PUBLIC feed: a live hole card never survives into the store', () => {
  let s = applySnapshot(initialProgramState(), snap({ table: table({ seats: [seat(0, { holeCards: [{ rank: 14, suit: 0 }, { rank: 13, suit: 0 }] })] }) }), 0);
  assert.equal(s.table.seats[0].holeCards, null);
  s = applyFrame(s, { seq: 11, kind: 'table', table: table({ phase: 'River', seats: [seat(0, { holeCards: [{ rank: 2, suit: 1 }, { rank: 3, suit: 1 }] })] }) }, 1);
  assert.equal(s.table.seats[0].holeCards, null);
});

test('PUBLIC feed: a contested-showdown hand survives into the store', () => {
  const t = table({ phase: 'HandComplete', seats: [seat(0, { holeCards: [{ rank: 14, suit: 0 }, { rank: 13, suit: 0 }] }), seat(1, { holeCards: [{ rank: 2, suit: 1 }, { rank: 3, suit: 1 }] })], handResult: { winners: [], showdownSeats: [0, 1], muckedSeats: [] } });
  const s = applySnapshot(initialProgramState(), snap({ table: t }), 0);
  assert.equal(s.table.seats[0].holeCards.length, 2);
});

test('DELAYED feed: cards are kept for the render-time gate; the delay sets the program clock', () => {
  const t = table({ seats: [seat(0, { holeCards: [{ rank: 14, suit: 0 }, { rank: 13, suit: 0 }] })] });
  const s = applySnapshot(initialProgramState(), snap({ feed: DELAYED, table: t, program: program({ programNow: undefined }) }), 0);
  assert.equal(s.feed.mode, 'delayed');
  assert.equal(s.delayMs, 300000);
  assert.equal(s.table.seats[0].holeCards.length, 2);
  assert.equal(estimateProgramNow(s, 0), 100000 - 300000);
});

test('a program frame can only make the feed stricter', () => {
  let s = applySnapshot(initialProgramState(), snap({ feed: DELAYED }), 0);
  s = applyFrame(s, { seq: 11, kind: 'program', program: program({ feed: PUBLIC }) }, 1);
  assert.equal(s.feed.mode, 'public');
  let p = applySnapshot(initialProgramState(), snap(), 0);
  p = applyFrame(p, { seq: 11, kind: 'program', program: program({ feed: DELAYED }) }, 1);
  assert.equal(p.feed.mode, 'public', 'a program frame cannot turn a public stream into a delayed one');
});

test('an unknown scene id is read as the slate; frames before a snapshot are ignored', () => {
  const s = applySnapshot(initialProgramState(), snap({ program: program({ scene: { id: 'casino', auto: true, since: 0 } }) }), 0);
  assert.equal(s.program.scene.id, 'slate');
  const before = initialProgramState();
  assert.equal(applyFrame(before, { seq: 1, kind: 'program', program: program() }, 0), before);
  assert.equal(reduceProgram(before, { type: 'nope' }), before);
});
