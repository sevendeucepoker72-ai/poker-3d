/**
 * The table's render rules (gameplay audit 2026-10-21, cluster C2): the seat
 * ring (seat cap, AWAY, position badges), the opponents' cards, the winner
 * banner / showdown overlay and the equity badges.
 *
 * Pure module (no React, no store, no socket): PokerTable2D, GameHUD,
 * SessionTracker, MultiTableView and the offline probes use it. Every server
 * key read here is OPTIONAL — a state without it (an older poker-server) gets
 * the behaviour the table had before these rules, unless that behaviour was
 * the defect itself.
 */
import { safeName, sanitizeShownCards } from './tablePayload.js';

const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Seven-card stud is the most a seat can hold. */
export const MAX_SEAT_CARDS = 7;

// ── Opponents' cards (F125 / F136) ──────────────────────────────────────────

/**
 * How many cards every opponent holds face down at this table (F136): the
 * variant's count (Omaha 4-6, Draw 5, Badugi 4), Pineapple 3 until every seat
 * discards at once (Pineapple: when the flop is dealt, Crazy Pineapple: when
 * the turn is dealt) and 2 after. Stud is per seat (`opponentCardSlots`).
 * Anything unknown: 2 (Hold'em, Short Deck, an older payload).
 */
export function tableBackCount(gs) {
  if (!gs || typeof gs !== 'object') return 2;
  const n = Number(gs.holeCardCount);
  if (!intIn(n, 2, MAX_SEAT_CARDS)) return 2;
  if (gs.isStudGame === true) return 2;
  const pineapple = gs.isPineapple === true
    || (gs.isPineapple !== false && n === 3 && gs.hasDrawPhase !== true);
  if (pineapple) {
    const board = Array.isArray(gs.communityCards) ? gs.communityCards.length : 0;
    const crazy = /crazy/i.test(String(gs.variantName || ''));
    return (crazy ? board >= 4 : board >= 3) ? 2 : 3;
  }
  return n;
}

/**
 * One opponent's card row, left to right: `[{ key, card }]`, `card` null =
 * a back. Stud / Razz / Stud 8 (F125): the server's public up-cards
 * (`faceUpCards`, of `totalCardCount`) face up after his two first down
 * cards, his 7th-street down card last. Everything else: `backCount` backs.
 * Never another source of cards (his hole cards are shown only at a
 * showdown, by the caller). Keys stay put street to street so only the new
 * card deals in.
 */
export function opponentCardSlots(seat, backCount = 2) {
  const s = seat && typeof seat === 'object' ? seat : {};
  const ups = Array.isArray(s.faceUpCards) && s.faceUpCards.length > 0
    ? sanitizeShownCards(s.faceUpCards, MAX_SEAT_CARDS)
    : null;
  if (ups) {
    const total = intIn(s.totalCardCount, ups.length, MAX_SEAT_CARDS)
      ? s.totalCardCount
      : Math.min(MAX_SEAT_CARDS, ups.length + 2);
    const down = total - ups.length;
    const first = Math.min(down, 2);
    const out = [];
    for (let i = 0; i < first; i++) out.push({ key: `d${i}`, card: null });
    ups.forEach((c, i) => out.push({ key: `u${i}`, card: c }));
    for (let i = first; i < down; i++) out.push({ key: `d${i}`, card: null });
    return out;
  }
  const n = intIn(s.totalCardCount, 1, MAX_SEAT_CARDS)
    ? s.totalCardCount
    : (intIn(backCount, 1, MAX_SEAT_CARDS) ? backCount : 2);
  return Array.from({ length: n }, (_, i) => ({ key: `d${i}`, card: null }));
}

/**
 * The React key of his i-th card when it is shown face up (F125 fix-up): the
 * key the same position had face down (`opponentCardSlots`), so the showdown
 * turns his cards over in place. Keys 0,1.. there remounted every card and
 * replayed the deal-in animation at every showdown, Hold'em included. Stud's
 * cards come in deal order (down, down, up x4, down), the slots' order.
 */
export function shownCardKey(cardSlots, i) {
  const slot = Array.isArray(cardSlots) ? cardSlots[i] : null;
  return (slot && typeof slot.key === 'string' && slot.key) || `d${i}`;
}

// ── Seat ring (G175 / G181 / G182) ──────────────────────────────────────────

/** The seat sits out (G181): the server's per-seat `sittingOut`, or the old state value. */
export function seatSittingOut(seat) {
  return !!seat && typeof seat === 'object' && (seat.sittingOut === true || seat.state === 'sitting_out');
}

/**
 * Seats this table can actually seat (G182): the server's `maxSeats` (a
 * variant's deck cap, heads-up, a home game / club table's size), else all.
 */
export function seatCapOf(gs, seatCount = 9) {
  const m = gs && typeof gs === 'object' ? gs.maxSeats : undefined;
  return intIn(m, 2, seatCount) ? m : seatCount;
}

/**
 * A moveSeatPending / moveSeatComplete / moveSeatCancelled frame concerns the
 * table on screen (G182 / F78): it names that table, or names none (an older
 * server). Another table's frame (multi-table) is not this pill's.
 */
export function seatMoveFrameIsForTable(frame, shownTableId) {
  if (!frame || typeof frame !== 'object' || frame.tableId == null) return true;
  return shownTableId != null && String(frame.tableId) === String(shownTableId);
}

function satOutAtDeal(s) {
  return s.sittingOut === true
    || (typeof s.missedBlind === 'string' && s.missedBlind !== 'none')
    || Number(s.deadBlindOwedChips) > 0;
}

/**
 * The seats the dealer button and blinds go round this hand (G175) — the
 * server's own set (occupied, not eliminated), not every occupied seat:
 *  - a busted seat (tournament bust, a cash 0-chip seat, a fixed-roster quick
 *    table's bot) is out;
 *  - a player who sat down while the hand was being played (folded, no cards,
 *    not sitting out) is not in this hand's positions;
 *  - Stud / Razz / Stud 8 post no blinds: no positions at all.
 */
export function rotationSeats(seats, { phase, isStudGame } = {}) {
  if (isStudGame === true || !Array.isArray(seats)) return [];
  const handOn = typeof phase === 'string' && phase !== '' && phase !== 'WaitingForPlayers';
  const out = [];
  seats.forEach((s, i) => {
    if (!s || typeof s !== 'object' || s.state !== 'occupied' || s.eliminated === true) return;
    if (handOn && s.hasCards === false && s.folded === true && !satOutAtDeal(s)) return;
    out.push(Number.isInteger(s.seatIndex) ? s.seatIndex : i);
  });
  return out;
}

const POSITION_LABELS = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO', ''];

/**
 * This hand's real blind seats when the server sends them (G175 fix-up):
 * `smallBlindSeat` (-1 = a dead small blind) and `bigBlindSeat`. With the TDA
 * dead small blind / dead button (poker-server S2 F11 / F13) the blinds are
 * no longer "the next two seats after the button", so walking from the button
 * labelled the real big blind SB and UTG BB. `deadSmallBlind: true` also
 * means no small blind. null when either seat is missing (an older server):
 * the button walk below, as before.
 * → null | { sb, bb }
 */
export function blindSeatsOf(gs) {
  if (!gs || typeof gs !== 'object') return null;
  const { smallBlindSeat: sb, bigBlindSeat: bb } = gs;
  if (!Number.isInteger(bb) || bb < 0 || !Number.isInteger(sb) || sb < -1) return null;
  return { sb: gs.deadSmallBlind === true ? -1 : sb, bb };
}

/**
 * The badge from the server's blind seats (G175 fix-up): BTN = the button
 * seat (none when the button is dead on an empty seat), SB / BB = the seats
 * the server named (no SB when it is dead), heads-up BTN/SB + BB; UTG.., HJ,
 * CO = the rotation seats after the big blind, up to the button (or the small
 * blind when the button seat is not before it), numbered as on a full ring.
 */
function positionFromBlinds(seatIndex, btn, { sb, bb }, rotation, seatCount) {
  if (!rotation.includes(seatIndex)) return '';
  const isBtn = Number.isInteger(btn) && btn >= 0 && seatIndex === btn;
  if (isBtn && seatIndex === sb) return 'BTN/SB';
  if (seatIndex === bb) return 'BB';
  if (isBtn) return 'BTN';
  if (sb >= 0 && seatIndex === sb) return 'SB';
  const dist = (x) => (((x - bb) % seatCount) + seatCount) % seatCount;
  const stops = [btn, sb].filter((x) => Number.isInteger(x) && x >= 0 && x !== bb).map(dist);
  const end = stops.length > 0 ? Math.min(...stops) : seatCount;
  const after = rotation.filter((x) => x !== bb && dist(x) > 0 && dist(x) < end).sort((a, b) => dist(a) - dist(b));
  const j = after.indexOf(seatIndex);
  if (j === -1) return '';
  const n = 3 + after.length;
  const pos = 3 + j;
  if (pos === n - 1) return 'CO';
  if (pos === n - 2 && n >= 5) return 'HJ';
  return POSITION_LABELS[pos] ?? '';
}

/**
 * The seat's position badge from the button (G175): heads-up BTN/SB + BB;
 * 3-handed BTN / SB / BB (the big blind read "CO"); then UTG.., HJ, CO.
 * '' when the seat is not in `rotation` or there is no button yet.
 * `blinds` (`blindSeatsOf`): the server's own SB / BB seats this hand — used
 * when present (dead small blind, dead button); else the button walk.
 */
export function positionLabel(seatIndex, dealerButtonSeat, rotation, seatCount = 9, blinds = null) {
  if (!Array.isArray(rotation) || rotation.length < 2) return '';
  if (blinds && Number.isInteger(blinds.bb) && blinds.bb >= 0 && Number.isInteger(blinds.sb)) {
    return positionFromBlinds(seatIndex, dealerButtonSeat, blinds, rotation, seatCount);
  }
  if (!Number.isInteger(dealerButtonSeat) || dealerButtonSeat < 0) return '';
  const sorted = [...rotation].sort((a, b) => {
    const da = (a - dealerButtonSeat + seatCount) % seatCount;
    const db = (b - dealerButtonSeat + seatCount) % seatCount;
    return da - db;
  });
  const pos = sorted.indexOf(seatIndex);
  if (pos === -1) return '';
  const n = sorted.length;
  if (n === 2) return pos === 0 ? 'BTN/SB' : 'BB';
  if (pos <= 2) return POSITION_LABELS[pos];
  if (pos === n - 1) return 'CO';
  if (pos === n - 2 && n >= 5) return 'HJ';
  return POSITION_LABELS[pos] ?? '';
}

// ── Winner banner / showdown overlay (F19 / F20 / F23) ──────────────────────

/**
 * Sit & Go fix-all F20 (owner 2026-10-23) — auto-muck. At a showdown that is
 * not an all-in, poker-server mucks a losing hand that does not have to be
 * shown (TDA show order): `handResult.muckedSeats` lists them, their cards are
 * never sent and `showdownHands` keeps only the viewer's OWN mucked entry.
 * An older server sends no list: nothing is mucked here.
 */
export const MUCKED_TEXT = 'Mucked';
export const OWN_MUCKED_TEXT = 'Mucked - only you see your cards';

function muckedSeatSet(handResult) {
  const list = handResult && Array.isArray(handResult.muckedSeats) ? handResult.muckedSeats : [];
  return new Set(list.filter((s) => Number.isInteger(s) && s >= 0));
}

/** Was the viewer's own hand mucked (he still sees it, nobody else does)? */
export function ownHandMucked(handResult, yourSeat) {
  return Number.isInteger(yourSeat) && yourSeat >= 0 && muckedSeatSet(handResult).has(yourSeat);
}

/** The OTHER players' mucked hands for the showdown panel: [{ seatIndex, playerName }]. */
export function muckedShowdownRows(handResult, seats, yourSeat) {
  const out = [];
  for (const seat of muckedSeatSet(handResult)) {
    if (seat === yourSeat) continue;
    const s = Array.isArray(seats) ? seats[seat] : null;
    out.push({ seatIndex: seat, playerName: safeName(s && s.playerName, '') || `Seat ${seat + 1}` });
  }
  return out.sort((a, b) => a.seatIndex - b.seatIndex);
}

/**
 * The server's per-pot list can name every pot's winners (F19 / F20): every
 * pot with chips in it lists at least one winner. A fold-won pot or an Omaha
 * Hi-Lo pot from an older server lists none — then the totals are used.
 */
export function perPotUsable(handResult) {
  const pb = handResult && Array.isArray(handResult.potBreakdown) ? handResult.potBreakdown : [];
  return pb.length > 0 && pb.every((p) => !(Number(p && p.amount) > 0)
    || (Array.isArray(p && p.winnerAmounts) && p.winnerAmounts.length > 0));
}

/**
 * One pot's winners, one row per seat (amounts of the same seat summed — an
 * older server listed a hi-lo scooper twice, and showing only one entry
 * halved his win), in the order the server listed them.
 */
export function potWinnerRows(pot) {
  const list = pot && Array.isArray(pot.winnerAmounts) ? pot.winnerAmounts : [];
  const bySeat = new Map();
  for (const wa of list) {
    if (!wa || !Number.isInteger(wa.seatIndex) || wa.seatIndex < 0) continue;
    const amount = Number(wa.amount);
    bySeat.set(wa.seatIndex, (bySeat.get(wa.seatIndex) || 0) + (Number.isFinite(amount) ? amount : 0));
  }
  return [...bySeat].map(([seatIndex, amount]) => ({ seatIndex, amount }));
}

/**
 * The winner banner's lines: per pot when `perPotUsable`, else one line per
 * winner from the totals (a fold win, an older server's hi-lo pot).
 * → [{ name, amount, potName, potIndex, seatIndex, handName }]
 */
export function winnerBannerLines(handResult) {
  const winners = handResult && Array.isArray(handResult.winners) ? handResult.winners.filter(Boolean) : [];
  if (perPotUsable(handResult)) {
    const lines = handResult.potBreakdown.flatMap((pot, potIndex) => potWinnerRows(pot).map((wa) => {
      const winnerInfo = winners.find((w) => w.seatIndex === wa.seatIndex);
      return {
        name: safeName(winnerInfo && winnerInfo.playerName, '') || `Seat ${wa.seatIndex + 1}`,
        amount: wa.amount,
        potName: safeName(pot && pot.name, '') || 'Main Pot',
        potIndex,
        seatIndex: wa.seatIndex,
        handName: (winnerInfo && winnerInfo.handName) || '',
      };
    }));
    if (lines.length > 0) return lines;
  }
  // A winner's total over several pots is not "Main Pot".
  const potCount = handResult && Array.isArray(handResult.potBreakdown) ? handResult.potBreakdown.length : 0;
  return winners.map((w) => ({
    name: safeName(w.playerName, 'Player'),
    amount: Number(w.chipsWon) || 0,
    potName: potCount > 1 ? 'Total' : 'Main Pot',
    potIndex: 0,
    seatIndex: w.seatIndex,
    handName: w.handName || '',
  }));
}

// ── Hand names / equity per variant (F128 / G170) ───────────────────────────

const variantOf = (gs) => String((gs && gs.variant) || 'texas-holdem').toLowerCase();

/**
 * The client's hand evaluator ranks hands like the server only in Hold'em
 * (Pineapple included) and Omaha (F128). Short Deck has its own order, Omaha
 * Hi-Lo names a low half, Stud / Razz / Draw / Badugi are not board games:
 * there the server's hand name is the truth.
 */
export function clientNamesMatchServer(gs) {
  if (!gs || gs.isStudGame === true || gs.hasDrawPhase === true) return false;
  const v = variantOf(gs);
  return v === 'texas-holdem' || v === 'pineapple' || v === 'crazy-pineapple'
    || v === 'omaha' || v === 'omaha-5' || v === 'omaha-6';
}

/**
 * A showdown row's hand name (F128): the client's detailed name (kickers)
 * where its evaluator matches the server's ranking, else the server's.
 */
export function showdownRowHandName(hand, communityCards, gs, evaluate) {
  const serverName = (hand && hand.handName) || '';
  const hole = hand && Array.isArray(hand.holeCards) ? hand.holeCards : [];
  const board = Array.isArray(communityCards) ? communityCards : [];
  if (!clientNamesMatchServer(gs) || hole.length === 0 || board.length < 3 || typeof evaluate !== 'function') return serverName;
  try {
    const r = evaluate(hole, board, { variant: variantOf(gs) });
    return (r && r.detailedName) || serverName;
  } catch {
    return serverName;
  }
}

/**
 * The equity badges' simulation for this table (G170): the worker is a
 * high-hand Hold'em / Omaha Monte Carlo. Stud, Razz, Draw, Badugi, Short
 * Deck (other ranking) and Omaha Hi-Lo (split pots) get no badges (null)
 * rather than a number that contradicts the server's winner.
 * → null | { omaha: boolean }
 */
export function equitySimFor(gs) {
  if (!gs || gs.isStudGame === true || gs.hasDrawPhase === true) return null;
  const v = variantOf(gs);
  if (v === 'texas-holdem' || v === 'pineapple' || v === 'crazy-pineapple') return { omaha: false };
  if (v === 'omaha' || v === 'omaha-5' || v === 'omaha-6') return { omaha: true };
  return null;
}

// ── Hand boundary (G171) ────────────────────────────────────────────────────

/**
 * A new hand was dealt at the same table (G171): the hand number went up.
 * A table switch (multi-table) or the first frame after joining is not one.
 * Stud never shows 'PreFlop', so counting PreFlop entries counted nothing.
 * `prev` / `next`: { tableId, handNumber }.
 */
export function isNextHandAtSameTable(prev, next) {
  if (!prev || !next || prev.tableId == null || next.tableId == null) return false;
  if (String(prev.tableId) !== String(next.tableId)) return false;
  const a = Number(prev.handNumber);
  const b = Number(next.handNumber);
  return Number.isFinite(a) && Number.isFinite(b) && b > a;
}

/**
 * The rabbit hunt deals the board a folded player would have seen: only a
 * board game has one (G171 — Stud / Draw answered nothing, a dead button),
 * and only while the board is not complete — with all 5 cards out (a river
 * bet folded to, a showdown) the server has nothing to deal and answers
 * nothing (computeRabbitBoard: `communityCards.length >= 5` → []).
 */
export function rabbitHuntOffered(gs) {
  if (!gs || gs.isStudGame === true || gs.hasDrawPhase === true) return false;
  const board = Array.isArray(gs.communityCards) ? gs.communityCards.length : 0;
  return board < 5;
}
