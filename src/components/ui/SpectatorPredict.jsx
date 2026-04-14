import React, { useState, useEffect, useCallback, useRef } from 'react';
import './SpectatorPredict.css';

const STORAGE_KEY = 'sp_stats';

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { correct: 0, total: 0, streak: 0, bestStreak: 0, leaderboard: [] };
}

function saveStats(stats) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch { /* ignore */ }
}

export default function SpectatorPredict({ tableId, gameState, socket, visible, onClose }) {
  const [prediction, setPrediction] = useState(null);       // seatIndex of predicted winner
  const predictionRef = useRef(prediction);
  predictionRef.current = prediction;
  const [result, setResult] = useState(null);               // { winner, correct }
  const [stats, setStats] = useState(loadStats);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const handIdRef = useRef(null);

  // Active (non-folded) players from game state
  const activePlayers = (gameState?.seats ?? [])
    .map((s, i) => ({ ...s, seatIndex: i }))
    .filter(s => s && s.active && !s.folded && s.playerName);

  const phase = gameState?.phase ?? '';
  const isPreFlop = phase === 'PreFlop';
  const isHandComplete = phase === 'HandComplete' || phase === 'Showdown';
  const handId = gameState?.handId ?? null;

  // Reset prediction on new hand
  useEffect(() => {
    if (handId && handId !== handIdRef.current) {
      handIdRef.current = handId;
      setPrediction(null);
      setResult(null);
    }
  }, [handId]);

  // Listen for hand result via socket
  useEffect(() => {
    if (!socket) return;
    const handleResult = (data) => {
      if (predictionRef.current === null) return;
      const winnerSeat = data?.winners?.[0]?.seatIndex ?? data?.winnerSeat ?? null;
      if (winnerSeat === null) return;
      const correct = winnerSeat === predictionRef.current;
      setResult({ winner: winnerSeat, correct });

      setStats(prev => {
        const next = {
          correct: prev.correct + (correct ? 1 : 0),
          total: prev.total + 1,
          streak: correct ? prev.streak + 1 : 0,
          bestStreak: correct ? Math.max(prev.bestStreak, prev.streak + 1) : prev.bestStreak,
          leaderboard: prev.leaderboard,
        };
        saveStats(next);
        return next;
      });

      if (correct) showToast('Correct! +1 streak');
      else showToast('Wrong — streak reset');
    };
    // 'handResult' is the actual server event; 'hand:result'/'hand:winners' kept for compatibility
    socket.on('handResult', handleResult);
    socket.on('hand:result', handleResult);
    socket.on('hand:winners', handleResult);
    return () => {
      socket.off('handResult', handleResult);
      socket.off('hand:result', handleResult);
      socket.off('hand:winners', handleResult);
    };
  }, [socket]);

  // Also detect winner from gameState changes (fallback if no socket event)
  useEffect(() => {
    if (!isHandComplete || prediction === null || result) return;
    const winners = gameState?.lastWinners ?? gameState?.winners;
    if (winners && winners.length > 0) {
      const winnerSeat = winners[0]?.seatIndex ?? winners[0];
      if (typeof winnerSeat === 'number') {
        const correct = winnerSeat === prediction;
        setResult({ winner: winnerSeat, correct });
        setStats(prev => {
          const next = {
            correct: prev.correct + (correct ? 1 : 0),
            total: prev.total + 1,
            streak: correct ? prev.streak + 1 : 0,
            bestStreak: correct ? Math.max(prev.bestStreak, prev.streak + 1) : prev.bestStreak,
            leaderboard: prev.leaderboard,
          };
          saveStats(next);
          return next;
        });
        if (correct) showToast('Correct! +1 streak');
        else showToast('Wrong — streak reset');
      }
    }
  }, [isHandComplete, gameState?.lastWinners, gameState?.winners]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const handlePick = useCallback((seatIndex) => {
    if (result) return; // already resolved
    setPrediction(seatIndex);
  }, [result]);

  const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
  const locked = prediction !== null && !isPreFlop; // lock after preflop

  if (!visible) return null;

  return (
    <div className="sp-widget">
      {toast && <div className="sp-toast">{toast}</div>}

      {/* Header */}
      <div className="sp-header">
        <span className="sp-title">
          <span className="sp-icon">🔮</span> Predict the Winner
        </span>
        <button className="sp-close-btn" onClick={onClose}>✕</button>
      </div>

      {/* Player pills */}
      <div className="sp-pills-row">
        {activePlayers.length === 0 ? (
          <span className="sp-waiting">Waiting for hand to start…</span>
        ) : (
          activePlayers.map(p => {
            const isSelected = prediction === p.seatIndex;
            const isWinner = result && result.winner === p.seatIndex;
            const isCorrect = result && isSelected && result.correct;
            const isWrong = result && isSelected && !result.correct;

            let cls = 'sp-pill';
            if (isCorrect) cls += ' sp-pill--correct';
            else if (isWrong) cls += ' sp-pill--wrong';
            else if (isSelected) cls += ' sp-pill--selected';
            else if (isWinner) cls += ' sp-pill--winner';

            return (
              <button
                key={p.seatIndex}
                className={cls}
                disabled={locked && !isSelected}
                onClick={() => handlePick(p.seatIndex)}
              >
                {p.playerName}
                {isSelected && !result && <span className="sp-check"> ✓</span>}
                {isCorrect && ' ✅'}
                {isWrong && ' ❌'}
                {isWinner && !isSelected && ' 👑'}
              </button>
            );
          })
        )}
      </div>

      {/* Stats bar */}
      <div className="sp-stats-bar">
        <span className="sp-stat">
          <span className="sp-stat-label">Accuracy</span>
          <span className="sp-stat-value">{accuracy}%</span>
        </span>
        <span className="sp-divider">|</span>
        <span className="sp-stat">
          <span className="sp-stat-label">Streak</span>
          <span className="sp-stat-value">{stats.streak}</span>
        </span>
        <span className="sp-divider">|</span>
        <span className="sp-stat">
          <span className="sp-stat-label">Best</span>
          <span className="sp-stat-value">{stats.bestStreak}</span>
        </span>
        <span className="sp-divider">|</span>
        <span className="sp-stat">
          <span className="sp-stat-label">Total</span>
          <span className="sp-stat-value">{stats.correct}/{stats.total}</span>
        </span>
      </div>
    </div>
  );
}
