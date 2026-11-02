/**
 * Text for the broadcast table (lead spec C2, 2026-11-01): chip counts, big
 * blinds, the action strip and the winner line. Pure; play money only, so a
 * number is always "chips", never a currency.
 */
import { isObj } from './contract.js';
import { broadcastName } from './broadcastNames.js';

/** 12,400 / 1.25M — the chip count as shown on air. */
export function formatChips(n) {
  if (!Number.isFinite(n)) return '0';
  const v = Math.max(0, Math.round(n));
  if (v >= 10_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}M`;
  return v.toLocaleString('en-US');
}

/** '24.5 BB' (one decimal under 10 BB, whole numbers above), or '' without a big blind. */
export function bbText(chips, bb) {
  if (!Number.isFinite(chips) || !Number.isFinite(bb) || bb <= 0) return '';
  const n = chips / bb;
  return `${n < 10 ? (Math.round(n * 10) / 10).toString() : Math.round(n).toLocaleString('en-US')} BB`;
}

/** 'Blinds 200/400 · ante 50' from a frame's handLevel. */
export function levelText(level) {
  if (!isObj(level) || !Number.isFinite(level.sb) || !Number.isFinite(level.bb)) return '';
  const ante = Number.isFinite(level.ante) && level.ante > 0 ? ` · ante ${formatChips(level.ante)}` : '';
  return `Blinds ${formatChips(level.sb)}/${formatChips(level.bb)}${ante}`;
}

const PHASE_TEXT = {
  WaitingForPlayers: 'Waiting',
  PreFlop: 'Pre-flop',
  Flop: 'Flop',
  Turn: 'Turn',
  River: 'River',
  Showdown: 'Showdown',
  HandComplete: 'Hand complete',
};

export function phaseText(phase) {
  return PHASE_TEXT[phase] || '';
}

function seatOf(frame, seatIndex) {
  return isObj(frame) && Array.isArray(frame.seats)
    ? frame.seats.find((s) => isObj(s) && s.seatIndex === seatIndex) || null
    : null;
}

/** 'J. S. raises to 2,400' — the server's action text with the seat's on-air name. */
export function actionLine(frame) {
  const la = isObj(frame) ? frame.lastAction : null;
  if (!isObj(la) || typeof la.text !== 'string' || !la.text.trim()) return '';
  const name = broadcastName(seatOf(frame, la.seatIndex), la.seatIndex);
  const text = la.text.trim().slice(0, 60);
  const amount = Number.isFinite(la.amount) && la.amount > 0 && !/\d/.test(text) ? ` ${formatChips(la.amount)}` : '';
  return `${name} ${text}${amount}`;
}

/** ['J. S. wins 12,400 with a Full House', ...] — one line per winner. */
export function winnerLines(frame) {
  const hr = isObj(frame) ? frame.handResult : null;
  if (!isObj(hr) || !Array.isArray(hr.winners)) return [];
  return hr.winners.filter(isObj).slice(0, 6).map((w) => {
    const name = broadcastName(w.name ? w : seatOf(frame, w.seatIndex), w.seatIndex);
    const hand = typeof w.handName === 'string' && w.handName.trim() ? ` with ${w.handName.trim()}` : '';
    return `${name} wins ${formatChips(w.amount)}${hand}`;
  });
}

/** Seat indexes that won the hand. */
export function winnerSeats(frame) {
  const hr = isObj(frame) ? frame.handResult : null;
  if (!isObj(hr) || !Array.isArray(hr.winners)) return [];
  return hr.winners.filter((w) => isObj(w) && Number.isInteger(w.seatIndex)).map((w) => w.seatIndex);
}

/**
 * The pots to draw: side pots when the server sent them, else the one pot. At
 * most three short pills (the centre of the felt has room for no more): the
 * main pot, side 1, and the rest summed as 'Sides 2-N'.
 */
export function potRows(frame) {
  if (!isObj(frame)) return [];
  const pots = Array.isArray(frame.pots) ? frame.pots.filter((p) => isObj(p) && Number.isFinite(p.amount) && p.amount > 0) : [];
  if (pots.length > 3) {
    const rest = pots.slice(2).reduce((sum, p) => sum + p.amount, 0);
    return [
      { label: 'Main', amount: pots[0].amount },
      { label: 'Side 1', amount: pots[1].amount },
      { label: `Sides 2-${pots.length - 1}`, amount: rest },
    ];
  }
  if (pots.length > 1) return pots.map((p, i) => ({ label: i === 0 ? 'Main' : `Side ${i}`, amount: p.amount }));
  const total = Number.isFinite(frame.pot) ? frame.pot : (pots[0] ? pots[0].amount : 0);
  return total > 0 ? [{ label: 'Pot', amount: total }] : [];
}

/** 0..1 of the active seat's turn clock gone at program time `programNow`, or null. */
export function turnFraction(frame, programNow) {
  if (!isObj(frame) || !Number.isFinite(frame.turnStartedAt) || !Number.isFinite(frame.turnTimeout)) return null;
  if (!(frame.turnTimeout > 0) || !Number.isFinite(programNow)) return null;
  return Math.min(1, Math.max(0, (programNow - frame.turnStartedAt) / frame.turnTimeout));
}
