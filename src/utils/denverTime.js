/**
 * The economy's calendar on the client (2026-10-11, .online R2 — C5 / C6 /
 * C8 / C9 / APPUI-36).
 *
 * Every "once per day / per month" thing the server lets a player claim — the
 * daily login reward and its streak, the daily spin, the daily missions, the
 * VIP monthly bonus, the monthly season — runs on the America/Denver calendar
 * (poker-server `user_daily_claims.claim_date` is the Denver date). The lobby
 * used to compare the server's dates with the BROWSER's local date (or UTC),
 * so an evening player saw "Daily Bonus Ready!" for a reward the server
 * refused as already claimed, and the "resets in" timers were wrong.
 *
 * Pure functions on epoch milliseconds (Intl, DST-correct, no dependencies).
 */

export const ECONOMY_TIME_ZONE = 'America/Denver';

let partsFormatter = null;
function formatter() {
  if (!partsFormatter) {
    partsFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ECONOMY_TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  return partsFormatter;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Wall-clock fields of `ms` in Denver. */
export function denverParts(ms = Date.now()) {
  const out = {};
  for (const p of formatter().formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, hh: out.hour % 24, mm: out.minute, ss: out.second };
}

/** 'YYYY-MM-DD' — the Denver calendar date of `ms` (what the server's claim ledger uses). */
export function denverDateKey(ms = Date.now()) {
  const p = denverParts(ms);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/** 'YYYY-MM' — the Denver calendar month of `ms` (the season / VIP-monthly key). */
export function denverMonthKey(ms = Date.now()) {
  const p = denverParts(ms);
  return `${p.y}-${pad2(p.m)}`;
}

function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** `key` ± `days` on the calendar ('2026-03-01' - 1 = '2026-02-28'). */
export function addDaysToDateKey(key, days) {
  const p = parseDateKey(key);
  if (!p) return key;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Offset of Denver from UTC at `ms`, in ms (negative: -6h MDT / -7h MST). */
function denverOffsetMs(ms) {
  const p = denverParts(ms);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of the Denver wall-clock time y-m-d hh:mm (DST-correct). */
export function denverWallTimeToMs(y, m, d, hh = 0, mm = 0) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let ms = guess - denverOffsetMs(guess);
  ms = guess - denverOffsetMs(ms); // settle the offset on DST-transition days
  return ms;
}

/** Epoch ms of the next Denver midnight after `ms` (when a daily claim reopens). */
export function nextDenverMidnightMs(ms = Date.now()) {
  const t = parseDateKey(addDaysToDateKey(denverDateKey(ms), 1));
  return denverWallTimeToMs(t.y, t.m, t.d);
}

/** Epoch ms of 00:00 Denver on the first day of the month after `ms` (season end). */
export function nextDenverMonthStartMs(ms = Date.now()) {
  const p = denverParts(ms);
  const y = p.m === 12 ? p.y + 1 : p.y;
  const m = p.m === 12 ? 1 : p.m + 1;
  return denverWallTimeToMs(y, m, 1);
}

/** A normalised server date ('YYYY-MM-DD…' / ISO string / Date) → 'YYYY-MM-DD', else null. */
export function dateKeyOf(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return m ? m[1] : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return null;
}

/** "5h 12m" / "12m" / "45s" — a short countdown to `targetMs` (never negative). */
export function formatCountdown(targetMs, nowMs = Date.now()) {
  const left = Math.max(0, Number(targetMs) - nowMs);
  if (!Number.isFinite(left)) return '';
  const days = Math.floor(left / 86400000);
  const hours = Math.floor((left % 86400000) / 3600000);
  const mins = Math.floor((left % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${Math.max(0, Math.floor(left / 1000))}s`;
}

/** A server timestamp (ms number, numeric string or ISO string) → epoch ms, else null. */
export function toEpochMs(value) {
  if (value == null || value === '' || value === 0) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === 'string') {
    if (/^\d+$/.test(value.trim())) {
      const n = Number(value.trim());
      return n > 0 ? n : null;
    }
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
