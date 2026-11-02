/**
 * The bust ticker's lines (lead spec C3 + §3 TickerEvent, 2026-11-02).
 *
 * The ticker is ProgramState.ticker (newest last, at most 30) plus the
 * `bc:frame` kind 'event' items that arrived after the last program frame
 * (the store keeps 30). Both are on the PROGRAM timeline: on a delayed feed
 * the server releases them at their original time + the delay, and this
 * module also hides any item stamped after programNow (a spoiler can never
 * reach the screen early, even from a bad frame).
 *
 * Names are the server-applied `name` / `byName` only (First L., an alias, or
 * 'Player'), cleaned by broadcastNames. Play money only: an amount is chips.
 * Pure: the graphics and node:test.
 */
import { isObj } from './contract.js';
import { broadcastName } from './broadcastNames.js';
import { formatChips } from './tableFormat.js';
// 1st / 2nd / 3rd / 11th / 22nd ('' for a non-positive or missing place).
import { ordinal } from '../../utils/qualifierList.js';

export { ordinal };

export const TICKER_SHOW_MAX = 30;
/** An item up to this far past programNow still shows (clock-estimate jitter). */
export const TICKER_FUTURE_GRACE_MS = 5000;

export const TICKER_KINDS = Object.freeze([
  'bust', 'doubleUp', 'levelUp', 'breakStart', 'breakEnd', 'hfhOn', 'hfhOff', 'lateRegClosed',
  'tableBroken', 'finalTable', 'featured', 'finished',
]);

/** '1 seat' / '3 seats'. */
export function seatsWord(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return '';
  return v === 1 ? '1 seat' : `${v} seats`;
}

function nameOf(ev) {
  return broadcastName(isObj(ev) && typeof ev.name === 'string' ? ev : null);
}

function byNameOf(ev) {
  if (!isObj(ev) || typeof ev.byName !== 'string' || !ev.byName.trim()) return '';
  return broadcastName({ name: ev.byName });
}

function posInt(v) {
  return Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * One ticker event as the screen shows it, or null (unknown kind / not an event):
 * {id, t, kind, tone:'gold'|'blue'|'slate', label, text}.
 */
export function tickerItem(ev) {
  if (!isObj(ev) || !TICKER_KINDS.includes(ev.kind)) return null;
  const id = typeof ev.id === 'string' || Number.isFinite(ev.id) ? String(ev.id) : null;
  const base = { id, t: Number.isFinite(ev.t) ? ev.t : null, kind: ev.kind };
  const level = posInt(ev.level);
  const tableNo = posInt(ev.tableNo);
  switch (ev.kind) {
    case 'bust': {
      const place = ordinal(ev.place);
      const who = nameOf(ev);
      const seats = posInt(ev.seatsWon);
      const tied = ev.tied === true ? ' (tied)' : '';
      if (seats) {
        return { ...base, tone: 'gold', label: 'SEAT WON', text: `${[place, who].filter(Boolean).join(' · ')}${tied} (${seatsWord(seats)})` };
      }
      const by = byNameOf(ev);
      const prize = Number.isFinite(ev.amount) && ev.amount > 0 ? ` · ${formatChips(ev.amount)} chips` : '';
      const parts = [place, who].filter(Boolean).join(' · ');
      return { ...base, tone: prize ? 'gold' : 'slate', label: ev.handForHand === true ? 'OUT · HAND-FOR-HAND' : 'OUT', text: `${parts}${tied}${by ? ` · busted by ${by}` : ''}${prize}` };
    }
    case 'doubleUp': {
      const to = Number.isFinite(ev.amount) && ev.amount > 0 ? ` to ${formatChips(ev.amount)}` : '';
      return { ...base, tone: 'blue', label: 'DOUBLE UP', text: `${nameOf(ev)} doubles up${to}` };
    }
    case 'levelUp':
      return { ...base, tone: 'blue', label: 'LEVEL UP', text: level ? `Level ${level} begins` : 'Blinds go up' };
    case 'breakStart':
      return { ...base, tone: 'blue', label: 'BREAK', text: level ? `Break after level ${level}` : 'Players are on a break' };
    case 'breakEnd':
      return { ...base, tone: 'blue', label: 'BACK IN PLAY', text: level ? `Play resumes at level ${level}` : 'Play resumes' };
    case 'hfhOn':
      return { ...base, tone: 'gold', label: 'HAND-FOR-HAND', text: 'Hand-for-hand play begins at the seat bubble' };
    case 'hfhOff':
      return { ...base, tone: 'blue', label: 'HAND-FOR-HAND', text: 'Hand-for-hand play is over' };
    case 'lateRegClosed':
      return { ...base, tone: 'blue', label: 'LATE ENTRY', text: 'Late entry is closed' };
    case 'tableBroken':
      return { ...base, tone: 'slate', label: 'TABLE BROKEN', text: tableNo ? `Table ${tableNo} is broken, players move` : 'A table is broken, players move' };
    case 'finalTable':
      return { ...base, tone: 'gold', label: 'FINAL TABLE', text: 'The final table is set' };
    case 'featured':
      return { ...base, tone: 'blue', label: 'NOW SHOWING', text: tableNo ? `Table ${tableNo}` : 'A new table' };
    case 'finished':
      return isObj(ev) && typeof ev.name === 'string' && ev.name.trim()
        ? { ...base, tone: 'gold', label: 'CHAMPION', text: nameOf(ev) }
        : { ...base, tone: 'gold', label: 'FINISHED', text: 'The event is complete' };
    default:
      return null;
  }
}

/**
 * The program's ticker plus the event frames that came after it: de-duplicated
 * by id (the program copy wins), oldest first, items after programNow (+ grace)
 * held back, at most `max` (the newest).
 */
export function mergeTicker(programTicker, events, programNow, max = TICKER_SHOW_MAX) {
  const seen = new Set();
  const out = [];
  const take = (ev, order) => {
    if (!isObj(ev)) return;
    const key = ev.id !== undefined && ev.id !== null ? String(ev.id) : null;
    if (key !== null) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    if (Number.isFinite(programNow) && Number.isFinite(ev.t) && ev.t > programNow + TICKER_FUTURE_GRACE_MS) return;
    out.push({ ev, order });
  };
  (Array.isArray(programTicker) ? programTicker : []).forEach((ev, i) => take(ev, i));
  (Array.isArray(events) ? events : []).forEach((ev, i) => take(ev, 100000 + i));
  out.sort((a, b) => {
    const ta = Number.isFinite(a.ev.t) ? a.ev.t : 0;
    const tb = Number.isFinite(b.ev.t) ? b.ev.t : 0;
    return ta - tb || a.order - b.order;
  });
  const list = out.map((x) => x.ev);
  return list.length > max ? list.slice(list.length - max) : list;
}

/** The newest `n` formatted items, newest first. */
export function latestTickerItems(merged, n = 4) {
  const items = [];
  for (let i = (Array.isArray(merged) ? merged.length : 0) - 1; i >= 0 && items.length < n; i -= 1) {
    const it = tickerItem(merged[i]);
    if (it) items.push(it);
  }
  return items;
}
