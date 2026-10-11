// App reload + failed-chunk recovery (2026-10-11, .online fix round 1 — APPUI-23).
//
// 1. reloadApp(): what the root error screen's "Reload" does. A REAL page
//    reload. It used to be a soft reset (setState) that re-rendered the same
//    broken tree: React.lazy caches a failed chunk and re-throws it forever, and
//    a crashing ?replay= link crashed again on every render, so Reload never
//    got the player out. A ?replay= parameter is removed first, so a shared
//    replay link that broke the page cannot break the reload too.
//
// 2. installChunkLoadRecovery(): Vite dispatches `vite:preloadError` when a
//    dynamic import (a lazy screen or panel chunk, or its CSS) fails to load —
//    a page left open across a deploy, or a dropped mobile connection. The
//    page reloads ONCE to pick up the current build. A second failure within
//    CHUNK_RELOAD_GUARD_MS (sessionStorage) never reloads again: it is left to
//    the error screen and its Reload button — never a reload loop. While the
//    player holds a seat at a table the reload is NOT automatic (a reload in a
//    live hand costs him his turn): a panel chunk is handled in place by
//    OverlayBoundary ("couldn't load" + Refresh), and a chunk failure that
//    reaches the root error boundary reloads from there
//    (reloadForChunkFailureCaughtByBoundary), with the same once-only guard.
import { useTableStore } from '../store/tableStore';

const CHUNK_RELOAD_GUARD_KEY = 'poker_chunk_reload_at';
export const CHUNK_RELOAD_GUARD_MS = 60_000;
// Chunk-load failure messages: Chrome / Edge, Firefox, Safari (no URL), Vite's
// CSS preload, and a module script the browser refused.
const CHUNK_ERROR_RE = /dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script/i;

let reloadPending = false;
let lastChunkFailure = null; // { at, error }
let installed = false;

/** True once this page has started reloading itself (the error screen then says "Updating…"). */
export function isAppReloadPending() {
  return reloadPending;
}

/**
 * Remove query parameters from the address bar without a navigation. Keeps
 * the path, the other parameters, the hash and history.state (the Android
 * back-button handling keeps its markers there). Returns true when changed.
 */
export function removeUrlParams(names) {
  try {
    const u = new URL(window.location.href);
    let changed = false;
    for (const name of names) {
      if (u.searchParams.has(name)) { u.searchParams.delete(name); changed = true; }
    }
    if (changed) window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`);
    return changed;
  } catch {
    return false;
  }
}

/** A real page reload (the error screen's Reload). Drops a ?replay= link first. */
export function reloadApp(reason) {
  removeUrlParams(['replay']);
  reloadPending = true;
  try { console.warn('[app-reload] reloading the page:', reason || 'requested'); } catch { /* ignore */ }
  try {
    window.location.reload();
  } catch {
    reloadPending = false;
  }
}

function describeError(error) {
  try {
    if (error && typeof error.message === 'string') return error.message.slice(0, 300);
    return String(error).slice(0, 300);
  } catch {
    return 'unknown';
  }
}

/**
 * Reload once for a chunk that failed to load. Refused (returns false) when
 * this tab already reloaded for one within CHUNK_RELOAD_GUARD_MS, or when the
 * guard cannot be stored (no sessionStorage = no loop protection = no
 * automatic reload).
 */
function reloadOnceForChunkFailure(reason) {
  if (reloadPending) return true;
  let last;
  try {
    last = Number(sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) || 0);
  } catch {
    return false;
  }
  const now = Date.now();
  // A stamp from the future (clock moved back) also counts as "just reloaded".
  if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_GUARD_MS) {
    try { console.warn('[app-reload] a chunk failed again right after a reload; not reloading again:', reason); } catch { /* ignore */ }
    return false;
  }
  try {
    sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(now));
  } catch {
    return false;
  }
  try { console.warn('[app-reload] a lazy chunk failed to load; reloading once:', reason); } catch { /* ignore */ }
  reloadApp(`chunk load failed: ${reason}`);
  return true;
}

/** Is this error a failed chunk / dynamic-import load? */
export function isChunkLoadError(error) {
  if (!error) return false;
  if (lastChunkFailure && error === lastChunkFailure.error) return true;
  return CHUNK_ERROR_RE.test(describeError(error));
}

/**
 * Root error boundary hook: a chunk failure broke the whole app (no
 * OverlayBoundary caught it) — reload once, seated or not. Returns true when
 * a reload is under way.
 */
export function reloadForChunkFailureCaughtByBoundary(error) {
  if (!isChunkLoadError(error)) return false;
  return reloadOnceForChunkFailure(`error screen: ${describeError(error)}`);
}

function holdsTableSeat() {
  try {
    const s = useTableStore.getState();
    const gs = s.gameState;
    if (!gs || s.isSpectating || gs.isSpectator) return false;
    const seat = gs.yourSeat != null ? gs.yourSeat : s.mySeat;
    return Number.isInteger(seat) && seat >= 0;
  } catch {
    return false;
  }
}

/** Install the `vite:preloadError` listener once, before the first lazy import. */
export function installChunkLoadRecovery() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('vite:preloadError', (event) => {
    try {
      const error = event && event.payload;
      lastChunkFailure = { at: Date.now(), error };
      const what = describeError(error);
      if (holdsTableSeat()) {
        console.warn('[app-reload] a lazy chunk failed while seated at a table; no automatic reload:', what);
        return;
      }
      reloadOnceForChunkFailure(what);
    } catch { /* never throw from the listener: Vite then rethrows the import error itself */ }
  });
}
