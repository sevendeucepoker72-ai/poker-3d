/**
 * socketAuth — ONE correct implementation of "authenticate this socket and
 * wait for the server's answer".
 *
 * WHY THIS EXISTS (2026-08-17 .online sign-in outage)
 * ---------------------------------------------------
 * FIVE independent flows in this app authenticate the SAME socket:
 *   1. the cross-site bridge handoff  (App.jsx, #bridge_id_token from
 *      americanpub.poker's "Play Online")
 *   2. the boot refresh-token path    (App.jsx)
 *   3. the legacy stale-token path    (App.jsx tryLegacyAutoLogin → tokenLogin)
 *   4. the OIDC callback              (AuthCallback.jsx)
 *   5. the deep-link ticket path      (App.jsx → authWithTicket /
 *      joinWithWaitlistContext, from the player app's "Play Online" tile and
 *      the at-venue waitlist link)
 *
 * All five are routed through this module as of 2026-08-17, and BOTH server
 * handlers behind #5 were converted to match. #5 was the last hold-out and it
 * mattered more than "one more caller": because the back-compat rule below
 * ACCEPTS un-echoed frames, any single unconverted emitter stays a permanent
 * two-way hole rather than a transitional one — its bare frames get consumed
 * by other flows, and other flows' bare frames get consumed by it.
 *
 * ⚠️ READ THIS BEFORE ROUTING A SIXTH FLOW THROUGH HERE.
 * An earlier revision of this comment claimed all five were routed and done.
 * That was wrong in a way that only bites on the SERVER side: #5 covers TWO
 * server handlers, `authWithTicket` AND `joinWithWaitlistContext`, and the
 * latter did not emit `loginResult` on ANY branch — not on failure (it used
 * `error`), not on success (it used `gameState`). It only ever appeared to
 * work because the unscoped listener this module replaced would accept ANOTHER
 * flow's frame. Scoping the listeners therefore guaranteed a watchdog timeout
 * on every waitlist deep-link, which then wrote a FABRICATED `login_failed`
 * row into the same dashboard this work exists to make trustworthy.
 *
 * So the rule is: routing a flow through runSocketLogin is a CONTRACT that the
 * server handler answers on `loginResult` with an echoed requestId on every
 * terminal branch. Verify that in poker-server before adding a caller — a
 * handler that emits nothing is invisible to an audit of the emitters.
 *
 * Every one of them did `socket.on('loginResult', handler)`. Socket.IO
 * delivers an event to EVERY registered listener, so any flow's rejection was
 * ALSO delivered to every other flow in flight. On a returning player's phone,
 * flows 1 and 3 start within milliseconds of each other on the same socket:
 * the stale `poker_auth_token` left in localStorage is rejected instantly
 * (`loginResult{success:false}`), the bridge's listener picks that up as its
 * OWN answer, reports `bridge_socket_auth_failed`, and — pre-fix — deleted the
 * freshly minted, perfectly valid bridge tokens. The bridge's real success
 * frame then arrived with no listener left to receive it, so the app sat on a
 * blank 26s spinner and dumped the user on a login screen.
 *
 * Live proof of the concurrency, from the auth-server request log:
 *   2026-08-17T01:10:43.593Z  POST /token/introspection → 200, body {"active":false}
 *   2026-08-17T01:10:43.598Z  POST /token/introspection → 200, body active:true
 * — two auth emits, 5ms apart, on one socket: the dead stale token and the
 * fresh bridge token. The client logged bridge_socket_auth_failed 219ms later.
 *
 * THE FIX: every emit carries a `requestId`; poker-server echoes it back on the
 * matching `loginResult`. A flow accepts a result only when it is its own.
 *
 * Back-compat is deliberate and two-way:
 *   - Results with NO requestId are accepted (an older poker-server that
 *     doesn't echo yet ⇒ exactly today's behaviour, no worse).
 *   - Results whose requestId belongs to someone else are IGNORED — that is
 *     the whole fix, and it only engages once the server ships the echo.
 */

let _seq = 0;

/** Short, collision-free per-tab correlation id. */
export function newRequestId(prefix = 'auth') {
  _seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${_seq}-${rand}`;
}

/**
 * Emit an auth event on the socket and resolve with the FIRST `loginResult`
 * that belongs to this flow.
 *
 * @param {object}   opts
 * @param {object}   opts.socket      socket.io client
 * @param {string}   opts.event       'oauthLogin' | 'tokenLogin' | 'authWithTicket'
 *                                    | 'joinWithWaitlistContext'
 * @param {object}   opts.payload     event payload (requestId is added here)
 * @param {number}   [opts.timeoutMs] wall-clock watchdog (default 25000)
 * @param {string}   [opts.label]     used to prefix the requestId (debugging).
 *   Keep it short: poker-server truncates the echoed requestId to 64 chars.
 * @param {Function} [opts.onResult]  called with the server's result frame
 * @param {Function} [opts.onTimeout] called when the watchdog fires, with
 *   { requestId, phase: 'connect' | 'result', keptListening?, lostSinceEmit? }
 * @param {Function} [opts.isCancelled] return true to make every callback a no-op
 * @param {boolean}  [opts.reemitOnReconnect] re-send on every socket 'connect'
 *   (default true). Set FALSE for ONE-SHOT credentials: the deep-link ticket
 *   paths (`authWithTicket` / `joinWithWaitlistContext`) are guarded server-side
 *   by `markTicketUsed`, so a re-emit after a reconnect is answered
 *   `ticket_replayed` — turning a recoverable blip into a hard failure. Access
 *   tokens and legacy JWTs are replayable, so they keep the re-emit (it is the
 *   fix for "server answered on a socket that had already died").
 * @param {boolean}  [opts.armWatchdogOnEmit] start the `timeoutMs` watchdog
 *   when the request is actually EMITTED, not when this function is called
 *   (default: true for one-shot flows, false otherwise). See WATCHDOG TIMING.
 * @param {boolean}  [opts.keepListeningAfterTimeout] when the watchdog fires,
 *   report it via onTimeout but KEEP listening for this requestId's answer and
 *   deliver a late answer via onResult (default: true for one-shot flows).
 * @param {number}   [opts.connectStallMs] arm-on-emit flows only: if the
 *   request has still not been emitted after this long (socket never
 *   connected), call onTimeout({phase:'connect'}) WITHOUT cancelling the
 *   pending emit. 0 (default) = off.
 * @returns {Function} cancel() — removes all listeners/timers. Idempotent.
 *   The function also carries:
 *     cancel.requestId
 *     cancel.status()  -> { requestId, emitted, emitCount, settled, timedOut, lostSinceEmit }
 *     cancel.retry()   -> 'waiting' | 'restart'  (see RETRY below)
 *
 * WATCHDOG TIMING (2026-10-06 review fix). The watchdog used to start at CALL
 * time for every flow. For a socket that was still connecting (Railway cold
 * start, flaky mobile uplink) that spent the whole budget before anything was
 * sent, and the timeout's cleanup removed the pending 'connect' emit — so the
 * request was never sent at all. HEAD's ticket and legacy paths armed their
 * timers inside the emit; arm-on-emit restores that.
 *
 * ONE-SHOT TIMEOUTS (same review). A one-shot ticket that has been emitted may
 * still be answered after the watchdog fires (the server is mid-verification
 * when the UI gives up). The server has already burned the ticket, so a fresh
 * emit is answered `ticket_replayed` — the ORIGINAL requestId's answer is the
 * only one that can succeed. So for one-shot flows the timeout is a UI notice,
 * not a teardown: the listener stays, and a late answer for this requestId is
 * delivered. After a timeout only frames that echo THIS requestId are accepted
 * (un-echoed frames are someone else's — e.g. the password `login` handler).
 *
 * RETRY. cancel.retry() returns 'waiting' when the in-flight request may still
 * succeed — not yet emitted (it kicks socket.connect() and re-arms the stall
 * notice) or emitted with no disconnect since (it re-arms the watchdog and
 * keeps waiting; it NEVER re-emits). It returns 'restart' when this flow can no
 * longer succeed — it already settled, or a one-shot request's connection
 * dropped after the emit (the server answers on the socket that received the
 * emit, so that answer is lost). Only then should the caller start a new flow.
 */
export function runSocketLogin({
  socket,
  event,
  payload,
  timeoutMs = 25000,
  label = 'auth',
  onResult,
  onTimeout,
  isCancelled,
  reemitOnReconnect = true,
  armWatchdogOnEmit = !reemitOnReconnect,
  keepListeningAfterTimeout = !reemitOnReconnect,
  connectStallMs = 0,
}) {
  if (!socket) {
    // Nothing to listen on. Report it like a failure so callers never hang.
    try { onResult?.({ success: false, code: 'no_socket', error: 'Server connection not ready' }); } catch {}
    const noop = () => {};
    noop.requestId = null;
    noop.status = () => ({ requestId: null, emitted: false, emitCount: 0, settled: true, timedOut: false, lostSinceEmit: false });
    noop.retry = () => 'restart';
    return noop;
  }

  const requestId = newRequestId(label);
  // settled: answered, terminally timed out, or cancelled. Nothing fires after.
  let settled = false;
  // timedOut: a NON-terminal timeout notice has fired (keep-listening mode).
  let timedOut = false;
  let emitCount = 0;
  // A one-shot request whose connection dropped after the emit can no longer
  // be answered — the server emits loginResult on the socket that received it.
  let lostSinceEmit = false;
  let watchdog = null;
  let stallTimer = null;

  const clearTimers = () => {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  };

  const cleanup = () => {
    socket.off('loginResult', handleResult);
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    clearTimers();
  };

  const finish = (fn, arg) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (isCancelled?.()) return;
    try { fn?.(arg); } catch (err) { console.error('[socketAuth] handler threw:', err); }
  };

  // Non-terminal notice: report, keep every listener in place.
  const notify = (arg) => {
    if (settled || isCancelled?.()) return;
    timedOut = true;
    try { onTimeout?.(arg); } catch (err) { console.error('[socketAuth] handler threw:', err); }
  };

  function handleResult(result) {
    if (settled) return;
    // Nothing of ours is on the wire yet, so no frame can be our answer.
    if (emitCount === 0) return;
    // Not ours — another auth flow on this same socket owns it. Ignore it
    // completely: do not resolve, do not report, do not touch stored tokens.
    if (result && result.requestId && result.requestId !== requestId) return;
    // After a timeout notice we are a long-lived listener; accept only an
    // exact echo so we cannot adopt another flow's un-attributed frame.
    if (timedOut && (!result || result.requestId !== requestId)) return;
    finish(onResult, result);
  }

  function onWatchdog() {
    watchdog = null;
    if (settled) return;
    const phase = emitCount > 0 ? 'result' : 'connect';
    if (keepListeningAfterTimeout) {
      notify({ requestId, phase, keptListening: true, lostSinceEmit });
      return;
    }
    finish(onTimeout, { requestId, phase });
  }

  function armWatchdog() {
    if (!(timeoutMs > 0)) return;
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(onWatchdog, timeoutMs);
  }

  function armStall() {
    if (!armWatchdogOnEmit || !(connectStallMs > 0) || emitCount > 0) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (settled || emitCount > 0) return;
      notify({ requestId, phase: 'connect', keptListening: true, lostSinceEmit: false });
    }, connectStallMs);
  }

  function emitNow() {
    emitCount += 1;
    lostSinceEmit = false;
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    // Arm on the FIRST emit only. Re-emits (replayable credentials) share the
    // budget so a flapping socket cannot extend it forever.
    if (armWatchdogOnEmit && emitCount === 1) armWatchdog();
    socket.emit(event, { ...payload, requestId });
  }

  function onConnect() {
    if (settled || isCancelled?.()) return;
    // One-shot credentials must be sent EXACTLY once.
    if (!reemitOnReconnect && emitCount > 0) return;
    emitNow();
    if (!reemitOnReconnect) socket.off('connect', onConnect);
  }

  function onDisconnect() {
    if (settled) return;
    if (emitCount > 0) lostSinceEmit = true;
  }

  socket.on('loginResult', handleResult);
  socket.on('disconnect', onDisconnect);
  if (socket.connected && !isCancelled?.()) {
    emitNow();
    // Persistent (not `.once`) so a socket that drops mid-login
    // re-authenticates on the new connection — the server's next loginResult
    // lands on a live socket. Removed by cleanup() when this flow resolves.
    // One-shot credentials never register it once sent.
    if (reemitOnReconnect) socket.on('connect', onConnect);
  } else {
    socket.on('connect', onConnect);
    armStall();
  }
  if (!armWatchdogOnEmit) armWatchdog();

  const cancel = () => { if (!settled) { settled = true; cleanup(); } };
  cancel.requestId = requestId;
  cancel.status = () => ({ requestId, emitted: emitCount > 0, emitCount, settled, timedOut, lostSinceEmit });
  cancel.retry = () => {
    if (settled || isCancelled?.()) return 'restart';
    if (emitCount > 0 && lostSinceEmit && !reemitOnReconnect) return 'restart';
    // The in-flight request may still succeed: keep waiting for it. Never
    // re-emit here — for a one-shot ticket that is exactly the burn.
    // (`timedOut` stays set: the exact-echo rule above is sticky.)
    try { if (!socket.connected) socket.connect(); } catch { /* ignore */ }
    if (emitCount === 0) armStall();   // still connecting: re-arm the stall notice
    else armWatchdog();                // on the wire: fresh budget for the SAME request
    return 'waiting';
  };
  return cancel;
}

/**
 * The server's `loginResult.code` vocabulary, as actually emitted.
 *
 * Source of truth: poker-server `src/auth/loginIdentity.ts` → `LoginFailureCode`.
 * Kept here as a comment rather than a duplicated array because a stale copy is
 * worse than none — the predicates below name only the handful of codes they
 * genuinely depend on, and every unknown code is treated as RECOVERABLE.
 *
 *   no_token · token_invalid · client_auth_failed · no_phone_or_username_claim
 *   maintenance · user_upsert_failed · user_row_missing · identity_conflict
 *   handler_exception · rate_limited · legacy_token_invalid
 *   ticket_missing · ticket_replayed · ticket_verify_unreachable
 *   ticket_verify_failed · ticket_invalid · ticket_missing_user
 *   master_user_unreachable · master_user_shape
 *   player_suspended · login_required · guest_disabled   (2026-10-07 play
 *     refusals, contract C5 — see services/playRefusal.js)
 *
 * Plus `no_socket`, produced locally by runSocketLogin when there is no socket.
 */

/**
 * True when a `loginResult` failure proves THE TOKEN WE SENT is not acceptable
 * — the only case where discarding that token is correct.
 *
 * 2026-08-17 — this used to test `invalid_grant` / `token_revoked`, neither of
 * which poker-server has ever emitted on `loginResult`: they are token-ENDPOINT
 * errors and arrive on the refresh path (authService's RefreshTokenRevokedError),
 * not on a socket. So this returned false for every real input — a guard that
 * was documented as governing the clear/keep boundary while being both
 * false-by-construction AND called from nowhere. It is now written against the
 * codes the server actually sends, and it is CALLED (tryLegacyAutoLogin in
 * App.jsx) at the one place a token still gets discarded.
 *
 * Deliberately narrow. Everything else poker-server can answer with —
 * maintenance, rate_limited, user_upsert_failed (a Railway Postgres blip),
 * user_row_missing, identity_conflict, handler_exception, a watchdog timeout,
 * or an unlabelled/back-compat frame — says nothing whatsoever about the
 * token's validity. Deleting a credential on those signals is what turned a
 * recoverable server hiccup into "sign in again from scratch", and on one
 * occasion into a global sign-out that also killed the player's
 * americanpub.poker session. Unknown code ⇒ keep the credential.
 */
export function isCredentialDead(result) {
  const code = result?.code;
  return code === 'legacy_token_invalid' || code === 'token_invalid' || code === 'no_token';
}

/**
 * True when a `loginResult` failure means "retrying with a different stored
 * credential cannot help, and the user must take action" — so an auth flow
 * should STOP rather than fall through to the next boot path.
 *
 * `identity_conflict` qualifies. It is a deliberate server-side
 * refusal: the local poker-server row matching this player's display name
 * belongs to a DIFFERENT master account, so the server will refuse every
 * credential this browser holds for the same reason. Falling through would just
 * produce a second identical failure and a more confusing message.
 *
 * 2026-10-07 — `player_suspended` qualifies for the same reason: the master
 * account (or an account on the same phone) is suspended from play, so another
 * stored credential cannot help. Callers show the server's own text for it
 * (services/playRefusal.js:playRefusalText). poker-server is expected to let a
 * suspended player SIGN IN and refuse only the play attempt; this only matters
 * if a login path ever refuses with that code.
 *
 * Everything else — including a bare unlabelled failure from an older server —
 * is treated as recoverable, because "attempt the other credentials we hold" is
 * always the safer default: the failure mode it prevents (user sits on the
 * login screen holding a valid 180-day refresh token that was never tried) is
 * the one that produced the outage.
 */
export function isDefinitiveLoginFailure(result) {
  return result?.code === 'identity_conflict' || result?.code === 'player_suspended';
}
