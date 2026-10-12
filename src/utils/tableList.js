/**
 * The lobby's cash-table list (R2 contract C1, 2026-10-11).
 *
 * poker-server's `tableList` (socket getTableList, REST /api/tables) carries
 * ONLY joinable public cash tables, each with
 *   kind:'cash', seatsTaken, maxSeats, seats:[{index, occupied, name|null}],
 *   phase, pot, variant (+ tableName, smallBlind, bigBlind, minBuyIn,
 *   variantName, spectatorCount)
 * and joinTable refuses every other kind with code `table_not_joinable`.
 *
 * An OLDER server sends none of seats / phase / pot / kind (only playerCount):
 * every helper here degrades to what the frame really says — occupancy by
 * count only (no seat positions: the seat picker is skipped and the server
 * picks a seat), no phase / pot / featured table — never a guess shown as fact.
 *
 * Pure module (no React, no store): the lobby and the offline harness use it.
 */

/** Variant chips (filter keys) in display order. 'other' only shows when a listed table needs it. */
export const VARIANT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'holdem', label: "Hold'em" },
  { key: 'omaha', label: 'Omaha' },
  { key: 'short-deck', label: 'Short Deck' },
  { key: 'draw', label: 'Draw' },
  { key: 'stud', label: 'Stud' },
  { key: 'other', label: 'Mixed & Other' },
];

/**
 * The game family a server variant id belongs to, by PREFIX — so every id the
 * server can list lands in exactly one chip (omaha-5 / omaha-6 / omaha-hi-lo,
 * seven-stud / seven-card-stud / seven-card-stud-hi-lo / razz, triple-draw /
 * badugi, pineapple / crazy-pineapple, ...). Unknown ids go to 'other' (never
 * hidden from every chip).
 */
export function variantFamily(variant) {
  const v = String(variant == null || variant === '' ? 'texas-holdem' : variant).trim().toLowerCase();
  if (v === 'texas-holdem' || v === 'holdem' || v === 'texasholdem' || v === 'texas_holdem' || v.endsWith('pineapple')) return 'holdem';
  if (v.startsWith('omaha')) return 'omaha';
  if (v.startsWith('short-deck') || v === 'shortdeck' || v === 'six-plus') return 'short-deck';
  if (v.endsWith('draw') || v.includes('-draw') || v === 'badugi') return 'draw';
  if (v.includes('stud') || v === 'razz') return 'stud';
  return 'other';
}

export function matchesVariantFilter(variant, filter) {
  if (!filter || filter === 'all') return true;
  return variantFamily(variant) === filter;
}

/** Stakes bands on the BIG BLIND — contiguous, so no table falls between two bands. */
export const STAKES_FILTERS = [
  { key: 'all', label: 'All Stakes' },
  { key: 'micro', label: 'Micro (BB under 20)', min: 0, max: 20 },
  { key: 'low', label: 'Low (BB 20–99)', min: 20, max: 100 },
  { key: 'medium', label: 'Medium (BB 100–399)', min: 100, max: 400 },
  { key: 'high', label: 'High (BB 400+)', min: 400, max: Infinity },
];

export function matchesStakesFilter(bigBlind, filter) {
  if (!filter || filter === 'all') return true;
  const band = STAKES_FILTERS.find((s) => s.key === filter);
  if (!band || band.min === undefined) return true;
  const bb = Number(bigBlind) || 0;
  return bb >= band.min && bb < band.max;
}

/** Table-size bands — contiguous too (a 3- or 4-seat table is "Short"). */
export const SEATS_FILTERS = [
  { key: 'all', label: 'All Seats' },
  { key: 'full', label: 'Full Ring (7+)' },
  { key: 'short', label: 'Short (3–6)' },
  { key: 'headsup', label: 'Heads-Up (2)' },
];

export function matchesSeatsFilter(maxSeats, filter) {
  if (!filter || filter === 'all') return true;
  const n = Number(maxSeats) || 9;
  if (filter === 'headsup') return n <= 2;
  if (filter === 'short') return n >= 3 && n <= 6;
  if (filter === 'full') return n >= 7;
  return true;
}

const PHASE_LABELS = {
  WaitingForPlayers: 'Waiting for players',
  PreFlop: 'Pre-Flop',
  Flop: 'Flop',
  Turn: 'Turn',
  River: 'River',
  Showdown: 'Showdown',
  HandComplete: 'Between hands',
  Draw1: 'Draw 1', Draw2: 'Draw 2', Draw3: 'Draw 3',
  Bet1: 'Betting', Bet2: 'Betting', Bet3: 'Betting',
};

/** A player-facing name for a server phase (null when the server sent none). */
export function phaseLabel(phase) {
  if (phase == null || phase === '') return null;
  const s = String(phase);
  if (PHASE_LABELS[s]) return PHASE_LABELS[s];
  return s.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[_-]+/g, ' ').trim() || null;
}

function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function seatName(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 40) : null;
}

/**
 * One list row as the lobby renders it. Returns null for a row with no id.
 *   seatsKnown — the server sent seat positions (C1); false on an older server
 *   hasLiveInfo — the server sent phase / pot (C1)
 */
export function normalizeTableListItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tableId = raw.tableId != null ? String(raw.tableId) : '';
  if (!tableId) return null;
  const maxSeats = Math.max(2, Math.min(10, Math.floor(finiteOr(raw.maxSeats, 9)) || 9));

  let seats = null;
  if (Array.isArray(raw.seats)) {
    seats = Array.from({ length: maxSeats }, (_, i) => ({ index: i, occupied: false, name: null }));
    raw.seats.forEach((s, i) => {
      if (!s || typeof s !== 'object') return;
      const idx = Number.isInteger(s.index) ? s.index : i;
      if (idx < 0 || idx >= maxSeats) return;
      // C1 shape {index, occupied, name}; a pre-contract row {playerName} too.
      const name = seatName(s.name !== undefined ? s.name : s.playerName);
      const occupied = typeof s.occupied === 'boolean' ? s.occupied : !!name;
      seats[idx] = { index: idx, occupied, name: occupied ? name : null };
    });
  }

  const counted = seats ? seats.filter((s) => s.occupied).length : null;
  const explicit = Number.isFinite(Number(raw.seatsTaken)) ? Number(raw.seatsTaken)
    : (Number.isFinite(Number(raw.playerCount)) ? Number(raw.playerCount) : null);
  const seatsTaken = Math.max(0, Math.min(maxSeats, Math.floor(explicit != null ? explicit : (counted || 0))));

  const phase = raw.phase != null && raw.phase !== '' ? String(raw.phase) : null;
  const pot = Number.isFinite(Number(raw.pot)) && raw.pot !== null && raw.pot !== '' ? Math.max(0, Number(raw.pot)) : null;

  return {
    tableId,
    tableName: raw.tableName != null && String(raw.tableName).trim() ? String(raw.tableName).slice(0, 60) : `Table ${tableId.slice(0, 8)}`,
    kind: typeof raw.kind === 'string' ? raw.kind : null,
    variant: raw.variant ? String(raw.variant) : 'texas-holdem',
    variantName: raw.variantName ? String(raw.variantName) : null,
    smallBlind: Math.max(0, finiteOr(raw.smallBlind, 0)),
    bigBlind: Math.max(0, finiteOr(raw.bigBlind, 0)),
    ante: Math.max(0, finiteOr(raw.ante, 0)),
    minBuyIn: Math.max(0, finiteOr(raw.minBuyIn, 0)),
    maxSeats,
    seatsTaken,
    seats,
    seatsKnown: !!seats,
    phase,
    pot,
    hasLiveInfo: phase !== null || pot !== null,
    spectatorCount: Math.max(0, Math.floor(finiteOr(raw.spectatorCount, 0))),
    communityCards: Array.isArray(raw.communityCards) ? raw.communityCards.filter((c) => typeof c === 'string').slice(0, 5) : [],
  };
}

/** A row the lobby may list: a cash table (an older server sends no kind — listed as before). */
export function isListedCashTable(t) {
  return !!t && (t.kind === null || t.kind === undefined || t.kind === 'cash');
}

/** The raw server list → normalized rows, non-cash kinds dropped (defensive: C1 never sends them). */
export function normalizeTableList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of rawList) {
    const t = normalizeTableListItem(raw);
    if (!t || !isListedCashTable(t) || seen.has(t.tableId)) continue;
    seen.add(t.tableId);
    out.push(t);
  }
  return out;
}

export function isTableFull(t) {
  return !!t && t.seatsTaken >= t.maxSeats;
}

/** Can a wallet of `chips` cover the table's minimum buy-in? (unknown wallet: yes — the server checks) */
export function canAffordTable(t, chips) {
  if (!t) return false;
  if (typeof chips !== 'number' || !Number.isFinite(chips)) return true;
  return chips >= (t.minBuyIn || 0);
}

/** A table a player could actually sit down at from the lobby right now. */
export function isJoinableTable(t, chips) {
  return isListedCashTable(t) && !isTableFull(t) && canAffordTable(t, chips);
}

/**
 * "Best Match" / "Recommended for you": among JOINABLE tables only (never a
 * full one, never one the wallet cannot cover), the big blind closest to a
 * twentieth of the wallet; ties go to the livelier table, then the lower
 * stakes. null when nothing qualifies.
 */
export function pickBestMatch(tables, chips) {
  if (!Array.isArray(tables) || typeof chips !== 'number' || !Number.isFinite(chips) || chips <= 0) return null;
  const ideal = chips / 20;
  let best = null;
  let bestKey = null;
  for (const t of tables) {
    if (!isJoinableTable(t, chips)) continue;
    const key = [Math.abs((t.bigBlind || 0) - ideal), -(t.seatsTaken || 0), t.bigBlind || 0];
    if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = t;
      bestKey = key;
    }
  }
  return best;
}

/**
 * The featured table: only from REAL live data (a server that sends phase /
 * pot), at least two players seated; the biggest pot, then the fullest table.
 * null otherwise — the banner is not shown.
 */
export function pickFeaturedTable(tables) {
  if (!Array.isArray(tables)) return null;
  let best = null;
  let bestScore = -1;
  for (const t of tables) {
    if (!t || !t.hasLiveInfo || (t.seatsTaken || 0) < 2) continue;
    const score = (t.pot || 0) * 2 + (t.seatsTaken || 0) * 500;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

/** Seat dots: real positions when known, else just the count (taken first). */
export function seatDots(t) {
  if (!t) return [];
  if (t.seatsKnown && Array.isArray(t.seats)) return t.seats.map((s) => ({ index: s.index, occupied: !!s.occupied, name: s.name }));
  return Array.from({ length: t.maxSeats }, (_, i) => ({ index: i, occupied: i < t.seatsTaken, name: null }));
}

/** Open seat indexes (only meaningful when seatsKnown). */
export function openSeatIndexes(t) {
  if (!t || !t.seatsKnown || !Array.isArray(t.seats)) return [];
  return t.seats.filter((s) => !s.occupied).map((s) => s.index);
}

/** Private home game invite code — the first 8 characters of its table id, upper-case (poker-server privateInviteCode). */
export function privateInviteCodeFor(tableId) {
  return tableId == null ? '' : String(tableId).slice(0, 8).toUpperCase();
}

/** An invite code as the server accepts it: 8 hex characters. */
export function isValidInviteCode(code) {
  return /^[0-9a-f]{8}$/i.test(String(code || '').trim());
}

/** Player-facing text for a join refused because the table is not open from the lobby (C1). */
export const TABLE_NOT_JOINABLE_TEXT = 'That table is not open to join from the lobby any more. Pick another table — the list has been refreshed.';
