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
 * 2026-11-02 (owner: stream the qualifiers) — the broadcast guardrails live
 * here too: voice chat off at a qualifier table (voiceOffAt), no June Go Live
 * overlay at one for anyone, seated or watching (goLiveOverlayOffAt; owner
 * answer (b), 2026-11-02) and the "Show me as Player on broadcasts" opt-out
 * helpers. See the section below helpToolsOffAt.
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

// ---- Broadcast guardrails (2026-11-02, owner: stream the qualifiers) --------
// The weekly / monthly qualifiers may be streamed to our Facebook Page. At a
// qualifier table:
//   - voice chat is OFF (opponents at a seat-awarding table could talk in a
//     private P2P channel). GameHUD hides only the Voice Chat button there,
//     does not mount VoiceChat (unmounting leaves the voice room and stops the
//     mic) and shows VOICE_OFF_QUALIFIER_TEXT in its place; Go Live stays.
//     The server refuses `voiceJoin` too (`voiceRefused` {code
//     'voice_off_qualifier'}) and pulls a voice-joined socket out when it is
//     seated there (`voiceForcedOff`); every gameState says `voiceChatAllowed`.
//   - the June Go Live overlay is hidden for EVERYONE, seated or watching
//     (owner answer (b), 2026-11-02): the Go Live panel shows
//     QUALIFIER_OFFICIAL_STREAM_TEXT instead of the OBS URL, and the
//     ?overlay=<tableId> graphic (and the panel's preview) draws a neutral
//     slate with that sentence: no names, seats, stacks or cards.
// Cash tables, Sit & Gos and every other table are unchanged.

/** The note in the Live & Social group at a qualifier table (lock token). */
export const VOICE_OFF_QUALIFIER_TEXT = 'Voice chat is off at qualifier tables.';

/** poker-server's refusal code for voiceJoin at a qualifier table. */
export const VOICE_OFF_CODE = 'voice_off_qualifier';

/** A server frame that is the voice-off refusal (`voiceRefused` / `voiceForcedOff`). */
export function isVoiceOffRefusal(x) {
  return !!x && typeof x === 'object' && x.code === VOICE_OFF_CODE;
}

/**
 * Voice chat is OFF at the table on screen: the server says so
 * (`voiceChatAllowed === false`), or it is a qualifier table by the same
 * evidence as helpToolsOffAt (fail-closed: either one is enough). Never throws.
 */
export function voiceOffAt(gs, known = knownQualifierTournamentIds) {
  if (!gs || typeof gs !== 'object' || Array.isArray(gs)) return false;
  if (gs.voiceChatAllowed === false) return true;
  return helpToolsOffAt(gs, known);
}

// Review 2026-11-02 — a refusal at a table that is NOT a qualifier table:
// poker-server refuses voiceJoin for a socket that also plays (or watches) a
// qualifier somewhere else (socketAtQualifierTable), naming the table he
// tried. That note must not claim this table is a qualifier table, and it
// lapses (he may leave the qualifier): the button comes back after
// VOICE_REFUSED_ELSEWHERE_MS and the next try asks the server again.
export const VOICE_OFF_ELSEWHERE_TEXT = 'Voice chat is off while you are playing a qualifier.';
export const VOICE_REFUSED_ELSEWHERE_MS = 60000;

/**
 * What GameHUD does on `voiceRefused` / `voiceForcedOff`: null for a frame
 * that is not the voice-off refusal; otherwise {remount, refusedTableId}.
 * remount is ALWAYS true: VoiceChat is remounted, and the unmount runs
 * leaveVoice (closes the peers, STOPS THE MIC). That matters for
 * voiceForcedOff: the server has already pulled the socket out of every voice
 * room, and the frame names the QUALIFIER table, which is often not the table
 * on screen (an extra qualifier seat taken while a cash table stays up), so
 * no table-based switch would unmount the old VoiceChat.
 */
export function voiceOffEventAction(data) {
  if (data && typeof data === 'object' && data.code && !isVoiceOffRefusal(data)) return null;
  const refusedTableId = data && typeof data === 'object' && data.tableId != null ? String(data.tableId) : null;
  return { remount: true, refusedTableId };
}

/**
 * Voice Chat on the table on screen: {off, note}. Off at a qualifier table
 * (VOICE_OFF_QUALIFIER_TEXT), or at the table a refusal named
 * (VOICE_OFF_ELSEWHERE_TEXT when that table is not a qualifier table).
 * `refusedTableId` is GameHUD's lapsing refusal (null = none).
 */
export function voiceOffState(gs, refusedTableId, known = knownQualifierTournamentIds) {
  if (voiceOffAt(gs, known)) return { off: true, note: VOICE_OFF_QUALIFIER_TEXT };
  const tid = gs && typeof gs === 'object' && gs.tableId != null ? String(gs.tableId) : null;
  if (refusedTableId != null && tid !== null && String(refusedTableId) === tid) return { off: true, note: VOICE_OFF_ELSEWHERE_TEXT };
  return { off: false, note: null };
}

/**
 * Owner answer (b), 2026-11-02: at a qualifier table the June Go Live overlay
 * is hidden for everyone. This sentence replaces the OBS URL in the Go Live
 * panel and is the whole ?overlay= slate (lock token). It replaces the
 * seated-only note "Streaming your own qualifier seat is not allowed." (N6).
 */
export const QUALIFIER_OFFICIAL_STREAM_TEXT = 'Qualifier tables are shown on the official American Pub Poker stream.';

/**
 * The June Go Live overlay is OFF at the table `gs`, for EVERYONE (seated or
 * watching): it is a qualifier table by the same evidence as helpToolsOffAt
 * (the server's isQualifier / qualifierId, a noted qualifier tournament id,
 * the seat places on the clock, a "Qualifier" table / tournament name). Cash
 * tables, Sit & Gos and every other table: false (the overlay works as before).
 * Never throws.
 */
export function goLiveOverlayOffAt(gs, known = knownQualifierTournamentIds) {
  return helpToolsOffAt(gs, known);
}

/**
 * StreamOverlayView draws the qualifier slate in place of the table when the
 * state it shows (`shown`, behind the delay), the panel's preview state
 * (`preview`), or - spectate mode - the NEWEST frame it received (`latestOff`
 * true: ahead of the delay, fail-closed) is a qualifier table. A table that
 * is no longer a qualifier table by all three shows normally again.
 */
export function overlayQualifierSlate(shown, preview, latestOff, known = knownQualifierTournamentIds) {
  return goLiveOverlayOffAt(shown, known) || goLiveOverlayOffAt(preview, known) || latestOff === true;
}

/**
 * GameHUD's `ownQualifierSeat` prop: `seated` (this socket PLAYS the table on
 * screen, GameHUD's seatedHere) at a qualifier table. Since owner answer (b)
 * the Go Live panel hides the URL at a qualifier table for everyone
 * (goLiveOverlayOffAt), so this is only a second, narrower signal for it.
 */
export function ownQualifierStreamBlocked(gs, seated, known = knownQualifierTournamentIds) {
  return seated === true && helpToolsOffAt(gs, known);
}

// ---- "Show me as Player on broadcasts" (per-player opt-out) -----------------
// Broadcasts name a player "First L." (poker-server broadcastNameOf); a player
// who opts out shows as "Player". The value lives on poker-server
// (users.stats.broadcastOptOut). Socket contract (signed-in socket):
//   C->S 'setBroadcastOptOut' {optOut:boolean}, 'getBroadcastOptOut' {}
//   S->C 'broadcastOptOutResult' {ok:true, optOut} | {ok:false, code:'login_required'|'save_failed'}
// QualifierLobby asks on mount, after every sign-in and on tab resume, and
// merges any `broadcastOptOut` a signed-in profile frame carries (Pattern B
// self-heal: a change made on another device reaches this tab).

export const BROADCAST_OPT_OUT_LABEL = 'Show me as Player on broadcasts';

/**
 * The qualifier card's streaming notice: the owner's approved rules line (1),
 * WORD FOR WORD (owner 2026-11-02, B1; the same line as the Live streams
 * section of content/qualifierRules.js). Never paraphrase it here. Lock
 * tokens: "qualifier-broadcast-notice" and "Qualifier tables may be shown live".
 */
export const QUALIFIER_BROADCAST_NOTICE_TEXT = 'Qualifier tables may be shown live and in replays on our social pages with your public name (first name and last initial), avatar and chip count. Hole cards are shown only on a delay or after the event.';

export const BROADCAST_OPTED_OUT_TEXT = 'You show as "Player" on broadcasts.';

/**
 * The opt-out a signed-in frame carries (`broadcastOptOut` at the top level, or
 * in `userData` - loginResult's shape - or in `userData.stats`, where
 * poker-server keeps it: loginResult.userData.stats.broadcastOptOut, stats an
 * object or its JSON text): true / false, or null when it says nothing (never
 * guessed; a stats blob without the key is "says nothing" here, so an older
 * server never shows a toggle it cannot save).
 */
export function broadcastOptOutOf(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  if (typeof frame.broadcastOptOut === 'boolean') return frame.broadcastOptOut;
  const u = frame.userData;
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  if (typeof u.broadcastOptOut === 'boolean') return u.broadcastOptOut;
  let stats = u.stats;
  if (typeof stats === 'string') {
    try { stats = JSON.parse(stats); } catch { stats = null; }
  }
  if (stats && typeof stats === 'object' && !Array.isArray(stats) && typeof stats.broadcastOptOut === 'boolean') return stats.broadcastOptOut;
  return null;
}

/** A `broadcastOptOutResult` frame: {ok:true, optOut} | {ok:false, code} | null (not one). */
export function broadcastOptOutReply(res) {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return null;
  if (res.ok === true && typeof res.optOut === 'boolean') return { ok: true, optOut: res.optOut };
  if (res.ok === false) return { ok: false, code: typeof res.code === 'string' && res.code ? res.code : 'save_failed' };
  return null;
}

/**
 * Merge the server's value into what this tab shows ({owner, optOut}). Returns
 * `prev` itself when nothing changes (no re-render, no log): a value that is
 * not a boolean, no owner, or the same owner + value.
 */
export function mergeBroadcastOptOut(prev, value, owner) {
  if (typeof value !== 'boolean' || owner === null || owner === undefined || owner === '') return prev;
  const o = String(owner);
  if (prev && typeof prev === 'object' && prev.owner === o && prev.optOut === value) return prev;
  return { owner: o, optOut: value };
}

/** The opt-out for `owner` (true / false), or null when this tab does not know it. */
export function broadcastOptOutFor(state, owner) {
  if (!state || typeof state !== 'object' || owner === null || owner === undefined) return null;
  return state.owner === String(owner) && typeof state.optOut === 'boolean' ? state.optOut : null;
}

/** A refused / unanswered toggle, in words (blue note, never red). */
export function broadcastOptOutErrorText(code) {
  if (code === 'login_required') return 'Sign in to change this.';
  if (code === 'no_answer') return 'The game server did not answer. Please try again.';
  // 2026-11-02 — poker-server's contract also answers these (src/broadcast/contract.ts).
  if (code === 'rate_limited') return 'Too many changes in a minute. Please wait a moment and try again.';
  if (code === 'load_failed') return 'Could not load this setting. Please try again.';
  return 'Could not save that. Please try again.';
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
