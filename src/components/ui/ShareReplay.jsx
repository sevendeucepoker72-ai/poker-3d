import { useState, useEffect, useRef } from 'react';
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

function buildSteps(history) {
  const steps = [];
  const players = (history.players || []).map(p => ({ ...p, folded: false, revealed: false }));
  const numSeats = players.length;

  // Start
  steps.push({ type: 'start', community: [], pot: 0, players: players.map(p => ({ ...p })), label: 'Hand Start' });

  // Blinds
  steps.push({ type: 'blinds', community: [], pot: history.pot || 0, players: players.map(p => ({ ...p })), label: 'Blinds Posted' });

  // Each street
  const streets = ['preflop', 'flop', 'turn', 'river'];
  const communityProgression = [
    [],
    (history.communityCards || []).slice(0, 3),
    (history.communityCards || []).slice(0, 4),
    (history.communityCards || []).slice(0, 5),
  ];

  streets.forEach((street, si) => {
    const community = communityProgression[si];
    // collect actions for this street from action log
    const streetActions = (history.actionLog || []).filter(a => a.street === street);
    if (si > 0 || streetActions.length) {
      streetActions.forEach(a => {
        const statePlayers = players.map(p => {
          if (p.seatIndex === a.seatIndex && a.action === 'fold') return { ...p, folded: true };
          return { ...p };
        });
        steps.push({
          type: 'action', community, pot: a.potAfter || history.pot || 0,
          players: statePlayers, label: `${a.playerName}: ${a.action}${a.amount ? ` ${a.amount}` : ''}`,
          activeSeat: a.seatIndex,
        });
      });
      if (si > 0 && si <= 3) {
        steps.push({ type: 'deal', community, pot: history.pot || 0, players: players.map(p => ({ ...p })), label: street.charAt(0).toUpperCase() + street.slice(1) });
      }
    }
  });

  // Showdown
  const showdownPlayers = players.map(p => ({ ...p, revealed: true }));
  steps.push({ type: 'showdown', community: history.communityCards || [], pot: history.pot || 0, players: showdownPlayers, label: 'Showdown' });

  return steps;
}

export function encodeReplay(history) {
  try { return btoa(JSON.stringify(history)); } catch { return ''; }
}

export function decodeReplay(encoded) {
  try { return JSON.parse(atob(encoded)); } catch { return null; }
}

export function getShareURL(history) {
  const encoded = encodeReplay(history);
  const url = new URL(window.location.href);
  url.searchParams.set('replay', encoded);
  return url.toString();
}

export default function ShareReplay({ history, onClose }) {
  const steps = buildSteps(history);
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
          <div className="sr-progress-fill" style={{ width: `${(stepIdx / (steps.length - 1)) * 100}%` }} />
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
