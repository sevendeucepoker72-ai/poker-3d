/**
 * 2026-11-25 (owner: "for all online tournaments to be able to see who is
 * registered in the lobby and a list for it to show who busted in each
 * position") - the two lobby lists, as PURE functions (AGENT.md rule 22: no
 * React, no imports; tests/broadcast/tournamentLists.test.mjs loads this file
 * in Node).
 *
 * 1. REGISTERED: every lobby card (qualifier list item AND tournament list
 *    item) may carry `registrantNames: string[]` - the server's PUBLIC names
 *    ("Stacy L.", an alias, or "Player"), in registration order, each person
 *    once. Absent (an older server) = no Registered control at all. Names are
 *    never de-duplicated here (two people can share "John S."): the server
 *    already lists each person once.
 * 2. RESULTS: `getTournamentStandings({tournamentId})` answers
 *    {tournamentId, name, status, eliminationOrder, players:[{playerId (opaque
 *    per-tournament token), playerName (public), chipCount, finishPosition}]}
 *    for a running AND (newer server) a finished event. The finish-order list
 *    shows each busted player with the place the SERVER stored
 *    (`finishPosition`: ties, chops, hand-for-hand places and re-entry shifts
 *    are all decided there) - this module never computes a place. A player who
 *    busted and re-entered is one row (poker-server reinstateForReentry resets
 *    his row to alive, same playerId); a repeated token is still shown once
 *    (alive wins, else the better stored place).
 */

/** At most this many names are kept from one list item (bounded payload / DOM). */
export const REGISTRANT_NAMES_MAX = 2000;
/** A shown name is cut to this many characters (the server's public names are short). */
export const LIST_NAME_MAX = 40;
/** A row with no usable name (never an id or a username). */
export const LIST_NAME_FALLBACK = 'Player';

export const REGISTERED_EMPTY_TEXT = 'No one has registered yet.';
export const RESULTS_BUTTON_TEXT = 'Results';
export const RESULTS_TITLE_TEXT = 'Results';
export const RESULTS_LOADING_TEXT = 'Loading the results…';
export const RESULTS_UNAVAILABLE_TEXT = 'These results are no longer available.';
export const FINISH_ORDER_NOTE_TEXT = 'Most recent bust first';
export const FINISH_ORDER_EMPTY_TEXT = 'No one has busted yet.';
export const FINISH_LIST_VIEW_TEXT = 'Finish order';
export const CARDS_VIEW_TEXT = 'Cards';

function cleanName(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, LIST_NAME_MAX) : null;
}

/**
 * The item's `registrantNames` as shown: string[] (empty = nobody yet), or
 * null when the server did not send the field (no Registered control).
 * Non-string / blank entries are dropped, never replaced by an id.
 */
export function registrantNamesOf(item) {
  if (!item || typeof item !== 'object' || !Array.isArray(item.registrantNames)) return null;
  const out = [];
  for (const v of item.registrantNames) {
    const n = cleanName(v);
    if (n) out.push(n);
    if (out.length >= REGISTRANT_NAMES_MAX) break;
  }
  return out;
}

/** "Registered (12)" - the control's label (the count is the people listed). */
export function registeredLabel(names) {
  const n = Array.isArray(names) ? names.length : 0;
  return `Registered (${n})`;
}

/** English ordinal, same rule as qualifierList.ordinal ('' for anything but a positive integer). */
export function ordinalOf(n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v <= 0) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const m = v % 100;
  return v + (s[(m - 20) % 10] || s[m] || s[0]);
}

function placeOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function chipsOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** "12,500" (en-US grouping on every device, so a test and a phone agree). */
export function chipsText(n) {
  const v = chipsOf(n);
  return v === null ? '' : v.toLocaleString('en-US');
}

/**
 * A standings answer -> the lists the Results view draws, or null (no answer /
 * the server knows no such tournament).
 *   { tournamentId, name, status, finished, registering,
 *     stillIn: [{key, name, chips}]            chips high to low,
 *     busted:  [{key, name, place, placeText, tied}]  best stored place first
 *                                              = the most recent bust first,
 *     total }
 * Equal stored places (should the server ever store a shared place) keep the
 * server's elimination order, newest first.
 */
export function standingsLists(standings) {
  if (!standings || typeof standings !== 'object') return null;
  const status = typeof standings.status === 'string' && standings.status ? standings.status : 'running';
  const order = Array.isArray(standings.eliminationOrder) ? standings.eliminationOrder.map((x) => String(x)) : [];
  const orderAt = new Map();
  order.forEach((id, i) => orderAt.set(id, i));
  const rows = Array.isArray(standings.players) ? standings.players : [];
  const byKey = new Map();
  rows.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const key = p.playerId != null && p.playerId !== '' ? String(p.playerId) : `row-${i}`;
    const row = {
      key,
      name: cleanName(p.playerName) || LIST_NAME_FALLBACK,
      chips: chipsOf(p.chipCount),
      place: placeOf(p.finishPosition),
      tied: p.tied === true,
      at: i,
    };
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, row); return; }
    // One person once: an alive row wins, else the better stored place.
    if (prev.place === null) return;
    if (row.place === null || row.place < prev.place) byKey.set(key, row);
  });
  const all = [...byKey.values()];
  const stillIn = all.filter((r) => r.place === null)
    .sort((a, b) => ((b.chips ?? -1) - (a.chips ?? -1)) || (a.at - b.at))
    .map((r) => ({ key: r.key, name: r.name, chips: r.chips }));
  const recency = (r) => (orderAt.has(r.key) ? orderAt.get(r.key) : -1);
  const busted = all.filter((r) => r.place !== null)
    .sort((a, b) => (a.place - b.place) || (recency(b) - recency(a)) || (a.at - b.at))
    .map((r) => ({
      key: r.key,
      name: r.name,
      place: r.place,
      placeText: ordinalOf(r.place) + (r.tied ? ' (tie)' : ''),
      tied: r.tied,
    }));
  return {
    tournamentId: standings.tournamentId != null ? String(standings.tournamentId) : null,
    name: cleanName(standings.name) || '',
    status,
    finished: status === 'finished',
    registering: status === 'registering',
    stillIn,
    busted,
    total: all.length,
  };
}

/** The heading over the players not yet out: "Still in (N)"; "Registered (N)" before the start; "Not placed (N)" once it ended. */
export function stillInHeading(lists) {
  const n = lists && Array.isArray(lists.stillIn) ? lists.stillIn.length : 0;
  if (lists && lists.registering) return `Registered (${n})`;
  if (lists && lists.finished) return `Not placed (${n})`;
  return `Still in (${n})`;
}

/** The heading over the busted players: "Finish order (N)" while it runs, "Final results (N)" once it ended. */
export function finishOrderHeading(lists) {
  const n = lists && Array.isArray(lists.busted) ? lists.busted.length : 0;
  return lists && lists.finished ? `Final results (${n})` : `Finish order (${n})`;
}

/** What the Results view shows, section by section (the JSX only draws it). */
export function finishListSections(lists) {
  if (!lists) return { unavailable: true, text: RESULTS_UNAVAILABLE_TEXT, sections: [] };
  const sections = [];
  if (lists.stillIn.length > 0) {
    sections.push({ kind: 'stillIn', heading: stillInHeading(lists), rows: lists.stillIn });
  }
  if (!lists.registering) {
    sections.push({
      kind: 'busted',
      heading: finishOrderHeading(lists),
      note: !lists.finished && lists.busted.length > 1 ? FINISH_ORDER_NOTE_TEXT : '',
      empty: lists.busted.length === 0 ? FINISH_ORDER_EMPTY_TEXT : '',
      rows: lists.busted,
    });
  }
  return { unavailable: false, text: '', sections };
}

/** One finish row as words ("24th  Paula G.") - the screen reader line and the tests. */
export function finishRowText(row) {
  if (!row) return '';
  return `${row.placeText}  ${row.name}`;
}

/**
 * The Results view's starting view for a bracket request: the finish-order
 * list when it was opened from a Results control or for a finished event,
 * else the Live Bracket's cards (unchanged).
 */
export function initialBracketView({ results = false, status = null } = {}) {
  return results || status === 'finished' ? 'list' : 'cards';
}

/**
 * A finished answer needs no more polling (it does not change); a running one
 * (or none yet) is asked again.
 */
export function standingsNeedPolling(answer) {
  return !(answer && typeof answer === 'object' && answer.status === 'finished');
}
