/**
 * Card2D — the flat playing card of the 2D table. Moved as-is out of
 * PokerTable2D.jsx (2026-11-02, lead spec C2) so the tournament broadcast page
 * (src/broadcast/ui/table) draws the same card; PokerTable2D imports it back
 * with no change in behaviour. Its styles are the `.card2d*` rules in
 * PokerTable2D.css (the broadcast page carries its own scoped copy).
 */
import {
  SUIT_SYMBOLS,
  SUIT_INDEX_TO_SYMBOL,
  getCardColor,
  serverRankDisplay,
} from '../../utils/cardUtils';

/* ============================================================
   Card2D — playing card with deal animation
   ============================================================ */
export default function Card2D({ card, faceUp = true, small = false, dealDelay = 0, backClass = '' }) {
  if (!faceUp || !card) {
    return (
      <div
        className={`card2d card2d--back card2d--deal${small ? ' card2d--small' : ''}${backClass ? ` ${backClass}` : ''}`}
        style={{ animationDelay: `${dealDelay}s` }}
      >
        <div className="card2d__back-pattern" />
      </div>
    );
  }

  const { rank, suit } = card;
  const suitSymbol =
    typeof suit === 'number' ? SUIT_INDEX_TO_SYMBOL[suit] : (SUIT_SYMBOLS[suit] ?? suit);
  const color = getCardColor(suit, false);
  const rankDisplay =
    typeof rank === 'number' ? serverRankDisplay(rank) : (rank ?? '?');

  return (
    <div
      className={`card2d card2d--deal${small ? ' card2d--small' : ''}`}
      style={{ '--card-color': color, animationDelay: `${dealDelay}s` }}
    >
      <div className="card2d__corner card2d__corner--tl">
        <span className="card2d__rank">{rankDisplay}</span>
        <span className="card2d__suit">{suitSymbol}</span>
      </div>
      <div className="card2d__center-suit">{suitSymbol}</div>
      <div className="card2d__corner card2d__corner--br">
        <span className="card2d__rank">{rankDisplay}</span>
        <span className="card2d__suit">{suitSymbol}</span>
      </div>
    </div>
  );
}
