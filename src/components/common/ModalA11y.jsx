/*
 * ModalA11y — accessible dialog primitive.
 *
 * Provides the four pillars an assistive-tech user needs from a modal:
 *   1. Focus moves into the dialog on open
 *   2. Tab / Shift+Tab is trapped inside the dialog
 *   3. Escape closes the dialog (when onClose is supplied)
 *   4. Focus is restored to the element that triggered the open on close
 *
 * Also sets `role="dialog"`, `aria-modal="true"`, and wires `aria-labelledby`
 * / `aria-describedby` via optional `titleId` / `descriptionId` props.
 *
 * USAGE
 * -----
 * ```jsx
 *   <ModalA11y
 *     open={showSettings}
 *     onClose={() => setShowSettings(false)}
 *     titleId="settings-title"
 *   >
 *     <h2 id="settings-title">Settings</h2>
 *     ...
 *   </ModalA11y>
 * ```
 *
 * TODOs (deferred — this component exists as a migration target, not
 * delivered with every modal migrated yet):
 *
 *   1. showdown-overlay in GameHUD.jsx is the highest-traffic modal in
 *      the app and should adopt this component next. GameHUD is off-
 *      limits in the current a11y pass (owned by a different agent);
 *      when the next GameHUD touch happens, wrap the overlay in
 *      <ModalA11y open=... onClose=...>.
 *   2. rabbit-overlay, settings panel, post-hand coach, tournament
 *      bracket detail, scratch-card reveal — each is currently a bare
 *      <div className="overlay-*" /> with no focus management.
 *   3. Broader "div-as-button" sweep — this codebase has ~82 `<div
 *      onClick={...}>` patterns. Each needs either conversion to
 *      `<button>` or a11y attributes (role="button", tabIndex={0},
 *      onKeyDown for Enter/Space). Out of scope for this pass because
 *      the bulk of those divs live in GameHUD / ClubsPanel /
 *      PokerTable2D / mobile-overrides.css which are owned by other
 *      agents. Current pass fixes only the divs in the files this
 *      agent touches.
 */
import { useEffect, useRef, useCallback } from 'react';

// Elements inside the modal container that are typically focusable.
// Strings chosen to match the querySelectorAll pattern most React
// component libraries agree on; refine if we find something missing.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'details',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

export default function ModalA11y({
  open,
  onClose,
  titleId,
  descriptionId,
  className,
  style,
  children,
  // If true, clicking the backdrop closes the modal. Defaults false
  // because for poker post-hand overlays we don't want an accidental
  // stray click to dismiss — caller opts in.
  closeOnBackdropClick = false,
  // Extra aria-label when the dialog doesn't have a visible title.
  ariaLabel,
}) {
  const containerRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Track the element that had focus before the modal opened so we can
  // return focus there on close. Done in a ref (not state) to avoid
  // extra renders.
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement;

    // Move focus into the modal after the container has mounted and
    // children have rendered. queueMicrotask is just enough deferral to
    // let React commit the portal DOM before we query it.
    queueMicrotask(() => {
      const container = containerRef.current;
      if (!container) return;
      const first = container.querySelector(FOCUSABLE_SELECTOR);
      if (first && typeof first.focus === 'function') {
        first.focus();
      } else {
        // No focusable child — focus the container itself so subsequent
        // Tab presses stay inside the trap.
        container.setAttribute('tabindex', '-1');
        container.focus();
      }
    });

    // Restore focus to the triggering element on unmount / close.
    return () => {
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        // Some elements (a disabled button re-enabled post-close) may
        // throw when .focus() is called — swallow it.
        try { prev.focus(); } catch { /* no-op */ }
      }
    };
  }, [open]);

  const handleKeyDown = useCallback((e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      if (typeof onClose === 'function') {
        e.stopPropagation();
        onClose(e);
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const container = containerRef.current;
    if (!container) return;
    const focusables = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [open, onClose]);

  const handleBackdropClick = useCallback((e) => {
    if (!closeOnBackdropClick) return;
    if (e.target === e.currentTarget && typeof onClose === 'function') {
      onClose(e);
    }
  }, [closeOnBackdropClick, onClose]);

  // Support keyboard activation on the backdrop when it's treated as a
  // dismiss target (matches <button> behavior for users who land there
  // via shift-tab from inside the modal).
  const handleBackdropKeyDown = useCallback((e) => {
    if (!closeOnBackdropClick) return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      if (typeof onClose === 'function') onClose(e);
    }
  }, [closeOnBackdropClick, onClose]);

  if (!open) return null;

  // The outer div is the backdrop; the inner div is the dialog surface
  // itself. If `closeOnBackdropClick` is on, the outer div takes
  // role="button" + keyboard support to satisfy the div-as-button
  // guidance; otherwise it's a plain presentational element.
  const backdropInteractive = closeOnBackdropClick;

  return (
    <div
      className={`modal-a11y-backdrop ${className || ''}`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
      onClick={handleBackdropClick}
      onKeyDown={handleBackdropKeyDown}
      {...(backdropInteractive
        ? { role: 'button', tabIndex: -1, 'aria-label': 'Close dialog' }
        : {})}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-label={!titleId ? ariaLabel : undefined}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
