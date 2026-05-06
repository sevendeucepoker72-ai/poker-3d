/**
 * fetchWithTimeout — wraps the native fetch() with an AbortController so
 * a stalled network (common on mobile / PWA backgrounding) can't hang the
 * request indefinitely. Default 10s; callers may override per-call.
 *
 * Usage:
 *   import { fetchWithTimeout, FetchTimeoutError } from '../utils/fetchWithTimeout';
 *   try {
 *     const res = await fetchWithTimeout(url, { method: 'POST', body }, 8000);
 *   } catch (err) {
 *     if (err instanceof FetchTimeoutError) { ... }
 *   }
 *
 * Note: a caller-supplied `signal` in opts is respected — if that signal
 * fires first, fetch rejects with its own AbortError and our timeout is
 * cleared in the finally. We never overwrite an existing signal.
 */

/**
 * Thrown when the timeout fires before fetch() settles. Lets callers
 * distinguish "slow/stalled network" from "fetch rejected for some other
 * reason" (e.g. DNS failure, CORS, user-aborted). The native AbortError
 * surfaced by fetch on timeout has `name === 'AbortError'` which is the
 * same name used for user-initiated aborts — this class removes that
 * ambiguity at the call site.
 */
export class FetchTimeoutError extends Error {
  constructor(url, timeoutMs) {
    super(`fetch timed out after ${timeoutMs}ms: ${url}`);
    this.name = 'FetchTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let timedOut = false;
  const timeoutWatch = setTimeout(() => { timedOut = true; }, timeoutMs);
  try {
    // If the caller supplied their own signal, respect it by aborting our
    // controller when theirs fires. This keeps combined-abort semantics
    // without overwriting the caller's signal.
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (err) {
    if (timedOut && err && err.name === 'AbortError') {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(t);
    clearTimeout(timeoutWatch);
  }
}
