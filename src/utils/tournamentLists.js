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
 *
 * 2026-11-26 review round 2: rows may carry the server's `tied: true` (a TDA
 * tie: same hand, equal stacks) and `disqualified: true`; the Results window
 * names an earlier event ("Last results - Online League, Wed Nov 25", the
 * standings' `finishedAt` on the Denver clock); a slow answer is never "no
 * longer available". Imports only the pure utils/denverTime.js (no React).
 */

import { ECONOMY_TIME_ZONE, toEpochMs } from './denverTime.js';

/** At most this many names are kept from one list item (bounded payload / DOM). */
export const REGISTRANT_NAMES_MAX = 2000;
/** A shown name is cut to this many characters (the server's public names are short). */
export const LIST_NAME_MAX = 40;
/** A row with no usable name (never an id or a username). */
export const LIST_NAME_FALLBACK = 'Player';

export const REGISTERED_EMPTY_TEXT = 'No one has registered yet.';
export const RESULTS_BUTTON_TEXT = 'Results';
/** The Results control of a card whose results are an EARLIER run's (a registering Sit & Go, an upcoming qualifier). */
export const LAST_RESULTS_BUTTON_TEXT = 'Last results';
export const RESULTS_TITLE_TEXT = 'Results';
export const RESULTS_LOADING_TEXT = 'Loading the results…';
export const RESULTS_UNAVAILABLE_TEXT = 'These results are no longer available.';
/** Results mode, the game server has not answered within 8 s: still asking (never "no longer available"). */
export const RESULTS_SLOW_TEXT = 'Still loading the results… the game server is slow to answer.';
/** The Results window's title when it shows an EARLIER event than the card's own ("Last results - <name>, <day>"). */
export const LAST_RESULTS_TITLE_TEXT = 'Last results';
/** A row the server marks `disqualified: true`: this instead of a place. */
export const DISQUALIFIED_TEXT = 'Disqualified';
/** After the shared place of rows the server marks `tied: true` ("3rd (tie)"). */
export const TIE_SUFFIX_TEXT = ' (tie)';
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

/**
 * 2026-11-26 review fix (a Sit & Go's / template event's Results vanished
 * about 10 s after its final hand) - the tournament whose finish order a
 * TOURNAMENT lobby card opens, or null (no Results control).
 * poker-server drops a finished template instance's record 10 s after the
 * finish (its 'finished' card leaves the list with it) but keeps the finished
 * roster >= 24 h and points the template's REGISTERING card at it:
 * `resultsTournamentId` (getTournamentList; its own id while running /
 * finished, the latest finished run of the same template on a registering
 * card, null when none is kept). That id wins; without it (an older server,
 * or null) a running / finished card opens its own id - the rule before the
 * field existed. Never for a cancelled event.
 */
export function tournamentResultsTournamentId(t) {
  if (!t || typeof t !== 'object' || t.status === 'cancelled') return null;
  const v = t.resultsTournamentId;
  if ((typeof v === 'string' && v.trim()) || (typeof v === 'number' && Number.isFinite(v))) return String(v);
  if ((t.status === 'running' || t.status === 'finished') && t.tournamentId != null && t.tournamentId !== '') {
    return String(t.tournamentId);
  }
  return null;
}

/**
 * The words on a card's Results control: "Results" when it opens the card's
 * OWN event, "Last results" when the server points it at an earlier run (a
 * registering Sit & Go's previous instance, an upcoming qualifier's last
 * finished one). `ownTournamentId` undefined (the caller did not say) =
 * "Results", the words before this rule.
 */
export function resultsButtonLabel(resultsId, ownTournamentId) {
  return isLastResults(resultsId, ownTournamentId) ? LAST_RESULTS_BUTTON_TEXT : RESULTS_BUTTON_TEXT;
}

/**
 * 2026-11-26 — true when a card's Results control opens an EARLIER event than
 * the card's own (its "Last results"): the Results window then names that
 * event (lastResultsTitle). `ownTournamentId` undefined (the caller did not
 * say) = false, the behaviour before this rule.
 */
export function isLastResults(resultsId, ownTournamentId) {
  if (ownTournamentId === undefined) return false;
  const own = ownTournamentId !== null && ownTournamentId !== '' && resultsId != null
    && String(ownTournamentId) === String(resultsId);
  return !own;
}

let denverDayFmt = null;
let denverClockFmt = null;
const tidySpaces = (s) => String(s).replace(/[\u202f\u00a0]/g, ' ');

/** "Wed Nov 25" - the day an event finished, on the Denver clock ('' without a usable time). */
export function finishedDayText(finishedAt) {
  const v = toEpochMs(finishedAt);
  if (v == null) return '';
  try {
    if (!denverDayFmt) denverDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: ECONOMY_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' });
    return tidySpaces(denverDayFmt.format(new Date(v))).replace(',', '');
  } catch { return ''; }
}

/** "Wed Nov 25, 10:45 PM MT" - when an event finished, on the Denver clock ('' without a usable time). */
export function finishedWhenText(finishedAt) {
  const day = finishedDayText(finishedAt);
  if (!day) return '';
  try {
    if (!denverClockFmt) denverClockFmt = new Intl.DateTimeFormat('en-US', { timeZone: ECONOMY_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
    return `${day}, ${tidySpaces(denverClockFmt.format(new Date(toEpochMs(finishedAt))))} MT`;
  } catch { return day; }
}

/**
 * The Results window's title for an EARLIER event (opened from "Last results"
 * on an upcoming / registering card): "Last results - Online League, Wed Nov
 * 25" from the STANDINGS' own name and `finishedAt` (Denver day), so it never
 * reads as tonight's event being over. Either part missing is left out.
 */
export function lastResultsTitle(name, finishedAt) {
  const parts = [cleanName(name), finishedDayText(finishedAt)].filter(Boolean);
  return parts.length ? `${LAST_RESULTS_TITLE_TEXT} - ${parts.join(', ')}` : LAST_RESULTS_TITLE_TEXT;
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
 *   { tournamentId, name, status, finished, registering, finishedAt,
 *     stillIn: [{key, name, chips}]            chips high to low,
 *     busted:  [{key, name, place, shownPlace, placeText, tied, disqualified}]
 *              best stored place first = the most recent bust first; the
 *              server's disqualified rows last,
 *     total }
 * Equal stored places (should the server ever store a shared place) keep the
 * server's elimination order, newest first.
 * 2026-11-26 (review round 2) — two OPTIONAL server row fields, nothing
 * without them (today's display):
 *  - `tied: true` (poker-server TournamentManager tieGroup, 2+ members: busted
 *    in the same hand with equal stacks; they split their places' prize). The
 *    server stores each tied player his own consecutive number (3, 4); the
 *    rows of one run of consecutive tied places show the run's BEST stored
 *    place, "3rd (tie)" both (`shownPlace`; `place` stays the stored one). A
 *    lone tied row is shown as stored, with no "(tie)". Limit: two DIFFERENT
 *    ties on directly adjacent places read as one run (rows carry no group).
 *  - `disqualified: true`: "Disqualified" and no place, listed after every
 *    placed row (also a disqualified row the server sent without a place).
 */
export function standingsLists(standings) {
  if (!standings || typeof standings !== 'object') return null;
  const status = typeof standings.status === 'string' && standings.status ? standings.status : 'running';
  const order = Array.isArray(standings.eliminationOrder) ? standings.eliminationOrder.map((x) => String(x)) : [];
  const orderAt = new Map();
  order.forEach((id, i) => orderAt.set(id, i));
  const rows = Array.isArray(standings.players) ? standings.players : [];
  const byKey = new Map();
  // Out = a stored place, or disqualified (a DQ is never "still in").
  const isOut = (r) => r.place !== null || r.disqualified;
  const placeRank = (r) => (r.place === null ? Number.MAX_SAFE_INTEGER : r.place);
  rows.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const key = p.playerId != null && p.playerId !== '' ? String(p.playerId) : `row-${i}`;
    const row = {
      key,
      name: cleanName(p.playerName) || LIST_NAME_FALLBACK,
      chips: chipsOf(p.chipCount),
      place: placeOf(p.finishPosition),
      tied: p.tied === true,
      disqualified: p.disqualified === true,
      at: i,
    };
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, row); return; }
    // One person once: an alive row wins, else the better stored place.
    if (!isOut(prev)) return;
    if (!isOut(row) || placeRank(row) < placeRank(prev)) byKey.set(key, row);
  });
  const all = [...byKey.values()];
  const stillIn = all.filter((r) => !isOut(r))
    .sort((a, b) => ((b.chips ?? -1) - (a.chips ?? -1)) || (a.at - b.at))
    .map((r) => ({ key: r.key, name: r.name, chips: r.chips }));
  const recency = (r) => (orderAt.has(r.key) ? orderAt.get(r.key) : -1);
  const byPlace = (a, b) => (placeRank(a) - placeRank(b)) || (recency(b) - recency(a)) || (a.at - b.at);
  const placed = all.filter((r) => isOut(r) && !r.disqualified).sort(byPlace);
  const disqualified = all.filter((r) => r.disqualified).sort(byPlace);
  // Runs of consecutive tied places (equal or +1): one tie each.
  const runs = [];
  for (const r of placed) {
    const run = runs[runs.length - 1];
    const last = run && run[run.length - 1];
    if (r.tied && last && last.tied && r.place - last.place <= 1) run.push(r);
    else runs.push([r]);
  }
  const busted = [];
  for (const run of runs) {
    const tie = run.length >= 2 && run[0].tied;
    for (const r of run) {
      const shownPlace = tie ? run[0].place : r.place;
      busted.push({
        key: r.key,
        name: r.name,
        place: r.place,
        shownPlace,
        placeText: ordinalOf(shownPlace) + (tie ? TIE_SUFFIX_TEXT : ''),
        tied: tie,
        disqualified: false,
      });
    }
  }
  for (const r of disqualified) {
    busted.push({
      key: r.key, name: r.name, place: r.place, shownPlace: null, placeText: DISQUALIFIED_TEXT, tied: false, disqualified: true,
    });
  }
  return {
    tournamentId: standings.tournamentId != null ? String(standings.tournamentId) : null,
    name: cleanName(standings.name) || '',
    status,
    finished: status === 'finished',
    registering: status === 'registering',
    finishedAt: toEpochMs(standings.finishedAt),
    stillIn,
    busted,
    total: all.length,
  };
}

/** A busted row on the bracket's CARDS view: "3rd place", "3rd place (tie)", "Disqualified" (same rule as the list). */
export function finishCardText(row) {
  if (!row) return '';
  if (row.disqualified) return DISQUALIFIED_TEXT;
  const n = ordinalOf(row.shownPlace ?? row.place);
  return n ? `${n} place${row.tied ? TIE_SUFFIX_TEXT : ''}` : '';
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
 * 2026-11-26 (review round 2) — `forId`: the bracket asked for ONE tournament
 * by id. A null answer then means the server keeps no such tournament (past
 * the >= 24 h keep, or gone): it is not asked again every 3 s (a later real
 * answer, e.g. a stray null from an earlier window, starts polling again).
 * Without an id (the Live Bracket's "any running one") a null is asked again,
 * as before: one may start.
 */
export function standingsNeedPolling(answer, { forId = false } = {}) {
  if (!answer || typeof answer !== 'object') return !forId;
  return answer.status !== 'finished';
}

/**
 * Lobby -> TournamentBracket `loading`. `answered` = a REAL standings frame
 * (or a null one) arrived; `slow` = the 8 s watchdog fired with none. Results
 * mode keeps loading until a real answer (a slow server is never "no longer
 * available"); the Live Bracket gives up at the watchdog, as before ("No
 * tournament running").
 */
export function bracketLoading({ results = false, answered = false, slow = false } = {}) {
  return results ? !answered : (!answered && !slow);
}

/** Results mode with no list to draw: loading, still loading (slow), or a real null answer. */
export function resultsEmptyText({ loading = false, slow = false } = {}) {
  if (!loading) return RESULTS_UNAVAILABLE_TEXT;
  return slow ? RESULTS_SLOW_TEXT : RESULTS_LOADING_TEXT;
}
