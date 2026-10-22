/**
 * Qualifier tournaments as the lobby shows them (R2 contract C3, 2026-10-11 —
 * TOURNEY-2 / TOURNEY-13 / APPUI-44 / AUTH-9).
 *
 * poker-server lists ONLY the qualifiers the master schedule lists, each
 *   { qualifierId, masterQualifierId, type, scheduledAt (ISO), signupOpensAt,
 *     signupClosesAt, lateRegUntil, status:'scheduled'|'registering'|'running'|
 *     'finished', registered:boolean, players:number,
 *     structure:{ startingStack, levels:[{sb,bb,ante,minutes}] }, seatsForTop }
 * and results carry the asking player's own `place` and `wonSeat`.
 *
 * The lobby renders this list ONLY (never a built-in default qualifier, never
 * the admin config store). Every field the server did not send stays unknown:
 * signup is NEVER assumed open, a structure / seat count that was not sent is
 * not shown, and "registered" comes from the server (an older server that has
 * no flag: this tab's own registration answers, never a name match).
 *
 * Pure module (no React): the lobby, the dashboard and the offline harness.
 */

import { ECONOMY_TIME_ZONE, denverDateKey } from './denverTime.js';

const STATUSES = new Set(['scheduled', 'registering', 'running', 'finished']);

function ms(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
}

function posInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function nonNegInt(v) {
  return Number.isInteger(v) && v >= 0 ? v : null;
}

export function ordinal(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const m = v % 100;
  return v + (s[(m - 20) % 10] || s[m] || s[0]);
}

export function qualifierTypeLabel(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'weekly') return 'Weekly';
  if (t === 'monthly') return 'Monthly';
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Qualifier';
}

function defaultName(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'monthly') return 'Monthly Major Qualifier';
  if (t === 'weekly') return 'Weekly Qualifier';
  return 'Qualifier Tournament';
}

function normalizeStructure(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startingStack = posInt(raw.startingStack);
  const levels = Array.isArray(raw.levels)
    ? raw.levels.map((l) => ({
      sb: Math.max(0, Math.floor(Number(l?.sb) || 0)),
      bb: Math.max(0, Math.floor(Number(l?.bb) || 0)),
      ante: Math.max(0, Math.floor(Number(l?.ante) || 0)),
      minutes: Math.max(0, Number(l?.minutes ?? l?.duration) || 0),
    })).filter((l) => l.bb > 0).slice(0, 60)
    : [];
  if (!startingStack && levels.length === 0) return null;
  return { startingStack, levels };
}

function normalizeResult(raw) {
  // The asking player's own result: top level (C3) or a nested object.
  const src = raw && typeof raw.result === 'object' && raw.result ? raw.result
    : (raw && typeof raw.myResult === 'object' && raw.myResult ? raw.myResult : raw);
  const place = posInt(src?.place);
  const wonSeat = typeof src?.wonSeat === 'boolean' ? src.wonSeat : null;
  // 2026-10-21 — a seat package can pay several seats for one place.
  const seats = posInt(src?.seats);
  return place || wonSeat !== null ? { place, wonSeat, ...(seats ? { seats } : {}) } : null;
}

/**
 * 2026-10-21 (owner: "1st gets 3 seats, 2nd thru 4th get 2 seats and 5th
 * through 10th get 1 seat") — the server's `seatPackage` ({place: seats}) →
 * a clean {place: seats}, or null.
 */
export function normalizeSeatPackage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  let total = 0;
  for (const [k, v] of Object.entries(raw)) {
    const place = Number(k);
    const seats = Number(v);
    if (!Number.isInteger(place) || place < 1 || place > 100 || !Number.isInteger(seats) || seats < 1 || seats > 10) return null;
    out[place] = seats;
    total += seats;
  }
  return total > 0 ? out : null;
}

/** {total, topN, parts: ['1st: 3', '2nd–4th: 2 each', ...]} for a seat package (null without one). */
export function seatPackageSummary(pkg) {
  const p = normalizeSeatPackage(pkg);
  if (!p) return null;
  const places = Object.keys(p).map(Number).sort((a, b) => a - b);
  const groups = [];
  for (const pl of places) {
    const g = groups[groups.length - 1];
    if (g && g.to === pl - 1 && g.n === p[pl]) g.to = pl;
    else groups.push({ from: pl, to: pl, n: p[pl] });
  }
  return {
    total: places.reduce((s, pl) => s + p[pl], 0),
    topN: places[places.length - 1],
    parts: groups.map((g) => (g.from === g.to ? `${ordinal(g.from)}: ${g.n}` : `${ordinal(g.from)}–${ordinal(g.to)}: ${g.n} each`)),
  };
}

/** One list item → the shape the lobby renders; null when it has no id. */
export function normalizeQualifierItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const qualifierId = raw.qualifierId != null ? String(raw.qualifierId) : '';
  if (!qualifierId) return null;
  const type = String(raw.type ?? raw.qualifierType ?? '').toLowerCase();
  const statusRaw = String(raw.status || '').toLowerCase();
  const status = STATUSES.has(statusRaw) ? statusRaw : (statusRaw === 'starting' ? 'running' : 'unknown');
  const players = typeof raw.players === 'number' ? raw.players
    : (Number.isFinite(Number(raw.registeredCount)) ? Number(raw.registeredCount)
      : (Array.isArray(raw.players) ? raw.players.length : 0));
  return {
    qualifierId,
    masterQualifierId: raw.masterQualifierId != null ? String(raw.masterQualifierId) : null,
    type,
    typeLabel: qualifierTypeLabel(type),
    name: raw.name ? String(raw.name).slice(0, 80) : (raw.qualifierName ? String(raw.qualifierName).slice(0, 80) : defaultName(type)),
    scheduledAt: ms(raw.scheduledAt),
    signupOpensAt: ms(raw.signupOpensAt),
    signupClosesAt: ms(raw.signupClosesAt),
    lateRegUntil: ms(raw.lateRegUntil),
    status,
    // R2 review (K3-5) — the server cancelled it (too few players / taken off
    // the schedule): every credit it consumed was refunded.
    cancelled: raw.cancelled === true,
    registered: typeof raw.registered === 'boolean' ? raw.registered : null,
    // Gameplay audit F142 (2026-10-21) — per viewer: his entry is OUT (busted;
    // null = the server does not say), and how many re-entries he has left
    // (null = unknown / not registered).
    eliminated: typeof raw.eliminated === 'boolean' ? raw.eliminated : null,
    reEntriesLeft: Number.isInteger(raw.reEntriesLeft) && raw.reEntriesLeft >= 0 ? raw.reEntriesLeft : null,
    // 2026-10-22 (owner: "re entries if they have more credits and each entry
    // consume a credit") — per viewer, from a newer server: his unused credits
    // of this tier, the per-event re-entry cap (null = none: each re-entry
    // uses one credit) and how many re-entries he has made. null = the server
    // did not say (an older server, anonymous, or not loaded yet).
    creditsHeld: nonNegInt(raw.creditsHeld),
    maxReEntries: nonNegInt(raw.maxReEntries),
    reEntries: nonNegInt(raw.reEntries),
    players: Math.max(0, Math.floor(players) || 0),
    maxPlayers: posInt(raw.maxPlayers),
    structure: normalizeStructure(raw.structure),
    seatsForTop: posInt(raw.seatsForTop),
    seatPackage: normalizeSeatPackage(raw.seatPackage),
    tournamentId: raw.tournamentId != null && raw.tournamentId !== '' ? String(raw.tournamentId) : null,
    result: normalizeResult(raw),
    // An older server's own window verdict (it had no status for "not open yet").
    legacySignupOpen: typeof raw.signupOpen === 'boolean' ? raw.signupOpen : null,
  };
}

/** The server list → normalized items, soonest first (unscheduled last). */
export function normalizeQualifierList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const q = normalizeQualifierItem(raw);
    if (!q || seen.has(q.qualifierId)) continue;
    seen.add(q.qualifierId);
    out.push(q);
  }
  return out.sort((a, b) => (a.scheduledAt ?? Infinity) - (b.scheduledAt ?? Infinity));
}

/**
 * Where signup stands for this qualifier right now — from the server's
 * status and window only. NEVER 'open' without the server saying so.
 *   scheduled  signup has not opened yet (opensAt when known)
 *   open       signup is open
 *   late       running, late registration open (until lateRegUntil)
 *   running    running, late registration over
 *   closed     signup window is over (not started / no late reg)
 *   finished   over
 *   unknown    the server sent no status and no window
 */
export function qualifierSignupState(q, now = Date.now()) {
  if (!q) return 'unknown';
  if (q.status === 'finished') return 'finished';
  if (q.status === 'running') {
    if (q.lateRegUntil != null) return now < q.lateRegUntil ? 'late' : 'running';
    // An older server's window end IS its late-registration end.
    if (q.legacySignupOpen === true || (q.signupClosesAt != null && now < q.signupClosesAt && q.legacySignupOpen !== false)) return 'late';
    return 'running';
  }
  if (q.signupOpensAt != null && now < q.signupOpensAt) return 'scheduled';
  if (q.signupClosesAt != null && now > q.signupClosesAt) return 'closed';
  if (q.status === 'registering') return 'open';
  if (q.status === 'scheduled') return 'scheduled';
  if (q.legacySignupOpen === true) return 'open';
  if (q.legacySignupOpen === false) return 'closed';
  return 'unknown';
}

/** Counts for the section header: upcoming (not started), live, finished. */
export function qualifierStatusCounts(list, now = Date.now()) {
  const counts = { upcoming: 0, live: 0, finished: 0 };
  for (const q of Array.isArray(list) ? list : []) {
    const s = qualifierSignupState(q, now);
    if (s === 'finished') counts.finished++;
    else if (s === 'late' || s === 'running') counts.live++;
    else counts.upcoming++;
  }
  return counts;
}

/** "You finished 3rd — you won a championship seat!" / "... you won 3 championship seats!" (null without a place). */
export function qualifierResultText(result) {
  const place = posInt(result?.place);
  if (!place) return null;
  const seats = posInt(result?.seats);
  if (result?.wonSeat === true && seats > 1) return `You finished ${ordinal(place)} — you won ${seats} championship seats!`;
  return result?.wonSeat === true
    ? `You finished ${ordinal(place)} — you won a championship seat!`
    : `You finished ${ordinal(place)}.`;
}

/**
 * "Top 3 win a championship seat" — only when the server said how many. With
 * a seat package (2026-10-21): "The top 10 win 15 championship seats (1st: 3,
 * 2nd–4th: 2 each, 5th–10th: 1 each)".
 */
export function seatsForTopText(seatsForTop, seatPackage) {
  const pkg = seatPackageSummary(seatPackage);
  if (pkg) return `The top ${pkg.topN} win ${pkg.total} championship seats (${pkg.parts.join(', ')})`;
  const n = posInt(seatsForTop);
  if (!n) return null;
  return n === 1 ? 'The winner earns a championship seat' : `Top ${n} win a championship seat`;
}

// ── The .online home page's qualifier (owner 2026-10-22) ─────────────────────
// "the qualifier should be at the top of the home page at .online": one card,
// the next / current event, its start in Denver time, its seat package, its
// status (late entry until the SERVER's lateRegUntil — the client never
// computes a late time) and the player's own credits / re-entries.

let denverClockFmt = null;
let denverDayFmt = null;
const tidy = (s) => String(s).replace(/[\u202f\u00a0]/g, ' ');

/** "2:00 PM MT" — a time on the Denver clock ('' without one). */
export function formatDenverTime(t) {
  const v = ms(t);
  if (v == null) return '';
  try {
    if (!denverClockFmt) denverClockFmt = new Intl.DateTimeFormat('en-US', { timeZone: ECONOMY_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
    return `${tidy(denverClockFmt.format(new Date(v)))} MT`;
  } catch { return new Date(v).toISOString(); }
}

/** "Sun, Oct 25 · 11:00 AM MT" — a day + time on the Denver clock ('' without one). */
export function formatDenverWhen(t) {
  const v = ms(t);
  if (v == null) return '';
  try {
    if (!denverDayFmt) denverDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: ECONOMY_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' });
    return `${tidy(denverDayFmt.format(new Date(v)))} · ${formatDenverTime(v)}`;
  } catch { return new Date(v).toISOString(); }
}

/**
 * The one qualifier the home page shows: a live one first, else the soonest
 * one not finished (open / upcoming / waiting to start), else the latest
 * finished one the server still lists (its result); null when none.
 */
export function featuredQualifier(list, now = Date.now()) {
  const items = (Array.isArray(list) ? list : []).filter((q) => q && q.qualifierId);
  if (items.length === 0) return null;
  const byStart = [...items].sort((a, b) => (a.scheduledAt ?? Infinity) - (b.scheduledAt ?? Infinity));
  const states = new Map(byStart.map((q) => [q, qualifierSignupState(q, now)]));
  const live = byStart.find((q) => states.get(q) === 'late' || states.get(q) === 'running');
  if (live) return live;
  const next = byStart.find((q) => states.get(q) !== 'finished');
  if (next) return next;
  const dated = byStart.filter((q) => q.scheduledAt != null);
  return dated.length ? dated[dated.length - 1] : byStart[0];
}

/**
 * The home card's status line: { state, text }.
 *   scheduled  "Sign-up opens 8:00 AM MT"
 *   open       "Sign-up open · starts 11:00 AM MT"
 *   late       "Running · late entry until 2:00 PM MT"
 *   running    "Running · late entry closed"
 *   closed     "Sign-up closed"
 *   finished   "Finished" / "Cancelled"
 */
export function qualifierHomeStatus(q, now = Date.now()) {
  const state = qualifierSignupState(q, now);
  if (!q) return { state, text: '' };
  switch (state) {
    case 'scheduled': {
      if (q.signupOpensAt == null) return { state, text: 'Sign-up opens soon' };
      const sameDay = q.scheduledAt != null && denverDateKey(q.signupOpensAt) === denverDateKey(q.scheduledAt);
      return { state, text: `Sign-up opens ${sameDay ? formatDenverTime(q.signupOpensAt) : formatDenverWhen(q.signupOpensAt)}` };
    }
    case 'open':
      return { state, text: q.scheduledAt != null && q.scheduledAt > now ? `Sign-up open · starts ${formatDenverTime(q.scheduledAt)}` : 'Sign-up open · starting soon' };
    case 'late':
      return { state, text: q.lateRegUntil != null ? `Running · late entry until ${formatDenverTime(q.lateRegUntil)}` : 'Running · late entry open' };
    case 'running':
      return { state, text: 'Running · late entry closed' };
    case 'closed':
      return { state, text: 'Sign-up closed' };
    case 'finished':
      return { state, text: q.cancelled ? 'Cancelled' : 'Finished' };
    default:
      return { state, text: q.scheduledAt != null ? `Starts ${formatDenverWhen(q.scheduledAt)}` : 'Start time to be announced' };
  }
}

/**
 * The viewer's unused credits of this qualifier's tier: the list item's
 * `creditsHeld` (a newer server), else the 'qualifications' answer for the
 * tier ({qualified, credits} | false); null = unknown (not loaded yet).
 */
export function qualifierCreditsHeld(q, qualForType) {
  if (q && Number.isInteger(q.creditsHeld) && q.creditsHeld >= 0) return q.creditsHeld;
  if (qualForType === false) return 0;
  if (qualForType && typeof qualForType === 'object') {
    const n = Number(qualForType.credits);
    if (Number.isInteger(n) && n >= 0) return n;
    return qualForType.qualified ? null : 0;
  }
  return null;
}

/** He holds a credit of this tier (what the server's entry gate checks). */
export function qualifierIsQualified(q, qualForType) {
  if (q && Number.isInteger(q.creditsHeld) && q.creditsHeld >= 0) return q.creditsHeld > 0;
  return !!(qualForType && qualForType.qualified);
}

/**
 * How many more times he can re-enter (each re-entry uses one credit): the
 * server's `reEntriesLeft`, never more than the credits he holds; null =
 * unknown (then the 'qualifications' answer decides, as before).
 */
export function qualifierReentriesAvailable(q, credits) {
  const left = q && Number.isInteger(q.reEntriesLeft) && q.reEntriesLeft >= 0 ? q.reEntriesLeft : null;
  const held = Number.isInteger(credits) && credits >= 0 ? credits : null;
  if (left == null) return held;
  if (held == null) return left;
  return Math.min(left, held);
}

/**
 * The server's re-entry CAP, not his credits, is what stops him: the per-event
 * cap (`maxReEntries`) is used up (`reEntries`), or the server's
 * `reEntriesLeft` is 0 while he still holds a credit of the tier (the live
 * server's reEntriesLeft is a cap of 3 minus re-entries made; a newer one's is
 * min(cap left, credits held)). Review fix-up 2026-10-22: the home line said
 * "no credits left" to a player holding credits.
 */
export function qualifierReentryCapReached(q, credits) {
  if (!q) return false;
  if (Number.isInteger(q.maxReEntries) && Number.isInteger(q.reEntries) && q.reEntries >= q.maxReEntries) return true;
  return q.reEntriesLeft === 0 && Number.isInteger(credits) && credits > 0;
}

/**
 * The home card's "you" line (null when there is nothing to add to the
 * action area): credits held, registered, out + re-entries available.
 */
export function qualifierHomeYouText(q, { state, registered, credits, reentries, qualified } = {}) {
  if (!q || state === 'finished') return null;
  const unit = q.type === 'monthly' ? 'monthly' : (q.type === 'weekly' ? 'weekly' : 'qualifier');
  const creditsText = (n) => `${n} ${unit} credit${n === 1 ? '' : 's'}`;
  if (registered && q.eliminated === true) {
    if (state === 'late') {
      const n = Number.isInteger(reentries) ? reentries : null;
      if (n !== null && n > 0) return `You're out · re-enter with a credit (${n} left)`;
      if (n === null && qualified) return "You're out · re-enter with a credit";
      if (qualifierReentryCapReached(q, credits)) return "You're out · re-entry limit reached";
      return "You're out · no credits left to re-enter";
    }
    return "You're out · late entry is closed";
  }
  const held = Number.isInteger(credits) && credits >= 0 ? credits : null;
  if (registered) return held !== null ? `You're entered · ${creditsText(held)} left` : "You're entered";
  if (held !== null && held > 0) return `You hold ${creditsText(held)} · each entry uses 1`;
  return null;
}

// ── When to read his credits ('getQualifications') again ────────────────────
// Review fix-up 2026-10-22. A credit comes BACK after poker-server answers:
// a withdraw is answered before its refund lands, a cancellation /
// server-restart notice is sent before the release, a no-show release happens
// while he is offline. Read too early, the answer is the post-entry count (0
// for a one-credit player) and Register / Late Register stay hidden. So the
// lobby asks again QUALIFICATIONS_RECHECK_MS after such an event, on a
// signed-in socket. And a lobby mount reuses an answer under
// QUALIFICATIONS_REUSE_MS old (the home tab mounts on every visit; each ask can
// make poker-server download the whole credit list), unless a re-read is due.

/** How long after a withdraw / cancellation / release the credits are read again. */
export const QUALIFICATIONS_RECHECK_MS = 2500;
/** A mount reuses a 'qualifications' answer younger than this (same account). */
export const QUALIFICATIONS_REUSE_MS = 60 * 1000;

/**
 * The qualifiers he WAS registered for (server `registered: true`) that the
 * new list says he no longer is (`registered: false` — withdrawn on another
 * device, released at the start, restarted): a credit may be on its way back.
 * `prevIds` = the ids registered in the previous list (a Set). An event no
 * longer listed, or one whose flag is unknown (null), is not a drop.
 * Returns { registeredIds, dropped }.
 */
export function qualifierRegistrationsDropped(prevIds, list) {
  const registeredIds = new Set();
  const nowFalse = new Set();
  for (const q of Array.isArray(list) ? list : []) {
    if (!q || !q.qualifierId) continue;
    if (q.registered === true) registeredIds.add(q.qualifierId);
    else if (q.registered === false) nowFalse.add(q.qualifierId);
  }
  let dropped = false;
  for (const id of prevIds instanceof Set ? prevIds : []) {
    if (nowFalse.has(id)) { dropped = true; break; }
  }
  return { registeredIds, dropped };
}

/**
 * What a lobby mount does about his credits:
 *   'wait'  — a re-read is already scheduled (its answer reaches this mount);
 *   'reuse' — the cached answer is this account's and under reuseMs old;
 *   'ask'   — ask now.
 * cache = { owner, data, at } | null.
 */
export function qualificationsMountPlan({ cache, owner, now = Date.now(), recheckPending = false, reuseMs = QUALIFICATIONS_REUSE_MS } = {}) {
  if (recheckPending) return 'wait';
  if (cache && owner != null && cache.owner === owner && cache.data && typeof cache.data === 'object'
      && Number.isFinite(cache.at) && now >= cache.at && now - cache.at < reuseMs) return 'reuse';
  return 'ask';
}

/**
 * The Game Over line for a finished tournament (App's table overlay). A
 * qualifier pays SEATS, not chips: the player's own place and whether it won
 * a seat (C3 per-socket `place` / `wonSeat`, or his results row by account
 * id); never "<winner> wins 0 chips". A chip tournament keeps the winner line.
 */
export function tournamentCompleteMessage(data, myUserId) {
  const rows = Array.isArray(data?.results) ? data.results.filter((r) => r && typeof r === 'object') : [];
  const mine = myUserId != null ? rows.find((r) => r.userId != null && String(r.userId) === String(myUserId)) : null;
  const place = posInt(data?.place) || posInt(mine?.place) || posInt(mine?.position);
  const wonSeat = typeof data?.wonSeat === 'boolean' ? data.wonSeat
    : (typeof mine?.wonSeat === 'boolean' ? mine.wonSeat : null);
  const seats = posInt(data?.myResult?.seats) || posInt(data?.seats) || posInt(mine?.seats);
  const isQualifier = data?.isQualifier === true || data?.qualifierId != null || wonSeat !== null
    || rows.some((r) => typeof r.wonSeat === 'boolean');
  if (isQualifier) {
    const line = qualifierResultText({ place, wonSeat, seats });
    return line ? `Qualifier complete! ${line}` : 'Qualifier complete!';
  }
  const winner = rows.find((r) => Number(r.position) === 1);
  const payout = Number(winner?.payout) || 0;
  const who = winner?.playerName ? String(winner.playerName) : 'The winner';
  return payout > 0 ? `Tournament Complete! ${who} wins ${payout.toLocaleString()} chips!` : `Tournament Complete! ${who} wins the tournament!`;
}
