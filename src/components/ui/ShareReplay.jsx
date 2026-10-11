import { useState, useEffect, useRef, useMemo } from 'react';
import { buildReplaySteps } from '../../utils/handLog';
import './ShareReplay.css';

const SUIT_SYM = ['♥','♦','♣','♠'];
const SUIT_COL = ['#EF4444','#EF4444','#ffffff','#ffffff'];
const RANK_LABELS = ['','','2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function CardSprite({ card, faceDown = false }) {
  if (!card || faceDown) {
    return <div className="sr-card sr-card--back">🂠</div>;
  }
  const rank = RANK_LABELS[card.rank] || '?';
  const suit = SUIT_SYM[card.suit] ?? '?';
  const color = SUIT_COL[card.suit] ?? '#fff';
  return (
    <div className="sr-card" style={{ color }}>
      <span className="sr-card-rank">{rank}</span>
      <span className="sr-card-suit">{suit}</span>
    </div>
  );
}

// 2026-10-11 (.online R2 — APPUI-52). Steps come from the hand's real
// chronological actionLog (utils/handLog buildReplaySteps): the server's
// streets ('PreFlop' / 'Flop' / …) are matched, a fold ('folded') marks the
// seat, the board is dealt street by street (all-in runouts included), the pot
// grows with every bet and ends at the hand's real pot. The old builder looked
// for 'preflop' / 'fold' / history.pot (never sent) and showed a blank replay.
function buildSteps(history) {
  const steps = buildReplaySteps(history);
  return steps.length > 0 ? steps : [{ type: 'start', community: [], pot: 0, players: [], label: 'This hand cannot be replayed' }];
}

// 2026-06-19 Phase 5: encode with encodeURIComponent BEFORE btoa to match the
// `?replay=` consumer in App.jsx (`JSON.parse(decodeURIComponent(atob(param)))`)
// and HandReplayViewer's producer. Without it, btoa throws on any non-Latin1
// char (em-dash, accented/emoji player name) and the shared link silently
// failed to open.
export function encodeReplay(history) {
  try { return btoa(encodeURIComponent(JSON.stringify(history))); } catch { return ''; }
}

export function decodeReplay(encoded) {
  try { return JSON.parse(decodeURIComponent(atob(encoded))); } catch { return null; }
}

export function getShareURL(history) {
  const encoded = encodeReplay(history);
  const url = new URL(window.location.href);
  url.searchParams.set('replay', encoded);
  return url.toString();
}

export default function ShareReplay({ history, onClose }) {
  const steps = useMemo(() => buildSteps(history), [history]);
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const intervalRef = useRef(null);

  const step = steps[Math.min(stepIdx, steps.length - 1)];

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setStepIdx(i => {
          if (i >= steps.length - 1) { setPlaying(false); return i; }
          return i + 1;
        });
      }, 1200);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, steps.length]);

  const handleShare = async () => {
    const url = getShareURL(history);
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  return (
    <div className="sr-overlay" onClick={onClose}>
      <div className="sr-modal" onClick={e => e.stopPropagation()}>
        <button className="sr-close" onClick={onClose}>✕</button>
        <div className="sr-header">
          <span className="sr-title">🎬 Hand Replay</span>
          <span className="sr-hand-num">Hand #{history.handNumber || '—'}</span>
        </div>

        {/* Community cards */}
        <div className="sr-community">
          {Array.from({ length: 5 }, (_, i) => (
            <CardSprite key={i} card={(step.community || [])[i]} faceDown={!(step.community || [])[i]} />
          ))}
        </div>

        {/* Pot */}
        <div className="sr-pot">🪙 {(step.pot || 0).toLocaleString()}</div>

        {/* Players */}
        <div className="sr-players">
          {(step.players || []).map((p, i) => (
            <div key={i} className={`sr-player ${step.activeSeat === p.seatIndex ? 'sr-player--active' : ''} ${p.folded ? 'sr-player--folded' : ''}`}>
              <div className="sr-player-avatar">{(p.name || 'P').charAt(0).toUpperCase()}</div>
              <div className="sr-player-name">{p.name || `Seat ${i}`}</div>
              {p.revealed && p.holeCards && (
                <div className="sr-player-cards">
                  {(p.holeCards || []).map((c, ci) => <CardSprite key={ci} card={c} />)}
                </div>
              )}
              {p.folded && <div className="sr-player-fold">FOLD</div>}
            </div>
          ))}
        </div>

        {/* Action label */}
        <div className="sr-action-label">{step.label}</div>

        {/* Controls */}
        <div className="sr-controls">
          <button className="sr-btn" onClick={() => setStepIdx(0)} disabled={stepIdx === 0}>⏮</button>
          <button className="sr-btn" onClick={() => setStepIdx(i => Math.max(0, i - 1))} disabled={stepIdx === 0}>◀</button>
          <button className="sr-btn sr-btn--play" onClick={() => setPlaying(p => !p)}>
            {playing ? '⏸' : '▶'}
          </button>
          <button className="sr-btn" onClick={() => setStepIdx(i => Math.min(steps.length - 1, i + 1))} disabled={stepIdx >= steps.length - 1}>▶</button>
          <button className="sr-btn" onClick={() => setStepIdx(steps.length - 1)} disabled={stepIdx >= steps.length - 1}>⏭</button>
        </div>

        {/* Progress */}
        <div className="sr-progress-bar">
          <div className="sr-progress-fill" style={{ width: `${(stepIdx / Math.max(1, steps.length - 1)) * 100}%` }} />
        </div>
        <div className="sr-step-count">{stepIdx + 1} / {steps.length}</div>

        {/* Share */}
        <button className="sr-share-btn" onClick={handleShare}>
          {copied ? '✅ Link Copied!' : '🔗 Share This Hand'}
        </button>
        <div className="sr-share-note">Anyone can view this hand — no account required</div>

        {/* Winners */}
        {history.winners && history.winners.length > 0 && (
          <div className="sr-winners">
            {history.winners.map((w, i) => (
              <div key={i} className="sr-winner-row">
                🏆 {w.name || w.playerName} won {(w.chipsWon || w.amount || 0).toLocaleString()} chips
                {w.handName && <span className="sr-winner-hand"> · {w.handName}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
