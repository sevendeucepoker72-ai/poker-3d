// 2026-11-25 (owner: "for all online tournaments to be able to see who is
// registered in the lobby and a list for it to show who busted in each
// position") - the .online client half. Every lobby card (qualifier list item
// AND tournament list item) may carry `registrantNames` (public names, in
// registration order, each person once): "Registered (N)" opens them. A
// qualifier item may carry `resultsTournamentId` (the running event, else the
// latest finished one): "Results" opens that event's finish-order list in the
// lobby's bracket window, which also works for a finished event. Places are
// the SERVER's `finishPosition`, never computed here. Missing fields = today's
// card (CONTROL cases below).
// node:test, no dependency; loads the REAL modules (+ static guards on JSX/CSS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isRedHue } from '../../src/utils/noRedHue.js';

const SRC_DIR = new URL('../../src/', import.meta.url);
const T = await import(new URL('utils/tournamentLists.js', SRC_DIR).href);
const L = await import(new URL('utils/qualifierList.js', SRC_DIR).href);
const readSrc = (rel) => fs.readFileSync(new URL(rel, SRC_DIR), 'utf8');

const NOW = Date.parse('2026-11-29T19:00:00.000Z');
const weeklyRaw = (over = {}) => ({
  qualifierId: 'w-1129', type: 'weekly', name: 'Weekly Qualifier — Nov 29', status: 'scheduled',
  scheduledAt: '2026-11-29T18:00:00.000Z', signupOpensAt: '2026-11-29T15:00:00.000Z',
  signupClosesAt: '2026-11-29T21:00:00.000Z', lateRegUntil: '2026-11-29T21:00:00.000Z',
  ...over,
});

// ── Registered ──────────────────────────────────────────────────────────────

test('registrantNamesOf: absent = null (no control); names kept in order, repeats kept, junk dropped, bounded', () => {
  // CONTROL: an older server's item has no field -> null -> no Registered control.
  assert.equal(T.registrantNamesOf({ tournamentId: 't1', registeredPlayers: 4 }), null);
  assert.equal(T.registrantNamesOf(null), null);
  assert.equal(T.registrantNamesOf({ registrantNames: 'Stacy L.' }), null, 'not an array: not a list');
  assert.deepEqual(T.registrantNamesOf({ registrantNames: [] }), [], 'an empty list is "nobody yet"');
  assert.deepEqual(
    T.registrantNamesOf({ registrantNames: ['Stacy L.', '  Paula   G. ', 'John S.', 'John S.', '', null, 42, { id: 'u1' }] }),
    ['Stacy L.', 'Paula G.', 'John S.', 'John S.'],
    'registration order; two people may share a public name; non-strings are never shown',
  );
  const long = T.registrantNamesOf({ registrantNames: ['x'.repeat(200)] });
  assert.equal(long[0].length, T.LIST_NAME_MAX);
  const many = T.registrantNamesOf({ registrantNames: Array.from({ length: 5000 }, (_, i) => `P${i}`) });
  assert.equal(many.length, T.REGISTRANT_NAMES_MAX);
  assert.equal(T.registeredLabel(['a', 'b', 'c']), 'Registered (3)');
  assert.equal(T.registeredLabel([]), 'Registered (0)');
  assert.equal(T.REGISTERED_EMPTY_TEXT, 'No one has registered yet.');
});

test('qualifier items: registrantNames + resultsTournamentId pass through; an older server\'s item is today\'s (CONTROL)', () => {
  const old = L.normalizeQualifierItem(weeklyRaw());
  assert.equal(old.registrantNames, null);
  assert.equal(old.resultsTournamentId, undefined, 'not sent');
  const q = L.normalizeQualifierItem(weeklyRaw({ registrantNames: ['Stacy L.', 'Paula G.'], resultsTournamentId: 'tq-9' }));
  assert.deepEqual(q.registrantNames, ['Stacy L.', 'Paula G.']);
  assert.equal(q.resultsTournamentId, 'tq-9');
  assert.equal(L.normalizeQualifierItem(weeklyRaw({ resultsTournamentId: null })).resultsTournamentId, null, 'server says none');
  assert.equal(L.normalizeQualifierItem(weeklyRaw({ resultsTournamentId: { x: 1 } })).resultsTournamentId, null, 'junk is none, never a guess');
});

test('qualifierUpdateExtras: lists only from registrantNames / resultsTournamentId, never from an update\'s players (CONTROL)', () => {
  // CONTROL: an older server's update (status / count / its registration names) adds nothing.
  assert.deepEqual(L.qualifierUpdateExtras({ qualifierId: 'w', status: 'running', players: ['5551234567', 'joe.boss'] }), {});
  // (2026-11-26: the pointer travels with the event it belongs to; not named = null.)
  assert.deepEqual(L.qualifierUpdateExtras({ registrantNames: ['Stacy L.'], resultsTournamentId: 't-1' }), { registrantNames: ['Stacy L.'], resultsTournamentId: 't-1', resultsQualifierId: null });
  assert.deepEqual(L.qualifierUpdateExtras({ resultsTournamentId: null }), { resultsTournamentId: null, resultsQualifierId: null });
  assert.deepEqual(L.qualifierUpdateExtras({ resultsTournamentId: 't-1', resultsQualifierId: 'q-1' }), { resultsTournamentId: 't-1', resultsQualifierId: 'q-1' });
});

test('qualifierResultsTournamentId: the server\'s id; a live event\'s running id; never for cancelled / unknown finished', () => {
  const item = (over) => L.normalizeQualifierItem(weeklyRaw(over));
  assert.equal(L.qualifierResultsTournamentId(item({ status: 'finished', resultsTournamentId: 'tq-fin' }), NOW), 'tq-fin');
  assert.equal(L.qualifierResultsTournamentId(item({ status: 'running', tournamentId: 'tq-run', resultsTournamentId: 'tq-run' }), NOW), 'tq-run');
  // An older server (no field), live: the running tournament (today's server answers its standings).
  assert.equal(L.qualifierResultsTournamentId(item({ status: 'running', tournamentId: 'tq-run' }), NOW), 'tq-run');
  // The list before the start push said null; the start push set tournamentId.
  assert.equal(L.qualifierResultsTournamentId({ ...item({ status: 'running', resultsTournamentId: null }), tournamentId: 'tq-new' }, NOW), 'tq-new');
  // CONTROL: before the start / a finished event an older server does not name / cancelled: no Results.
  assert.equal(L.qualifierResultsTournamentId(item({ status: 'registering' }), NOW), null);
  assert.equal(L.qualifierResultsTournamentId(item({ status: 'finished', tournamentId: 'tq-old' }), NOW), null);
  assert.equal(L.qualifierResultsTournamentId(item({ status: 'finished', cancelled: true, resultsTournamentId: 'tq-c' }), NOW), null);
  assert.equal(L.qualifierResultsTournamentId(null, NOW), null);
});

// Review fix 2026-11-26: a Sit & Go / template event's finished card leaves
// the list 10 s after the final hand (poker-server drops the record and opens
// the next instance), so Results must follow the server's resultsTournamentId
// on the REGISTERING card (the kept roster, >= 24 h).
test('tournamentResultsTournamentId: the server\'s resultsTournamentId wins; without it, running / finished open their own id (CONTROL)', () => {
  // The bug: a registering template card pointing at its last finished run (kept >= 24 h).
  const nextSng = { tournamentId: 'sng-2', name: 'Sit & Go', status: 'registering', registeredPlayers: 1, resultsTournamentId: 'sng-1' };
  assert.equal(T.tournamentResultsTournamentId(nextSng), 'sng-1');
  assert.equal(T.resultsButtonLabel('sng-1', 'sng-2'), T.LAST_RESULTS_BUTTON_TEXT);
  assert.equal(T.LAST_RESULTS_BUTTON_TEXT, 'Last results');
  // A newer server's running / finished card names itself: "Results".
  assert.equal(T.tournamentResultsTournamentId({ tournamentId: 'sng-1', status: 'running', resultsTournamentId: 'sng-1' }), 'sng-1');
  assert.equal(T.tournamentResultsTournamentId({ tournamentId: 'sng-1', status: 'finished', resultsTournamentId: 'sng-1' }), 'sng-1');
  assert.equal(T.resultsButtonLabel('sng-1', 'sng-1'), T.RESULTS_BUTTON_TEXT);
  assert.equal(T.tournamentResultsTournamentId({ tournamentId: 7, status: 'registering', resultsTournamentId: 6 }), '6', 'numeric ids as strings');
  // CONTROL: an older server (no field) = the rule before the fix: running / finished only, its own id.
  assert.equal(T.tournamentResultsTournamentId({ tournamentId: 'c-1', status: 'running' }), 'c-1');
  assert.equal(T.tournamentResultsTournamentId({ tournamentId: 'c-1', status: 'finished' }), 'c-1');
  assert.equal(T.tournamentResultsTournamentId({ tournamentId: 'c-1', status: 'registering' }), null);
  // CONTROL: the server says none is kept (null / blank): a registering card has no Results; a live one keeps its own.
  assert.equal(T.tournamentResultsTournamentId({ tournamentId: 'c-1', status: 'registering', resultsTournamentId: null }), null);
  assert.equal(T.tournamentResultsTournamentId({ tournamentId: 'c-1', status: 'registering', resultsTournamentId: '  ' }), null);
  assert.equal(T.tournamentResultsTournamentId({ tournamentId: 'c-1', status: 'running', resultsTournamentId: null }), 'c-1');
  // Never for a cancelled event; junk in = null.
  assert.equal(T.tournamentResultsTournamentId({ tournamentId: 'c-1', status: 'cancelled', resultsTournamentId: 'c-0' }), null);
  assert.equal(T.tournamentResultsTournamentId(null), null);
  assert.equal(T.tournamentResultsTournamentId({ status: 'running' }), null, 'no id, nothing to open');
  // Label CONTROL: a caller that does not pass its own id keeps today's "Results".
  assert.equal(T.resultsButtonLabel('sng-1', undefined), T.RESULTS_BUTTON_TEXT);
  // An upcoming qualifier (tournamentId null) pointed at last week's event: "Last results".
  assert.equal(T.resultsButtonLabel('tq-last', null), T.LAST_RESULTS_BUTTON_TEXT);
  const upcoming = L.normalizeQualifierItem(weeklyRaw({ status: 'registering', resultsTournamentId: 'tq-last' }));
  assert.equal(T.resultsButtonLabel(L.qualifierResultsTournamentId(upcoming, NOW), upcoming.tournamentId), T.LAST_RESULTS_BUTTON_TEXT);
  const live = L.normalizeQualifierItem(weeklyRaw({ status: 'running', tournamentId: 'tq-run', resultsTournamentId: 'tq-run' }));
  assert.equal(T.resultsButtonLabel(L.qualifierResultsTournamentId(live, NOW), live.tournamentId), T.RESULTS_BUTTON_TEXT);
  // The league card's text locks: the label says no seat / credit.
  assert.doesNotMatch(T.LAST_RESULTS_BUTTON_TEXT, /credit|\bseat/i);
});

// ── Results (finish order) ──────────────────────────────────────────────────

// A running 6-entrant event as publicTournamentStandings sends it: opaque
// tokens, public names, finishPosition null while alive.
const running = () => ({
  tournamentId: 'tq-run', name: 'Weekly Qualifier', status: 'running',
  eliminationOrder: ['e6', 'e5', 'e4'],
  players: [
    { playerId: 'e1', playerName: 'Stacy L.', chipCount: 4200, finishPosition: null },
    { playerId: 'e2', playerName: 'Bob K.', chipCount: 9100, finishPosition: null },
    { playerId: 'e3', playerName: 'Ann P.', chipCount: 1500, finishPosition: null },
    { playerId: 'e4', playerName: 'Paula G.', chipCount: 0, finishPosition: 4 },
    { playerId: 'e5', playerName: 'Tom R.', chipCount: 0, finishPosition: 5 },
    { playerId: 'e6', playerName: 'Lee W.', chipCount: 0, finishPosition: 6 },
  ],
});

test('standingsLists (running): Still in by chips, then each bust with the server\'s place, the most recent first', () => {
  const lists = T.standingsLists(running());
  assert.equal(lists.status, 'running');
  assert.equal(lists.finished, false);
  assert.deepEqual(lists.stillIn.map((r) => [r.name, r.chips]), [['Bob K.', 9100], ['Stacy L.', 4200], ['Ann P.', 1500]]);
  assert.deepEqual(lists.busted.map(T.finishRowText), ['4th  Paula G.', '5th  Tom R.', '6th  Lee W.']);
  assert.equal(T.stillInHeading(lists), 'Still in (3)');
  assert.equal(T.finishOrderHeading(lists), 'Finish order (3)');
  const view = T.finishListSections(lists);
  assert.deepEqual(view.sections.map((s) => s.kind), ['stillIn', 'busted'], 'Still in above the finish order');
  assert.equal(view.sections[1].note, T.FINISH_ORDER_NOTE_TEXT);
  assert.equal(T.chipsText(12500), '12,500');
  // The keys are the server's opaque tokens (React keys), nothing else.
  assert.deepEqual(lists.busted.map((r) => r.key), ['e4', 'e5', 'e6']);
});

test('places are the SERVER\'s finishPosition: hand-for-hand, ties, re-entry shifts are shown as stored, never recomputed', () => {
  // Hand-for-hand: two busts in one hand, the server permuted their places by
  // starting stack (the later-listed one took the WORSE place).
  const hfh = T.standingsLists({
    tournamentId: 't', status: 'running', eliminationOrder: ['a', 'c', 'b'],
    players: [
      { playerId: 'a', playerName: 'A', finishPosition: 12 },
      { playerId: 'b', playerName: 'B', finishPosition: 10 },
      { playerId: 'c', playerName: 'C', finishPosition: 11 },
      { playerId: 'z', playerName: 'Z', chipCount: 100, finishPosition: null },
    ],
  });
  assert.deepEqual(hfh.busted.map(T.finishRowText), ['10th  B', '11th  C', '12th  A']);
  // A stored tie (a shared place) keeps the server's order, newest first, and both show the stored place.
  const tie = T.standingsLists({
    status: 'finished', eliminationOrder: ['p', 'q'],
    players: [
      { playerId: 'p', playerName: 'P', finishPosition: 2, tied: true },
      { playerId: 'q', playerName: 'Q', finishPosition: 2, tied: true },
      { playerId: 'w', playerName: 'W', finishPosition: 1 },
    ],
  });
  assert.deepEqual(tie.busted.map(T.finishRowText), ['1st  W', '2nd (tie)  Q', '2nd (tie)  P']);
  // A disqualified / odd row with a junk place is never given one.
  const junk = T.standingsLists({ players: [{ playerId: 'x', playerName: 'X', finishPosition: 0 }, { playerId: 'y', playerName: 'Y', finishPosition: '3' }, { playerId: 'v', playerName: 'V', finishPosition: 2.5 }] });
  assert.deepEqual(junk.busted.map((r) => r.place), [3]);
  assert.deepEqual(junk.stillIn.map((r) => r.name), ['X', 'V']);
});

test('re-entry (F97): a player who busted and re-entered is ONE row - alive in Still in; busted again shows his final place once', () => {
  // poker-server reinstateForReentry resets his row (same playerId) to alive.
  const back = T.standingsLists({
    status: 'running', eliminationOrder: [],
    players: [{ playerId: 'e9', playerName: 'Rae M.', chipCount: 3000, finishPosition: null }, { playerId: 'e1', playerName: 'Stacy L.', chipCount: 2000, finishPosition: null }],
  });
  assert.deepEqual(back.stillIn.map((r) => r.name), ['Rae M.', 'Stacy L.']);
  assert.equal(back.busted.length, 0);
  // Defensive: a token sent twice (an old busted row + the live one) is shown once - alive wins.
  const twice = T.standingsLists({
    status: 'running', eliminationOrder: ['e9'],
    players: [
      { playerId: 'e9', playerName: 'Rae M.', chipCount: 0, finishPosition: 7 },
      { playerId: 'e9', playerName: 'Rae M.', chipCount: 3000, finishPosition: null },
      { playerId: 'e1', playerName: 'Stacy L.', chipCount: 2000, finishPosition: null },
    ],
  });
  assert.deepEqual(twice.stillIn.map((r) => r.name), ['Rae M.', 'Stacy L.']);
  assert.equal(twice.busted.length, 0);
  assert.equal(twice.total, 2);
  // Two busted rows for one token: the better stored place is his final one.
  const out = T.standingsLists({
    status: 'running', eliminationOrder: ['e9'],
    players: [{ playerId: 'e9', playerName: 'Rae M.', finishPosition: 7 }, { playerId: 'e9', playerName: 'Rae M.', finishPosition: 3 }, { playerId: 'e1', playerName: 'S', chipCount: 1, finishPosition: null }],
  });
  assert.deepEqual(out.busted.map(T.finishRowText), ['3rd  Rae M.']);
});

test('finished event: the winner 1st on top, "Final results (N)", no Still in; no polling once finished', () => {
  const fin = T.standingsLists({
    tournamentId: 'tq-fin', name: 'Online League', status: 'finished', eliminationOrder: ['c', 'b'],
    players: [
      { playerId: 'a', playerName: 'Winner W.', chipCount: 6000, finishPosition: 1 },
      { playerId: 'b', playerName: 'Second S.', chipCount: 0, finishPosition: 2 },
      { playerId: 'c', playerName: 'Third T.', chipCount: 0, finishPosition: 3 },
    ],
  });
  assert.equal(fin.finished, true);
  assert.deepEqual(fin.busted.map(T.finishRowText), ['1st  Winner W.', '2nd  Second S.', '3rd  Third T.']);
  const view = T.finishListSections(fin);
  assert.deepEqual(view.sections.map((s) => s.kind), ['busted']);
  assert.equal(view.sections[0].heading, 'Final results (3)');
  assert.equal(view.sections[0].note, '', 'no "most recent bust" note on a final list');
  assert.equal(T.standingsNeedPolling({ status: 'finished' }), false);
  // CONTROL: a running answer (or none yet) is asked again, as today.
  assert.equal(T.standingsNeedPolling({ status: 'running' }), true);
  assert.equal(T.standingsNeedPolling(null), true);
  // A finished event that ended with more than one unplaced player: never "Still in".
  const odd = T.standingsLists({ status: 'finished', players: [{ playerId: 'x', playerName: 'X', chipCount: 5, finishPosition: null }] });
  assert.equal(T.stillInHeading(odd), 'Not placed (1)');
});

test('empty / unavailable / before the start; names are public names or "Player", never an id', () => {
  assert.deepEqual(T.finishListSections(T.standingsLists(null)), { unavailable: true, text: T.RESULTS_UNAVAILABLE_TEXT, sections: [] });
  const none = T.finishListSections(T.standingsLists({ status: 'running', players: [{ playerId: 'e1', playerName: 'A', chipCount: 1500 }] }));
  assert.equal(none.sections[1].empty, 'No one has busted yet.');
  const reg = T.standingsLists({ status: 'registering', players: [{ playerId: 'e1', playerName: 'A' }, { playerId: 'e2', playerName: 'B' }] });
  assert.equal(T.stillInHeading(reg), 'Registered (2)');
  assert.deepEqual(T.finishListSections(reg).sections.map((s) => s.kind), ['stillIn'], 'no finish order before the start');
  const anon = T.standingsLists({ status: 'running', players: [{ playerId: 'u-123', playerName: '', chipCount: 1 }, { playerId: 'u-456', chipCount: 2 }] });
  assert.deepEqual(anon.stillIn.map((r) => r.name), ['Player', 'Player']);
  assert.equal(T.initialBracketView({ results: true }), 'list');
  assert.equal(T.initialBracketView({ status: 'finished' }), 'list');
  // CONTROL: the Live Bracket opens on its cards, as today.
  assert.equal(T.initialBracketView({ status: 'running' }), 'cards');
  assert.equal(T.initialBracketView(), 'cards');
  for (const s of [T.REGISTERED_EMPTY_TEXT, T.RESULTS_UNAVAILABLE_TEXT, T.FINISH_ORDER_EMPTY_TEXT, T.FINISH_ORDER_NOTE_TEXT, T.RESULTS_BUTTON_TEXT, 'Still in (3)', 'Finish order (3)', 'Final results (3)']) {
    assert.doesNotMatch(s, /\bseat(?! subscription)|credit/i, 'league-safe words on every card');
  }
});

// ── Static guards on the JSX / CSS (no React renderer in node) ─────────────

const LISTS = readSrc('components/ui/TournamentLists.jsx');
const LISTS_CSS = readSrc('components/ui/TournamentLists.css');
const BRACKET = readSrc('components/ui/TournamentBracket.jsx');
const BRACKET_CSS = readSrc('components/ui/TournamentBracket.css');
const QLOBBY = readSrc('components/ui/QualifierLobby.jsx');
const TLOBBY = readSrc('components/ui/TournamentLobby.jsx');
const LOBBY = readSrc('components/ui/Lobby.jsx');

function colorHits(src) {
  const out = [];
  const hsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    return { h, s, l };
  };
  for (const m of src.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const n = parseInt(m[1], 16);
    out.push({ text: m[0], ...hsl((n >> 16) & 255, (n >> 8) & 255, n & 255) });
  }
  for (const m of src.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) out.push({ text: m[0], ...hsl(+m[1], +m[2], +m[3]) });
  return out;
}
// Red, and orange / amber (hue 20-45) - neither is used for the new lists.
const isWarm = (c) => (isRedHue(c.h) || (c.h > 20 && c.h < 42)) && c.s >= 0.3 && c.l >= 0.1 && c.l <= 0.95;

test('JSX: Registered is an aria-expanded button over a bounded list; Results opens the bracket; lists have roles', () => {
  assert.match(LISTS, /aria-expanded=\{open\}/);
  assert.match(LISTS, /aria-controls=\{panelId\}/);
  assert.match(LISTS, /className="tl-registrants-panel" role="region" aria-label="Registered players" tabIndex=\{0\}/);
  assert.equal((LISTS.match(/role="list"/g) || []).length, 3, 'registrants, still in, finish order');
  assert.match(LISTS, /aria-haspopup="dialog"/);
  assert.match(LISTS, /e\.stopPropagation\(\)/, 'a tap never opens the card under it');
  // The rows draw names / places / chips only - never an id.
  assert.doesNotMatch(LISTS, /\{r\.key\}<|playerId|userId|username/);
  assert.match(LISTS_CSS, /\.tl-registrants-panel \{[^}]*max-height: 240px;[^}]*overflow-y: auto;/);
  assert.match(LISTS_CSS, /max-height: min\(240px, 45vh\)/);
  assert.doesNotMatch(LISTS_CSS, /backdrop-filter/);
  for (const c of [...colorHits(LISTS_CSS), ...colorHits(LISTS)]) assert.ok(!isWarm(c), `no red / orange: ${c.text}`);
  const code = (LISTS_CSS + LISTS).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(code, /\b(red|orange|crimson|tomato)\b/i);
});

test('wiring: both qualifier cards + every tournament card; the bracket list view + results mode; no blur on phones', () => {
  // QualifierLobby: one row helper, drawn on the home card and the Play-tab card.
  assert.equal((QLOBBY.match(/\{listsRow\(q\)\}/g) || []).length, 2);
  assert.match(QLOBBY, /qualifierResultsTournamentId\(q, now\)/);
  assert.match(QLOBBY, /onOpen=\{\(id, opts\) => onOpenResults\(id, q\.name, opts\)\}/);
  // Both QualifierLobby mounts get the bracket opener (the home mount stays ONE).
  assert.equal(LOBBY.split('\n').filter((l) => l.includes('<QualifierLobby ') && l.includes('onOpenResults={openBracket}')).length, 2);
  assert.equal((LOBBY.match(/<QualifierLobby variant="home"/g) || []).length, 1);
  assert.match(LOBBY, /const results = !!\(opts && opts\.results\);\s*\n\s*setBracketRequest\(\{ tournamentId: id, results, last: results && !!opts\.last \}\)/);
  assert.match(LOBBY, /resultsMode=\{!!bracketRequest\?\.results\}/);
  assert.match(LOBBY, /const again = standingsNeedPolling\(data, \{ forId: !!wanted \}\);/);
  assert.match(LOBBY, /if \(!again && iv\) \{ clearInterval\(iv\); iv = null; \}/);
  // TournamentLobby: Registered from the server's names; Results from the pure
  // picker (server resultsTournamentId, else running + finished); Live Bracket kept.
  assert.match(TLOBBY, /const registrantNames = registrantNamesOf\(t\);/);
  assert.match(TLOBBY, /<RegisteredToggle names=\{registrantNames\} \/>/);
  assert.match(TLOBBY, /const resultsId = tournamentResultsTournamentId\(t\);/);
  assert.match(TLOBBY, /\{resultsId && typeof onOpenBracket === 'function' && \(/);
  assert.match(TLOBBY, /tournamentId=\{resultsId\}\s*\n\s*ownTournamentId=\{String\(id\)\}/);
  assert.doesNotMatch(TLOBBY, /\(t\.status === 'running' \|\| t\.status === 'finished'\) && typeof onOpenBracket/, 'the card no longer decides Results from its own status alone');
  assert.match(TLOBBY, /onOpen=\{\(tid, opts\) => onOpenBracket\(tid, t\.name, opts\)\}/);
  assert.match(LISTS, /onOpen\(tournamentId, \{ results: true, last: isLastResults\(tournamentId, ownTournamentId\) \}\)/);
  assert.match(QLOBBY, /<ResultsButton tournamentId=\{resultsId\} ownTournamentId=\{q\.tournamentId\} /);
  assert.match(LISTS, /\{resultsButtonLabel\(tournamentId, ownTournamentId\)\}/);
  assert.ok(TLOBBY.includes('🏆 Live Bracket'), 'the Live Bracket button is kept');
  // Bracket: the list view + the cards view kept; results-mode empty text; Esc; dialog role.
  assert.match(BRACKET, /\{view === 'list' && players\.length > 0 && <FinishOrderList standings=\{tournament\} \/>\}/);
  assert.match(BRACKET, /\{view === 'cards' && activePlayers\.length > 0 && \(/);
  assert.match(BRACKET, /\{view === 'cards' && eliminatedPlayers\.length > 0 && \(/);
  assert.match(BRACKET, /aria-pressed=\{view === 'list'\}/);
  assert.match(BRACKET, /resultsMode\s*\n?\s*\? resultsEmptyText\(\{ loading, slow \}\)/);
  assert.ok(BRACKET.includes("'There is no tournament in progress right now. The bracket opens here while one is running.'"), 'the Live Bracket empty text is kept');
  assert.match(BRACKET, /e\.key === 'Escape'/);
  assert.match(BRACKET, /role="dialog" aria-modal="true"/);
  assert.match(BRACKET_CSS, /@media \(max-width: 768px\), \(pointer: coarse\) \{\s*\.tb-overlay \{\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;/);
});

test('canonical-features locks: every lobby-lists token is in the manifest AND in the source', () => {
  const manifest = fs.readFileSync(new URL('../../canonical-features.txt', import.meta.url), 'utf8').split('\n').map((l) => l.trim());
  const src = [LISTS, LISTS_CSS, BRACKET, readSrc('utils/tournamentLists.js')].join('\n');
  for (const tok of ['tl-registered-toggle', 'tl-registrants-panel', 'tl-results-btn', 'tl-still-in-list', 'tl-finish-list', 'tb-view-toggle',
    'No one has registered yet.', 'These results are no longer available.', 'Most recent bust first', 'No one has busted yet.', 'Still in (', 'Final results (',
    'Last results', 'Still loading the results', 'tl-finish-row--dq', 'tb-finished-at', 'data-autofocus']) {
    assert.ok(manifest.includes(tok), `manifest: ${tok}`);
    assert.ok(src.includes(tok), `source: ${tok}`);
  }
});

test('league card locks still hold: the lists row is outside the league segments and says no credit / seat', () => {
  const info = QLOBBY.slice(QLOBBY.indexOf('const leagueInfo = (q) =>'), QLOBBY.indexOf('// 2026-11-02 (owner: stream the qualifiers) — next to Register'));
  assert.ok(info.length > 0);
  assert.doesNotMatch(info, /listsRow|RegisteredToggle|ResultsButton/);
  const row = QLOBBY.slice(QLOBBY.indexOf('const listsRow = (q) => {'), QLOBBY.indexOf('// Dashboard modal'));
  assert.ok(row.length > 0);
  assert.doesNotMatch(row.replace(/\/\/[^\n]*/g, ''), /credit|\bseat(?! subscription)/i);
  for (const c of colorHits(row)) assert.ok(!isWarm(c), `no red: ${c.text}`);
});

// ── Review round 2 (2026-11-26) ─────────────────────────────────────────────
const F = await import(new URL('utils/dialogFocus.js', SRC_DIR).href);

// (2) The server's start / status pushes carry no results pointer: the list's
// pre-start pointer (LAST night) stayed on the now-live card until the next list.
test('qualifierResultsTournamentId: a live card opens ITS running tournament, never the pointer left from before the start (CONTROL: before the start = last night)', () => {
  const pre = L.normalizeQualifierItem(weeklyRaw({
    qualifierId: 'league-1125', type: 'online_league', status: 'registering',
    resultsTournamentId: 'LAST-NIGHT', resultsQualifierId: 'league-1124',
  }));
  assert.equal(pre.resultsQualifierId, 'league-1124');
  // CONTROL: before the start, the card's Results is last night's ("Last results").
  assert.equal(L.qualifierResultsTournamentId(pre, NOW), 'LAST-NIGHT');
  assert.equal(T.resultsButtonLabel('LAST-NIGHT', pre.tournamentId), T.LAST_RESULTS_BUTTON_TEXT);
  // The bug: qualifierTournamentStarted -> status running + tournamentId, pointer untouched.
  const started = { ...pre, status: 'running', tournamentId: 'TONIGHT' };
  assert.equal(L.qualifierResultsTournamentId(started, NOW), 'TONIGHT');
  assert.equal(T.resultsButtonLabel(L.qualifierResultsTournamentId(started, NOW), started.tournamentId), T.RESULTS_BUTTON_TEXT);
  // A status-only update (no tournamentId on the item yet): no Results until the list names tonight's - never last night's.
  const flipped = { ...pre, status: 'running' };
  assert.equal(L.qualifierResultsTournamentId(flipped, NOW), null);
  // A finished card still holding another event's pointer: none until the list says (never a guess).
  assert.equal(L.qualifierResultsTournamentId({ ...pre, status: 'finished', tournamentId: 'TONIGHT' }, NOW), null);
  // The list after the start names tonight's event: that.
  assert.equal(L.qualifierResultsTournamentId({ ...flipped, resultsTournamentId: 'TONIGHT', resultsQualifierId: 'league-1125' }, NOW), 'TONIGHT');
  assert.equal(L.qualifierResultsTournamentId({ ...pre, status: 'finished', tournamentId: 'TONIGHT', resultsTournamentId: 'TONIGHT', resultsQualifierId: 'league-1125' }, NOW), 'TONIGHT');
  // CONTROL: a pointer without an owner (not sent / null) keeps the rule before this fix.
  const noOwner = L.normalizeQualifierItem(weeklyRaw({ status: 'running', resultsTournamentId: 'tq-x' }));
  assert.equal(noOwner.resultsQualifierId, undefined);
  assert.equal(L.qualifierResultsTournamentId(noOwner, NOW), 'tq-x');
  assert.equal(L.normalizeQualifierItem(weeklyRaw({ resultsQualifierId: { x: 1 } })).resultsQualifierId, null, 'junk is none');
  // The QualifierLobby start handler is the transition the test models (status running + tournamentId).
  assert.match(QLOBBY, /\{ \.\.\.q, status: 'running', tournamentId: data\.tournamentId != null \? String\(data\.tournamentId\) : q\.tournamentId \}/);
});

// (3) "Last results" opened the previous event with nothing saying which night.
test('Last results: the window names the earlier event and its Denver day; the card\'s own event keeps its plain name (CONTROL)', () => {
  const fin = Date.parse('2026-11-26T05:45:00.000Z'); // Wed Nov 25, 10:45 PM MT
  assert.equal(T.finishedDayText(fin), 'Wed Nov 25');
  assert.equal(T.finishedWhenText(fin), 'Wed Nov 25, 10:45 PM MT');
  assert.equal(T.finishedDayText(new Date(fin).toISOString()), 'Wed Nov 25', 'ISO too');
  assert.equal(T.lastResultsTitle('Online League', fin), 'Last results - Online League, Wed Nov 25');
  assert.equal(T.lastResultsTitle('Online League', null), 'Last results - Online League', 'no finishedAt: the name only');
  assert.equal(T.lastResultsTitle('', fin), 'Last results - Wed Nov 25');
  assert.equal(T.lastResultsTitle(null, undefined), 'Last results');
  assert.equal(T.finishedDayText('junk'), '');
  assert.equal(T.standingsLists({ status: 'finished', finishedAt: fin, players: [] }).finishedAt, fin);
  // Which control is "last": an earlier run than the card's own.
  assert.equal(T.isLastResults('LAST-NIGHT', null), true);
  assert.equal(T.isLastResults('sng-1', 'sng-2'), true);
  assert.equal(T.isLastResults('TONIGHT', 'TONIGHT'), false);
  assert.equal(T.isLastResults('x', undefined), false, 'CONTROL: the caller did not say');
  // Wiring: the button says last -> the lobby keeps it -> the window titles with it.
  assert.match(LOBBY, /lastResults=\{!!bracketRequest\?\.last\}/);
  assert.match(BRACKET, /const title = lastResults \? lastResultsTitle\(name, tournament\?\.finishedAt\) : name;/);
  assert.match(BRACKET, /<h2 className="tb-title">\{title\}<\/h2>/);
  assert.match(BRACKET, /aria-label=\{title\}/);
  assert.match(BRACKET, /\{finishedWhen && <span className="tb-finished-at">\{finishedWhen\}<\/span>\}/);
  assert.match(BRACKET, /resultsMode \? \(lastResults \? LAST_RESULTS_TITLE_TEXT : RESULTS_TITLE_TEXT\)/);
  assert.doesNotMatch(T.LAST_RESULTS_TITLE_TEXT, /credit|\bseat/i);
});

// (4) tied / disqualified: only from the server's own row fields.
test('ties + DQ: shared place for a run of server-tied rows; "Disqualified" with no place, last; no fields = today (CONTROL)', () => {
  // CONTROL: no tied / disqualified fields -> exactly today's rows.
  const today = T.standingsLists(running());
  assert.deepEqual(today.busted.map(T.finishRowText), ['4th  Paula G.', '5th  Tom R.', '6th  Lee W.']);
  assert.ok(today.busted.every((r) => r.tied === false && r.disqualified === false && r.shownPlace === r.place));
  // The server stores a tie as its own consecutive numbers (3, 4) + tied: true on both.
  const tie = T.standingsLists({
    status: 'finished', eliminationOrder: ['f', 'e', 'd', 'c'],
    players: [
      { playerId: 'a', playerName: 'A', finishPosition: 1 },
      { playerId: 'b', playerName: 'B', finishPosition: 2 },
      { playerId: 'c', playerName: 'C', finishPosition: 3, tied: true },
      { playerId: 'd', playerName: 'D', finishPosition: 4, tied: true },
      { playerId: 'e', playerName: 'E', finishPosition: 5 },
      { playerId: 'f', playerName: 'F', finishPosition: 6, tied: true },
    ],
  });
  assert.deepEqual(tie.busted.map(T.finishRowText), ['1st  A', '2nd  B', '3rd (tie)  C', '3rd (tie)  D', '5th  E', '6th  F'],
    'one tie shares its best place; a LONE tied row is shown as stored');
  assert.deepEqual(tie.busted.map((r) => r.place), [1, 2, 3, 4, 5, 6], 'the stored places are kept');
  assert.equal(T.finishCardText(tie.busted[3]), '3rd place (tie)');
  // Disqualified: no place, after every placed row (a DQ'd heads-up "winner" is never 1st).
  const dq = T.standingsLists({
    status: 'finished', eliminationOrder: ['c', 'a', 'b'],
    players: [
      { playerId: 'b', playerName: 'Bee', finishPosition: 1, disqualified: true },
      { playerId: 'a', playerName: 'Ace', finishPosition: 2, disqualified: true },
      { playerId: 'c', playerName: 'Cee', finishPosition: 3 },
      { playerId: 'x', playerName: 'Ex', chipCount: 500, finishPosition: null, disqualified: true },
    ],
  });
  assert.deepEqual(dq.busted.map(T.finishRowText), ['3rd  Cee', 'Disqualified  Bee', 'Disqualified  Ace', 'Disqualified  Ex']);
  assert.ok(dq.busted.filter((r) => r.disqualified).every((r) => r.shownPlace === null && r.tied === false));
  assert.equal(dq.stillIn.length, 0, 'a disqualified player is never "still in"');
  assert.equal(T.finishCardText(dq.busted[1]), 'Disqualified');
  assert.equal(T.finishCardText(dq.busted[0]), '3rd place');
  // A tied + disqualified row: DQ wins (no place, no tie).
  const both = T.standingsLists({ status: 'finished', players: [{ playerId: 'p', playerName: 'P', finishPosition: 3, tied: true, disqualified: true }, { playerId: 'q', playerName: 'Q', finishPosition: 4, tied: true }] });
  assert.deepEqual(both.busted.map(T.finishRowText), ['4th  Q', 'Disqualified  P']);
  // Only a real boolean true counts (never a truthy string from somewhere else).
  const loose = T.standingsLists({ status: 'finished', players: [{ playerId: 'p', playerName: 'P', finishPosition: 1, disqualified: 'yes' }, { playerId: 'q', playerName: 'Q', finishPosition: 2, tied: 1 }, { playerId: 'r', playerName: 'R', finishPosition: 3, tied: 1 }] });
  assert.deepEqual(loose.busted.map(T.finishRowText), ['1st  P', '2nd  Q', '3rd  R']);
  // Wiring: the list marks the DQ row (muted blue); the cards view uses the same rule.
  assert.match(LISTS, /r\.disqualified \? 'tl-finish-row tl-finish-row--dq' : 'tl-finish-row'/);
  assert.match(BRACKET, /finishText=\{finishTextByKey\.get\(String\(player\.playerId\)\) \|\| ''\}/);
  assert.match(BRACKET, /\{finishText \|\| `\$\{ordinal\(player\.finishPosition\)\} place`\}/);
  // poker-server sends a DQ row as finishPosition null + disqualified: the cards view counts him OUT
  // (never active / chip leader / "remaining"), the list never "Still in" (the 'Ex' row above).
  assert.match(BRACKET, /function isOutOfBracket\(p\) \{\s*return p\.finishPosition != null \|\| p\.disqualified === true;/);
  assert.match(BRACKET, /const active = players\.filter\(p => !isOutOfBracket\(p\)\);/);
  assert.match(BRACKET, /\.filter\(p => isOutOfBracket\(p\)\)/);
  assert.match(BRACKET, /const isEliminated = isOutOfBracket\(player\);/);
  assert.match(LISTS_CSS, /\.tl-finish-row--dq \.tl-finish-place \{\s*color: #9fb4d8;/);
  for (const c of colorHits(LISTS_CSS)) assert.ok(!isWarm(c), `no red / orange: ${c.text}`);
});

// (5) aria-modal without focus: focus stayed on the lobby's Results button behind the scrim.
function fakeDom() {
  const doc = { body: { tag: 'body' }, documentElement: { tag: 'html' } };
  doc.activeElement = doc.body;
  const el = (name, attrs = {}) => ({
    name, attrs, isConnected: true, hidden: false, focusable: true,
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    focus() { doc.activeElement = this; },
  });
  const dialog = (children) => ({
    children,
    contains(n) { return n === this || children.includes(n); },
    querySelectorAll() { return children.filter((c) => c.focusable); },
    querySelector(sel) { return sel === '[data-autofocus]' ? (children.find((c) => 'data-autofocus' in c.attrs) || null) : null; },
  });
  return { doc, el, dialog };
}

test('dialog focus: into the window on open (its close button), Tab wraps inside, back to the Results button on close (CONTROLs)', () => {
  const { doc, el, dialog } = fakeDom();
  const resultsBtn = el('results');
  resultsBtn.focus();
  const close = el('close', { 'data-autofocus': '' });
  const listBtn = el('list');
  const cardsBtn = el('cards');
  const box = dialog([close, listBtn, cardsBtn]);
  // Open: focus moves from the lobby's button to the close button.
  assert.equal(F.focusIntoDialog(box, doc.activeElement), close);
  assert.equal(doc.activeElement, close);
  // CONTROL: focus already inside (a re-render, a click on a view button) is left alone.
  listBtn.focus();
  assert.equal(F.focusIntoDialog(box, doc.activeElement), null);
  assert.equal(doc.activeElement, listBtn);
  // No [data-autofocus]: the first Tab stop.
  const plain = dialog([listBtn, cardsBtn]);
  doc.activeElement = doc.body;
  assert.equal(F.focusIntoDialog(plain, doc.activeElement), listBtn);
  // Tab on the last stop -> the first; Shift+Tab on the first -> the last.
  cardsBtn.focus();
  let prevented = false;
  assert.equal(F.trapTabKey({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } }, box, doc.activeElement), true);
  assert.equal(doc.activeElement, close);
  assert.equal(prevented, true);
  assert.equal(F.trapTabKey({ key: 'Tab', shiftKey: true, preventDefault() {} }, box, doc.activeElement), true);
  assert.equal(doc.activeElement, cardsBtn);
  // Focus somewhere outside: Tab brings it back in.
  resultsBtn.focus();
  assert.equal(F.trapTabKey({ key: 'Tab', shiftKey: false, preventDefault() {} }, box, doc.activeElement), true);
  assert.equal(doc.activeElement, close);
  // CONTROL: a Tab in the middle, or another key, is the browser's own move.
  listBtn.focus();
  assert.equal(F.trapTabKey({ key: 'Tab', shiftKey: false, preventDefault() { throw new Error('must not prevent'); } }, box, doc.activeElement), false);
  assert.equal(F.trapTabKey({ key: 'Enter', preventDefault() { throw new Error('must not prevent'); } }, box, doc.activeElement), false);
  assert.equal(doc.activeElement, listBtn);
  // Close: the window's focus dropped to the page body -> back to the Results button.
  doc.activeElement = doc.body;
  assert.equal(F.restoreFocusTo(resultsBtn, doc), true);
  assert.equal(doc.activeElement, resultsBtn);
  // CONTROL: something else took focus meanwhile, the opener left the page, or there was none.
  const other = el('search');
  other.focus();
  assert.equal(F.restoreFocusTo(resultsBtn, doc), false);
  assert.equal(doc.activeElement, other);
  doc.activeElement = doc.body;
  assert.equal(F.restoreFocusTo({ ...resultsBtn, isConnected: false, focus() { throw new Error('gone'); } }, doc), false);
  assert.equal(F.restoreFocusTo(doc.body, doc), false);
  assert.equal(F.restoreFocusTo(null, doc), false);
  // Wiring: both modal boxes (empty + list) take focus, trap Tab, and mark the close button.
  assert.equal((BRACKET.match(/ref=\{dialogRef\} onKeyDown=\{\(e\) => trapTabKey\(e, e\.currentTarget, document\.activeElement\)\}/g) || []).length, 2);
  assert.equal((BRACKET.match(/aria-label="Close" data-autofocus=""/g) || []).length, 2);
  assert.match(BRACKET, /const \[opener\] = useState\(\(\) => \(typeof document !== 'undefined' \? document\.activeElement : null\)\);/);
  assert.match(BRACKET, /useEffect\(\(\) => \(\) => \{ restoreFocusTo\(opener, /);
  assert.match(BRACKET, /if \(el && typeof document !== 'undefined'\) focusIntoDialog\(el, document\.activeElement\);/);
  assert.match(LISTS_CSS, /\.tb-close-btn:focus-visible \{\s*outline: 2px solid #ffd24a;/);
});

// (6) A slow server read as "These results are no longer available."; a null id was asked every 3 s forever.
test('results mode: loading until a REAL answer (slow = still loading); a null answer for an id stops polling (CONTROL: the Live Bracket as before)', () => {
  // Results mode: the watchdog never turns "loading" into "unavailable".
  assert.equal(T.bracketLoading({ results: true, answered: false, slow: false }), true);
  assert.equal(T.bracketLoading({ results: true, answered: false, slow: true }), true);
  assert.equal(T.resultsEmptyText({ loading: true, slow: false }), T.RESULTS_LOADING_TEXT);
  assert.equal(T.resultsEmptyText({ loading: true, slow: true }), T.RESULTS_SLOW_TEXT);
  assert.notEqual(T.RESULTS_SLOW_TEXT, T.RESULTS_UNAVAILABLE_TEXT);
  // Only a real (null) answer says unavailable.
  assert.equal(T.bracketLoading({ results: true, answered: true, slow: true }), false);
  assert.equal(T.resultsEmptyText({ loading: false, slow: true }), T.RESULTS_UNAVAILABLE_TEXT);
  // CONTROL: the Live Bracket still gives up at the watchdog ("No tournament running"), as before.
  assert.equal(T.bracketLoading({ results: false, answered: false, slow: false }), true);
  assert.equal(T.bracketLoading({ results: false, answered: false, slow: true }), false);
  assert.equal(T.bracketLoading({ results: false, answered: true }), false);
  // Polling: a null answer for one id stops; a running one goes on; a finished one stops.
  assert.equal(T.standingsNeedPolling(null, { forId: true }), false);
  assert.equal(T.standingsNeedPolling({ status: 'running' }, { forId: true }), true);
  assert.equal(T.standingsNeedPolling({ status: 'finished' }, { forId: true }), false);
  // CONTROL: no id (the Live Bracket's "any running one"): a null is asked again (one may start).
  assert.equal(T.standingsNeedPolling(null), true);
  assert.equal(T.standingsNeedPolling(null, { forId: false }), true);
  // Wiring: the 8 s watchdog sets `slow`, never `answered`; a later real answer re-arms the poll.
  assert.match(LOBBY, /const answerWatch = setTimeout\(\(\) => setBracketSlow\(true\), 8000\);/);
  assert.doesNotMatch(LOBBY, /setTimeout\(\(\) => setBracketAnswered\(true\)/);
  assert.match(LOBBY, /else if \(again && !iv\) iv = setInterval\(fetchStandings, 3000\);/);
  assert.match(LOBBY, /loading=\{bracketLoading\(\{ results: !!bracketRequest\?\.results, answered: bracketAnswered, slow: bracketSlow \}\)\} slow=\{bracketSlow\}/);
  for (const s of [T.RESULTS_SLOW_TEXT, T.DISQUALIFIED_TEXT, T.TIE_SUFFIX_TEXT]) assert.doesNotMatch(s, /\bseat(?! subscription)|credit/i);
});
