/**
 * holeCardGate — the ONE place the broadcast page decides whether a seat's hole
 * cards are drawn face up (lead spec C2, risk #1: a hole-card leak on any public
 * path is a P0). Pure and FAIL-CLOSED: anything it cannot prove is allowed is
 * drawn as card backs (a dealt-in seat) or not at all, never face up.
 *
 * A seat's cards are face up ONLY when one of these holds:
 *
 * 1. PUBLIC (any feed): a contested showdown that has ENDED — the same gate as
 *    poker-server getGameStateForPlayer (index.ts:6552-6572): phase Showdown or
 *    HandComplete, a handResult (the pot was awarded, so the hand is over),
 *    two or more hands at the showdown (tabled showdownSeats plus the in-hand
 *    seats that mucked there), this seat among the tabled ones, not folded,
 *    not mucked (seat.mucked or handResult.muckedSeats).
 *
 * 2. DELAYED (2026-11-02, owner: "5-minute delayed feed"; HARD RULE: a hand's
 *    hole cards are never released while that hand is still being played live):
 *    - feed.mode === 'delayed', feed.holeCards === true, feed.policy is not 'off',
 *    - feed.delayMs >= MIN_HOLECARD_DELAY_MS (5 minutes; the server may set more),
 *    - the frame is the FEATURED table (`featured === true`; a producer pin makes
 *      the pinned table the featured frame),
 *    - (a) the hand has ended LIVE: `liveHandEndedAt` is a server time at or
 *      before the server's now (null / missing = still live or unknown → backs),
 *    - (b) the delay has passed since the frame being shown: t + delayMs <= now,
 *    - (c) 2026-11-02 (P5-C2b) the frame MARKS this hand's cards as released:
 *      `holeCardsReleasedAt` is the server time its delay buffer released them,
 *      no earlier than (a) and (b) (a server that stamps it early, or not at
 *      all, gets backs), and not ahead of the server's now.
 *    A hand the delayed feed reaches while it is still live shows card backs
 *    until it ends live.
 *
 * Everything else that arrives with cards is DROPPED and logged once per hand
 * ('[broadcast] dropped live hole cards'). The server never sends such cards
 * (its public frame builder never reads seat.holeCards); this is the second wall.
 */
import { isObj } from './contract.js';

/** 2026-11-02 (owner) — the delayed hole-card feed's floor AND default: 5 minutes. */
export const MIN_HOLECARD_DELAY_MS = 5 * 60 * 1000;

/** A server release that lands within this much of our clock estimate is held, not logged. */
export const CLOCK_GRACE_MS = 2000;

export const DROPPED_LIVE_HOLE_CARDS_LOG = '[broadcast] dropped live hole cards';

const SHOWDOWN_PHASES = new Set(['Showdown', 'HandComplete']);
// Hold'em (2) and Omaha (4..6); nothing else is drawn as hole cards.
const MAX_HOLE_CARDS = 6;

/** A server card {rank 2..14, suit 0..3}, else false. */
export function isCard(c) {
  return isObj(c) && Number.isInteger(c.rank) && c.rank >= 2 && c.rank <= 14
    && Number.isInteger(c.suit) && c.suit >= 0 && c.suit <= 3;
}

/** The seat's cards as clean {rank, suit} copies, or null when any is malformed. */
export function cleanCards(cards) {
  if (!Array.isArray(cards) || cards.length === 0 || cards.length > MAX_HOLE_CARDS) return null;
  if (!cards.every(isCard)) return null;
  return cards.map((c) => ({ rank: c.rank, suit: c.suit }));
}

function seatList(list) {
  return Array.isArray(list) ? list.filter((n) => Number.isInteger(n)) : [];
}

/**
 * True when the frame's hand ended in a contested showdown (rule 1, table level).
 *
 * Review 2026-11-02 — "contested" means two or more hands REACHED the showdown,
 * the same test as the table gate (index.ts wentToShowdown). poker-server's
 * frame lists the tabled hands in showdownSeats and the hands MUCKED at the
 * showdown in muckedSeats (broadcastFrame.ts showdownReveal), so a showdown the
 * loser mucks arrives as showdownSeats [winner] + muckedSeats [loser]. Counting
 * only showdownSeats hid the winner's tabled hand while the winner line still
 * named it, and fired the leak-alarm log for a legitimate frame. A mucked seat
 * counts only when the frame has it in the hand (present, not folded): a fold
 * never makes a hand contested. A lone winner with nobody tabled or mucked
 * against him (an uncontested pot) is still not contested.
 */
export function isContestedShowdown(frame) {
  if (!isObj(frame) || !SHOWDOWN_PHASES.has(frame.phase)) return false;
  const hr = frame.handResult;
  if (!isObj(hr)) return false;
  const shown = seatList(hr.showdownSeats);
  if (shown.length === 0) return false;
  const reached = new Set(shown);
  const seats = Array.isArray(frame.seats) ? frame.seats.filter(isObj) : [];
  const inHand = (i) => seats.some((s) => s.seatIndex === i && s.folded !== true);
  for (const i of seatList(hr.muckedSeats)) if (inHand(i)) reached.add(i);
  for (const s of seats) if (s.mucked === true && s.folded !== true && Number.isInteger(s.seatIndex)) reached.add(s.seatIndex);
  return reached.size >= 2;
}

/** Rule 1 for one seat: shown at a contested showdown, not folded, not mucked. */
export function seatShownAtShowdown(frame, seat) {
  if (!isContestedShowdown(frame) || !isObj(seat)) return false;
  if (seat.folded === true || seat.mucked === true) return false;
  const hr = frame.handResult;
  if (seatList(hr.muckedSeats).includes(seat.seatIndex)) return false;
  return seatList(hr.showdownSeats).includes(seat.seatIndex);
}

/**
 * The feed's delayed hole-card entitlement (table-independent part of rule 2).
 * An unknown / malformed feed is not entitled.
 */
export function delayedFeedAllowsCards(feed) {
  if (!isObj(feed)) return false;
  return feed.mode === 'delayed'
    && feed.holeCards === true
    && (feed.policy === 'delayed' || feed.policy === 'after_event')
    && Number.isFinite(feed.delayMs)
    && feed.delayMs >= MIN_HOLECARD_DELAY_MS;
}

/**
 * The stricter of two feed descriptions (snapshot.feed and, when a server also
 * sends it, program.feed): delayed cards need BOTH to allow them.
 */
export function effectiveFeed(snapshotFeed, programFeed) {
  const a = isObj(snapshotFeed) ? snapshotFeed : null;
  const b = isObj(programFeed) ? programFeed : null;
  if (!a && !b) return { mode: 'public', delayMs: 0, holeCards: false, policy: 'off' };
  if (!a || !b) {
    const f = a || b;
    return {
      mode: f.mode === 'delayed' ? 'delayed' : 'public',
      delayMs: Number.isFinite(f.delayMs) && f.delayMs > 0 ? f.delayMs : 0,
      holeCards: f.holeCards === true,
      policy: typeof f.policy === 'string' ? f.policy : 'off',
    };
  }
  const delayed = a.mode === 'delayed' && b.mode === 'delayed';
  return {
    mode: delayed ? 'delayed' : 'public',
    delayMs: Math.min(Number(a.delayMs) || 0, Number(b.delayMs) || 0),
    holeCards: a.holeCards === true && b.holeCards === true,
    policy: a.policy === b.policy ? a.policy : 'off',
  };
}

/**
 * Rule 2's time test for one frame: 'ok', or why the cards are held:
 *   'hand_live'      — the hand has not ended live (or we cannot tell)
 *   'delay_pending'  — the delay has not passed since the frame's time
 *   'not_released'   — the frame does not mark this hand's cards as released
 *                      (no `holeCardsReleasedAt`, one earlier than the hand's
 *                      live end or the frame's delay, or one still ahead of now)
 *   'clock_unknown'  — the page has no server clock yet
 * plus `logIt` (true when the gap is beyond clock skew: the server released early)
 * and `recheckAt` (server ms when a held seat could pass, or null).
 */
export function delayedTimeTest(frame, feed, serverNow) {
  if (!Number.isFinite(serverNow)) return { state: 'clock_unknown', logIt: false, recheckAt: null };
  const ended = frame.liveHandEndedAt;
  if (!Number.isFinite(ended)) return { state: 'hand_live', logIt: true, recheckAt: null };
  if (ended > serverNow) {
    return { state: 'hand_live', logIt: ended - serverNow > CLOCK_GRACE_MS, recheckAt: ended };
  }
  if (!Number.isFinite(frame.t)) return { state: 'delay_pending', logIt: true, recheckAt: null };
  const due = frame.t + feed.delayMs;
  if (due > serverNow) {
    return { state: 'delay_pending', logIt: due - serverNow > CLOCK_GRACE_MS, recheckAt: due };
  }
  // (c) The server's own release mark, consistent with (a) and (b).
  const released = frame.holeCardsReleasedAt;
  if (!Number.isFinite(released) || released < ended || released < due) {
    return { state: 'not_released', logIt: true, recheckAt: null };
  }
  if (released > serverNow) {
    return { state: 'not_released', logIt: released - serverNow > CLOCK_GRACE_MS, recheckAt: released };
  }
  return { state: 'ok', logIt: false, recheckAt: null };
}

/**
 * True when a seat's face-up decision is one the gate may make (the test
 * suites' invariant, also usable by a debug overlay): rule 1 at a contested
 * showdown that has ended, or rule 2 on the delayed feed's featured frame
 * with (a), (b) and (c) all met at `serverNow`.
 */
export function faceUpAllowed(frame, feed, seat, serverNow) {
  if (seatShownAtShowdown(frame, seat)) return true;
  if (!isObj(frame) || frame.featured !== true || !delayedFeedAllowsCards(feed)) return false;
  return delayedTimeTest(frame, feed, serverNow).state === 'ok';
}

// ── once-per-hand log ──────────────────────────────────────────────────────
const LOGGED_MAX = 200;
const logged = new Set();

/** Test hook: forget which hands were already logged. */
export function resetDropLog() { logged.clear(); }

function logDrop(frame, reason, log) {
  const key = `${frame.tableId}:${frame.handNumber}:${reason}`;
  if (logged.has(key)) return false;
  logged.add(key);
  if (logged.size > LOGGED_MAX) logged.delete(logged.values().next().value);
  try {
    log(DROPPED_LIVE_HOLE_CARDS_LOG, { tableId: frame.tableId, handNumber: frame.handNumber, reason });
  } catch { /* a logger never breaks the render */ }
  return true;
}

function defaultLog(...args) {
  console.warn(...args);
}

/**
 * Decide every seat of a table frame.
 *
 * @param {object} frame  BroadcastTableFrame
 * @param {object} feed   Feed (effectiveFeed of snapshot + program)
 * @param {{serverNow?:number, log?:Function}} ctx  serverNow = the page's estimate of the server clock
 * @returns {{seats: Record<number, {cards: object[]|null, backs: number, reason: string}>,
 *            anyFaceUp: boolean, dropped: number, recheckAt: number|null, mode: 'public'|'delayed'}}
 *   cards = face-up cards to draw (null = none); backs = card backs to draw instead.
 */
export function gateHoleCards(frame, feed, ctx = {}) {
  const out = { seats: {}, anyFaceUp: false, dropped: 0, recheckAt: null, mode: 'public' };
  if (!isObj(frame) || !Array.isArray(frame.seats)) return out;
  const log = typeof ctx.log === 'function' ? ctx.log : defaultLog;
  const delayedOk = delayedFeedAllowsCards(feed) && frame.featured === true;
  out.mode = delayedOk ? 'delayed' : 'public';
  const time = delayedOk ? delayedTimeTest(frame, feed, ctx.serverNow) : null;

  for (const seat of frame.seats) {
    if (!isObj(seat) || !Number.isInteger(seat.seatIndex)) continue;
    const dealtIn = seat.hasCards === true && seat.folded !== true && seat.eliminated !== true;
    const raw = seat.holeCards;
    const sent = Array.isArray(raw) && raw.length > 0;
    const cards = sent ? cleanCards(raw) : null;
    const backCount = cards ? cards.length : 2;
    let decision = { cards: null, backs: dealtIn ? backCount : 0, reason: dealtIn ? 'hidden' : 'none' };

    if (sent && !cards) {
      decision = { cards: null, backs: dealtIn ? 2 : 0, reason: 'malformed' };
      out.dropped += 1;
      logDrop(frame, 'malformed', log);
    } else if (cards && seatShownAtShowdown(frame, seat)) {
      decision = { cards, backs: 0, reason: 'showdown' };
    } else if (cards && delayedOk && time.state === 'ok') {
      decision = { cards, backs: 0, reason: 'delayed' };
    } else if (cards) {
      // Never face up. A delayed seat whose hand is still live (or whose delay
      // has not passed) shows backs; anything else with cards is a live leak.
      const reason = delayedOk ? time.state : 'live_cards';
      decision = { cards: null, backs: dealtIn || delayedOk ? cards.length : 0, reason };
      out.dropped += 1;
      if (!delayedOk || time.logIt) logDrop(frame, reason, log);
      if (delayedOk && Number.isFinite(time.recheckAt)) {
        out.recheckAt = out.recheckAt === null ? time.recheckAt : Math.min(out.recheckAt, time.recheckAt);
      }
    }
    if (decision.cards) out.anyFaceUp = true;
    out.seats[seat.seatIndex] = decision;
  }
  return out;
}

/**
 * The frame with every seat's holeCards nulled unless the PUBLIC rule shows
 * them (the producer's live multiview and the store's public-feed pass use it).
 * Never mutates the input.
 */
export function publicTableFrame(frame, ctx = {}) {
  if (!isObj(frame) || !Array.isArray(frame.seats)) return frame;
  const log = typeof ctx.log === 'function' ? ctx.log : defaultLog;
  let changed = false;
  const seats = frame.seats.map((seat) => {
    if (!isObj(seat)) return seat;
    const raw = seat.holeCards;
    if (raw === null || raw === undefined) return seat;
    const cards = cleanCards(raw);
    if (cards && seatShownAtShowdown(frame, seat)) {
      return cards.length === raw.length ? seat : { ...seat, holeCards: cards };
    }
    changed = true;
    if (Array.isArray(raw) && raw.length > 0) logDrop(frame, cards ? 'live_cards' : 'malformed', log);
    return { ...seat, holeCards: null };
  });
  return changed ? { ...frame, seats } : frame;
}
