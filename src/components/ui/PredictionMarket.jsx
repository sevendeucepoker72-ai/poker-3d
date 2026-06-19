import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useThrottle } from '../../hooks/useThrottle';
import './PredictionMarket.css';

// 2026-06-18 — Phase 3c: real, durable, SERVER-AUTHORITATIVE prediction
// markets backed by poker-server (Postgres). Replaces the sessionStorage mock.
// The server owns the wallet, places bets, and is the ONLY thing that resolves
// outcomes (from the authoritative final hand state) — the client just renders.
//   emit  getPredictionWallet
//         placePredictionBet { tableId, handId, marketId, outcome, amount }
//   recv  predictionWallet     { balance }
//         predictionBetPlaced  { handNumber, balance, bet:{marketId,outcome,stake,odds,potentialWin} }
//         predictionSettled    { handNumber, balance, results:[{marketId,result,won,payout}] }
//         predictionError      { message }
//
// Markets are limited to the set the server can resolve honestly at
// hand-complete (must match MARKET_ODDS in predictionManager.ts).
const MARKET_QUESTIONS = [
  { id: 'showdown',    text: 'Will there be a showdown?',       odds: [55, 45] },
  { id: 'flopPaired',  text: 'Will the flop be paired?',        odds: [17, 83] },
  { id: 'allIn',       text: 'Will someone go all-in?',         odds: [12, 88] },
  { id: 'bigPot',      text: 'Will the pot exceed 5,000?',      odds: [30, 70] },
  { id: 'riverSeen',   text: 'Will the river be dealt?',        odds: [45, 55] },
  { id: 'foldPreflop', text: 'Will everyone fold preflop?',     odds: [15, 85] },
];

const MIN_STAKE = 10;
const MAX_STAKE = 500;

function pickActiveQuestions(handId) {
  // Deterministically pick 3 questions per hand using handId as seed
  const seed = typeof handId === 'number' ? handId : 0;
  const indices = [];
  const pool = [...Array(MARKET_QUESTIONS.length).keys()];
  let s = seed;
  while (indices.length < 3 && pool.length > 0) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const idx = Math.abs(s) % pool.length;
    indices.push(pool.splice(idx, 1)[0]);
  }
  return indices.map(i => MARKET_QUESTIONS[i]);
}

export default function PredictionMarket({ gameState: gameStateRaw, socket, visible, onClose }) {
  const gameState = useThrottle(gameStateRaw, 500);
  const [expanded, setExpanded]     = useState(false);
  const [balance, setBalance]       = useState(null);   // null until wallet loads
  const [activeMarkets, setActiveMarkets] = useState([]);
  const [positions, setPositions]   = useState({}); // marketId → { outcome, amount, potentialWin }
  const [resolved, setResolved]     = useState({}); // marketId → { outcome:'yes'|'no', won, payout }
  const [stakeInput, setStakeInput] = useState({}); // marketId → { open, outcome, value }
  const [toasts, setToasts]         = useState([]);
  const [currentHandId, setCurrentHandId] = useState(null);
  const currentHandRef = useRef(null);
  const prevHandIdRef = useRef(null);

  const tableId = gameState?.tableId;

  // Keep a ref of positions so the settle toast can read stake without
  // re-subscribing the socket listener on every bet.
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  // ─── Load the durable wallet on mount / when first shown ────────────────
  useEffect(() => {
    if (!socket) return undefined;
    const onWallet = (d) => { if (typeof d?.balance === 'number') setBalance(d.balance); };
    const onBetPlaced = ({ handNumber, balance: bal, bet }) => {
      if (handNumber !== currentHandRef.current || !bet) return;
      if (typeof bal === 'number') setBalance(bal);
      setPositions(prev => ({ ...prev, [bet.marketId]: { outcome: bet.outcome, amount: bet.stake, potentialWin: bet.potentialWin } }));
      setStakeInput(prev => ({ ...prev, [bet.marketId]: { ...prev[bet.marketId], open: false } }));
    };
    const onSettled = ({ handNumber, balance: bal, results }) => {
      if (typeof bal === 'number') setBalance(bal);
      if (!Array.isArray(results)) return;
      const newResolved = {};
      const newToasts = [];
      results.forEach(({ marketId, result, won, payout }) => {
        newResolved[marketId] = { outcome: result, won, payout };
        const q = MARKET_QUESTIONS.find(m => m.id === marketId);
        const label = q ? q.text.slice(0, 22) : marketId;
        newToasts.push({
          id: `${handNumber}-${marketId}`,
          type: won ? 'win' : 'loss',
          text: won ? `+${payout} chips (${label}…)` : `-${(positionsRef.current[marketId]?.amount) || ''} chips (${label}…)`,
        });
      });
      setResolved(prev => ({ ...prev, ...newResolved }));
      if (newToasts.length) {
        setToasts(t => [...t, ...newToasts]);
        setTimeout(() => setToasts(t => t.slice(newToasts.length)), 3500);
      }
    };
    const onErr = (d) => {
      setToasts(t => [...t, { id: `err-${Date.now()}`, type: 'loss', text: d?.message || 'Bet rejected' }]);
      setTimeout(() => setToasts(t => t.slice(1)), 3000);
    };
    socket.on('predictionWallet', onWallet);
    socket.on('predictionBetPlaced', onBetPlaced);
    socket.on('predictionSettled', onSettled);
    socket.on('predictionError', onErr);
    if (socket.connected) socket.emit('getPredictionWallet');
    return () => {
      socket.off('predictionWallet', onWallet);
      socket.off('predictionBetPlaced', onBetPlaced);
      socket.off('predictionSettled', onSettled);
      socket.off('predictionError', onErr);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // ─── Spin up markets on a new hand ──────────────────────────────────────
  useEffect(() => {
    if (!gameState) return;
    const handId = gameState.handId ?? gameState.handNumber ?? 0;
    if (handId !== prevHandIdRef.current) {
      prevHandIdRef.current = handId;
      currentHandRef.current = handId;
      setCurrentHandId(handId);
      setActiveMarkets(pickActiveQuestions(handId));
      setPositions({});
      setResolved({});
      setStakeInput({});
    }
  }, [gameState]);

  // ─── Bet placement (server-authoritative) ───────────────────────────────
  const openStakeInput = (marketId, outcome) => {
    setStakeInput(prev => ({ ...prev, [marketId]: { open: true, outcome, value: 50 } }));
  };
  const closeStakeInput = (marketId) => {
    setStakeInput(prev => ({ ...prev, [marketId]: { ...prev[marketId], open: false } }));
  };
  const confirmBet = useCallback((market, rawStake) => {
    const amount = Math.max(MIN_STAKE, Math.min(MAX_STAKE, parseInt(rawStake, 10) || MIN_STAKE));
    const outcome = stakeInput[market.id]?.outcome;
    if (!outcome || balance == null || amount > balance) return;
    if (socket?.connected) {
      socket.emit('placePredictionBet', {
        tableId,
        handId: currentHandId,
        marketId: market.id,
        outcome,
        amount,
      });
    }
    // Position is set when the server confirms via predictionBetPlaced.
  }, [socket, tableId, currentHandId, stakeInput, balance]);

  if (!visible) return null;

  const openCount = activeMarkets.filter(m => !resolved[m.id]).length;

  // ─── Render collapsed ───────────────────────────────────────────────────
  if (!expanded) {
    return (
      <div className="pm-collapsed" onClick={() => setExpanded(true)} title="Open Prediction Markets">
        <span className="pm-pulse-dot" />
        <span className="pm-collapsed-label">🎲 Markets · {openCount} open</span>
      </div>
    );
  }

  // ─── Render expanded ────────────────────────────────────────────────────
  return (
    <div className="pm-panel">
      <div className="pm-toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`pm-toast pm-toast--${t.type}`}>{t.text}</div>
        ))}
      </div>

      <div className="pm-header">
        <span className="pm-header-title">🎲 Prediction Markets</span>
        <button className="pm-collapse-btn" onClick={() => setExpanded(false)} title="Collapse">▾</button>
      </div>
      <div className="pm-balance">Your balance: <strong>{balance == null ? '…' : balance}</strong> chips</div>

      <div className="pm-markets">
        {activeMarkets.map(market => {
          const res   = resolved[market.id];
          const pos   = positions[market.id];
          const stake = stakeInput[market.id];
          const [yesOdds, noOdds] = market.odds;

          return (
            <div key={market.id} className={`pm-card ${res ? `pm-card--${res.won ? 'win' : 'loss'}` : ''}`}>
              <div className="pm-card-question">{market.text}</div>

              {res && (
                <div className="pm-card-resolved">
                  <span className={`pm-result-badge pm-result-badge--${res.outcome}`}>
                    {res.outcome.toUpperCase()}
                  </span>
                  {pos && (
                    <span className={`pm-result-delta ${res.won ? 'pm-delta--win' : 'pm-delta--loss'}`}>
                      {res.won ? `+${res.payout}` : `-${pos.amount}`} chips
                    </span>
                  )}
                </div>
              )}

              {!res && (
                <>
                  {pos ? (
                    <div className="pm-position">
                      <span className={`pm-position-badge pm-position-badge--${pos.outcome}`}>
                        {pos.outcome.toUpperCase()} · {pos.amount} bet
                      </span>
                      <span className="pm-potential-win">→ win {pos.potentialWin}</span>
                    </div>
                  ) : (
                    <div className="pm-outcome-btns">
                      <button
                        className="pm-btn pm-btn--yes"
                        onClick={() => openStakeInput(market.id, 'yes')}
                        disabled={!!stake?.open || balance == null}
                      >
                        YES ({yesOdds}%)
                      </button>
                      <button
                        className="pm-btn pm-btn--no"
                        onClick={() => openStakeInput(market.id, 'no')}
                        disabled={!!stake?.open || balance == null}
                      >
                        NO ({noOdds}%)
                      </button>
                    </div>
                  )}

                  {stake?.open && !pos && (
                    <div className="pm-stake-row">
                      <input
                        className="pm-stake-input"
                        type="number"
                        min={MIN_STAKE}
                        max={Math.min(MAX_STAKE, balance ?? MAX_STAKE)}
                        value={stake.value}
                        onChange={e =>
                          setStakeInput(prev => ({
                            ...prev,
                            [market.id]: { ...prev[market.id], value: e.target.value },
                          }))
                        }
                      />
                      <button
                        className="pm-btn pm-btn--confirm"
                        onClick={() => confirmBet(market, stake.value)}
                        disabled={balance == null || parseInt(stake.value, 10) > balance}
                      >
                        Bet
                      </button>
                      <button className="pm-btn pm-btn--cancel" onClick={() => closeStakeInput(market.id)}>✕</button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
