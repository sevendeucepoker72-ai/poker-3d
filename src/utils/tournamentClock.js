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
 *   levelRemainingMs         — the time left in the level at `serverNow`: frozen
 *                              while paused; while running it ticks from
 *                              serverNow (else from the receipt) when no
 *                              levelEndsAt is sent
 *   serverNow                — the server's clock when the frame was built
 *   paused                   — true (or the reason string) while no cards are dealt
 *   pauseReason              — 'prestart' | 'break' | 'director' (also `reason`);
 *                              any other reason is shown as a neutral hold
 *   dealsAt                  — prestart: when the first cards are dealt
 *   resumesAt                — break: when play resumes
 *   playersLeft, entries, avgStack, paidPlaces — the standings line
 * The client adds `receivedAt` (its own clock when the frame carrying this
 * clock arrived — stampTournamentClockReceipt) and `skewMs` so the countdown
 * ticks locally: skew = receivedAt - serverNow (the smallest of the recent
 * frames), server time = Date.now() - skew.
 *
 * Review fix-up (2026-10-22): "final level" only when level >= levels are both
 * sent (an omitted `next` is not the top); a resume EVENT newer than the clock
 * frame ends the held state (resumedClock); the HUD shows the strip only on a
 * table whose gameState says isTournament (a stale merged clock on a cash table
 * never renders).
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

const PRESTART_REASONS = new Set([
  'prestart', 'pre_start', 'pre-start', 'waiting_start', 'start', 'scheduled', 'held',
  'not_started', 'not-started', 'notstarted', 'before_start', 'registering', 'starting',
]);
const BREAK_REASONS = new Set(['break', 'scheduled_break', 'level_break']);
const DIRECTOR_REASONS = new Set(['director', 'td', 'admin', 'manual', 'paused']);
// A `paused` string that means "not paused" (never read as a reason).
const NOT_PAUSED_STRINGS = new Set(['false', '0', 'no', 'off', 'none', 'running', 'resumed']);

function reasonString(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function normalizeReason(v) {
  const r = reasonString(v);
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
  const pausedStr = reasonString(raw.paused);
  const pausedFlag = raw.paused === true || (pausedStr !== '' && !NOT_PAUSED_STRINGS.has(pausedStr));
  const dealsAt = toEpochMs(raw.dealsAt);
  const resumesAt = toEpochMs(raw.resumesAt);
  let pauseReason = null;
  if (pausedFlag) {
    const sentReason = pausedStr !== 'true' ? pausedStr : '';
    const fieldReason = reasonString(raw.pauseReason ?? raw.reason);
    // A reason this client does not know is a neutral 'held' (never the
    // director's pause): only a pause with NO reason is the director's — the
    // one pause an older server sends (pauseTournament).
    pauseReason = normalizeReason(sentReason)
      || normalizeReason(fieldReason)
      || (dealsAt ? 'prestart' : (resumesAt ? 'break' : ((sentReason || fieldReason) ? 'held' : 'director')));
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

/**
 * ms left in the level (null when unknown). Frozen while paused. Running:
 * from levelEndsAt, else from levelRemainingMs counted down from the frame's
 * serverNow (else from its local receipt) — never a number that does not tick.
 */
export function levelRemainingMs(clock, localNow = Date.now(), skewMs = 0) {
  if (!clock) return null;
  if (clock.paused) {
    if (clock.frozenRemainingMs != null) return clock.frozenRemainingMs;
    // Before the start the first level has not begun: it is all still to come.
    if (clock.pauseReason === 'prestart' && clock.durationMs) return clock.durationMs;
    return null;
  }
  if (clock.levelEndsAt) return Math.max(0, clock.levelEndsAt - (localNow - skewMs));
  if (clock.frozenRemainingMs != null) {
    // The level ends at server time serverNow + remaining; server now = localNow - skew.
    if (clock.serverNow) return Math.max(0, clock.serverNow + clock.frozenRemainingMs - (localNow - skewMs));
    if (clock.receivedAt) return Math.max(0, clock.frozenRemainingMs - (localNow - clock.receivedAt));
  }
  return null;
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
 * The strip's line in two parts, so a clipped line (landscape phones) cuts the
 * blinds, never the countdown:
 *   main  "Level 3/26 · 100/200 · ante 25 · next 150/300"
 *   tail  "in 11:42" (+ " · clock paused" …), joined to main by `joiner`
 *         (' ' before "in m:ss", ' · ' before a status word).
 * "final level" only when level >= levels (both sent); an omitted `next`
 * below the top reads "next level in m:ss". Paused: the frozen time (or what
 * holds it). null when the clock has no blinds to show.
 */
export function clockStripParts(clock, remainingMs) {
  if (!clock || !clock.bb) return null;
  const head = [];
  if (clock.level) head.push(clock.levels ? `Level ${clock.level}/${clock.levels}` : `Level ${clock.level}`);
  head.push(blindsText(clock));
  const atTop = !!(clock.levels && clock.level && clock.level >= clock.levels);
  const clockText = remainingMs != null ? formatClock(remainingMs) : '';
  const tail = [];
  if (atTop) {
    head.push('final level');
  } else {
    if (clock.next) head.push(`next ${chipsFmt(clock.next.sb)}/${chipsFmt(clock.next.bb)}`);
    else if (clockText) head.push('next level');
    if (clockText) tail.push(`in ${clockText}`);
  }
  if (clock.paused) {
    // Prestart: the held-table banner names the start time and counts down.
    if (clock.pauseReason === 'prestart') tail.push('not started');
    else if (clock.pauseReason === 'break') tail.push('on break');
    else if (clock.pauseReason === 'held') tail.push('on hold');
    else tail.push('clock paused');
  }
  const startsWithTime = !atTop && !!clockText;
  return {
    main: head.join(' · '),
    tail: tail.join(' · '),
    joiner: tail.length ? (startsWithTime ? ' ' : ' · ') : '',
  };
}

/**
 * The strip's whole line: "Level 3/26 · 100/200 · ante 25 · next 150/300 in 11:42".
 * '' when the clock has no blinds to show.
 */
export function clockStripText(clock, remainingMs) {
  const p = clockStripParts(clock, remainingMs);
  return p ? `${p.main}${p.joiner}${p.tail}` : '';
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
// A hold whose reason this client does not know: neutral, never "director".
export const TOURNAMENT_HOLD_TEXT = 'Play is on hold';
export const TOURNAMENT_RESUMED_TOAST = 'Play resumed';

/** "Break — play resumes at 1:05 PM MT" (the toast and the banner's head). */
export function breakResumesText(resumesAt) {
  const t = formatDenverTime(resumesAt);
  return t ? `Break — play resumes at ${t}` : 'Break — play resumes shortly';
}

/**
 * The waiting area while a tournament table is held (no cards dealt):
 * { kind: 'prestart' | 'break' | 'director' | 'held', text, countdownTo } or null.
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
  if (clock.pauseReason === 'held') return { kind: 'held', text: TOURNAMENT_HOLD_TEXT, countdownTo: null };
  return { kind: 'director', text: TOURNAMENT_DIRECTOR_PAUSE_TEXT, countdownTo: null };
}

/**
 * The 'tournamentPaused' toast: a break with its resume time, a director's
 * pause (no reason, or 'director'), a neutral hold for a reason this client
 * does not know; null for a prestart hold (the table banner says it).
 */
export function tournamentPausedToastText(data) {
  const sent = reasonString(data?.reason ?? data?.pauseReason);
  const reason = normalizeReason(sent);
  if (reason === 'prestart') return null;
  const resumesAt = toEpochMs(data?.resumesAt);
  if (reason === 'break') return breakResumesText(resumesAt);
  if (!reason && resumesAt) return breakResumesText(resumesAt);
  if (!reason && sent) return TOURNAMENT_HOLD_TEXT;
  return TOURNAMENT_DIRECTOR_PAUSE_TOAST;
}

/**
 * Does this 'tournamentPaused' payload mark a DIRECTOR pause (the lobby's TD
 * Pause / Resume control)? A scheduled break or the prestart hold is not one;
 * no reason (an older server: only the director pauses) or any other reason is.
 */
export function marksDirectorPause(data) {
  const reason = normalizeReason(data?.reason ?? data?.pauseReason);
  return reason !== 'break' && reason !== 'prestart';
}

/**
 * The clock as of a 'tournamentResumed' EVENT received at local time
 * `resumedAt` (App.jsx noteTournamentResumed): when that is newer than the
 * frame that brought this paused clock, the table is no longer held — the
 * server may resume without broadcasting a gameState. The frozen time and
 * levelEndsAt are dropped (the server's next frame brings the running clock).
 * Otherwise the clock unchanged. Never throws.
 */
export function resumedClock(clock, resumedAt) {
  if (!clock || !clock.paused) return clock;
  const at = num(resumedAt);
  if (at == null || clock.receivedAt == null || at < clock.receivedAt) return clock;
  return { ...clock, paused: false, pauseReason: null, frozenRemainingMs: null, levelEndsAt: null, resumedLocally: true };
}

/**
 * What GameHUD shows for a table's gameState: { clock, show, held }.
 * `clock` — the normalized clock as of the last resume event (resumedClock);
 * `show`  — the strip renders (a tournament table — gameState.isTournament,
 *           which the server ALWAYS sends, false on cash — with blinds): a
 *           clock the delta merge kept after a move to a cash table never shows;
 * `held`  — the held banner replaces "Waiting for players…" and Deal now.
 */
export function tableTournamentClock(gameState, resumedAt) {
  const onTournamentTable = gameState?.isTournament === true;
  const clock = resumedClock(normalizeTournamentClock(gameState?.tournamentClock), resumedAt);
  return {
    clock,
    show: onTournamentTable && !!(clock && clock.bb),
    held: onTournamentTable && !!heldBannerFor(clock),
  };
}

/**
 * Sit & Go fix-all F18 (owner 2026-10-23) — the level the HAND is played at.
 * A tournament level that changes mid-hand takes effect from the next hand
 * (audit: level 6 ran entirely inside hand 7), but the state's smallBlind /
 * bigBlind / ante are the table's CURRENT level, so the HUD showed the next
 * level's blinds and counted stacks / sized bets in it. poker-server sends
 * `handSmallBlind` / `handBigBlind` / `handAnte` (the hand's level); when they
 * differ from the current level, that one is `next`.
 * → { sb, bb, ante, next: {sb, bb, ante} | null, fromHand }.
 * An older server (no hand keys, or null): the table level, no next.
 */
export function handLevelOf(gs) {
  const g = gs && typeof gs === 'object' ? gs : {};
  const cur = { sb: nonNegInt(g.smallBlind) ?? 0, bb: nonNegInt(g.bigBlind) ?? 0, ante: nonNegInt(g.ante) ?? 0 };
  const hbb = posInt(g.handBigBlind);
  if (!hbb) return { ...cur, next: null, fromHand: false };
  const hand = { sb: nonNegInt(g.handSmallBlind) ?? 0, bb: hbb, ante: nonNegInt(g.handAnte) ?? 0 };
  const differs = cur.bb > 0 && (cur.sb !== hand.sb || cur.bb !== hand.bb || cur.ante !== hand.ante);
  return { ...hand, next: differs ? cur : null, fromHand: true };
}

/** The HUD's line: "Blinds: 75/150 Ante: 15" (the format the HUD always used). */
export function blindsLineText(level) {
  const l = level || {};
  return `Blinds: ${chipsFmt(l.sb || 0)}/${chipsFmt(l.bb || 0)}${l.ante > 0 ? ` Ante: ${chipsFmt(l.ante)}` : ''}`;
}

/** "Next: 100/200 · ante 25" when the coming level differs, else ''. */
export function nextLevelText(level) {
  const n = level && level.next;
  if (!n || !n.bb) return '';
  return `Next: ${chipsFmt(n.sb)}/${chipsFmt(n.bb)}${n.ante ? ` · ante ${chipsFmt(n.ante)}` : ''}`;
}

/**
 * Sit & Go fix-all C3 (owner 2026-10-23) — the spectating status line, live:
 * "5 players | 1 table | Lvl 9". The `spectatingTournament` frame's `status`
 * is a snapshot from when he started watching; every spectator state frame
 * carries the live `tournamentClock` (playersLeft / level), so that wins on a
 * tournament table. Tables: the status's count, else the state's
 * `tournamentTableIds`. Unknown parts are left out; '' when nothing is known.
 */
export function spectatorStatusText(gameState, spectator) {
  const status = spectator && typeof spectator === 'object' && spectator.status && typeof spectator.status === 'object' ? spectator.status : null;
  const live = gameState && gameState.isTournament === true ? normalizeTournamentClock(gameState.tournamentClock) : null;
  const players = live && live.playersLeft != null ? live.playersLeft : nonNegInt(status && status.alivePlayers);
  const tables = nonNegInt(status && status.tables)
    ?? (gameState && Array.isArray(gameState.tournamentTableIds) && gameState.tournamentTableIds.length ? gameState.tournamentTableIds.length : null);
  const level = (live && live.level) || posInt(gameState && gameState.isTournament === true ? gameState.blindLevel : null) || posInt(status && status.blindLevel);
  const parts = [];
  if (players != null) parts.push(`${chipsFmt(players)} ${players === 1 ? 'player' : 'players'}`);
  if (tables) parts.push(`${tables} ${tables === 1 ? 'table' : 'tables'}`);
  if (level) parts.push(`Lvl ${level}`);
  return parts.join(' | ');
}

/** "Blind Level Up — Level 4: 150/300 · ante 25" (an older server: no level → "Blind Level Up: 150/300"). */
export function blindLevelUpText(data) {
  const b = normalizeBlinds(data);
  const blinds = b ? blindsText(b) : `${data?.sb ?? '?'}/${data?.bb ?? '?'}`;
  const level = posInt(data?.level);
  return level ? `Blind Level Up — Level ${level}: ${blinds}` : `Blind Level Up: ${blinds}`;
}
