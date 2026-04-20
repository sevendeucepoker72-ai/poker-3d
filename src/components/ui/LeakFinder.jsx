import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProgressStore } from '../../store/progressStore';
import { getSocket } from '../../services/socketService';
import './LeakFinder.css';

const LEAK_CHECKS = [
  {
    id: 'too_loose',
    name: 'Too Loose Preflop',
    check: (stats) => (stats.vpip || 0) > 35,
    severity: (stats) => (stats.vpip || 0) > 45 ? 'danger' : 'warning',
    stat: (stats) => `VPIP: ${(stats.vpip || 0).toFixed(1)}% (threshold: 35%)`,
    description: 'You are playing too many hands preflop. This leads to difficult postflop situations with weak holdings.',
    tip: 'Tighten your preflop range. Focus on playing premium hands from early position and widen slightly from late position.',
  },
  {
    id: 'not_aggressive',
    name: 'Not Aggressive Enough',
    check: (stats) => (stats.pfr || 0) < 12,
    severity: (stats) => (stats.pfr || 0) < 8 ? 'danger' : 'warning',
    stat: (stats) => `PFR: ${(stats.pfr || 0).toFixed(1)}% (threshold: 12%)`,
    description: 'Your preflop raise percentage is too low. Passive play lets opponents see cheap flops and outdraw you.',
    tip: 'Raise more often preflop instead of limping. If a hand is worth playing, it is usually worth raising.',
  },
  {
    id: 'calling_station',
    name: 'Calling Station',
    check: (stats) => (stats.af || 0) < 1.5 && (stats.af || 0) > 0,
    severity: (stats) => (stats.af || 0) < 1.0 ? 'danger' : 'warning',
    stat: (stats) => `AF: ${(stats.af || 0).toFixed(2)} (threshold: 1.5)`,
    description: 'You call too much relative to betting and raising. Opponents can easily exploit passive play.',
    tip: 'Be more aggressive with your strong hands and semi-bluffs. Raise and bet instead of just calling.',
  },
  {
    id: 'over_bluffing',
    name: 'Over-Bluffing',
    check: (stats) => (stats.bluffFrequency || 0) > 40,
    severity: (stats) => (stats.bluffFrequency || 0) > 55 ? 'danger' : 'warning',
    stat: (stats) => `Bluff Freq: ${(stats.bluffFrequency || 0).toFixed(1)}% (threshold: 40%)`,
    description: 'You are bluffing too frequently. Observant opponents will start calling you down with marginal hands.',
    tip: 'Be more selective with your bluffs. Choose spots with good blockers and credible board runouts.',
  },
  {
    id: 'not_defending_blinds',
    name: 'Not Defending Blinds',
    check: (stats) => (stats.foldToSteal || 0) > 75,
    severity: (stats) => (stats.foldToSteal || 0) > 85 ? 'danger' : 'warning',
    stat: (stats) => `Fold to Steal: ${(stats.foldToSteal || 0).toFixed(1)}% (threshold: 75%)`,
    description: 'You fold too often in the blinds against steals. Opponents can profitably attack your blinds every hand.',
    tip: 'Defend your blinds more often, especially the big blind. You already have money invested and get a good price.',
  },
];

function getGrade(leakCount) {
  if (leakCount === 0) return { grade: 'A', color: '#4ADE80', label: 'Excellent' };
  if (leakCount === 1) return { grade: 'B', color: '#22C55E', label: 'Good' };
  if (leakCount === 2) return { grade: 'C', color: '#FBBF24', label: 'Average' };
  if (leakCount === 3) return { grade: 'D', color: '#F97316', label: 'Needs Work' };
  return { grade: 'F', color: '#EF4444', label: 'Critical' };
}

export default function LeakFinder({ onClose }) {
  const progress = useProgressStore((s) => s.progress);
  const [detailedStats, setDetailedStats] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    if (socket) {
      socket.emit('getDetailedStats');
      const handler = (stats) => setDetailedStats(stats);
      socket.on('detailedStats', handler);
      return () => socket.off('detailedStats', handler);
    }
  }, []);

  // Merge server stats with sessionStorage stats
  const stats = {};
  const raw = detailedStats || progress || {};

  // Try to pull real stats, fall back to ADVANCED_STATS defaults
  stats.vpip = raw.vpip ?? raw.stats?.vpip ?? 28;
  stats.pfr = raw.pfr ?? raw.stats?.pfr ?? 18;
  stats.af = raw.af ?? raw.stats?.af ?? 2.4;
  stats.bluffFrequency = raw.bluffFrequency ?? raw.stats?.bluffFrequency ?? 25;
  stats.foldToSteal = raw.foldToSteal ?? raw.stats?.foldToSteal ?? 60;

  // Also check sessionStorage for any additional stored stats
  try {
    const stored = JSON.parse(sessionStorage.getItem('poker_player_stats') || '{}');
    if (stored.vpip !== undefined) stats.vpip = stored.vpip;
    if (stored.pfr !== undefined) stats.pfr = stored.pfr;
    if (stored.af !== undefined) stats.af = stored.af;
    if (stored.bluffFrequency !== undefined) stats.bluffFrequency = stored.bluffFrequency;
    if (stored.foldToSteal !== undefined) stats.foldToSteal = stored.foldToSteal;
  } catch { /* ignore */ }

  const activeLeaks = LEAK_CHECKS.filter((leak) => leak.check(stats));
  const gradeInfo = getGrade(activeLeaks.length);

  return createPortal(
    <div className="leak-finder-overlay" onClick={onClose}>
      <div className="leak-finder-panel" onClick={(e) => e.stopPropagation()}>
        <div className="leak-finder-header">
          <div className="leak-finder-title">Leak Finder</div>
          <button className="leak-finder-close" onClick={onClose}>Close</button>
        </div>

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
      </div>
    </div>,
    document.body
  );
}
