/**
 * tablePayload — defensive readers for what poker-server sends the TABLE screen
 * (.online fix round 1, 2026-10-11; CONTRACTS R1 #1 #2 #3 #4 #5).
 *
 * Pure functions: no React, no store, no socket imports, so they can be
 * exercised directly in Node. Every reader returns either a clean value or a
 * neutral one — never throws on a malformed frame.
 */

// ── Names (AUTH-6 / R1 contract #3) ─────────────────────────────────────────
// A seat / winner / table name is rendered as TEXT and indexed for an avatar
// initial. A non-string name (number, object, array) used to throw in
// PokerTable2D `(name || '?')[0].toUpperCase()` for EVERY viewer of the table
// and replaced the whole app with the root error screen.

/** A displayable string for `value`, or `fallback` when it isn't one. */
export function safeName(value, fallback = '?') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

/** Upper-case first letter of a name ('?' when there is none). */
export function nameInitial(value, fallback = '?') {
  const s = safeName(value, '').trim();
  return (s.charAt(0) || fallback).toUpperCase();
}

// Ingestion cleaners keep "no name" (null / undefined / '') as it is — render
// sites have their own "Seat N" / "Player" fallbacks — and only replace a value
// that is not text.
function cleanName(v) {
  if (v === null || v === undefined || typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '?';
}
function cleanAction(v) {
  if (v === null || v === undefined || typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return 'None';
}

// Copy-on-write over a list of objects: returns the SAME array (and the same
// item objects) when nothing needed fixing, so React deps keyed on identity
// (e.g. gameState.seats) don't change on every frame.
function fixList(list, fields) {
  if (!Array.isArray(list)) return list;
  let out = list;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;
    let fixed = item;
    for (const [key, clean] of fields) {
      if (!(key in item)) continue;
      const v = item[key];
      const c = clean(v);
      if (c !== v) {
        if (fixed === item) fixed = { ...item };
        fixed[key] = c;
      }
    }
    if (fixed !== item) {
      if (out === list) out = list.slice();
      out[i] = fixed;
    }
  }
  return out;
}

const SEAT_FIELDS = [['playerName', cleanName], ['name', cleanName], ['lastAction', cleanAction]];
const NAMED_FIELDS = [['playerName', cleanName]];

/**
 * gameState with every name the table renders made safe (seats, winners,
 * showdown hands, chop shares, table name). Same object back when clean.
 */
export function sanitizeTableState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  let out = state;
  const put = (key, value) => {
    if (value === state[key]) return;
    if (out === state) out = { ...state };
    out[key] = value;
  };
  if ('seats' in state) put('seats', fixList(state.seats, SEAT_FIELDS));
  if ('tableName' in state) put('tableName', cleanName(state.tableName));
  if ('chopDetails' in state) put('chopDetails', fixList(state.chopDetails, NAMED_FIELDS));
  const hr = state.handResult;
  if (hr && typeof hr === 'object') {
    const winners = fixList(hr.winners, NAMED_FIELDS);
    const showdownHands = fixList(hr.showdownHands, NAMED_FIELDS);
    if (winners !== hr.winners || showdownHands !== hr.showdownHands) {
      put('handResult', { ...hr, winners, showdownHands });
    }
  }
  return out;
}

/** A hand-history record with safe player / winner names. */
export function sanitizeHandHistory(history) {
  if (!history || typeof history !== 'object') return history;
  const players = fixList(history.players, NAMED_FIELDS);
  const winners = fixList(history.winners, NAMED_FIELDS);
  if (players === history.players && winners === history.winners) return history;
  return { ...history, players, winners };
}

/** An event carrying `playerName` (emote, reaction, chat line). */
export function sanitizeNamedEvent(evt) {
  if (!evt || typeof evt !== 'object') return evt;
  const c = cleanName(evt.playerName);
  return c === evt.playerName ? evt : { ...evt, playerName: c };
}

// ── Shown / mucked cards (TABLEUI-5 / R1 contract #4) ───────────────────────
// `muckedHandRevealed` used to relay whatever cards a client sent; a frame of
// `cards: [null]` crashed every viewer. The server now sends the seat's real
// hole cards, and the client still checks every array before storing it.

const SUIT_NAMES = new Set(['hearts', 'diamonds', 'clubs', 'spades']);
const MAX_SHOWN_CARDS = 7; // seven-card stud is the most a seat can hold

function isCard(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (!Number.isInteger(c.rank) || c.rank < 2 || c.rank > 14) return false;
  if (typeof c.suit === 'number') return Number.isInteger(c.suit) && c.suit >= 0 && c.suit <= 3;
  return typeof c.suit === 'string' && SUIT_NAMES.has(c.suit);
}

/**
 * The cards as `[{ rank, suit }]` when EVERY entry is a real card, else null
 * (the whole payload is dropped — a half-valid hand is never shown).
 */
export function sanitizeShownCards(cards, max = MAX_SHOWN_CARDS) {
  if (!Array.isArray(cards) || cards.length === 0 || cards.length > max) return null;
  if (!cards.every(isCard)) return null;
  return cards.map((c) => ({ rank: c.rank, suit: c.suit }));
}

// ── Per-hand state keys (TABLEUI-7 / R1 contract #5) ────────────────────────
// The server's delta could not clear a key that disappeared (JSON drops
// `undefined`), so a split pot's "Split Pot!" banner and the training panel
// stuck to later hands. The fixed server sends `null`; the client also drops
// these whenever a delta starts a NEW hand without carrying them.

// (One string literal on purpose: it survives minification verbatim and is a
// canonical-features.txt lock token.)
export const PER_HAND_STATE_KEYS = Object.freeze(
  'isChoppedPot chopDetails trainingData potBreakdown insuranceQuote'.split(' '),
);

/**
 * `state` = the merged state of a delta that changed handNumber. Every
 * per-hand key the delta itself does not carry is cleared (set to null — the
 * merge treats null as cleared). Mutates and returns `state`.
 */
export function clearStalePerHandKeys(state, delta) {
  if (!state || typeof state !== 'object') return state;
  for (const key of PER_HAND_STATE_KEYS) {
    if (!delta || typeof delta !== 'object' || !(key in delta)) state[key] = null;
  }
  return state;
}

// ── Insurance (TABLEUI-1 / ECON-1 / R1 contract #1) ─────────────────────────

const toInt = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/**
 * The server's quote for THIS seat and THIS hand, or null. The panel is driven
 * by nothing else (no client-side pricing): `gameState.insuranceQuote` =
 * `{ handNumber, cashout, equityPct, pot }` for the one eligible seat.
 */
export function readInsuranceQuote(gameState) {
  const q = gameState && gameState.insuranceQuote;
  if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
  const handNumber = toInt(q.handNumber);
  const cashout = toInt(q.cashout);
  const equityPct = toInt(q.equityPct);
  if (handNumber === null || cashout === null || equityPct === null) return null;
  if (handNumber !== toInt(gameState.handNumber)) return null; // a stale quote never shows
  if (cashout <= 0 || equityPct < 0 || equityPct > 100) return null;
  const pot = toInt(q.pot);
  // R2 (Addendum) — when the decision window closes, on the SERVER's clock
  // (epoch ms); null from a server that does not send it.
  const expiresAt = toInt(q.expiresAt);
  return {
    handNumber, cashout, equityPct,
    pot: pot !== null && pot > 0 ? pot : null,
    expiresAt: expiresAt !== null && expiresAt > 0 ? expiresAt : null,
  };
}

/** The server's `insuranceAccepted { cashout, equityPct }`, or null. */
export function readInsuranceAccepted(data) {
  if (!data || typeof data !== 'object') return null;
  const cashout = toInt(data.cashout);
  const equityPct = toInt(data.equityPct);
  if (cashout === null || cashout < 0) return null;
  return { cashout, equityPct: equityPct === null ? null : Math.max(0, Math.min(100, equityPct)) };
}

// ── Rebuy (TOURNEY-1 / R1 contract #2) ──────────────────────────────────────

/** true / false from the server's `rebuyAllowed`; null = older server (key absent). */
export function rebuyAllowedFlag(gameState) {
  const v = gameState && gameState.rebuyAllowed;
  return typeof v === 'boolean' ? v : null;
}

/** The table's minimum buy-in (`gameState.minBuyIn`), else `fallback`. */
export function rebuyAmountFor(gameState, fallback = 5000) {
  const v = gameState && gameState.minBuyIn;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
}
