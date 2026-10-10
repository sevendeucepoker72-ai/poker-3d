/**
 * deepLinkBootGate — the boot's STORED-credential sign-in waits for a
 * "Play Online" / waitlist deep-link ticket (2026-10-10, P4).
 *
 * WHY. A deep link from the player app carries a one-shot ticket for account
 * A. The boot used to start, on the SAME socket and at the same moment, the
 * sign-in with whatever this browser had stored — on a shared browser the
 * refresh token (or legacy token) of account B. Whichever loginResult landed
 * last decided the tab, and the server bound the socket to whichever login it
 * finished last: A could end up as B, a waitlist link could seat and charge
 * B, and A's seat could be cashed out into B's wallet.
 *
 * The ticket is the authoritative credential of a deep-linked boot, exactly
 * as the bridge hand-off is for a bridged one (App.jsx sequences that one the
 * same way). So, per deep-linked page load:
 *   - while the ticket is unanswered, the stored sign-in WAITS (deferred);
 *   - the ticket signed the tab in → the stored sign-in never runs;
 *   - the ticket was REFUSED (a play refusal: suspended / no account) → it
 *     does not run on its own either: the refusal screen stays up and its
 *     Continue button reloads into the normal boot. Running it would replace
 *     the refused player's notice with the stored account's lobby;
 *   - any other answer → the deferred stored sign-in runs NOW, exactly as the
 *     boot would have run it without a deep link. Every server answer is
 *     final: poker-server burns the ticket on receipt (markTicketUsed) before
 *     anything else, so ticket_invalid / ticket_replayed / verify or master
 *     unreachable / maintenance / handler_exception can never turn into a
 *     success, and a Retry of a settled request is answered ticket_replayed.
 * A TIMEOUT is not an answer: the original request may still succeed (the
 * deep-link flow keeps listening for it), so the stored sign-in keeps
 * waiting; the timed-out screen offers Retry and "sign in normally" (a reload
 * without the deep link).
 * No deep link → every request runs at once (the boot is unchanged).
 *
 * THE PROACTIVE TOKEN REFRESH WAITS TOO (2026-10-10, Q5). authScheduler
 * starts at module load (main.jsx), before React mounts, and it used to
 * refresh the browser's stored sign-in (on a shared browser, ANOTHER
 * account's) while the ticket was still unanswered. When that other
 * account's refresh token was dead, its invalid_grant landed after the
 * ticket had signed the tab in as A and the session-expired teardown signed A
 * out. So, per page load, `deepLinkTicketPending()` is true from the moment
 * main.jsx sees a `?token=` in the URL (noteDeepLinkTicketInUrl, before
 * authScheduler.start()) until this load's gate settles (signed in / refused /
 * failed — a timeout is not an answer); authScheduler holds its refresh
 * while it is true and the tab has no session yet, and resumes on
 * onDeepLinkTicketSettled.
 */

export const DEEP_LINK_NONE = 'none';
export const DEEP_LINK_PENDING = 'pending';
export const DEEP_LINK_SIGNED_IN = 'signed_in';
export const DEEP_LINK_REFUSED = 'refused';
export const DEEP_LINK_FAILED = 'failed';

function warn(msg) {
  try { console.warn(msg); } catch { /* ignore */ }
}

// ── This page load's deep-link ticket, for authScheduler (Q5) ───────────────
let _ticketPending = false;
const _settledListeners = new Set();

function setTicketPending(next) {
  const was = _ticketPending;
  _ticketPending = !!next;
  if (was && !_ticketPending) {
    for (const fn of [..._settledListeners]) {
      try { fn(); } catch { /* a listener never blocks the others */ }
    }
  }
}

/**
 * main.jsx, BEFORE authScheduler.start(): a Play Online / waitlist ticket in
 * the URL (App's parseDeepLinkContext reads — and scrubs — the same `?token=`
 * at mount, then the gate it creates takes over this flag).
 */
export function noteDeepLinkTicketInUrl() {
  try {
    const token = new URLSearchParams(window.location.search || '').get('token');
    if (token) setTicketPending(true);
  } catch { /* no deep link */ }
  return _ticketPending;
}

/** True while this page load's deep-link ticket is unanswered. */
export function deepLinkTicketPending() {
  return _ticketPending;
}

// ── This page load's #bridge_id_token hand-off, for authScheduler (S3) ───────
// Same idea as the ticket flag: main.jsx notes a bridge token in the URL
// BEFORE authScheduler.start(); App.jsx's bridge consumer settles it once the
// exchange has answered (and the tokens are placed — tab-scoped or not), or
// failed. While it is pending (and the tab has no session) the scheduler
// holds: the browser's stored sign-in can be another account's, and the
// bridge decides whether this tab is tab-scoped.
let _bridgePending = false;

/** main.jsx, before authScheduler.start(): a #bridge_id_token in the URL. */
export function noteBridgeHandoffInUrl() {
  try {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    if (hash && new URLSearchParams(hash).has('bridge_id_token')) _bridgePending = true;
  } catch { /* no bridge */ }
  return _bridgePending;
}

/** True while this page load's bridge hand-off is unanswered. */
export function bridgeHandoffPending() {
  return _bridgePending;
}

/** App.jsx — the bridge exchange answered (ok or not) or timed out. */
export function settleBridgeHandoff() {
  if (!_bridgePending) return;
  _bridgePending = false;
  for (const fn of [..._settledListeners]) {
    try { fn(); } catch { /* a listener never blocks the others */ }
  }
}

/** Called once the deep-link ticket settles (any final answer). Returns an unsubscribe. */
export function onDeepLinkTicketSettled(fn) {
  if (typeof fn !== 'function') return () => {};
  _settledListeners.add(fn);
  return () => { _settledListeners.delete(fn); };
}

/**
 * One gate per page load. `hasDeepLink` — a ticket / waitlist deep link was
 * parsed from the URL at mount.
 */
export function createDeepLinkBootGate(hasDeepLink) {
  let outcome = hasDeepLink ? DEEP_LINK_PENDING : DEEP_LINK_NONE;
  let deferred = null;
  // This load's gate owns the module flag (Q5): pending exactly while it is.
  setTicketPending(outcome === DEEP_LINK_PENDING);

  const settle = (next) => {
    if (outcome !== DEEP_LINK_PENDING) return false;
    outcome = next;
    setTicketPending(false);
    return true;
  };

  return {
    outcome: () => outcome,

    /**
     * May the stored-credential boot sign-in start now? Returns
     *   'run'      — start it now;
     *   'deferred' — the ticket is still unanswered: `run` is kept and called
     *                (once) if the ticket fails;
     *   'skip'     — the ticket signed the tab in, or was refused.
     */
    requestStoredSignIn(run) {
      if (outcome === DEEP_LINK_NONE || outcome === DEEP_LINK_FAILED) return 'run';
      if (outcome === DEEP_LINK_PENDING) {
        const next = typeof run === 'function' ? run : null;
        // The boot asks twice on a plain load (the bridge consumer's
        // "no bridge" answer and the direct call): one line per request.
        if (next !== deferred) warn('[deep-link] stored sign-in deferred until the Play Online ticket is answered');
        deferred = next;
        return 'deferred';
      }
      warn(`[deep-link] stored sign-in not started: the Play Online ticket ${outcome === DEEP_LINK_SIGNED_IN ? 'signed this tab in' : 'was refused'}`);
      return 'skip';
    },

    /** Forget a deferred request (the boot effect that made it was torn down). */
    withdraw(run) {
      if (deferred && deferred === run) deferred = null;
    },

    /** The ticket signed this tab in: the stored sign-in never runs. */
    ticketSignedIn() {
      if (settle(DEEP_LINK_SIGNED_IN)) deferred = null;
    },

    /** The ticket was refused (play refusal): the refusal screen decides. */
    ticketRefused() {
      if (settle(DEEP_LINK_REFUSED)) deferred = null;
    },

    /** True once the ticket was answered (signed in / refused / failed). */
    settled: () => outcome !== DEEP_LINK_PENDING && outcome !== DEEP_LINK_NONE,

    /** Any other answer: the ticket can never succeed — run the stored sign-in. */
    ticketFailed() {
      if (!settle(DEEP_LINK_FAILED)) return;
      const run = deferred;
      deferred = null;
      if (!run) return;
      warn('[deep-link] Play Online ticket failed — running the stored sign-in');
      try { run(); } catch (e) { try { console.error('[deep-link] stored sign-in threw:', e); } catch { /* ignore */ } }
    },
  };
}

/**
 * 2026-10-10 — what to tell the player when the server ANSWERED the deep-link
 * ticket with a failure that is not a play refusal (those keep their own
 * screen). An answer is final (the ticket is burned on receipt), so this is
 * never "Connection timed out" (that screen is for NO answer) and never a
 * Retry. The server's own sentence is shown where it is written for players
 * (account_mismatch, handler_exception, maintenance, ...); the ticket_* codes
 * carry developer text ("Invalid token: expired"), so they get a sentence
 * here. Shown on the login screen (gameStore.sessionExpiredNotice), from
 * which the browser's stored sign-in — run after a failure — takes the tab
 * on, exactly as on a load without a deep link.
 */
export const DEEP_LINK_LINK_USED_TEXT = 'This Play Online link was already used. Open Play Online again from the American Pub Poker app to get a new one.';
export const DEEP_LINK_LINK_INVALID_TEXT = 'This Play Online link has expired or is not valid. Open Play Online again from the American Pub Poker app to get a new one.';
export const DEEP_LINK_CHECK_FAILED_TEXT = 'We could not check your Play Online link just now. Open Play Online again from the American Pub Poker app, or sign in below.';
export const DEEP_LINK_GENERIC_FAILED_TEXT = 'We could not sign you in with this Play Online link. Open Play Online again from the American Pub Poker app, or sign in below.';
// 2026-10-10 — player-friendly sentences for the remaining ANSWERED failures.
// Every Play Online link is single-use (burned on receipt), so a sentence may
// never say "try again" / "retry" about the same link: it tells the player to
// tap Play Online again in the app (a NEW link).
export const DEEP_LINK_ACCOUNT_LOAD_FAILED_TEXT = 'We could not load your American Pub Poker account just now. Open Play Online again from the American Pub Poker app, or sign in below.';
export const DEEP_LINK_MAINTENANCE_TEXT = 'The game server is being updated. Open Play Online again from the American Pub Poker app in a few minutes.';
export const DEEP_LINK_IDENTITY_TEXT = 'This account could not be matched securely. Please contact support.';
export const DEEP_LINK_SEAT_FAILED_TEXT = 'We could not seat you from this waitlist link. Open Play Online again from the American Pub Poker app to get a new one.';
export const DEEP_LINK_BUY_IN_CANCELLED_TEXT = 'Your table changed before your buy-in went through, so it was cancelled and any chips taken were returned. Open Play Online again from the American Pub Poker app to get a new link.';
export const DEEP_LINK_NOT_ENOUGH_CHIPS_TEXT = 'You do not have enough chips for this table\'s buy-in.';
// The waitlist buy-in cancellation: poker-server's `cancelCode` label
// (round 2), else its text — the pre-M4 "…before your buy-in went through, so
// it was cancelled — any chips taken were returned. Please try again." and
// the M4 "…before your seat was confirmed, so it was cancelled — any chips
// taken were returned. Tap Play Online…" both match.
export const BUY_IN_CANCELLED_CODE = 'buy_in_cancelled';
export const BUY_IN_CANCELLED_TEXT_RE = /buy-in.*cancel|cancel.*buy-in|so it was cancelled\b.*\bchips taken were returned/i;

// Server sentences that are developer text or that ask to retry a link the
// server has already burned — never shown to a player as-is.
const UNFRIENDLY_SERVER_TEXT = /try again|retry|request a new link|master api|shape|token|server error|handler|could not load user|authentication could not|auth service|not found|no tables|no seats|could not join|could not deduct/i;

export function deepLinkFailureText(result) {
  const code = result && typeof result.code === 'string' ? result.code : '';
  const serverText = [result && result.error, result && result.message]
    .find((v) => typeof v === 'string' && v.trim());
  const text = serverText ? serverText.trim() : '';
  if (code === 'ticket_replayed') return DEEP_LINK_LINK_USED_TEXT;
  if (code === 'ticket_invalid' || code === 'ticket_missing' || code === 'ticket_missing_user') return DEEP_LINK_LINK_INVALID_TEXT;
  if (code === 'ticket_verify_failed' || code === 'ticket_verify_unreachable') return DEEP_LINK_CHECK_FAILED_TEXT;
  if (code === 'master_user_unreachable' || code === 'master_user_shape' || code === 'user_upsert_failed'
    || code === 'user_row_missing' || code === 'no_phone_or_username_claim' || code === 'rate_limited'
    || code === 'client_auth_failed' || code === 'token_invalid' || code === 'no_token') {
    return DEEP_LINK_ACCOUNT_LOAD_FAILED_TEXT;
  }
  if (code === 'maintenance') return DEEP_LINK_MAINTENANCE_TEXT;
  if (code === 'identity_conflict') return DEEP_LINK_IDENTITY_TEXT;
  // The waitlist's seat / buy-in stages all answer handler_exception. A
  // server since round 2 labels the cancelled buy-in with
  // `cancelCode: 'buy_in_cancelled'` (on the loginResult and the 'error'
  // frame) — that comes first; an older server is told apart by its text,
  // whose wording changed (M4): BOTH sentences match BUY_IN_CANCELLED_TEXT_RE.
  const cancelCode = result && typeof result.cancelCode === 'string'
    ? result.cancelCode
    : (result && result.detail && typeof result.detail.cancelCode === 'string' ? result.detail.cancelCode : '');
  if (cancelCode === BUY_IN_CANCELLED_CODE) return DEEP_LINK_BUY_IN_CANCELLED_TEXT;
  if (BUY_IN_CANCELLED_TEXT_RE.test(text)) return DEEP_LINK_BUY_IN_CANCELLED_TEXT;
  if (/insufficient chips/i.test(text)) return DEEP_LINK_NOT_ENOUGH_CHIPS_TEXT;
  if (code === 'handler_exception') {
    return /table|seat/i.test(text) ? DEEP_LINK_SEAT_FAILED_TEXT : DEEP_LINK_GENERIC_FAILED_TEXT;
  }
  // A sentence written for players (account_mismatch, a future code) is shown
  // as the server wrote it — unless it is developer text or asks to retry.
  if (text && !UNFRIENDLY_SERVER_TEXT.test(text)) return text.slice(0, 300);
  return DEEP_LINK_GENERIC_FAILED_TEXT;
}

// ── Q4 lock (2026-10-10) ────────────────────────────────────────────────────
// App.jsx renders the deep-link screen ("Signing you in…" / timed out /
// refusal) ONLY while this returns DEEP_LINK_SCREEN_PENDING: once the link is
// consumed (ticket success, answered failure, or the tab signed in any other
// way) the screen is retired for this page load and a signed-out tab shows
// LoginScreen. The two literals exist in the bundle only through this
// function, so canonical-features.txt can lock the guard (reverting App.jsx to
// `if (deepLinkContext)` drops them and the deploy aborts).
export const DEEP_LINK_SCREEN_PENDING = 'deep-link-screen-pending';
export const DEEP_LINK_SCREEN_RETIRED = 'deep-link-screen-retired';
export function deepLinkScreenState(hasDeepLink, consumed) {
  if (!hasDeepLink) return null;
  return consumed ? DEEP_LINK_SCREEN_RETIRED : DEEP_LINK_SCREEN_PENDING;
}

/**
 * P4 — a STORED-credential boot sign-in (refresh token / legacy token)
 * answered while this tab is already signed in as a DIFFERENT user (local
 * poker-server user id). Such a success is never adopted: one tab is one
 * account. `state` is the game store's state.
 */
export function storedSignInWouldSwitchUser(state, userData) {
  if (!state || !state.isLoggedIn) return false;
  if (state.userId === null || state.userId === undefined) return false;
  const next = userData && userData.id !== null && userData.id !== undefined ? String(userData.id) : '';
  return String(state.userId) !== next;
}
