/**
 * Opponent tracking utility.
 * Tracks VPIP (Voluntarily Put $ In Pot) and PFR (Pre-Flop Raise) for each opponent.
 * Persists stats in localStorage.
 */

const STORAGE_KEY = 'app_poker_opponent_stats';

// In-memory Map: playerName -> { handsObserved, vpipCount, pfrCount, threeBetCount, foldToCbetCount, cbetFaced, aggressiveActions, passiveActions }
let statsMap = new Map();

// Load from localStorage on init
function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      statsMap = new Map(Object.entries(parsed));
    }
  } catch {
    statsMap = new Map();
  }
}

function saveStats() {
  try {
    const obj = {};
    for (const [key, val] of statsMap) {
      obj[key] = val;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore storage errors
  }
}

// Initialize on module load
loadStats();

/**
 * Get stats for a specific opponent.
 * @param {string} playerName
 * @returns {{ vpip: number, pfr: number, hands: number }}
 *   vpip/pfr are percentages (0-100), hands is total observed
 */
export function getOpponentStats(playerName) {
  const stats = statsMap.get(playerName);
  if (!stats || stats.handsObserved === 0) {
    return { vpip: 0, pfr: 0, threeBet: 0, foldToCbet: 0, af: 0, hands: 0 };
  }
  const passive = stats.passiveActions || 0;
  const aggressive = stats.aggressiveActions || 0;
  return {
    vpip: Math.round((stats.vpipCount / stats.handsObserved) * 100),
    pfr: Math.round((stats.pfrCount / stats.handsObserved) * 100),
    threeBet: Math.round(((stats.threeBetCount || 0) / Math.max(1, stats.handsObserved)) * 100),
    foldToCbet: Math.round(((stats.foldToCbetCount || 0) / Math.max(1, stats.cbetFaced || 1)) * 100),
    af: passive > 0 ? Math.round((aggressive / passive) * 10) / 10 : aggressive > 0 ? 999 : 0,
    hands: stats.handsObserved,
  };
}

/**
 * Record a completed hand's data for all opponents.
 * Call this when a hand completes (phase === 'HandComplete').
 *
 * @param {Array} seats - The gameState.seats array
 * @param {number} mySeatIndex - The local player's seat index (to exclude)
 * @param {object} gameState - Full game state with action history
 */
export function recordHandStats(seats, mySeatIndex, gameState) {
  if (!seats || seats.length === 0) return;

  const actionHistory = gameState?.actionHistory || [];

  // Build a set of players who voluntarily put chips in preflop
  // and players who raised preflop
  const vpipPlayers = new Set();
  const pfrPlayers = new Set();

  // Look through action history for preflop actions
  for (const action of actionHistory) {
    const phase = action.phase || action.street;
    if (phase && phase !== 'PreFlop' && phase !== 'preflop') continue;

    const type = (action.type || action.action || '').toLowerCase();
    const seatIndex = action.seatIndex ?? action.seat;
    if (seatIndex === undefined || seatIndex === null) continue;

    const seat = seats[seatIndex];
    if (!seat || !seat.playerName) continue;

    // VPIP: call, raise, bet, all-in (not check, not forced blinds posting)
    if (type === 'call' || type === 'raise' || type === 'bet' || type === 'allin' || type === 'all-in') {
      vpipPlayers.add(seat.playerName);
    }

    // PFR: raise or bet preflop (re-raise counts too)
    if (type === 'raise' || type === 'bet') {
      pfrPlayers.add(seat.playerName);
    }
  }

  // If no action history available, use seat-level heuristics
  // (check if player has currentBet > bigBlind or is folded)
  const hasPreflopActions = actionHistory.some((a) => {
    const phase = a.phase || a.street;
    return phase === 'PreFlop' || phase === 'preflop';
  });

  // Count aggressive/passive actions per player across all streets
  const aggressiveByPlayer = new Map();
  const passiveByPlayer = new Map();
  for (const action of actionHistory) {
    const seatIndex = action.seatIndex ?? action.seat;
    if (seatIndex === undefined || seatIndex === null || seatIndex === mySeatIndex) continue;
    const seat = seats[seatIndex];
    if (!seat || !seat.playerName) continue;
    const type = (action.type || action.action || '').toLowerCase();
    const name = seat.playerName;
    if (type === 'bet' || type === 'raise' || type === 'allin' || type === 'all-in') {
      aggressiveByPlayer.set(name, (aggressiveByPlayer.get(name) || 0) + 1);
    } else if (type === 'call' || type === 'check') {
      passiveByPlayer.set(name, (passiveByPlayer.get(name) || 0) + 1);
    }
  }

  // Record each opponent
  for (let i = 0; i < seats.length; i++) {
    if (i === mySeatIndex) continue;
    const seat = seats[i];
    if (!seat || !seat.playerName) continue;

    // Initialize if new player
    if (!statsMap.has(seat.playerName)) {
      statsMap.set(seat.playerName, { handsObserved: 0, vpipCount: 0, pfrCount: 0, threeBetCount: 0, foldToCbetCount: 0, cbetFaced: 0, aggressiveActions: 0, passiveActions: 0 });
    }

    const stats = statsMap.get(seat.playerName);
    stats.handsObserved += 1;
    stats.aggressiveActions += aggressiveByPlayer.get(seat.playerName) || 0;
    stats.passiveActions += passiveByPlayer.get(seat.playerName) || 0;

    if (hasPreflopActions) {
      if (vpipPlayers.has(seat.playerName)) {
        stats.vpipCount += 1;
      }
      if (pfrPlayers.has(seat.playerName)) {
        stats.pfrCount += 1;
      }
    } else {
      // Fallback heuristic: if they didn't fold and had a bet, count as VPIP
      if (!seat.folded && seat.totalBetThisHand > 0) {
        stats.vpipCount += 1;
      }
    }
  }

  saveStats();
}

/**
 * Reset all tracked stats.
 */
export function resetOpponentStats() {
  statsMap.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
