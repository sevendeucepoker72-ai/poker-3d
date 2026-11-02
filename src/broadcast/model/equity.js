/**
 * Broadcast win % (lead spec R8 / P5-C2b, 2026-11-02) — the number the
 * DELAYED hole cam prints next to each hand still in it. A NEW module, separate
 * from the player app's hooks/useEquityWorker.js + workers/equityWorker.js
 * (Math.random, left exactly as it is): the 16:9 and the 9:16 sources must
 * print the same number for the same frame, so this one is DETERMINISTIC.
 *
 * - Turn and river (and the flop): EXACT enumeration of every runout. A turn
 *   is at most 46 rivers; a flop at most 1,081 turn + river pairs, cheap enough
 *   to count exactly too.
 * - Preflop: Monte Carlo with a SEEDED PRNG (sfc32 over a cyrb128 hash of
 *   `tableId:handNumber:street`) and a sample count fixed by the player count,
 *   so two runs, and two pages, agree to the last digit.
 * - Cards known to be out of the deck are removed from it: the board, every
 *   hand still in, and a folded seat's cards the delayed feed showed.
 * - Hold'em (2 hole cards, best 5 of 7) and Omaha (4 to 6 hole cards, exactly
 *   2 hole + 3 board). Anything else gets no number.
 *
 * It runs ONLY on what holeCardGate drew face up on the DELAYED feed:
 * equityForFrame reads the gate's decisions, never seat.holeCards, and a
 * public-feed gate (or any hidden hand still in) gives no number at all.
 * Pure module: no React, no import.meta (node:test loads it as is).
 */
import { isObj } from './contract.js';

/**
 * Monte Carlo work per street, in hand evaluations (a 7-card Hold'em hand = 1,
 * an Omaha hand = 60). Measured 2026-11-02 on node 24: about 20 ms for a
 * heads-up preflop (20,000 samples, within 0.6% of the exact 1.7M-board count
 * for AA v KK, AKs v QQ and 72o v AKo), under 15 ms for nine-handed. Computed
 * once per street and cached.
 */
export const EQUITY_EVAL_BUDGET = 80000;
export const EQUITY_MIN_SAMPLES = 500;
export const EQUITY_MAX_SAMPLES = 20000;
/** Exact enumeration whenever the runouts left fit this (a flop is at most 1,081). */
export const EQUITY_EXACT_MAX_RUNOUTS = 2000;

const STREET_BY_BOARD = { 0: 'preflop', 3: 'flop', 4: 'turn', 5: 'river' };
const EQUITY_PHASES = new Set(['PreFlop', 'Flop', 'Turn', 'River', 'Showdown']);

// ── cards ──────────────────────────────────────────────────────────────────

/** {rank 2..14, suit 0..3} -> 0..51, else -1. */
export function cardIndex(c) {
  if (!isObj(c) || !Number.isInteger(c.rank) || !Number.isInteger(c.suit)) return -1;
  if (c.rank < 2 || c.rank > 14 || c.suit < 0 || c.suit > 3) return -1;
  return (c.rank - 2) * 4 + c.suit;
}

/** The street a board of this many cards is on, or null (1 or 2 cards is not a board). */
export function streetOf(board) {
  const n = Array.isArray(board) ? board.length : -1;
  return STREET_BY_BOARD[n] || null;
}

/** The PRNG seed string for a frame and street (R8). */
export function equitySeed(tableId, handNumber, street) {
  return `${tableId}:${handNumber}:${street}`;
}

// ── seeded PRNG (cyrb128 -> sfc32): integer maths only, identical in every engine ──

function cyrb128(str) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i += 1) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** A seeded generator of floats in [0, 1): the same seed string gives the same sequence. */
export function seededRandom(seedText) {
  let [a, b, c, d] = cyrb128(String(seedText));
  return function next() {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

// ── hand evaluator: best 5 of 5..7 cards as one comparable integer ─────────

const counts = new Uint8Array(15);
const suitMask = new Uint16Array(4);
const suitCount = new Uint8Array(4);

function highBit(mask) {
  return mask ? 31 - Math.clz32(mask) : 0;
}

/** The top card of the best straight in a rank mask (bit r = rank r; the ace also plays low), else 0. */
function straightHigh(mask) {
  const m = mask & (1 << 14) ? mask | 2 : mask;
  for (let hi = 14; hi >= 5; hi -= 1) {
    const need = 0x1f << (hi - 4);
    if ((m & need) === need) return hi;
  }
  return 0;
}

function score(cat, a = 0, b = 0, c = 0, d = 0, e = 0) {
  return (cat << 20) | (a << 16) | (b << 12) | (c << 8) | (d << 4) | e;
}

/** Up to five ranks from a mask, highest first, packed after the category. */
function topFive(cat, mask) {
  let m = mask;
  const r1 = highBit(m); m &= ~(1 << r1);
  const r2 = highBit(m); m &= ~(1 << r2);
  const r3 = highBit(m); m &= ~(1 << r3);
  const r4 = highBit(m); m &= ~(1 << r4);
  const r5 = highBit(m);
  return score(cat, r1, r2, r3, r4, r5);
}

/**
 * Best five-card hand of `n` (5..7) card indices in buf[0..n). Higher wins;
 * equal is a tie. Categories: 8 straight flush, 7 quads, 6 full house,
 * 5 flush, 4 straight, 3 trips, 2 two pair, 1 pair, 0 high card.
 */
export function evaluateIndices(buf, n) {
  counts.fill(0);
  suitMask.fill(0);
  suitCount.fill(0);
  let all = 0;
  for (let i = 0; i < n; i += 1) {
    const ci = buf[i];
    const r = (ci >> 2) + 2;
    const s = ci & 3;
    counts[r] += 1;
    suitMask[s] |= 1 << r;
    suitCount[s] += 1;
    all |= 1 << r;
  }
  let flush = 0;
  for (let s = 0; s < 4; s += 1) {
    if (suitCount[s] >= 5) { flush = suitMask[s]; break; }
  }
  if (flush) {
    const sf = straightHigh(flush);
    if (sf) return score(8, sf);
  }
  let quad = 0;
  let trip1 = 0;
  let trip2 = 0;
  let pair1 = 0;
  let pair2 = 0;
  for (let r = 14; r >= 2; r -= 1) {
    const c = counts[r];
    if (c === 4) quad = r;
    else if (c === 3) { if (!trip1) trip1 = r; else if (!trip2) trip2 = r; }
    else if (c === 2) { if (!pair1) pair1 = r; else if (!pair2) pair2 = r; }
  }
  if (quad) return score(7, quad, highBit(all & ~(1 << quad)));
  if (trip1 && (trip2 || pair1)) return score(6, trip1, Math.max(trip2, pair1));
  if (flush) return topFive(5, flush);
  const st = straightHigh(all);
  if (st) return score(4, st);
  if (trip1) {
    let m = all & ~(1 << trip1);
    const k1 = highBit(m); m &= ~(1 << k1);
    return score(3, trip1, k1, highBit(m));
  }
  if (pair1 && pair2) return score(2, pair1, pair2, highBit(all & ~(1 << pair1) & ~(1 << pair2)));
  if (pair1) {
    let m = all & ~(1 << pair1);
    const k1 = highBit(m); m &= ~(1 << k1);
    const k2 = highBit(m); m &= ~(1 << k2);
    return score(1, pair1, k1, k2, highBit(m));
  }
  return topFive(0, all);
}

/** Convenience for tests and callers holding {rank, suit} cards. */
export function evaluateCards(cards) {
  const idx = cards.map(cardIndex);
  if (idx.length < 5 || idx.length > 7 || idx.some((i) => i < 0)) return -1;
  return evaluateIndices(idx, idx.length);
}

export const HAND_CATEGORY_NAMES = Object.freeze([
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush',
]);

/** The category name of an evaluator score. */
export function categoryOf(scoreValue) {
  return HAND_CATEGORY_NAMES[scoreValue >> 20] || '';
}

// ── one player's best hand on a full board ─────────────────────────────────

const hold7 = new Int8Array(7);
const omaha5 = new Int8Array(5);

function holdemBest(hole, board5) {
  hold7[0] = hole[0];
  hold7[1] = hole[1];
  for (let i = 0; i < 5; i += 1) hold7[2 + i] = board5[i];
  return evaluateIndices(hold7, 7);
}

function omahaBest(hole, board5) {
  let best = -1;
  for (let i = 0; i < hole.length - 1; i += 1) {
    for (let j = i + 1; j < hole.length; j += 1) {
      omaha5[0] = hole[i];
      omaha5[1] = hole[j];
      for (let a = 0; a < 3; a += 1) {
        for (let b = a + 1; b < 4; b += 1) {
          for (let c = b + 1; c < 5; c += 1) {
            omaha5[2] = board5[a];
            omaha5[3] = board5[b];
            omaha5[4] = board5[c];
            const v = evaluateIndices(omaha5, 5);
            if (v > best) best = v;
          }
        }
      }
    }
  }
  return best;
}

function combos(n, k) {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 0; i < k; i += 1) out = (out * (n - i)) / (i + 1);
  return Math.round(out);
}

/** Monte Carlo samples for this many players (fixed: part of the determinism). */
export function samplesFor(players, omaha = false, holeCount = 2) {
  const perPlayer = omaha ? combos(holeCount, 2) * 10 : 1;
  const n = Math.floor(EQUITY_EVAL_BUDGET / Math.max(1, players * perPlayer));
  return Math.min(EQUITY_MAX_SAMPLES, Math.max(EQUITY_MIN_SAMPLES, n));
}

/**
 * Equity of known hands on a board.
 *
 * @param {{hands: object[][], board: object[], dead?: object[], seed: string}} input
 *   hands = each player's hole cards ({rank, suit}); board = 0, 3, 4 or 5 cards;
 *   dead = other cards known to be out of the deck (a folded seat's shown cards).
 * @returns {null | {street, exact:boolean, runouts:number, win:number[], tie:number[], equity:number[]}}
 *   win / tie / equity as fractions 0..1 in `hands` order (a tie is shared: equity
 *   counts 1/k of a k-way tie). null = cannot be computed (bad or duplicate cards,
 *   fewer than two hands, mixed or unsupported hole-card counts).
 */
export function computeEquity({ hands, board, dead = [], seed }) {
  if (!Array.isArray(hands) || hands.length < 2 || !Array.isArray(board)) return null;
  const street = streetOf(board);
  if (!street) return null;
  const holeCount = Array.isArray(hands[0]) ? hands[0].length : 0;
  const omaha = holeCount >= 4 && holeCount <= 6;
  if (!(holeCount === 2 || omaha)) return null;
  const used = new Uint8Array(52);
  const take = (cards) => {
    const out = [];
    for (const c of cards) {
      const i = cardIndex(c);
      if (i < 0 || used[i]) return null;
      used[i] = 1;
      out.push(i);
    }
    return out;
  };
  const holes = [];
  for (const h of hands) {
    if (!Array.isArray(h) || h.length !== holeCount) return null;
    const idx = take(h);
    if (!idx) return null;
    holes.push(idx);
  }
  const boardIdx = take(board);
  if (!boardIdx) return null;
  if (!take(Array.isArray(dead) ? dead : [])) return null;
  const deck = [];
  for (let i = 0; i < 52; i += 1) if (!used[i]) deck.push(i);

  const players = holes.length;
  const need = 5 - boardIdx.length;
  const win = new Float64Array(players);
  const tie = new Float64Array(players);
  const share = new Float64Array(players);
  const scores = new Int32Array(players);
  const full = new Int8Array(5);
  for (let i = 0; i < boardIdx.length; i += 1) full[i] = boardIdx[i];
  const best = omaha ? omahaBest : holdemBest;

  const settle = () => {
    let top = -1;
    let ties = 0;
    for (let p = 0; p < players; p += 1) {
      const v = best(holes[p], full);
      scores[p] = v;
      if (v > top) { top = v; ties = 1; } else if (v === top) ties += 1;
    }
    for (let p = 0; p < players; p += 1) {
      if (scores[p] !== top) continue;
      if (ties === 1) win[p] += 1;
      else { tie[p] += 1; share[p] += 1 / ties; }
    }
  };

  let runouts = 0;
  const exactCount = combos(deck.length, need);
  const exact = exactCount <= EQUITY_EXACT_MAX_RUNOUTS;
  if (exact) {
    const b = boardIdx.length;
    if (need === 0) { settle(); runouts = 1; }
    else if (need === 1) {
      for (let i = 0; i < deck.length; i += 1) { full[b] = deck[i]; settle(); runouts += 1; }
    } else if (need === 2) {
      for (let i = 0; i < deck.length - 1; i += 1) {
        full[b] = deck[i];
        for (let j = i + 1; j < deck.length; j += 1) { full[b + 1] = deck[j]; settle(); runouts += 1; }
      }
    } else {
      return null;   // never reached: a preflop runout count is far above the exact limit
    }
  } else {
    const rand = seededRandom(seed);
    const samples = samplesFor(players, omaha, holeCount);
    const work = deck.slice();
    const len = work.length;
    const b = boardIdx.length;
    for (let s = 0; s < samples; s += 1) {
      // Partial Fisher-Yates: the first `need` cards of `work` are a uniform draw.
      for (let k = 0; k < need; k += 1) {
        const j = k + Math.floor(rand() * (len - k));
        const tmp = work[k];
        work[k] = work[j];
        work[j] = tmp;
        full[b + k] = work[k];
      }
      settle();
    }
    runouts = samples;
  }
  const outWin = [];
  const outTie = [];
  const outEq = [];
  for (let p = 0; p < players; p += 1) {
    outWin.push(win[p] / runouts);
    outTie.push(tie[p] / runouts);
    outEq.push((win[p] + share[p]) / runouts);
  }
  return { street, exact, runouts, win: outWin, tie: outTie, equity: outEq };
}

// ── the broadcast frame: gate decisions in, a number per seat out ──────────

const CACHE_MAX = 48;
const cache = new Map();

/** Test hook: forget every cached result. */
export function resetEquityCache() { cache.clear(); }

function cardsKey(cards) {
  return cards.map(cardIndex).join('.');
}

/**
 * The win % for the hands still in a DELAYED table frame, from holeCardGate's
 * decision only (never seat.holeCards).
 *
 * null unless: the gate is in 'delayed' mode; the hand is in play (a betting
 * phase or Showdown, no handResult yet); every seat still in the hand (dealt
 * in, not folded) is face up; there are two or more of them; the board is on
 * a street. Cached per table / hand / street / cards, so the 4 Hz re-render
 * costs one string.
 *
 * @returns {null | {street, exact, runouts, bySeat: Record<number, {equity, win, tie}>}}
 */
export function equityForFrame(frame, gate) {
  if (!isObj(frame) || !isObj(gate) || gate.mode !== 'delayed' || !isObj(gate.seats)) return null;
  if (frame.handResult || !EQUITY_PHASES.has(frame.phase) || !Array.isArray(frame.seats)) return null;
  const board = Array.isArray(frame.board) ? frame.board : [];
  const street = streetOf(board);
  if (!street || board.some((c) => cardIndex(c) < 0)) return null;
  const live = [];
  const dead = [];
  const seats = frame.seats
    .filter((s) => isObj(s) && Number.isInteger(s.seatIndex))
    .sort((a, b) => a.seatIndex - b.seatIndex);
  for (const seat of seats) {
    const d = gate.seats[seat.seatIndex];
    const faces = d && Array.isArray(d.cards) && d.cards.length > 0 ? d.cards : null;
    const inHand = seat.hasCards === true && seat.folded !== true && seat.eliminated !== true;
    if (inHand) {
      if (!faces) return null;   // a hand still in is hidden: no number for anyone
      live.push({ seatIndex: seat.seatIndex, cards: faces });
    } else if (faces) {
      dead.push(...faces);
    }
  }
  if (live.length < 2) return null;
  const seed = equitySeed(frame.tableId, frame.handNumber, street);
  const key = `${seed}|${live.map((h) => `${h.seatIndex}=${cardsKey(h.cards)}`).join(',')}|${cardsKey(board)}|${cardsKey(dead)}`;
  if (cache.has(key)) return cache.get(key);
  const res = computeEquity({ hands: live.map((h) => h.cards), board, dead, seed });
  let out = null;
  if (res) {
    const bySeat = {};
    live.forEach((h, i) => { bySeat[h.seatIndex] = { equity: res.equity[i], win: res.win[i], tie: res.tie[i] }; });
    out = { street: res.street, exact: res.exact, runouts: res.runouts, bySeat };
  }
  cache.set(key, out);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return out;
}

/** '62%'; '<1%' / '>99%' near the ends so a live draw never reads as dead; '0%' / '100%' only for a true 0 or 1. */
export function formatEquity(e) {
  if (!Number.isFinite(e)) return '';
  if (e <= 0) return '0%';
  if (e >= 1) return '100%';
  if (e < 0.01) return '<1%';
  if (e > 0.99) return '>99%';
  return `${Math.round(e * 100)}%`;
}
