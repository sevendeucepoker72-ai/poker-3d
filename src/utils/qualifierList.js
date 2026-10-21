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
    // An older server's window end IS its late-registration end (start + 1.5h).
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
