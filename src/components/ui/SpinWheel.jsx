import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import './SpinWheel.css';

const SEGMENTS = [
  { label: '100', value: 100, type: 'chips', color: '#3B82F6', icon: '\uD83D\uDCB0' },
  { label: '250', value: 250, type: 'chips', color: '#8B5CF6', icon: '\uD83D\uDCB0' },
  { label: '500', value: 500, type: 'chips', color: '#22C55E', icon: '\uD83D\uDCB0' },
  { label: '1,000', value: 1000, type: 'chips', color: '#EF4444', icon: '\uD83D\uDCB0' },
  { label: '2,500', value: 2500, type: 'chips', color: '#F97316', icon: '\uD83D\uDCB0' },
  { label: '5,000', value: 5000, type: 'chips', color: '#EC4899', icon: '\uD83D\uDCB0' },
  { label: '2x XP', value: 2, type: 'xp_multiplier', color: '#06B6D4', icon: '\u2B50' },
  { label: 'Mystery', value: 0, type: 'mystery', color: '#A855F7', icon: '\uD83C\uDF81' },
];

const SPIN_KEY = 'poker_daily_spin';

function canSpinToday() {
  try {
    const lastSpin = localStorage.getItem(SPIN_KEY);
    if (!lastSpin) return true;
    const lastDate = new Date(lastSpin).toDateString();
    const today = new Date().toDateString();
    return lastDate !== today;
  } catch {
    return true;
  }
}

function markSpinUsed() {
  localStorage.setItem(SPIN_KEY, new Date().toISOString());
}

export default function SpinWheel({ onClose }) {
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [prize, setPrize] = useState(null);
  const [canSpin, setCanSpin] = useState(canSpinToday());
  const discRef = useRef(null);

  const segAngle = 360 / SEGMENTS.length;

  const doSpin = useCallback(() => {
    if (spinning || !canSpin) return;

    setSpinning(true);

    // Pick random winner
    const winnerIndex = Math.floor(Math.random() * SEGMENTS.length);
    const won = SEGMENTS[winnerIndex];

    // Calculate target rotation so pointer (top) lands on the winning segment
    // Segment 0 starts at 0deg, each segment spans segAngle
    // Pointer is at top (0deg), so we need the midpoint of the segment to align with top
    const segMiddle = winnerIndex * segAngle + segAngle / 2;
    const extraSpins = 5 + Math.floor(Math.random() * 3); // 5-7 full rotations
    const targetRotation = rotation + extraSpins * 360 + (360 - segMiddle);

    setRotation(targetRotation);

    setTimeout(() => {
      setSpinning(false);
      setPrize(won);
      markSpinUsed();
      setCanSpin(false);

      // Emit reward claim to server
      const socket = getSocket();
      if (socket) {
        socket.emit('claimSpinReward', {
          type: won.type,
          value: won.type === 'mystery' ? Math.floor(Math.random() * 3000) + 500 : won.value,
          label: won.label,
        });
      }
    }, 4200);
  }, [spinning, canSpin, rotation, segAngle]);

  const closePrize = () => setPrize(null);

  // Build SVG wheel segments
  const segmentElements = SEGMENTS.map((seg, i) => {
    const startAngle = i * segAngle;
    const endAngle = (i + 1) * segAngle;
    const startRad = (startAngle - 90) * (Math.PI / 180);
    const endRad = (endAngle - 90) * (Math.PI / 180);
    const x1 = 140 + 130 * Math.cos(startRad);
    const y1 = 140 + 130 * Math.sin(startRad);
    const x2 = 140 + 130 * Math.cos(endRad);
    const y2 = 140 + 130 * Math.sin(endRad);
    const largeArc = segAngle > 180 ? 1 : 0;

    const midAngle = ((startAngle + endAngle) / 2 - 90) * (Math.PI / 180);
    const labelX = 140 + 85 * Math.cos(midAngle);
    const labelY = 140 + 85 * Math.sin(midAngle);
    const labelRotation = (startAngle + endAngle) / 2;

    return (
      <g key={i}>
        <path
          d={`M 140 140 L ${x1} ${y1} A 130 130 0 ${largeArc} 1 ${x2} ${y2} Z`}
          fill={seg.color}
          stroke="rgba(0,0,0,0.3)"
          strokeWidth="1"
        />
        <text
          x={labelX}
          y={labelY}
          fill="#fff"
          fontSize="11"
          fontWeight="700"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${labelRotation}, ${labelX}, ${labelY})`}
          style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}
        >
          {seg.label}
        </text>
      </g>
    );
  });

  return createPortal(
    <>
      <div className="spin-wheel-overlay" onClick={onClose}>
        <div className="spin-wheel-panel" onClick={(e) => e.stopPropagation()}>
          <div className="spin-wheel-header">
            <div className="spin-wheel-title">Daily Spin</div>
            <button className="spin-wheel-close" onClick={onClose}>Close</button>
          </div>

          <div className="spin-wheel-container">
            <div className="spin-wheel-pointer" />
            <div
              ref={discRef}
              className={`spin-wheel-disc ${spinning ? 'spinning' : ''}`}
              style={{ transform: `rotate(${rotation}deg)` }}
            >
              <svg viewBox="0 0 280 280" width="100%" height="100%">
                {segmentElements}
              </svg>
            </div>
            <div className="spin-wheel-center">SPIN</div>
          </div>

          <button
            className="spin-wheel-btn"
            onClick={doSpin}
            disabled={spinning || !canSpin}
          >
            {spinning ? 'Spinning...' : canSpin ? 'SPIN FREE!' : 'Come Back Tomorrow'}
          </button>

          {!canSpin && !spinning && (
            <div className="spin-wheel-cooldown">
              You have already used your free daily spin.
            </div>
          )}
        </div>
      </div>

      {prize && (
        <div className="spin-prize-popup" onClick={closePrize}>
          <div className="spin-prize-card" onClick={(e) => e.stopPropagation()}>
            <span className="spin-prize-icon">{prize.icon}</span>
            <div className="spin-prize-label">
              {prize.type === 'chips' && `${prize.value.toLocaleString()} Chips!`}
              {prize.type === 'xp_multiplier' && '2x XP Boost!'}
              {prize.type === 'mystery' && 'Mystery Prize!'}
            </div>
            <div className="spin-prize-desc">
              {prize.type === 'chips' && 'Chips have been added to your balance.'}
              {prize.type === 'xp_multiplier' && 'Double XP for your next 10 hands!'}
              {prize.type === 'mystery' && 'A random bonus has been added to your account!'}
            </div>
            <button className="spin-prize-claim-btn" onClick={closePrize}>Awesome!</button>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
