// holeCardGate — the broadcast page's second wall against a hole-card leak
// (lead spec C2; owner 2026-11-02: 5-minute delayed feed, and a hand's cards
// are never released while that hand is still live). Fail-closed in every case.
// P5-C2b (2026-11-02): delayed faces also need the frame's release mark
// (`holeCardsReleasedAt`), and a seeded fuzz proves the gate never shows a
// face on the public feed outside an ended contested showdown, nor one of an
// unreleased hand on the delayed feed.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  gateHoleCards, publicTableFrame, delayedFeedAllowsCards, effectiveFeed, isContestedShowdown,
  MIN_HOLECARD_DELAY_MS, DROPPED_LIVE_HOLE_CARDS_LOG, resetDropLog, cleanCards,
  faceUpAllowed, seatShownAtShowdown, CLOCK_GRACE_MS,
} from '../../src/broadcast/model/holeCardGate.js';
import { holeCamRows } from '../../src/broadcast/model/holeCam.js';
import { seededRandom } from '../../src/broadcast/model/equity.js';
import { initialProgramState, applySnapshot, applyFrame } from '../../src/broadcast/model/programStore.js';

const c = (rank, suit) => ({ rank, suit });
const PUBLIC = { mode: 'public', delayMs: 0, holeCards: false, policy: 'off' };
const DELAYED = { mode: 'delayed', delayMs: 5 * 60 * 1000, holeCards: true, policy: 'delayed' };
const T = 1_800_000_000_000;

function seat(i, extra = {}) {
  return { seatIndex: i, pid: `b-${String(i).padStart(16, '0')}`, name: `P${i}`, chips: 1000, bet: 0, folded: false, allIn: false, sittingOut: false, eliminated: false, hasCards: true, holeCards: null, ...extra };
}
function frame(extra = {}) {
  return { t: T, tableId: 'tb1', tableNo: 1, tableName: 'T1', maxSeats: 9, featured: true, handNumber: 7, phase: 'Flop', handLevel: { sb: 1, bb: 2, ante: 0 }, dealerSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2, activeSeat: 1, turnStartedAt: null, turnTimeout: null, pot: 10, board: [], seats: [seat(0), seat(1), seat(2)], handResult: null, liveHandEndedAt: null, ...extra };
}
function logger() { const lines = []; const fn = (...a) => lines.push(a); fn.lines = lines; return fn; }

beforeEach(() => resetDropLog());

test('the delayed floor is 5 minutes (owner 2026-11-02)', () => {
  assert.equal(MIN_HOLECARD_DELAY_MS, 300000);
});

test('public feed: live hole cards preflop are dropped, drawn as backs, and logged once per hand', () => {
  const log = logger();
  const f = frame({ phase: 'PreFlop', seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] }), seat(1), seat(2, { folded: true, hasCards: false })] });
  const g = gateHoleCards(f, PUBLIC, { log });
  assert.equal(g.seats[0].cards, null);
  assert.equal(g.seats[0].backs, 2);
  assert.equal(g.seats[0].reason, 'live_cards');
  assert.equal(g.seats[2].backs, 0);
  assert.equal(g.anyFaceUp, false);
  assert.equal(g.dropped, 1);
  gateHoleCards(f, PUBLIC, { log });
  gateHoleCards(f, PUBLIC, { log });
  assert.equal(log.lines.length, 1, 'one log line per hand, not per render');
  assert.equal(log.lines[0][0], DROPPED_LIVE_HOLE_CARDS_LOG);
  assert.equal(log.lines[0][0], '[broadcast] dropped live hole cards');
});

test('public feed: a contested showdown that has ended shows the shown hands only', () => {
  const f = frame({
    phase: 'HandComplete',
    seats: [
      seat(0, { holeCards: [c(14, 0), c(14, 1)] }),
      seat(1, { holeCards: [c(13, 0), c(12, 0)] }),
      seat(2, { mucked: true, holeCards: [c(2, 0), c(7, 1)] }),
      seat(3, { folded: true, hasCards: false, holeCards: [c(9, 0), c(9, 1)] }),
    ],
    handResult: { winners: [{ seatIndex: 0, name: 'P0', amount: 50 }], showdownSeats: [0, 1, 2], muckedSeats: [2] },
  });
  const g = gateHoleCards(f, PUBLIC, { log: logger() });
  assert.deepEqual(g.seats[0].cards, [c(14, 0), c(14, 1)]);
  assert.deepEqual(g.seats[1].cards, [c(13, 0), c(12, 0)]);
  assert.equal(g.seats[2].cards, null, 'a mucked seat is never drawn');
  assert.equal(g.seats[3].cards, null, 'a folded seat is never drawn on the public feed');
  assert.equal(g.anyFaceUp, true);
});

test('public feed: an uncontested win (one showdown seat) shows nothing', () => {
  const f = frame({ phase: 'HandComplete', seats: [seat(0, { holeCards: [c(14, 0), c(14, 1)] })], handResult: { winners: [{ seatIndex: 0, amount: 9 }], showdownSeats: [0], muckedSeats: [] } });
  assert.equal(isContestedShowdown(f), false);
  assert.equal(gateHoleCards(f, PUBLIC, { log: logger() }).seats[0].cards, null);
});

test('public feed: showdown phase WITHOUT a handResult (hand not over) shows nothing', () => {
  const f = frame({ phase: 'Showdown', seats: [seat(0, { holeCards: [c(14, 0), c(14, 1)] }), seat(1, { holeCards: [c(2, 0), c(3, 0)] })], handResult: null });
  const g = gateHoleCards(f, PUBLIC, { log: logger() });
  assert.equal(g.anyFaceUp, false);
});

test('public feed: muckedSeats alone (no seat.mucked flag) also hides', () => {
  const f = frame({ phase: 'Showdown', seats: [seat(0, { holeCards: [c(14, 0), c(14, 1)] }), seat(1, { holeCards: [c(2, 0), c(3, 0)] })], handResult: { winners: [], showdownSeats: [0, 1], muckedSeats: [1] } });
  const g = gateHoleCards(f, PUBLIC, { log: logger() });
  assert.ok(g.seats[0].cards);
  assert.equal(g.seats[1].cards, null);
});

// Review 2026-11-02 — poker-server's real shape for a showdown the loser mucks
// (broadcastFrame.ts showdownReveal): showdownSeats = the TABLED hands only,
// muckedSeats = the hands mucked at the showdown. Two hands reached the
// showdown, so the table gate (wentToShowdown) shows the winner's cards.
test('public feed: a showdown where the loser MUCKS shows the tabled winner, hides the muck, and raises no leak alarm', () => {
  const log = logger();
  const f = frame({
    phase: 'HandComplete',
    seats: [
      seat(0, { holeCards: [c(14, 0), c(13, 0)], handName: 'Flush' }),
      seat(1, { mucked: true, holeCards: null }),
      seat(2, { folded: true, hasCards: false }),
    ],
    handResult: { winners: [{ seatIndex: 0, name: 'P0', amount: 12400, handName: 'Flush' }], showdownSeats: [0], muckedSeats: [1] },
  });
  assert.equal(isContestedShowdown(f), true);
  const g = gateHoleCards(f, PUBLIC, { log });
  assert.deepEqual(g.seats[0].cards, [c(14, 0), c(13, 0)], 'the winner line names a Flush: the Flush is shown');
  assert.equal(g.seats[0].reason, 'showdown');
  assert.equal(g.seats[1].cards, null);
  assert.equal(g.dropped, 0);
  const kept = publicTableFrame(f, { log });
  assert.deepEqual(kept.seats[0].holeCards, [c(14, 0), c(13, 0)], 'the store keeps the tabled hand');
  assert.equal(log.lines.length, 0, 'no "[broadcast] dropped live hole cards" for a legitimate frame');
});

test('public feed: a folded seat (or one not in the frame) listed as mucked never makes a pot contested', () => {
  const winnerOnly = (extra) => frame({
    phase: 'HandComplete',
    seats: [seat(0, { holeCards: [c(14, 0), c(14, 1)] }), seat(1, { folded: true, hasCards: false })],
    handResult: { winners: [{ seatIndex: 0, amount: 9 }], showdownSeats: [0], muckedSeats: [], ...extra },
  });
  for (const f of [winnerOnly({ muckedSeats: [1] }), winnerOnly({ muckedSeats: [7] }), winnerOnly({ muckedSeats: [0] })]) {
    assert.equal(isContestedShowdown(f), false, JSON.stringify(f.handResult));
    assert.equal(gateHoleCards(f, PUBLIC, { log: logger() }).seats[0].cards, null);
  }
  const foldedFlag = frame({
    phase: 'HandComplete',
    seats: [seat(0, { holeCards: [c(14, 0), c(14, 1)] }), seat(1, { folded: true, mucked: true, hasCards: false })],
    handResult: { winners: [{ seatIndex: 0, amount: 9 }], showdownSeats: [0], muckedSeats: [] },
  });
  assert.equal(isContestedShowdown(foldedFlag), false);
  // Still nothing before the hand is over, even with a muck listed.
  const live = frame({ phase: 'River', seats: [seat(0, { holeCards: [c(14, 0), c(14, 1)] }), seat(1, { mucked: true })], handResult: { winners: [], showdownSeats: [0], muckedSeats: [1] } });
  assert.equal(gateHoleCards(live, PUBLIC, { log: logger() }).anyFaceUp, false);
});

test('delayed feed: a hand that has ended live, past the 5-minute delay, shows every dealt seat', () => {
  const f = frame({ t: T, liveHandEndedAt: T + 30000, holeCardsReleasedAt: T + DELAYED.delayMs, seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] }), seat(1, { folded: true, holeCards: [c(5, 1), c(4, 1)] })] });
  const g = gateHoleCards(f, DELAYED, { serverNow: T + DELAYED.delayMs + 1, log: logger() });
  assert.equal(g.mode, 'delayed');
  assert.deepEqual(g.seats[0].cards, [c(14, 0), c(13, 0)]);
  assert.deepEqual(g.seats[1].cards, [c(5, 1), c(4, 1)]);
});

test('delayed feed: the delayed feed reaching a hand that is STILL LIVE shows backs only (owner HARD RULE)', () => {
  const log = logger();
  const f = frame({ t: T, liveHandEndedAt: null, seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] }), seat(1, { holeCards: [c(2, 0), c(2, 1)] })] });
  const g = gateHoleCards(f, DELAYED, { serverNow: T + 60 * 60 * 1000, log });
  assert.equal(g.anyFaceUp, false);
  assert.equal(g.seats[0].cards, null);
  assert.equal(g.seats[0].backs, 2);
  assert.equal(g.seats[0].reason, 'hand_live');
  assert.equal(log.lines.length, 1, 'a delayed frame with cards for a live hand is a server leak: logged');
});

test('delayed feed: hand ended live in the FUTURE of our clock is held (backs), recheck at that time', () => {
  const f = frame({ t: T, liveHandEndedAt: T + DELAYED.delayMs + 10_000, holeCardsReleasedAt: T + DELAYED.delayMs + 10_000, seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] })] });
  const now = T + DELAYED.delayMs + 1000;
  const g = gateHoleCards(f, DELAYED, { serverNow: now, log: logger() });
  assert.equal(g.seats[0].cards, null);
  assert.equal(g.seats[0].reason, 'hand_live');
  assert.equal(g.recheckAt, T + DELAYED.delayMs + 10_000);
  const later = gateHoleCards(f, DELAYED, { serverNow: T + DELAYED.delayMs + 10_000, log: logger() });
  assert.ok(later.seats[0].cards, 'shown once the hand has ended live and the delay has passed');
});

test('delayed feed: the delay has not passed since the frame -> backs', () => {
  const f = frame({ t: T, liveHandEndedAt: T + 1000, seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] })] });
  const g = gateHoleCards(f, DELAYED, { serverNow: T + DELAYED.delayMs - 60_000, log: logger() });
  assert.equal(g.seats[0].cards, null);
  assert.equal(g.seats[0].reason, 'delay_pending');
  assert.equal(g.seats[0].backs, 2);
});

test('delayed feed: within clock skew of the release it is held silently (no log)', () => {
  const log = logger();
  const f = frame({ t: T, liveHandEndedAt: T + 1000, seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] })] });
  gateHoleCards(f, DELAYED, { serverNow: T + DELAYED.delayMs - 500, log });
  assert.equal(log.lines.length, 0);
});

test('delayed feed: no server clock yet -> nothing face up', () => {
  const f = frame({ t: T, liveHandEndedAt: T + 1000, seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] })] });
  assert.equal(gateHoleCards(f, DELAYED, { serverNow: NaN, log: logger() }).anyFaceUp, false);
  assert.equal(gateHoleCards(f, DELAYED, { log: logger() }).anyFaceUp, false);
});

test('delayed feed: every entitlement condition is required (fail closed)', () => {
  const f = frame({ t: T, liveHandEndedAt: T + 1000, holeCardsReleasedAt: T + 30 * 60 * 1000, seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] })] });
  const now = T + 60 * 60 * 1000;
  const cases = [
    { ...DELAYED, delayMs: MIN_HOLECARD_DELAY_MS - 1 },       // below the 5-minute floor
    { ...DELAYED, holeCards: false },
    { ...DELAYED, policy: 'off' },
    { ...DELAYED, policy: 'whatever' },
    { ...DELAYED, mode: 'public' },
    { ...DELAYED, delayMs: Number.NaN },
    null,
    undefined,
    'delayed',
  ];
  for (const feed of cases) {
    const g = gateHoleCards(f, feed, { serverNow: now, log: logger() });
    assert.equal(g.anyFaceUp, false, `feed ${JSON.stringify(feed)} must not show cards`);
  }
  // not the featured table
  assert.equal(gateHoleCards({ ...f, featured: false }, DELAYED, { serverNow: now, log: logger() }).anyFaceUp, false);
  assert.equal(gateHoleCards({ ...f, featured: undefined }, DELAYED, { serverNow: now, log: logger() }).anyFaceUp, false);
  // a longer configured delay works
  assert.equal(gateHoleCards(f, { ...DELAYED, delayMs: 30 * 60 * 1000 }, { serverNow: now, log: logger() }).anyFaceUp, true);
  // after_event policy follows the same rule
  assert.equal(gateHoleCards(f, { ...DELAYED, policy: 'after_event' }, { serverNow: now, log: logger() }).anyFaceUp, true);
  assert.equal(delayedFeedAllowsCards(DELAYED), true);
});

test('malformed cards are never drawn', () => {
  const bad = [[{ rank: 1, suit: 0 }, c(2, 0)], [c(14, 4), c(2, 0)], [{ rank: 'A', suit: 'h' }], [c(14, 0), null], 'AhKh', [c(2, 0), c(3, 0), c(4, 0), c(5, 0), c(6, 0), c(7, 0), c(8, 0)]];
  for (const holeCards of bad) {
    const f = frame({ t: T, liveHandEndedAt: T, seats: [seat(0, { holeCards })] });
    assert.equal(gateHoleCards(f, DELAYED, { serverNow: T + 3_600_000, log: logger() }).anyFaceUp, false);
  }
  assert.equal(cleanCards([c(14, 0), c(13, 1)]).length, 2);
  // copies only rank / suit
  assert.deepEqual(cleanCards([{ rank: 14, suit: 0, display: 'A♥', extra: 1 }]), [c(14, 0)]);
});

test('effectiveFeed takes the stricter of snapshot.feed and program.feed', () => {
  assert.equal(effectiveFeed(DELAYED, PUBLIC).mode, 'public');
  assert.equal(effectiveFeed(DELAYED, { ...DELAYED, holeCards: false }).holeCards, false);
  assert.equal(effectiveFeed(DELAYED, { ...DELAYED, delayMs: 600000 }).delayMs, 300000);
  assert.equal(effectiveFeed(DELAYED, { ...DELAYED, policy: 'after_event' }).policy, 'off');
  assert.equal(effectiveFeed(null, null).mode, 'public');
  assert.deepEqual(effectiveFeed(DELAYED, undefined), DELAYED);
});

test('publicTableFrame strips every card the public rule does not show, without mutating', () => {
  const f = frame({ phase: 'Turn', seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] }), seat(1)] });
  const out = publicTableFrame(f, { log: logger() });
  assert.notEqual(out, f);
  assert.equal(out.seats[0].holeCards, null);
  assert.deepEqual(f.seats[0].holeCards, [c(14, 0), c(13, 0)], 'input untouched');
  const clean = frame();
  assert.equal(publicTableFrame(clean, { log: logger() }), clean, 'unchanged frame returned as is');
});

test('holeCamRows: public = shown hands only, winners first; delayed = live seats with faces or backs', () => {
  const f = frame({
    phase: 'HandComplete',
    seats: [seat(0, { holeCards: [c(13, 0), c(12, 0)] }), seat(1, { holeCards: [c(14, 0), c(14, 1)] }), seat(2, { folded: true, hasCards: false })],
    handResult: { winners: [{ seatIndex: 1, amount: 50, handName: 'Pair of Aces' }], showdownSeats: [0, 1], muckedSeats: [] },
  });
  const rows = holeCamRows(f, gateHoleCards(f, PUBLIC, { log: logger() }));
  assert.deepEqual(rows.map((r) => r.seat.seatIndex), [1, 0]);
  assert.equal(rows[0].winner, true);

  const live = frame({ t: T, liveHandEndedAt: null, seats: [seat(0, { holeCards: [c(2, 0), c(3, 0)] }), seat(1, { folded: true, holeCards: [c(4, 0), c(5, 0)] })] });
  const lrows = holeCamRows(live, gateHoleCards(live, DELAYED, { serverNow: T + 3_600_000, log: logger() }));
  assert.equal(lrows.length, 1, 'a folded seat leaves the hole cam');
  assert.equal(lrows[0].faceUp, false);
  assert.equal(lrows[0].decision.backs, 2);

  const ended = { ...live, liveHandEndedAt: T + 1000, holeCardsReleasedAt: T + DELAYED.delayMs };
  const erows = holeCamRows(ended, gateHoleCards(ended, DELAYED, { serverNow: T + 3_600_000, log: logger() }));
  assert.deepEqual(erows.map((r) => [r.seat.seatIndex, r.faceUp]), [[0, true]], 'face up, and the folded seat still leaves the strip');
});

test('a public frame with no cards anywhere renders no hole cam', () => {
  const f = frame();
  assert.deepEqual(holeCamRows(f, gateHoleCards(f, PUBLIC, { log: logger() })), []);
  assert.deepEqual(holeCamRows(null, null), []);
});

// ── P5-C2b (2026-11-02): the frame must MARK the hand's cards as released ──

const ENDED_AND_DUE = { t: T, liveHandEndedAt: T + 1000 };
const NOW_AFTER = T + DELAYED.delayMs + 60_000;

test('delayed feed: hand ended live and delay passed, but NO release mark -> backs, logged once per hand', () => {
  const log = logger();
  const f = frame({ ...ENDED_AND_DUE, seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] }), seat(1, { holeCards: [c(9, 2), c(9, 3)] })] });
  for (const mark of [undefined, null, Number.NaN, '1800000300000', {}]) {
    const g = gateHoleCards({ ...f, holeCardsReleasedAt: mark }, DELAYED, { serverNow: NOW_AFTER, log });
    assert.equal(g.anyFaceUp, false, `mark ${String(mark)}`);
    assert.equal(g.seats[0].reason, 'not_released');
    assert.equal(g.seats[0].backs, 2, 'a held seat is card backs');
  }
  assert.equal(log.lines.length, 1, 'a delayed frame with cards and no release mark is a server leak: logged once');
  assert.equal(log.lines[0][1].reason, 'not_released');
});

test('delayed feed: a release mark earlier than the live end or than t + delay is refused (server stamped early)', () => {
  const seats = [seat(0, { holeCards: [c(14, 0), c(13, 0)] })];
  const early = [
    frame({ t: T, liveHandEndedAt: T + DELAYED.delayMs + 5000, holeCardsReleasedAt: T + DELAYED.delayMs, seats }),   // before the hand ended live
    frame({ t: T, liveHandEndedAt: T + 1000, holeCardsReleasedAt: T + DELAYED.delayMs - 1, seats }),                  // before the delay passed
  ];
  for (const f of early) {
    const g = gateHoleCards(f, DELAYED, { serverNow: T + 3_600_000, log: logger() });
    assert.equal(g.anyFaceUp, false);
    assert.equal(g.seats[0].reason, 'not_released');
  }
  const ok = frame({ t: T, liveHandEndedAt: T + DELAYED.delayMs + 5000, holeCardsReleasedAt: T + DELAYED.delayMs + 5000, seats });
  assert.deepEqual(gateHoleCards(ok, DELAYED, { serverNow: T + 3_600_000, log: logger() }).seats[0].cards, [c(14, 0), c(13, 0)]);
});

test('delayed feed: a release mark ahead of our clock is held (silently within clock skew) and rechecked at the mark', () => {
  const seats = [seat(0, { holeCards: [c(14, 0), c(13, 0)] })];
  const due = T + DELAYED.delayMs;
  const near = frame({ ...ENDED_AND_DUE, holeCardsReleasedAt: due + 1500, seats });
  const quiet = logger();
  const g1 = gateHoleCards(near, DELAYED, { serverNow: due, log: quiet });
  assert.equal(g1.anyFaceUp, false);
  assert.equal(g1.recheckAt, due + 1500);
  assert.equal(quiet.lines.length, 0, 'within the clock grace: no log');
  const far = frame({ ...ENDED_AND_DUE, handNumber: 8, holeCardsReleasedAt: due + CLOCK_GRACE_MS + 60_000, seats });
  const loud = logger();
  assert.equal(gateHoleCards(far, DELAYED, { serverNow: due, log: loud }).anyFaceUp, false);
  assert.equal(loud.lines.length, 1);
  assert.ok(gateHoleCards(near, DELAYED, { serverNow: due + 1500, log: logger() }).anyFaceUp, 'shown once the mark is reached');
});

test('public feed: a frame carrying liveHandEndedAt + a release mark still shows no live cards', () => {
  const f = frame({ ...ENDED_AND_DUE, phase: 'Turn', holeCardsReleasedAt: T + DELAYED.delayMs, seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] })] });
  for (const feed of [PUBLIC, { ...DELAYED, mode: 'public' }, { ...DELAYED, holeCards: false }, { ...DELAYED, policy: 'off' }]) {
    const g = gateHoleCards(f, feed, { serverNow: NOW_AFTER, log: logger() });
    assert.equal(g.anyFaceUp, false, JSON.stringify(feed));
  }
  assert.equal(publicTableFrame(f, { log: logger() }).seats[0].holeCards, null);
});

// ── seeded fuzz: the invariant over thousands of frames ────────────────────

const FUZZ_PHASES = ['WaitingForPlayers', 'PreFlop', 'Flop', 'Turn', 'River', 'Showdown', 'HandComplete'];
const FUZZ_FEEDS = [
  PUBLIC,
  DELAYED,
  { ...DELAYED, delayMs: 30 * 60 * 1000 },
  { ...DELAYED, policy: 'after_event' },
  { ...DELAYED, holeCards: false },
  { ...DELAYED, delayMs: MIN_HOLECARD_DELAY_MS - 1000 },
  { ...DELAYED, policy: 'off' },
  { ...PUBLIC, holeCards: true },
];

function fuzzFrame(rand, i) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const maybe = (p) => rand() < p;
  const card = () => c(2 + Math.floor(rand() * 13), Math.floor(rand() * 4));
  const t = T + Math.floor(rand() * 3_600_000);
  const n = 2 + Math.floor(rand() * 8);
  const seats = [];
  for (let s = 0; s < n; s += 1) {
    seats.push(seat(s, {
      folded: maybe(0.3),
      hasCards: maybe(0.9),
      eliminated: maybe(0.05),
      ...(maybe(0.1) ? { mucked: true } : {}),
      holeCards: maybe(0.85) ? (maybe(0.03) ? [card()] : [card(), card()]) : null,
    }));
  }
  const showdownSeats = seats.filter(() => maybe(0.5)).map((s) => s.seatIndex);
  const handResult = maybe(0.4)
    ? { winners: showdownSeats.slice(0, 1).map((x) => ({ seatIndex: x, name: 'W', amount: 10 })), showdownSeats, muckedSeats: showdownSeats.filter(() => maybe(0.2)) }
    : null;
  const delay = pick([MIN_HOLECARD_DELAY_MS, 30 * 60 * 1000]);
  const ended = pick([null, undefined, Number.NaN, t - 5000, t + Math.floor(rand() * 1_200_000)]);
  const due = t + delay;
  const fin = Number.isFinite(ended) ? Math.max(ended, due) : due;
  const holeCardsReleasedAt = pick([undefined, null, fin, fin + Math.floor(rand() * 60_000), fin - 1 - Math.floor(rand() * 60_000), t, Number.NaN]);
  return frame({ t, handNumber: i, phase: pick(FUZZ_PHASES), seats, handResult, liveHandEndedAt: ended, holeCardsReleasedAt, featured: maybe(0.85) });
}

test('fuzz (seeded, 6,000 frames): no face on the public feed outside an ended contested showdown; none of an unreleased hand', () => {
  const rand = seededRandom('holeCardGate:fuzz:2026-11-02');
  const quiet = () => {};
  const seen = { showdown: 0, delayed: 0, heldDelayed: 0, publicLeaksStripped: 0 };
  for (let i = 0; i < 6000; i += 1) {
    const f = fuzzFrame(rand, i);
    const feed = FUZZ_FEEDS[Math.floor(rand() * FUZZ_FEEDS.length)];
    const serverNow = rand() < 0.03 ? Number.NaN : f.t + Math.floor(rand() * 2_400_000) - 60_000;
    const g = gateHoleCards(f, feed, { serverNow, log: quiet });
    const entitled = delayedFeedAllowsCards(feed) && f.featured === true;
    for (const s of f.seats) {
      const d = g.seats[s.seatIndex];
      if (!d) continue;
      if (!d.cards) {
        if (d.reason === 'not_released' || d.reason === 'hand_live' || d.reason === 'delay_pending') seen.heldDelayed += 1;
        continue;
      }
      // Whatever is face up is this seat's own (clean) cards, never another's.
      assert.deepEqual(d.cards, cleanCards(s.holeCards));
      assert.equal(faceUpAllowed(f, feed, s, serverNow), true, `frame ${i} seat ${s.seatIndex}`);
      if (d.reason === 'showdown') {
        seen.showdown += 1;
        assert.ok(f.handResult && isContestedShowdown(f) && seatShownAtShowdown(f, s));
        continue;
      }
      // Any other face is the DELAYED rule, fully proven at serverNow.
      seen.delayed += 1;
      assert.equal(d.reason, 'delayed');
      assert.ok(entitled, `frame ${i}: delayed face without the delayed entitlement`);
      assert.ok(Number.isFinite(serverNow));
      assert.ok(Number.isFinite(f.liveHandEndedAt) && f.liveHandEndedAt <= serverNow, 'the hand has ended live');
      assert.ok(f.t + feed.delayMs <= serverNow, 'the delay has passed since the frame');
      assert.ok(feed.delayMs >= MIN_HOLECARD_DELAY_MS);
      const rel = f.holeCardsReleasedAt;
      assert.ok(Number.isFinite(rel) && rel >= f.liveHandEndedAt && rel >= f.t + feed.delayMs && rel <= serverNow, 'released by the server');
    }
    // The store's public pass leaves nothing but showdown cards on a public feed.
    if (feed.mode === 'public' || !delayedFeedAllowsCards(feed)) {
      const stripped = publicTableFrame(f, { log: quiet });
      for (const s of stripped.seats) {
        if (s.holeCards !== null && s.holeCards !== undefined) assert.ok(seatShownAtShowdown(stripped, s), `frame ${i}: public store kept a live card`);
      }
      if (stripped !== f) seen.publicLeaksStripped += 1;
    }
  }
  // Not vacuous: every branch was exercised.
  assert.ok(seen.showdown > 50, JSON.stringify(seen));
  assert.ok(seen.delayed > 50, JSON.stringify(seen));
  assert.ok(seen.heldDelayed > 200, JSON.stringify(seen));
  assert.ok(seen.publicLeaksStripped > 200, JSON.stringify(seen));
});

test('programStore on a PUBLIC feed: a snapshot and frames with leaked cards keep only showdown cards', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const leak = frame({ phase: 'River', ...ENDED_AND_DUE, holeCardsReleasedAt: T + DELAYED.delayMs, seats: [seat(0, { holeCards: [c(14, 0), c(13, 0)] }), seat(1, { holeCards: [c(2, 0), c(2, 1)] })] });
    let s = applySnapshot(initialProgramState(), { v: 1, seq: 1, serverNow: NOW_AFTER, feed: PUBLIC, program: null, table: leak }, 0);
    assert.ok(s.table.seats.every((x) => x.holeCards === null));
    s = applyFrame(s, { v: 1, seq: 2, kind: 'table', table: { ...leak, handNumber: 9 } }, 1);
    assert.ok(s.table.seats.every((x) => x.holeCards === null));
  } finally { console.warn = warn; }
});
