/**
 * leftTables — tables THIS socket has left, whose late gameState frames must
 * not put the player back at them (2026-10-10, S2 round 2 / V3).
 *
 * WHY. poker-server answers a 'leaveTable' with no frame of its own, and a
 * frame it queued for the table BEFORE it processed the leave (an older
 * server even folded + broadcast to the table room while the leaving socket
 * was still in it) lands AFTER the client cleared its table state. App.jsx
 * merged such a delta against the table's cached state (which still said
 * yourSeat 3), so the lobby held a stale seat nothing ever cleared: "Return to
 * Table" pointed at a table the socket had no session at, and the S2 "Return
 * to tournament" was refused as "Leave the table you are playing at first".
 *
 * Rule: after tableStore.leaveTable every gameState frame for that table is
 * IGNORED until something says the frames are this socket's again:
 *   - the server: 'reconnectedToTable' / a successful 'returnToTournamentResult'
 *     / 'tournamentStarted' / 'qualifierTournamentStarted' / a live
 *     'playerMoved' / 'additionalTableJoined' for it (App.jsx clearTableLeft),
 *     or 'tournamentSeatKept' for it (tableStore.forgetTableSession): the
 *     server has processed the leave — every stale frame came BEFORE it on
 *     this connection, and a fixed server sends nothing after it unless the
 *     socket views that table again (P-a / P-g);
 *   - the client: an outgoing emit naming that table (joinTable, spectate,
 *     joinAdditionalTable, ... payload.tableId), or one that can seat or
 *     place the socket at a table the client does not name (quickPlay & co.,
 *     spectateTournament, spectateNextTable, registerTournament & co.: they
 *     end every mark) (watchOutgoingSeatEmits, installed by socketService);
 *   - a socket disconnect (a new socket has no session the old one left);
 *   - LEFT_TABLE_IGNORE_MS without any of the above (backstop: a late frame
 *     arrives within a round trip of the leave, never minutes later).
 * Round 6 (simplify): there are no "sticky" marks any more. A server-side
 * leave ('tournamentSeatKept' after Android back + Watch / a join from the
 * lobby) never IGNORES that table — a Watch / Watch Live of his own table
 * that the server answers right after the keep is shown (it used to be
 * blanked for good).
 * An ignored frame is still merged into the table's MERGE BASE (the server's
 * delta baseline is per socket, so a later rejoin of the same table is sent as
 * a delta against what it last sent). The table's activeTables entry itself is
 * dropped at the leave, so nothing shows the table any more.
 *
 * Dependency-free (socketService, tableStore and App.jsx import it).
 */

export const LEFT_TABLE_IGNORE_MS = 15_000;

// Events that can seat / place this socket at a table the client does not
// name in the payload: they end the marks (the stale frames of a leave
// arrive within a round trip of it — long before a player can tap one of
// these).
const SEAT_ANYWHERE_EVENTS = new Set([
  'quickPlay', 'quickHeadsUp', 'quickSpinGo', 'quickAllInOrFold', 'startCareerGame',
  'joinByInviteCode', 'createPrivateTable', 'joinWithWaitlistContext', 'authWithTicket',
  'redeemEntryCode', 'rebuy',
  'registerTournament', 'registerQualifierTournament', 'startSimulatedTournament',
  'startClubTournament', 'spectateTournament', 'spectateNextTable',
]);
// Not here on purpose: 'returnToTournamentSeat' — its success is announced by
// 'reconnectedToTable' BEFORE the full gameState (P-c), which ends the mark of
// exactly that table.
// Emits that name a table but never seat the socket there.
const NOT_A_SEAT_EVENT = new Set(['leaveTable', 'leaveAdditionalTable', 'stopSpectating', 'inviteFriendToTable']);

const _left = new Map(); // tableId -> { at, ignoring, base, warned }

function idString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * This socket left `tableId`; `base` = the table's last merged state (merge
 * base). `ignore: false` keeps only the merge base (a server-side leave the
 * server already processed — tableStore.forgetTableSession).
 */
export function markTableLeft(tableId, base = null, { ignore = true } = {}) {
  const id = idString(tableId);
  if (!id) return;
  const prev = _left.get(id);
  _left.set(id, {
    at: Date.now(),
    ignoring: !!ignore,
    base: base && typeof base === 'object' ? base : (prev ? prev.base : null),
    warned: false,
  });
}

/** Is a gameState frame for `tableId` one to ignore (the socket left it)? */
export function isTableLeft(tableId) {
  const id = idString(tableId);
  if (!id) return false;
  const e = _left.get(id);
  if (!e || !e.ignoring) return false;
  if (Date.now() - e.at >= LEFT_TABLE_IGNORE_MS) { e.ignoring = false; return false; }
  return true;
}

/**
 * A frame for a table the socket left: keep it as the merge base and say so
 * once per leave. Returns true (the caller drops the frame).
 */
export function noteIgnoredLeftTableFrame(tableId, state) {
  const id = idString(tableId);
  const e = id ? _left.get(id) : null;
  if (!e) return false;
  if (state && typeof state === 'object') e.base = state;
  if (!e.warned) {
    e.warned = true;
    try { console.warn('[table-left] ignored a gameState frame for a table this socket left', { tableId: id }); } catch { /* ignore */ }
  }
  return true;
}

/** The merge base kept for a left table (or null). */
export function leftTableMergeBase(tableId) {
  const id = idString(tableId);
  const e = id ? _left.get(id) : null;
  return e && e.base ? e.base : null;
}

/** The socket is (about to be) at `tableId` again: stop ignoring its frames. */
export function clearTableLeft(tableId) {
  const id = idString(tableId);
  const e = id ? _left.get(id) : null;
  if (e) e.ignoring = false;
}

/** Stop ignoring left tables (a seat-anywhere emit). Merge bases stay. */
export function clearAllTablesLeft() {
  for (const e of _left.values()) e.ignoring = false;
}

/** A frame for the table was taken normally (it is in activeTables again). */
export function forgetLeftTable(tableId) {
  const id = idString(tableId);
  if (id) _left.delete(id);
}

/** Socket gone (disconnect / sign-out): nothing of the old socket's applies. */
export function resetLeftTables() {
  _left.clear();
}

/** Outgoing-emit hook (socketService): see the rule above. */
export function noteOutgoingSeatEmit(event, payload) {
  if (!_left.size || typeof event !== 'string') return;
  if (SEAT_ANYWHERE_EVENTS.has(event)) { clearAllTablesLeft(); return; }
  if (NOT_A_SEAT_EVENT.has(event)) return;
  const tId = payload && typeof payload === 'object' ? idString(payload.tableId) : null;
  if (tId) clearTableLeft(tId);
}

/** Wrap `sock.emit` so every outgoing emit passes noteOutgoingSeatEmit first. */
export function watchOutgoingSeatEmits(sock) {
  if (!sock || typeof sock.emit !== 'function' || sock.__leftTableEmitWatch) return sock;
  const emitBefore = sock.emit;
  sock.emit = function emitNotingSeats(ev, ...args) {
    try { noteOutgoingSeatEmit(ev, args[0]); } catch { /* never block an emit */ }
    return emitBefore.call(this || sock, ev, ...args);
  };
  sock.__leftTableEmitWatch = true;
  return sock;
}
