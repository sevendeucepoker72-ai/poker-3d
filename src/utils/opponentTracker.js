/**
 * Opponent tracking utility.
 * Computes VPIP, PFR, Aggression Factor, 3-bet% and fold-to-cbet% per opponent
 * from the per-hand street-tagged action log the server now ships in each
 * handHistory record (Phase 5 — previously this read a `gameState.actionHistory`
 * the server never sent, so 3-bet/cbet/AF never accumulated).
 *
 * Persists stats in sessionStorage.
 */

const STORAGE_KEY = 'app_poker_opponent_stats';

// In-memory Map: playerName -> {
//   handsObserved, vpipCount, pfrCount,
//   threeBetCount, threeBetOppCount, foldToCbetCount, cbetFaced,
//   aggressiveActions, callActions
// }
let statsMap = new Map();

function loadStats() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) statsMap = new Map(Object.entries(JSON.parse(raw)));
  } catch {
    statsMap = new Map();
  }
}

function saveStats() {
  try {
    const obj = {};
    for (const [key, val] of statsMap) obj[key] = val;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore storage errors
  }
}

loadStats();

function emptyStats() {
  return {
    handsObserved: 0, vpipCount: 0, pfrCount: 0,
    threeBetCount: 0, threeBetOppCount: 0, foldToCbetCount: 0, cbetFaced: 0,
    aggressiveActions: 0, callActions: 0,
  };
}

/**
 * Get stats for a specific opponent.
 * @returns {{ vpip, pfr, threeBet, foldToCbet, af, hands }}
 *   vpip/pfr/threeBet/foldToCbet are percentages (0-100) or null when there's
 *   no opportunity sample yet (HUD renders "--"). af is a ratio.
 */
export function getOpponentStats(playerName) {
  const s = statsMap.get(playerName);
  if (!s || s.handsObserved === 0) {
    return { vpip: 0, pfr: 0, threeBet: null, foldToCbet: null, af: 0, hands: 0 };
  }
  const calls = s.callActions || 0;
  const aggressive = s.aggressiveActions || 0;
  return {
    vpip: Math.round((s.vpipCount / s.handsObserved) * 100),
    pfr: Math.round((s.pfrCount / s.handsObserved) * 100),
    // Real, opportunity-gated stats. Null until the player has actually faced
    // the spot (e.g. faced a preflop raise / faced a flop c-bet).
    threeBet: s.threeBetOppCount > 0 ? Math.round((s.threeBetCount / s.threeBetOppCount) * 100) : null,
    foldToCbet: s.cbetFaced > 0 ? Math.round((s.foldToCbetCount / s.cbetFaced) * 100) : null,
    af: calls > 0 ? Math.round((aggressive / calls) * 10) / 10 : (aggressive > 0 ? 999 : 0),
    hands: s.handsObserved,
  };
}

// Classify a raw action string (server form "raised to 200" / "called 50" /
// "went all-in for 900" / "checked" / "folded" / "posted BB 50" / "uncalled…")
// OR an importer bare type ("raise"/"call"/"fold"/"check"/"bet"/"allin").
function classify(actionStr) {
  const a = String(actionStr || '').toLowerCase();
  if (a.startsWith('posted') || a.startsWith('uncalled')) return 'blind';
  if (a.includes('fold')) return 'fold';
  if (a.includes('check')) return 'check';
  if (a.includes('all-in') || a.includes('allin') || a.includes('all in')) return 'allin';
  if (a.includes('rais') || a.startsWith('bet') || a.includes(' bet')) return 'raise';
  if (a.includes('call')) return 'call';
  return 'other';
}

const streetOf = (a) => String(a?.street || a?.phase || '').toLowerCase();
const isPreflop = (a) => streetOf(a).includes('pre');
const isFlop = (a) => streetOf(a) === 'flop';

/**
 * Record a completed hand's data for all opponents from a handHistory record.
 *
 * @param {object} record - handHistory record:
 *   { players: [{seatIndex, name, folded}], actionLog: [{seatIndex, playerName, action, street}] }
 * @param {number} mySeatIndex - the local player's seat index (excluded)
 */
export function recordHandStats(record, mySeatIndex) {
  if (!record) return;
  const players = record.players || [];
  const log = record.actionLog || [];
  if (players.length === 0) return;

  // Normalize the chronological log into {seat, kind, pre, flop}.
  const entries = log.map((a) => ({
    seat: a.seatIndex ?? a.seat,
    kind: classify(a.action ?? a.type),
    pre: isPreflop(a),
    flop: isFlop(a),
  })).filter((e) => e.seat !== undefined && e.seat !== null);

  // ── Preflop pass: VPIP, PFR, 3-bet (+ opportunities), track last raiser ──
  const vpip = new Set();
  const pfr = new Set();
  const threeBet = new Set();
  const threeBetOpp = new Set();
  let pfRaises = 0;
  let lastPreflopRaiser = null;
  for (const e of entries) {
    if (!e.pre || e.kind === 'blind' || e.kind === 'other') continue;
    // Facing ≥1 prior raise when it's your turn = a 3-bet opportunity.
    if (pfRaises >= 1) threeBetOpp.add(e.seat);
    if (e.kind === 'call') {
      vpip.add(e.seat);
    } else if (e.kind === 'raise' || e.kind === 'allin') {
      vpip.add(e.seat);
      pfr.add(e.seat);
      if (pfRaises >= 1) threeBet.add(e.seat); // a re-raise = 3-bet (or 4-bet+)
      pfRaises += 1;
      lastPreflopRaiser = e.seat;
    }
  }

  // ── Flop pass: c-bet by the preflop aggressor, who faced it, who folded ──
  const facedCbet = new Set();
  const foldedToCbet = new Set();
  let cbetMade = false;
  if (lastPreflopRaiser !== null) {
    for (const e of entries) {
      if (!e.flop) continue;
      if (!cbetMade) {
        if (e.seat === lastPreflopRaiser && (e.kind === 'raise' || e.kind === 'allin')) cbetMade = true;
        continue; // pre-cbet checks don't face anything
      }
      if (e.seat === lastPreflopRaiser) continue;
      facedCbet.add(e.seat);
      if (e.kind === 'fold') foldedToCbet.add(e.seat);
    }
  }

  // ── Aggression factor counters across all streets ──
  const aggBySeat = new Map();
  const callBySeat = new Map();
  for (const e of entries) {
    if (e.seat === mySeatIndex) continue;
    if (e.kind === 'raise' || e.kind === 'allin') aggBySeat.set(e.seat, (aggBySeat.get(e.seat) || 0) + 1);
    else if (e.kind === 'call') callBySeat.set(e.seat, (callBySeat.get(e.seat) || 0) + 1);
  }

  // ── Commit per opponent (keyed by name; seat→name via record.players) ──
  for (const p of players) {
    const seat = p.seatIndex;
    if (seat === mySeatIndex) continue;
    const name = p.name || p.playerName;
    if (!name) continue;

    if (!statsMap.has(name)) statsMap.set(name, emptyStats());
    const s = statsMap.get(name);

    s.handsObserved += 1;
    if (vpip.has(seat)) s.vpipCount += 1;
    if (pfr.has(seat)) s.pfrCount += 1;
    if (threeBetOpp.has(seat)) {
      s.threeBetOppCount += 1;
      if (threeBet.has(seat)) s.threeBetCount += 1;
    }
    if (facedCbet.has(seat)) {
      s.cbetFaced += 1;
      if (foldedToCbet.has(seat)) s.foldToCbetCount += 1;
    }
    s.aggressiveActions += aggBySeat.get(seat) || 0;
    s.callActions += callBySeat.get(seat) || 0;
  }

  saveStats();
}

/** Reset all tracked stats. */
export function resetOpponentStats() {
  statsMap.clear();
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
