/**
 * Monte Carlo equity simulator for all-in situations.
 * Deals remaining board cards 1000 times and counts wins per player.
 */

// Minimal 5-card hand evaluator for equity simulation
function evalHand5(cards) {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  // Check straight
  let isStraight = false;
  for (let i = 0; i < 4; i++) {
    if (ranks[i] - ranks[i + 1] !== 1) break;
    if (i === 3) isStraight = true;
  }
  // Ace-low straight (A-2-3-4-5)
  let aceLow = false;
  if (!isStraight && ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
    isStraight = true;
    aceLow = true;
  }

  // Count rank frequencies
  const freq = {};
  for (const r of ranks) freq[r] = (freq[r] || 0) + 1;
  const groups = Object.entries(freq).map(([r, c]) => ({ rank: +r, count: c }));
  groups.sort((a, b) => b.count - a.count || b.rank - a.rank);

  const counts = groups.map(g => g.count);

  let handRank = 0;
  if (isFlush && isStraight) {
    handRank = ranks[0] === 14 ? 9 : 8; // Royal or straight flush
  } else if (counts[0] === 4) {
    handRank = 7;
  } else if (counts[0] === 3 && counts[1] === 2) {
    handRank = 6;
  } else if (isFlush) {
    handRank = 5;
  } else if (isStraight) {
    handRank = 4;
  } else if (counts[0] === 3) {
    handRank = 3;
  } else if (counts[0] === 2 && counts[1] === 2) {
    handRank = 2;
  } else if (counts[0] === 2) {
    handRank = 1;
  }

  // Tiebreaker: groups sorted by count desc, rank desc
  const tiebreaker = aceLow ? [5, 4, 3, 2, 1] : groups.flatMap(g => Array(g.count).fill(g.rank));
  return { handRank, tiebreaker };
}

function compare(a, b) {
  if (a.handRank !== b.handRank) return a.handRank - b.handRank;
  for (let i = 0; i < Math.min(a.tiebreaker.length, b.tiebreaker.length); i++) {
    if (a.tiebreaker[i] !== b.tiebreaker[i]) return a.tiebreaker[i] - b.tiebreaker[i];
  }
  return 0;
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const result = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = combinations(arr.slice(i + 1), k - 1);
    for (const combo of rest) {
      result.push([arr[i], ...combo]);
    }
  }
  return result;
}

function bestHand(holeCards, community) {
  const all = [...holeCards, ...community];
  const combos = combinations(all, 5);
  let best = null;
  for (const combo of combos) {
    const ev = evalHand5(combo);
    if (!best || compare(ev, best) > 0) {
      best = ev;
    }
  }
  return best;
}

/**
 * Monte Carlo equity simulation.
 * @param {Array<Array<{rank:number, suit:number}>>} playerHands - Array of player hole cards
 * @param {Array<{rank:number, suit:number}>} communityCards - Current community cards
 * @param {Array<{rank:number, suit:number}>} deckRemaining - Remaining deck cards
 * @param {number} iterations - Number of simulations (default 1000)
 * @returns {{ playerEquities: number[] }}
 */
export function simulateEquity(playerHands, communityCards, deckRemaining, iterations = 1000) {
  const numPlayers = playerHands.length;
  const wins = new Array(numPlayers).fill(0);
  const cardsNeeded = 5 - communityCards.length;

  if (cardsNeeded <= 0) {
    // All community cards dealt, just evaluate once
    const evals = playerHands.map(h => bestHand(h, communityCards));
    let bestVal = null;
    let bestIndices = [];
    for (let i = 0; i < numPlayers; i++) {
      if (!bestVal || compare(evals[i], bestVal) > 0) {
        bestVal = evals[i];
        bestIndices = [i];
      } else if (compare(evals[i], bestVal) === 0) {
        bestIndices.push(i);
      }
    }
    const share = 1 / bestIndices.length;
    for (const idx of bestIndices) wins[idx] = 1 * share;
    return {
      playerEquities: wins.map(w => Math.round(w * 100)),
    };
  }

  const deck = [...deckRemaining];

  for (let sim = 0; sim < iterations; sim++) {
    // Fisher-Yates shuffle of first cardsNeeded elements
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const runout = deck.slice(0, cardsNeeded);
    const fullBoard = [...communityCards, ...runout];

    const evals = playerHands.map(h => bestHand(h, fullBoard));
    let bestVal = null;
    let bestIndices = [];
    for (let i = 0; i < numPlayers; i++) {
      if (!bestVal || compare(evals[i], bestVal) > 0) {
        bestVal = evals[i];
        bestIndices = [i];
      } else if (compare(evals[i], bestVal) === 0) {
        bestIndices.push(i);
      }
    }
    const share = 1 / bestIndices.length;
    for (const idx of bestIndices) wins[idx] += share;
  }

  return {
    playerEquities: wins.map(w => Math.round((w / iterations) * 100)),
  };
}
