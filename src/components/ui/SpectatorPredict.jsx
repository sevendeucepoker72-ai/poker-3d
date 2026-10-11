import React, { useState, useEffect, useCallback, useRef } from 'react';
import { safeName } from '../../utils/tablePayload';
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

  // R2 (APPUI-46) — the seats still in THIS hand: occupied, not folded,
  // dealt in. (It filtered on `s.active`, which no server sends, so the
  // list was always empty: "Waiting for hand to start…" forever.)
  const activePlayers = (gameState?.seats ?? [])
    .map((s, i) => ({ ...s, seatIndex: i }))
    .filter(s => s && s.state === 'occupied' && !s.folded && s.hasCards !== false && safeName(s.playerName, ''));

  const phase = gameState?.phase ?? '';
  const isPreFlop = phase === 'PreFlop';
  // R2 (APPUI-45) — the server takes a pick only for the hand in progress,
  // before the river (predictionWindowClosed 'pick').
  const picksOpen = phase === 'PreFlop' || phase === 'Flop' || phase === 'Turn';

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
  const pickSentAtRef = useRef(0);
  useEffect(() => {
    if (!socket) return undefined;
    const onStats = (d) => { if (d?.stats) setStats(d.stats); };
    // A refused pick (late, hand over) — shown only for a pick just sent
    // (the prediction market shares the event).
    const onPickError = (d) => {
      if (Date.now() - pickSentAtRef.current > 3000) return;
      pickSentAtRef.current = 0;
      setPrediction(null);
      showToast(typeof d?.message === 'string' && d.message ? d.message : 'Pick not taken');
    };
    socket.on('predictionError', onPickError);
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
      socket.off('predictionError', onPickError);
    };
  }, [socket, showToast]);

  const handlePick = useCallback((seatIndex) => {
    if (result || !picksOpen) return;        // resolved, or closed at the river
    setPrediction(seatIndex);
    if (socket?.connected && tableId && handId != null) {
      pickSentAtRef.current = Date.now();
      socket.emit('placePrediction', { tableId, handId, predictedSeat: seatIndex });
    }
  }, [result, picksOpen, socket, tableId, handId]);

  const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
  const locked = (prediction !== null && !isPreFlop) || !picksOpen; // lock after preflop; closed at the river

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
                {safeName(p.playerName, 'Player')}
                {isSelected && !result && <span className="sp-check"> ✓</span>}
                {isCorrect && ' ✅'}
                {isWrong && ' ❌'}
                {isWinner && !isSelected && ' 👑'}
              </button>
            );
          })
        )}
      </div>

      {!result && activePlayers.length > 0 && (
        <div className="sp-window-note">{picksOpen ? 'Picks close when the river is dealt' : 'Picks are closed for this hand'}</div>
      )}

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
