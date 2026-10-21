/**
 * Session Stats ledger (Gameplay audit G178, 2026-10-21).
 *
 * The in-table Session Stats widget took ONE baseline (the first stack it saw)
 * and showed `stack - baseline`: a bust + auto-rebuy (wallet chips put on the
 * seat) read "+0" although he was down a buy-in, and a Multi-Table switch
 * showed the other table's stack minus the first table's start.
 *
 * Now each table session keeps its own entry — keyed by the table, or by the
 * tournament (a tournament's table move keeps its chips, so it keeps its
 * session) — with its start stack, the wallet chips added to it since
 * (`rebuyComplete.added`), a chip history in "stack minus added" terms and its
 * hand count (a hand-number rise while that table is on screen, G171: a table
 * switch or the first frame is not a hand). Profit = stack - start - added.
 *
 * Pure (no React, no store) so it can be exercised in Node.
 */

export const SESSION_HISTORY_MAX = 20;

/** The ledger key of a table state: `t:<tournamentId>` or `table:<tableId>`, or null. */
export function sessionKeyOf(gs) {
  if (!gs || typeof gs !== 'object') return null;
  if (gs.tournamentId != null && gs.tournamentId !== '') return `t:${gs.tournamentId}`;
  if (gs.tableId != null && gs.tableId !== '') return `table:${gs.tableId}`;
  return null;
}

export function createSessionLedger() {
  return { entries: new Map(), shownKey: null };
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The hero's stack in a frame, or null when he holds no seat there. */
function heroChips(gs, seat) {
  if (!gs || gs.isSpectator === true || !seat || typeof seat !== 'object') return null;
  if (seat.state === 'empty') return null;
  const c = finite(Number(seat.chipCount));
  return c === null ? null : Math.max(0, c);
}

function pushPoint(e, v) {
  const h = e.history;
  if (h.length && h[h.length - 1] === v) return;
  e.history = [...h.slice(-(SESSION_HISTORY_MAX - 1)), v];
  e.lastPushFrame = e.frames;
}

/**
 * One frame of the table on screen. `seat` = the hero's seat object there (or
 * null). The baseline is his first stack there above 0 (as before: a 0 at the
 * first frame may be an all-in, not a bust). Entries of tables he no longer
 * holds (not this frame's table and not in `liveKeys` when given) are dropped:
 * sitting there again is a new buy-in.
 */
export function observeSessionFrame(ledger, gs, seat, liveKeys) {
  const key = sessionKeyOf(gs);
  if (!ledger || !key) return ledger;
  const switched = ledger.shownKey !== null && ledger.shownKey !== key;
  ledger.shownKey = key;
  const chips = heroChips(gs, seat);
  if (chips !== null && liveKeys && typeof liveKeys.has === 'function') {
    for (const k of [...ledger.entries.keys()]) if (k !== key && !liveKeys.has(k)) ledger.entries.delete(k);
  }
  let e = ledger.entries.get(key);
  if (!e) {
    if (chips === null || chips <= 0) return ledger;
    e = { start: chips, added: 0, history: [chips], hands: 0, lastHand: null, lastChips: chips, frames: 1, lastPushFrame: 1 };
    ledger.entries.set(key, e);
  } else if (chips !== null) {
    e.lastChips = chips;
    e.frames += 1;
    // (an empty stack is not drawn, as before: an all-in reads 0 mid-hand)
    if (chips > 0) pushPoint(e, chips - e.added);
  }
  // Hands: a new hand number at the same table while it stays on screen.
  const hn = finite(Number(gs.handNumber));
  if (hn !== null && gs.tableId != null) {
    const cur = { tableId: String(gs.tableId), handNumber: hn };
    const prev = e.lastHand;
    if (!switched && prev && prev.tableId === cur.tableId && hn > prev.handNumber && chips !== null) e.hands += 1;
    e.lastHand = cur;
  }
  return ledger;
}

/**
 * Wallet chips put on a table's seat (`rebuyComplete` { success, added,
 * newStack }). Ignored when that table has no baseline yet (the baseline taken
 * next already holds them) or when the baseline IS the frame that carried the
 * top-up (the only frame seen there, at newStack: a rebuy needs a bust frame
 * before it otherwise). When the frame carrying the top-up was already seen
 * (its stack === newStack), its history point is rewritten so the sparkline
 * does not spike.
 */
export function creditSessionRebuy(ledger, key, added, newStack) {
  if (!ledger || !key) return ledger;
  const a = finite(Number(added));
  if (a === null || a <= 0) return ledger;
  const e = ledger.entries.get(key);
  if (!e) return ledger;
  const ns = finite(Number(newStack));
  if (ns !== null && e.frames === 1 && e.start === ns) return ledger;
  e.added += a;
  if (ns !== null && ns > 0 && e.lastChips === ns && e.history.length) {
    const v = e.lastChips - e.added;
    if (e.lastPushFrame !== e.frames) pushPoint(e, v); // that frame drew nothing new
    else if (e.history.length >= 2 && e.history[e.history.length - 2] === v) e.history = e.history.slice(0, -1);
    else e.history = [...e.history.slice(0, -1), v];
  }
  return ledger;
}

/**
 * The ledger key a `rebuyComplete` belongs to: its `tableId` (a newer server
 * names the table it topped up); else the seat an older server tops up — the
 * MAIN seat: the non-extra Multi-Table entry, or the table on screen.
 */
export function rebuySessionKey(data, { gameState, activeTables, currentTableId } = {}) {
  const has = (v) => v != null && v !== '';
  const stateOf = (tid) => {
    if (gameState && has(gameState.tableId) && String(gameState.tableId) === tid) return gameState;
    let found = null;
    if (activeTables && typeof activeTables.forEach === 'function') {
      activeTables.forEach((e, id) => { if (!found && String(id) === tid && e && e.gameState) found = e.gameState; });
    }
    return found;
  };
  let tid = data && has(data.tableId) ? String(data.tableId) : null;
  if (tid === null && currentTableId != null && activeTables && typeof activeTables.forEach === 'function') {
    activeTables.forEach((e, id) => { if (tid === null && e && !e.extra && e.gameState) tid = String(id); });
  }
  if (tid === null && gameState && has(gameState.tableId)) tid = String(gameState.tableId);
  if (tid === null) return null;
  const gs = stateOf(tid);
  return (gs && sessionKeyOf(gs)) || `table:${tid}`;
}

/** Keys of the table sessions the hero still holds (the shown table + live Multi-Table entries). */
export function liveSessionKeys(gameState, activeTables) {
  const keys = new Set();
  const add = (gs) => {
    if (!gs || gs.isSpectator === true || !(Number(gs.yourSeat) >= 0)) return;
    const k = sessionKeyOf(gs);
    if (k) keys.add(k);
  };
  add(gameState);
  if (activeTables && typeof activeTables.forEach === 'function') activeTables.forEach((e) => add(e && e.gameState));
  return keys;
}

/** What the widget shows for the table on screen, or null (no session there yet). */
export function sessionView(ledger, gs, seat) {
  const key = sessionKeyOf(gs);
  const e = ledger && key ? ledger.entries.get(key) : null;
  if (!e) return null;
  const chips = heroChips(gs, seat);
  const stack = chips === null ? 0 : chips;
  return {
    start: e.start,
    added: e.added,
    stack,
    profit: stack - e.start - e.added,
    hands: e.hands,
    history: e.history.slice(),
  };
}
