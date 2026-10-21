/**
 * Gameplay audit F139 (2026-10-21) — the browser / Android Back button on the
 * table screen means what the in-app "Back to Lobby" button means.
 *
 * App.jsx traps Back on the table screen (a guard history entry). It used to
 * only switch the screen to the lobby: nothing left the seat, so the seat was
 * dealt in and blinded / auto-folded on the 30s clock while the player
 * believed he had left (the confirm even promised "Your hand will be
 * auto-folded"), and a tournament seat skipped the S2 leave bookkeeping.
 *
 * GameHUD registers its Back to Lobby handler here while mounted; App's
 * popstate runs it. The handler answers:
 *   'left'    the seat was left (or the watch stopped) and the screen moved
 *   'dialog'  a dialog took over (the tournament leave dialog) — still on the table
 *   'stayed'  the player cancelled a confirm — still on the table
 * runTableBack() answers 'none' when no table view is mounted (the table
 * error card: its own Lobby button keeps the seat by design).
 *
 * A modal's own history.back() (hooks/useBackButtonClose, when it closes by
 * its X or unmounts with the screen) is not the player pressing Back:
 * noteProgrammaticHistoryBack() marks it, and App ignores that pop.
 */

let _handler = null;

/** GameHUD: register the Back handler; returns the unregister function. */
export function setTableBackHandler(fn) {
  const h = typeof fn === 'function' ? fn : null;
  _handler = h;
  return () => { if (_handler === h) _handler = null; };
}

/** Run the table's Back: 'left' | 'dialog' | 'stayed' | 'none' (no table view). */
export function runTableBack() {
  if (!_handler) return 'none';
  try {
    const r = _handler();
    return r === 'left' || r === 'dialog' ? r : 'stayed';
  } catch {
    return 'stayed';
  }
}

export const PROGRAMMATIC_BACK_WINDOW_MS = 1500;
let _programmaticBackAt = 0;

/** hooks/useBackButtonClose: the next popstate is ours, not the player's Back. */
export function noteProgrammaticHistoryBack(now = Date.now()) {
  _programmaticBackAt = now;
}

/** True (once) when the popstate being handled was a recent programmatic back. */
export function consumeProgrammaticBack(now = Date.now()) {
  if (_programmaticBackAt && now - _programmaticBackAt < PROGRAMMATIC_BACK_WINDOW_MS) {
    _programmaticBackAt = 0;
    return true;
  }
  return false;
}
