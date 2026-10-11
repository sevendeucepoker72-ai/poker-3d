import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { useProgressStore } from '../../store/progressStore';
import { formatReward, rewardKind, shopErrorText } from '../../utils/economyCatalog';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
import './ScratchCards.css';

// 2026-10-11 (.online R2 — APPUI-38). Scratch cards are banked by the SERVER
// (one per 20 hands; playerProgress.scratchCardsAvailable — no local count).
// `claimScratchCard` consumes one and answers `scratchCardRevealed
// { success, reward }`; the grid is only the reveal animation for that
// reward, and the result line is the server's reward in words ("Won 4,210
// chips", "Won the Fire emote") — never "Won 0 item!". Opened from the Shop's
// "Reveal" with `autoStart`, the first card is scratched at once.

const SYMBOLS = {
  chips: { icon: '💰', name: 'Money Bag' },
  stars: { icon: '⭐', name: 'Star' },
  item: { icon: '💎', name: 'Diamond' },
  xp: { icon: '⚡', name: 'Bolt' },
};
const FILLER = ['🎰', '🃏', '🍀', '🎲'];
const ANSWER_TIMEOUT_MS = 10000;

function buildGrid(winnerIcon) {
  const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const win = new Set(positions.slice(0, 3));
  const fillers = FILLER.filter((f) => f !== winnerIcon);
  const grid = [];
  const used = {};
  for (let i = 0; i < 9; i++) {
    if (win.has(i)) { grid.push({ icon: winnerIcon, isWinner: true }); continue; }
    // never three of the same filler (only the reward matches three times)
    let pick = fillers[Math.floor(Math.random() * fillers.length)];
    if ((used[pick] || 0) >= 2) pick = fillers.find((f) => (used[f] || 0) < 2) || pick;
    used[pick] = (used[pick] || 0) + 1;
    grid.push({ icon: pick, isWinner: false });
  }
  return grid;
}

const SCRATCH_ERRORS = {
  no_cards_available: 'No scratch cards left — play more hands to earn one.',
  'not authenticated': 'Sign in to use scratch cards.',
};

export default function ScratchCards({ onClose, autoStart = false }) {
  const serverCards = useProgressStore((s) => s.progress?.scratchCardsAvailable);
  const cardsAvailable = Math.max(0, Number(serverCards) || 0);
  const [grid, setGrid] = useState(null);
  const [revealed, setRevealed] = useState(new Set());
  const [result, setResult] = useState(null); // { text, icon }
  const [pendingReveal, setPendingReveal] = useState(null); // server reward awaiting animation
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(null);
  const listenerRef = useRef(null);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  const startedRef = useRef(false);

  useBackButtonClose(true, onClose);

  const stopListening = () => {
    const s = getSocket();
    if (s && listenerRef.current) s.off('scratchCardRevealed', listenerRef.current);
    listenerRef.current = null;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; stopListening(); };
  }, []);

  const startNewCard = useCallback(() => {
    if (waiting) return;
    const socket = getSocket();
    if (!socket || !socket.connected) { setError('Not connected — try again in a moment.'); return; }
    setError(null);
    setWaiting(true);
    stopListening();
    const onRevealed = (res) => {
      stopListening();
      if (!mountedRef.current) return;
      setWaiting(false);
      if (!res?.success) {
        const code = String(res?.error || '').toLowerCase();
        setError(SCRATCH_ERRORS[code] || shopErrorText(res?.error, 'Could not reveal a card — try again.'));
        return;
      }
      const reward = res.reward || {};
      const symbol = SYMBOLS[rewardKind(reward)] || SYMBOLS.chips;
      setPendingReveal({ reward, symbol });
      setGrid(buildGrid(symbol.icon));
      setRevealed(new Set());
      setResult(null);
    };
    listenerRef.current = onRevealed;
    socket.on('scratchCardRevealed', onRevealed);
    timerRef.current = setTimeout(() => {
      stopListening();
      if (!mountedRef.current) return;
      setWaiting(false);
      setError('The game server did not answer — try again.');
    }, ANSWER_TIMEOUT_MS);
    socket.emit('claimScratchCard');
  }, [waiting]);

  // Opened from the Shop's "Reveal": scratch one card right away.
  useEffect(() => {
    if (!autoStart || startedRef.current) return;
    if (cardsAvailable > 0) {
      startedRef.current = true;
      startNewCard();
    }
  }, [autoStart, cardsAvailable, startNewCard]);

  const finishReveal = useCallback(() => {
    if (!pendingReveal) return;
    const { reward, symbol } = pendingReveal;
    setResult({ text: `Won ${formatReward(reward)}!`, icon: symbol.icon });
    setRevealed(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]));
    setPendingReveal(null);
  }, [pendingReveal]);

  const revealCell = useCallback((index) => {
    if (!pendingReveal || revealed.has(index)) return;
    const next = new Set(revealed);
    next.add(index);
    setRevealed(next);
    if (next.size === 9) finishReveal();
  }, [pendingReveal, revealed, finishReveal]);

  // Batch "scratch all" — one card at a time (each answer starts the next).
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchSummary, setBatchSummary] = useState(null); // { cards, chips, stars, items: [] }
  const scratchAll = useCallback(() => {
    if (cardsAvailable <= 0 || batchRunning) return;
    const socket = getSocket();
    if (!socket || !socket.connected) { setError('Not connected — try again in a moment.'); return; }
    setBatchRunning(true);
    setGrid(null);
    setResult(null);
    setError(null);
    let remaining = cardsAvailable;
    const totals = { cards: 0, chips: 0, stars: 0, items: [] };
    const done = () => {
      stopListening();
      if (!mountedRef.current) return;
      setBatchRunning(false);
      setBatchSummary(totals);
    };
    const onRevealed = (res) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (!res?.success) { done(); return; }
      const r = res.reward || {};
      totals.cards += 1;
      const k = rewardKind(r);
      if (k === 'chips') totals.chips += Number(r.amount ?? r.chips) || 0;
      else if (k === 'stars') totals.stars += Number(r.amount ?? r.stars) || 0;
      else if (k === 'item') totals.items.push(formatReward(r).replace(/^the /, ''));
      remaining -= 1;
      if (remaining > 0) {
        timerRef.current = setTimeout(done, ANSWER_TIMEOUT_MS);
        socket.emit('claimScratchCard');
      } else {
        done();
      }
    };
    stopListening();
    listenerRef.current = onRevealed;
    socket.on('scratchCardRevealed', onRevealed);
    timerRef.current = setTimeout(done, ANSWER_TIMEOUT_MS);
    socket.emit('claimScratchCard');
  }, [cardsAvailable, batchRunning]);

  const matchedIcon = result ? result.icon : null;

  return createPortal(
    <div className="scratch-overlay" onClick={onClose}>
      <div className="scratch-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Scratch cards">
        <div className="scratch-header">
          <div className="scratch-title">Scratch Cards</div>
          <button className="scratch-close" onClick={onClose}>Close</button>
        </div>

        <div className="scratch-cards-count">
          Cards ready: <span>{cardsAvailable}</span>
        </div>

        {error && <div className="scratch-error">{error}</div>}

        {batchSummary ? (
          <div className="scratch-result win" style={{ padding: '16px' }}>
            <div className="scratch-result-text" style={{ fontSize: '0.95rem' }}>
              Scratched {batchSummary.cards} card{batchSummary.cards === 1 ? '' : 's'}
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
              {batchSummary.chips > 0 && <span>🪙 +{batchSummary.chips.toLocaleString()} chips</span>}
              {batchSummary.stars > 0 && <span style={{ color: '#FFD700' }}>⭐ +{batchSummary.stars.toLocaleString()} stars</span>}
              {batchSummary.items.map((name, i) => <span key={i} style={{ color: '#A78BFA' }}>💎 {name}</span>)}
              {batchSummary.cards === 0 && <span>Nothing was scratched — try again.</span>}
            </div>
            <button className="scratch-new-btn" style={{ marginTop: 14 }} onClick={() => setBatchSummary(null)}>Done</button>
          </div>
        ) : !grid ? (
          cardsAvailable > 0 ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <button className="scratch-new-btn" onClick={startNewCard} disabled={batchRunning || waiting}>
                {waiting ? 'Scratching…' : 'Use Scratch Card'}
              </button>
              {cardsAvailable >= 2 && (
                <button
                  className="scratch-new-btn scratch-all-btn"
                  style={{ marginTop: 8 }}
                  onClick={scratchAll}
                  disabled={batchRunning || waiting}
                >
                  {batchRunning ? 'Scratching…' : `Scratch All (${cardsAvailable})`}
                </button>
              )}
              <div className="scratch-earn-info">You bank one card for every 20 hands you play.</div>
            </div>
          ) : (
            <div className="scratch-no-cards">
              <span className="scratch-no-cards-icon">{'🎴'}</span>
              No scratch cards ready.
              <div className="scratch-earn-info">Keep playing — you bank a scratch card every 20 hands.</div>
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

            {pendingReveal && (
              <button className="scratch-reveal-all" onClick={finishReveal}>Reveal all</button>
            )}

            {result && (
              <div className="scratch-result win">
                <div className="scratch-result-text">{result.icon} {result.text}</div>
              </div>
            )}

            {!pendingReveal && cardsAvailable > 0 && (
              <button className="scratch-new-btn" onClick={startNewCard} disabled={waiting}>
                {waiting ? 'Scratching…' : `Use Another Card (${cardsAvailable} left)`}
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
