/**
 * useWakeLock — request Screen Wake Lock while active so the phone
 * doesn't sleep mid-turn. PWA audit #9: without this, an idle phone
 * locks during a long decision, which drops the socket and auto-folds
 * you. Pokerstars mobile + every other poker app on mobile uses this.
 *
 * Browser support: Chrome/Edge 84+, Safari 16.4+. Falls back to no-op
 * on unsupported browsers (no throw).
 *
 * Usage:
 *   useWakeLock(isMyTurn);  // acquires while true, releases on false
 */

import { useEffect, useRef } from 'react';

export default function useWakeLock(active) {
  const lockRef = useRef(null);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (!('wakeLock' in navigator)) return; // unsupported browser — no-op

    let cancelled = false;

    async function acquire() {
      if (cancelled) return;
      if (lockRef.current) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) { try { await lock.release(); } catch {} return; }
        lockRef.current = lock;
        lock.addEventListener('release', () => { lockRef.current = null; });
      } catch (err) {
        // Common reasons: document hidden, permission denied.
        // Silent — caller has no way to resolve, and the app still works
        // without a lock; only UX impact is possible screen sleep.
      }
    }

    function release() {
      const l = lockRef.current;
      lockRef.current = null;
      if (l) { try { l.release?.(); } catch {} }
    }

    // Re-acquire after visibility returns (browser auto-releases locks
    // when the document is hidden; the release fires silently).
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && active) acquire();
    };

    if (active) {
      acquire();
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [active]);
}
