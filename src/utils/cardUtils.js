export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const SUIT_SYMBOLS = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
};

export const SUIT_COLORS = {
  hearts: '#E63946',
  diamonds: '#E63946',
  clubs: '#2D2D3F',
  spades: '#2D2D3F',
};

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealFromDeck(deck, count) {
  return {
    dealt: deck.slice(0, count),
    remaining: deck.slice(count),
  };
}

export function cardLabel(card) {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

// Server card helpers (server uses numeric suit/rank)
// Suit: 0=hearts, 1=diamonds, 2=clubs, 3=spades
// Rank: 2-10 as-is, 11=J, 12=Q, 13=K, 14=A
export const SUIT_INDEX_TO_NAME = { 0: 'hearts', 1: 'diamonds', 2: 'clubs', 3: 'spades' };
export const SUIT_INDEX_TO_SYMBOL = { 0: '\u2665', 1: '\u2666', 2: '\u2663', 3: '\u2660' };
export const SUIT_INDEX_TO_COLOR = { 0: '#E63946', 1: '#E63946', 2: '#2D2D3F', 3: '#2D2D3F' };

export function serverRankDisplay(rank) {
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  return String(rank);
}

// Color blind mode colors: blue for spades/clubs, orange for hearts/diamonds
const COLOR_BLIND_COLORS = {
  hearts: '#E67E22',
  diamonds: '#E67E22',
  clubs: '#2980B9',
  spades: '#2980B9',
};

const COLOR_BLIND_INDEX_COLORS = {
  0: '#E67E22', // hearts
  1: '#E67E22', // diamonds
  2: '#2980B9', // clubs
  3: '#2980B9', // spades
};

/**
 * Returns the appropriate card color based on suit and color blind mode.
 * @param {string|number} suit - Suit name ('hearts','diamonds','clubs','spades') or index (0-3)
 * @param {boolean} colorBlindMode - Whether color blind mode is enabled
 * @returns {string} CSS color value
 */
export function getCardColor(suit, colorBlindMode) {
  if (typeof suit === 'number') {
    return colorBlindMode ? COLOR_BLIND_INDEX_COLORS[suit] : SUIT_INDEX_TO_COLOR[suit];
  }
  return colorBlindMode ? COLOR_BLIND_COLORS[suit] : SUIT_COLORS[suit];
}
