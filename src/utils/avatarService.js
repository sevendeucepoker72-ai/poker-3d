/**
 * Avatar Service — fetches player profile photos from the master API
 * and caches them in memory + sessionStorage for fast access.
 *
 * Usage:
 *   import { getAvatarUrl, preloadAvatar } from '../utils/avatarService';
 *   const url = getAvatarUrl(playerId); // returns cached URL or null
 *   preloadAvatar(playerId); // async fetch and cache
 */

const MASTER_API = 'https://poker-prod-api-azeg4kcklq-uc.a.run.app/poker-api';
const CACHE_KEY = 'poker-avatar-cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// In-memory cache: playerId -> { url, fetchedAt }
let memCache = {};

// Load from sessionStorage on init
try {
  const stored = sessionStorage.getItem(CACHE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    // Prune expired entries
    const now = Date.now();
    for (const [id, entry] of Object.entries(parsed)) {
      if (now - entry.fetchedAt < CACHE_TTL) {
        memCache[id] = entry;
      }
    }
  }
} catch { /* ignore */ }

function saveToStorage() {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(memCache));
  } catch { /* ignore */ }
}

// Pending fetches to avoid duplicate requests
const pending = new Map();

/**
 * Get cached avatar URL for a player. Returns null if not cached.
 * Call preloadAvatar() to fetch it.
 */
export function getAvatarUrl(playerId) {
  if (!playerId) return null;
  const entry = memCache[playerId];
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) {
    return entry.url;
  }
  return null;
}

/**
 * Fetch and cache avatar URL for a player.
 * Returns the URL or null if no avatar.
 */
export async function preloadAvatar(playerId) {
  if (!playerId) return null;

  // Already cached?
  const cached = getAvatarUrl(playerId);
  if (cached !== null) return cached;

  // Already fetching?
  if (pending.has(playerId)) return pending.get(playerId);

  const promise = (async () => {
    try {
      const res = await fetch(`${MASTER_API}/users/${playerId}/profile`);
      if (!res.ok) return null;
      const data = await res.json();
      const profile = data.data?.profile;
      if (profile?.avatarUrl) {
        const url = `${MASTER_API}${profile.avatarUrl}`;
        memCache[playerId] = { url, fetchedAt: Date.now() };
        saveToStorage();
        return url;
      }
      // No avatar — cache null to avoid re-fetching
      memCache[playerId] = { url: '', fetchedAt: Date.now() };
      saveToStorage();
      return '';
    } catch {
      return null;
    } finally {
      pending.delete(playerId);
    }
  })();

  pending.set(playerId, promise);
  return promise;
}

/**
 * Preload avatars for multiple players at once.
 */
export function preloadAvatars(playerIds) {
  for (const id of playerIds) {
    if (id && !getAvatarUrl(id)) {
      preloadAvatar(id);
    }
  }
}

/**
 * React hook-friendly: get avatar URL with auto-fetch.
 * Returns url string or null.
 */
export function useAvatar(playerId) {
  // This is a simple sync getter — for React, use the hook in avatarHook.js
  return getAvatarUrl(playerId);
}
