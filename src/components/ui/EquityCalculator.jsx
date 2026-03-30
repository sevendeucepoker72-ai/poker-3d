import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { evaluateHandStrength } from '../../utils/handStrength';
import './EquityCalculator.css';

const RANK_OPTIONS = [
  { value: '', label: '-' },
  { value: '14', label: 'A' },
  { value: '13', label: 'K' },
  { value: '12', label: 'Q' },
  { value: '11', label: 'J' },
  { value: '10', label: 'T' },
  { value: '9', label: '9' },
  { value: '8', label: '8' },
  { value: '7', label: '7' },
  { value: '6', label: '6' },
  { value: '5', label: '5' },
  { value: '4', label: '4' },
  { value: '3', label: '3' },
  { value: '2', label: '2' },
];

const SUIT_OPTIONS = [
  { value: '', label: '-' },
  { value: '0', label: '\u2660' },  // spades
  { value: '1', label: '\u2665' },  // hearts
  { value: '2', label: '\u2666' },  // diamonds
  { value: '3', label: '\u2663' },  // clubs
];

function compareEval(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const aTb = a.tiebreaker || [];
  const bTb = b.tiebreaker || [];
  for (let i = 0; i < Math.min(aTb.length, bTb.length); i++) {
    if (aTb[i] !== bTb[i]) return aTb[i] - bTb[i];
  }
  return 0;
}

function makeCard(rank, suit) {
  if (rank === '' || suit === '') return null;
  return { rank: Number(rank), suit: Number(suit) };
}

function CardSelector({ card, onChange, label }) {
  return (
    <div className="equity-card-selector">
      <select
        value={card.rank}
        onChange={(e) => onChange({ ...card, rank: e.target.value })}
        title={`${label} rank`}
      >
        {RANK_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select
        value={card.suit}
        onChange={(e) => onChange({ ...card, suit: e.target.value })}
        title={`${label} suit`}
      >
        {SUIT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export default function EquityCalculator({ onClose }) {
  const [hand1, setHand1] = useState([
    { rank: '', suit: '' },
    { rank: '', suit: '' },
  ]);
  const [hand2, setHand2] = useState([
    { rank: '', suit: '' },
    { rank: '', suit: '' },
  ]);
  const [board, setBoard] = useState([
    { rank: '', suit: '' },
    { rank: '', suit: '' },
    { rank: '', suit: '' },
    { rank: '', suit: '' },
    { rank: '', suit: '' },
  ]);
  const [result, setResult] = useState(null);

  const updateHand1Card = (index, card) => {
    const newHand = [...hand1];
    newHand[index] = card;
    setHand1(newHand);
  };

  const updateHand2Card = (index, card) => {
    const newHand = [...hand2];
    newHand[index] = card;
    setHand2(newHand);
  };

  const updateBoardCard = (index, card) => {
    const newBoard = [...board];
    newBoard[index] = card;
    setBoard(newBoard);
  };

  const canCalculate = () => {
    // Both hands must have 2 valid cards
    const h1Cards = hand1.map((c) => makeCard(c.rank, c.suit)).filter(Boolean);
    const h2Cards = hand2.map((c) => makeCard(c.rank, c.suit)).filter(Boolean);
    return h1Cards.length === 2 && h2Cards.length === 2;
  };

  const calculate = useCallback(() => {
    const h1Cards = hand1.map((c) => makeCard(c.rank, c.suit)).filter(Boolean);
    const h2Cards = hand2.map((c) => makeCard(c.rank, c.suit)).filter(Boolean);
    const boardCards = board.map((c) => makeCard(c.rank, c.suit)).filter(Boolean);

    if (h1Cards.length < 2 || h2Cards.length < 2) return;

    // If we have enough board cards (3+), evaluate directly
    if (boardCards.length >= 3) {
      const eval1 = evaluateHandStrength(h1Cards, boardCards);
      const eval2 = evaluateHandStrength(h2Cards, boardCards);

      // Compare by rank first, then tiebreaker for ties
      let eq1, eq2;
      const cmp = compareEval(eval1, eval2);
      if (cmp > 0) {
        eq1 = 100;
        eq2 = 0;
      } else if (cmp < 0) {
        eq1 = 0;
        eq2 = 100;
      } else {
        eq1 = 50;
        eq2 = 50;
      }

      setResult({
        hand1Equity: eq1,
        hand2Equity: eq2,
        hand1Name: eval1.name,
        hand2Name: eval2.name,
      });
    } else {
      // No board or partial board: run a simple Monte Carlo simulation
      // Generate random boards and average
      const iterations = 2000;
      let h1Wins = 0;
      let h2Wins = 0;
      let ties = 0;

      const usedCards = new Set();
      [...h1Cards, ...h2Cards, ...boardCards].forEach((c) => {
        usedCards.add(`${c.rank}-${c.suit}`);
      });

      // Build deck of remaining cards
      const deck = [];
      for (let r = 2; r <= 14; r++) {
        for (let s = 0; s <= 3; s++) {
          if (!usedCards.has(`${r}-${s}`)) {
            deck.push({ rank: r, suit: s });
          }
        }
      }

      const cardsNeeded = 5 - boardCards.length;

      for (let i = 0; i < iterations; i++) {
        // Shuffle and pick needed cards
        const shuffled = [...deck];
        for (let j = shuffled.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
        }

        const simBoard = [...boardCards, ...shuffled.slice(0, cardsNeeded)];
        const eval1 = evaluateHandStrength(h1Cards, simBoard);
        const eval2 = evaluateHandStrength(h2Cards, simBoard);

        const cmp = compareEval(eval1, eval2);
        if (cmp > 0) h1Wins++;
        else if (cmp < 0) h2Wins++;
        else ties++;
      }

      const total = h1Wins + h2Wins + ties;
      const eq1 = Math.round(((h1Wins + ties * 0.5) / total) * 100);
      const eq2 = 100 - eq1;

      // Get hand names for current board if available
      let hand1Name = 'N/A';
      let hand2Name = 'N/A';
      if (boardCards.length >= 3) {
        hand1Name = evaluateHandStrength(h1Cards, boardCards).name;
        hand2Name = evaluateHandStrength(h2Cards, boardCards).name;
      }

      setResult({
        hand1Equity: eq1,
        hand2Equity: eq2,
        hand1Name,
        hand2Name,
      });
    }
  }, [hand1, hand2, board]);

  return createPortal(
    <div className="equity-calc-overlay" onClick={onClose}>
      <div className="equity-calc-panel" onClick={(e) => e.stopPropagation()}>
        <div className="equity-calc-header">
          <span className="equity-calc-title">Equity Calculator</span>
          <button className="equity-calc-close" onClick={onClose}>Close</button>
        </div>

        <div className="equity-hands-row">
          <div className="equity-hand-group">
            <div className="equity-hand-label">Hand 1</div>
            <div className="equity-card-selectors">
              <CardSelector
                card={hand1[0]}
                onChange={(c) => updateHand1Card(0, c)}
                label="Hand 1, Card 1"
              />
              <CardSelector
                card={hand1[1]}
                onChange={(c) => updateHand1Card(1, c)}
                label="Hand 1, Card 2"
              />
            </div>
          </div>

          <div className="equity-hand-group">
            <div className="equity-hand-label">Hand 2</div>
            <div className="equity-card-selectors">
              <CardSelector
                card={hand2[0]}
                onChange={(c) => updateHand2Card(0, c)}
                label="Hand 2, Card 1"
              />
              <CardSelector
                card={hand2[1]}
                onChange={(c) => updateHand2Card(1, c)}
                label="Hand 2, Card 2"
              />
            </div>
          </div>
        </div>

        <div className="equity-board-section">
          <div className="equity-board-label">Board (optional)</div>
          <div className="equity-board-cards">
            {board.map((card, i) => (
              <div key={i} className="equity-board-card">
                <CardSelector
                  card={card}
                  onChange={(c) => updateBoardCard(i, c)}
                  label={`Board card ${i + 1}`}
                />
              </div>
            ))}
          </div>
          <div className="equity-board-hint">
            Leave empty for preflop, add 3 for flop, 4 for turn, 5 for river
          </div>
        </div>

        <button
          className="equity-calc-btn"
          onClick={calculate}
          disabled={!canCalculate()}
        >
          Calculate Equity
        </button>

        {result && (
          <div className="equity-results">
            <div className="equity-result-row">
              <span className="equity-result-label">Hand 1</span>
              <div className="equity-result-bar-container">
                <div
                  className="equity-result-bar hand1"
                  style={{ width: `${result.hand1Equity}%` }}
                >
                  <span className="equity-result-pct">{result.hand1Equity}%</span>
                </div>
              </div>
            </div>
            {result.hand1Name !== 'N/A' && (
              <div className="equity-result-hand-name" style={{ marginLeft: '70px' }}>
                {result.hand1Name}
              </div>
            )}

            <div className="equity-vs">VS</div>

            <div className="equity-result-row">
              <span className="equity-result-label">Hand 2</span>
              <div className="equity-result-bar-container">
                <div
                  className="equity-result-bar hand2"
                  style={{ width: `${result.hand2Equity}%` }}
                >
                  <span className="equity-result-pct">{result.hand2Equity}%</span>
                </div>
              </div>
            </div>
            {result.hand2Name !== 'N/A' && (
              <div className="equity-result-hand-name" style={{ marginLeft: '70px' }}>
                {result.hand2Name}
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
