/**
 * The tournament clock as the table HUD shows it (2026-10-22, owner: "run the
 * blinds and raise them, take breaks, ... start the game on time").
 *
 * poker-server MAY stamp every gameState of a tournament table with an
 * OPTIONAL `tournamentClock` object (null on a cash table — the delta merge
 * clears it). Every field is optional; anything not sent is not shown:
 *   level, levels            — the current level (1-based) and the level count
 *   sb, bb, ante             — the blinds in play
 *   next {sb, bb, ante}      — the next level's blinds (absent / null at the top)
 *   levelEndsAt              — when the current level ends (epoch ms or ISO)
 *   levelDurationMs          — the level's length (also `durationMs` /
 *                              `duration`; a value <= 7200 is read as seconds)
 *   levelRemainingMs         — the frozen time left while the clock is paused
 *   serverNow                — the server's clock when the frame was built
 *   paused                   — true (or the reason string) while no cards are dealt
 *   pauseReason              — 'prestart' | 'break' | 'director' (also `reason`)
 *   dealsAt                  — prestart: when the first cards are dealt
 *   resumesAt                — break: when play resumes
 *   playersLeft, entries, avgStack, paidPlaces — the standings line
 * The client adds `receivedAt` (its own clock when the frame carrying this
 * clock arrived — stampTournamentClockReceipt) and `skewMs` so the countdown
 * ticks locally: skew = receivedAt - serverNow (the smallest of the recent
 * frames), server time = Date.now() - skew.
 *
 * An older server sends none of it: the HUD keeps its old widgets.
 * Pure module (no React): GameHUD, App.jsx's toasts and the node probes.
 */

import { toEpochMs } from './denverTime.js';
import { formatDenverTime } from './qualifierList.js';

// Owner rule: blue + gold, no red. The bar runs blue, then gold, then amber.
export const CLOCK_BLUE = '#60a5fa';
export const CLOCK_GOLD = '#ffd24a';
export const CLOCK_AMBER = '#f59e0b';

function num(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function posInt(v) {
  const n = num(v);
  return n != null && n > 0 ? Math.floor(n) : null;
}

function nonNegInt(v) {
  const n = num(v);
  return n != null && n >= 0 ? Math.floor(n) : null;
}

/** A level length: ms, or seconds when small (no real level is <= 2 h in ms). */
function durationToMs(v) {
  const n = num(v);
  if (n == null || n <= 0) return null;
  return n <= 7200 ? Math.round(n * 1000) : Math.round(n);
}

function normalizeBlinds(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const bb = nonNegInt(raw.bb ?? raw.bigBlind);
  if (!bb) return null;
  return {
    sb: nonNegInt(raw.sb ?? raw.smallBlind) ?? 0,
    bb,
    ante: nonNegInt(raw.ante) ?? 0,
  };
}

const PRESTART_REASONS = new Set(['prestart', 'pre_start', 'pre-start', 'waiting_start', 'start', 'scheduled', 'held']);
const BREAK_REASONS = new Set(['break', 'scheduled_break', 'level_break']);
const DIRECTOR_REASONS = new Set(['director', 'td', 'admin', 'manual', 'paused']);

function normalizeReason(v) {
  const r = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!r) return null;
  if (PRESTART_REASONS.has(r)) return 'prestart';
  if (BREAK_REASONS.has(r)) return 'break';
  if (DIRECTOR_REASONS.has(r)) return 'director';
  return null;
}

/**
 * The server's `tournamentClock` → a plain model, or null when there is none
 * (a cash table, an older server, a malformed value). Never throws.
 */
export function normalizeTournamentClock(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const blinds = normalizeBlinds(raw.blinds && typeof raw.blinds === 'object' ? { ...raw.blinds, ...raw } : raw);
  const levels = posInt(raw.levels ?? raw.levelCount ?? raw.totalLevels);
  const level = posInt(raw.level ?? raw.blindLevel);
  const pausedFlag = raw.paused === true || (typeof raw.paused === 'string' && raw.paused.trim() !== '');
  const dealsAt = toEpochMs(raw.dealsAt);
  const resumesAt = toEpochMs(raw.resumesAt);
  let pauseReason = null;
  if (pausedFlag) {
    pauseReason = normalizeReason(typeof raw.paused === 'string' ? raw.paused : null)
      || normalizeReason(raw.pauseReason ?? raw.reason)
      || (dealsAt ? 'prestart' : (resumesAt ? 'break' : 'director'));
  }
  const next = normalizeBlinds(raw.next ?? raw.nextLevel);
  return {
    level,
    levels,
    sb: blinds ? blinds.sb : null,
    bb: blinds ? blinds.bb : null,
    ante: blinds ? blinds.ante : 0,
    next,
    levelEndsAt: toEpochMs(raw.levelEndsAt),
    durationMs: durationToMs(raw.levelDurationMs ?? raw.durationMs ?? raw.duration),
    frozenRemainingMs: nonNegInt(raw.levelRemainingMs ?? raw.remainingMs),
    serverNow: toEpochMs(raw.serverNow),
    receivedAt: toEpochMs(raw.receivedAt),
    skewMs: num(raw.skewMs),
    paused: pausedFlag,
    pauseReason,
    dealsAt,
    resumesAt,
    playersLeft: nonNegInt(raw.playersLeft ?? raw.alivePlayers),
    entries: posInt(raw.entries ?? raw.totalEntries),
    avgStack: posInt(raw.avgStack ?? raw.averageStack),
    paidPlaces: posInt(raw.paidPlaces ?? raw.seatsForTop),
  };
}

// The smallest (receipt - serverNow) over the last clock frames = the clock
// offset plus the SHORTEST delivery delay: one slow frame does not make the
// countdown jump back a second (the same filter as timerStore's envelope skew).
const SKEW_SAMPLES = 10;
const MAX_SKEW_MS = 6 * 60 * 60 * 1000; // a frame hours off is not a clock offset
const skewSamples = [];

/**
 * Stamps the LOCAL receipt time on a frame's tournamentClock (App.jsx, the
 * gameState handler — not render): `receivedAt`, and `skewMs` (the filtered
 * local - server offset) when the clock carries serverNow. Only a clock this
 * frame brought: a merged delta that did not carry one keeps the earlier
 * object and its stamp. Returns the state (its tournamentClock replaced by a copy).
 */
export function stampTournamentClockReceipt(state, now = Date.now()) {
  if (!state || typeof state !== 'object') return state;
  const c = state.tournamentClock;
  if (!c || typeof c !== 'object' || Array.isArray(c) || c.receivedAt != null) return state;
  const stamped = { ...c, receivedAt: now };
  const sn = toEpochMs(c.serverNow);
  if (sn) {
    const s = now - sn;
    if (Math.abs(s) <= MAX_SKEW_MS) {
      skewSamples.push(s);
      if (skewSamples.length > SKEW_SAMPLES) skewSamples.shift();
      stamped.skewMs = Math.min(...skewSamples);
    }
  }
  state.tournamentClock = stamped;
  return state;
}

/**
 * local clock - server clock for this clock frame: the receipt stamp's
 * filtered offset, else its own serverNow against its receipt time, else the
 * gameState-envelope estimate (`fallbackSkewMs`, timerStore.clockSkewMs), else 0.
 */
export function clockSkewMs(clock, fallbackSkewMs = 0) {
  if (clock && clock.skewMs != null && Math.abs(clock.skewMs) <= MAX_SKEW_MS) return clock.skewMs;
  if (clock && clock.serverNow && clock.receivedAt) {
    const s = clock.receivedAt - clock.serverNow;
    if (Math.abs(s) <= MAX_SKEW_MS) return s;
  }
  const f = Number(fallbackSkewMs);
  return Number.isFinite(f) ? f : 0;
}

/** ms left in the level (null when unknown). Frozen while paused. */
export function levelRemainingMs(clock, localNow = Date.now(), skewMs = 0) {
  if (!clock) return null;
  if (clock.paused) {
    if (clock.frozenRemainingMs != null) return clock.frozenRemainingMs;
    // Before the start the first level has not begun: it is all still to come.
    if (clock.pauseReason === 'prestart' && clock.durationMs) return clock.durationMs;
    return null;
  }
  if (!clock.levelEndsAt) return null;
  return Math.max(0, clock.levelEndsAt - (localNow - skewMs));
}

/** ms until a server instant (dealsAt / resumesAt), never negative; null without one. */
export function msUntil(serverMs, localNow = Date.now(), skewMs = 0) {
  if (!serverMs) return null;
  return Math.max(0, serverMs - (localNow - skewMs));
}

/** "11:42" / "0:07" / "1:05:00" — whole seconds rounded UP (0 only at the end). */
export function formatClock(msLeft) {
  const n = Number(msLeft);
  if (!Number.isFinite(n)) return '';
  const total = Math.max(0, Math.ceil(n / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The old widget's seconds (gameState.nextBlindIn) as m:ss — "Next in 8:32". */
export function formatSecondsClock(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return '';
  return formatClock(n * 1000);
}

/** Bar fill 0..1 (remaining / level length); null when either is unknown. */
export function levelBarFraction(clock, remainingMs) {
  if (!clock || remainingMs == null || !clock.durationMs) return null;
  return Math.max(0, Math.min(1, remainingMs / clock.durationMs));
}

/** Blue, then gold (last quarter / 3 min), then amber (last minute). Never red. */
export function levelBarColor(remainingMs, durationMs) {
  if (remainingMs == null) return CLOCK_BLUE;
  if (remainingMs <= 60 * 1000) return CLOCK_AMBER;
  const goldFrom = Math.max(2 * 60 * 1000, durationMs ? durationMs * 0.25 : 3 * 60 * 1000);
  if (remainingMs <= goldFrom) return CLOCK_GOLD;
  return CLOCK_BLUE;
}

const chipsFmt = (n) => Number(n).toLocaleString('en-US');

/** "100/200 · ante 25" */
export function blindsText(b) {
  if (!b || !b.bb) return '';
  return `${chipsFmt(b.sb)}/${chipsFmt(b.bb)}${b.ante ? ` · ante ${chipsFmt(b.ante)}` : ''}`;
}

/**
 * The strip's line: "Level 3/26 · 100/200 · ante 25 · next 150/300 in 11:42".
 * Paused: the frozen time (or what holds it); the top level: "final level".
 * '' when the clock has no blinds to show.
 */
export function clockStripText(clock, remainingMs) {
  if (!clock || !clock.bb) return '';
  const parts = [];
  if (clock.level) parts.push(clock.levels ? `Level ${clock.level}/${clock.levels}` : `Level ${clock.level}`);
  parts.push(blindsText(clock));
  const atTop = !clock.next || (clock.levels && clock.level && clock.level >= clock.levels);
  const clockText = remainingMs != null ? formatClock(remainingMs) : '';
  if (atTop) {
    parts.push('final level');
  } else if (clockText) {
    parts.push(`next ${chipsFmt(clock.next.sb)}/${chipsFmt(clock.next.bb)} in ${clockText}`);
  } else {
    parts.push(`next ${chipsFmt(clock.next.sb)}/${chipsFmt(clock.next.bb)}`);
  }
  if (clock.paused) {
    // Prestart: the held-table banner names the start time and counts down.
    if (clock.pauseReason === 'prestart') parts.push('not started');
    else if (clock.pauseReason === 'break') parts.push('on break');
    else parts.push('clock paused');
  }
  return parts.join(' · ');
}

/**
 * The standings line, as parts so the HUD can drop "avg" on a narrow screen:
 * { left: "12 left of 45", avg: "avg 187,500", paid: "top 10 win seats" }
 * (each null when not sent); null when there is nothing to show.
 */
export function standingsParts(clock) {
  if (!clock) return null;
  const left = clock.playersLeft != null
    ? (clock.entries ? `${chipsFmt(clock.playersLeft)} left of ${chipsFmt(clock.entries)}` : `${chipsFmt(clock.playersLeft)} left`)
    : null;
  const avg = clock.avgStack ? `avg ${chipsFmt(clock.avgStack)}` : null;
  const paid = clock.paidPlaces ? `top ${chipsFmt(clock.paidPlaces)} win seats` : null;
  if (!left && !avg && !paid) return null;
  return { left, avg, paid };
}

/** The whole standings line as one string ('' when none). */
export function standingsText(clock) {
  const p = standingsParts(clock);
  return p ? [p.left, p.avg, p.paid].filter(Boolean).join(' · ') : '';
}

export const TOURNAMENT_DIRECTOR_PAUSE_TEXT = 'Paused by the tournament director';
export const TOURNAMENT_DIRECTOR_PAUSE_TOAST = 'Play paused by the tournament director';
export const TOURNAMENT_RESUMED_TOAST = 'Play resumed';

/** "Break — play resumes at 1:05 PM MT" (the toast and the banner's head). */
export function breakResumesText(resumesAt) {
  const t = formatDenverTime(resumesAt);
  return t ? `Break — play resumes at ${t}` : 'Break — play resumes shortly';
}

/**
 * The waiting area while a tournament table is held (no cards dealt):
 * { kind: 'prestart' | 'break' | 'director', text, countdownTo } or null.
 * `countdownTo` is the server instant the HUD counts down to (m:ss), if any.
 */
export function heldBannerFor(clock) {
  if (!clock || !clock.paused) return null;
  if (clock.pauseReason === 'prestart') {
    const t = formatDenverTime(clock.dealsAt);
    return { kind: 'prestart', text: t ? `Cards are dealt at ${t}` : 'Cards are dealt when the tournament starts', countdownTo: clock.dealsAt || null };
  }
  if (clock.pauseReason === 'break') {
    return { kind: 'break', text: breakResumesText(clock.resumesAt), countdownTo: clock.resumesAt || null };
  }
  return { kind: 'director', text: TOURNAMENT_DIRECTOR_PAUSE_TEXT, countdownTo: null };
}

/**
 * The 'tournamentPaused' toast: a break with its resume time, else the
 * director's pause; null for a prestart hold (the table banner says it).
 */
export function tournamentPausedToastText(data) {
  const reason = normalizeReason(data?.reason ?? data?.pauseReason);
  if (reason === 'prestart') return null;
  const resumesAt = toEpochMs(data?.resumesAt);
  if (reason === 'break') return breakResumesText(resumesAt);
  if (!reason && resumesAt) return breakResumesText(resumesAt);
  return TOURNAMENT_DIRECTOR_PAUSE_TOAST;
}

/** "Blind Level Up — Level 4: 150/300 · ante 25" (an older server: no level → "Blind Level Up: 150/300"). */
export function blindLevelUpText(data) {
  const b = normalizeBlinds(data);
  const blinds = b ? blindsText(b) : `${data?.sb ?? '?'}/${data?.bb ?? '?'}`;
  const level = posInt(data?.level);
  return level ? `Blind Level Up — Level ${level}: ${blinds}` : `Blind Level Up: ${blinds}`;
}
