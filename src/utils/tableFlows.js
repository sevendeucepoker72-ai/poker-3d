/**
 * Navigation, reconnect, join / leave and lobby rules (gameplay audit
 * 2026-10-21, cluster C3).
 *
 * Pure module (no React, no store, no socket): App.jsx, GameHUD, the table
 * store, the join services, the lobby screens and the offline probes use it.
 * Every server key read here is OPTIONAL — a frame without it (an older
 * poker-server) gets the behaviour the client had before these rules.
 */

const idStr = (v) => (v === null || v === undefined || v === '' ? null : String(v));

// ── Multi-table scope (F156) ────────────────────────────────────────────────

/**
 * The `tableId` a table-scoped emit carries: the table on screen in
 * multi-table mode (`currentTableId`, the value sendAction already sends),
 * `undefined` in single-table mode (no key on the wire: the server acts on
 * the main seat, exactly as before).
 */
export function tableScope(currentTableId) {
  return currentTableId === null || currentTableId === undefined || currentTableId === '' ? undefined : currentTableId;
}

/**
 * A reply that names ANOTHER table than the one on screen (F156): a newer
 * server stamps `tableId` on sitOutToggled / missedBlinds* / trainingToggled /
 * rabbitHuntResult / … — such a reply is for a background table and must not
 * change the table on screen. A reply without `tableId` (an older server) is
 * never "another table's".
 */
export function isOtherTableReply(data, shownTableId) {
  if (!data || typeof data !== 'object') return false;
  const t = idStr(data.tableId);
  if (t === null) return false;
  const shown = idStr(shownTableId);
  return shown === null || t !== shown;
}

/**
 * C3 fix-up (F87 / F156) — the MAIN seat's table in multi-table mode: the
 * live cached entry that is not an extra (joinAdditionalTable) seat. It is
 * the seat a reload restores (the remembered Sit Out is its), and the one an
 * older server's bare `sitOut` toggles. null in single-table mode / none held.
 * Returns the activeTables key.
 */
export function mainTableIdOf(ts) {
  if (!ts || ts.currentTableId === null || ts.currentTableId === undefined || ts.currentTableId === '') return null;
  const at = ts.activeTables;
  if (!at || typeof at.forEach !== 'function') return null;
  let key = null;
  at.forEach((entry, id) => {
    if (key !== null || !entry || entry.extra) return;
    const gs = entry.gameState;
    if (!gs || typeof gs !== 'object' || gs.isSpectator === true || !(Number(gs.yourSeat) >= 0)) return;
    key = id;
  });
  return key;
}

/**
 * Is the seat on screen sitting out (F156 / F87)? Multi-table mode: the shown
 * table's own frame (`gameState.sittingOut`, stamped by the server on every
 * seat frame — main deltas and extra full snapshots); single-table mode: the
 * store flag (Z12: follows the server's frames + sitOutToggled).
 */
export function sittingOutHereOf({ currentTableId, gameState, sittingOut } = {}) {
  if (currentTableId !== null && currentTableId !== undefined && currentTableId !== '') {
    return !!gameState && gameState.sittingOut === true;
  }
  return !!sittingOut;
}

// ── Cold-boot seat restore (F138) ───────────────────────────────────────────

/** A boot restore older than this is stale (the login that follows it answers within ms). */
export const BOOT_RESTORE_MAX_AGE_MS = 30000;

/**
 * F138 — the server restored this socket's seat ('reconnectedToTable', then
 * the full gameState) BEFORE the boot sign-in's loginResult, so the store's
 * login() put the player in the lobby while his seat kept playing. Once the
 * sign-in lands: open the table when the restore is recent, the screen is the
 * lobby (never over 'chooseUsername' or another screen), and the table store
 * still shows that seat (same table, a seat, not watching).
 */
export function bootRestoreShowsTable(pending, { screen, gameState, isSpectating, now = Date.now() } = {}) {
  if (!pending || typeof pending !== 'object') return false;
  if (!(Number(pending.at) > 0) || now - Number(pending.at) > BOOT_RESTORE_MAX_AGE_MS) return false;
  if (screen !== 'lobby') return false;
  if (!gameState || typeof gameState !== 'object' || isSpectating || gameState.isSpectator === true) return false;
  if (!(Number(gameState.yourSeat) >= 0)) return false;
  const want = idStr(pending.tableId);
  return want === null || idStr(gameState.tableId) === want;
}

/**
 * F140 — the store's login keeps the TABLE screen (instead of demoting it to
 * the lobby) while the table store holds a live seat: a later sign-in answer
 * (a bridged hand-off after a waitlist seat) never pulls him off his table.
 */
export function loginKeepsTable({ screen, gameState, isSpectating } = {}) {
  return screen === 'table' && !!gameState && !isSpectating && gameState.isSpectator !== true
    && Number(gameState.yourSeat) >= 0;
}

// ── New-hand card wipe (G174) ───────────────────────────────────────────────

/**
 * G174 — a new-hand delta without `yourCards` used to wipe the hero's cards;
 * the server leaves `yourCards` out when the new hand dealt him the SAME two
 * cards (unchanged against its per-socket baseline), so he saw no cards and
 * no action bar for the whole hand. An absent key means "unchanged": wipe only
 * on a cross-table merge (no merge base, or a base of another table).
 */
export function newHandWipesYourCards(delta, prev) {
  if (!delta || typeof delta !== 'object') return false;
  if (delta.yourCards) return false;
  return !prev || idStr(prev.tableId) !== idStr(delta.tableId);
}

// ── Resync after a reconnect / resume (F155) ────────────────────────────────

/** This socket SITS at the table on screen (not watching it). */
export function wasSeatedOf(ts) {
  const gs = ts && ts.gameState;
  return !!gs && !(ts && ts.isSpectating) && gs.isSpectator !== true && Number(gs.yourSeat) >= 0;
}

/**
 * F155 — the payload of `syncTableState` / `requestState`: the table on screen
 * and whether this socket sat there, so a newer server can re-attach a socket
 * whose seat is gone as a spectator (and say so) or close a table that is
 * gone. null when no table is on screen (`requestState` then goes bare).
 */
export function resyncPayloadOf(ts, screen = 'table') {
  if (!ts || screen !== 'table') return null;
  const tableId = (ts.gameState && ts.gameState.tableId != null) ? ts.gameState.tableId : null;
  if (tableId === null) return null;
  return { tableId, wasSeated: wasSeatedOf(ts) };
}

/**
 * C3 fix-up (F155) — `tableClosed {reason:'table_gone'}` (a newer server: the
 * table a resync named no longer exists — a restart, or any other end). The
 * chips sentence is only for a socket that SAT at a table whose stack the
 * server credits back (the shutdown flush / teardown cash every seat that is
 * not a tournament or a Spin & Go one); a spectator, a tournament / Spin & Go
 * seat, or a frame of unknown kind (no `tableKind`) gets the neutral line.
 */
export const TABLE_GONE_TEXT = 'This table is no longer running.';
export const TABLE_GONE_CHIPS_TEXT = 'This table is no longer running. Your chips from it are back in your balance.';
export function tableGoneCreditsChips(gs, seated) {
  if (!seated || !gs || typeof gs !== 'object') return false;
  if (gs.isTournament === true || (gs.tournamentId !== null && gs.tournamentId !== undefined)) return false;
  const kind = gs.tableKind;
  return typeof kind === 'string' && kind !== '' && kind !== 'tournament' && kind !== 'spingo';
}

export const SEAT_RELEASED_TEXT = 'Your seat was released while you were away - your chips are back in your balance. You are watching the table; tap Sit Here on an open seat to play again.';

// ── A seat the server ended on this socket (F88) ────────────────────────────

export const SEAT_VACATED_TEXT = Object.freeze({
  joined_new_seat: 'This table was opened in another window or device, so this window left it.',
  left_after_hand: 'Your seat at this table has ended.',
  // C3 fix-up (F88) — a newer server stands an extra seat up after the
  // sit-out limit (teardownSeat credits its stack).
  sit_out_limit: 'You were sitting out for a while, so this seat was released and its chips went back to your balance.',
});

/** The line for socket `seatVacated { tableId, seatIndex, reason }`. */
export function seatVacatedText(reason) {
  if (reason === 'joined_new_seat') return SEAT_VACATED_TEXT.joined_new_seat;
  if (reason === 'sit_out_limit') return SEAT_VACATED_TEXT.sit_out_limit;
  return SEAT_VACATED_TEXT.left_after_hand;
}

/** The text an extra-table slot shows when the server ended its seat (F88). */
export const SLOT_VACATED_TEXT = 'This table is open in another window - this view has ended.';

/**
 * C3 fix-up (F88) — the slot tile's line for `seatVacated.reason`: the "open
 * in another window" text only for 'joined_new_seat' (the server sends
 * 'left_after_hand' — a stale session cleared after the hand — and
 * 'sit_out_limit' to slot sockets too); otherwise seatVacatedText.
 */
export function slotVacatedText(reason) {
  return reason === 'joined_new_seat' ? SLOT_VACATED_TEXT : seatVacatedText(reason);
}

// ── A refused join that already left the old table (F143) ───────────────────

/** `leftTableId` of a refusal frame (the server left that table in the same request), else null. */
export function leftTableIdOf(frame) {
  if (!frame || typeof frame !== 'object') return null;
  return typeof frame.leftTableId === 'string' && frame.leftTableId ? frame.leftTableId : null;
}

// ── Leaving the seat(s) for a join elsewhere (F145 / F141) ──────────────────

function liveSeatsOf(ts) {
  const out = [];
  const seen = new Set();
  const add = (gs) => {
    if (!gs || typeof gs !== 'object' || gs.isSpectator === true || !(Number(gs.yourSeat) >= 0)) return;
    const id = idStr(gs.tableId);
    if (id === null || seen.has(id)) return;
    seen.add(id);
    out.push(gs);
  };
  if (ts && ts.gameState && !ts.isSpectating) add(ts.gameState);
  const at = ts && ts.activeTables;
  if (at && typeof at.forEach === 'function') at.forEach((e) => add(e && e.gameState));
  return out;
}

const LIVE_HAND_PHASES_OFF = new Set(['WaitingForPlayers', 'HandComplete', 'Showdown']);

/**
 * The seats this socket plays OTHER than `targetTableId` (the table a join is
 * about to take him to): the shown seat and every live multi-table entry.
 */
export function seatsElsewhere(ts, targetTableId) {
  const target = idStr(targetTableId);
  return liveSeatsOf(ts).filter((gs) => idStr(gs.tableId) !== target);
}

/**
 * F145 / F141 — a join from a toast (a friend's invite, a club challenge)
 * makes the server LEAVE every seat this socket holds (a Spin & Go entry is
 * forfeited, a live cash hand folded, a tournament seat kept absent). The
 * question to ask first, the same consequences GameHUD's Back to Lobby states,
 * or null when he holds no other seat (nothing to ask).
 * `tournamentTableId`: the table of this tab's live tournament seat, if any.
 */
export function leaveForJoinConfirmText(ts, targetTableId, { tournamentTableId = null } = {}) {
  const seats = seatsElsewhere(ts, targetTableId);
  if (!seats.length) return null;
  const tourTable = idStr(tournamentTableId);
  const parts = ['Joining that table leaves the table you are playing now.'];
  let cashBack = false;
  let handFolded = false;
  let spinGo = false;
  let tournament = false;
  for (const gs of seats) {
    const mine = Array.isArray(gs.seats) ? gs.seats[gs.yourSeat] : null;
    const isTour = gs.isTournament === true || (gs.tournamentId !== null && gs.tournamentId !== undefined)
      || (tourTable !== null && idStr(gs.tableId) === tourTable);
    if (isTour) { if (!(mine && mine.eliminated)) tournament = true; continue; }
    if (gs.tableKind === 'spingo' && mine && !mine.eliminated && Number(mine.chipCount) > 0) { spinGo = true; continue; }
    cashBack = true;
    const inLiveHand = !!gs.phase && !LIVE_HAND_PHASES_OFF.has(gs.phase);
    if (inLiveHand && mine && !mine.folded) handFolded = true;
  }
  if (spinGo) parts.push('Leaving forfeits your Spin & Go entry.');
  if (tournament) parts.push('Your tournament seat stays in play while you are away; return to it from the lobby.');
  if (cashBack) parts.push(handFolded ? 'Your hand in progress is folded, and the rest of your chips go back to your balance.' : 'Your chips there go back to your balance.');
  if (seats.length > 1) parts.push('Every table you are playing is left.');
  parts.push('Join anyway?');
  return parts.join(' ');
}

/**
 * C3 fix-up (F141 / F143) — the tables a join from THIS socket's main seat
 * ends server-side. joinTable / joinByInviteCode run handlePlayerLeave when
 * the socket has a main session, and that also tears down EVERY extra
 * (joinAdditionalTable) seat of the socket. So in multi-table mode, when a
 * live MAIN (non-extra) entry is held, every live cached entry other than
 * `targetTableId` is gone once the join lands; with only extra seats (no main
 * session) the server leaves them alone, so nothing is listed. Single-table
 * mode: [] (the new seat replaces the view; the store settles the old entry).
 * Returns the activeTables keys.
 */
export function tablesLeftByMainJoin(ts, targetTableId) {
  const out = [];
  if (!ts || ts.currentTableId === null || ts.currentTableId === undefined) return out;
  const at = ts.activeTables;
  if (!at || typeof at.forEach !== 'function') return out;
  const target = idStr(targetTableId);
  let hadMain = false;
  at.forEach((entry, id) => {
    const gs = entry && entry.gameState;
    if (!gs || typeof gs !== 'object' || gs.isSpectator === true || !(Number(gs.yourSeat) >= 0)) return;
    if (target !== null && idStr(id) === target) return;
    if (!entry.extra) hadMain = true;
    out.push(id);
  });
  return hadMain ? out : [];
}

/**
 * C3 fix-up (F143) — a refusal that names `leftTableId` came AFTER the server
 * left the socket's main seat, and that leave ended every extra seat too:
 * the tables to forget = the named one(s) (`leftTableId`, and a newer
 * server's optional `leftTableIds` list) plus every cached EXTRA entry.
 */
export function tablesEndedByRefusal(frame, activeTables) {
  const ids = [];
  const seen = new Set();
  const add = (v) => { const s = idStr(v); if (s !== null && !seen.has(s)) { seen.add(s); ids.push(s); } };
  const left = leftTableIdOf(frame);
  if (!left) return ids;
  add(left);
  if (Array.isArray(frame.leftTableIds)) frame.leftTableIds.forEach((v) => { if (typeof v === 'string') add(v); });
  if (activeTables && typeof activeTables.forEach === 'function') {
    activeTables.forEach((entry, id) => { if (entry && entry.extra) add(id); });
  }
  return ids;
}

/**
 * F141 — a club challenge the other player accepted auto-joins only a socket
 * with no seat anywhere (not on the table screen) in the visible tab; every
 * other tab / a seated socket gets a notice with a Join button instead.
 */
export function challengeAutoJoinAllowed(ts, { screen, visible = true } = {}) {
  if (!visible) return false;
  if (screen === 'table') return false;
  return liveSeatsOf(ts).length === 0;
}

/** CHALLENGE_JOIN_GRACE_MS on the server (index.ts): the challenge is voided after this. */
export const CHALLENGE_JOIN_WINDOW_MS = 180000;

export function clubChallengeNoticeText(stakes) {
  const n = Number(stakes);
  const buyIn = Number.isFinite(n) && n > 0 ? ` (buy-in ${Math.round(n).toLocaleString()} chips)` : '';
  return `Your club challenge was accepted${buyIn}. Tap Join challenge within 3 minutes - joining leaves the table you are playing now.`;
}

// ── Qualifier re-entry (F142) ───────────────────────────────────────────────

/**
 * The running / late-registration actions of a qualifier row (F142):
 *   lateRegister  Late Register (not registered, qualified, late reg open)
 *   reenter       Re-enter (registered, his entry is OUT, late reg open, a
 *                 credit to spend and re-entries left)
 *   outLine       "You are out of this qualifier." (out, no re-entry)
 *   goToTable     ↩ Go to my table (registered and still in — or an older
 *                 server that does not say: `eliminated` null)
 *   watch         Watch Live (not registered)
 */
export function qualifierRunningActions({ state, mine, eliminated, qualified, reEntriesLeft, tournamentId } = {}) {
  const late = state === 'late';
  const out = !!mine && eliminated === true;
  const reenter = out && late && !!qualified && (reEntriesLeft === null || reEntriesLeft === undefined || reEntriesLeft > 0);
  return {
    lateRegister: late && !!qualified && !mine,
    reenter,
    outLine: out && !reenter,
    goToTable: !!tournamentId && !!mine && eliminated !== true,
    watch: !!tournamentId && !mine,
  };
}

// ── What a stake costs (F146 / F151) ────────────────────────────────────────

/**
 * Career venue buy-ins — mirror poker-server index.ts 'Career venue configs'
 * (startCareerGame `venueConfigs[].buyIn`); the server's number is the one
 * charged. Opponents = players - 1.
 */
export const CAREER_VENUE_BUYINS = Object.freeze([1000, 5000, 15000, 50000, 100000, 500000]);

/**
 * Quick-game buy-ins — mirror poker-server index.ts HEADS_UP_BUYIN /
 * SPINGO_BUYIN / AOF_BUYIN (authenticated players; guests pay nothing).
 * Heads-Up and All-In or Fold are cash formats (the stack comes back on
 * leaving); a Spin & Go entry is a fee (prize = multiplier x entry, 2x-25x).
 */
export const QUICK_GAME_COSTS = Object.freeze({ headsUp: 1000, spinGo: 500, allInOrFold: 1000 });
export const SPIN_GO_MULTIPLIER_RANGE = Object.freeze([2, 25]);

export function quickGameCostText(kind) {
  if (kind === 'spinGo') {
    const fee = QUICK_GAME_COSTS.spinGo;
    const [lo, hi] = SPIN_GO_MULTIPLIER_RANGE;
    return `Entry ${fee.toLocaleString()} chips · prize ${(fee * lo).toLocaleString()}-${(fee * hi).toLocaleString()}`;
  }
  const cost = QUICK_GAME_COSTS[kind];
  return Number.isFinite(cost) ? `Buy-in ${cost.toLocaleString()} chips · back when you leave` : '';
}

export function careerBuyInText(venueIndex) {
  const n = CAREER_VENUE_BUYINS[venueIndex];
  return Number.isFinite(n) ? `${n.toLocaleString()} chips (your table stack - returned when you leave)` : null;
}

// ── A queued seat move (F78) ────────────────────────────────────────────────

/**
 * F78 — a queued seat move ("Moving to seat N after this hand") runs at the
 * next hand boundary, before the next hand is dealt. Once a LATER hand shows
 * at that table and he is not in the target seat, the move did not happen
 * (the seat was taken, the table capped it): the pill ends even when the
 * server says nothing (an older server sends no moveSeatCancelled).
 * `pm` = { tableId, seat, handNumber } (the hand it was queued in).
 */
export function pendingMoveExpired(pm, gameState) {
  if (!pm || !gameState || typeof gameState !== 'object') return false;
  if (pm.tableId != null && idStr(gameState.tableId) !== idStr(pm.tableId)) return false;
  if (pm.handNumber === null || pm.handNumber === undefined || gameState.handNumber === null || gameState.handNumber === undefined) return false;
  const from = Number(pm.handNumber);
  const now = Number(gameState.handNumber);
  if (!Number.isFinite(from) || !Number.isFinite(now) || now <= from) return false;
  return Number(gameState.yourSeat) !== Number(pm.seat);
}

// ── Dealer's Choice label (F15) ─────────────────────────────────────────────

/**
 * F15 — the Dealer's Choice label names a game only when it is the game
 * actually dealt (the server's `variant`); the server never rebuilt the table,
 * so a label of Omaha / Stud over a Hold'em deal was false.
 */
export function dealersChoiceTruthful(gs) {
  if (!gs || typeof gs !== 'object' || !gs.dealersChoice) return false;
  const v = gs.dealersChoiceVariant;
  return typeof v === 'string' && !!v && v === gs.variant;
}

// ── Provably-fair frames (F162) ─────────────────────────────────────────────

/**
 * F162 — a `deckCommitment` / `deckSeedRevealed` frame naming another table
 * than the one on screen is not this table's (multi-table: every room this
 * socket is in sends them). C3 fix-up: with NO table on screen it is accepted
 * — the server deals the first hand after a join (and sends its commitment)
 * BEFORE it sends the joining socket its first gameState.
 */
export function deckFrameForShownTable(frame, shownTableId) {
  if (!frame || typeof frame !== 'object') return false;
  if (idStr(shownTableId) === null) return true;
  return !isOtherTableReply(frame, shownTableId);
}

/** A reveal belongs with the commitment shown (same hand), or there is none yet. */
export function revealMatchesCommitment(reveal, commitment) {
  if (!reveal || typeof reveal !== 'object') return false;
  if (!commitment || typeof commitment !== 'object') return true;
  const rt = idStr(reveal.tableId);
  const ct = idStr(commitment.tableId);
  if (rt !== null && ct !== null && rt !== ct) return false;
  return commitment.handNumber === reveal.handNumber;
}

// C3 fix-up (F162) — the latest commitment (+ its reveal) of EACH table a newer
// server names (`tableId`), kept in the table store's `deckByTable`
// (tableId -> { commitment, revelation }); `deckCommitment` / `deckRevelation`
// are the shown table's. A background table never overwrites the shown one,
// the first hand after a join (its commitment comes before the first
// gameState) is kept and shown once that table is on screen, and a reveal is
// checked against ITS table's commitment. A frame without `tableId` (an older
// server) works exactly as before.
export const DECK_TABLES_KEPT = 12;

const shownIdOf = (s) => idStr(s && s.gameState ? s.gameState.tableId : null);
const deckMapOf = (s) => (s && s.deckByTable instanceof Map ? s.deckByTable : null);

/** The table-store update for a `deckCommitment` frame (`s` = store state), or null. */
export function deckCommitmentUpdate(s, c) {
  if (!c || typeof c !== 'object') return null;
  const id = idStr(c.tableId);
  if (id === null) return { deckCommitment: c, deckRevelation: null };
  const byTable = new Map(deckMapOf(s) || []);
  byTable.delete(id);
  byTable.set(id, { commitment: c, revelation: null });
  while (byTable.size > DECK_TABLES_KEPT) byTable.delete(byTable.keys().next().value);
  const out = { deckByTable: byTable };
  const shown = shownIdOf(s);
  if (shown === null || shown === id) { out.deckCommitment = c; out.deckRevelation = null; }
  return out;
}

/** The table-store update for a `deckSeedRevealed` frame, or null (dropped). */
export function deckRevelationUpdate(s, r) {
  if (!r || typeof r !== 'object') return null;
  const id = idStr(r.tableId);
  const cur = s ? s.deckCommitment : null;
  if (id === null) return revealMatchesCommitment(r, cur) ? { deckRevelation: r } : null;
  const out = {};
  const byTable = deckMapOf(s);
  const entry = byTable ? byTable.get(id) : null;
  if (entry && revealMatchesCommitment(r, entry.commitment)) {
    const next = new Map(byTable);
    next.set(id, { ...entry, revelation: r });
    out.deckByTable = next;
  }
  const shown = shownIdOf(s);
  if ((shown === null || shown === id) && revealMatchesCommitment(r, cur)) out.deckRevelation = r;
  return Object.keys(out).length ? out : null;
}

/**
 * The shown commitment / reveal once the table on screen changed, or null
 * (keep): that table's own when one was kept, none when the one shown is
 * another table's. An older server's (no `tableId`) is kept as before.
 */
export function deckViewForShownTable(s) {
  const shown = shownIdOf(s);
  if (shown === null) return null;
  const cur = s.deckCommitment;
  if (cur && typeof cur === 'object' && idStr(cur.tableId) === null) return null;
  if (cur && idStr(cur.tableId) === shown) return null;
  const byTable = deckMapOf(s);
  const entry = byTable ? byTable.get(shown) : null;
  if (!entry && !cur) return null;
  return { deckCommitment: entry ? entry.commitment : null, deckRevelation: entry ? entry.revelation : null };
}
