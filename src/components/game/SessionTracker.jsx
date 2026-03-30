import { useState, useEffect, useRef, useCallback } from 'react';
import { useTableStore } from '../../store/tableStore';
import './SessionTracker.css';

export default function SessionTracker() {
  const gameState = useTableStore((s) => s.gameState);
  const mySeat = useTableStore((s) => s.mySeat);

  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Session data stored in refs to persist across renders
  const startTimeRef = useRef(Date.now());
  const startChipsRef = useRef(null);
  const chipHistoryRef = useRef([]);
  const handsPlayedRef = useRef(0);
  const prevPhaseRef = useRef(null);

  // Get current chip count
  const seats = gameState?.seats || [];
  const myPlayer = mySeat >= 0 && seats[mySeat] ? seats[mySeat] : null;
  const myChips = myPlayer?.chipCount ?? 0;
  const phase = gameState?.phase || 'WaitingForPlayers';

  // Initialize starting chips on first valid chip count
  useEffect(() => {
    if (myChips > 0 && startChipsRef.current === null) {
      startChipsRef.current = myChips;
      chipHistoryRef.current = [myChips];
    }
  }, [myChips]);

  // Track chip count changes over time (when gameState changes)
  useEffect(() => {
    if (startChipsRef.current === null || myChips === 0) return;

    const history = chipHistoryRef.current;
    const last = history.length > 0 ? history[history.length - 1] : null;
    if (last !== myChips) {
      chipHistoryRef.current = [...history.slice(-19), myChips];
    }
  }, [myChips, gameState]);

  // Count hands played
  useEffect(() => {
    if (phase === 'PreFlop' && prevPhaseRef.current !== 'PreFlop') {
      handsPlayedRef.current += 1;
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  // Session timer - updates every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Format elapsed time as HH:MM:SS
  const formatTime = useCallback((secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, []);

  // Calculate profit/loss
  const startChips = startChipsRef.current ?? myChips;
  const profit = myChips - startChips;
  const profitDisplay = profit >= 0 ? `+${profit.toLocaleString()}` : profit.toLocaleString();
  const profitClass = profit > 0 ? 'positive' : profit < 0 ? 'negative' : 'neutral';

  // Build sparkline SVG path
  const renderSparkline = () => {
    const data = chipHistoryRef.current;
    if (data.length < 2) return null;

    const width = 190;
    const height = 40;
    const padding = 2;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data.map((val, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((val - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    const lineColor = profit >= 0 ? '#4ADE80' : '#EF4444';
    const fillColor = profit >= 0 ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)';

    // Create fill area (polygon closing to bottom)
    const firstX = padding;
    const lastX = padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2);
    const fillPoints = `${firstX},${height} ${points.join(' ')} ${lastX},${height}`;

    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <polygon points={fillPoints} fill={fillColor} />
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Current value dot */}
        {data.length > 0 && (() => {
          const lastVal = data[data.length - 1];
          const cx = padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2);
          const cy = height - padding - ((lastVal - min) / range) * (height - padding * 2);
          return <circle cx={cx} cy={cy} r="3" fill={lineColor} />;
        })()}
      </svg>
    );
  };

  if (startChipsRef.current === null) return null;

  if (!expanded) {
    return (
      <div className="session-tracker">
        <div className="session-tracker-collapsed" onClick={() => setExpanded(true)}>
          <span className={`session-profit ${profitClass}`}>{profitDisplay}</span>
          <span className={`session-expand-icon`}>&#9650;</span>
        </div>
      </div>
    );
  }

  return (
    <div className="session-tracker">
      <div className="session-tracker-panel">
        <div className="session-header" onClick={() => setExpanded(false)}>
          <span className="session-title">Session Stats</span>
          <button className="session-close">&#9660;</button>
        </div>

        <div className="session-stats">
          <div className="session-stat-row">
            <span className="session-stat-label">Duration</span>
            <span className="session-stat-value">{formatTime(elapsed)}</span>
          </div>

          <div className="session-stat-row">
            <span className="session-stat-label">Profit / Loss</span>
            <span className={`session-profit ${profitClass}`} style={{ fontSize: '0.95rem' }}>
              {profitDisplay}
            </span>
          </div>

          <div className="session-stat-row">
            <span className="session-stat-label">Hands Played</span>
            <span className="session-stat-value">{handsPlayedRef.current}</span>
          </div>

          <div className="session-stat-row">
            <span className="session-stat-label">Current Stack</span>
            <span className="session-stat-value">{myChips.toLocaleString()}</span>
          </div>

          <div className="session-sparkline">
            <div className="session-sparkline-label">Chip History</div>
            {renderSparkline()}
          </div>
        </div>
      </div>
    </div>
  );
}
