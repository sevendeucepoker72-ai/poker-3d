/**
 * playAttempt — the last play attempt, so a `login_required` refusal on a tab
 * that is still signed in can be replayed ONCE after the socket is silently
 * re-authenticated (2026-10-07 review fix; see services/playRefusal.js).
 *
 * Deliberately dependency-free: tableStore imports it, and tableStore is
 * bundled with the lobby feature chunk, so anything this module imported
 * would be dragged into that chunk too.
 *
 * Every gated play emit records how to REPLAY it — the emit itself
 * (notePlayAttempt: tableStore, ClubsPanel, GameHUD) or, for screens with
 * their own spinner and success watcher (Lobby join, tournament / qualifier
 * register, private-table join, career start), the whole flow (runPlayFlow),
 * so the replay restarts the spinner and its confirmation wait as well. A
 * flow-level record is not overwritten by the emit-level record of the store
 * call made inside it.
 */

// A refusal for an attempt older than this is not replayed.
export const REPLAY_WINDOW_MS = 15_000;

let _lastAttempt = null; // { replay, at }
let _flowDepth = 0;
// Bumped on every recorded attempt, so a replay scheduled for later can tell
// that the player has since tried again by hand (and must not double it).
let _attemptSeq = 0;

/**
 * Record how to replay the play emit about to be sent. No-op inside
 * runPlayFlow (the enclosing flow already recorded the whole flow).
 */
export function notePlayAttempt(replay) {
  if (_flowDepth > 0 || typeof replay !== 'function') return;
  _attemptSeq += 1;
  _lastAttempt = { replay, at: Date.now() };
}

/**
 * Run a play flow (`run`) and record `replay` as the way to retry it.
 * `replay` usually calls the same entry point again; it must check that its
 * component is still mounted before touching UI state.
 */
export function runPlayFlow(replay, run) {
  if (typeof replay === 'function') {
    _attemptSeq += 1;
    _lastAttempt = { replay, at: Date.now() };
  }
  _flowDepth += 1;
  try {
    return run();
  } finally {
    _flowDepth -= 1;
  }
}

/**
 * Take (and forget) the most recent attempt — `{ replay, at }` — or null when
 * there is none or it is older than REPLAY_WINDOW_MS. Taking it is what makes
 * the retry happen at most ONCE. `at` is when the original attempt was sent
 * (the caller spaces the replay from it; see playRefusal.js).
 */
export function takeRecentPlayAttempt() {
  const attempt = _lastAttempt;
  _lastAttempt = null;
  if (!attempt || Date.now() - attempt.at > REPLAY_WINDOW_MS) return null;
  return attempt;
}

/** Monotonic count of recorded play attempts (see _attemptSeq). */
export function playAttemptSeq() {
  return _attemptSeq;
}
