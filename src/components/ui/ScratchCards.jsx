import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { useProgressStore } from '../../store/progressStore';
import './ScratchCards.css';

const SYMBOLS = [
  { icon: '\uD83D\uDCB0', name: 'Money Bag', prize: 1000, prizeType: 'chips' },
  { icon: '\u2B50', name: 'Star', prize: 500, prizeType: 'xp' },
  { icon: '\uD83C\uDFB0', name: 'Slot Machine', prize: 250, prizeType: 'chips' },
  { icon: '\uD83D\uDC8E', name: 'Diamond', prize: 2000, prizeType: 'chips' },
];

const CARDS_KEY = 'poker_scratch_cards';
const HANDS_KEY = 'poker_hands_since_scratch';

export function checkScratchCardEarned() {
  try {
    let hands = parseInt(sessionStorage.getItem(HANDS_KEY) || '0', 10);
    hands += 1;
    if (hands >= 10) {
      const cards = parseInt(sessionStorage.getItem(CARDS_KEY) || '0', 10);
      sessionStorage.setItem(CARDS_KEY, String(cards + 1));
      sessionStorage.setItem(HANDS_KEY, '0');
      return true;
    }
    sessionStorage.setItem(HANDS_KEY, String(hands));
    return false;
  } catch {
    return false;
  }
}

function getAvailableCards() {
  try {
    return parseInt(sessionStorage.getItem(CARDS_KEY) || '0', 10);
  } catch {
    return 0;
  }
}

function useCard() {
  try {
    const cards = getAvailableCards();
    if (cards > 0) {
      sessionStorage.setItem(CARDS_KEY, String(cards - 1));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function generateGrid() {
  // Create a 3x3 grid with random symbols
  // Roughly 25% chance of a match-3 win
  const grid = [];
  const shouldWin = Math.random() < 0.25;

  if (shouldWin) {
    // Pick a winning symbol
    const winner = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    // Place 3 of the same, fill rest randomly
    const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    // Shuffle positions
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    const winPositions = positions.slice(0, 3);

    for (let i = 0; i < 9; i++) {
      if (winPositions.includes(i)) {
        grid.push({ ...winner, isWinner: true });
      } else {
        // Pick a different symbol
        const others = SYMBOLS.filter((s) => s.icon !== winner.icon);
        grid.push({ ...others[Math.floor(Math.random() * others.length)], isWinner: false });
      }
    }
  } else {
    // No win - ensure no symbol appears 3 times
    for (let i = 0; i < 9; i++) {
      grid.push({ ...SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)], isWinner: false });
    }
    // Verify no triple match and fix if needed
    const counts = {};
    grid.forEach((cell) => { counts[cell.icon] = (counts[cell.icon] || 0) + 1; });
    for (const [icon, count] of Object.entries(counts)) {
      if (count >= 3) {
        // Replace one to break the triple
        const idx = grid.findIndex((c) => c.icon === icon);
        const others = SYMBOLS.filter((s) => s.icon !== icon);
        grid[idx] = { ...others[Math.floor(Math.random() * others.length)], isWinner: false };
      }
    }
  }
  return grid;
}

export default function ScratchCards({ onClose }) {
  // Server is the source of truth for card count. Fall back to sessionStorage for
  // existing players until their next durableState hydration.
  const serverCards = useProgressStore((s) => s.progress?.scratchCardsAvailable);
  const cardsAvailable = serverCards != null ? serverCards : getAvailableCards();
  const [grid, setGrid] = useState(null);
  const [revealed, setRevealed] = useState(new Set());
  const [result, setResult] = useState(null);
  const [gameActive, setGameActive] = useState(false);
  const [pendingReveal, setPendingReveal] = useState(null); // server reward awaiting animation

  const startNewCard = useCallback(() => {
    if (cardsAvailable <= 0) return;
    const socket = getSocket();
    if (!socket) return;

    const onRevealed = (res) => {
      socket.off('scratchCardRevealed', onRevealed);
      if (!res?.success) {
        alert(res?.error === 'no_cards_available' ? 'No scratch cards available.' : 'Could not reveal');
        return;
      }

      // Pick a matching-3 SYMBOLS tile based on reward type for the animation.
      const reward = res.reward || {};
      let winnerSymbol;
      if (reward.stars) {
        winnerSymbol = SYMBOLS.find((s) => s.prizeType === 'xp') || SYMBOLS[1];
      } else if (reward.item) {
        winnerSymbol = SYMBOLS.find((s) => s.name === 'Diamond') || SYMBOLS[3];
      } else {
        winnerSymbol = SYMBOLS[0]; // chips
      }

      setPendingReveal({ winnerSymbol, reward });

      // Pre-render a grid with 3 of the winner symbol.
      const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
      }
      const winPositions = new Set(positions.slice(0, 3));
      const newGrid = [];
      for (let i = 0; i < 9; i++) {
        if (winPositions.has(i)) {
          newGrid.push({ ...winnerSymbol, isWinner: true });
        } else {
          const others = SYMBOLS.filter((s) => s.icon !== winnerSymbol.icon);
          newGrid.push({ ...others[Math.floor(Math.random() * others.length)], isWinner: false });
        }
      }

      setGrid(newGrid);
      setRevealed(new Set());
      setResult(null);
      setGameActive(true);
    };

    socket.on('scratchCardRevealed', onRevealed);
    socket.emit('claimScratchCard');
  }, [cardsAvailable]);

  const revealCell = useCallback((index) => {
    if (!gameActive || revealed.has(index)) return;

    const newRevealed = new Set(revealed);
    newRevealed.add(index);
    setRevealed(newRevealed);

    // When all cells revealed, show the server-determined reward.
    if (newRevealed.size === 9 && pendingReveal) {
      const { winnerSymbol, reward } = pendingReveal;
      setResult({
        win: true,
        prize: reward.chips || reward.stars || 0,
        prizeType: reward.stars ? 'stars' : reward.item ? 'item' : 'chips',
        icon: winnerSymbol.icon,
        name: winnerSymbol.name,
        serverLabel: reward.label,
      });
      setGameActive(false);
    }
  }, [gameActive, revealed, pendingReveal]);

  const matchedIcon = result?.win ? result.icon : null;

  return createPortal(
    <div className="scratch-overlay" onClick={onClose}>
      <div className="scratch-panel" onClick={(e) => e.stopPropagation()}>
        <div className="scratch-header">
          <div className="scratch-title">Scratch Cards</div>
          <button className="scratch-close" onClick={onClose}>Close</button>
        </div>

        <div className="scratch-cards-count">
          Available cards: <span>{cardsAvailable}</span>
        </div>

        {!grid ? (
          cardsAvailable > 0 ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <button className="scratch-new-btn" onClick={startNewCard}>
                Use Scratch Card
              </button>
              <div className="scratch-earn-info">
                Earn 1 card for every 10 hands played
              </div>
            </div>
          ) : (
            <div className="scratch-no-cards">
              <span className="scratch-no-cards-icon">{'\uD83C\uDFB4'}</span>
              No scratch cards available.
              <div className="scratch-earn-info">
                Play 10 more hands to earn a scratch card!
              </div>
            </div>
          )
        ) : (
          <>
            <div className="scratch-grid">
              {grid.map((cell, i) => (
                <div
                  key={i}
                  className={`scratch-cell ${revealed.has(i) ? 'revealed' : 'hidden'} ${revealed.has(i) && matchedIcon === cell.icon ? 'matched' : ''}`}
                  onClick={() => revealCell(i)}
                >
                  {revealed.has(i) && cell.icon}
                </div>
              ))}
            </div>

            {result && (
              <div className={`scratch-result ${result.win ? 'win' : 'lose'}`}>
                <div className="scratch-result-text">
                  {result.win
                    ? `${result.icon} Match! Won ${result.prize.toLocaleString()} ${result.prizeType}!`
                    : 'No match this time. Better luck next time!'}
                </div>
              </div>
            )}

            {!gameActive && cardsAvailable > 0 && (
              <button className="scratch-new-btn" onClick={startNewCard}>
                Use Another Card ({cardsAvailable} left)
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
