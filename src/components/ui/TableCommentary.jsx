import { useState, useEffect, useRef } from 'react';
import { useThrottle } from '../../hooks/useThrottle';
import './TableCommentary.css';

const MAX_ENTRIES = 40;

// Fallback local commentary for when LLM isn't available
function generateLocalComment(event) {
  const { type, playerName, amount, pot, handStrength } = event;
  switch (type) {
    case 'allin':
      return `${playerName} moves ALL-IN for ${amount?.toLocaleString()} chips! The table goes quiet.`;
    case 'bigbluff':
      return `${playerName} fires a massive bluff of ${amount?.toLocaleString()} into a ${pot?.toLocaleString()} pot. Gutsy play.`;
    case 'bigwin':
      return `${playerName} takes down the pot of ${amount?.toLocaleString()} chips! What a hand.`;
    case 'showdown':
      return `Cards on their backs! ${playerName} turns over ${handStrength || 'a strong hand'}.`;
    case 'fold':
      return amount > 1000
        ? `${playerName} folds under pressure — leaving ${amount?.toLocaleString()} chips in the pot.`
        : null;
    case 'raise':
      return amount > 5000
        ? `${playerName} puts on the pressure with a ${amount?.toLocaleString()} chip raise!`
        : null;
    case 'elimination':
      return `${playerName} has been eliminated! They hit the rail in style.`;
    case 'badbeat':
      return `Brutal bad beat! ${playerName} ran into the worst of luck there.`;
    default:
      return null;
  }
}

export default function TableCommentary({ socket, gameState: gameStateRaw, visible, onClose }) {
  const gameState = useThrottle(gameStateRaw, 400);
  const [entries, setEntries] = useState([]);
  const [minimized, setMinimized] = useState(false);
  const feedRef = useRef(null);
  const prevGameRef = useRef(null);

  const addEntry = (text, type = 'normal') => {
    if (!text) return;
    setEntries(prev => {
      const next = [...prev, { id: Date.now() + Math.random(), text, type, ts: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }];
      return next.slice(-MAX_ENTRIES);
    });
  };

  // Listen for LLM commentary from server
  useEffect(() => {
    if (!socket) return;
    const handler = ({ text, type }) => addEntry(text, type || 'llm');
    socket.on('tableCommentary', handler);
    return () => socket.off('tableCommentary', handler);
  }, [socket]);

  // Local event detection from gameState changes
  useEffect(() => {
    if (!gameState) return;
    const prev = prevGameRef.current;
    if (!prev) { prevGameRef.current = gameState; return; }

    const seats = gameState.seats || [];
    const prevSeats = prev.seats || [];

    // Detect all-ins
    seats.forEach((seat, i) => {
      const prevSeat = prevSeats[i];
      if (!seat || !seat.playerName) return;
      if (seat.isAllIn && !prevSeat?.isAllIn) {
        addEntry(generateLocalComment({ type: 'allin', playerName: seat.playerName, amount: seat.chips }), 'allin');
      }
      // Detect elimination
      if (seat.chips === 0 && prevSeat?.chips > 0 && seat.folded) {
        addEntry(generateLocalComment({ type: 'elimination', playerName: seat.playerName }), 'elimination');
      }
    });

    // Detect big pot wins (phase changes to HandComplete)
    if (gameState.phase === 'HandComplete' && prev.phase !== 'HandComplete') {
      const pot = gameState.pot || 0;
      if (pot > 2000) {
        const winner = seats.find(s => s && !s.folded && s.lastAction !== 'fold');
        if (winner) {
          addEntry(generateLocalComment({ type: 'bigwin', playerName: winner.playerName, amount: pot }), 'bigwin');
        }
      }
    }

    prevGameRef.current = gameState;
  }, [gameState]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (feedRef.current && !minimized) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [entries, minimized]);

  // Seed with welcome message on mount
  useEffect(() => {
    addEntry('Welcome to the table! Commentary is live.', 'system');
  }, []);

  if (!visible) return null;

  return (
    <div className={`commentary-panel ${minimized ? 'commentary-panel--mini' : ''}`}>
      <div className="commentary-header">
        <span className="commentary-title">📢 Live Commentary</span>
        <div className="commentary-controls">
          <button className="commentary-btn" onClick={() => setMinimized(m => !m)} title={minimized ? 'Expand' : 'Minimize'}>
            {minimized ? '▲' : '▼'}
          </button>
          <button className="commentary-btn commentary-btn--close" onClick={onClose}>×</button>
        </div>
      </div>

      {!minimized && (
        <div className="commentary-feed" ref={feedRef}>
          {entries.length === 0 && (
            <div className="commentary-empty">Waiting for action…</div>
          )}
          {entries.map(entry => (
            <div key={entry.id} className={`commentary-entry commentary-entry--${entry.type}`}>
              <span className="commentary-ts">{entry.ts}</span>
              <span className="commentary-text">{entry.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
