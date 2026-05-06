/**
 * persistenceService — bidirectional sync between sessionStorage and the server.
 *
 * The server is the source of truth for chips/xp/level/achievements.
 * sessionStorage holds: career progress, mission state, battle pass claims,
 * settings, notes, etc.
 *
 * ─── Storage-tier decision (2026-04-22 audit) ────────────────────────────
 * THIS FILE USES `sessionStorage` EXCLUSIVELY.
 *
 * Rules for the whole poker-3d client:
 *   - `sessionStorage` — short-lived client-side cache of progression /
 *     preference data. Cleared by the browser when the tab/window closes.
 *     Prevents shared-device progression leak: if two people use the same
 *     browser on a shared kiosk/laptop, user B does NOT see user A's
 *     cached career / mission / settings blobs after user A closes the tab.
 *   - `localStorage` — reserved for auth tokens ONLY, managed exclusively
 *     by `tokenStorage.js`. Do not read/write localStorage here.
 *
 * The mono-repo mirror historically drifted to localStorage in this file.
 * Downloads is authoritative; the mirror will be reconciled by copying
 * this file over. Do not re-introduce localStorage in this module.
 *
 * ─── Fresh-init clobber gate (2026-04-22 audit) ──────────────────────────
 * `_doSync` MUST NOT emit `saveProgress` until the progress store has been
 * hydrated from the server (`progress.hydrated === true`). Otherwise a
 * slow-connect race would let the in-memory `defaultProgress()` chip /
 * stars / level values stomp the DB row. See CLAUDE.md "User data MUST
 * persist" — same bug class as the persistStars / ensureHydrated history.
 *
 * This service:
 *  1. Loads server progress on login and merges it into the client stores.
 *  2. Saves client-only data to the server's stats JSON blob on key events.
 *  3. Exposes `syncToServer()` so callers can flush whenever something important changes.
 *  4. Exposes `CLIENT_KEYS` + `clearAllProgressionStorage()` so the logout
 *     path (gameStore.logout) can wipe every progression-cache key in a
 *     single place — preventing a shared-device leak between accounts.
 */

import { getSocket } from './socketService';
import { useProgressStore } from '../store/progressStore';
import { useGameStore } from '../store/gameStore';

// Keys stored inside the server's `stats` JSON blob. Exported so the
// logout path can iterate them when clearing progression cache — keeps
// the list single-sourced.
export const CLIENT_KEYS = [
  'app_poker_career',        // career mode progress
  'app_poker_missions',      // daily/weekly mission state
  'app_bp_claimed',          // battle pass claimed tiers
  'app_bp_premium',          // whether premium was purchased
  'app_poker_player_notes',  // opponent notes + color tags
  'app_poker_settings',      // color blind mode, quick showdown, etc.
  'app_poker_betSizes',      // favourite bet sizes
  'app_poker_autoRebuy',
  'app_poker_runItTwice',
  'app_poker_autoDeal',
  'app_poker_sfxVol',
];

let _lastSyncHash = '';
let _syncTimer = null;

/** Collect all client-only keys from sessionStorage into one object. */
function collectClientData() {
  const data = {};
  for (const key of CLIENT_KEYS) {
    const val = sessionStorage.getItem(key);
    if (val !== null) data[key] = val;
  }
  return data;
}

/** Restore client-only keys from the server-saved blob. */
function restoreClientData(blob) {
  if (!blob || typeof blob !== 'object') return;
  for (const key of CLIENT_KEYS) {
    if (blob[key] !== undefined && sessionStorage.getItem(key) === null) {
      // Only restore if key is absent locally (don't overwrite newer local data)
      sessionStorage.setItem(key, blob[key]);
    }
  }
}

/**
 * Called once after login. Merges server progress into client state.
 */
export function initPersistence(serverProgress) {
  if (!serverProgress) return;

  // Restore client-only data from the server's stats blob
  if (serverProgress.stats?.clientData) {
    restoreClientData(serverProgress.stats.clientData);
  }

  // Push server progress into the store (chips, xp, level, achievements)
  useProgressStore.getState().setProgress(serverProgress);
}

/**
 * Sync client-only data up to the server.
 * Debounced — multiple rapid calls collapse to one flush after 2s.
 */
export function syncToServer() {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(_doSync, 2000);
}

/** Immediate sync — use sparingly (on logout, beforeunload). */
export function syncToServerNow() {
  if (_syncTimer) { clearTimeout(_syncTimer); _syncTimer = null; }
  _doSync();
}

function _doSync() {
  const socket = getSocket();
  if (!socket?.connected) return;

  const progress = useProgressStore.getState().progress;
  if (!progress?.id && !useGameStore.getState().isLoggedIn) return;
  // 2026-04-22 audit — fresh-init clobber gate. Never sync before the
  // server has hydrated the progress store. A pre-hydrate sync would
  // persist default client state (chips=5000, level=1, stars=0) into
  // the server's stats blob before the real values arrive.
  if (progress.hydrated !== true) return;

  const clientData = collectClientData();
  const hash = JSON.stringify(clientData);
  if (hash === _lastSyncHash) return; // nothing changed
  _lastSyncHash = hash;

  // Merge into stats blob
  const currentStats = progress?.stats || {};
  socket.emit('saveProgress', {
    stats: { ...currentStats, clientData },
  });
}

/**
 * Reset module-level sync caches. Called from `gameStore.logout` so the
 * next logged-in user starts with a clean `_lastSyncHash` — otherwise a
 * new account could silently skip its first sync because the dedupe
 * hash still matched the previous account's clientData snapshot.
 * 2026-04-22 audit — shared-device progression leak mitigation.
 */
export function resetSyncState() {
  _lastSyncHash = '';
  if (_syncTimer) {
    clearTimeout(_syncTimer);
    _syncTimer = null;
  }
}

/**
 * Wipe every progression-cache key this client writes to sessionStorage.
 * Called from `gameStore.logout` so user B on a shared device doesn't
 * inherit user A's career / missions / BP / settings / notes / bet-size
 * cache. The list is sourced from `CLIENT_KEYS` (server-synced blob
 * keys) plus the additional non-blob progression keys that live only on
 * the client. Keep this in sync with gameStore.logout — single source
 * of truth is here.
 * 2026-04-22 audit — shared-device progression leak.
 */
export const EXTRA_PROGRESSION_KEYS = [
  'poker_player_progress',  // cached progressStore snapshot
];

export function clearAllProgressionStorage() {
  const allKeys = [...CLIENT_KEYS, ...EXTRA_PROGRESSION_KEYS];
  for (const key of allKeys) {
    try { sessionStorage.removeItem(key); } catch {}
  }
}

/**
 * Install flush-to-server handlers that fire on tab close OR background/hide.
 *
 * PWA audit #8: iOS PWAs don't fire `beforeunload` when the app is
 * suspended/killed from the app switcher — so a beforeunload-only
 * sync loses any progression not yet flushed. Use `pagehide` and
 * `visibilitychange` (which fire on background in iOS/Android PWAs)
 * as the primary triggers; `beforeunload` stays as a desktop
 * fallback. Returns a combined unsubscribe.
 */
export function installBeforeUnloadSync() {
  const handler = syncToServerNow;
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') syncToServerNow();
  };
  window.addEventListener('beforeunload', handler);
  window.addEventListener('pagehide', handler);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('beforeunload', handler);
    window.removeEventListener('pagehide', handler);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
