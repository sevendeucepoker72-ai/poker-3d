import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import './LeakFinder.css';

// Each check names the server stats it needs (`fields`); a check whose stat
// the server has not tracked yet is skipped, never read as zero.
const LEAK_CHECKS = [
  {
    id: 'too_loose',
    name: 'Too Loose Preflop',
    fields: ['vpip'],
    check: (stats) => stats.vpip > 35,
    severity: (stats) => stats.vpip > 45 ? 'danger' : 'warning',
    stat: (stats) => `VPIP: ${stats.vpip.toFixed(1)}% (threshold: 35%)`,
    description: 'You are playing too many hands preflop. This leads to difficult postflop situations with weak holdings.',
    tip: 'Tighten your preflop range. Focus on playing premium hands from early position and widen slightly from late position.',
  },
  {
    id: 'not_aggressive',
    name: 'Not Aggressive Enough',
    fields: ['pfr'],
    check: (stats) => stats.pfr < 12,
    severity: (stats) => stats.pfr < 8 ? 'danger' : 'warning',
    stat: (stats) => `PFR: ${stats.pfr.toFixed(1)}% (threshold: 12%)`,
    description: 'Your preflop raise percentage is too low. Passive play lets opponents see cheap flops and outdraw you.',
    tip: 'Raise more often preflop instead of limping. If a hand is worth playing, it is usually worth raising.',
  },
  {
    id: 'calling_station',
    name: 'Calling Station',
    fields: ['af'],
    check: (stats) => stats.af < 1.5 && stats.af > 0,
    severity: (stats) => stats.af < 1.0 ? 'danger' : 'warning',
    stat: (stats) => `AF: ${stats.af.toFixed(2)} (threshold: 1.5)`,
    description: 'You call too much relative to betting and raising. Opponents can easily exploit passive play.',
    tip: 'Be more aggressive with your strong hands and semi-bluffs. Raise and bet instead of just calling.',
  },
  {
    id: 'wide_gap',
    name: 'Passive Preflop (VPIP/PFR Gap)',
    fields: ['vpip', 'pfr'],
    check: (stats) => stats.vpip > 0 && stats.pfr > 0 && (stats.vpip - stats.pfr) > 18,
    severity: (stats) => (stats.vpip - stats.pfr) > 28 ? 'danger' : 'warning',
    stat: (stats) => `VPIP-PFR gap: ${(stats.vpip - stats.pfr).toFixed(1)}% (threshold: 18%)`,
    description: 'A big gap between how often you enter pots and how often you raise means you are limping and cold-calling too much.',
    tip: 'Enter more pots with a raise. If a hand is worth playing, it is usually worth raising rather than limping.',
  },
];

function getGrade(leakCount) {
  if (leakCount === 0) return { grade: 'A', color: '#4ADE80', label: 'Excellent' };
  if (leakCount === 1) return { grade: 'B', color: '#22C55E', label: 'Good' };
  if (leakCount === 2) return { grade: 'C', color: '#FBBF24', label: 'Average' };
  if (leakCount === 3) return { grade: 'D', color: '#F59E0B', label: 'Needs Work' };
  return { grade: 'F', color: '#60A5FA', label: 'Work on these' };
}

// 2026-10-11 (.online R2 — C10 / APPUI-10). Leaks are read ONLY from the
// server's tracked stats (getDetailedStats — answered for an unseated socket
// since R2). It used to fall back to this browser's own counts and zeros, so
// an unanswered request showed "PFR 0.0%" as a real leak. No answer → it
// says so; too few tracked hands → it says how many it has.
const STATS_TIMEOUT_MS = 10000;

export default function LeakFinder({ onClose }) {
  const [detailedStats, setDetailedStats] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | unavailable

  useEffect(() => {
    const socket = getSocket();
    if (!socket) { setStatus('unavailable'); return undefined; }
    const handler = (stats) => {
      if (!stats || typeof stats !== 'object') return;
      setDetailedStats(stats);
      setStatus('ready');
    };
    socket.on('detailedStats', handler);
    socket.emit('getDetailedStats');
    const t = setTimeout(() => setStatus((s) => (s === 'loading' ? 'unavailable' : s)), STATS_TIMEOUT_MS);
    return () => { clearTimeout(t); socket.off('detailedStats', handler); };
  }, []);

  const raw = detailedStats || {};
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const stats = { vpip: num(raw.vpip), pfr: num(raw.pfr), af: num(raw.af) };
  // AF 99 is the server's "no calls yet" sentinel — not a measurement.
  if (stats.af != null && stats.af >= 99) stats.af = null;

  // Require a minimum sample before grading — leaks read off a handful of
  // hands are noise.
  const handsPlayed = Number(raw.handsTracked ?? raw.totalHandsPlayed) || 0;
  const enoughData = status === 'ready' && handsPlayed >= 20;

  const activeLeaks = enoughData
    ? LEAK_CHECKS.filter((leak) => leak.fields.every((f) => stats[f] != null) && leak.check(stats))
    : [];
  const gradeInfo = getGrade(activeLeaks.length);

  return createPortal(
    <div className="leak-finder-overlay" onClick={onClose}>
      <div className="leak-finder-panel" onClick={(e) => e.stopPropagation()}>
        <div className="leak-finder-header">
          <div className="leak-finder-title">Leak Finder</div>
          <button className="leak-finder-close" onClick={onClose}>Close</button>
        </div>

        {status === 'loading' ? (
          <div className="leak-finder-clean">
            <span className="leak-finder-clean-icon">&#8987;</span>
            Loading your tracked stats from the server…
          </div>
        ) : status === 'unavailable' ? (
          <div className="leak-finder-clean">
            <span className="leak-finder-clean-icon">&#8987;</span>
            Your tracked stats are not available right now — try again in a moment.
          </div>
        ) : !enoughData ? (
          <div className="leak-finder-clean">
            <span className="leak-finder-clean-icon">&#8987;</span>
            Play at least 20 hands to unlock your leak analysis. Tracked so far: {handsPlayed} hand{handsPlayed !== 1 ? 's' : ''}.
          </div>
        ) : (<>
        <div className="leak-finder-grade">
          <div
            className="leak-finder-grade-circle"
            style={{ background: `${gradeInfo.color}22`, color: gradeInfo.color, border: `2px solid ${gradeInfo.color}` }}
          >
            {gradeInfo.grade}
          </div>
          <div className="leak-finder-grade-label">
            Overall: {gradeInfo.label} ({activeLeaks.length} leak{activeLeaks.length !== 1 ? 's' : ''} found)
          </div>
        </div>

        {activeLeaks.length === 0 ? (
          <div className="leak-finder-clean">
            <span className="leak-finder-clean-icon">&#10004;</span>
            No major leaks detected. Keep up the solid play!
          </div>
        ) : (
          activeLeaks.map((leak) => {
            const sev = leak.severity(stats);
            return (
              <div key={leak.id} className={`leak-card severity-${sev}`}>
                <div className="leak-card-header">
                  <span className={`leak-card-severity ${sev}`}>{sev}</span>
                  <span className="leak-card-name">{leak.name}</span>
                </div>
                <div className="leak-card-stat">{leak.stat(stats)}</div>
                <div className="leak-card-description">{leak.description}</div>
                <div className="leak-card-tip">{leak.tip}</div>
              </div>
            );
          })
        )}
        </>)}
      </div>
    </div>,
    document.body
  );
}
