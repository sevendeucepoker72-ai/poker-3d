// 2026-10-11 (.online R2 — APPUI-14 / Addendum). Which player a profile,
// friend request or shared link is about — by ID, never by a display name two
// players can share.
//
// poker-server (R2) gives every public row (leaderboard, player search,
// friends list, profile answer) an opaque `publicId` ('p' + 15 hex) instead of
// the account id; a friends-list row also carries the `userId`. `isYou` marks
// the viewer's own row. requestProfile / sendFriendRequest accept
// { publicId } or { userId } (an older server only knew the name).

/** The public id format poker-server issues (economyDb userIdForPublicId). */
export const PUBLIC_ID_RE = /^p[0-9a-f]{15}$/;

export function isPublicId(v) {
  return typeof v === 'string' && PUBLIC_ID_RE.test(v);
}

function positiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A profile target from any public row: the viewer's own row → { own: true };
 * else { publicId, userId, name } with at least one id; null when the row
 * carries no id (it cannot be opened exactly).
 */
export function profileTargetOf(row, name) {
  if (!row || typeof row !== 'object') return null;
  if (row.isYou === true) return { own: true };
  const publicId = isPublicId(row.publicId) ? row.publicId : null;
  const userId = positiveInt(row.userId);
  if (!publicId && userId == null) return null;
  const shown = name ?? row.displayName ?? row.username ?? row.name ?? '';
  return { publicId, userId, name: String(shown) };
}

/** A `?profile=` value → a target: a public id, or a numeric user id from an older link; else null. */
export function profileTargetFromParam(value) {
  const v = String(value ?? '').trim();
  if (isPublicId(v)) return { publicId: v, userId: null, name: '' };
  if (/^[0-9]{1,12}$/.test(v)) {
    const userId = positiveInt(v);
    return userId != null ? { publicId: null, userId, name: '' } : null;
  }
  return null;
}

/** The shareable link of a profile (its public id preferred), or null when it has no id. */
export function profileLink(origin, { publicId, userId } = {}) {
  const id = isPublicId(publicId) ? publicId : positiveInt(userId);
  if (id == null) return null;
  return `${origin}/?profile=${encodeURIComponent(String(id))}`;
}

/**
 * The requestProfile payload for a target: the exact id(s) plus the name (an
 * older server looks a profile up by its exact display name).
 */
export function profileRequestOf(target) {
  if (!target || typeof target !== 'object') return null;
  const req = {};
  if (isPublicId(target.publicId)) req.publicId = target.publicId;
  const userId = positiveInt(target.userId);
  if (userId != null) req.userId = userId;
  const name = typeof target.name === 'string' ? target.name.trim() : '';
  if (name) req.username = name;
  return Object.keys(req).length ? req : null;
}

/** Does a profileData answer belong to the request? (echoed id first, then the name) */
export function profileAnswerMatches(data, req) {
  if (!data || typeof data !== 'object' || !req) return false;
  if (req.publicId) return data.publicId === req.publicId;
  if (req.userId != null) {
    if (data.userId != null) return String(data.userId) === String(req.userId);
    // An older server echoes only the name it looked up.
  }
  return !!req.username && typeof data.username === 'string' && data.username.toLowerCase() === req.username.toLowerCase();
}

/** The sendFriendRequest payload for a target (exact id preferred), or null. */
export function friendRequestOf(target) {
  if (!target || typeof target !== 'object' || target.own) return null;
  if (isPublicId(target.publicId)) return { publicId: target.publicId };
  const userId = positiveInt(target.userId);
  if (userId != null) return { userId };
  return null;
}
