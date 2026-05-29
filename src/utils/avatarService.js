/**
 * Avatar Service — fetches the player's unified avatar display info
 * from the master API and caches it in memory + sessionStorage.
 *
 * 2026-05-29 audit P1-4 fix: switched from /users/:id/profile (auth-
 * gated; returns only avatarUrl for upload-type avatars) to
 * /avatars/display/:userId (public; returns the full unified shape
 * including emoji presets, frame id, etc.). Pre-fix, ~all players in
 * the 3D nameplate showed initials because everyone defaults to a
 * chip-* preset which the old endpoint discarded.
 *
 * Cache shape now: { type, url, emoji, presetId, frameId, fetchedAt }
 * Consumers (useAvatar hook + PlayerAvatar component) render emoji
 * spans when no url, falling through to initials only when neither
 * is set.
 *
 * Usage:
 *   import { getAvatarInfo, preloadAvatar } from '../utils/avatarService';
 *   const info = getAvatarInfo(playerId); // { type, url, emoji, ... } | null
 */

import { getAuthToken } from '../services/tokenStorage';
import { fetchWithTimeout } from './fetchWithTimeout';

const MASTER_API = 'https://poker-prod-api-azeg4kcklq-uc.a.run.app/poker-api';
const CACHE_KEY = 'poker-avatar-cache-v2';  // bumped because shape changed
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
// Avatar fetches are best-effort and should never hang the lobby / UI on
// a stalled mobile network. 8s is tighter than the notification budget
// because nothing visible is blocked on these — we just fall back to
// initials avatars when the fetch times out.
const AVATAR_FETCH_TIMEOUT_MS = 8000;

/**
 * Build request headers with an optional Bearer token pulled from
 * tokenStorage. The master API gates `/users/*` reads behind auth, so
 * anonymous fetches will 401 and leave avatars blank. We fetch the token
 * per-call (not once at module load) so the freshest value is used — the
 * OIDC login flow can write it mid-session.
 */
function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// In-memory cache: playerId -> { type, url, emoji, presetId, frameId, fetchedAt }
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
 * Get cached avatar info for a player. Returns null if not cached.
 * Call preloadAvatar() to fetch it.
 *
 * Shape: { type: 'upload'|'preset'|'initials'|null,
 *          url: string|null,    // absolute URL when type='upload'
 *          emoji: string|null,  // when type='preset'
 *          presetId: string|null,
 *          frameId: string|null }
 */
export function getAvatarInfo(playerId) {
  if (!playerId) return null;
  const entry = memCache[playerId];
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) {
    return entry;
  }
  return null;
}

/**
 * Backward-compat alias used by some older call sites. Returns only the
 * URL (or '' when the player has no upload, including users with preset
 * emojis — consumers should migrate to getAvatarInfo to see emoji too).
 */
export function getAvatarUrl(playerId) {
  const info = getAvatarInfo(playerId);
  return info ? (info.url || null) : null;
}

/**
 * Fetch + cache the unified avatar display info for a player.
 * Returns the same shape as getAvatarInfo (or null on error).
 */
export async function preloadAvatar(playerId) {
  if (!playerId) return null;

  const cached = getAvatarInfo(playerId);
  if (cached) return cached;

  if (pending.has(playerId)) return pending.get(playerId);

  const promise = (async () => {
    try {
      // /avatars/display/:userId is unauth and returns the unified
      // shape (type + url|emoji|presetId|frameId). Auth header attached
      // when available so we get fresh data on profile edits, but the
      // call works for anonymous viewers (kiosk-mode .online users).
      const res = await fetchWithTimeout(`${MASTER_API}/avatars/display/${playerId}`, {
        headers: authHeaders(),
      }, AVATAR_FETCH_TIMEOUT_MS);
      if (!res.ok) {
        // Cache a brief negative so we don't hammer the API on 404s.
        const empty = { type: null, url: null, emoji: null, presetId: null, frameId: null, fetchedAt: Date.now() };
        memCache[playerId] = empty;
        saveToStorage();
        return empty;
      }
      const data = await res.json();
      const a = data?.avatar || data?.data?.avatar || {};
      const info = {
        type: a.type || null,
        url: a.url ? (a.url.startsWith('http') ? a.url : `${MASTER_API}${a.url}`) : null,
        emoji: a.emoji || null,
        presetId: a.presetId || null,
        frameId: a.frameId || null,
        fetchedAt: Date.now(),
      };
      memCache[playerId] = info;
      saveToStorage();
      return info;
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
    if (id && !getAvatarInfo(id)) {
      preloadAvatar(id);
    }
  }
}

/**
 * React hook-friendly: get avatar info with auto-fetch.
 * Returns the cached info object (or null when uncached).
 */
export function useAvatar(playerId) {
  // Simple sync getter — for React, use the hook in hooks/useAvatar.jsx.
  return getAvatarInfo(playerId);
}
