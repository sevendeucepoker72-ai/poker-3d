/**
 * Hand strength evaluator for poker.
 * Evaluates all 5-card combinations from hole cards + community cards
 * and returns the best hand with detailed descriptions and kickers.
 */

const HAND_NAMES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Trips',
  'Straight',
  'Flush',
  'Full House',
  'Quads',
  'Straight Flush',
  'Royal Flush',
];

/** Map numeric rank to display name */
function rankName(r) {
  const names = { 14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten', 9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Two' };
  return names[r] || String(r);
}

/** Plural form of rank name */
function rankNamePlural(r) {
  const plurals = { 14: 'Aces', 13: 'Kings', 12: 'Queens', 11: 'Jacks', 10: 'Tens', 9: 'Nines', 8: 'Eights', 7: 'Sevens', 6: 'Sixes', 5: 'Fives', 4: 'Fours', 3: 'Threes', 2: 'Twos' };
  return plurals[r] || String(r);
}

/**
 * Evaluate a single 5-card hand.
 * Returns { rank: 0-9, tiebreaker: number[] } for comparison.
 * Cards have { suit: 0-3, rank: 2-14 } where 14 = Ace.
 */
function evaluate5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);

  // Check flush
  const isFlush = suits.every((s) => s === suits[0]);

  // Check straight
  let isStraight = false;
  let straightHigh = 0;

  // Normal straight check
  if (ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5) {
    isStraight = true;
    straightHigh = ranks[0];
  }
  // Wheel (A-2-3-4-5): Ace=14, so sorted is [14,5,4,3,2]
  if (!isStraight && ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
    isStraight = true;
    straightHigh = 5; // 5-high straight
  }

  // Count rank frequencies
  const freq = {};
  for (const r of ranks) {
    freq[r] = (freq[r] || 0) + 1;
  }
  const counts = Object.entries(freq)
    .map(([rank, count]) => ({ rank: Number(rank), count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  // Royal Flush
  if (isFlush && isStraight && straightHigh === 14) {
    return { rank: 9, tiebreaker: [14] };
  }

  // Straight Flush
  if (isFlush && isStraight) {
    return { rank: 8, tiebreaker: [straightHigh] };
  }

  // Four of a Kind
  if (counts[0].count === 4) {
    return { rank: 7, tiebreaker: [counts[0].rank, counts[1].rank] };
  }

  // Full House
  if (counts[0].count === 3 && counts[1].count === 2) {
    return { rank: 6, tiebreaker: [counts[0].rank, counts[1].rank] };
  }

  // Flush
  if (isFlush) {
    return { rank: 5, tiebreaker: ranks };
  }

  // Straight
  if (isStraight) {
    return { rank: 4, tiebreaker: [straightHigh] };
  }

  // Three of a Kind
  if (counts[0].count === 3) {
    const kickers = counts.filter((c) => c.count === 1).map((c) => c.rank).sort((a, b) => b - a);
    return { rank: 3, tiebreaker: [counts[0].rank, ...kickers] };
  }

  // Two Pair
  if (counts[0].count === 2 && counts[1].count === 2) {
    const pairs = [counts[0].rank, counts[1].rank].sort((a, b) => b - a);
    const kicker = counts[2].rank;
    return { rank: 2, tiebreaker: [...pairs, kicker] };
  }

  // One Pair
  if (counts[0].count === 2) {
    const kickers = counts.filter((c) => c.count === 1).map((c) => c.rank).sort((a, b) => b - a);
    return { rank: 1, tiebreaker: [counts[0].rank, ...kickers] };
  }

  // High Card
  return { rank: 0, tiebreaker: ranks };
}

/**
 * Generate a detailed hand description with kickers.
 * @param {number} handRank - 0-9 hand rank
 * @param {number[]} tiebreaker - tiebreaker values
 * @returns {string} Detailed description
 */
function getDetailedHandName(handRank, tiebreaker) {
  switch (handRank) {
    case 9: // Royal Flush
      return 'Royal Flush';
    case 8: { // Straight Flush
      const high = tiebreaker[0];
      if (high === 5) return 'Straight Flush, Five-high';
      return `Straight Flush, ${rankName(high - 4)} to ${rankName(high)}`;
    }
    case 7: { // Quads
      const quadRank = tiebreaker[0];
      const kicker = tiebreaker[1];
      return `Quads, ${rankNamePlural(quadRank)}, ${rankName(kicker)} kicker`;
    }
    case 6: { // Full House
      const trips = tiebreaker[0];
      const pair = tiebreaker[1];
      return `Full House, ${rankNamePlural(trips)} full of ${rankNamePlural(pair)}`;
    }
    case 5: { // Flush
      const high = tiebreaker[0];
      return `Flush, ${rankName(high)}-high`;
    }
    case 4: { // Straight
      const high = tiebreaker[0];
      if (high === 5) return 'Straight, Ace to Five';
      return `Straight, ${rankName(high - 4)} to ${rankName(high)}`;
    }
    case 3: { // Trips
      const tripRank = tiebreaker[0];
      const k1 = tiebreaker[1];
      const k2 = tiebreaker[2];
      return `Trips, ${rankNamePlural(tripRank)}, ${rankName(k1)}-${rankName(k2)} kickers`;
    }
    case 2: { // Two Pair
      const high = tiebreaker[0];
      const low = tiebreaker[1];
      const kicker = tiebreaker[2];
      return `Two Pair, ${rankNamePlural(high)} and ${rankNamePlural(low)}, ${rankName(kicker)} kicker`;
    }
    case 1: { // Pair
      const pairRank = tiebreaker[0];
      const k1 = tiebreaker[1];
      return `Pair of ${rankNamePlural(pairRank)}, ${rankName(k1)} kicker`;
    }
    case 0: { // High Card
      const high = tiebreaker[0];
      return `${rankName(high)}-high`;
    }
    default:
      return HAND_NAMES[handRank] || 'Unknown';
  }
}

/**
 * Compare two evaluated hands. Returns > 0 if a wins, < 0 if b wins, 0 if tie.
 */
function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.min(a.tiebreaker.length, b.tiebreaker.length); i++) {
    if (a.tiebreaker[i] !== b.tiebreaker[i]) return a.tiebreaker[i] - b.tiebreaker[i];
  }
  return 0;
}

/**
 * Generate all C(n, k) combinations from an array.
 */
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const result = [];
  function helper(start, combo) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

/**
 * Evaluate the best 5-card hand from hole cards + community cards.
 *
 * @param {Array} holeCards - Player's hole cards [{ suit, rank, display }]
 * @param {Array} communityCards - Community cards [{ suit, rank, display }]
 * @returns {{ rank: number, name: string, detailedName: string, strength: number, bestFive: Array }}
 *   rank: 0-9 (High Card to Royal Flush)
 *   name: Basic hand name
 *   detailedName: Detailed hand name with kickers
 *   strength: 0-1 normalized value for the meter
 *   bestFive: The 5 cards that make up the best hand
 */
export function evaluateHandStrength(holeCards, communityCards) {
  if (!holeCards || holeCards.length === 0) {
    return { rank: 0, name: 'High Card', detailedName: 'High Card', strength: 0, bestFive: [] };
  }

  const allCards = [...holeCards, ...communityCards];

  // Need at least 5 cards to evaluate
  if (allCards.length < 5) {
    return { rank: 0, name: 'High Card', detailedName: 'High Card', strength: 0, bestFive: [] };
  }

  // Get all 5-card combinations and find the best
  const combos = combinations(allCards, 5);
  let bestEval = null;
  let bestCombo = null;

  for (const combo of combos) {
    const evaluation = evaluate5(combo);
    if (!bestEval || compareHands(evaluation, bestEval) > 0) {
      bestEval = evaluation;
      bestCombo = combo;
    }
  }

  const handRank = bestEval.rank;
  const name = HAND_NAMES[handRank];
  const detailedName = getDetailedHandName(handRank, bestEval.tiebreaker);

  // Normalize strength to 0-1.
  const rankStrength = handRank / 9;

  let tiebreakerStrength = 0;
  if (bestEval.tiebreaker.length > 0) {
    tiebreakerStrength = (bestEval.tiebreaker[0] - 2) / 12 * (1 / 9);
  }

  const strength = Math.min(1, rankStrength + tiebreakerStrength);

  return { rank: handRank, name, detailedName, strength, tiebreaker: bestEval.tiebreaker, bestFive: bestCombo || [] };
}

/**
 * Identify which cards from the winning hand are part of the best 5-card hand.
 * Returns card indices that glow.
 */
export function getWinningCardIndices(holeCards, communityCards, bestFive) {
  if (!bestFive || bestFive.length === 0) return { holeIndices: [], communityIndices: [] };

  const holeIndices = [];
  const communityIndices = [];
  const used = new Set();

  for (const card of bestFive) {
    // Check hole cards first
    let found = false;
    for (let i = 0; i < holeCards.length; i++) {
      const key = `hole-${i}`;
      if (!used.has(key) && holeCards[i].rank === card.rank && holeCards[i].suit === card.suit) {
        holeIndices.push(i);
        used.add(key);
        found = true;
        break;
      }
    }
    if (!found) {
      for (let i = 0; i < communityCards.length; i++) {
        const key = `comm-${i}`;
        if (!used.has(key) && communityCards[i].rank === card.rank && communityCards[i].suit === card.suit) {
          communityIndices.push(i);
          used.add(key);
          break;
        }
      }
    }
  }

  return { holeIndices, communityIndices };
}
