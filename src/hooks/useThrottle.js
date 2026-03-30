import { useState, useEffect, useRef } from 'react';

/**
 * Returns a throttled copy of `value` that updates at most once per `ms`.
 * Useful for non-critical UI panels that don't need to respond to every game
 * state tick (timing tells, commentary, heatmap, prediction market).
 */
export function useThrottle(value, ms = 300) {
  const [throttled, setThrottled] = useState(value);
  const lastUpdated = useRef(Date.now());

  useEffect(() => {
    const now = Date.now();
    const remaining = ms - (now - lastUpdated.current);
    if (remaining <= 0) {
      lastUpdated.current = now;
      setThrottled(value);
    } else {
      const timer = setTimeout(() => {
        lastUpdated.current = Date.now();
        setThrottled(value);
      }, remaining);
      return () => clearTimeout(timer);
    }
  }, [value, ms]);

  return throttled;
}
