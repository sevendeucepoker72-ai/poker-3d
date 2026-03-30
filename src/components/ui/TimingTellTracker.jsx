import { useState, useEffect, useRef } from 'react';
import { useThrottle } from '../../hooks/useThrottle';
import './TimingTellTracker.css';

/**
 * TimingTellTracker — Tracks opponent action timing and flags statistical tells.
 * Detects when opponents act significantly faster or slower than their baseline.
 */
export default function TimingTellTracker({ gameState: gameStateRaw, visible, onClose }) {
  const gameState = useThrottle(gameStateRaw, 400);
  // timingData: { [playerName]: { times: number[], lastActionAt: number } }
  const [timingData, setTimingData] = useState({});
  const [actionStartTimes, setActionStartTimes] = useState({});
  const prevTurnRef = useRef(null);
  const prevPhaseRef = useRef(null);

  // Track when each player's turn starts
  useEffect(() => {
    if (!gameState) return;
    const currentTurn = gameState.currentTurn;
    const phase = gameState.phase;

    // New turn started
    if (currentTurn !== prevTurnRef.current || phase !== prevPhaseRef.current) {
      // Record end time for previous player
      if (prevTurnRef.current !== null && prevTurnRef.current !== undefined) {
        const prevPlayer = gameState.seats?.[prevTurnRef.current];
        if (prevPlayer?.playerName && actionStartTimes[prevTurnRef.current]) {
          const elapsed = Date.now() - actionStartTimes[prevTurnRef.current];
          if (elapsed > 200 && elapsed < 60000) { // filter noise
            setTimingData(prev => {
              const name = prevPlayer.playerName;
              const existing = prev[name] || { times: [], lastActionAt: 0 };
              return {
                ...prev,
                [name]: {
                  times: [...existing.times.slice(-19), elapsed], // keep last 20
                  lastActionAt: Date.now(),
                  lastElapsed: elapsed,
                },
              };
            });
          }
        }
      }

      // Start timer for new player
      if (currentTurn !== null && currentTurn !== undefined) {
        setActionStartTimes(prev => ({ ...prev, [currentTurn]: Date.now() }));
      }

      prevTurnRef.current = currentTurn;
      prevPhaseRef.current = phase;
    }
  }, [gameState?.currentTurn, gameState?.phase]);

  if (!visible) return null;

  const seats = gameState?.seats || [];

  // Build display rows
  const rows = seats
    .filter(s => s && s.playerName && timingData[s.playerName]?.times?.length >= 2)
    .map(seat => {
      const data = timingData[seat.playerName];
      const times = data.times;
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const last = data.lastElapsed || avg;
      const deviation = avg > 0 ? (last - avg) / avg : 0;

      let tell = null;
      let tellColor = '#94A3B8';
      if (times.length >= 4) {
        if (deviation < -0.55) {
          tell = 'snap';
          tellColor = '#EF4444'; // snap = often strong/nutted
        } else if (deviation < -0.25) {
          tell = 'fast';
          tellColor = '#F97316';
        } else if (deviation > 0.60) {
          tell = 'tanked';
          tellColor = '#00D9FF'; // long tank = often weak/bluff
        } else if (deviation > 0.30) {
          tell = 'slow';
          tellColor = '#93C5FD';
        }
      }

      return {
        name: seat.playerName,
        avg: Math.round(avg / 100) / 10, // seconds, 1dp
        last: Math.round(last / 100) / 10,
        samples: times.length,
        tell,
        tellColor,
        deviation,
      };
    });

  return (
    <div className="timing-tell-panel">
      <div className="timing-tell-header">
        <span className="timing-tell-title">⏱ Timing Tells</span>
        <button className="timing-tell-close" onClick={onClose}>×</button>
      </div>

      {rows.length === 0 ? (
        <div className="timing-tell-empty">
          Collecting timing data…<br />
          <span>Needs 2+ actions per player</span>
        </div>
      ) : (
        <>
          <div className="timing-tell-legend">
            <span style={{ color: '#EF4444' }}>● snap</span> = likely strong &nbsp;
            <span style={{ color: '#00D9FF' }}>● tank</span> = likely weak
          </div>
          <table className="timing-tell-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Avg</th>
                <th>Last</th>
                <th>Tell</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.name}>
                  <td className="timing-name">{row.name}</td>
                  <td className="timing-num">{row.avg}s</td>
                  <td className="timing-num" style={{
                    color: row.tell === 'snap' || row.tell === 'fast' ? '#EF4444'
                      : row.tell === 'tanked' || row.tell === 'slow' ? '#00D9FF'
                      : '#94A3B8'
                  }}>{row.last}s</td>
                  <td>
                    {row.tell ? (
                      <span className="timing-badge" style={{ background: row.tellColor + '22', color: row.tellColor, borderColor: row.tellColor + '55' }}>
                        {row.tell}
                      </span>
                    ) : (
                      <span className="timing-neutral">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="timing-tell-note">
            {rows.length} player{rows.length !== 1 ? 's' : ''} tracked · {rows.reduce((a, r) => a + r.samples, 0)} actions
          </div>
        </>
      )}
    </div>
  );
}
