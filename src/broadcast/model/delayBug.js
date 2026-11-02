/**
 * Delay bug text (lead spec P5-C2b, 2026-11-02) — 'Delayed broadcast · 5 min'
 * on every delayed feed, nothing on the public (live) feed. Pure, so the 16:9
 * and 9:16 sources print the same words.
 *
 * Owner 2026-11-02: the hole-card delay is 5 minutes by default and minimum,
 * configurable upward, and any text that names a number of minutes says 5 or
 * reads the configured value. So the minutes come from the live delay (the
 * heartbeat's delayMs, else the feed's), and only a delayed feed whose delay
 * is missing or junk falls back to the 5-minute default: a delayed stream is
 * never shown without its bug.
 */
import { isObj } from './contract.js';

export const DELAY_BUG_TEXT = 'Delayed broadcast';
export const DEFAULT_DELAY_MIN = 5;

/** The whole minutes to print, or null when the bug is not shown (a public feed). */
export function delayBugMinutes(feed, delayMs) {
  if (!isObj(feed) || feed.mode !== 'delayed') return null;
  let ms = DEFAULT_DELAY_MIN * 60000;
  if (Number.isFinite(delayMs) && delayMs > 0) ms = delayMs;
  else if (Number.isFinite(feed.delayMs) && feed.delayMs > 0) ms = feed.delayMs;
  return Math.max(1, Math.round(ms / 60000));
}

/** 'Delayed broadcast · 5 min', or null. */
export function delayBugText(feed, delayMs) {
  const minutes = delayBugMinutes(feed, delayMs);
  return minutes === null ? null : `${DELAY_BUG_TEXT} · ${minutes} min`;
}
