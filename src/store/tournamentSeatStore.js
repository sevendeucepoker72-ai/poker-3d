/**
 * tournamentSeatStore — this tab's live TOURNAMENT seat, and the seats the
 * player stepped away from (2026-10-10, S2).
 *
 * WHY. "Back to Lobby" / "Customize Avatar" used to send socket 'leaveTable'
 * for a tournament seat exactly like a cash seat, and poker-server stood the
 * seat up: the stack was gone, the entrant stayed "alive" with no seat and the
 * tournament could never finish. poker-server now keeps a voluntarily left
 * LIVE tournament seat IN PLAY as absent (blinded / auto-folded on the short
 * absent clock, never cashed out), ends only the socket's session at that
 * table and tells the socket so ('tournamentSeatKept'). The S2 protocol
 * (CONTRACTS C5, fixed 2026-10-10 round 2):
 *   P-a  a voluntary leave → 'tournamentSeatKept' {tournamentId, tableId,
 *        seatIndex, tournamentName, chips} to the leaving socket;
 *   P-b  a sign-in NEVER auto-restores such a VOLUNTARY seat: after its answer
 *        it sends 'tournamentSeatKept' for each one (current table / seat
 *        after any rebalance). A disconnect reservation is still restored
 *        ('reconnectedToTable' carries tournamentId for a tournament seat);
 *   P-c  "Return to tournament" = socket 'returnToTournamentSeat' {tournamentId}
 *        with an ack (services/tournamentReturn.js). P-c'' (round 6): the
 *        LATEST connection wins — a Return always takes the seat, also from
 *        another tab / device of the same account, which is told
 *        'tournamentSeatTakenOver' {tournamentId, tableId, seatIndex} (that
 *        tab gets this seat back as an away seat + a toast);
 *   P-d  a tournament table's gameState carries isTournament / tournamentId.
 * This store is what the client keeps of that:
 *   - `seat`       the tournament seat this socket is playing (socket
 *                  'tournamentStarted' / 'qualifierTournamentStarted' /
 *                  'playerMoved' / 'reconnectedToTable', and a gameState that
 *                  carries `isTournament` / `tournamentId`);
 *   - `awaySeats`  the seats in play WITHOUT this socket — left from this tab
 *                  (Back to Lobby / Customize Avatar) or announced by the
 *                  server ('tournamentSeatKept': a reload, a server-side leave
 *                  by joinTable / quickPlay / spectate from the lobby, Android
 *                  back, a rebalance that moved the absent seat;
 *                  'tournamentSeatTakenOver': another tab / device of the
 *                  account returned to it). The lobby offers "Return to
 *                  tournament" for each (TournamentReturnBanner) until he is
 *                  back, the tournament ends for him (the server's plain
 *                  'playerEliminated' notice with a tournamentId — P-e' —,
 *                  'tournamentFinishedForEntrant' — P-h' — or the room's
 *                  'tournamentFinished', or an older server's
 *                  eliminatedToSpectator), the server answers
 *                  no_tournament_seat (P-c': the only ANSWER that forgets it),
 *                  or the player taps Dismiss after a Return got no answer at
 *                  all (an older server);
 *   - `away`       awaySeats[0] (or null) — kept for readers of one seat;
 *   - `returning`  the key of the away seat a Return is in flight for;
 *   - `notice`     the blue/gold line the lobby banner shows (`noticeKind`:
 *                  'info' | 'not_found' | 'finished' | 'no_answer' — a seat
 *                  the server announces again clears a stale 'not_found' /
 *                  'no_answer' line; `noticeKey` = the away seat a
 *                  'no_answer' line is about: its banner row offers Dismiss);
 *   - `seatRestored` a seat the server restored in the BACKGROUND (a
 *                  reconnect) while the player was in the avatar customizer:
 *                  the screen is not switched, a banner offers the table.
 * Memory only (per page load): after a reload the server's
 * 'tournamentSeatKept' / 'reconnectedToTable' and the gameState markers
 * rebuild it. Imports nothing but zustand (gameStore imports it to forget the
 * seats on sign-out).
 */
import { create } from 'zustand';

function idString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

const DEFAULT_NAME = 'your tournament';

/**
 * P-i / P-j (round 6) — what an ABSENT tournament seat (away, or sitting out
 * at a tournament table) is auto-acted: folded, except that it may CHECK, or
 * call at most one big blind when everyone else still in the hand is absent
 * too. Every "folded for you" line says so with this phrase.
 */
export const TOURNAMENT_ABSENT_LIMP_NOTE = 'we may check or limp the blind for you';

/** The identity of an away seat: its tournament, else its table. */
export function awaySeatKey(entry) {
  if (!entry) return null;
  const t = idString(entry.tournamentId);
  if (t) return `t:${t}`;
  const tb = idString(entry.tableId);
  return tb ? `table:${tb}` : null;
}

export const useTournamentSeatStore = create(() => ({
  seat: null,        // { tournamentId, tableId, name }
  awaySeats: [],     // [{ key, tournamentId, tableId, seatIndex, chips, name, leftAt, via }]
  away: null,        // awaySeats[0] || null
  returning: null,   // key of the away seat being returned to | null
  notice: null,      // string | null
  noticeKind: null,  // 'info' | 'not_found' | 'finished' | 'no_answer' | null
  noticeKey: null,   // the away seat a 'no_answer' line is about (Dismiss)
  seatRestored: null, // { tableId, seatIndex, tournamentId } | null
  bannerBottom: 0,   // px: the Return banner's bottom edge while shown (layout only)
}));

/**
 * Round 3 — the fixed "Return to tournament" banner reports its bottom edge
 * (0 = not shown) so the lobby's join-error toast stacks BELOW it.
 */
export function setTournamentBannerBottom(px) {
  const v = Number.isFinite(px) && px > 0 ? Math.ceil(px) : 0;
  if (useTournamentSeatStore.getState().bannerBottom !== v) useTournamentSeatStore.setState({ bannerBottom: v });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * P-h — the line for a tournament that FINISHED (never "may have ended" when
 * the client knows): "<name> has finished: you placed 3rd." / "<name> has
 * finished." when his place is not known.
 */
export function tournamentFinishedText(name, position) {
  const n = (typeof name === 'string' && name.trim()) || DEFAULT_NAME;
  const pos = Number(position);
  const label = n.charAt(0).toUpperCase() + n.slice(1);
  return Number.isInteger(pos) && pos > 0 ? `${label} has finished: you placed ${ordinal(pos)}.` : `${label} has finished.`;
}

const st = () => useTournamentSeatStore.getState();
// A new / cleared notice line drops the Dismiss key unless the patch names one.
const put = (patch) => useTournamentSeatStore.setState(
  ('notice' in patch || 'noticeKind' in patch) && !('noticeKey' in patch) ? { ...patch, noticeKey: null } : patch,
);
// Every write of the away list goes through here so `away` stays its head.
const putAway = (list, patch = {}) => put({ ...patch, awaySeats: list, away: list.length ? list[0] : null });

function sameSeat(a, b) {
  if (!a || !b) return false;
  const at = idString(a.tournamentId); const bt = idString(b.tournamentId);
  if (at && bt) return at === bt;
  return !!idString(a.tableId) && idString(a.tableId) === idString(b.tableId);
}

function upsertAway(entry) {
  const list = st().awaySeats.filter((a) => !sameSeat(a, entry));
  const prev = st().awaySeats.find((a) => sameSeat(a, entry)) || null;
  const merged = {
    tournamentId: idString(entry.tournamentId) || (prev ? prev.tournamentId : null),
    tableId: idString(entry.tableId) || (prev ? prev.tableId : null),
    seatIndex: Number.isInteger(entry.seatIndex) ? entry.seatIndex : (prev ? prev.seatIndex : null),
    chips: Number.isFinite(entry.chips) ? entry.chips : (prev ? prev.chips : null),
    name: entry.name || (prev ? prev.name : null) || DEFAULT_NAME,
    leftAt: prev ? prev.leftAt : (entry.leftAt || Date.now()),
    via: (prev && prev.via) || entry.via || 'server',
  };
  merged.key = awaySeatKey(merged);
  // Re-keyed (its tournamentId learned): a Return in flight / a Dismiss line
  // for it follows the new key.
  if (prev && prev.key !== merged.key) {
    if (st().returning === prev.key) put({ returning: merged.key });
    if (st().noticeKey === prev.key) useTournamentSeatStore.setState({ noticeKey: merged.key });
  }
  // The seat just left / announced goes first (the banner's head).
  return [merged, ...list];
}

/** socket 'tournamentStarted' / 'qualifierTournamentStarted': this socket was seated. */
export function noteTournamentSeat({ tournamentId, tableId, name } = {}) {
  const tId = idString(tableId);
  if (!tId) return;
  const seat = { tournamentId: idString(tournamentId), tableId: tId, name: (typeof name === 'string' && name.trim()) || DEFAULT_NAME };
  const rest = st().awaySeats.filter((a) => !sameSeat(a, seat));
  const keep = rest.length === st().awaySeats.length;
  putAway(rest, keep
    ? { seat }
    : { seat, notice: null, noticeKind: null });
}

/** socket 'playerMoved' for the LIVE seat (a rebalance moved it). */
export function noteTournamentTableMove(toTable, fromTable) {
  const tId = idString(toTable);
  if (!tId) return;
  const { seat } = st();
  const from = idString(fromTable);
  if (seat && (!from || seat.tableId === from)) put({ seat: { ...seat, tableId: tId } });
}

/** The away seat of tournament `tournamentId`, or null. */
export function awaySeatOfTournament(tournamentId) {
  const t = idString(tournamentId);
  return t ? (st().awaySeats.find((a) => a.tournamentId === t) || null) : null;
}

/**
 * P-e — an elimination (`data`: eliminatedToSpectator {tournamentId, tableId,
 * tableIds}) that does NOT concern the table the player sits at on screen
 * (`gs`): his absent tournament seat busted while he plays another (cash)
 * table. Then it is a notice, never a switch of his table to the tournament's
 * spectator view. False whenever the shown table may be that tournament's
 * (same table, one of its tables, same tournamentId, his live seat of it, or
 * his own seat there is out / at 0) — a bust at his own table (or one that
 * broke with it) keeps today's spectator switch.
 */
export function isSeatedAtAnotherTable(gs, data) {
  if (!gs || !data || gs.tableId === null || gs.tableId === undefined) return false;
  if (!(Number(gs.yourSeat) >= 0)) return false;
  const shown = idString(gs.tableId);
  const tId = idString(data.tableId);
  const tour = idString(data.tournamentId);
  if (tId && shown === tId) return false;
  if (Array.isArray(data.tableIds) && data.tableIds.some((x) => idString(x) === shown)) return false;
  if (gs.isTournament === true && (!tour || !idString(gs.tournamentId) || idString(gs.tournamentId) === tour)) return false;
  if (tour && idString(gs.tournamentId) === tour) return false;
  const { seat } = st();
  if (seat && seat.tableId === shown && (!tour || !seat.tournamentId || seat.tournamentId === tour)) return false;
  const mine = Array.isArray(gs.seats) ? gs.seats[gs.yourSeat] : null;
  if (mine && (mine.eliminated || mine.chipCount === 0)) return false;
  return true;
}

/**
 * P-e' (round 3) — an elimination (eliminatedToSpectator) that does NOT
 * concern the table on screen: isSeatedAtAnotherTable, OR the screen shows a
 * table the server marks (P-d, gameState isTournament / tournamentId always
 * present) as NOT this tournament's — a cash table he WATCHES, or another
 * tournament's — and it is not one of this tournament's tables. Then it is a
 * notice, never a switch to the tournament's spectator view. (A fixed server
 * never makes such a socket a spectator — P-e' — this is the client's
 * defence against an older one.) Without the P-d fields (an older server)
 * only isSeatedAtAnotherTable decides.
 */
export function eliminationShownElsewhere(gs, data) {
  if (isSeatedAtAnotherTable(gs, data)) return true;
  if (!gs || !data || gs.tableId === null || gs.tableId === undefined) return false;
  const shown = idString(gs.tableId);
  const tId = idString(data.tableId);
  const tour = idString(data.tournamentId);
  if (tId && shown === tId) return false;
  if (Array.isArray(data.tableIds) && data.tableIds.some((x) => idString(x) === shown)) return false;
  if (gs.isTournament === false) return true; // P-d: a cash table
  if (gs.isTournament === true && tour && idString(gs.tournamentId) && idString(gs.tournamentId) !== tour) return true;
  return false;
}

/** Does this tab know an away seat at `tableId`? */
export function hasAwaySeatAt(tableId) {
  const tId = idString(tableId);
  return !!tId && st().awaySeats.some((a) => a.tableId === tId);
}

/**
 * A 'playerMoved' whose `fromTable` is a seat the player is AWAY from — a
 * DEFENSIVE path only. poker-server signals a rebalance that moved an ABSENT
 * seat with an updated 'tournamentSeatKept' (new table / seat) to the away
 * entrant's live sockets (V4), which noteTournamentSeatKept applies by
 * tournamentId; it sends 'playerMoved' only to a session AT the old seat.
 * This keeps an away entry right if a 'playerMoved' still names it.
 * Returns true when an away seat was updated.
 */
export function noteAwaySeatMoved({ fromTable, toTable, toSeat } = {}) {
  const from = idString(fromTable); const to = idString(toTable);
  if (!from || !to) return false;
  let hit = false;
  const list = st().awaySeats.map((a) => {
    if (a.tableId !== from) return a;
    hit = true;
    const moved = { ...a, tableId: to, seatIndex: Number.isInteger(toSeat) ? toSeat : a.seatIndex };
    return { ...moved, key: awaySeatKey(moved) };
  });
  if (hit) putAway(list);
  return hit;
}

/**
 * A gameState for THIS socket's seat that the server marked as a tournament
 * table (`isTournament: true` or a `tournamentId`, P-d). Older servers send
 * neither — then only the socket events above say so.
 */
export function noteGameStateForTournament(state) {
  if (!state || typeof state !== 'object') return;
  const flagged = state.isTournament === true || (state.tournamentId !== undefined && state.tournamentId !== null);
  if (!flagged) return;
  const tId = idString(state.tableId);
  if (!tId || !(Number(state.yourSeat) >= 0)) return;
  const mySeat = Array.isArray(state.seats) ? state.seats[state.yourSeat] : null;
  if (mySeat && mySeat.eliminated) return;
  const { seat } = st();
  const tournamentId = idString(state.tournamentId) || (seat ? seat.tournamentId : null);
  if (seat && seat.tableId === tId && seat.tournamentId === tournamentId) return;
  const away = st().awaySeats.find((a) => (tournamentId && a.tournamentId === tournamentId) || a.tableId === tId);
  put({ seat: { tournamentId, tableId: tId, name: (seat && seat.name) || (away && away.name) || (typeof state.tournamentName === 'string' && state.tournamentName) || DEFAULT_NAME } });
}

/**
 * Is the table on screen this socket's LIVE tournament seat? (`gameState` =
 * the table store's, `yourSeat` = its seat index.) A seat that is already
 * eliminated is not: leaving it is just leaving.
 */
export function isTournamentSeatView(gameState, yourSeat, seat = st().seat) {
  if (!gameState || !(Number(yourSeat) >= 0)) return false;
  const mine = Array.isArray(gameState.seats) ? gameState.seats[yourSeat] : null;
  if (mine && mine.eliminated) return false;
  if (gameState.isTournament === true || (gameState.tournamentId !== undefined && gameState.tournamentId !== null)) return true;
  return !!(seat && gameState.tableId && seat.tableId === idString(gameState.tableId));
}

/** The player is leaving the tournament table screen (the seat stays his, absent). */
export function leaveTournamentSeatToLobby(via, gameState) {
  const { seat } = st();
  const tId = idString(gameState && gameState.tableId) || (seat ? seat.tableId : null);
  if (!tId) return;
  const tournamentId = idString(gameState && gameState.tournamentId) || (seat ? seat.tournamentId : null);
  const yourSeat = gameState && Number.isInteger(gameState.yourSeat) ? gameState.yourSeat : null;
  const mine = gameState && Array.isArray(gameState.seats) && yourSeat !== null ? gameState.seats[yourSeat] : null;
  const list = upsertAway({
    tournamentId, tableId: tId, seatIndex: yourSeat, chips: mine && Number.isFinite(mine.chipCount) ? mine.chipCount : null,
    name: (seat && seat.name) || DEFAULT_NAME, leftAt: Date.now(), via: via || 'lobby',
  });
  putAway(list, { seat: null, returning: null, notice: null, noticeKind: null, seatRestored: null });
  try { console.warn('[tournament-seat] left the tournament table; the seat stays in play (absent) until the player returns', { via }); } catch { /* ignore */ }
}

/**
 * socket 'tournamentSeatKept' {tournamentId, tableId, seatIndex,
 * tournamentName, chips} (P-a / P-b): the server holds this account's seat in
 * play, absent, and this socket has no session at it. Whatever told us
 * before, this is the seat's current table / seat (it follows rebalances).
 * Also socket 'tournamentSeatTakenOver' {tournamentId, tableId, seatIndex}
 * (P-c'', `via` 'taken_over'): the seat now plays on another tab / device of
 * this account — for THIS tab it is an away seat it can take back (Return).
 */
export function noteTournamentSeatKept(data, via = 'server') {
  const tId = idString(data && data.tableId);
  if (!tId) return null;
  const tournamentId = idString(data && data.tournamentId);
  const name = data && typeof data.tournamentName === 'string' && data.tournamentName.trim() ? data.tournamentName.trim() : null;
  const { seat } = st();
  const wasLive = !!seat && ((tournamentId && seat.tournamentId === tournamentId) || seat.tableId === tId);
  const list = upsertAway({
    tournamentId, tableId: tId,
    seatIndex: Number.isInteger(data && data.seatIndex) ? data.seatIndex : null,
    chips: Number.isFinite(data && data.chips) ? data.chips : null,
    name: name || (wasLive ? seat.name : null), via,
  });
  // The seat is in play for this account after all: a line saying it could
  // not be found, or that the Return got no answer, is stale now.
  const stale = st().noticeKind === 'not_found' || st().noticeKind === 'no_answer';
  putAway(list, { seat: wasLive ? null : seat, ...(stale ? { notice: null, noticeKind: null } : {}) });
  try {
    if (via === 'taken_over') console.warn('[tournament-seat] the tournament seat now plays on another tab or device of this account', { tournamentId, tableId: tId });
    else console.warn('[tournament-seat] the server kept a tournament seat in play for this account (absent)', { tournamentId, tableId: tId });
  } catch { /* ignore */ }
  return list[0];
}

/**
 * socket 'reconnectedToTable' (or a successful returnToTournamentResult) —
 * the server put this socket back in a seat. It is the player's return when
 * it names an away seat (tournament or table), when it carries a
 * tournamentId, or — V4 — when a Return is in flight (whatever table: a
 * rebalance may have moved the seat while he was away). Returns
 * `{ returned, wasReturning }`.
 */
export function noteTournamentSeatReturned(data) {
  const tId = idString(data && data.tableId);
  const tournamentId = idString(data && data.tournamentId);
  const { awaySeats, seat, returning } = st();
  const wasReturning = !!returning;
  let idx = awaySeats.findIndex((a) => (tournamentId && a.tournamentId === tournamentId) || (tId && a.tableId === tId));
  if (idx < 0 && returning) idx = awaySeats.findIndex((a) => a.key === returning);
  const knownSeat = !!seat && !!tId && seat.tableId === tId;
  if (!tId || (idx < 0 && !knownSeat && !tournamentId && !wasReturning)) {
    if (returning) put({ returning: null });
    return { returned: false, wasReturning };
  }
  const base = idx >= 0 ? awaySeats[idx] : (seat || {});
  const rest = idx >= 0 ? awaySeats.filter((_, i) => i !== idx) : awaySeats;
  putAway(rest, {
    seat: { tournamentId: tournamentId || base.tournamentId || null, tableId: tId, name: base.name || DEFAULT_NAME },
    returning: null,
    notice: null,
    noticeKind: null,
  });
  return { returned: idx >= 0 || wasReturning, wasReturning };
}

/**
 * The tournament is over for this player: busted (the server's plain
 * 'playerEliminated' notice with a tournamentId — P-e' —, or an
 * 'eliminatedToSpectator' at his table; an absent seat can blind out) or
 * finished (`finished`: the room's 'tournamentFinished', or P-h' the
 * per-entrant 'tournamentFinishedForEntrant'; `position` = his place when
 * known). An away seat gets a closing line on the lobby banner. Returns true
 * when it concerned a seat this tab knew.
 */
export function noteTournamentOver({ tournamentId, tableId, position, finished } = {}) {
  const tId = idString(tournamentId);
  const tbl = idString(tableId);
  const matches = (x) => {
    if (!x) return false;
    if (tId) return x.tournamentId ? x.tournamentId === tId : (!tbl || x.tableId === tbl);
    return tbl ? x.tableId === tbl : true;
  };
  const { awaySeats, seat } = st();
  const ended = awaySeats.filter(matches);
  if (!ended.length && !matches(seat)) return false;
  let notice = st().notice;
  let noticeKind = st().noticeKind;
  if (ended.length) {
    const name = ended[0].name || DEFAULT_NAME;
    const pos = Number(position);
    if (finished) {
      notice = tournamentFinishedText(name, pos);
    } else {
      notice = Number.isFinite(pos) && pos > 0
        ? `${name}: you finished in position ${pos}.`
        : `${name}: your tournament has ended.`;
    }
    noticeKind = 'finished';
  }
  const returningEnded = ended.some((a) => a.key === st().returning);
  putAway(awaySeats.filter((a) => !matches(a)), {
    seat: matches(seat) ? null : seat,
    returning: returningEnded ? null : st().returning,
    notice,
    noticeKind,
    noticeKey: ended.length ? null : st().noticeKey,
  });
  return true;
}

/** A Return is in flight for the away seat `key` (null ends it). */
export function setTournamentReturning(key) {
  put({ returning: key ? String(key) : null });
}

/**
 * The server answered no_tournament_seat (P-c': the only ANSWER that forgets
 * an away seat): forget seat `key`, say why (`kind`: 'not_found' |
 * 'finished'). Without a key (the answer cannot be tied to one of several
 * away seats) none is forgotten; each can be tapped again.
 */
export function tournamentSeatNotFound(text, key = null, kind = 'not_found') {
  const list = key ? st().awaySeats.filter((a) => a.key !== key) : st().awaySeats;
  putAway(list, { returning: null, notice: text || null, noticeKind: text ? kind : null });
}

/** `key`: the away seat the line is about (a 'no_answer' line offers Dismiss on it). */
export function setTournamentNotice(text, kind = 'info', key = null) {
  put({ notice: text || null, noticeKind: text ? kind : null, noticeKey: text && key ? String(key) : null });
}

export function dismissTournamentNotice() {
  put({ notice: null, noticeKind: null });
}

/**
 * Round 6 — "Dismiss" on an away seat whose Return got NO answer at all (an
 * older server: its leave stood the seat up, so nothing will ever answer).
 * Forgets that seat on this tab only; a server that still holds it announces
 * it again on the next sign-in ('tournamentSeatKept', P-b).
 */
export function dismissAwaySeat(key) {
  const k = key ? String(key) : null;
  if (!k) return;
  const s = st();
  putAway(s.awaySeats.filter((a) => a.key !== k), {
    returning: s.returning === k ? null : s.returning,
    notice: null,
    noticeKind: null,
  });
  try { console.warn('[tournament-seat] away seat dismissed after a Return with no answer'); } catch { /* ignore */ }
}

/** The away seat whose key is `key` (or null). */
export function awaySeatByKey(key) {
  return key ? (st().awaySeats.find((a) => a.key === key) || null) : null;
}

/** A seat restored in the background while the player is in the avatar customizer. */
export function noteSeatRestoredInBackground(data) {
  const tId = idString(data && data.tableId);
  if (!tId) return;
  put({ seatRestored: { tableId: tId, seatIndex: Number.isInteger(data && data.seatIndex) ? data.seatIndex : null, tournamentId: idString(data && data.tournamentId) } });
  try { console.warn('[tournament-seat] seat restored in the background; the avatar customizer stays on screen', { tableId: tId }); } catch { /* ignore */ }
}

export function clearSeatRestored() {
  if (st().seatRestored) put({ seatRestored: null });
}

/** Sign-out / account change: nothing of the previous account is kept. */
export function resetTournamentSeat() {
  putAway([], { seat: null, returning: null, notice: null, noticeKind: null, seatRestored: null });
}
