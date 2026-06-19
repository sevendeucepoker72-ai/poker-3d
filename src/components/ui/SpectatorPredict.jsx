import React, { useState, useEffect, useCallback, useRef } from 'react';
import './SpectatorPredict.css';

// 2026-06-18 — Phase 3c: real, durable, SERVER-AUTHORITATIVE "predict the
// winner" game backed by poker-server (Postgres). Replaces the sessionStorage
// mock. The server stores the pick, compares it to the real hand winner, and
// keeps the durable streak/accuracy — the client just renders.
//   emit  getPredictionStats
//         placePrediction { tableId, handId, predictedSeat }
//   recv  predictionStats { stats:{correct,total,streak,bestStreak} }
//         spectatorResult { handNumber, winnerSeat, correct, stats }

const EMPTY_STATS = { correct: 0, total: 0, streak: 0, bestStreak: 0 };

export default function SpectatorPredict({ tableId: tableIdProp, gameState, socket, visible, onClose }) {
  const [prediction, setPrediction] = useState(null);       // seatIndex of predicted winner
  const [result, setResult] = useState(null);               // { winner, correct }
  const [stats, setStats] = useState(EMPTY_STATS);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const handIdRef = useRef(null);

  const tableId = tableIdProp ?? gameState?.tableId;
  const handId = gameState?.handId ?? gameState?.handNumber ?? null;

  // Active (non-folded) players from game state
  const activePlayers = (gameState?.seats ?? [])
    .map((s, i) => ({ ...s, seatIndex: i }))
    .filter(s => s && s.active && !s.folded && s.playerName);

  const phase = gameState?.phase ?? '';
  const isPreFlop = phase === 'PreFlop';

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // Reset prediction on new hand
  useEffect(() => {
    if (handId && handId !== handIdRef.current) {
      handIdRef.current = handId;
      setPrediction(null);
      setResult(null);
    }
  }, [handId]);

  // Load durable stats + listen for the authoritative result.
  useEffect(() => {
    if (!socket) return undefined;
    const onStats = (d) => { if (d?.stats) setStats(d.stats); };
    const onResult = ({ winnerSeat, correct, stats: s }) => {
      setResult({ winner: winnerSeat, correct });
      if (s) setStats(s);
      showToast(correct ? 'Correct! +1 streak' : 'Wrong — streak reset');
    };
    socket.on('predictionStats', onStats);
    socket.on('spectatorResult', onResult);
    if (socket.connected) socket.emit('getPredictionStats');
    return () => {
      socket.off('predictionStats', onStats);
      socket.off('spectatorResult', onResult);
    };
  }, [socket, showToast]);

  const handlePick = useCallback((seatIndex) => {
    if (result) return;        // already resolved this hand
    setPrediction(seatIndex);
    if (socket?.connected && tableId && handId != null) {
      socket.emit('placePrediction', { tableId, handId, predictedSeat: seatIndex });
    }
  }, [result, socket, tableId, handId]);

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
