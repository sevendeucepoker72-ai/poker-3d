import React, { useState, useMemo } from 'react';
import './GTOSolver.css';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-computed GTO mixed strategy frequencies lookup table.
// Key format: "street:position:actionType"  (or "context:street:position:actionType")
// Values represent % frequency for each decision (must sum to 100).
// ─────────────────────────────────────────────────────────────────────────────
const GTO_SPOTS = {
  // ── Single Raised Pot (SRP) – Preflop open-raise frequencies ──────────────
  'preflop:BTN:openRaise':       { raise: 55, call: 0,  fold: 45 },
  'preflop:CO:openRaise':        { raise: 47, call: 0,  fold: 53 },
  'preflop:MP:openRaise':        { raise: 32, call: 0,  fold: 68 },
  'preflop:UTG:openRaise':       { raise: 22, call: 0,  fold: 78 },
  // ── Preflop vs 3-bet ──────────────────────────────────────────────────────
  'preflop:BTN:vs3bet':          { raise: 18, call: 38, fold: 44 },
  'preflop:CO:vs3bet':           { raise: 12, call: 32, fold: 56 },
  'preflop:MP:vs3bet':           { raise:  8, call: 25, fold: 67 },
  'preflop:UTG:vs3bet':          { raise:  5, call: 18, fold: 77 },
  // ── Preflop blind defense / steal ─────────────────────────────────────────
  'preflop:BB:vsSteal':          { raise: 14, call: 45, fold: 41 },
  'preflop:SB:vsSteal':          { raise: 10, call: 30, fold: 60 },
  // ── Preflop squeeze ───────────────────────────────────────────────────────
  'preflop:BTN:squeeze':         { raise: 28, call: 22, fold: 50 },
  'preflop:BB:squeeze':          { raise: 30, call: 18, fold: 52 },
  // ── Flop – In Position ────────────────────────────────────────────────────
  'flop:IP:cbet':                { check: 42, bet: 58, raise: 0, fold: 0 },
  'flop:IP:cbetSmall':           { check: 35, bet: 65, raise: 0, fold: 0 },
  'flop:IP:vsCheckRaise':        { raise: 22, call: 35, fold: 43 },
  'flop:IP:vsDonk':              { raise: 30, call: 45, fold: 25 },
  // ── Flop – Out of Position ────────────────────────────────────────────────
  'flop:OOP:donk':               { check: 72, bet: 28, raise: 0, fold: 0 },
  'flop:OOP:checkRaise':         { checkRaise: 31, check: 69, raise: 0, fold: 0 },
  'flop:OOP:checkCall':          { call: 55, fold: 45, raise: 0 },
  // ── Turn – In Position ────────────────────────────────────────────────────
  'turn:IP:cbet':                { check: 48, bet: 52, raise: 0, fold: 0 },
  'turn:IP:doubleBarrel':        { check: 55, bet: 45, raise: 0, fold: 0 },
  'turn:IP:vsCheckRaise':        { raise: 18, call: 30, fold: 52 },
  // ── Turn – Out of Position ────────────────────────────────────────────────
  'turn:OOP:checkCall':          { call: 62, fold: 38, raise: 0 },
  'turn:OOP:checkFold':          { call: 28, fold: 72, raise: 0 },
  // ── River – In Position ───────────────────────────────────────────────────
  'river:IP:tripleBarrel':       { check: 60, bet: 40, raise: 0, fold: 0 },
  'river:IP:valueBluffRatio':    { check: 52, bet: 48, raise: 0, fold: 0 },
  'river:IP:overbet':            { check: 65, bet: 35, raise: 0, fold: 0 },
  // ── River – Out of Position ───────────────────────────────────────────────
  'river:OOP:checkCall':         { call: 58, fold: 42, raise: 0 },
  'river:OOP:checkFold':         { call: 22, fold: 78, raise: 0 },
  // ── 3-Bet Pot spots ───────────────────────────────────────────────────────
  '3betPot:flop:IP:cbet':        { check: 38, bet: 62, raise: 0, fold: 0 },
  '3betPot:flop:OOP:cbet':       { check: 45, bet: 55, raise: 0, fold: 0 },
  '3betPot:turn:IP:barrel':      { check: 52, bet: 48, raise: 0, fold: 0 },
  '3betPot:turn:OOP:checkCall':  { call: 55, fold: 45, raise: 0 },
  '3betPot:river:IP:bet':        { check: 58, bet: 42, raise: 0, fold: 0 },
  // ── Blind vs Blind ────────────────────────────────────────────────────────
  'BvB:flop:SB:cbet':            { check: 40, bet: 60, raise: 0, fold: 0 },
  'BvB:flop:BB:checkRaise':      { checkRaise: 28, check: 72, raise: 0, fold: 0 },
  'BvB:turn:SB:barrel':          { check: 50, bet: 50, raise: 0, fold: 0 },
  // ── Multiway pots ─────────────────────────────────────────────────────────
  'multiway:flop:bet':           { check: 68, bet: 32, raise: 0, fold: 0 },
  'multiway:turn:bet':           { check: 74, bet: 26, raise: 0, fold: 0 },
  'multiway:river:bet':          { check: 80, bet: 20, raise: 0, fold: 0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Normalise phase string to lowercase key segment */
function normalisePhase(phase) {
  if (!phase) return 'flop';
  const p = phase.toLowerCase();
  if (p.includes('pre')) return 'preflop';
  if (p.includes('flop')) return 'flop';
  if (p.includes('turn')) return 'turn';
  if (p.includes('river')) return 'river';
  return p;
}

/**
 * Derive the best-matching GTO spot key from current game state.
 * Returns { key, label, confidence } where confidence is 'exact' | 'close' | 'estimate'.
 */
function deriveSpot(gameState, positionLabel, equity) {
  if (!gameState) return { key: null, label: 'Unknown spot', confidence: 'estimate' };

  const phase = normalisePhase(gameState.phase);
  const players = gameState.players || [];
  const numActive = players.filter(p => !p.folded).length;
  const isMultiway = numActive > 2;
  const lastAction = (gameState.lastAction || '').toLowerCase();
  const pot3bet = gameState.pot3bet || false;
  const isBvB = gameState.isBvB || (positionLabel === 'SB' || positionLabel === 'BB');

  // ── Position: IP vs OOP ──
  // Seat-based: higher seat index = IP post-flop in most implementations.
  // Fall back to positionLabel hints.
  const ipPositions = ['BTN', 'CO', 'HJ'];
  const oopPositions = ['BB', 'SB', 'UTG', 'MP'];
  const isIP = ipPositions.includes(positionLabel) ? true
    : oopPositions.includes(positionLabel) ? false
    : (gameState.heroSeat ?? 0) > (gameState.dealerSeat ?? 0);
  const position = isIP ? 'IP' : 'OOP';

  // ── Action classification ──
  const isRaise     = lastAction.includes('raise') || lastAction.includes('3bet');
  const isBet       = lastAction.includes('bet');
  const isCheck     = lastAction.includes('check');
  const isFold      = lastAction.includes('fold');
  const isCall      = lastAction.includes('call');
  const isCheckRaise = lastAction.includes('check-raise') || lastAction.includes('checkraise');

  // ──────────────────────────────────────────────────────────────────────────
  // Exact key building – try from most specific to least specific
  // ──────────────────────────────────────────────────────────────────────────
  const candidates = [];

  if (phase === 'preflop') {
    // Open raise attempt
    if (!isRaise && !isCall && !isFold) {
      candidates.push(`preflop:${positionLabel}:openRaise`);
    }
    if (isRaise && (positionLabel === 'BTN' || positionLabel === 'CO')) {
      candidates.push(`preflop:${positionLabel}:vs3bet`);
    }
    if (isBvB) {
      candidates.push(`preflop:${positionLabel}:vsSteal`);
    }
    if (lastAction.includes('squeeze')) {
      candidates.push(`preflop:${positionLabel}:squeeze`);
    }
    // Generic open raise fallback
    candidates.push(`preflop:BTN:openRaise`);
  } else {
    // Post-flop
    if (isMultiway) {
      candidates.push(`multiway:${phase}:bet`);
    } else if (pot3bet) {
      if (isCheckRaise) {
        candidates.push(`3betPot:${phase}:${position}:checkCall`);
      } else if (isBet || isRaise) {
        candidates.push(`3betPot:${phase}:${position}:cbet`);
        candidates.push(`3betPot:${phase}:${position}:barrel`);
        candidates.push(`3betPot:${phase}:${position}:bet`);
      } else {
        candidates.push(`3betPot:${phase}:${position}:cbet`);
      }
    } else if (isBvB && phase === 'flop') {
      if (positionLabel === 'SB') candidates.push('BvB:flop:SB:cbet');
      if (positionLabel === 'BB') candidates.push('BvB:flop:BB:checkRaise');
    } else {
      // Generic post-flop key building
      if (isCheckRaise) {
        candidates.push(`${phase}:${position}:checkRaise`);
      } else if (isBet) {
        if (phase === 'flop') {
          candidates.push(`${phase}:${position === 'OOP' ? 'OOP' : 'IP'}:donk`);
          candidates.push(`${phase}:IP:cbet`);
        } else if (phase === 'turn') {
          candidates.push(`${phase}:IP:doubleBarrel`);
          candidates.push(`${phase}:IP:cbet`);
        } else if (phase === 'river') {
          candidates.push(`${phase}:IP:tripleBarrel`);
          candidates.push(`${phase}:IP:valueBluffRatio`);
        }
      } else if (isRaise) {
        candidates.push(`${phase}:${position}:vsCheckRaise`);
      } else if (isCall) {
        candidates.push(`${phase}:${position}:checkCall`);
      } else if (isFold) {
        candidates.push(`${phase}:${position}:checkFold`);
      } else {
        // Default: c-bet opportunity
        candidates.push(`${phase}:IP:cbet`);
      }
    }
  }

  // Walk candidates in order, return first hit
  for (const key of candidates) {
    if (GTO_SPOTS[key]) {
      return { key, label: key.replace(/:/g, ' › '), confidence: 'exact' };
    }
  }

  // ── Close match: try relaxing position ──
  const relaxedKey = phase === 'preflop' ? 'preflop:BTN:openRaise' : `${phase}:IP:cbet`;
  if (GTO_SPOTS[relaxedKey]) {
    return { key: relaxedKey, label: relaxedKey.replace(/:/g, ' › '), confidence: 'close' };
  }

  // ── Estimate fallback ──
  return {
    key: 'flop:IP:cbet',
    label: 'Generic flop spot (estimate)',
    confidence: 'estimate',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_COLORS = {
  raise: '#22C55E',
  bet: '#22C55E',
  call: '#F59E0B',
  check: '#F59E0B',
  checkRaise: '#A78BFA',
  fold: '#EF4444',
};

function ActionBar({ label, pct }) {
  const color = ACTION_COLORS[label.toLowerCase()] || '#6B7280';
  return (
    <div className="gto-action-row">
      <span className="gto-action-label">{label.toUpperCase()}</span>
      <div className="gto-bar-track">
        <div
          className="gto-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="gto-action-pct" style={{ color }}>{pct}%</span>
    </div>
  );
}

function ConfidenceDots({ level }) {
  // exact=3, close=2, estimate=1
  const filled = level === 'exact' ? 3 : level === 'close' ? 2 : 1;
  return (
    <div className="gto-confidence">
      {[1, 2, 3].map(i => (
        <span
          key={i}
          className={`gto-dot ${i <= filled ? 'gto-dot--filled' : 'gto-dot--empty'}`}
        />
      ))}
      <span className="gto-confidence-label">
        {level === 'exact' ? 'Exact' : level === 'close' ? 'Close match' : 'Estimate'}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function GTOSolver({
  gameState,
  yourCards,
  positionLabel,
  equity,
  visible,
  onClose,
}) {
  const [minimized, setMinimized] = useState(false);

  const { key, label, confidence } = useMemo(
    () => deriveSpot(gameState, positionLabel, equity),
    [gameState, positionLabel, equity]
  );

  const frequencies = key ? GTO_SPOTS[key] : null;

  // Build action entries sorted descending by frequency, filter 0%
  const actions = useMemo(() => {
    if (!frequencies) return [];
    return Object.entries(frequencies)
      .filter(([, pct]) => pct > 0)
      .sort(([, a], [, b]) => b - a);
  }, [frequencies]);

  // EV-neutral threshold: if equity > 50% generally want aggression
  const evAdvice = useMemo(() => {
    if (equity == null) return null;
    if (equity > 65) return { text: 'Equity favors aggressive line', color: '#22C55E' };
    if (equity > 45) return { text: 'Near EV-neutral — mixed strategy', color: '#F59E0B' };
    return { text: 'Equity suggests defensive play', color: '#EF4444' };
  }, [equity]);

  if (!visible) return null;

  return (
    <div className="gto-panel">
      {/* ── Header ── */}
      <div className="gto-header">
        <span className="gto-title">GTO SOLVER</span>
        <div className="gto-header-actions">
          <button
            className="gto-btn-minimize"
            onClick={() => setMinimized(m => !m)}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▲' : '▼'}
          </button>
          <button className="gto-btn-close" onClick={onClose} title="Close">
            ×
          </button>
        </div>
      </div>

      {/* ── Body (hidden when minimized) ── */}
      {!minimized && (
        <div className="gto-body">
          {/* Spot label */}
          <div className="gto-spot-label">Spot: {label}</div>

          {/* Action frequency bars */}
          {actions.length > 0 ? (
            <div className="gto-actions">
              {actions.map(([action, pct]) => (
                <ActionBar key={action} label={action} pct={pct} />
              ))}
            </div>
          ) : (
            <div className="gto-no-data">No data for this spot</div>
          )}

          {/* Divider */}
          <div className="gto-divider" />

          {/* EV threshold */}
          {evAdvice && (
            <div className="gto-ev-line" style={{ color: evAdvice.color }}>
              ▸ {evAdvice.text}
            </div>
          )}
          {equity != null && (
            <div className="gto-equity-hint">
              Equity: <strong>{equity.toFixed(1)}%</strong>
            </div>
          )}

          {/* Confidence */}
          <ConfidenceDots level={confidence} />
        </div>
      )}
    </div>
  );
}
