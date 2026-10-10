/**
 * tournamentReturn — "Return to tournament" (2026-10-10, S2 round 2: the
 * fixed protocol P-c, CONTRACTS C5; round 3: P-c' / P-h; round 6: P-c'').
 *
 * The lobby's Return emits socket 'returnToTournamentSeat' {tournamentId}
 * WITH an ack. poker-server answers on the ack AND on
 * 'returnToTournamentResult' (App.jsx feeds that event here too):
 *   success  {success:true, tournamentId, tableId, seatIndex} — after it has
 *            sent 'reconnectedToTable' {tableId, seatIndex, tournamentId} and
 *            a full gameState (App.jsx switches to the table on those);
 *   failure  {success:false, code, error}, code one of
 *            player_suspended | login_required   (the C5 play gate: the shared
 *                                                 PlayRefusalNotice / silent
 *                                                 re-auth + one replay, exactly
 *                                                 like every gated play emit;
 *                                                 P-k: a banned account too)
 *            not_signed_in | session_changed     (seat kept; tap again)
 *            already_seated                      (the socket plays at ANOTHER
 *                                                 table — the server's answer
 *                                                 is authoritative; the client
 *                                                 never pre-refuses from its
 *                                                 own table-store state)
 *            no_tournament_seat                  (the only ANSWER that forgets
 *                                                 the seat — P-c'. With
 *                                                 `tournamentFinished:true`
 *                                                 (+ `position`) the line says
 *                                                 it finished and where he
 *                                                 placed; with `eliminated:
 *                                                 true` (+ `position`) that he
 *                                                 is out; else a neutral line).
 *
 * P-c'' (round 6) — the LATEST connection wins. A Return always takes the
 * seat when it is still his, also from another tab / device / stale
 * connection of the same account (that socket is told
 * 'tournamentSeatTakenOver' — App.jsx — and gets the seat back as an away
 * seat with a Return). A repeated Return is an idempotent success. So a
 * Return with no answer simply RETRIES, once:
 *   - no answer within RETURN_ACK_WAIT_MS on the same connection: the socket
 *     is signed in again first (reauthSocket, reason 'return_to_tournament' —
 *     the older-server fallback: an older server's sign-in may restore the
 *     seat itself, 'reconnectedToTable');
 *   - the connection changed meanwhile (the first emit's ack died with the
 *     old transport): the new connection's own sign-in is awaited;
 * then the Return is emitted ONCE more. When that is not answered either (an
 * older server has no such event; its leave stood the seat up) the banner and
 * its Return button STAY with a neutral "Could not reach the game — tap
 * Return to tournament again." line plus a Dismiss button (the only way the
 * player forgets the seat himself) — never "could not find" / "ended"
 * without the server saying so.
 */
import { getSocket } from './socketService';
import { reauthSocket, awaitCurrentReauth } from './socketReauth';
import { reportPlayRefusal, playRefusalCode } from './playRefusal';
import { runPlayFlow } from './playAttempt';
import { clearTableLeft } from './leftTables';
import { useGameStore } from '../store/gameStore';
import {
  useTournamentSeatStore, setTournamentReturning, tournamentSeatNotFound,
  setTournamentNotice, noteTournamentSeatReturned, tournamentFinishedText, awaySeatByKey,
} from '../store/tournamentSeatStore';

export const RETURN_TO_TOURNAMENT_EVENT = 'returnToTournamentSeat';
export const RETURN_TO_TOURNAMENT_RESULT_EVENT = 'returnToTournamentResult';
// P-c'' — to the socket whose seat another connection of the account took.
export const TOURNAMENT_SEAT_TAKEN_OVER_EVENT = 'tournamentSeatTakenOver';
// P-c: no answer within this → sign in again / await the new connection's
// sign-in, then the one retry (P-c'').
export const RETURN_ACK_WAIT_MS = 5000;
// A re-auth still in flight is waited for (bounded) first, so a Return
// tapped (or retried) right after a reconnect is not answered login_required.
const RETURN_REAUTH_WAIT_MS = 6000;

// Shown ONLY on an explicit no_tournament_seat answer (P-c'), when the
// server says nothing more (P-h tournamentFinished / eliminated). Neutral.
export const TOURNAMENT_SEAT_NOT_FOUND_TEXT = 'We could not find your tournament seat. There is no seat waiting for you to return to.';
// P-c'' — the toast on 'tournamentSeatTakenOver' (the seat plays elsewhere now).
export const TOURNAMENT_SEAT_TAKEN_OVER_TEXT = 'Your tournament seat is open on another tab or device.';
// P-c': the Return (and its one retry) got no answer at all (the seat is NOT forgotten).
export const TOURNAMENT_RETURN_NO_ANSWER_TEXT = 'Could not reach the game — tap Return to tournament again.';
export const TOURNAMENT_RETURN_OFFLINE_TEXT = 'We could not reach the game server. Your seat is still yours: tap Return to tournament again in a moment.';
export const TOURNAMENT_RETURN_AT_TABLE_TEXT = 'Leave the table you are playing at first, then tap Return to tournament.';
export const TOURNAMENT_RETURN_SESSION_CHANGED_TEXT = 'Your sign-in changed. Your seat is still yours: tap Return to tournament again.';
export const TOURNAMENT_RETURN_NOT_SIGNED_IN_TEXT = 'You are not signed in to the game server just now. Your seat is still yours: tap Return to tournament again in a moment.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function idString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// The Return in flight: { id, key, tournamentId, connId, emits, settled, result, wake }.
let _attempt = null;
let _attemptSeq = 0;
// The same answer arrives twice (ack + event): handle it once.
let _lastAnswerSig = null;
let _lastAnswerAt = 0;
// The away seat of the most recent Return (kept after it ends: an answer can
// arrive after the Return gave up — P-c').
let _lastAttemptKey = null;

function answerSignature(r) {
  try { return JSON.stringify(r); } catch { return String(r && r.code); }
}

/** Which away seat an answer is about (null = cannot tell: none is forgotten). */
function keyForAnswer(result, attempt) {
  const s = useTournamentSeatStore.getState();
  // The store's `returning` follows a re-key (tournamentId learned).
  if (s.returning) return s.returning;
  if (attempt && s.awaySeats.some((a) => a.key === attempt.key)) return attempt.key;
  const t = idString(result && result.tournamentId);
  if (t) { const e = s.awaySeats.find((a) => a.tournamentId === t); if (e) return e.key; }
  if (_lastAttemptKey && s.awaySeats.some((a) => a.key === _lastAttemptKey)) return _lastAttemptKey;
  if (s.awaySeats.length === 1) return s.awaySeats[0].key;
  return null;
}

/**
 * Apply a server answer to 'returnToTournamentSeat' (the ack, or the
 * 'returnToTournamentResult' event — whichever comes first; the second copy
 * is a no-op). Also handles an answer to a REPLAY sent by the play-refusal
 * recovery, a duplicate (idempotent) success, or one that arrives after the
 * Return gave up (no Return in flight then).
 */
export function handleReturnToTournamentResult(result, via = 'event') {
  if (!result || typeof result !== 'object') return;
  const sig = answerSignature(result);
  const now = Date.now();
  const attempt = _attempt && !_attempt.settled ? _attempt : null;
  // The second copy of an answer already applied (no Return waiting for it).
  if (!attempt && sig === _lastAnswerSig && now - _lastAnswerAt < 5000) return;
  _lastAnswerSig = sig;
  _lastAnswerAt = now;
  if (attempt) { attempt.settled = true; attempt.result = result; }
  const key = keyForAnswer(result, attempt);
  try { console.warn('[tournament-seat] return answered', { via, success: !!result.success, code: result.code || null }); } catch { /* ignore */ }

  if (result.success) {
    // 'reconnectedToTable' normally came first and did all of this already.
    if (result.tableId != null) clearTableLeft(result.tableId);
    noteTournamentSeatReturned({ tableId: result.tableId, seatIndex: result.seatIndex, tournamentId: result.tournamentId });
    try {
      const gs = useGameStore.getState();
      if (gs.isLoggedIn && gs.screen !== 'table') gs.setScreen('table');
    } catch { /* ignore */ }
  } else {
    const code = typeof result.code === 'string' ? result.code : '';
    if (code === 'no_tournament_seat') {
      const entry = awaySeatByKey(key);
      const name = entry ? entry.name : null;
      const pos = Number(result.position);
      if (result.tournamentFinished === true) {
        // P-h: the tournament is over — say so, and where he placed.
        tournamentSeatNotFound(tournamentFinishedText(name, result.position), key, 'finished');
      } else if (result.eliminated === true) {
        // He is out of a running tournament (his absent seat busted).
        tournamentSeatNotFound(Number.isInteger(pos) && pos > 0
          ? `${name || 'Your tournament'}: you finished in position ${pos}.`
          : `${name || 'Your tournament'}: your tournament has ended.`, key, 'finished');
      } else {
        tournamentSeatNotFound(TOURNAMENT_SEAT_NOT_FOUND_TEXT, key, 'not_found');
      }
    } else if (code === 'already_seated') {
      setTournamentReturning(null);
      setTournamentNotice(TOURNAMENT_RETURN_AT_TABLE_TEXT);
    } else if (code === 'session_changed') {
      setTournamentReturning(null);
      setTournamentNotice(TOURNAMENT_RETURN_SESSION_CHANGED_TEXT);
    } else if (playRefusalCode(result)) {
      // player_suspended / login_required: the shared C5 handling (App.jsx
      // mounts PlayRefusalNotice on the lobby, table, career and avatar
      // customizer screens — every screen with a Return button).
      setTournamentReturning(null);
      reportPlayRefusal(result);
    } else {
      // not_signed_in, or a code this client does not know: the seat is kept.
      setTournamentReturning(null);
      setTournamentNotice(TOURNAMENT_RETURN_NOT_SIGNED_IN_TEXT);
    }
  }
  if (attempt && attempt.wake) attempt.wake();
}

/** The away seat a Return is for: by key, else the banner's head. */
function awayEntry(key) {
  const { awaySeats } = useTournamentSeatStore.getState();
  if (!awaySeats.length) return null;
  return (key && awaySeats.find((a) => a.key === key)) || awaySeats[0];
}

/**
 * Wait (at most `ms`) until the attempt is answered ('answered'), the seat
 * came back without an answer — an older server's sign-in restore clears
 * `returning` ('cleared') —, or the socket is a NEW connection since the
 * last emit ('reconnected': that emit's ack died with the old transport);
 * else 'timeout'.
 */
function waitAttempt(attempt, ms) {
  return new Promise((resolve) => {
    let done = false;
    let unsub = () => {};
    let timer = null;
    let poll = null;
    const finish = (why) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      unsub();
      if (attempt.wake === check) attempt.wake = null;
      resolve(why);
    };
    const check = () => {
      if (attempt.settled) return finish('answered');
      if (!useTournamentSeatStore.getState().returning) return finish('cleared');
      const sock = getSocket();
      if (sock && sock.connected && attempt.connId && sock.id !== attempt.connId) return finish('reconnected');
      return undefined;
    };
    attempt.wake = check;
    timer = setTimeout(() => finish('timeout'), ms);
    poll = setInterval(check, 250);
    unsub = useTournamentSeatStore.subscribe(() => check());
    check();
  });
}

function emitReturn(attempt, payload, replayKey) {
  const sock = getSocket();
  if (!sock || !sock.connected) return false;
  attempt.emits += 1;
  attempt.connId = sock.id;
  // A login_required answer on a signed-in tab (reconnect race) is recovered
  // silently and this whole Return replayed once (services/playRefusal).
  runPlayFlow(() => { returnToTournament(replayKey).catch(() => {}); }, () => {
    sock.emit(RETURN_TO_TOURNAMENT_EVENT, payload, (r) => handleReturnToTournamentResult(r, 'ack'));
  });
  return true;
}

/**
 * Return to the away tournament seat `key` (default: the banner's head).
 * Resolves `{ ok, via, code? }`, never rejects.
 */
export async function returnToTournament(key = null) {
  const entry = awayEntry(key);
  if (!entry) return { ok: false, via: 'none' };
  if (useTournamentSeatStore.getState().returning) return { ok: false, via: 'busy' };
  const socket = getSocket();
  if (!socket || !socket.connected) {
    setTournamentNotice(TOURNAMENT_RETURN_OFFLINE_TEXT);
    return { ok: false, via: 'offline' };
  }
  setTournamentNotice(null);
  setTournamentReturning(entry.key);
  // (The table's late-frame mark — services/leftTables — is NOT cleared
  // here: the server's 'reconnectedToTable' ends it right before the full
  // gameState, for whatever table the seat is at now; a refusal leaves it.)
  try { console.warn('[tournament-seat] returning to the tournament seat (returnToTournamentSeat)', { tournamentId: entry.tournamentId || null }); } catch { /* ignore */ }

  await Promise.race([awaitCurrentReauth().catch(() => null), sleep(RETURN_REAUTH_WAIT_MS)]);
  if (!getSocket() || !getSocket().connected) {
    setTournamentReturning(null);
    setTournamentNotice(TOURNAMENT_RETURN_OFFLINE_TEXT);
    return { ok: false, via: 'offline' };
  }

  const attempt = {
    id: ++_attemptSeq, key: entry.key, tournamentId: idString(entry.tournamentId), connId: null, emits: 0,
    settled: false, result: null, wake: null,
  };
  _attempt = attempt;
  _lastAttemptKey = attempt.key;
  const payload = attempt.tournamentId ? { tournamentId: attempt.tournamentId } : {};
  const replayKey = entry.key;
  const end = (out) => { if (_attempt === attempt) _attempt = null; return out; };
  const answered = () => end(attempt.result && attempt.result.success
    ? { ok: true, via: 'returnToTournamentSeat' }
    : { ok: false, via: 'returnToTournamentSeat', code: (attempt.result && attempt.result.code) || null });
  const offline = (via) => {
    setTournamentReturning(null);
    setTournamentNotice(TOURNAMENT_RETURN_OFFLINE_TEXT);
    return end({ ok: false, via });
  };

  emitReturn(attempt, payload, replayKey);
  let why = await waitAttempt(attempt, RETURN_ACK_WAIT_MS);
  if (why === 'answered') return answered();
  if (why === 'cleared') return end({ ok: true, via: 'restored' });

  if (why === 'reconnected') {
    // The first emit's ack died with the old transport: the new connection
    // signs itself in (App.jsx connect handler) — wait for it, then retry.
    await Promise.race([awaitCurrentReauth().catch(() => null), sleep(RETURN_REAUTH_WAIT_MS)]);
  } else {
    // No answer on the same connection (the packet was lost, or an older
    // server without the event): sign the socket in again first — an older
    // server's sign-in may restore the seat itself ('reconnectedToTable').
    try { console.warn('[tournament-seat] returning to the tournament seat (sign-in restore): no answer to returnToTournamentSeat, older server fallback'); } catch { /* ignore */ }
    let r = null;
    try { r = await reauthSocket(getSocket(), { reason: 'return_to_tournament' }); } catch { r = null; }
    if (!attempt.settled && useTournamentSeatStore.getState().returning
      && (!r || !r.ok) && !(r && r.reason === 'superseded')) return offline('sign_in_restore');
  }
  if (attempt.settled) return answered();
  if (!useTournamentSeatStore.getState().returning) return end({ ok: true, via: 'sign_in_restore' });

  // P-c'' — the one retry: the latest connection wins, so this Return takes
  // the seat whichever connection of his held it (or is an idempotent
  // success when the first one was processed and only its answer was lost).
  try { console.warn('[tournament-seat] no answer to the Return; returnToTournamentSeat sent once more (latest connection wins)'); } catch { /* ignore */ }
  if (!emitReturn(attempt, payload, replayKey)) return offline('offline');
  why = await waitAttempt(attempt, RETURN_ACK_WAIT_MS);
  if (why === 'answered') return answered();
  if (why === 'cleared') return end({ ok: true, via: 'restored' });

  // Neither emit answered (an older server, or no network): the seat and its
  // Return stay, with the neutral line and a Dismiss button on that seat.
  try { console.warn('[tournament-seat] no answer to the Return; the seat stays offered (P-c\')', { via: why }); } catch { /* ignore */ }
  const k = useTournamentSeatStore.getState().returning || attempt.key;
  setTournamentReturning(null);
  setTournamentNotice(TOURNAMENT_RETURN_NO_ANSWER_TEXT, 'no_answer', k);
  return end({ ok: false, via: 'returnToTournamentSeat', code: 'no_answer' });
}
