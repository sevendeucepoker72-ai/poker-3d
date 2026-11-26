/**
 * 2026-11-26 (lobby lists review round 2) - keyboard focus for a modal dialog
 * (role="dialog" aria-modal="true"): focus moves INTO it when it opens, Tab /
 * Shift+Tab wrap inside it, and focus goes BACK to the control that opened it
 * when it closes. The Live Bracket / Results window (TournamentBracket) uses
 * it: it declared aria-modal but left focus on the lobby's Results button
 * behind the scrim, so Tab walked the hidden lobby.
 *
 * Pure DOM helpers: they take the elements as arguments (no React, no
 * imports), so tests/broadcast/tournamentLists.test.mjs drives them in Node
 * with small fake elements.
 */

/** What Tab can reach inside a dialog. */
export const DIALOG_FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The dialog's Tab stops, in document order (hidden ones left out). */
export function focusablesIn(dialog) {
  if (!dialog || typeof dialog.querySelectorAll !== 'function') return [];
  return Array.from(dialog.querySelectorAll(DIALOG_FOCUSABLE))
    .filter((el) => el && !el.hidden && !(typeof el.getAttribute === 'function' && el.getAttribute('aria-hidden') === 'true'));
}

function focusEl(el) {
  if (!el || typeof el.focus !== 'function') return false;
  try { el.focus({ preventScroll: true }); return true; } catch { return false; }
}

/**
 * Moves focus into `dialog` unless `active` (document.activeElement) is
 * already inside it: its `[data-autofocus]` element (the close button), else
 * its first Tab stop. Returns the element it focused, else null.
 */
export function focusIntoDialog(dialog, active) {
  if (!dialog) return null;
  if (active && typeof dialog.contains === 'function' && dialog.contains(active)) return null;
  const preferred = typeof dialog.querySelector === 'function' ? dialog.querySelector('[data-autofocus]') : null;
  const target = preferred || focusablesIn(dialog)[0] || null;
  return focusEl(target) ? target : null;
}

/**
 * The dialog's keydown: Tab on its last stop goes to its first, Shift+Tab on
 * its first goes to its last, and a Tab while focus is outside it comes back
 * in. Any other key / position: the browser's own move. Returns true when it
 * moved focus (and stopped the browser's).
 */
export function trapTabKey(event, dialog, active) {
  if (!event || event.key !== 'Tab' || !dialog) return false;
  const items = focusablesIn(dialog);
  if (items.length === 0) return false;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = !!active && typeof dialog.contains === 'function' && dialog.contains(active);
  let target = null;
  if (event.shiftKey) { if (!inside || active === first) target = last; }
  else if (!inside || active === last) target = first;
  if (!target) return false;
  if (typeof event.preventDefault === 'function') event.preventDefault();
  return focusEl(target);
}

/**
 * When the dialog closes: focus goes back to `opener` (the control that had
 * focus when it opened) while it is still on the page, and only when nothing
 * else took focus meanwhile (`doc.activeElement` is the page body or nothing:
 * the closed dialog's focus is dropped there). Returns true when it did.
 */
export function restoreFocusTo(opener, doc) {
  if (!opener || typeof opener.focus !== 'function') return false;
  if (opener.isConnected === false) return false;
  if (doc && (opener === doc.body || opener === doc.documentElement)) return false;
  const now = doc ? doc.activeElement : null;
  if (now && now !== opener && !(doc && (now === doc.body || now === doc.documentElement))) return false;
  return focusEl(opener);
}
