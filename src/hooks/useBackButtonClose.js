import { useEffect, useRef } from 'react';

/**
 * Intercepts the browser/mobile hardware back gesture while a modal/overlay is
 * open, and calls `onClose` instead of popping the page history (which would
 * leave the app entirely on many Android devices).
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   useBackButtonClose(open, () => setOpen(false));
 *
 * Behavior:
 * - When `active` flips to true, pushes a sentinel state onto window.history
 *   so the next back-tap fires popstate on THIS page (not navigation).
 * - Listens for popstate; if we see our sentinel disappear, treats it as the
 *   user's back intent and calls onClose().
 * - On unmount OR when `active` flips to false, cleans up by going `history.back()`
 *   ONLY if our sentinel is still on top (prevents trapping the user).
 *
 * IMPORTANT: `onClose` is captured in a ref so a new arrow-function reference
 * from the parent re-render does NOT re-run the effect. Previously a parent
 * re-render would trigger cleanup → history.back() → new effect runs →
 * listener catches the synthetic popstate → calls onClose → modal auto-closes.
 * That was the "Battle Pass auto-closes" bug.
 */
export function useBackButtonClose(active, onClose) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const sentinel = { __pokerModal: true, ts: Date.now() };
    let pushedOurState = false;

    try {
      window.history.pushState(sentinel, '');
      pushedOurState = true;
    } catch { /* ignore (some iframes disallow history.pushState) */ }

    const handlePop = () => {
      // The back button was pressed and our sentinel has been popped off.
      // Call onClose; do NOT push again here (that would re-trap the user).
      onCloseRef.current && onCloseRef.current();
    };
    window.addEventListener('popstate', handlePop);

    return () => {
      window.removeEventListener('popstate', handlePop);
      // If the user closed the modal by clicking X (not by pressing back),
      // our sentinel is still on the stack — pop it so back-history stays clean.
      if (pushedOurState && window.history.state && window.history.state.__pokerModal) {
        try { window.history.back(); } catch { /* ignore */ }
      }
    };
    // Intentionally omit `onClose` from deps — see comment above.
  }, [active]);
}
