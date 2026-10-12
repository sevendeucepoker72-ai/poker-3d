/**
 * Friend table invites — the client half of cross-lane contract I1
 * (.online R3, 2026-10-11: K3-2 / S1-5 / CLUBS-5).
 *
 * Since R2 (C1) poker-server's joinTable seats only PUBLIC cash tables: a
 * private home game is entered through its invite code (joinByInviteCode) and
 * a club table through the club (joinClubTable, membership-checked). An invite
 * used to carry only the table id and its Join always sent joinTable, so an
 * invite from a home game or a club table was refused (table_not_joinable)
 * and the friend saw nothing happen.
 *
 * Server (I1): the inviter is answered `friendError { code, message }` or
 * `friendInviteSent { userId }`; the friend gets
 * `tableInvite { from, tableId, tableKind, inviteCode?, clubId?, clubTableId? }`.
 *
 * Pure module (no React, no store, no socket): AchievementPopup, the friends
 * lists, services/tableInviteJoin.js and the offline harness use it.
 */

/** Table kinds a friend can be invited to (gameState.tableKind, R1 contract #2). */
export const INVITABLE_TABLE_KINDS = Object.freeze(['cash', 'private', 'club']);

/**
 * The table id this player may invite friends to, else null: a table he is
 * SEATED at (never one he watches) whose kind is a ring game — cash, his home
 * game or a club table — never a tournament or a quick game. A club CHALLENGE
 * table is tableKind 'club' too; it is the only ring kind where rebuy is not
 * allowed (poker-server rebuyAllowedAt), so `rebuyAllowed === false` leaves it
 * out. A state without `tableKind` (an older server) offers no invite.
 */
export function inviteTableIdOf(gs, isSpectating = false) {
  if (!gs || typeof gs !== 'object') return null;
  const seated = gs.isSpectator !== true && !isSpectating && Number.isInteger(gs.yourSeat) && gs.yourSeat >= 0;
  if (!seated || gs.tableId === null || gs.tableId === undefined || gs.tableId === '') return null;
  if (gs.isTournament === true || (gs.tournamentId !== null && gs.tournamentId !== undefined)) return null;
  if (!INVITABLE_TABLE_KINDS.includes(gs.tableKind)) return null;
  if (gs.rebuyAllowed === false) return null;
  return gs.tableId;
}

/** True when he is seated at a table (any kind) — for the "why no Invite" hint. */
export function isSeatedAt(gs, isSpectating = false) {
  return !!gs && typeof gs === 'object' && gs.isSpectator !== true && !isSpectating
    && Number.isInteger(gs.yourSeat) && gs.yourSeat >= 0 && gs.tableId !== null && gs.tableId !== undefined;
}

export const INVITE_KIND_HINT = 'Friends can be invited to cash tables, home games and club tables — not to tournaments or quick games.';

// The inviter's refusals (friendError codes of inviteFriendToTable), in words.
export const INVITE_ERROR_TEXT = Object.freeze({
  invite_not_seated: 'You are not seated at that table any more. Sit down, then invite.',
  invite_not_joinable: INVITE_KIND_HINT,
  not_friends: 'You can only invite players on your friends list.',
  rate_limited: 'Too many requests. Wait a minute, then try again.',
  invite_target_offline: 'Your friend is not online right now.',
});

/** The text for an inviter's friendError frame (null when it is not an invite refusal code). */
export function inviteErrorText(frame) {
  const code = frame && typeof frame === 'object' ? frame.code : null;
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(INVITE_ERROR_TEXT, code)) return null;
  // R3 review (CLIENT-4) — invite_not_joinable: the server's own sentence when
  // it sends one (e.g. "This club table cannot be joined by invite right
  // now."); the generic kind hint only as a fallback.
  if (code === 'invite_not_joinable' && typeof frame.message === 'string' && frame.message.trim()) {
    return frame.message.trim().slice(0, 300);
  }
  return INVITE_ERROR_TEXT[code];
}

function idOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, 80) : null;
}

/**
 * The fields of a `tableInvite` frame the toast keeps (contract I1). An older
 * server sends only { from, tableId }: kind null = the cash path.
 */
export function tableInviteFields(data) {
  const d = data && typeof data === 'object' ? data : {};
  const kind = typeof d.tableKind === 'string' && d.tableKind ? d.tableKind.slice(0, 20) : null;
  const code = typeof d.inviteCode === 'string' && d.inviteCode.trim() ? d.inviteCode.trim().toUpperCase().slice(0, 20) : null;
  return {
    inviteTableId: idOrNull(d.tableId),
    inviteTableKind: kind,
    inviteCode: code,
    inviteClubId: idOrNull(d.clubId),
    inviteClubTableId: idOrNull(d.clubTableId),
  };
}

/**
 * How to accept an invite (the toast's Join): `{ event, errorEvent, tableId,
 * payload }`, or null when it names nothing to join. Routed by tableKind —
 * 'private' + inviteCode → joinByInviteCode (answers refusals on 'joinError'),
 * 'club' + clubTableId → joinClubTable (membership-checked), anything else
 * (cash, an unknown kind, an older server's invite) → joinTable. buyIn 0 =
 * the server clamps it to the table minimum; the cash path keeps its 1000
 * (clamped to the table's limits by the server).
 */
export function inviteJoinRequest(n, { playerName = '', avatar = null } = {}) {
  if (!n || typeof n !== 'object') return null;
  const tableId = n.inviteTableId ?? null;
  if (n.inviteTableKind === 'private' && n.inviteCode) {
    return { event: 'joinByInviteCode', errorEvent: 'joinError', tableId, payload: { inviteCode: n.inviteCode, playerName, buyIn: 0, avatar } };
  }
  if (n.inviteTableKind === 'club' && n.inviteClubTableId !== null && n.inviteClubTableId !== undefined) {
    return { event: 'joinClubTable', errorEvent: 'error', tableId, payload: { clubTableId: n.inviteClubTableId, playerName, seatIndex: -1, buyIn: 0, avatar } };
  }
  if (tableId === null) return null;
  return { event: 'joinTable', errorEvent: 'error', tableId, payload: { tableId, playerName, seatIndex: -1, buyIn: 1000, avatar } };
}

// The friend's side: a refused Join, in words. Codes whose server sentence is
// already written for players (club_table_unavailable, buy_in_cancelled, the
// membership refusal) keep the server's words.
export const INVITE_JOIN_ERROR_TEXT = Object.freeze({
  table_not_joinable: 'That table can no longer be joined from this invite.',
  invite_code_not_found: 'That home game has closed, so the invite has expired.',
  variant_mismatch: 'That table changed its game. Pick a table from the lobby instead.',
});
export const INVITE_JOIN_FALLBACK_TEXT = 'Could not join your friend\'s table.';
export const INVITE_JOIN_NO_ANSWER_TEXT = 'The game server did not answer. Ask your friend to send the invite again.';

/** The text for a refused invite Join (an 'error' / 'joinError' frame). */
export function inviteJoinErrorText(frame) {
  const f = frame && typeof frame === 'object' ? frame : {};
  if (typeof f.code === 'string' && Object.prototype.hasOwnProperty.call(INVITE_JOIN_ERROR_TEXT, f.code)) return INVITE_JOIN_ERROR_TEXT[f.code];
  if (typeof f.message === 'string' && f.message.trim()) return f.message.trim().slice(0, 300);
  return INVITE_JOIN_FALLBACK_TEXT;
}

/**
 * `${tableId}:${seat}` when `gs` shows this player seated (a named seat), else
 * null — the same signature the lobby / home-game joins confirm a seat with.
 */
export function seatSigOf(gs) {
  if (!gs || typeof gs !== 'object' || gs.isSpectator === true) return null;
  const seat = gs.yourSeat;
  if (!Number.isInteger(seat) || seat < 0) return null;
  const s = Array.isArray(gs.seats) ? gs.seats[seat] : null;
  return s && s.playerName ? `${gs.tableId ?? '?'}:${seat}` : null;
}
