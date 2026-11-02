// Broadcast win % (lead spec R8 / P5-C2b, 2026-11-02): model/equity.js is
// DETERMINISTIC (seeded by tableId:handNumber:street, so the 16:9 and 9:16
// sources print the same number), EXACT on the turn and river (and the flop),
// checked against hand-counted boards and an independent brute-force
// evaluator, and it runs ONLY on the gate's delayed faces (never seat.holeCards).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeEquity, equityForFrame, evaluateCards, categoryOf, seededRandom, equitySeed, streetOf,
  formatEquity, resetEquityCache, samplesFor, cardIndex,
} from '../../src/broadcast/model/equity.js';
import { gateHoleCards, resetDropLog } from '../../src/broadcast/model/holeCardGate.js';
import { holeCamRows, holeCamEquityText } from '../../src/broadcast/model/holeCam.js';
import { initialProgramState, applySnapshot } from '../../src/broadcast/model/programStore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const c = (rank, suit) => ({ rank, suit });
// Suits are 0..3; the names below are only for reading (h = 0, s = 1, d = 2, c = 3).
const [H, S, D, C] = [0, 1, 2, 3];
const quiet = () => {};

beforeEach(() => { resetEquityCache(); resetDropLog(); });

// ── determinism ────────────────────────────────────────────────────────────

test('seededRandom: the same seed gives the same sequence; another seed does not', () => {
  const a = seededRandom('tbl-1:212:preflop');
  const b = seededRandom('tbl-1:212:preflop');
  const x = seededRandom('tbl-1:213:preflop');
  const sa = Array.from({ length: 50 }, () => a());
  const sb = Array.from({ length: 50 }, () => b());
  const sx = Array.from({ length: 50 }, () => x());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sx);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
  assert.equal(equitySeed('tbl-1', 212, 'preflop'), 'tbl-1:212:preflop');
});

test('preflop Monte Carlo is deterministic across two runs (and two pages), and the seed is what drives it', () => {
  const hands = [[c(14, H), c(14, S)], [c(13, D), c(13, C)], [c(9, H), c(8, H)]];
  const seed = equitySeed('tbl-fixture-2', 212, 'preflop');
  const run1 = computeEquity({ hands, board: [], seed });
  const run2 = computeEquity({ hands, board: [], seed });
  assert.equal(run1.exact, false);
  assert.equal(run1.runouts, samplesFor(3));
  assert.deepEqual(run1, run2, 'identical to the last digit');
  const other = computeEquity({ hands, board: [], seed: equitySeed('tbl-fixture-2', 213, 'preflop') });
  assert.notDeepEqual(run1.equity, other.equity, 'a different hand number is a different (still deterministic) sample');
  const sum = run1.equity.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, 'equity shares sum to 1');
});

test('preflop Monte Carlo lands within 1% of the exact 1.7M-board count (heads-up)', () => {
  // Exact values from a full enumeration of all C(48,5) boards (2026-11-02,
  // scratch brute force with this evaluator; they match the published odds):
  // AA v KK (no shared suit) 81.255%, AKs v QQ 46.214%, 72o v AKo 32.998%.
  const cases = [
    [[c(14, H), c(14, S)], [c(13, D), c(13, C)], 0.81255],
    [[c(14, D), c(13, D)], [c(12, H), c(12, S)], 0.46214],
    [[c(7, H), c(2, S)], [c(14, D), c(13, C)], 0.32998],
  ];
  for (const [a, b, exact] of cases) {
    const r = computeEquity({ hands: [a, b], board: [], seed: 'tbl:9:preflop' });
    assert.ok(Math.abs(r.equity[0] - exact) < 0.01, `${r.equity[0]} vs ${exact}`);
  }
});

// ── exact on the turn and river, against hand-counted boards ───────────────

test('turn, exact: AA v KK on 2h 7s 9d Jc -> KK has exactly the 2 kings left (2/44)', () => {
  const r = computeEquity({ hands: [[c(14, H), c(14, S)], [c(13, D), c(13, C)]], board: [c(2, H), c(7, S), c(9, D), c(11, C)], seed: 'x' });
  assert.equal(r.exact, true);
  assert.equal(r.street, 'turn');
  assert.equal(r.runouts, 44);
  assert.equal(r.equity[1], 2 / 44);
  assert.equal(r.equity[0], 42 / 44);
  assert.deepEqual(r.tie, [0, 0]);
});

test('turn, exact: a heart flush draw + two overcards v QQ -> 15 outs of 44', () => {
  // AhKh v QsQd on 2h 7h 9c Js: 9 hearts + 3 aces + 3 kings = 15; Qc gives QQ trips.
  const r = computeEquity({ hands: [[c(14, H), c(13, H)], [c(12, S), c(12, D)]], board: [c(2, H), c(7, H), c(9, C), c(11, S)], seed: 'x' });
  assert.equal(r.runouts, 44);
  assert.equal(r.equity[0], 15 / 44);
  assert.equal(r.equity[1], 29 / 44);
});

test('turn, exact: the same hand twice splits every river (50/50, all ties)', () => {
  const r = computeEquity({ hands: [[c(14, H), c(13, S)], [c(14, D), c(13, C)]], board: [c(2, H), c(7, S), c(9, D), c(11, C)], seed: 'x' });
  assert.deepEqual(r.equity, [0.5, 0.5]);
  assert.deepEqual(r.win, [0, 0]);
  assert.deepEqual(r.tie, [1, 1]);
});

test('turn, exact: a folded seat\'s shown king is out of the deck (KK down to 1/43)', () => {
  const r = computeEquity({
    hands: [[c(14, H), c(14, S)], [c(13, D), c(13, C)]], board: [c(2, H), c(7, S), c(9, D), c(11, C)],
    dead: [c(13, H), c(4, S)], seed: 'x',
  });
  assert.equal(r.runouts, 42);
  assert.equal(r.equity[1], 1 / 42);
});

test('river, exact: one board, one result; a board straight splits three ways', () => {
  const r = computeEquity({ hands: [[c(14, H), c(14, S)], [c(13, D), c(13, C)]], board: [c(2, H), c(7, S), c(9, D), c(11, C), c(3, H)], seed: 'x' });
  assert.equal(r.street, 'river');
  assert.equal(r.runouts, 1);
  assert.deepEqual(r.equity, [1, 0]);
  const chop = computeEquity({
    hands: [[c(2, S), c(3, D)], [c(4, C), c(5, S)], [c(6, D), c(7, C)]],
    board: [c(14, H), c(13, S), c(12, D), c(11, C), c(10, H)], seed: 'x',
  });
  for (const e of chop.equity) assert.ok(Math.abs(e - 1 / 3) < 1e-12);
  assert.deepEqual(chop.tie, [1, 1, 1]);
});

test('flop is exact too: every turn + river pair (C(45,2) = 990 heads-up), shares sum to 1', () => {
  const r = computeEquity({ hands: [[c(14, H), c(14, S)], [c(13, D), c(13, C)]], board: [c(2, H), c(7, S), c(9, D)], seed: 'x' });
  assert.equal(r.exact, true);
  assert.equal(r.runouts, 990);
  assert.ok(Math.abs(r.equity[0] + r.equity[1] - 1) < 1e-12);
});

test('Omaha uses exactly two hole cards: a one-heart hand gets no flush from four hearts on board', () => {
  // Hold'em reading: Ah + Kh Qh Jh Th = royal flush. Omaha: hand 2's 9 8 + Q J T straight wins.
  const r = computeEquity({
    hands: [[c(14, H), c(5, S), c(6, D), c(7, C)], [c(9, S), c(8, D), c(4, C), c(4, D)]],
    board: [c(13, H), c(12, H), c(11, H), c(10, H), c(2, S)], seed: 'x',
  });
  assert.deepEqual(r.equity, [0, 1]);
});

test('bad input gives no number: duplicates, mixed hole counts, a 1- or 2-card board, one hand', () => {
  const aa = [c(14, H), c(14, S)];
  assert.equal(computeEquity({ hands: [aa, aa], board: [], seed: 'x' }), null);
  assert.equal(computeEquity({ hands: [aa, [c(2, H), c(3, H), c(4, H), c(5, H)]], board: [], seed: 'x' }), null);
  assert.equal(computeEquity({ hands: [aa, [c(2, H), c(3, H)]], board: [c(9, D)], seed: 'x' }), null);
  assert.equal(computeEquity({ hands: [aa, [c(2, H), c(3, H)]], board: [c(9, D), c(8, D)], seed: 'x' }), null);
  assert.equal(computeEquity({ hands: [aa], board: [], seed: 'x' }), null);
  assert.equal(computeEquity({ hands: [aa, [c(2, H), c(3, H)]], board: [c(14, H)], seed: 'x' }), null);
  assert.equal(computeEquity({ hands: [aa, [c(2, H), { rank: 1, suit: 0 }]], board: [], seed: 'x' }), null);
  assert.equal(streetOf([1, 2]), null);
  assert.equal(cardIndex({ rank: 14, suit: 4 }), -1);
});

// ── the evaluator against an independent brute force ───────────────────────

function ref5(cards) {
  const ranks = cards.map((x) => x.rank).sort((a, b) => b - a);
  const flush = cards.every((x) => x.suit === cards[0].suit);
  const uniq = [...new Set(ranks)];
  let straight = 0;
  if (uniq.length === 5 && uniq[0] - uniq[4] === 4) straight = uniq[0];
  if (uniq.join() === '14,5,4,3,2') straight = 5;
  const cnt = new Map();
  for (const r of ranks) cnt.set(r, (cnt.get(r) || 0) + 1);
  const groups = [...cnt.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
  const shape = groups.map((g) => g[1]).join('');
  const byGroup = groups.map((g) => g[0]);
  if (straight && flush) return [8, straight];
  if (shape === '41') return [7, ...byGroup];
  if (shape === '32') return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  if (shape === '311') return [3, ...byGroup];
  if (shape === '221') return [2, ...byGroup];
  if (shape === '2111') return [1, ...byGroup];
  return [0, ...ranks];
}
function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
function ref7(cards) {
  let best = null;
  for (let a = 0; a < 7; a += 1) {
    for (let b = a + 1; b < 7; b += 1) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      const v = ref5(five);
      if (!best || cmp(v, best) > 0) best = v;
    }
  }
  return best;
}

test('evaluator: category and ordering match an independent brute force on 3,000 seeded 7-card hands', () => {
  const rand = seededRandom('equity:evaluator:2026-11-02');
  const deal = () => {
    const deck = Array.from({ length: 52 }, (_, i) => c((i >> 2) + 2, i & 3));
    for (let k = 0; k < 7; k += 1) {
      const j = k + Math.floor(rand() * (52 - k));
      [deck[k], deck[j]] = [deck[j], deck[k]];
    }
    return deck.slice(0, 7);
  };
  const NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  let prev = null;
  for (let i = 0; i < 3000; i += 1) {
    const h = deal();
    const mine = evaluateCards(h);
    const ref = ref7(h);
    assert.equal(categoryOf(mine), NAMES[ref[0]], JSON.stringify(h));
    if (prev) assert.equal(Math.sign(mine - prev.mine), cmp(ref, prev.ref), `${JSON.stringify(h)} v ${JSON.stringify(prev.h)}`);
    prev = { h, mine, ref };
  }
  // Edge cases a random deal rarely hits.
  const wheel = [c(14, H), c(2, S), c(3, D), c(4, C), c(5, H), c(9, S), c(10, D)];
  const six = [c(2, S), c(3, D), c(4, C), c(5, H), c(6, S), c(13, D), c(13, C)];
  assert.equal(categoryOf(evaluateCards(wheel)), 'Straight');
  assert.ok(evaluateCards(six) > evaluateCards(wheel), 'a six-high straight beats the wheel');
  const steelWheel = [c(14, H), c(2, H), c(3, H), c(4, H), c(5, H), c(13, H), c(9, S)];
  assert.equal(categoryOf(evaluateCards(steelWheel)), 'Straight flush');
  const twoTrips = [c(9, H), c(9, S), c(9, D), c(4, C), c(4, H), c(4, S), c(2, D)];
  assert.equal(cmp(ref7(twoTrips), [6, 9, 4]), 0);
  assert.equal(categoryOf(evaluateCards(twoTrips)), 'Full house');
});

// ── the frame: gate decisions in, never seat.holeCards ─────────────────────

const T = 1_800_000_000_000;
const DELAYED = { mode: 'delayed', delayMs: 5 * 60 * 1000, holeCards: true, policy: 'delayed' };
const PUBLIC = { mode: 'public', delayMs: 0, holeCards: false, policy: 'off' };
function seat(i, extra = {}) {
  return { seatIndex: i, pid: `b-${String(i).padStart(16, '0')}`, name: `P${i}`, chips: 1000, bet: 0, folded: false, allIn: false, sittingOut: false, eliminated: false, hasCards: true, holeCards: null, ...extra };
}
function released(extra = {}) {
  return {
    t: T, tableId: 'tb1', tableNo: 1, tableName: 'T1', maxSeats: 9, featured: true, handNumber: 7, phase: 'Turn',
    handLevel: { sb: 1, bb: 2, ante: 0 }, dealerSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2, activeSeat: 1,
    turnStartedAt: null, turnTimeout: null, pot: 10, board: [c(2, H), c(7, S), c(9, D), c(11, C)],
    seats: [seat(0, { holeCards: [c(14, H), c(14, S)] }), seat(1, { holeCards: [c(13, D), c(13, C)] }), seat(2, { folded: true, holeCards: [c(13, H), c(4, S)] })],
    handResult: null, liveHandEndedAt: T + 1000, holeCardsReleasedAt: T + DELAYED.delayMs, ...extra,
  };
}
const NOW = T + DELAYED.delayMs + 30_000;
const gateOf = (f, feed = DELAYED, now = NOW) => gateHoleCards(f, feed, { serverNow: now, log: quiet });

test('equityForFrame: delayed + released -> exact turn numbers, the folded seat\'s cards dead', () => {
  const f = released();
  const e = equityForFrame(f, gateOf(f));
  assert.equal(e.street, 'turn');
  assert.equal(e.exact, true);
  assert.equal(e.bySeat[1].equity, 1 / 42);
  assert.equal(e.bySeat[0].equity, 41 / 42);
  assert.equal(e.bySeat[2], undefined, 'a folded seat gets no number');
  const rows = holeCamRows(f, gateOf(f));
  assert.deepEqual(rows.map((r) => holeCamEquityText(e, gateOf(f), r)), ['98%', '2%']);
});

test('equityForFrame never reads seat.holeCards: only the gate\'s decision counts', () => {
  const f = released();
  const g = gateOf(f);
  // A gate that (say) a later frame produced with other cards: the numbers follow the gate.
  const forged = { ...g, seats: { ...g.seats, 0: { ...g.seats[0], cards: [c(3, H), c(2, S)] } } };
  const e = equityForFrame(f, forged);
  assert.ok(e.bySeat[0].equity < 0.2, 'computed from the gate cards (3-2), not the seat\'s AA');
  // Seat cards present, gate public -> nothing at all.
  assert.equal(equityForFrame(f, gateOf(f, PUBLIC)), null);
  // The source itself never names a seat's holeCards.
  const src = fs.readFileSync(path.join(ROOT, 'src/broadcast/model/equity.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  assert.doesNotMatch(src, /\.holeCards\b|\[\s*['"`]holeCards['"`]\s*\]/);
});

test('equityForFrame gives no number unless every hand still in is face up on the delayed feed', () => {
  const quietWarn = console.warn;
  console.warn = () => {};
  try {
    // still live (no release mark / not ended) -> backs -> no number
    assert.equal(equityForFrame(released({ holeCardsReleasedAt: null }), gateOf(released({ holeCardsReleasedAt: null }))), null);
    const live = released({ liveHandEndedAt: null });
    assert.equal(equityForFrame(live, gateOf(live)), null);
    // the delay has not passed
    assert.equal(equityForFrame(released(), gateOf(released(), DELAYED, T + 60_000)), null);
    // a hand still in without cards (the server sent none for it) -> no number for anyone
    const hidden = released({ seats: [seat(0, { holeCards: [c(14, H), c(14, S)] }), seat(1, { holeCards: null })] });
    assert.equal(equityForFrame(hidden, gateOf(hidden)), null);
    // the hand is over (handResult) -> the winner graphics take over
    const over = released({ phase: 'HandComplete', handResult: { winners: [{ seatIndex: 0, name: 'P0', amount: 10 }], showdownSeats: [0, 1], muckedSeats: [] } });
    assert.equal(equityForFrame(over, gateOf(over)), null);
    // one hand left
    const solo = released({ seats: [seat(0, { holeCards: [c(14, H), c(14, S)] }), seat(1, { folded: true, holeCards: [c(13, D), c(13, C)] })] });
    assert.equal(equityForFrame(solo, gateOf(solo)), null);
    // not the featured table
    const side = released({ featured: false });
    assert.equal(equityForFrame(side, gateOf(side)), null);
    assert.equal(equityForFrame(null, null), null);
  } finally { console.warn = quietWarn; }
});

test('equityForFrame is cached per table / hand / street / cards and identical for both layouts', () => {
  const f = released({ phase: 'PreFlop', board: [] });
  const a = equityForFrame(f, gateOf(f));
  const b = equityForFrame({ ...f }, gateOf({ ...f }, DELAYED, NOW + 250));   // the next 4 Hz render / the 9:16 source
  assert.equal(a, b, 'cache hit: the same object');
  resetEquityCache();
  const c2 = equityForFrame(f, gateOf(f));
  assert.notEqual(a, c2);
  assert.deepEqual(a, c2, 'recomputed from scratch: the same numbers');
  assert.equal(a.exact, false);
  assert.equal(a.street, 'preflop');
});

test('formatEquity: whole percent; <1% / >99% near the ends; 0% and 100% only when certain', () => {
  assert.equal(formatEquity(0.6234), '62%');
  assert.equal(formatEquity(0), '0%');
  assert.equal(formatEquity(1), '100%');
  assert.equal(formatEquity(0.004), '<1%');
  assert.equal(formatEquity(0.996), '>99%');
  assert.equal(formatEquity(Number.NaN), '');
});

test('showdown-delayed fixture: the released turn reads 10% / 80% / 10% (3 + 24 + 3 of 30 rivers)', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/broadcast/dev/fixtures/showdown-delayed.json'), 'utf8'));
  const s = applySnapshot(initialProgramState(), fx.snapshot, 0);
  const g = gateHoleCards(s.table, s.feed, { serverNow: fx.snapshot.serverNow, log: quiet });
  const e = equityForFrame(s.table, g);
  assert.equal(e.exact, true);
  assert.equal(e.runouts, 30);
  assert.deepEqual(Object.keys(e.bySeat).map(Number), [1, 2, 4]);
  assert.equal(e.bySeat[1].equity, 3 / 30);   // A K: a jack makes Broadway
  assert.equal(e.bySeat[2].equity, 24 / 30);  // T T T: everything else
  assert.equal(e.bySeat[4].equity, 3 / 30);   // Q J: a king makes Broadway
});

test('a nine-handed preflop stays fast (budgeted Monte Carlo)', () => {
  const hands = [];
  for (let i = 0; i < 9; i += 1) hands.push([c(14 - i, H), c(14 - i, S)]);
  const t0 = performance.now();
  const r = computeEquity({ hands, board: [], seed: 'tbl:1:preflop' });
  const ms = performance.now() - t0;
  assert.equal(r.runouts, samplesFor(9));
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
});
