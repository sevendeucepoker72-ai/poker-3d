import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SUIT_INDEX_TO_SYMBOL, SUIT_INDEX_TO_COLOR, serverRankDisplay } from '../../utils/cardUtils';
import { evaluateHandStrength } from '../../utils/handStrength';
import './HandReplayViewer.css';

/*
 * Hand Replay Viewer
 * Reconstructs a step-by-step replay from the handHistory record.
 * Each "step" is one of: blinds posted, hole cards dealt, player action, community cards, showdown.
 */

function buildReplaySteps(history) {
  if (!history) return [];
  const steps = [];

  // Step 0: Shuffle / setup
  steps.push({
    type: 'setup',
    phase: 'Setup',
    label: `Hand #${history.handNumber} - Dealer shuffles`,
    activeSeat: -1,
    pot: 0,
    communityCards: [],
    playerStates: history.players.map((p) => ({
      ...p,
      revealed: false,
      currentAction: null,
      folded: false,
      chips: p.startChips,
    })),
  });

  // Step 1: Blinds posted
  const blindStep = {
    type: 'blinds',
    phase: 'Blinds',
    label: 'Blinds posted',
    activeSeat: -1,
    pot: 0,
    communityCards: [],
    playerStates: history.players.map((p) => ({
      ...p,
      revealed: false,
      currentAction: null,
      folded: false,
      chips: p.startChips,
    })),
  };
  // Parse blind amounts from actions
  let runningPot = 0;
  for (const p of history.players) {
    if (p.actions && p.actions.length > 0) {
      for (const a of p.actions) {
        if (typeof a === 'string' && a.includes('SB')) {
          const match = a.match(/\d+/);
          if (match) runningPot += parseInt(match[0]);
        }
        if (typeof a === 'string' && a.includes('BB')) {
          const match = a.match(/\d+/);
          if (match) runningPot += parseInt(match[0]);
        }
      }
    }
  }
  if (runningPot === 0 && history.pots && history.pots.length > 0) {
    // Estimate from final pot
    runningPot = Math.min(history.pots[0].amount, 100);
  }
  blindStep.pot = runningPot;
  steps.push(blindStep);

  // Step 2: Hole cards dealt
  steps.push({
    type: 'deal',
    phase: 'PreFlop',
    label: 'Hole cards dealt',
    activeSeat: -1,
    pot: runningPot,
    communityCards: [],
    playerStates: history.players.map((p) => ({
      ...p,
      revealed: true,
      currentAction: null,
      folded: false,
      chips: p.startChips,
    })),
  });

  // Steps 3+: Player actions
  // Parse the action strings from each player
  const allActions = [];
  for (const p of history.players) {
    if (p.actions) {
      for (const a of p.actions) {
        if (typeof a === 'string') {
          // Skip blind posting strings for action replay
          if (a.includes('SB') || a.includes('BB') || a.includes('Ante')) continue;
          allActions.push({ seatIndex: p.seatIndex, name: p.name, action: a });
        }
      }
    }
  }

  const foldedPlayers = new Set();
  let currentPot = runningPot;

  // Determine community card reveal points
  const cc = history.communityCards || [];
  let flopAdded = false;
  let turnAdded = false;
  let riverAdded = false;
  let actionCount = 0;
  const flopAt = Math.min(3, allActions.length);
  const turnAt = Math.min(flopAt + 3, allActions.length);
  const riverAt = Math.min(turnAt + 2, allActions.length);

  for (let i = 0; i < allActions.length; i++) {
    const a = allActions[i];
    actionCount++;

    // Check for community card reveals based on action index
    if (!flopAdded && actionCount >= flopAt && cc.length >= 3) {
      steps.push({
        type: 'community',
        phase: 'Flop',
        label: 'Flop revealed',
        activeSeat: -1,
        pot: currentPot,
        communityCards: cc.slice(0, 3),
        playerStates: steps[steps.length - 1].playerStates.map((p) => ({
          ...p,
          currentAction: null,
        })),
      });
      flopAdded = true;
    }

    if (!turnAdded && flopAdded && actionCount >= turnAt && cc.length >= 4) {
      steps.push({
        type: 'community',
        phase: 'Turn',
        label: 'Turn revealed',
        activeSeat: -1,
        pot: currentPot,
        communityCards: cc.slice(0, 4),
        playerStates: steps[steps.length - 1].playerStates.map((p) => ({
          ...p,
          currentAction: null,
        })),
      });
      turnAdded = true;
    }

    if (!riverAdded && turnAdded && actionCount >= riverAt && cc.length >= 5) {
      steps.push({
        type: 'community',
        phase: 'River',
        label: 'River revealed',
        activeSeat: -1,
        pot: currentPot,
        communityCards: cc.slice(0, 5),
        playerStates: steps[steps.length - 1].playerStates.map((p) => ({
          ...p,
          currentAction: null,
        })),
      });
      riverAdded = true;
    }

    // Parse amount from action string
    const amountMatch = a.action.match(/(\d[\d,]*)/);
    const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, '')) : 0;
    if (amount > 0) currentPot += amount;

    if (a.action.toLowerCase().includes('fold')) {
      foldedPlayers.add(a.seatIndex);
    }

    const prevStates = steps[steps.length - 1].playerStates;
    steps.push({
      type: 'action',
      phase: steps[steps.length - 1].phase || 'PreFlop',
      label: `${a.name}: ${a.action}`,
      activeSeat: a.seatIndex,
      pot: currentPot,
      communityCards: steps[steps.length - 1].communityCards,
      playerStates: prevStates.map((p) => ({
        ...p,
        currentAction: p.seatIndex === a.seatIndex ? a.action : p.currentAction,
        folded: foldedPlayers.has(p.seatIndex),
      })),
    });
  }

  // Add remaining community cards if not shown yet
  if (!flopAdded && cc.length >= 3) {
    steps.push({
      type: 'community', phase: 'Flop', label: 'Flop revealed',
      activeSeat: -1, pot: currentPot, communityCards: cc.slice(0, 3),
      playerStates: steps[steps.length - 1].playerStates.map((p) => ({ ...p, currentAction: null })),
    });
  }
  if (!turnAdded && cc.length >= 4) {
    steps.push({
      type: 'community', phase: 'Turn', label: 'Turn revealed',
      activeSeat: -1, pot: currentPot, communityCards: cc.slice(0, 4),
      playerStates: steps[steps.length - 1].playerStates.map((p) => ({ ...p, currentAction: null })),
    });
  }
  if (!riverAdded && cc.length >= 5) {
    steps.push({
      type: 'community', phase: 'River', label: 'River revealed',
      activeSeat: -1, pot: currentPot, communityCards: cc.slice(0, 5),
      playerStates: steps[steps.length - 1].playerStates.map((p) => ({ ...p, currentAction: null })),
    });
  }

  // Showdown step
  const finalPot = history.pots ? history.pots.reduce((s, p) => s + p.amount, 0) : currentPot;
  steps.push({
    type: 'showdown',
    phase: 'Showdown',
    label: 'Showdown',
    activeSeat: -1,
    pot: finalPot,
    communityCards: cc,
    playerStates: history.players.map((p) => ({
      ...p,
      revealed: true,
      currentAction: null,
      folded: foldedPlayers.has(p.seatIndex),
      chips: p.endChips,
    })),
    winners: history.winners,
  });

  return steps;
}

function ReplayCard({ card }) {
  if (!card) return null;
  return (
    <span
      className="replay-card"
      style={{ color: SUIT_INDEX_TO_COLOR[card.suit] }}
    >
      {serverRankDisplay(card.rank)}{SUIT_INDEX_TO_SYMBOL[card.suit]}
    </span>
  );
}

function suitEmoji(suitIndex) {
  const map = { 0: '\u2665\uFE0F', 1: '\u2666\uFE0F', 2: '\u2663\uFE0F', 3: '\u2660\uFE0F' };
  return map[suitIndex] || '?';
}

function cardToText(card) {
  if (!card) return '??';
  return `${serverRankDisplay(card.rank)}${suitEmoji(card.suit)}`;
}

function generateHandSummary(history) {
  if (!history) return '';
  const lines = [];
  lines.push(`\u2660 Hand #${history.handNumber}`);
  lines.push('');

  lines.push('Players:');
  for (const p of history.players) {
    const cards = p.holeCards && p.holeCards.length > 0
      ? p.holeCards.map(cardToText).join(' ')
      : '(hidden)';
    lines.push(`  ${p.name} [${cards}] - ${p.startChips.toLocaleString()} chips`);
  }
  lines.push('');

  if (history.communityCards && history.communityCards.length > 0) {
    lines.push('Board: ' + history.communityCards.map(cardToText).join(' '));
    lines.push('');
  }

  lines.push('Actions:');
  for (const p of history.players) {
    if (p.actions && p.actions.length > 0) {
      for (const a of p.actions) {
        if (typeof a === 'string') {
          lines.push(`  ${p.name}: ${a}`);
        }
      }
    }
  }
  lines.push('');

  if (history.winners && history.winners.length > 0) {
    lines.push('Winners:');
    for (const w of history.winners) {
      lines.push(`  \u2B50 ${w.name} wins ${(w.chipsWon || 0).toLocaleString()} chips${w.handName ? ` with ${w.handName}` : ''}`);
    }
  }

  if (history.pots && history.pots.length > 0) {
    lines.push('');
    const potStr = history.pots.map((p, i) => `${i === 0 ? 'Main' : `Side ${i}`}: ${p.amount.toLocaleString()}`).join(' | ');
    lines.push(`Pots: ${potStr}`);
  }

  return lines.join('\n');
}

export default function HandReplayViewer({ history, onClose }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [shareToast, setShareToast] = useState(false);
  const intervalRef = useRef(null);

  const steps = useMemo(() => buildReplaySteps(history), [history]);

  const step = steps[currentStep] || steps[0];

  // Auto-play
  useEffect(() => {
    if (playing && currentStep < steps.length - 1) {
      intervalRef.current = setTimeout(() => {
        setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
      }, 1500 / speed);
    } else if (currentStep >= steps.length - 1) {
      setPlaying(false);
    }
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [playing, currentStep, speed, steps.length]);

  const handlePlay = useCallback(() => {
    if (currentStep >= steps.length - 1) {
      setCurrentStep(0);
    }
    setPlaying(true);
  }, [currentStep, steps.length]);

  const handlePause = useCallback(() => setPlaying(false), []);
  const handleStepForward = useCallback(() => {
    setPlaying(false);
    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  }, [steps.length]);
  const handleStepBack = useCallback(() => {
    setPlaying(false);
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleShareHand = useCallback(() => {
    // Encode history as base64 URL parameter — viewable by anyone without login
    try {
      const encoded = btoa(encodeURIComponent(JSON.stringify(history)));
      const url = `${window.location.origin}${window.location.pathname}?replay=${encoded}`;
      navigator.clipboard.writeText(url).catch(() => {});
    } catch (_) {}
    setShareToast(true);
    setTimeout(() => setShareToast(false), 2500);
  }, [history]);

  if (!history || steps.length === 0) return null;

  const progressPct = steps.length > 1 ? (currentStep / (steps.length - 1)) * 100 : 0;

  return (
    <div className="replay-overlay">
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginBottom: '4px' }}>
        <button className="replay-btn" onClick={handleShareHand} style={{ position: 'relative' }}>
          Share Hand
          {shareToast && (
            <span style={{
              position: 'absolute',
              top: '-28px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(74, 222, 128, 0.9)',
              color: '#0a1a0a',
              padding: '3px 10px',
              borderRadius: '4px',
              fontSize: '0.7rem',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              animation: 'card-deal-in 0.2s ease-out',
            }}>
              Link copied!
            </span>
          )}
        </button>
        <button className="replay-close" onClick={onClose}>Close</button>
      </div>

      <div className="replay-title">Hand Replay #{history.handNumber}</div>

      <div className="replay-stage">
        {/* Left: Player list */}
        <div className="replay-players">
          {step.playerStates.map((p) => {
            const isActive = p.seatIndex === step.activeSeat;
            const isWinner = step.winners && step.winners.some((w) => w.seatIndex === p.seatIndex);
            return (
              <div
                key={p.seatIndex}
                className={`replay-player-row ${isActive ? 'active' : ''} ${p.folded ? 'folded' : ''} ${isWinner ? 'winner' : ''}`}
              >
                <span className="replay-player-name">
                  {isWinner ? '\u2605 ' : ''}{p.name}
                </span>
                <div className="replay-player-cards">
                  {p.revealed && p.holeCards && p.holeCards.map((c, i) => (
                    <ReplayCard key={i} card={c} />
                  ))}
                  {!p.revealed && !p.folded && (
                    <>
                      <span className="replay-card" style={{ color: '#555' }}>??</span>
                      <span className="replay-card" style={{ color: '#555' }}>??</span>
                    </>
                  )}
                </div>
                {p.handName && step.type === 'showdown' && (
                  <span className="replay-player-hand-name">{p.handName}</span>
                )}
                {/* Hand equity at current street */}
                {p.revealed && p.holeCards && step.communityCards.length >= 3 && !p.folded && (() => {
                  const hs = evaluateHandStrength(p.holeCards, step.communityCards);
                  if (!hs) return null;
                  const pct = Math.round(hs.strength * 100);
                  const color = pct >= 60 ? '#4ADE80' : pct >= 30 ? '#FBBF24' : '#EF4444';
                  return (
                    <span className="replay-player-equity" style={{ color }}>
                      {pct}% {hs.name}
                    </span>
                  );
                })()}
                <span className="replay-player-chips">{(p.chips || 0).toLocaleString()}</span>
              </div>
            );
          })}
        </div>

        {/* Center: Community cards, pot, action */}
        <div className="replay-center">
          <div className="replay-phase-label">{step.phase}</div>

          <div className="replay-community-cards">
            {step.communityCards.map((c, i) => (
              <ReplayCard key={i} card={c} />
            ))}
            {step.communityCards.length === 0 && (
              <span style={{ color: '#444', fontSize: '0.85rem' }}>No community cards yet</span>
            )}
          </div>

          <div className="replay-pot">Pot: {(step.pot || 0).toLocaleString()}</div>

          <div className="replay-action-display">
            {step.type === 'setup' && <span className="replay-action-text">Dealer is shuffling...</span>}
            {step.type === 'blinds' && <span className="replay-action-text">Blinds posted</span>}
            {step.type === 'deal' && <span className="replay-action-text">Cards dealt to all players</span>}
            {step.type === 'community' && <span className="replay-action-text">{step.label}</span>}
            {step.type === 'action' && (
              <>
                <span className="replay-action-player">
                  {step.playerStates.find((p) => p.seatIndex === step.activeSeat)?.name || 'Player'}
                </span>
                <span className="replay-action-text">
                  {step.playerStates.find((p) => p.seatIndex === step.activeSeat)?.currentAction || ''}
                </span>
              </>
            )}
            {step.type === 'showdown' && step.winners && step.winners.map((w, i) => (
              <span key={i}>
                <span className="replay-action-player">{w.name}</span>
                <span className="replay-action-text"> wins </span>
                <span className="replay-action-amount">+{(w.chipsWon || 0).toLocaleString()}</span>
                {w.handName && <span className="replay-action-text"> with {w.handName}</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="replay-timeline">
        <div className="replay-timeline-bar">
          <div className="replay-timeline-progress" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="replay-timeline-dots">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`replay-timeline-dot ${i < currentStep ? 'passed' : ''} ${i === currentStep ? 'current' : ''}`}
              onClick={() => { setPlaying(false); setCurrentStep(i); }}
            />
          ))}
        </div>
        <div className="replay-step-counter">Step {currentStep + 1} / {steps.length}</div>
      </div>

      {/* Controls */}
      <div className="replay-controls">
        <button className="replay-btn" onClick={handleStepBack} disabled={currentStep === 0}>
          &laquo; Back
        </button>
        {playing ? (
          <button className="replay-btn active" onClick={handlePause}>Pause</button>
        ) : (
          <button className="replay-btn" onClick={handlePlay}>Play</button>
        )}
        <button className="replay-btn" onClick={handleStepForward} disabled={currentStep >= steps.length - 1}>
          Next &raquo;
        </button>

        <div className="replay-speed-group">
          {[1, 2, 4].map((s) => (
            <button
              key={s}
              className={`replay-speed-btn ${speed === s ? 'active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
