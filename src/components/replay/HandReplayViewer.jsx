import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SUIT_INDEX_TO_SYMBOL, SUIT_INDEX_TO_COLOR, serverRankDisplay } from '../../utils/cardUtils';
import { evaluateHandStrength } from '../../utils/handStrength';
import { buildReplaySteps } from './replaySteps';
import './HandReplayViewer.css';

/*
 * Hand Replay Viewer
 * Reconstructs a step-by-step replay from the handHistory record.
 * Each "step" is one of: blinds posted, hole cards dealt, player action, community cards, showdown.
 */

// R2 (TABLEUI-16 / APPUI-16) — the steps come from the record's chronological
// actionLog (replaySteps.js): the board shows on each street change and the pot
// follows the real chip movements (it used to replay in seat order, reveal the
// board after a share of actions and add up every number in the texts).
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

// 2026-10-23 review fix-up (owner: "Turn all off") — `hideStrength`: opened
// from a QUALIFIER table (GameHUD's helpToolsOff), a revealed hand shows only
// its name on each street, never the hand-strength percent (the same metric
// the live hand pill no longer shows there). Lobby / shared replays unchanged.
export default function HandReplayViewer({ history, onClose, hideStrength = false }) {
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
    // Encode history as base64 URL parameter — viewable by anyone without login.
    // Copy path: try async Clipboard API first, fall back to execCommand for
    // older browsers / HTTP origins / sandboxed iframes, and alert the user
    // with the URL if both paths fail (previously a silent .catch meant the
    // "Link copied!" toast lied — the user thought it copied but it hadn't).
    let url;
    try {
      const encoded = btoa(encodeURIComponent(JSON.stringify(history)));
      url = `${window.location.origin}${window.location.pathname}?replay=${encoded}`;
    } catch (_) {
      // Encoding failure — nothing to copy. Surface to user so they aren't
      // left with a false "Link copied!" toast.
      // eslint-disable-next-line no-alert
      alert("Couldn't build share link — please try again.");
      return;
    }

    const legacyCopy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    };

    const onSuccess = () => {
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2500);
    };
    const onFailure = () => {
      // eslint-disable-next-line no-alert
      alert("Couldn't copy — please copy manually: " + url);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(onSuccess).catch(() => {
        if (legacyCopy()) onSuccess();
        else onFailure();
      });
    } else if (legacyCopy()) {
      onSuccess();
    } else {
      onFailure();
    }
  }, [history]);

  if (!history || steps.length === 0) return null;

  const progressPct = steps.length > 1 ? (currentStep / (steps.length - 1)) * 100 : 0;

  return (
    <div className="replay-overlay" role="dialog" aria-label={`Hand replay #${history.handNumber ?? ''}`}>
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
                {/* R3 (TABLEUI-6, contract H1) — a hand name only next to its shown cards. */}
                {p.handName && p.revealed && p.holeCards && step.type === 'showdown' && (
                  <span className="replay-player-hand-name">{p.handName}</span>
                )}
                {/* Hand equity at current street */}
                {p.revealed && p.holeCards && step.communityCards.length >= 3 && !p.folded && (() => {
                  // 2026-07-05 audit P2 fix: pass the replayed hand's variant so an
                  // Omaha replay uses the must-use-exactly-2 rule, not Hold'em any-5.
                  const hs = evaluateHandStrength(p.holeCards, step.communityCards, { variant: history.variant });
                  if (!hs) return null;
                  if (hideStrength) {
                    return (
                      <span className="replay-player-equity replay-player-equity--plain">
                        {hs.name}
                      </span>
                    );
                  }
                  const pct = Math.round(hs.strength * 100);
                  const color = pct >= 60 ? '#4ADE80' : pct >= 30 ? '#FBBF24' : '#F59E0B';
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
            {step.type === 'antes' && <span className="replay-action-text">Antes posted</span>}
            {step.type === 'street' && <span className="replay-action-text">{step.label}</span>}
            {step.type === 'blinds' && <span className="replay-action-text">{step.label}</span>}
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
