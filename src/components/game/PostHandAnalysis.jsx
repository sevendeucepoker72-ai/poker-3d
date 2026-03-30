import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { evaluateHandStrength } from '../../utils/handStrength';
import './PostHandAnalysis.css';

const AUTO_DISMISS_MS = 12000;

function strengthColor(s) {
  if (s >= 0.66) return '#22C55E';
  if (s >= 0.33) return '#EAB308';
  return '#EF4444';
}

function getOptimalAction(strength, potOdds, callAmount) {
  if (callAmount === 0) {
    if (strength >= 0.6) return { action: 'Raise for value', quality: 'good' };
    if (strength >= 0.3) return { action: 'Check (marginal)', quality: 'marginal' };
    return { action: 'Check (weak)', quality: 'marginal' };
  }
  const equityNeeded = potOdds > 0 ? 1 / (1 + potOdds) : 1;
  if (strength >= equityNeeded + 0.15) return { action: 'Raise for value', quality: 'good' };
  if (strength >= equityNeeded) return { action: 'Call (good odds)', quality: 'good' };
  if (strength >= equityNeeded - 0.1) return { action: 'Marginal call/fold', quality: 'marginal' };
  return { action: 'Fold (insufficient equity)', quality: 'mistake' };
}

/** Map actual action string from hand history to a canonical type */
function classifyAction(actionStr) {
  if (!actionStr) return null;
  const s = actionStr.toLowerCase();
  if (s.includes('fold')) return 'fold';
  if (s.includes('all-in') || s.includes('allin')) return 'allin';
  if (s.includes('raise') || s.includes('bet')) return 'raise';
  if (s.includes('call')) return 'call';
  if (s.includes('check')) return 'check';
  return null;
}

/** Compare actual vs optimal and return a quality delta */
function actionQuality(actual, optimal) {
  if (!actual) return 'unknown';
  const optQ = optimal.quality;
  // Direct match heuristic
  if (optQ === 'good') {
    if (actual === 'fold') return 'mistake';
    if (actual === 'check' || actual === 'call') return 'marginal';
    return 'good';
  }
  if (optQ === 'marginal') return 'marginal';
  if (optQ === 'mistake') {
    if (actual === 'fold') return 'good'; // folded when we should
    return 'mistake';
  }
  return 'marginal';
}

const GRADE_CONFIG = {
  A: { min: 85, color: '#22C55E', label: 'Excellent' },
  B: { min: 70, color: '#4ADE80', label: 'Good' },
  C: { min: 55, color: '#EAB308', label: 'Average' },
  D: { min: 40, color: '#F97316', label: 'Poor' },
  F: { min: 0,  color: '#EF4444', label: 'Costly mistakes' },
};

function scoreToGrade(score) {
  for (const [letter, cfg] of Object.entries(GRADE_CONFIG)) {
    if (score >= cfg.min) return { letter, ...cfg };
  }
  return { letter: 'F', ...GRADE_CONFIG.F };
}

export default function PostHandAnalysis({ gameState, yourSeat, handHistory, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [timerPct, setTimerPct] = useState(100);
  const timerRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const handNumberRef = useRef(null);

  const handResult = gameState?.handResult;
  const communityCards = gameState?.communityCards || [];
  const yourCards = gameState?.yourCards || [];
  const seats = gameState?.seats || [];
  const myPlayer = yourSeat >= 0 && seats[yourSeat] ? seats[yourSeat] : null;
  const pot = gameState?.pot || 0;
  const currentBetToMatch = gameState?.currentBetToMatch || 0;
  const myCurrentBet = myPlayer?.currentBet || 0;
  const callAmount = Math.max(0, currentBetToMatch - myCurrentBet);
  const potOdds = callAmount > 0 ? pot / callAmount : 0;

  // Extract my actual actions from hand history, grouped by street prefix
  const myHistoryPlayer = useMemo(() => {
    if (!handHistory || yourSeat < 0) return null;
    return handHistory.players?.find((p) => p.seatIndex === yourSeat) ?? null;
  }, [handHistory, yourSeat]);

  const actionsPerStreet = useMemo(() => {
    if (!myHistoryPlayer?.actions) return {};
    const map = { Preflop: [], Flop: [], Turn: [], River: [] };
    let curStreet = 'Preflop';
    for (const a of myHistoryPlayer.actions) {
      if (typeof a !== 'string') continue;
      if (a.startsWith('[Flop]')) { curStreet = 'Flop'; continue; }
      if (a.startsWith('[Turn]')) { curStreet = 'Turn'; continue; }
      if (a.startsWith('[River]')) { curStreet = 'River'; continue; }
      map[curStreet].push(a);
    }
    return map;
  }, [myHistoryPlayer]);

  // Evaluate hand at each street level
  const streetAnalysis = useMemo(() => {
    const result = [];
    if (yourCards.length < 2) return result;

    const preflopStrength = Math.min(1, (yourCards[0]?.rank || 2) / 14 * 0.55 + (yourCards[1]?.rank || 2) / 14 * 0.35);
    const preflopOptimal = getOptimalAction(preflopStrength, potOdds, callAmount);
    const preflopActual = classifyAction(actionsPerStreet.Preflop?.[actionsPerStreet.Preflop.length - 1]);
    result.push({
      street: 'Preflop',
      hand: 'Hole Cards',
      strength: preflopStrength,
      optimal: preflopOptimal,
      actual: preflopActual,
      quality: actionQuality(preflopActual, preflopOptimal),
    });

    if (communityCards.length >= 3) {
      const flopEval = evaluateHandStrength(yourCards, communityCards.slice(0, 3));
      const flopOptimal = getOptimalAction(flopEval.strength, potOdds, callAmount);
      const flopActual = classifyAction(actionsPerStreet.Flop?.[actionsPerStreet.Flop.length - 1]);
      result.push({ street: 'Flop', hand: flopEval.name, strength: flopEval.strength, optimal: flopOptimal, actual: flopActual, quality: actionQuality(flopActual, flopOptimal) });
    }
    if (communityCards.length >= 4) {
      const turnEval = evaluateHandStrength(yourCards, communityCards.slice(0, 4));
      const turnOptimal = getOptimalAction(turnEval.strength, potOdds, callAmount);
      const turnActual = classifyAction(actionsPerStreet.Turn?.[actionsPerStreet.Turn.length - 1]);
      result.push({ street: 'Turn', hand: turnEval.name, strength: turnEval.strength, optimal: turnOptimal, actual: turnActual, quality: actionQuality(turnActual, turnOptimal) });
    }
    if (communityCards.length >= 5) {
      const riverEval = evaluateHandStrength(yourCards, communityCards);
      const riverOptimal = getOptimalAction(riverEval.strength, potOdds, callAmount);
      const riverActual = classifyAction(actionsPerStreet.River?.[actionsPerStreet.River.length - 1]);
      result.push({ street: 'River', hand: riverEval.name, strength: riverEval.strength, optimal: riverOptimal, actual: riverActual, quality: actionQuality(riverActual, riverOptimal) });
    }
    return result;
  }, [yourCards, communityCards, potOdds, callAmount, actionsPerStreet]);

  // Overall grade: mistakes = 0pts, marginal = 50pts, good = 100pts, unknown = 70pts
  const score = useMemo(() => {
    const streets = streetAnalysis.filter((s) => s.actual !== null && s.actual !== 'unknown');
    if (streets.length === 0) return 70;
    const pts = streets.map((s) => s.quality === 'good' ? 100 : s.quality === 'mistake' ? 0 : 50);
    return Math.round(pts.reduce((a, b) => a + b, 0) / pts.length);
  }, [streetAnalysis]);

  const grade = useMemo(() => scoreToGrade(score), [score]);

  // Most costly mistake
  const worstStreet = useMemo(() => {
    return streetAnalysis.find((s) => s.quality === 'mistake') ?? null;
  }, [streetAnalysis]);

  const finalStrength = streetAnalysis.length > 0 ? streetAnalysis[streetAnalysis.length - 1].strength : 0;
  const suggestion = getOptimalAction(finalStrength, potOdds, callAmount);

  // Reset when new hand result appears
  useEffect(() => {
    if (!handResult) return;
    const hn = gameState?.handNumber;
    if (hn === handNumberRef.current) return;
    handNumberRef.current = hn;
    setDismissed(false);
    setExpanded(false);
    startTimeRef.current = Date.now();
    setTimerPct(100);
  }, [handResult, gameState?.handNumber]);

  // Auto-dismiss timer
  useEffect(() => {
    if (!handResult || dismissed || expanded) return;

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setTimerPct(remaining);
      if (remaining <= 0) {
        setDismissed(true);
        if (onDismiss) onDismiss();
      }
    }, 100);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [handResult, dismissed, expanded, onDismiss]);

  const handleToggle = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (onDismiss) onDismiss();
  }, [onDismiss]);

  if (!handResult || dismissed || yourCards.length < 2) return null;

  return (
    <div className={`post-hand-analysis ${dismissed ? 'pha-dismissed' : ''}`}>
      <div className="pha-header" onClick={handleToggle}>
        <span className="pha-header-title">Hand Analysis</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1rem', fontWeight: 800, color: grade.color }}>{grade.letter}</span>
          <span style={{ fontSize: '0.68rem', color: grade.color }}>{grade.label}</span>
          <span className="pha-header-toggle">{expanded ? '▲' : '▼'}</span>
        </span>
      </div>

      {!expanded && (
        <div className="pha-timer-bar">
          <div className="pha-timer-fill" style={{ width: `${timerPct}%` }} />
        </div>
      )}

      {expanded && (
        <div className="pha-body">
          {/* Grade banner */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '10px', padding: '8px', marginBottom: '8px',
            background: `${grade.color}18`, borderRadius: '8px',
            border: `1px solid ${grade.color}44`,
          }}>
            <span style={{ fontSize: '2rem', fontWeight: 900, color: grade.color }}>{grade.letter}</span>
            <div>
              <div style={{ color: grade.color, fontWeight: 700, fontSize: '0.85rem' }}>{grade.label}</div>
              <div style={{ color: '#888', fontSize: '0.68rem' }}>{score}/100 decision score</div>
            </div>
          </div>

          {/* Street-by-street analysis */}
          {streetAnalysis.map((sa) => {
            const qualityColor = sa.quality === 'good' ? '#22C55E' : sa.quality === 'mistake' ? '#EF4444' : '#EAB308';
            const qualityIcon = sa.quality === 'good' ? '✓' : sa.quality === 'mistake' ? '✗' : '~';
            return (
              <div className="pha-street-row" key={sa.street} style={{ position: 'relative' }}>
                <span className="pha-street-name">{sa.street}</span>
                <span className="pha-street-hand">{sa.hand}</span>
                <div className="pha-street-strength">
                  <div className="pha-street-strength-fill" style={{ width: `${sa.strength * 100}%`, background: strengthColor(sa.strength) }} />
                </div>
                {sa.actual && (
                  <span style={{ fontSize: '0.68rem', color: qualityColor, fontWeight: 700, flexShrink: 0, marginLeft: '4px' }}>
                    {qualityIcon} {sa.actual}
                  </span>
                )}
              </div>
            );
          })}

          {/* Worst mistake callout */}
          {worstStreet && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '6px', padding: '8px 10px', marginTop: '6px',
            }}>
              <div style={{ color: '#EF4444', fontSize: '0.72rem', fontWeight: 700, marginBottom: '2px' }}>
                ⚠ Costliest Mistake — {worstStreet.street}
              </div>
              <div style={{ color: '#ccc', fontSize: '0.7rem' }}>
                You {worstStreet.actual}ed with {Math.round(worstStreet.strength * 100)}% equity.
                GTO suggests: <span style={{ color: '#EAB308' }}>{worstStreet.optimal.action}</span>
              </div>
            </div>
          )}

          <div className="pha-divider" />

          <div className="pha-odds-row">
            <span className="pha-odds-label">Final Equity</span>
            <span className="pha-odds-value" style={{ color: strengthColor(finalStrength) }}>
              {Math.round(finalStrength * 100)}%
            </span>
          </div>
          <div className="pha-odds-row">
            <span className="pha-odds-label">Pot Odds</span>
            <span className="pha-odds-value" style={{ color: '#ccc' }}>
              {potOdds > 0 ? `${potOdds.toFixed(1)}:1` : 'N/A'}
            </span>
          </div>

          <button
            onClick={handleDismiss}
            style={{
              display: 'block', width: '100%', marginTop: '8px', padding: '6px',
              background: 'none', border: '1px solid #444', borderRadius: '6px',
              color: '#888', fontSize: '0.72rem', cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
