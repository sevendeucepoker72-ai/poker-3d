/**
 * 2026-11-26 (owner orders 2026-11-25, FIX 1 + FIX 2, every tournament) -
 * what a tournament player is told about the sit-out limit and about a short
 * table that waits for players. Pure (no imports, no React, no store):
 * App.jsx, GameHUD, store/tournamentSeatStore and the rules / list modules
 * import it; tests/broadcast/tournamentSitOutLimit.test.mjs loads it in Node
 * (AGENT.md rule 22).
 *
 * FIX 2 (poker-server): a tournament player can't sit out more than 30 hands
 * in a row. One timeout still sits him out. After 3 hands in a row sitting out
 * he is warned; on the 30th he is REMOVED at that hand's end, placed exactly
 * like a bust (next finishing place, no bounty, prize / points / seat per that
 * place). On an Online League night an entrant who has NOT PLAYED A HAND YET
 * in this event is protected until late entry closes (protectedUntil), then,
 * if he still has not played a hand and is away, removed at the first hand
 * end after it whatever his count (owner order; noShow: true on that
 * removal). Owner rule 2026-11-25 ~11:15 PM MT ("A player who is seated
 * before 6 and then leaves before never played a hand so they should get the
 * 1st hour to play a hand") replaced "never arrived": away at the start, sat
 * in the early rooms and left, at another table, late-registered and left -
 * all protected until he plays a hand; a sign-in / seat restore alone is not
 * playing one; once he has, the protection is gone for good in this event.
 * The server decides who is protected (protectedUntil / noShow); the words
 * below never say "taken your seat" or "arrived" for it.
 * FIX 1 (poker-server): while 2 or more tables are in play, a table with fewer
 * than 4 players does not deal until balancing brings it to 4 or more.
 *
 * The server -> client contract (CONTRACTS.md C5; every field OPTIONAL and
 * additive - an older server sends none, and then every builder here returns
 * '' / null / today's text, so the client says exactly what it says today):
 *   socket 'tournamentSitOutWarning' {tournamentId, tableId, handsSatOut,
 *     handsLimit: 30, handsLeft, protectedUntil: number|null, message} - once
 *     per sit-out streak, when the count reaches 3, to every live socket
 *     signed in as that entrant (`message` is the server's own copy; the
 *     client says its own words below);
 *   gameState.mySitOutLimit {handsSatOut, handsLimit, handsLeft,
 *     protectedUntil} for the viewer's own live seat while handsSatOut >= 1,
 *     else null (always present on a tournament table once the server has
 *     FIX 2: its presence is how the client knows the limit is enforced);
 *   eliminatedToSpectator / playerEliminated (direct, atSignIn and the room's)
 *     reason 'sat_out_limit' + handsSatOut (never the cash 'sit_out_limit',
 *     whose text says the chips went back to the balance - false here), and
 *     noShow: true when it is an Online League entrant who had not played a
 *     hand, removed because he was still away when late entry closed (review
 *     fix 2026-11-26; owner rule 2026-11-25 ~11:15 PM MT);
 *   tournamentFinishedForEntrant atSignIn (the tournament finished while he
 *     was away) carries the same reason / handsSatOut / noShow when he was
 *     removed (review fix 2026-11-26: finishedForEntrantRemovalLine);
 *   'sitOutToggled' {sittingOut: true, reason: 'timeout', tableId,
 *     protectedUntil: number|null, noShowDue: boolean} - the timeout toast's
 *     first-hour / no-show wording (review fix 2026-11-26: timeoutSitOutText;
 *     no fields = gameState.mySitOutLimit.protectedUntil, else today's text);
 *   gameState.tableHold 'short_table' | null (FIX 1);
 *   the qualifier list item's sitOutLimitHands (30) / minTablePlayers (4):
 *     the rules show their lines only while these are sent (rule 20).
 * Plain ASCII.
 */

/** The socket event of the 3-hand warning. */
export const TOURNAMENT_SIT_OUT_WARNING_EVENT = 'tournamentSitOutWarning';

/** The elimination reason of a removal for sitting out (never the cash 'sit_out_limit'). */
export const SAT_OUT_LIMIT_REASON = 'sat_out_limit';

/** The limit the owner set (used only when a payload does not say). */
export const SIT_OUT_LIMIT_HANDS = 30;

/** The warning toast's title. */
export const SIT_OUT_WARNING_TITLE = 'Sitting out';

/** gameState.tableHold of a table held by FIX 1. */
export const SHORT_TABLE_HOLD = 'short_table';

/** The waiting line of a held short table (replaces "Waiting for players..."). */
export const SHORT_TABLE_WAITING_TEXT = 'Waiting for players to be moved to this table.';

/** The timeout toast as it reads today (98397e0; its first sentence is a lock token). */
export const TIMEOUT_SIT_OUT_TEXT = "Your time ran out, so you're sitting out. Tap I'm back to play again.";

/** ... and with the limit, once the server enforces it. */
export const TIMEOUT_SIT_OUT_LIMIT_TEXT = `${TIMEOUT_SIT_OUT_TEXT} You can't sit out more than ${SIT_OUT_LIMIT_HANDS} hands in a row.`;

/**
 * Review fix (2026-11-26) - the timeout toast of an Online League entrant who
 * has NOT PLAYED A HAND YET, inside his first hour (protectedUntil in the
 * future): the 30-hand limit does not bind him yet, removal when late entry
 * closes does. Whole literal (canonical-features greps it).
 */
export const TIMEOUT_SIT_OUT_PROTECTED_TEXT = "Your time ran out, so you're sitting out. Tap I'm back to play again. If you are still away when late entry closes, you will be removed.";

/**
 * ... and once his first hour is over with no hand played (the server's
 * noShowDue): he goes at this hand's end whatever his count. Whole literal.
 */
export const TIMEOUT_SIT_OUT_NO_SHOW_TEXT = "Your time ran out, so you're sitting out. Tap I'm back to play again. Come back this hand or you will be removed.";

function posInt(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegInt(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function handsWord(n) {
  return n === 1 ? '1 hand' : `${n} hands`;
}

function protectedAt(raw, now) {
  const t = raw && Number(raw.protectedUntil);
  return raw && raw.protectedUntil !== null && raw.protectedUntil !== undefined
    && Number.isFinite(t) && t > 0 && Number.isFinite(now) && t > now;
}

/** Hands left before the removal: the server's handsLeft, else limit - sat out, else null. */
function handsLeftOf(raw) {
  const left = nonNegInt(raw && raw.handsLeft);
  if (left !== null) return left;
  const sat = nonNegInt(raw && raw.handsSatOut);
  const limit = posInt(raw && raw.handsLimit);
  return sat !== null && limit !== null ? Math.max(0, limit - sat) : null;
}

/**
 * Does the server enforce the sit-out limit at this table? Yes when its
 * gameState carries the `mySitOutLimit` key at all (null included: a FIX 2
 * server always sends it on a tournament table; an older one never does).
 */
export function sitOutLimitEnforcedAt(gameState) {
  return !!gameState && typeof gameState === 'object'
    && Object.prototype.hasOwnProperty.call(gameState, 'mySitOutLimit');
}

/**
 * The timeout toast ('sitOutToggled' {sittingOut: true, reason: 'timeout'}):
 *   - `toggled.noShowDue === true` (an Online League entrant whose first hour
 *     is over and who has not played a hand: removed at this hand's end
 *     whatever his count) -> TIMEOUT_SIT_OUT_NO_SHOW_TEXT;
 *   - `toggled.protectedUntil` in the future (that entrant inside his first
 *     hour) -> TIMEOUT_SIT_OUT_PROTECTED_TEXT;
 *   - otherwise today's text, plus the 30-hand limit when the server enforces
 *     it (`limitEnforced`, or the payload carries the fields: only a FIX 2
 *     server sends them).
 * The server sets at most one of the two (its protected / no-show tests are
 * now <= until / now > until); noShowDue is checked first because it is the
 * server's own decision, not a clock compare. `sitOutLimit` (that table's
 * gameState.mySitOutLimit) is the fallback ONLY while the payload carries
 * neither field (a server from before the fields): its protectedUntil in the
 * future -> the protected text. `now`: the server-corrected clock.
 * Review fix 2026-11-26 (the toast promised a 30-hand limit to an entrant the
 * server removes when late entry closes).
 */
export function timeoutSitOutText(limitEnforced, toggled = null, sitOutLimit = null, now = Date.now()) {
  const t = toggled && typeof toggled === 'object' && !Array.isArray(toggled) ? toggled : null;
  const sent = !!t && (Object.prototype.hasOwnProperty.call(t, 'protectedUntil')
    || Object.prototype.hasOwnProperty.call(t, 'noShowDue'));
  if (sent) {
    if (t.noShowDue === true) return TIMEOUT_SIT_OUT_NO_SHOW_TEXT;
    if (protectedAt(t, now)) return TIMEOUT_SIT_OUT_PROTECTED_TEXT;
  } else {
    const limit = readSitOutLimit(sitOutLimit);
    if (limit && protectedAt(limit, now)) return TIMEOUT_SIT_OUT_PROTECTED_TEXT;
  }
  return limitEnforced || sent ? TIMEOUT_SIT_OUT_LIMIT_TEXT : TIMEOUT_SIT_OUT_TEXT;
}

/**
 * gameState.mySitOutLimit -> { handsSatOut, handsLimit, handsLeft,
 * protectedUntil } or null (absent, null, malformed or handsSatOut < 1).
 */
export function readSitOutLimit(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const handsSatOut = nonNegInt(raw.handsSatOut);
  if (handsSatOut === null || handsSatOut < 1) return null;
  const handsLimit = posInt(raw.handsLimit) || SIT_OUT_LIMIT_HANDS;
  const sent = nonNegInt(raw.handsLeft);
  const handsLeft = sent !== null ? sent : Math.max(0, handsLimit - handsSatOut);
  const p = Number(raw.protectedUntil);
  const protectedUntil = raw.protectedUntil !== null && raw.protectedUntil !== undefined && Number.isFinite(p) && p > 0 ? p : null;
  return { handsSatOut, handsLimit, handsLeft, protectedUntil };
}

/**
 * The sentence the sit-out note / the away banner adds at a tournament seat
 * (from gameState.mySitOutLimit): "Come back within 27 hands or you will be
 * removed." / "Come back this hand or you will be removed." / while an Online
 * League entrant who has not played a hand yet is protected: "If you are
 * still away when late entry closes, you will be removed." '' when the
 * server does not say (today's note).
 */
export function sitOutLimitSentence(raw, now = Date.now()) {
  const limit = readSitOutLimit(raw);
  if (!limit) return '';
  if (protectedAt(limit, now)) return 'If you are still away when late entry closes, you will be removed.';
  if (limit.handsLeft <= 1) return 'Come back this hand or you will be removed.';
  return `Come back within ${limit.handsLeft} hands or you will be removed.`;
}

/**
 * The 3-hand warning toast (socket 'tournamentSitOutWarning'): "You have sat
 * out 3 hands in a row. Come back within 27 hands or you will be removed from
 * the tournament." While protected (an Online League entrant who has not
 * played a hand yet, before late entry closes): "... If you are still away
 * when late entry closes, you will be removed from the tournament." '' for a
 * payload that is not an object.
 */
export function sitOutWarningText(data, now = Date.now()) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const sat = posInt(data.handsSatOut);
  const lead = sat ? `You have sat out ${handsWord(sat)} in a row.` : 'You are sitting out.';
  if (protectedAt(data, now)) return `${lead} If you are still away when late entry closes, you will be removed from the tournament.`;
  const left = handsLeftOf(data);
  if (left === null) {
    const limit = posInt(data.handsLimit) || SIT_OUT_LIMIT_HANDS;
    return `${lead} You can't sit out more than ${limit} hands in a row.`;
  }
  if (left <= 1) return `${lead} Come back this hand or you will be removed from the tournament.`;
  return `${lead} Come back within ${left} hands or you will be removed from the tournament.`;
}

/**
 * An elimination payload that is a removal for sitting out: the hands he sat
 * out in a row (the payload's handsSatOut, else 30), else null (a bust, or an
 * older server: today's text).
 */
export function satOutRemovedHands(data) {
  if (!data || typeof data !== 'object' || data.reason !== SAT_OUT_LIMIT_REASON) return null;
  return posInt(data.handsSatOut) || SIT_OUT_LIMIT_HANDS;
}

/**
 * Review fix (2026-11-26) - the removal of an Online League entrant who has
 * NOT PLAYED A HAND in this event (owner rule 2026-11-25 ~11:15 PM MT: away
 * at the start, or seated early / late-registered and left before playing
 * one) and is away at the first hand end after late entry closes: reason
 * 'sat_out_limit' + `noShow: true`. The owner's order removes
 * him then WHATEVER his count, so a hand count (30, or his real 22) would not
 * say why: the lines below say "because you were still away when late entry
 * closed" instead. Absent / not true = the 30-hand wording.
 */
export function satOutRemovedNoShow(data) {
  return !!data && typeof data === 'object' && data.reason === SAT_OUT_LIMIT_REASON && data.noShow === true;
}

/** Why a no-show was removed (the bust banner's reason line). */
export const NO_SHOW_REMOVED_TEXT = 'Removed because you were still away when late entry closed.';

/**
 * The bust banner's reason line: "Removed for sitting out 30 hands in a
 * row." / a no-show's NO_SHOW_REMOVED_TEXT, else null (a bust).
 */
export function bustBannerRemovalLine(elim) {
  const hands = satOutRemovedHands(elim);
  if (!hands) return null;
  return satOutRemovedNoShow(elim) ? NO_SHOW_REMOVED_TEXT : `Removed for sitting out ${handsWord(hands)} in a row.`;
}

/**
 * His own removal, direct / sign-in notice and the lobby banner line:
 * "<name|Your tournament>: you were removed for sitting out 30 hands in a row
 * and finished in position 7." (the caller adds the prize). `fallbackName`:
 * the word used when there is no name (the toast's 'Your tournament'; the
 * lobby passes its own seat name). `noShow` (satOutRemovedNoShow): "...: you
 * were removed because you were still away when late entry closed, and
 * finished in position 7." Whole literals (canonical-features greps them).
 */
export function satOutRemovedOwnLine(name, position, hands, fallbackName = 'Your tournament', noShow = false) {
  const n = (typeof name === 'string' && name.trim()) || fallbackName;
  const pos = posInt(position);
  if (noShow === true) {
    return pos
      ? `${n}: you were removed because you were still away when late entry closed, and finished in position ${pos}.`
      : `${n}: you were removed because you were still away when late entry closed.`;
  }
  const h = posInt(hands) || SIT_OUT_LIMIT_HANDS;
  return pos
    ? `${n}: you were removed for sitting out ${handsWord(h)} in a row and finished in position ${pos}.`
    : `${n}: you were removed for sitting out ${handsWord(h)} in a row.`;
}

/**
 * Review fix (2026-11-26) - socket 'tournamentFinishedForEntrant' for a player
 * REMOVED for sitting out while away, told at his next sign-in after the
 * tournament finished ({tournamentId, position, prize?, tournamentName,
 * atSignIn: true, reason 'sat_out_limit', handsSatOut, noShow?}): his own
 * removal line, the words the 'playerEliminated' notice uses (the caller adds
 * the prize). null for a plain finish (no reason, the cash 'sit_out_limit', an
 * older server): the caller keeps tournamentFinishedText, today's words.
 */
export function finishedForEntrantRemovalLine(data, name) {
  const hands = satOutRemovedHands(data);
  if (!hands) return null;
  return satOutRemovedOwnLine(name, data.position, hands, undefined, satOutRemovedNoShow(data));
}

/** Seated at another table when his tournament seat was removed (App's eliminatedToSpectator toast). `noShow` as above. */
export function satOutRemovedElsewhereText(position, hands, noShow = false) {
  const pos = posInt(position);
  if (noShow === true) {
    return pos
      ? `Your tournament has ended: you were removed because you were still away when late entry closed, and finished in position ${pos}.`
      : 'Your tournament has ended: you were removed because you were still away when late entry closed.';
  }
  const h = posInt(hands) || SIT_OUT_LIMIT_HANDS;
  return pos
    ? `Your tournament has ended: you were removed for sitting out ${handsWord(h)} in a row and finished in position ${pos}.`
    : `Your tournament has ended: you were removed for sitting out ${handsWord(h)} in a row.`;
}

/**
 * The table room's copy of a removal: "<name> removed for sitting out (7th)",
 * his own: "You were removed for sitting out (7th)".
 */
export function satOutRemovedRoomText(name, position, own = false) {
  const pos = posInt(position);
  const at = pos ? ` (${ordinal(pos)})` : '';
  if (own) return `You were removed for sitting out${at}`;
  const n = (typeof name === 'string' && name.trim()) || 'A player';
  return `${n} removed for sitting out${at}`;
}

/**
 * The lobby Return banner's line for an AWAY seat that got the warning. The
 * banner stays up while hands go by and no count follows an away seat, so it
 * says the rule, never a count that goes stale.
 */
export function awaySeatSitOutWarningLine(data, now = Date.now()) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  if (protectedAt(data, now)) return 'If you are still away when late entry closes, you will be removed from the tournament.';
  const limit = posInt(data.handsLimit) || SIT_OUT_LIMIT_HANDS;
  return `If you are away for ${limit} hands in a row, you will be removed from the tournament.`;
}

/**
 * FIX 1 - the table is held until balancing brings it to 4 or more players
 * (gameState.tableHold 'short_table'; never on a table the server marks as
 * cash, so a merged key from a tournament table cannot hold a cash table).
 */
export function shortTableHeldOf(gameState) {
  return !!gameState && typeof gameState === 'object'
    && gameState.isTournament !== false && gameState.tableHold === SHORT_TABLE_HOLD;
}
