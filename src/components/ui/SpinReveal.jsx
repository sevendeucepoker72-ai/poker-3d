import { useState, useEffect, useRef } from 'react';
import './SpinReveal.css';

const MULTIPLIERS = [2, 3, 5, 10, 25];

export default function SpinReveal({ multiplier, onComplete }) {
  const [phase, setPhase] = useState('spinning'); // 'spinning' | 'landed' | 'done'
  const [displayIndex, setDisplayIndex] = useState(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Spinning animation: cycle through multipliers rapidly, then slow down
  useEffect(() => {
    let count = 0;
    const totalCycles = 20;
    let timeout;

    const cycle = () => {
      count++;
      setDisplayIndex((prev) => (prev + 1) % MULTIPLIERS.length);

      if (count >= totalCycles) {
        // Land on the actual multiplier
        const targetIndex = MULTIPLIERS.indexOf(multiplier);
        setDisplayIndex(targetIndex >= 0 ? targetIndex : 0);
        setPhase('landed');

        // Auto-dismiss after 2.5 seconds
        timeout = setTimeout(() => {
          setPhase('done');
          if (onCompleteRef.current) onCompleteRef.current();
        }, 2500);
        return;
      }

      // Speed: starts fast (80ms), gradually slows to 200ms
      const delay = 80 + (count / totalCycles) * 200;
      timeout = setTimeout(cycle, delay);
    };

    timeout = setTimeout(cycle, 100);

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [multiplier]);

  if (phase === 'done') return null;

  const currentMultiplier = MULTIPLIERS[displayIndex];
  const isLanded = phase === 'landed';

  // Color based on multiplier value
  const getColor = (m) => {
    if (m >= 25) return '#FFD700';
    if (m >= 10) return '#FF6B35';
    if (m >= 5) return '#B388FF';
    if (m >= 3) return '#4ADE80';
    return '#6ABAFF';
  };

  return (
    <div className="spin-reveal-overlay">
      <div className="spin-reveal-content">
        <div className="spin-reveal-title">SPIN & GO</div>
        <div className="spin-reveal-subtitle">Prize Multiplier</div>

        <div className={`spin-reveal-number ${isLanded ? 'spin-landed' : 'spin-cycling'}`}>
          <span
            className="spin-multiplier"
            style={{ color: getColor(currentMultiplier) }}
          >
            {currentMultiplier}x
          </span>
        </div>

        {isLanded && (
          <div className="spin-reveal-prize" style={{ color: getColor(multiplier) }}>
            {multiplier >= 10 ? 'JACKPOT!' : multiplier >= 5 ? 'GREAT SPIN!' : 'Good Luck!'}
          </div>
        )}

        <div className="spin-reveal-tiers">
          {MULTIPLIERS.map((m) => (
            <span
              key={m}
              className={`spin-tier ${isLanded && m === multiplier ? 'spin-tier-active' : ''}`}
              style={{
                color: isLanded && m === multiplier ? getColor(m) : '#6A6A8A',
                borderColor: isLanded && m === multiplier ? getColor(m) : '#3A3A5A',
              }}
            >
              {m}x
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
