import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useThrottle } from '../../hooks/useThrottle';
import './PredictionMarket.css';

const MARKET_QUESTIONS = [
  { id: 'showdown',    text: 'Will there be a showdown?',          defaultOdds: [55, 45] },
  { id: 'btnRaise',   text: 'Will the BTN 3-bet preflop?',         defaultOdds: [22, 78] },
  { id: 'flopPaired', text: 'Will the flop be paired?',            defaultOdds: [17, 83] },
  { id: 'allIn',      text: 'Will someone go all-in?',             defaultOdds: [12, 88] },
  { id: 'bigPot',     text: 'Will the pot exceed 5,000?',          defaultOdds: [30, 70] },
  { id: 'threeWay',   text: 'Will this be 3-way to the flop?',     defaultOdds: [35, 65] },
  { id: 'foldPreflop',text: 'Will everyone fold preflop?',         defaultOdds: [15, 85] },
  { id: 'riverSeen',  text: 'Will the river be dealt?',            defaultOdds: [45, 55] },
];

const STARTING_BALANCE = 1000;
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

function resolveMarket(marketId, gameState) {
  if (!gameState) return null;
  const { seats = [], pot = 0, communityCards = [], phase = '' } = gameState;

  switch (marketId) {
    case 'showdown': {
      // Resolved YES if multiple players reach showdown (phase HandComplete with 2+ active)
      const activePlayers = seats.filter(s => s && !s.folded && s.active);
      return activePlayers.length >= 2 ? 'yes' : 'no';
    }
    case 'btnRaise': {
      // Approximate: check if a 3-bet occurred in preflop history
      if (gameState.preflopRaiseCount !== undefined) {
        return gameState.preflopRaiseCount >= 2 ? 'yes' : 'no';
      }
      return null;
    }
    case 'flopPaired': {
      if (communityCards.length < 3) return null;
      const flop = communityCards.slice(0, 3);
      const ranks = flop.map(c => typeof c === 'string' ? c.slice(0, -1) : String(c?.rank ?? ''));
      const hasPair = ranks.some((r, i) => ranks.indexOf(r) !== i);
      return hasPair ? 'yes' : 'no';
    }
    case 'allIn': {
      const anyAllIn = seats.some(s => s && s.isAllIn);
      return anyAllIn ? 'yes' : 'no';
    }
    case 'bigPot': {
      return pot > 5000 ? 'yes' : 'no';
    }
    case 'threeWay': {
      const sawFlop = seats.filter(s => s && !s.foldedPreflop && s.active);
      return sawFlop.length >= 3 ? 'yes' : 'no';
    }
    case 'foldPreflop': {
      const activeSawFlop = seats.filter(s => s && !s.foldedPreflop && s.active);
      return activeSawFlop.length <= 1 ? 'yes' : 'no';
    }
    case 'riverSeen': {
      return communityCards.length === 5 ? 'yes' : 'no';
    }
    default:
      return null;
  }
}

export default function PredictionMarket({ gameState: gameStateRaw, socket, visible, onClose }) {
  const gameState = useThrottle(gameStateRaw, 500);
  const [expanded, setExpanded]     = useState(false);
  const [balance, setBalance] = useState(() => {
    try {
      const stored = localStorage.getItem('prediction_market_balance');
      return stored !== null ? Number(stored) : STARTING_BALANCE;
    } catch { return STARTING_BALANCE; }
  });
  const [activeMarkets, setActiveMarkets] = useState([]);
  const [positions, setPositions]   = useState({}); // marketId → { outcome, amount, potentialWin }
  const [resolved, setResolved]     = useState({}); // marketId → { outcome, result, payout }
  const [stakeInput, setStakeInput] = useState({}); // marketId → { open: bool, outcome: string, value: number }
  const [toasts, setToasts]         = useState([]);
  const [currentHandId, setCurrentHandId] = useState(null);
  const prevPhaseRef = useRef(null);
  const prevHandIdRef = useRef(null);

  // ─── Spin up markets on new hand ────────────────────────────────────────
  useEffect(() => {
    if (!gameState) return;
    const handId = gameState.handId ?? gameState.handNumber ?? 0;
    if (handId !== prevHandIdRef.current) {
      prevHandIdRef.current = handId;
      setCurrentHandId(handId);
      const questions = pickActiveQuestions(handId);
      setActiveMarkets(questions.map(q => ({
        ...q,
        odds: [...q.defaultOdds], // [yesOdds, noOdds]
        totalYesBets: 0,
        totalNoBets: 0,
      })));
      setPositions({});
      setResolved({});
      setStakeInput({});
    }
  }, [gameState]);

  // ─── Auto-resolve when hand completes ───────────────────────────────────
  useEffect(() => {
    if (!gameState) return;
    const phase = gameState.phase;
    if (phase === 'HandComplete' && prevPhaseRef.current !== 'HandComplete') {
      resolveAllMarkets();
    }
    prevPhaseRef.current = phase;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase]);

  // ─── Socket: listen for marketResult ────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const handler = ({ marketId, handId, outcome, payout }) => {
      if (handId !== currentHandId) return;
      setResolved(prev => ({ ...prev, [marketId]: { outcome, payout } }));
    };
    socket.on('marketResult', handler);
    return () => socket.off('marketResult', handler);
  }, [socket, currentHandId]);

  // ─── Helpers ────────────────────────────────────────────────────────────
  const resolveAllMarkets = useCallback(() => {
    if (!gameState) return;
    setActiveMarkets(prev => {
      const newResolved = {};
      let balanceDelta = 0;
      const newToasts = [];

      prev.forEach(market => {
        if (resolved[market.id]) return;
        const result = resolveMarket(market.id, gameState);
        if (result === null) return;

        const position = positions[market.id];
        let payout = 0;

        if (position) {
          if (position.outcome === result) {
            payout = position.potentialWin;
            balanceDelta += payout;
            newToasts.push({ id: Date.now() + market.id, type: 'win', text: `+${payout} chips (${market.text.slice(0, 20)}…)` });
          } else {
            payout = -position.amount;
            balanceDelta += payout;
            newToasts.push({ id: Date.now() + market.id, type: 'loss', text: `-${position.amount} chips (${market.text.slice(0, 20)}…)` });
          }
        }

        newResolved[market.id] = { outcome: result, payout };

        if (socket) {
          socket.emit('marketResult', { marketId: market.id, handId: currentHandId, outcome: result, payout });
        }
      });

      setResolved(r => ({ ...r, ...newResolved }));
      setBalance(b => {
        const next = b + balanceDelta;
        try { localStorage.setItem('prediction_market_balance', String(next)); } catch {}
        return next;
      });
      if (newToasts.length > 0) {
        setToasts(t => [...t, ...newToasts]);
        setTimeout(() => setToasts(t => t.slice(newToasts.length)), 3500);
      }

      return prev; // no change to activeMarkets array itself
    });
  }, [gameState, positions, resolved, socket, currentHandId]);

  const updateOdds = (marketId, outcome, betAmount) => {
    setActiveMarkets(prev => prev.map(m => {
      if (m.id !== marketId) return m;
      const shift = betAmount / 100;
      let [yes, no] = m.odds;
      if (outcome === 'yes') {
        yes = Math.max(1, Math.min(99, yes - shift));
      } else {
        no = Math.max(1, Math.min(99, no - shift));
        yes = 100 - no;
      }
      no = 100 - yes;
      return {
        ...m,
        odds: [Math.round(yes), Math.round(no)],
        totalYesBets: outcome === 'yes' ? m.totalYesBets + betAmount : m.totalYesBets,
        totalNoBets:  outcome === 'no'  ? m.totalNoBets  + betAmount : m.totalNoBets,
      };
    }));
  };

  const openStakeInput = (marketId, outcome) => {
    setStakeInput(prev => ({
      ...prev,
      [marketId]: { open: true, outcome, value: 50 },
    }));
  };

  const closeStakeInput = (marketId) => {
    setStakeInput(prev => ({ ...prev, [marketId]: { ...prev[marketId], open: false } }));
  };

  const confirmBet = (market, stake) => {
    const amount = Math.max(MIN_STAKE, Math.min(MAX_STAKE, parseInt(stake, 10) || MIN_STAKE));
    if (amount > balance) return;

    const outcome = stakeInput[market.id]?.outcome;
    if (!outcome) return;

    const odds = outcome === 'yes' ? market.odds[0] : market.odds[1];
    // Payout: stake * (100 / odds) — return on investment
    const potentialWin = Math.round(amount * (100 / odds));

    setBalance(b => {
      const next = b - amount;
      try { localStorage.setItem('prediction_market_balance', String(next)); } catch {}
      return next;
    });
    setPositions(prev => ({ ...prev, [market.id]: { outcome, amount, potentialWin } }));
    updateOdds(market.id, outcome, amount);
    closeStakeInput(market.id);

    if (socket) {
      socket.emit('marketBet', {
        marketId: market.id,
        handId: currentHandId,
        outcome,
        amount,
      });
    }
  };

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
      {/* Toasts */}
      <div className="pm-toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`pm-toast pm-toast--${t.type}`}>{t.text}</div>
        ))}
      </div>

      {/* Header */}
      <div className="pm-header">
        <span className="pm-header-title">🎲 Prediction Markets</span>
        <button className="pm-collapse-btn" onClick={() => setExpanded(false)} title="Collapse">▾</button>
      </div>
      <div className="pm-balance">Your balance: <strong>{balance}</strong> chips</div>

      {/* Market cards */}
      <div className="pm-markets">
        {activeMarkets.map(market => {
          const res      = resolved[market.id];
          const pos      = positions[market.id];
          const stake    = stakeInput[market.id];
          const [yesOdds, noOdds] = market.odds;

          return (
            <div key={market.id} className={`pm-card ${res ? `pm-card--${res.outcome === (pos?.outcome) ? 'win' : 'loss'}` : ''}`}>
              <div className="pm-card-question">{market.text}</div>

              {/* Resolved state */}
              {res && (
                <div className="pm-card-resolved">
                  <span className={`pm-result-badge pm-result-badge--${res.outcome}`}>
                    {res.outcome.toUpperCase()}
                  </span>
                  {pos && (
                    <span className={`pm-result-delta ${pos.outcome === res.outcome ? 'pm-delta--win' : 'pm-delta--loss'}`}>
                      {pos.outcome === res.outcome ? `+${pos.potentialWin}` : `-${pos.amount}`} chips
                    </span>
                  )}
                </div>
              )}

              {/* Active: show position or outcome buttons */}
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
                        disabled={!!stake?.open}
                      >
                        YES ({yesOdds}%)
                      </button>
                      <button
                        className="pm-btn pm-btn--no"
                        onClick={() => openStakeInput(market.id, 'no')}
                        disabled={!!stake?.open}
                      >
                        NO ({noOdds}%)
                      </button>
                    </div>
                  )}

                  {/* Stake input */}
                  {stake?.open && !pos && (
                    <div className="pm-stake-row">
                      <input
                        className="pm-stake-input"
                        type="number"
                        min={MIN_STAKE}
                        max={Math.min(MAX_STAKE, balance)}
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
                        disabled={parseInt(stake.value, 10) > balance}
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
