// Frontend error reporting for the .online (poker-3d) PWA.
//
// Forwards uncaught errors and unhandled promise rejections to the auth-events
// log endpoint on the prod API so we can diagnose silent crashes in the React
// tree (currently the only signal is "frozen scene, no logs").
//
// Design constraints:
// - The reporter MUST NEVER throw — a bug in error reporting must not become
//   the loudest error in the app. Every public surface is wrapped in try/catch.
// - Idempotent: installErrorReporting() is safe to call more than once. Only
//   the first call wires window listeners.
// - Dedup: identical error keys within a 60s window are dropped to keep noise
//   down (e.g. a render loop throwing on every frame).
// - keepalive: true so the POST survives page-unload during the error.
//
// Auth tokens are read from localStorage at send-time (not at install-time) so
// errors that fire after login include a Bearer token, while errors before
// login still report (anonymously).

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  'https://poker-prod-api-azeg4kcklq-uc.a.run.app/poker-api';

const DEDUP_WINDOW_MS = 60_000;
const DEDUP_MAX_KEYS = 10;

// Recent error keys -> last-sent timestamp. Bounded to DEDUP_MAX_KEYS entries
// (oldest evicted on insert) so we never grow unbounded if an attacker or bug
// generates a flood of unique keys.
const recentKeys = new Map();

let installed = false;

function readToken() {
  try {
    return (
      localStorage.getItem('oauth_access_token') ||
      localStorage.getItem('poker_auth_token') ||
      null
    );
  } catch (_) {
    return null;
  }
}

function shouldDrop(key) {
  try {
    const now = Date.now();
    // Sweep expired entries.
    for (const [k, ts] of recentKeys) {
      if (now - ts > DEDUP_WINDOW_MS) recentKeys.delete(k);
    }
    if (recentKeys.has(key)) return true;
    // Bound the map: drop oldest if we're at capacity.
    if (recentKeys.size >= DEDUP_MAX_KEYS) {
      const firstKey = recentKeys.keys().next().value;
      if (firstKey !== undefined) recentKeys.delete(firstKey);
    }
    recentKeys.set(key, now);
    return false;
  } catch (_) {
    return false;
  }
}

function send(detail) {
  try {
    const token = readToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`${API_BASE}/auth-events/log`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventType: 'client_error',
        origin: 'online',
        detail,
      }),
      keepalive: true,
    }).catch(() => {
      // Swallow network errors — reporting must never throw or surface to user.
    });
  } catch (_) {
    // Same.
  }
}

function reportError(message, stack) {
  try {
    const url = (typeof window !== 'undefined' && window.location && window.location.href) || '';
    const userAgent =
      (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    // Dedup key: first 120 chars of message + first stack frame keeps
    // "same error every render" collapsed to one POST per minute.
    const firstFrame = (stack || '').split('\n').slice(0, 2).join('|');
    const key = `${(message || '').slice(0, 120)}::${firstFrame.slice(0, 200)}`;
    if (shouldDrop(key)) return;
    send({ message: message || '', stack: stack || '', url, userAgent });
  } catch (_) {
    // Reporter must never throw.
  }
}

export function installErrorReporting() {
  try {
    if (installed) return;
    if (typeof window === 'undefined') return;
    installed = true;

    window.addEventListener('error', (e) => {
      try {
        const err = e && e.error;
        const message = (err && err.message) || (e && e.message) || 'window.error';
        const stack = (err && err.stack) || '';
        reportError(message, stack);
      } catch (_) {}
    });

    window.addEventListener('unhandledrejection', (e) => {
      try {
        const reason = e && e.reason;
        let message;
        let stack = '';
        if (reason instanceof Error) {
          message = reason.message;
          stack = reason.stack || '';
        } else if (typeof reason === 'string') {
          message = reason;
        } else {
          try {
            message = JSON.stringify(reason);
          } catch (_) {
            message = String(reason);
          }
        }
        reportError(`unhandledrejection: ${message}`, stack);
      } catch (_) {}
    });
  } catch (_) {
    // If even installation throws (e.g. window undefined in SSR), bail silently.
  }
}
