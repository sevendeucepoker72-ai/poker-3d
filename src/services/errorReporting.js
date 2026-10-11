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
//
// 2026-10-11 (.online fix round 1 — OPS-7 + AUTH P3):
// - Render crashes are reported. React 19 never re-dispatches an error that an
//   error boundary caught to window 'error', and the root ErrorBoundary wraps
//   the whole app, so the "Something went wrong" screen was invisible to ops.
//   main.jsx passes reactRootErrorOptions (onCaughtError / onUncaughtError) to
//   createRoot: every boundary (root, OverlayBoundary, the table boundary)
//   reports through this transport, with the component stack.
// - The reported page URL is origin + path only. Query and hash can carry a
//   Play Online ?token= ticket, a #bridge_id_token or an OAuth ?code=, and
//   URLs inside message / stack text get the same treatment.
// - A failed lazy chunk (`vite:preloadError`) is reported once, and the boundary
//   catch of that same error is not reported a second time.
// - The detail is kept under the master API's 4,000-char cap (an oversized
//   detail is stored as {_truncated} and the message is lost).

import { API_BASE } from '../config';
import { bearerForThisTab } from './tokenStorage';

const DEDUP_WINDOW_MS = 60_000;
const DEDUP_MAX_KEYS = 10;
// poker-api authEvents.js DETAIL_MAX_CHARS = 4000 (JSON length of `detail`).
const DETAIL_BUDGET_CHARS = 3800;

// Recent error keys -> last-sent timestamp. Bounded to DEDUP_MAX_KEYS entries
// (oldest evicted on insert) so we never grow unbounded if an attacker or bug
// generates a flood of unique keys.
const recentKeys = new Map();

let installed = false;

function readToken() {
  try {
    // 2026-07-06 audit P3 — also check sessionStorage. A "keep me signed in" OFF
    // session stores its tokens there (per tokenStorage routing), so a
    // localStorage-only read made every error report from those sessions
    // anonymous (no user attribution in the auth-events / Sentry-lite sink).
    // 2026-10-10 (F5) — each candidate through bearerForThisTab: a "Play
    // Online" ticket tab never sends another account's sign-in stored on this
    // browser (the report then goes out anonymously); every other tab is
    // unchanged (first non-empty, same order as before).
    return [
      localStorage.getItem('poker_oauth_access'),
      localStorage.getItem('poker_auth_token'),
      sessionStorage.getItem('poker_oauth_access'),
      sessionStorage.getItem('poker_auth_token'),
    ].map((t) => bearerForThisTab(t)).find(Boolean) || null;
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

// Absolute URL followed by a query and/or hash: keep scheme + host + path only.
const URL_QUERY_HASH_RE = /(\bhttps?:\/\/[^\s?#'"`<>()\\]+)[?#][^\s'"`<>()\\]*/gi;
// Sign-in material outside an absolute URL (a relative "/auth/callback?code=…",
// a bare "#bridge_id_token=…"): keep the name, drop the value.
const SECRET_PARAM_RE = /([?&#;]\s*(?:code|token|ticket|bridge_id_token|id_token|access_token|refresh_token|state|session_state)=)[^&#\s'"`<>()\\]*/gi;

/** Strip query + hash from every URL in a report text, and redact sign-in parameters. */
export function scrubReportText(text) {
  if (typeof text !== 'string' || !text) return '';
  try {
    return text.replace(URL_QUERY_HASH_RE, '$1').replace(SECRET_PARAM_RE, '$1[redacted]');
  } catch {
    return '';
  }
}

/** The page as origin + path — never the query or hash (?token= / ?code= / #bridge_id_token). */
function pageUrl() {
  try {
    return `${window.location.origin}${window.location.pathname}`;
  } catch {
    return '';
  }
}

/** Shrink the long fields so JSON.stringify(detail) stays under the API cap. */
function fitDetail(detail) {
  let d = detail;
  try {
    const order = [['componentStack', 200], ['stack', 400], ['message', 200], ['userAgent', 120]];
    for (const [field, floor] of order) {
      const over = JSON.stringify(d).length - DETAIL_BUDGET_CHARS;
      if (over <= 0) return d;
      const v = d[field];
      if (typeof v !== 'string' || v.length <= floor) continue;
      // Each raw char removed removes >= 1 JSON char, so this pass fits unless the floor stops it.
      d = { ...d, [field]: `${v.slice(0, Math.max(floor, v.length - over - 8))}…` };
    }
    if (JSON.stringify(d).length > DETAIL_BUDGET_CHARS) {
      d = { ...d, componentStack: '', stack: '', message: String(d.message || '').slice(0, 300) };
    }
  } catch { /* send what we have */ }
  return d;
}

function reportError(message, stack, extra) {
  try {
    const msg = scrubReportText(String(message || '')).slice(0, 1000);
    const stk = scrubReportText(String(stack || ''));
    const userAgent =
      (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    // Dedup key: first 120 chars of message + first stack frame keeps
    // "same error every render" collapsed to one POST per minute.
    const firstFrame = stk.split('\n').slice(0, 2).join('|');
    const key = `${msg.slice(0, 120)}::${firstFrame.slice(0, 200)}`;
    if (shouldDrop(key)) return;
    // urlScope tells the reader of auth_events that `url` deliberately
    // omits the query and hash.
    const detail = { message: msg, stack: stk, url: pageUrl(), urlScope: 'origin+path', userAgent };
    if (extra && typeof extra === 'object') {
      for (const [k, v] of Object.entries(extra)) {
        if (v === undefined || v === null || v === '') continue;
        detail[k] = typeof v === 'string' ? scrubReportText(v) : v;
      }
    }
    send(fitDetail(detail));
  } catch {
    // Reporter must never throw.
  }
}

function describeThrown(value) {
  try {
    if (value instanceof Error) return value.message || value.name || 'Error';
    if (typeof value === 'string') return value;
    return JSON.stringify(value) || String(value);
  } catch {
    return String(value);
  }
}

// The error object of the last `vite:preloadError` this reporter sent: the
// boundary that then catches the same failed import is not reported again.
let lastReportedChunkError = null;

function reportReactError(kind, error, errorInfo) {
  try {
    if (error && error === lastReportedChunkError) return;
    const componentStack = errorInfo && typeof errorInfo.componentStack === 'string'
      ? errorInfo.componentStack.slice(0, 1500)
      : '';
    let boundary = null;
    try {
      const b = errorInfo && errorInfo.errorBoundary;
      if (b) boundary = (b.props && typeof b.props.name === 'string' && b.props.name) || 'unnamed';
    } catch { boundary = null; }
    reportError(
      `[render] ${describeThrown(error)}`,
      error instanceof Error ? (error.stack || '') : '',
      { kind, componentStack, boundary },
    );
  } catch {
    // Reporter must never throw.
  }
}

/**
 * createRoot options (React 19). Passing these replaces React's defaults, so
 * both still log to the console like the defaults did; onUncaughtError no
 * longer goes through window.reportError (the window 'error' listener below
 * would have sent it a second time).
 */
export const reactRootErrorOptions = {
  onCaughtError(error, errorInfo) {
    try { console.error('[react] error caught by a boundary:', error, (errorInfo && errorInfo.componentStack) || ''); } catch { /* ignore */ }
    reportReactError('render_caught', error, errorInfo);
  },
  onUncaughtError(error, errorInfo) {
    try { console.error('[react] uncaught render error:', error, (errorInfo && errorInfo.componentStack) || ''); } catch { /* ignore */ }
    reportReactError('render_uncaught', error, errorInfo);
  },
};

export function installErrorReporting() {
  try {
    if (installed) return;
    if (typeof window === 'undefined') return;
    installed = true;

    // A lazy chunk (or its CSS) failed to load — see services/appReload.js.
    window.addEventListener('vite:preloadError', (e) => {
      try {
        const err = e && e.payload;
        lastReportedChunkError = err || null;
        reportError(
          `[chunk] ${describeThrown(err)}`,
          (err && err.stack) || '',
          { kind: 'chunk_load_failed' },
        );
      } catch { /* reporter must never throw */ }
    });

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
