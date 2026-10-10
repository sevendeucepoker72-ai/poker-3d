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

export function deepLinkFailureText(result) {
  const code = result && typeof result.code === 'string' ? result.code : '';
  const serverText = [result && result.error, result && result.message]
    .find((v) => typeof v === 'string' && v.trim());
  if (code === 'ticket_replayed') return DEEP_LINK_LINK_USED_TEXT;
  if (code === 'ticket_invalid' || code === 'ticket_missing' || code === 'ticket_missing_user') return DEEP_LINK_LINK_INVALID_TEXT;
  if (code === 'ticket_verify_failed' || code === 'ticket_verify_unreachable') return DEEP_LINK_CHECK_FAILED_TEXT;
  if (serverText) return serverText.trim().slice(0, 300);
  return DEEP_LINK_GENERIC_FAILED_TEXT;
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
