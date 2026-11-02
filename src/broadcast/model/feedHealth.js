/**
 * Broadcast feed health (lead spec R9, 2026-11-01): the server sends
 * `bc:heartbeat` every 2 s. No heartbeat for more than 6 s turns the page
 * AMBER ('Reconnecting'); more than 15 s is STALE and the page shows the slate.
 * Coming back needs 2 good heartbeats in a row (hysteresis), so a flapping
 * link does not flip the scene back and forth on air.
 *
 * Pure: the caller passes local time. Never red: ok = blue/gold, amber, stale = slate.
 */
export const AMBER_AFTER_MS = 6000;
export const STALE_AFTER_MS = 15000;
export const GOOD_BEATS_TO_RECOVER = 2;

export function initialFeedHealth() {
  // 'connecting' until the first heartbeat or snapshot arrives.
  return { status: 'connecting', lastBeatAt: null, goodBeats: 0 };
}

/** Level of a silence of `ageMs`: 'ok' | 'amber' | 'stale'. */
export function levelForAge(ageMs) {
  if (!Number.isFinite(ageMs)) return 'stale';
  if (ageMs > STALE_AFTER_MS) return 'stale';
  if (ageMs > AMBER_AFTER_MS) return 'amber';
  return 'ok';
}

/**
 * A heartbeat (or snapshot) arrived at `now`. A beat counts as GOOD when it
 * follows the previous one within the amber threshold.
 */
export function onBeat(health, now) {
  const gapOk = health.lastBeatAt !== null && now - health.lastBeatAt <= AMBER_AFTER_MS;
  if (health.status === 'connecting') {
    return { status: 'ok', lastBeatAt: now, goodBeats: GOOD_BEATS_TO_RECOVER };
  }
  if (health.status === 'ok') return { status: 'ok', lastBeatAt: now, goodBeats: GOOD_BEATS_TO_RECOVER };
  // Recovering from amber / stale.
  const goodBeats = gapOk ? health.goodBeats + 1 : 1;
  const status = goodBeats >= GOOD_BEATS_TO_RECOVER ? 'ok' : health.status;
  return { status, lastBeatAt: now, goodBeats };
}

/** Re-evaluate on a timer tick: silence only ever makes it worse here. */
export function evaluateFeedHealth(health, now) {
  if (health.status === 'connecting') {
    return health;
  }
  const level = levelForAge(now - health.lastBeatAt);
  const rank = { ok: 0, amber: 1, stale: 2 };
  if (rank[level] > rank[health.status]) return { ...health, status: level, goodBeats: 0 };
  return health;
}

/** Milliseconds since the last beat (Infinity before the first). */
export function feedAgeMs(health, now) {
  return health.lastBeatAt === null ? Infinity : Math.max(0, now - health.lastBeatAt);
}

/** True when the page should show the slate for a dead feed. */
export function feedIsStale(health) {
  return health.status === 'stale';
}
