/**
 * HoleCam rows (lead spec C2, 2026-11-02) — which seats the big-cards strip
 * draws, from holeCardGate's decision only (never from seat.holeCards). Pure.
 *
 * - Public gate: only the hands shown at a contested showdown that has ended.
 * - Delayed gate: every dealt-in seat still in the hand (a folded seat leaves
 *   the strip) — face up when the gate allows it, else card backs (a hand
 *   still live, owner HARD RULE).
 * Winners first, then seat order; at most 9 rows.
 */
import { isObj } from './contract.js';
import { winnerSeats } from './tableFormat.js';
import { formatEquity } from './equity.js';

export const HOLE_CAM_HELD_TEXT = 'Cards after the hand';

/** 2026-11-02 (P5-C2b): this many rows or more use the compact rows (cards over name). */
export const HOLE_CAM_COMPACT_ROWS = 5;

export function holeCamCompact(rowCount) {
  return Number.isInteger(rowCount) && rowCount >= HOLE_CAM_COMPACT_ROWS;
}

/**
 * 2026-11-02 (P5-C2b): the win % to print on a hole-cam row ('' = none). Only
 * a face-up row of the DELAYED gate gets one, and only from equityForFrame's
 * result for that seat.
 */
export function holeCamEquityText(equity, gate, row) {
  if (!isObj(equity) || !isObj(equity.bySeat) || !isObj(gate) || gate.mode !== 'delayed') return '';
  if (!isObj(row) || row.faceUp !== true || !isObj(row.seat)) return '';
  const e = equity.bySeat[row.seat.seatIndex];
  return isObj(e) ? formatEquity(e.equity) : '';
}

/** The hand name to print under a face-up seat (server text only). */
export function holeCamHandName(frame, seat) {
  if (isObj(seat) && typeof seat.handName === 'string' && seat.handName.trim()) return seat.handName.trim();
  const hr = isObj(frame) ? frame.handResult : null;
  const w = isObj(hr) && Array.isArray(hr.winners) ? hr.winners.find((x) => isObj(x) && x.seatIndex === seat.seatIndex) : null;
  return w && typeof w.handName === 'string' ? w.handName.trim() : '';
}

export function holeCamRows(frame, gate) {
  if (!isObj(frame) || !isObj(gate) || !isObj(gate.seats) || !Array.isArray(frame.seats)) return [];
  const winners = new Set(winnerSeats(frame));
  const rows = [];
  for (const seat of frame.seats) {
    if (!isObj(seat) || !Number.isInteger(seat.seatIndex)) continue;
    const d = gate.seats[seat.seatIndex];
    if (!d) continue;
    const faceUp = Array.isArray(d.cards);
    if (gate.mode === 'public') {
      if (!faceUp) continue;
    } else if (seat.folded === true || !(faceUp || d.backs > 0)) {
      continue;   // a folded seat leaves the strip (its plate still shows its cards)
    }
    rows.push({ seat, decision: d, faceUp, winner: winners.has(seat.seatIndex) });
  }
  rows.sort((a, b) => (Number(b.winner) - Number(a.winner)) || (a.seat.seatIndex - b.seat.seatIndex));
  return rows.slice(0, 9);
}
