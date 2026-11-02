/**
 * The tournament clock on the PROGRAM timeline (lead spec C3, 2026-11-02).
 *
 * ProgramState.clock is the tournamentClock object exactly as poker-server's
 * tournamentClockStateFor builds it (level, levels, sb, bb, ante, next,
 * levelEndsAt, serverNow, paused, pauseReason, breakUntil, dealsAt,
 * playersLeft, entries, avgStack, paidPlaces, levelDurationMs,
 * levelRemainingMs (frozen while paused), resumesAt, + handForHand* while
 * engaged), captured at the program's time. On a delayed feed every one of
 * those instants is a LIVE server time, and the page's `programNow` is the
 * server clock minus the delay; so the countdown is simply "instant minus
 * programNow" — utils/tournamentClock.levelRemainingMs with programNow as the
 * clock and no skew. A 5-minute delayed stream shows the level the viewers
 * are watching, never the live one (no spoiler).
 *
 * Pure (no React, no Date.now): the scenes and node:test pass programNow.
 */
import {
  normalizeTournamentClock, levelRemainingMs, formatClock, levelBarFraction,
} from '../../utils/tournamentClock.js';
import { formatChips } from './tableFormat.js';

/** "200/400 · ante 50" (the on-air blinds, chips only). */
export function blindsLabel(b) {
  if (!b || !Number.isFinite(b.bb) || b.bb <= 0) return '';
  const ante = Number.isFinite(b.ante) && b.ante > 0 ? ` · ante ${formatChips(b.ante)}` : '';
  return `${formatChips(b.sb || 0)}/${formatChips(b.bb)}${ante}`;
}

/** Blue, then gold (last quarter / 3 min), then amber (last minute). Never red. */
export function clockTone(remainingMs, durationMs) {
  if (!Number.isFinite(remainingMs)) return 'blue';
  if (remainingMs <= 60 * 1000) return 'amber';
  const goldFrom = Math.max(2 * 60 * 1000, Number.isFinite(durationMs) && durationMs > 0 ? durationMs * 0.25 : 3 * 60 * 1000);
  return remainingMs <= goldFrom ? 'gold' : 'blue';
}

function untilMs(at, programNow) {
  if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(programNow)) return null;
  return Math.max(0, at - programNow);
}

/**
 * The clock as the program shows it at `programNow`, or null when the program
 * has no clock (a Sit & Go before it starts, an older server, a bad value):
 * {level, levels, sb, bb, ante, next, paused, pauseReason, remainingMs,
 *  clockText, tone, barFraction, levelLabel, blindsText, nextText, atTop,
 *  resumesAt, resumesInMs, dealsAt, dealsInMs, handForHand, handForHandRound}
 */
export function programClock(program, programNow) {
  const raw = program && typeof program === 'object' ? program.clock : null;
  if (!raw || typeof raw !== 'object') return null;
  // The program's clock has no receipt / skew: the instants are server times.
  const c = normalizeTournamentClock({ ...raw, receivedAt: null, skewMs: null });
  if (!c || !c.bb) return null;
  const remainingMs = Number.isFinite(programNow) ? levelRemainingMs(c, programNow, 0) : (c.paused ? c.frozenRemainingMs : null);
  const atTop = !!(c.levels && c.level && c.level >= c.levels);
  const resumesAt = c.resumesAt || (Number.isFinite(raw.breakUntil) ? raw.breakUntil : null);
  let nextText = '';
  if (atTop) nextText = 'Final level';
  else if (c.next && c.next.bb) nextText = `Next ${blindsLabel(c.next)}`;
  return {
    level: c.level,
    levels: c.levels,
    sb: c.sb,
    bb: c.bb,
    ante: c.ante || 0,
    next: c.next,
    atTop,
    paused: !!c.paused,
    pauseReason: c.pauseReason,
    remainingMs: remainingMs === null || remainingMs === undefined ? null : remainingMs,
    clockText: remainingMs === null || remainingMs === undefined ? '' : formatClock(remainingMs),
    tone: clockTone(remainingMs, c.durationMs),
    barFraction: levelBarFraction(c, remainingMs),
    levelLabel: c.level ? (c.levels ? `Level ${c.level} of ${c.levels}` : `Level ${c.level}`) : '',
    blindsText: blindsLabel(c),
    nextText,
    resumesAt: resumesAt || null,
    resumesInMs: untilMs(resumesAt, programNow),
    dealsAt: c.dealsAt || null,
    dealsInMs: untilMs(c.dealsAt, programNow),
    handForHand: raw.handForHand === true,
    handForHandRound: Number.isInteger(raw.handForHandRound) ? raw.handForHandRound : null,
  };
}

/**
 * The bar's status word while the clock is held: 'BREAK' | 'STARTS SOON' |
 * 'PAUSED' | 'ON HOLD', '' while it runs.
 */
export function clockStatusWord(pc) {
  if (!pc || !pc.paused) return '';
  if (pc.pauseReason === 'break') return 'BREAK';
  if (pc.pauseReason === 'prestart') return 'STARTS SOON';
  if (pc.pauseReason === 'held') return 'ON HOLD';
  return 'PAUSED';
}

/** m:ss / h:mm:ss until `at` on the program clock, '' without one. */
export function countdownText(at, programNow) {
  const ms = untilMs(at, programNow);
  return ms === null ? '' : formatClock(ms);
}
