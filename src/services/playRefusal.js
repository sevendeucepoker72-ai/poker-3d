/**
 * playRefusal — the .online client's half of two owner decisions (2026-10-07):
 *
 *   1. A suspended ("86'd") player is refused EVERY game, and is told exactly
 *      "You are suspended from playing any games with American Pub Poker."
 *   2. Guest play is OFF for everyone: nobody plays .online without an
 *      American Pub Poker account.
 *
 * poker-server does the refusing (contract C5). This module is the ONE place
 * the client recognises a refusal. The server's text is shown VERBATIM; the
 * sentences below are fallbacks for a frame that carries a code but no text.
 *
 * Where refusals arrive. Each path answers on the event its client already
 * listens to, and every frame carries `code`:
 *   'error'                       {message, code}  joinTable, quickPlay, the quick
 *                                                  modes, career, joinAdditionalTable,
 *                                                  registerTournament, rebuy, clubs
 *   'joinError'                   {message, code}  joinByInviteCode
 *   'qualifierRegistrationResult' {success:false, error, code}
 *   'loginResult'                 {success:false, error, code}  deep links, logins
 *
 * Codes:
 *   player_suspended  the player (or an account on their phone) is suspended
 *   login_required    no American Pub Poker account behind this session
 *                     (guest, unauthenticated, or not linked)
 *   guest_disabled    a guest-account register attempt
 *
 * A suspension is never ANNOUNCED. Nothing here runs unless the server has just
 * refused something the player tried to do.
 *
 * SIGNED-IN BUT SOCKET NOT (2026-10-07 review fix, verified MAJOR). After a
 * reconnect the server-side socket is new and signed out until oauthLogin
 * completes (services/socketReauth.js). A play attempt that still lands on a
 * signed-out socket is refused `login_required` even though this tab holds a
 * signed-in account. Showing "Sign in" there would send the player through a
 * pointless OIDC redirect. So for `login_required` while a signed-in account
 * session is stored, reportPlayRefusal first recovers silently — refresh the
 * token if needed, re-run oauthLogin — and replays the attempt ONCE (the
 * replay recorded by notePlayAttempt / runPlayFlow at the emit site). Only if
 * that fails, or the replay is refused again, is the Sign In notice shown.
 */
import { usePlayRefusalStore } from '../store/playRefusalStore';
import { startLogin } from './authService';
import { recoverSignedInSocket, hasSignedInAccountSession } from './socketReauth';
import { notePlayAttempt, runPlayFlow, takeRecentPlayAttempt, playAttemptSeq } from './playAttempt';

export const PLAYER_SUSPENDED = 'player_suspended';
export const LOGIN_REQUIRED = 'login_required';
export const GUEST_DISABLED = 'guest_disabled';

export const SUSPENDED_TEXT = 'You are suspended from playing any games with American Pub Poker.';
export const SIGN_IN_TO_PLAY_TEXT = 'Sign in with your American Pub Poker account to play.';

// 2026-10-09 (contract R3) — players without an account (former guests) are
// offered account creation next to Sign In on every login_required /
// guest_disabled refusal. Account creation lives on the marketing site.
export const ACCOUNT_SIGNUP_URL = 'https://americanpubpoker.com/signup';

// Shown when a registration emit (tournament / qualifier) gets no answer at
// all. The text is the old guest-play watchdog's (retired with guest play on
// 2026-10-07); canonical-features.txt still locks it, now for these watchdogs.
export const GAME_SERVER_UNREACHABLE_TEXT = "Couldn't reach the game server — please try again.";

const REFUSAL_CODES = new Set([PLAYER_SUSPENDED, LOGIN_REQUIRED, GUEST_DISABLED]);

/** The C5 refusal code on a server frame, or null when the frame is not one. */
export function playRefusalCode(frame) {
  const code = frame && typeof frame === 'object' ? frame.code : null;
  return typeof code === 'string' && REFUSAL_CODES.has(code) ? code : null;
}

export function isPlayRefusal(frame) {
  return playRefusalCode(frame) !== null;
}

/** login_required / guest_disabled are answered by signing in with an account. */
export function refusalNeedsSignIn(code) {
  return code === LOGIN_REQUIRED || code === GUEST_DISABLED;
}

/**
 * The text to show for a refusal frame: the server's own words (`message` on
 * 'error'/'joinError', `error` on the result events), else the fallback for its
 * code. Returns null when the frame is not a refusal, so callers can write
 * `playRefusalText(r) || <their existing text>`.
 */
export function playRefusalText(frame) {
  const code = playRefusalCode(frame);
  if (!code) return null;
  const serverText = [frame.message, frame.error].find((v) => typeof v === 'string' && v.trim());
  if (serverText) return serverText.trim().slice(0, 300);
  return code === PLAYER_SUSPENDED ? SUSPENDED_TEXT : SIGN_IN_TO_PLAY_TEXT;
}

// ── Recovery state ─────────────────────────────────────────────────────────
// The replay itself lives in services/playAttempt.js (dependency-free, so
// tableStore can record attempts without pulling this module in); re-exported
// here for screens that already import from playRefusal.
export { notePlayAttempt, runPlayFlow };

// After a recovery, a second login_required within this window means the
// replay was refused too: show the notice, never loop. Measured from when the
// replay is SENT (it can be held back by REPLAY_MIN_GAP_MS below), so the
// replay's own answer always lands inside it.
const RECOVERY_COOLDOWN_MS = 20_000;

// poker-server rate-limits game CREATION per socket — quickPlayRateLimited(),
// 3s, checked BEFORE the play gate on quickHeadsUp / quickSpinGo /
// quickAllInOrFold / startCareerGame — so the refused attempt already armed
// it. A replay sent sooner than 3s after the original would be answered
// "Please wait a moment before starting another game." instead of playing.
const REPLAY_MIN_GAP_MS = 3_200;

let _recovering = false;
let _lastRecoveryAt = 0;
// Every listener for one socket frame receives the SAME object (App's global
// 'error' handler plus the screen's own). Handle each frame once.
const _handledFrames = new WeakSet();

function showRefusal(code, message) {
  try {
    usePlayRefusalStore.getState().show({ code, message, at: Date.now() });
  } catch { /* the caller still knows it was a refusal */ }
}

function runReplay(replay) {
  _lastRecoveryAt = Date.now();
  try {
    replay();
    try { console.warn('[play-refusal] socket re-authenticated — attempt replayed'); } catch { /* ignore */ }
  } catch (e) {
    try { console.warn('[play-refusal] replay failed', e?.message || e); } catch { /* ignore */ }
  }
}

/**
 * Replay the most recent attempt once, spaced REPLAY_MIN_GAP_MS from it. If
 * the player tries again by hand while the replay waits out that gap (their
 * socket is signed in again, so that tap goes through), the replay is dropped
 * — sending both would double the join / registration.
 */
function replayLastAttempt() {
  const attempt = takeRecentPlayAttempt();
  if (!attempt) return false;
  const seqAtSchedule = playAttemptSeq();
  const wait = Math.max(0, attempt.at + REPLAY_MIN_GAP_MS - Date.now());
  setTimeout(() => {
    if (playAttemptSeq() !== seqAtSchedule) {
      try { console.warn('[play-refusal] replay dropped — the player already tried again'); } catch { /* ignore */ }
      return;
    }
    runReplay(attempt.replay);
  }, wait);
  return true;
}

// Hard bound on one silent recovery (token refresh ≤ ~15s worst case is
// already inside it; a socket that never reconnects must not leave every later
// refusal swallowed).
const RECOVERY_TIMEOUT_MS = 20_000;

function recoverThenReplay(code, message) {
  _recovering = true;
  // warn, not info: this path only runs when a signed-in tab's socket was
  // found signed out — worth seeing in a support console capture.
  try { console.warn('[play-refusal] login_required on a signed-in tab — re-authenticating the socket'); } catch { /* ignore */ }
  let timer = null;
  const bound = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'recovery_timeout' }), RECOVERY_TIMEOUT_MS);
  });
  Promise.race([recoverSignedInSocket().catch(() => ({ ok: false, reason: 'exception' })), bound])
    .then((r) => {
      if (timer) clearTimeout(timer);
      _recovering = false;
      _lastRecoveryAt = Date.now();
      if (r?.ok) {
        // Nothing recent to replay (the attempt is older than the replay
        // window): the socket is signed in again, so the player's next tap
        // simply works — no notice.
        if (!replayLastAttempt()) {
          try { console.warn('[play-refusal] socket re-authenticated — nothing recent to replay'); } catch { /* ignore */ }
        }
        return;
      }
      try { console.warn('[play-refusal] recovery failed', r?.reason); } catch { /* ignore */ }
      showRefusal(code, message);
    });
}

/**
 * If `frame` is a play refusal, handle it and return true. Callers then only
 * need to stop their own spinner, and must not render a second copy of the
 * message. Returns false for any other frame, and the caller handles it as it
 * always has.
 *
 * Handling = hand it to the shared <PlayRefusalNotice/> — except a
 * login_required while this tab holds a signed-in account session: that is
 * recovered silently first and the attempt replayed once (see above).
 */
export function reportPlayRefusal(frame) {
  const code = playRefusalCode(frame);
  if (!code) return false;
  if (_handledFrames.has(frame)) return true;
  _handledFrames.add(frame);
  try { console.warn('[play-refusal]', code); } catch { /* ignore */ }
  const message = playRefusalText(frame);

  if (code === LOGIN_REQUIRED) {
    // A recovery is already running: this is the same tap (or a double tap)
    // landing on the same signed-out socket. It is replayed — or the notice
    // shown — when that recovery finishes.
    if (_recovering) return true;
    const recentlyRecovered = Date.now() - _lastRecoveryAt < RECOVERY_COOLDOWN_MS;
    if (!recentlyRecovered && hasSignedInAccountSession()) {
      recoverThenReplay(code, message);
      return true;
    }
  }
  showRefusal(code, message);
  return true;
}

/**
 * The normal sign-in action (the same OIDC redirect as LoginScreen's
 * "Sign In with American Pub Poker"). Returns a promise that rejects with a
 * readable error when the browser can't start it (no WebCrypto, storage
 * blocked). On success the page navigates away.
 */
export function startAccountSignIn() {
  return Promise.resolve().then(() => startLogin());
}
