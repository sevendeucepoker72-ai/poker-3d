import React, { useState, useEffect, useMemo } from 'react';
import { useEquityWorker } from '../../hooks/useEquityWorker';
import './PauseCoach.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatEV(ev) {
  if (ev === null || ev === undefined) return '—';
  if (ev === 0) return '$0';
  const sign = ev > 0 ? '+' : '';
  return `${sign}$${Math.round(Math.abs(ev)).toLocaleString()}`;
}

function riskLabel(action) {
  if (action === 'fold')  return 'Low';
  if (action === 'call')  return 'Medium';
  if (action === 'raise') return 'High';
  return '—';
}

function tipsFor(action, equity) {
  const tips = {
    fold: [
      'Save chips for better spots',
      'Your equity is too thin here',
      'Live to fight another hand',
    ],
    call: [
      'Pot odds favor a call',
      'Keep your opponent guessing',
      'Set up a future bluff',
    ],
    raise: [
      'Value bet here',
      'Deny equity to draws',
      'Build the pot while ahead',
    ],
  };
  const pool = tips[action] ?? ['Consider your options carefully'];
  // Deterministically pick based on equity bucket
  const idx = equity > 60 ? 0 : equity > 40 ? 1 : 2;
  return pool[idx % pool.length];
}

// ─── Decision Tree ────────────────────────────────────────────────────────────

function DecisionTree({ equity }) {
  if (equity === null) return null;

  if (equity > 60) {
    return (
      <div className="pc-tree">
        <div className="pc-tree-row pc-tree-primary">
          If <span className="pc-tree-action">RAISE</span> → Opp likely{' '}
          <span className="pc-tree-prob">FOLDS ({Math.round(40 + equity * 0.1)}%)</span>
        </div>
        <div className="pc-tree-row pc-tree-indent">
          → Win pot immediately ({formatEV(0)}&nbsp;risk)
        </div>
        <div className="pc-tree-row pc-tree-indent">
          → If CALL → EV{' '}
          <span className="pc-tree-ev pc-tree-ev--pos">
            +${Math.round(equity * 8)}
          </span>
        </div>
        <div className="pc-tree-row pc-tree-secondary">
          If <span className="pc-tree-action">CALL</span> → Opp likely{' '}
          <span className="pc-tree-prob">CHECKS ({Math.round(55 + equity * 0.08)}%)</span>
        </div>
        <div className="pc-tree-row pc-tree-indent">
          → Street EV{' '}
          <span className="pc-tree-ev pc-tree-ev--pos">
            +${Math.round(equity * 4)}
          </span>
        </div>
      </div>
    );
  }

  if (equity >= 40) {
    return (
      <div className="pc-tree">
        <div className="pc-tree-row pc-tree-primary">
          If <span className="pc-tree-action">CALL</span> → Opp likely{' '}
          <span className="pc-tree-prob">CHECKS ({Math.round(50 + equity * 0.1)}%)</span>
        </div>
        <div className="pc-tree-row pc-tree-indent">
          → If RAISE → EV{' '}
          <span className="pc-tree-ev pc-tree-ev--pos">
            +${Math.round(equity * 7)}
          </span>
        </div>
        <div className="pc-tree-row pc-tree-indent">
          → If CALL → EV{' '}
          <span className="pc-tree-ev pc-tree-ev--pos">
            +${Math.round(equity * 3)}
          </span>
        </div>
        <div className="pc-tree-row pc-tree-secondary">
          If <span className="pc-tree-action">RAISE</span> → Opp likely{' '}
          <span className="pc-tree-prob">CALLS ({Math.round(40 + (100 - equity) * 0.3)}%)</span>
        </div>
        <div className="pc-tree-row pc-tree-indent">
          → Equity dependent — borderline +EV
        </div>
      </div>
    );
  }

  // equity < 40
  return (
    <div className="pc-tree">
      <div className="pc-tree-row pc-tree-primary">
        If <span className="pc-tree-action">FOLD</span> → Preserve{' '}
        <span className="pc-tree-prob">stack for +EV spots</span>
      </div>
      <div className="pc-tree-row pc-tree-indent">
        → No further risk to chip stack
      </div>
      <div className="pc-tree-row pc-tree-secondary">
        If <span className="pc-tree-action">CALL</span> → Opp likely{' '}
        <span className="pc-tree-prob">CONTINUES ({Math.round(60 + (40 - equity) * 0.4)}%)</span>
      </div>
      <div className="pc-tree-row pc-tree-indent">
        → Marginal equity — negative expectation
      </div>
    </div>
  );
}

// ─── Action Card ─────────────────────────────────────────────────────────────

function ActionCard({ action, label, ev, equity, revealed, isBest }) {
  const tip = tipsFor(action, equity ?? 50);
  const risk = riskLabel(action);

  return (
    <div
      className={[
        'pc-action-card',
        `pc-action-card--${action}`,
        isBest && revealed ? 'pc-action-card--best' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="pc-card-label">{label}</div>
      <div className="pc-card-ev">
        EV: {ev === null ? <span className="pc-calculating">…</span> : formatEV(ev)}
      </div>
      <div className="pc-card-risk">Risk: {risk}</div>
      <div className="pc-card-tip">"{tip}"</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PauseCoach({
  visible,
  gameState,
  yourCards,
  onResume,
  onClose,
}) {
  const { calculateEquity } = useEquityWorker();
  const [equity, setEquity] = useState(null);
  const [calculating, setCalculating] = useState(true);
  const [revealBest, setRevealBest] = useState(false);

  const pot         = gameState?.pot         ?? 840;
  const callAmount  = gameState?.callAmount  ?? 120;
  const raiseAmount = gameState?.raiseAmount ?? 360;
  const phase       = gameState?.phase       ?? 'FLOP';
  const communityCards = gameState?.communityCards ?? [];
  const cards       = yourCards ?? [];

  // Reset reveal when panel opens/closes
  useEffect(() => {
    if (!visible) {
      setRevealBest(false);
      setEquity(null);
      setCalculating(true);
    }
  }, [visible]);

  // Compute equity on mount / when visible becomes true
  useEffect(() => {
    if (!visible) return;

    setCalculating(true);
    setEquity(null);

    let cancelled = false;

    // Build the remaining deck from known cards
    const knownSet = new Set(
      [...cards, ...communityCards].map(c => `${c.rank}-${c.suit}`)
    );
    const deckRemaining = [];
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 2; rank <= 14; rank++) {
        if (!knownSet.has(`${rank}-${suit}`)) {
          deckRemaining.push({ rank, suit });
        }
      }
    }

    // Run simulation in the equity web worker to avoid blocking the UI
    calculateEquity([cards], communityCards, deckRemaining, 1000)
      .then((result) => {
        if (cancelled) return;
        setEquity(result.playerEquities[0] ?? 50);
      })
      .catch(() => {
        if (!cancelled) setEquity(50);
      })
      .finally(() => {
        if (!cancelled) setCalculating(false);
      });

    return () => { cancelled = true; };
  }, [visible, cards.map(c => `${c.rank}-${c.suit}`).join(','), communityCards.map(c => `${c.rank}-${c.suit}`).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // EV calculations
  const evValues = useMemo(() => {
    if (equity === null) return { fold: null, call: null, raise: null };
    const eq = equity / 100;
    const foldEV  = 0;
    const callEV  = eq * (pot + callAmount) - callAmount * (1 - eq);
    const raiseEV = eq * (pot + raiseAmount * 1.3) - raiseAmount * (1 - eq);
    return {
      fold:  Math.round(foldEV),
      call:  Math.round(callEV),
      raise: Math.round(raiseEV),
    };
  }, [equity, pot, callAmount, raiseAmount]);

  const bestAction = useMemo(() => {
    if (equity === null) return null;
    const { fold, call, raise } = evValues;
    if (raise >= call && raise >= fold) return 'raise';
    if (call >= fold) return 'call';
    return 'fold';
  }, [evValues, equity]);

  // Format community cards for display — cards are {rank, suit} objects
  const isRed = (c) => typeof c === 'string'
    ? c.includes('h') || c.includes('d')
    : c?.suit === 'hearts' || c?.suit === 'diamonds';
  const cardLabel = (c) => typeof c === 'string'
    ? c.toUpperCase()
    : `${c?.rank ?? '?'}${c?.suit?.[0]?.toUpperCase() ?? ''}`;

  const formattedCommunity = communityCards.map((c, i) => (
    <span key={i} className={`pc-card ${isRed(c) ? 'pc-card--red' : ''}`}>
      {cardLabel(c)}
    </span>
  ));

  const formattedHand = cards.map((c, i) => (
    <span key={i} className={`pc-card pc-card--hero ${isRed(c) ? 'pc-card--red' : ''}`}>
      {cardLabel(c)}
    </span>
  ));

  if (!visible) return null;

  return (
    <div className="pc-overlay" role="dialog" aria-modal="true" aria-label="Coach Mode">
      <div className="pc-panel">
        {/* GTO Banner (shown after reveal) */}
        {revealBest && bestAction && (
          <div className="pc-gto-banner" role="status">
            GTO Recommendation:{' '}
            <strong>{bestAction.toUpperCase()}</strong>
          </div>
        )}

        {/* Title bar */}
        <div className="pc-header">
          <span className="pc-header-title">COACH MODE</span>
          <button className="pc-close-btn" onClick={onClose} aria-label="Close coach panel">✕</button>
        </div>

        {/* Game context */}
        <div className="pc-context">
          <div className="pc-context-row">
            <span className="pc-context-label">Community:</span>
            <span className="pc-cards-row">
              {formattedCommunity.length > 0 ? formattedCommunity : <span className="pc-no-cards">—</span>}
            </span>
            <span className="pc-context-pot">Pot: <strong>${pot.toLocaleString()}</strong></span>
          </div>
          <div className="pc-context-row">
            <span className="pc-context-label">Your hand:</span>
            <span className="pc-cards-row">
              {formattedHand.length > 0 ? formattedHand : <span className="pc-no-cards">—</span>}
            </span>
            <span className="pc-context-street">Street: <strong>{phase}</strong></span>
          </div>
          {calculating ? (
            <div className="pc-equity-row">
              <span className="pc-equity-label">Equity:</span>
              <span className="pc-calculating">Calculating…</span>
            </div>
          ) : (
            <div className="pc-equity-row">
              <span className="pc-equity-label">Equity:</span>
              <span className={`pc-equity-value ${equity > 60 ? 'pc-equity--high' : equity >= 40 ? 'pc-equity--mid' : 'pc-equity--low'}`}>
                {equity}%
              </span>
            </div>
          )}
        </div>

        {/* Action cards */}
        <div className="pc-actions">
          <ActionCard
            action="fold"
            label="FOLD"
            ev={evValues.fold}
            equity={equity}
            revealed={revealBest}
            isBest={bestAction === 'fold'}
          />
          <ActionCard
            action="call"
            label={`CALL $${callAmount.toLocaleString()}`}
            ev={evValues.call}
            equity={equity}
            revealed={revealBest}
            isBest={bestAction === 'call'}
          />
          <ActionCard
            action="raise"
            label="RAISE"
            ev={evValues.raise}
            equity={equity}
            revealed={revealBest}
            isBest={bestAction === 'raise'}
          />
        </div>

        {/* Decision tree */}
        <div className="pc-section">
          <div className="pc-section-title">Decision Tree</div>
          {calculating ? (
            <div className="pc-calculating pc-calculating--tree">Analyzing…</div>
          ) : (
            <DecisionTree equity={equity} />
          )}
        </div>

        {/* Footer buttons */}
        <div className="pc-footer">
          <button
            className="pc-btn pc-btn--reveal"
            onClick={() => setRevealBest(true)}
            disabled={revealBest || calculating}
          >
            {revealBest ? 'Best Play Shown' : 'Reveal Best Play'}
          </button>
          <button className="pc-btn pc-btn--resume" onClick={onResume}>
            Resume Hand
          </button>
        </div>
      </div>
    </div>
  );
}
