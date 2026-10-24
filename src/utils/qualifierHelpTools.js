/**
 * Help tools at a QUALIFIER table (owner 2026-10-23: "Turn all off").
 *
 * The weekly / monthly online qualifiers award real live-championship seats,
 * so at every table of a qualifier tournament (the start tables AND the
 * overflow tables, seated or watching) the table offers NO real-time help:
 *   - the Options menu's Training toggle, Range Chart, Equity Calc, the
 *     Analysis tools that read the hand (Range Matrix, Equity Heatmap, Timing
 *     Tells, GTO Overlay, GTO Solver) and the whole Coach Mode group (AI Coach
 *     Rail, Table Commentary, Pause & Coach, Post-Hand Review) are not
 *     rendered, and the menu says so (QUALIFIER_HELP_TOOLS_OFF_TEXT);
 *   - their overlays are closed (force-closed when the player is moved to a
 *     qualifier table with one open) and not mounted;
 *   - the HUD's own aids are not shown: the training badge + panel, the
 *     strength bar / tier of the hand pill (the plain hand name stays), the
 *     "Eq" / tier and pot-odds line on Call, the outs counter, the card hover
 *     outs popup, the board texture badge, the pot-odds badge, the SPR badge,
 *     the post-hand "GTO suggests" panel and the opponent VPIP/PFR stats
 *     (seat mini-stat + popup).
 * Cash tables (and every non-qualifier table) are unchanged.
 *
 * How the client knows (any ONE is enough):
 *   1. an explicit server flag (a future server): gameState.isQualifier ===
 *      true, a gameState.qualifierId, or tableKind 'qualifier';
 *   2. a TOURNAMENT table (gameState.isTournament === true, tableKind
 *      'tournament' or a tournamentId — poker-server stamps all three on every
 *      full state, false / null on a cash table) that is a qualifier's:
 *      a. its tournamentId is one this page was told is a qualifier's
 *         (qualifierTournamentStarted, the qualifier list / update frames:
 *         noteQualifierTournamentId);
 *      b. its tournamentClock carries paidPlaces / seatsForTop as a number
 *         (poker-server sets it ONLY for a qualifier: seatsForTopWith);
 *      c. its table name / tournament name says "Qualifier" (poker-server
 *         names every qualifier table "Qualifier Table N", start and overflow).
 * A tournament table with none of these (a regular tournament, Sit & Go, an
 * older server's qualifier we were never told about) keeps its tools.
 *
 * Also (review fix-up): a coach whisper names no table, so CoachingRail drops
 * every whisper while ANY of his tables is a qualifier table
 * (helpToolsOffAtAnyTable), and the table's Last Hand replay shows a revealed
 * hand's name without its strength percent at a qualifier table.
 *
 * Pure module (no React, no store): GameHUD, PokerTable2D, App.jsx,
 * QualifierLobby, CoachingRail and the node probes.
 */

export const QUALIFIER_HELP_TOOLS_OFF_TEXT = 'Help tools are off in qualifier tournaments.';

/**
 * 2026-10-24 — the poker-server half: a help tool asked for at a qualifier table
 * is refused with this code (trainingToggled refused, coachResult, sessionRecapResult,
 * error {event:'coachWhisper'}). The client hides the tools, so a refusal only means
 * an old tab or a race: it is handled quietly (no toast, no red).
 */
export const HELP_TOOLS_OFF_CODE = 'help_tools_off_qualifier';

/** A server answer that is the help-tools-off refusal. */
export function isHelpToolsOffRefusal(x) {
  return !!x && typeof x === 'object' && x.code === HELP_TOOLS_OFF_CODE;
}

const QUALIFIER_NAME_RE = /\bqualifier\b/i;
const MAX_KNOWN_IDS = 200;

function idString(v) {
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'object') return null;
  const s = String(v).trim();
  return s ? s : null;
}

function finiteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// The tournament ids this page was told are qualifiers' (memory only).
const knownQualifierTournamentIds = new Set();

/** Remember that tournament `id` is a qualifier's (best-effort; ignores junk). */
export function noteQualifierTournamentId(id) {
  const s = idString(id);
  if (!s) return false;
  if (knownQualifierTournamentIds.has(s)) return false;
  if (knownQualifierTournamentIds.size >= MAX_KNOWN_IDS) {
    const oldest = knownQualifierTournamentIds.values().next().value;
    knownQualifierTournamentIds.delete(oldest);
  }
  knownQualifierTournamentIds.add(s);
  return true;
}

/** Every `tournamentId` of a (normalized or raw) qualifier list. */
export function noteQualifierTournamentIds(list) {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const q of list) if (q && typeof q === 'object' && noteQualifierTournamentId(q.tournamentId)) n++;
  return n;
}

/** The ids noted so far (the live Set — read it, never write it). */
export function knownQualifierTournaments() {
  return knownQualifierTournamentIds;
}

/** Probes only: forget every noted id. */
export function resetQualifierTournamentIdsForTest() {
  knownQualifierTournamentIds.clear();
}

function hasId(known, id) {
  if (!known || !id) return false;
  if (known instanceof Set) return known.has(id);
  if (Array.isArray(known)) return known.some((k) => idString(k) === id);
  return false;
}

/** The table on screen is a TOURNAMENT table (the server's P-d / R1 markers). */
export function isTournamentTableState(gs) {
  if (!gs || typeof gs !== 'object' || Array.isArray(gs)) return false;
  return gs.isTournament === true
    || gs.tableKind === 'tournament'
    || idString(gs.tournamentId) !== null;
}

/**
 * Why the table on screen (`gs`) is a qualifier table, or null when it is not
 * (or not provably). `known`: the noted qualifier tournament ids (Set or
 * array; defaults to this page's). Never throws.
 */
export function qualifierTableEvidence(gs, known = knownQualifierTournamentIds) {
  if (!gs || typeof gs !== 'object' || Array.isArray(gs)) return null;
  if (gs.isQualifier === true || gs.tableKind === 'qualifier') return 'server_flag';
  if (idString(gs.qualifierId) !== null) return 'server_flag';
  if (!isTournamentTableState(gs)) return null;
  const tid = idString(gs.tournamentId);
  if (tid && hasId(known, tid)) return 'known_tournament';
  const clock = gs.tournamentClock;
  if (clock && typeof clock === 'object' && !Array.isArray(clock)
    && (finiteNumber(clock.paidPlaces) || finiteNumber(clock.seatsForTop))) return 'seat_places';
  if (typeof gs.tableName === 'string' && QUALIFIER_NAME_RE.test(gs.tableName)) return 'table_name';
  if (typeof gs.tournamentName === 'string' && QUALIFIER_NAME_RE.test(gs.tournamentName)) return 'table_name';
  return null;
}

/** Help tools are OFF at the table on screen (a qualifier table). */
export function helpToolsOffAt(gs, known = knownQualifierTournamentIds) {
  return qualifierTableEvidence(gs, known) !== null;
}

/**
 * Help tools are OFF at ANY table of this socket (review fix-up 2026-10-23):
 * the table on screen (`shown`), any multi-table entry (`activeTables`: a Map
 * or array of { gameState } / states, e.g. his qualifier seat while an extra
 * cash tab is on screen) or his live tournament seat (`seat`:
 * tournamentSeatStore's { tournamentId }) when its tournamentId is a noted
 * qualifier's. For a socket event that names no table (a `coachWhisper` is
 * relayed from ANY table room the socket shares with the sender): while one of
 * his tables is a qualifier table it may have come from there, so it is not
 * shown anywhere. Never throws.
 */
export function helpToolsOffAtAnyTable(shown, activeTables, seat, known = knownQualifierTournamentIds) {
  try {
    if (helpToolsOffAt(shown, known)) return true;
    let off = false;
    if (activeTables && typeof activeTables.forEach === 'function') {
      activeTables.forEach((entry) => {
        if (off || !entry || typeof entry !== 'object') return;
        const gs = entry.gameState && typeof entry.gameState === 'object' ? entry.gameState : entry;
        if (helpToolsOffAt(gs, known)) off = true;
      });
    }
    if (off) return true;
    if (seat && typeof seat === 'object' && !Array.isArray(seat)) {
      const tid = idString(seat.tournamentId);
      if (tid && hasId(known, tid)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
