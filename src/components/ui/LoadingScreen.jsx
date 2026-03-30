import { useState, useEffect } from 'react';
import './LoadingScreen.css';

const TIPS = [
  'Tip: Position is the most powerful weapon in poker.',
  'Tip: Play fewer hands, but play them aggressively.',
  'Tip: Fold more preflop — tighten up from early position.',
  'Tip: Pot odds tell you when calling is mathematically correct.',
  'Tip: Bluff less than you think — most players call too much.',
  'Tip: A check-raise signals strength. Use it sparingly.',
  'Tip: Protect your big hands on draw-heavy boards.',
  'Tip: Watch bet sizing — it reveals hand strength.',
];

const STAGES = [
  { pct: 15, text: 'Loading assets…' },
  { pct: 40, text: 'Connecting to server…' },
  { pct: 70, text: 'Fetching tables…' },
  { pct: 90, text: 'Almost ready…' },
  { pct: 100, text: 'Ready!' },
];

const CARDS = ['A♠', 'K♥', 'Q♦', 'J♣', '10♠'];
const CARD_COLORS = ['#fff', '#EF4444', '#EF4444', '#fff', '#fff'];

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  symbol: ['🃏', '♠', '♥', '♦', '♣', '🪙'][i % 6],
  left: `${5 + (i * 5.5) % 90}%`,
  delay: `${(i * 0.4) % 6}s`,
  duration: `${6 + (i * 0.7) % 6}s`,
  size: `${0.8 + (i % 3) * 0.3}rem`,
  opacity: 0.04 + (i % 4) * 0.02,
}));

const SUITS = [
  { sym: '♠', color: '#ffffff', angle: 0 },
  { sym: '♥', color: '#EF4444', angle: 90 },
  { sym: '♦', color: '#EF4444', angle: 180 },
  { sym: '♣', color: '#4ADE80', angle: 270 },
];

export default function LoadingScreen({ exiting = false }) {
  const [tipIdx, setTipIdx] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);

  // Tip carousel — rotate every 2s
  useEffect(() => {
    const t = setInterval(() => setTipIdx(i => (i + 1) % TIPS.length), 2000);
    return () => clearInterval(t);
  }, []);

  // Phase status messages — advance through stages
  useEffect(() => {
    const timings = [300, 800, 1400, 1750];
    const timers = timings.map((ms, i) => setTimeout(() => setStageIdx(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  const stage = STAGES[Math.min(stageIdx, STAGES.length - 1)];

  return (
    <div className={`loading-screen ${exiting ? 'loading-screen--exit' : ''}`}>

      {/* Particle rain */}
      <div className="loading-particles" aria-hidden="true">
        {PARTICLES.map(p => (
          <span key={p.id} className="loading-particle" style={{
            left: p.left,
            animationDelay: p.delay,
            animationDuration: p.duration,
            fontSize: p.size,
            opacity: p.opacity,
          }}>{p.symbol}</span>
        ))}
      </div>

      {/* Title */}
      <h1 className="loading-title">American Pub Poker</h1>
      <p className="loading-tagline">v1.0 · Play Free · No Download</p>

      {/* Chip + orbiting suits */}
      <div className="loading-chip-wrap">
        <div className="loading-chip" />
        {SUITS.map(s => (
          <span key={s.sym} className="loading-orbit-suit" style={{
            '--orbit-angle': `${s.angle}deg`,
            color: s.color,
          }}>{s.sym}</span>
        ))}
      </div>

      {/* Card fan */}
      <div className="loading-card-fan" aria-hidden="true">
        {CARDS.map((card, i) => (
          <div key={i} className="loading-fan-card" style={{
            '--fan-i': i,
            color: CARD_COLORS[i],
          }}>{card}</div>
        ))}
      </div>

      {/* Status text */}
      <div className="loading-text">{stage.text}</div>

      {/* Progress bar */}
      <div className="loading-progress-container">
        <div className="loading-progress-fill" style={{ width: `${stage.pct}%` }} />
      </div>

      {/* Tip carousel */}
      <div className="loading-tip" key={tipIdx}>{TIPS[tipIdx]}</div>
    </div>
  );
}
