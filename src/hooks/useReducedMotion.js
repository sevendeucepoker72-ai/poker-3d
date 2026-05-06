import { useEffect, useState } from 'react';

/**
 * Reflects the user's `prefers-reduced-motion` media-query preference.
 * Returns true when the user has requested reduced motion in OS settings
 * (Windows: Settings > Ease of Access > Display; macOS: System Prefs >
 * Accessibility > Display > Reduce motion; iOS: Accessibility > Motion).
 *
 * Components that render heavy animations (confetti, parallax, looping
 * keyframes) should gate their rendering / effect durations on this.
 *
 * The global CSS override in `a11y.css` already nukes `animation-duration`
 * and `transition-duration` for everything under the media query, so this
 * hook is for cases where the animation is JS-driven (canvas, setInterval,
 * RAF particle systems) and can't be killed by a CSS rule alone.
 */
export default function useReducedMotion() {
  const getInitial = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  };

  const [reduced, setReduced] = useState(getInitial);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    let mql;
    try {
      mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return undefined;
    }
    const onChange = (e) => setReduced(!!e.matches);
    // Safari < 14 only supports addListener/removeListener
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
    return undefined;
  }, []);

  return reduced;
}
