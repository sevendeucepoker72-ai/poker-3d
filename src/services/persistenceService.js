/**
 * persistenceService — bidirectional sync between localStorage and the server.
 *
 * The server is the source of truth for chips/xp/level/achievements.
 * localStorage holds: career progress, mission state, battle pass claims,
 * settings, notes, etc.
 *
 * This service:
 *  1. Loads server progress on login and merges it into the client stores.
 *  2. Saves client-only data to the server's stats JSON blob on key events.
 *  3. Exposes `syncToServer()` so callers can flush whenever something important changes.
 */

import { getSocket } from './socketService';
import { useProgressStore } from '../store/progressStore';
import { useGameStore } from '../store/gameStore';

// Keys stored inside the server's `stats` JSON blob
const CLIENT_KEYS = [
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

/** Collect all client-only keys from localStorage into one object. */
function collectClientData() {
  const data = {};
  for (const key of CLIENT_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) data[key] = val;
  }
  return data;
}

/** Restore client-only keys from the server-saved blob. */
function restoreClientData(blob) {
  if (!blob || typeof blob !== 'object') return;
  for (const key of CLIENT_KEYS) {
    if (blob[key] !== undefined && localStorage.getItem(key) === null) {
      // Only restore if key is absent locally (don't overwrite newer local data)
      localStorage.setItem(key, blob[key]);
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

/** Install a beforeunload handler so we flush on tab close. */
export function installBeforeUnloadSync() {
  window.addEventListener('beforeunload', syncToServerNow);
}
