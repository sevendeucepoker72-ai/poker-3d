import { useState, useEffect, useRef } from 'react';

const AFK_TIMEOUT_MS = 10 * 60 * 1000;  // 10 minutes
const WARNING_AT_MS  =  9 * 60 * 1000;  //  9 minutes (1 min warning)

/**
 * Track player activity and emit AFK events after 10 minutes of inactivity.
 *
 * @param {object} options
 * @param {boolean} options.active - Whether tracking should be active (true when seated at a table)
 * @param {function} options.onAFK - Called when player goes AFK (emit sitOut)
 * @param {function} options.onBack - Called when player returns from AFK (emit playerBack)
 * @param {function} options.onWarning - Called with secondsLeft when 1 minute remains
 * @returns {{ isAFK: boolean, secsUntilAFK: number }}
 */
export function useAFKTracker({ active = false, onAFK, onBack, onWarning } = {}) {
  const [isAFK, setIsAFK] = useState(false);
  const [secsUntilAFK, setSecsUntilAFK] = useState(AFK_TIMEOUT_MS / 1000);

  const lastActivityRef = useRef(Date.now());
  const isAFKRef = useRef(false);
  const warningFiredRef = useRef(false);
  const tickRef = useRef(null);

  // Keep the latest callbacks in refs so the main effect only depends on `active`.
  // Without this, non-memoized parent callbacks would re-run the effect every render
  // and flap the event listeners.
  const onAFKRef = useRef(onAFK);
  const onBackRef = useRef(onBack);
  const onWarningRef = useRef(onWarning);
  useEffect(() => { onAFKRef.current = onAFK; },     [onAFK]);
  useEffect(() => { onBackRef.current = onBack; },   [onBack]);
  useEffect(() => { onWarningRef.current = onWarning; }, [onWarning]);

  useEffect(() => {
    if (!active) {
      clearInterval(tickRef.current);
      setIsAFK(false);
      setSecsUntilAFK(AFK_TIMEOUT_MS / 1000);
      isAFKRef.current = false;
      warningFiredRef.current = false;
      return;
    }

    const resetActivity = () => {
      lastActivityRef.current = Date.now();
      warningFiredRef.current = false;
      if (isAFKRef.current) {
        isAFKRef.current = false;
        setIsAFK(false);
        onBackRef.current?.();
      }
    };

    // Reset on any user activity
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach(ev => window.addEventListener(ev, resetActivity, { passive: true }));

    // Tick every second to update countdown
    tickRef.current = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, AFK_TIMEOUT_MS - idle);
      setSecsUntilAFK(Math.ceil(remaining / 1000));

      if (!warningFiredRef.current && remaining <= (AFK_TIMEOUT_MS - WARNING_AT_MS)) {
        warningFiredRef.current = true;
        onWarningRef.current?.(Math.ceil(remaining / 1000));
      }

      if (!isAFKRef.current && remaining === 0) {
        isAFKRef.current = true;
        setIsAFK(true);
        onAFKRef.current?.();
      }
    }, 1000);

    return () => {
      clearInterval(tickRef.current);
      events.forEach(ev => window.removeEventListener(ev, resetActivity));
    };
  }, [active]);

  return { isAFK, secsUntilAFK };
}
