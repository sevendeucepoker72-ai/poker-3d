import { memo, useMemo } from 'react';
import PokerTable2D from './PokerTable2D';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';

/*
 * Screen-reader mirror of the 3D/2D canvas.
 *
 * The canvas itself is an inaccessible island — SVG/WebGL surfaces aren't
 * exposed as structured content to assistive tech. This component renders
 * a parallel, visually-hidden text description that updates via
 * `aria-live="polite"` when hole cards, community cards, or the active
 * player change.
 *
 * `aria-atomic="false"` lets NVDA/JAWS announce only the changed child
 * rather than re-reading the whole block on every update.
 */
const RANK_LABELS = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven',
  8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
  T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace',
};
const SUIT_LABELS = {
  s: 'Spades', h: 'Hearts', d: 'Diamonds', c: 'Clubs',
  spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs',
  '♠': 'Spades', '♥': 'Hearts', '♦': 'Diamonds', '♣': 'Clubs',
};

function describeCard(card) {
  if (!card) return '';
  // Support {rank, suit}, {r, s}, and shorthand string forms ("As", "Th")
  if (typeof card === 'string') {
    if (card.length >= 2) {
      const r = card.slice(0, card.length - 1);
      const s = card.slice(-1);
      const rank = RANK_LABELS[r] || RANK_LABELS[Number(r)] || r;
      const suit = SUIT_LABELS[s] || s;
      return `${rank} of ${suit}`;
    }
    return card;
  }
  const rank = RANK_LABELS[card.rank] || RANK_LABELS[card.r] || card.rank || card.r || '?';
  const suit = SUIT_LABELS[card.suit] || SUIT_LABELS[card.s] || card.suit || card.s || '';
  return suit ? `${rank} of ${suit}` : String(rank);
}

function ScreenReaderMirror() {
  // Hole cards — server-authoritative (gameState.yourCards) falls back to
  // client-side dealer animation (seatCards[yourSeat]).
  const gameState = useTableStore((s) => s.gameState);
  const mySeat = useTableStore((s) => s.mySeat);
  const seatCards = useGameStore((s) => s.seatCards);
  const communityCards = useGameStore((s) => s.communityCards);

  const serverCards = gameState?.yourCards || [];
  const clientCards = (mySeat >= 0 && seatCards[mySeat]) || [];
  const holeCards = serverCards.length > 0 ? serverCards : clientCards;

  const activeSeatIndex = gameState?.activeSeatIndex ?? -1;
  const seats = gameState?.seats || [];
  const activeSeat = activeSeatIndex >= 0 ? seats[activeSeatIndex] : null;
  const activeName = activeSeat?.playerName || activeSeat?.name || '';

  const communityFromState = (gameState?.communityCards && gameState.communityCards.length > 0)
    ? gameState.communityCards
    : communityCards;

  const holeText = useMemo(() => {
    if (!holeCards || holeCards.length === 0) return '';
    return 'Your hand: ' + holeCards.map(describeCard).filter(Boolean).join(', ');
  }, [holeCards]);

  const boardText = useMemo(() => {
    if (!communityFromState || communityFromState.length === 0) return '';
    return 'Board: ' + communityFromState.map(describeCard).filter(Boolean).join(', ');
  }, [communityFromState]);

  const turnText = activeName ? `Turn: ${activeName}` : '';

  return (
    <div className="sr-only" aria-live="polite" aria-atomic="false">
      {holeText && <div key={`hole-${holeText}`}>{holeText}</div>}
      {boardText && <div key={`board-${boardText}`}>{boardText}</div>}
      {turnText && <div key={`turn-${turnText}`}>{turnText}</div>}
    </div>
  );
}

const GameScene = memo(function GameScene() {
  return (
    <>
      <ScreenReaderMirror />
      <PokerTable2D />
    </>
  );
});

export default GameScene;
