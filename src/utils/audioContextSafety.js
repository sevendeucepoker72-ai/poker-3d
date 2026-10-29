/**
 * audioContextSafety - the AudioContext promise rules for the table sounds
 * (hooks/useSoundEffects.js). Pure and import-free, so a Node probe can load it.
 *
 * 2026-10-28 - AudioContext.resume() returns a promise, and it was dropped.
 * iOS refuses it with "Failed to start the audio device" (the audio session is
 * held elsewhere, or the call was not inside a tap), Android with "Cannot
 * resume a closed AudioContext" and "AudioContext closed before a pending
 * resume() could complete". Each refusal was an unhandledrejection report
 * (13 on 10-25, the qualifier day), and the table stayed silent - no turn
 * sound - for the rest of the session. Now every resume() / suspend() /
 * close() promise is settled here, and a refused resume() is retried on the
 * player's next tap or key press, where iOS lets audio start: a closed or
 * refused context is replaced by a fresh one created inside that gesture.
 */

/**
 * Run one AudioContext call (resume / suspend / close) and settle it: resolves
 * true when it succeeded, false when it threw or its promise rejected. Never
 * rejects, so the caller can never leave an unhandled rejection behind.
 */
export function settleAudioCall(run) {
  let p;
  try {
    p = run();
  } catch {
    return Promise.resolve(false);
  }
  if (!p || typeof p.then !== 'function') return Promise.resolve(true);
  return Promise.resolve(p).then(() => true, () => false);
}

/**
 * True when the context must be replaced before it can play again: there is
 * none, it is closed, or its last resume() was refused.
 */
export function audioContextNeedsReplacing(ctx, resumeRefused) {
  if (!ctx) return true;
  if (resumeRefused === true) return true;
  try {
    return ctx.state === 'closed';
  } catch {
    return true;
  }
}

/**
 * The user gestures in which iOS / Android allow audio to start. 2026-10-28 -
 * NOT pointerdown: from a finger it is not an activation-triggering event (the
 * HTML spec counts touchend / pointerup for touch), and iOS WebKit opens its
 * audio-start window on touchend / click. pointerdown came first in a tap, so
 * the one-shot listener fired there and built the replacement context outside
 * the gesture. touchend (finger), click (mouse / pen) and keydown each grant
 * activation, and touchend comes before click in a tap.
 */
export const AUDIO_GESTURE_EVENTS = ['touchend', 'click', 'keydown'];

/**
 * Call `fn` once, on the next user gesture on `target` (capture phase, passive:
 * it never blocks or changes the tap). Returns a remover; calling it before the
 * gesture cancels. A throw in `fn` is swallowed.
 */
export function onNextUserGesture(target, fn, events = AUDIO_GESTURE_EVENTS) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  let done = false;
  const remove = () => {
    for (const ev of events) {
      try { target.removeEventListener(ev, handler, true); } catch { /* ignore */ }
    }
  };
  function handler() {
    if (done) return;
    done = true;
    remove();
    try { fn(); } catch { /* a sound is best-effort */ }
  }
  for (const ev of events) {
    try { target.addEventListener(ev, handler, { capture: true, passive: true }); } catch { /* ignore */ }
  }
  return () => { done = true; remove(); };
}
