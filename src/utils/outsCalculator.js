/**
 * Outs calculator for poker.
 * Calculates the number of outs to improve a hand, percentages,
 * and identifies draw types (flush draw, straight draw, etc.).
 */

/**
 * Calculate outs to improve hand.
 * @param {Array} holeCards - Player's hole cards [{ suit, rank }]
 * @param {Array} communityCards - Community cards [{ suit, rank }]
 * @returns {{ outs: number, nextCardPct: number, byRiverPct: number, draws: string[] }}
 */
export function calculateOuts(holeCards, communityCards) {
  if (!holeCards || holeCards.length === 0 || !communityCards || communityCards.length < 3) {
    return { outs: 0, nextCardPct: 0, byRiverPct: 0, draws: [] };
  }

  const allCards = [...holeCards, ...communityCards];
  const draws = [];
  let totalOuts = new Set();

  // Build full deck (52 cards) minus known cards
  const knownSet = new Set(allCards.map((c) => `${c.rank}-${c.suit}`));
  const remainingDeck = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 2; rank <= 14; rank++) {
      const key = `${rank}-${suit}`;
      if (!knownSet.has(key)) {
        remainingDeck.push({ rank, suit });
      }
    }
  }

  // Check for flush draw
  const flushOuts = checkFlushDraw(allCards, remainingDeck);
  if (flushOuts.length > 0) {
    draws.push('Flush Draw');
    flushOuts.forEach((o) => totalOuts.add(`${o.rank}-${o.suit}`));
  }

  // Check for straight draws
  const straightResult = checkStraightDraw(allCards, remainingDeck);
  if (straightResult.type === 'oesd') {
    draws.push('Open-Ended Straight Draw');
    straightResult.outs.forEach((o) => totalOuts.add(`${o.rank}-${o.suit}`));
  } else if (straightResult.type === 'gutshot') {
    draws.push('Gutshot');
    straightResult.outs.forEach((o) => totalOuts.add(`${o.rank}-${o.suit}`));
  } else if (straightResult.type === 'double-gutshot') {
    draws.push('Double Gutshot');
    straightResult.outs.forEach((o) => totalOuts.add(`${o.rank}-${o.suit}`));
  }

  // Check for overcards (if no pair yet)
  const overOuts = checkOvercards(holeCards, communityCards, remainingDeck);
  if (overOuts.length > 0) {
    draws.push('Overcards');
    overOuts.forEach((o) => totalOuts.add(`${o.rank}-${o.suit}`));
  }

  // Check for set draw (pair in hand, need trips)
  const setOuts = checkSetDraw(holeCards, communityCards, remainingDeck);
  if (setOuts.length > 0) {
    draws.push('Set Draw');
    setOuts.forEach((o) => totalOuts.add(`${o.rank}-${o.suit}`));
  }

  const outs = totalOuts.size;
  const cardsRemaining = remainingDeck.length;
  const cardsToRiver = communityCards.length === 3 ? 2 : communityCards.length === 4 ? 1 : 0;

  // Next card probability
  const nextCardPct = cardsRemaining > 0 ? (outs / cardsRemaining) * 100 : 0;

  // By river probability (using complement method)
  let byRiverPct = nextCardPct;
  if (cardsToRiver === 2 && cardsRemaining > 1) {
    // P(hit by river) = 1 - P(miss turn) * P(miss river)
    const pMissTurn = (cardsRemaining - outs) / cardsRemaining;
    const pMissRiver = (cardsRemaining - 1 - outs) / (cardsRemaining - 1);
    byRiverPct = (1 - pMissTurn * pMissRiver) * 100;
  }

  return {
    outs,
    nextCardPct: Math.round(nextCardPct * 10) / 10,
    byRiverPct: Math.round(byRiverPct * 10) / 10,
    draws,
  };
}

/** Check for flush draw (4 cards of same suit) */
function checkFlushDraw(allCards, remainingDeck) {
  const suitCounts = {};
  for (const c of allCards) {
    suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  }

  const outs = [];
  for (const [suit, count] of Object.entries(suitCounts)) {
    if (count === 4) {
      // Need one more of this suit
      const suitNum = Number(suit);
      for (const card of remainingDeck) {
        if (card.suit === suitNum) {
          outs.push(card);
        }
      }
    }
  }
  return outs;
}

/** Check for straight draws */
function checkStraightDraw(allCards, remainingDeck) {
  const uniqueRanks = [...new Set(allCards.map((c) => c.rank))].sort((a, b) => a - b);

  // Add low-ace (1) if ace is present for wheel detection
  if (uniqueRanks.includes(14)) {
    uniqueRanks.unshift(1);
  }

  let bestType = null;
  const outsSet = new Set();

  // Check all possible 5-card straight windows
  for (let high = 5; high <= 14; high++) {
    const low = high - 4;
    const needed = [];
    let have = 0;

    for (let r = low; r <= high; r++) {
      const actualR = r === 1 ? 14 : r;
      if (uniqueRanks.includes(r) || (r !== actualR && uniqueRanks.includes(actualR))) {
        have++;
      } else {
        needed.push(actualR);
      }
    }

    if (have === 4 && needed.length === 1) {
      // Check if this is an open-ended or gutshot
      const neededRank = needed[0];
      // Open-ended: the missing card is at either end of the straight
      const isOpenEnded = neededRank === low || neededRank === high;

      for (const card of remainingDeck) {
        if (card.rank === neededRank) {
          outsSet.add(`${card.rank}-${card.suit}`);
        }
      }

      if (!bestType) {
        bestType = isOpenEnded ? 'oesd' : 'gutshot';
      } else if (bestType === 'gutshot' && isOpenEnded) {
        bestType = 'oesd';
      } else if (bestType === 'gutshot') {
        bestType = 'double-gutshot';
      }
    }
  }

  if (outsSet.size === 0) {
    return { type: null, outs: [] };
  }

  const outsArr = [];
  for (const key of outsSet) {
    const [rank, suit] = key.split('-').map(Number);
    outsArr.push({ rank, suit });
  }

  return { type: bestType, outs: outsArr };
}

/** Check for overcards (hole cards higher than any community card) */
function checkOvercards(holeCards, communityCards, remainingDeck) {
  // Only relevant if player doesn't have a pair or better
  const allRanks = [...holeCards, ...communityCards].map((c) => c.rank);
  const freq = {};
  for (const r of allRanks) {
    freq[r] = (freq[r] || 0) + 1;
  }
  // If player already has a pair (any hole card rank appears 2+ times), skip
  for (const hc of holeCards) {
    if (freq[hc.rank] >= 2) return [];
  }

  const maxCommunity = Math.max(...communityCards.map((c) => c.rank));
  const overHoleCards = holeCards.filter((c) => c.rank > maxCommunity);

  if (overHoleCards.length === 0) return [];

  const outs = [];
  for (const hc of overHoleCards) {
    for (const card of remainingDeck) {
      if (card.rank === hc.rank) {
        outs.push(card);
      }
    }
  }
  return outs;
}

/** Check for set draw (pocket pair, need to hit trips) */
function checkSetDraw(holeCards, communityCards, remainingDeck) {
  if (holeCards.length < 2) return [];
  if (holeCards[0].rank !== holeCards[1].rank) return [];

  // Have a pocket pair - check if we already have a set
  const pairRank = holeCards[0].rank;
  const communityHasRank = communityCards.some((c) => c.rank === pairRank);
  if (communityHasRank) return []; // Already have trips or better

  const outs = [];
  for (const card of remainingDeck) {
    if (card.rank === pairRank) {
      outs.push(card);
    }
  }
  return outs;
}

/**
 * Analyze board texture from community cards.
 * @param {Array} communityCards - Community cards [{ suit, rank }]
 * @returns {{ labels: string[], primary: string }}
 */
export function analyzeBoardTexture(communityCards) {
  if (!communityCards || communityCards.length < 3) {
    return { labels: [], primary: '' };
  }

  const labels = [];
  const suits = communityCards.map((c) => c.suit);
  const ranks = communityCards.map((c) => c.rank).sort((a, b) => a - b);

  // Suit analysis
  const suitCounts = {};
  for (const s of suits) {
    suitCounts[s] = (suitCounts[s] || 0) + 1;
  }
  const uniqueSuits = Object.keys(suitCounts).length;

  if (uniqueSuits === 1) {
    labels.push('Monotone');
  } else if (uniqueSuits === 2) {
    labels.push('Two-tone');
  } else {
    labels.push('Rainbow');
  }

  // Paired board
  const rankCounts = {};
  for (const r of ranks) {
    rankCounts[r] = (rankCounts[r] || 0) + 1;
  }
  const hasPair = Object.values(rankCounts).some((c) => c >= 2);
  if (hasPair) {
    labels.push('Paired');
  }

  // Connected: check for sequential cards
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b);
  let maxConsecutive = 1;
  let curr = 1;
  for (let i = 1; i < uniqueRanks.length; i++) {
    if (uniqueRanks[i] - uniqueRanks[i - 1] === 1) {
      curr++;
      maxConsecutive = Math.max(maxConsecutive, curr);
    } else {
      curr = 1;
    }
  }
  // Also check ace-low connectivity (A-2)
  if (uniqueRanks.includes(14) && uniqueRanks.includes(2)) {
    maxConsecutive = Math.max(maxConsecutive, 2);
  }

  if (maxConsecutive >= 3) {
    labels.push('Connected');
  }

  // Wet/Dry assessment
  const hasFlushDraw = Object.values(suitCounts).some((c) => c >= 2);
  const hasStraightDraw = maxConsecutive >= 2;
  // Count gaps of 1 (potential gutshots)
  let gapCount = 0;
  for (let i = 1; i < uniqueRanks.length; i++) {
    if (uniqueRanks[i] - uniqueRanks[i - 1] === 2) gapCount++;
  }

  if (hasFlushDraw && hasStraightDraw) {
    labels.push('Wet');
  } else if (!hasFlushDraw && !hasStraightDraw && gapCount === 0 && uniqueSuits >= 3) {
    labels.push('Dry');
  }

  return {
    labels,
    primary: labels[0] || '',
  };
}
