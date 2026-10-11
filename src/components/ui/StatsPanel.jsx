import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProgressStore } from '../../store/progressStore';
import { getSocket } from '../../services/socketService';
import { lifetimeAchievementRows, sortAchievementRows } from '../../utils/achievementCatalog';
import './StatsPanel.css';

const HAND_RANKS = [
  'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind',
  'Straight Flush', 'Royal Flush',
];

const BAR_COLORS = [
  '#64748b', '#3b82f6', '#8b5cf6', '#ec4899',
  '#f97316', '#22c55e', '#3b82f6', '#eab308',
  '#A855F7', '#FFD700',
];

const PIE_COLORS = {
  fold: '#64748B',
  check: '#22C55E',
  call: '#3B82F6',
  raise: '#F97316',
  allin: '#FFD700',
};

function SessionGraph({ chipHistory }) {
  if (!chipHistory || chipHistory.length < 2) {
    return (
      <div className="stats-chart-container">
        <div style={{ textAlign: 'center', color: '#555', padding: '20px' }}>
          Play more hands to see your session graph
        </div>
      </div>
    );
  }

  const min = Math.min(...chipHistory);
  const max = Math.max(...chipHistory);
  const range = max - min || 1;
  const w = 100;
  const h = 100;
  const padding = 5;

  const points = chipHistory.map((v, i) => {
    const x = padding + (i / (chipHistory.length - 1)) * (w - 2 * padding);
    const y = h - padding - ((v - min) / range) * (h - 2 * padding);
    return `${x},${y}`;
  });

  const polyline = points.join(' ');
  // Area fill
  const firstX = padding;
  const lastX = padding + ((chipHistory.length - 1) / (chipHistory.length - 1)) * (w - 2 * padding);
  const areaPoints = `${firstX},${h - padding} ${polyline} ${lastX},${h - padding}`;

  return (
    <div className="stats-chart-container">
      <svg className="stats-chart-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="chipGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ADE80" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#4ADE80" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padding} x2={w - padding}
            y1={h - padding - f * (h - 2 * padding)}
            y2={h - padding - f * (h - 2 * padding)}
            stroke="rgba(255,255,255,0.05)" strokeWidth="0.3"
          />
        ))}
        {/* Area */}
        <polygon points={areaPoints} fill="url(#chipGrad)" />
        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="#4ADE80"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Last point dot */}
        {chipHistory.length > 0 && (() => {
          const lastPt = points[points.length - 1].split(',');
          return (
            <circle cx={lastPt[0]} cy={lastPt[1]} r="2" fill="#4ADE80" />
          );
        })()}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#555', marginTop: '4px' }}>
        <span>{min.toLocaleString()}</span>
        <span>{max.toLocaleString()}</span>
      </div>
    </div>
  );
}

function PieChart({ actionCounts }) {
  const total = Object.values(actionCounts || {}).reduce((s, v) => s + v, 0);
  if (total === 0) {
    return (
      <div className="stats-pie-container">
        <div style={{ color: '#555' }}>No action data yet</div>
      </div>
    );
  }

  const slices = [];
  let cumAngle = 0;

  const entries = Object.entries(actionCounts).filter(([, v]) => v > 0);
  for (const [action, count] of entries) {
    const pct = count / total;
    const startAngle = cumAngle;
    const endAngle = cumAngle + pct * 360;
    cumAngle = endAngle;

    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((endAngle - 90) * Math.PI) / 180;
    const largeArc = pct > 0.5 ? 1 : 0;

    const x1 = 50 + 40 * Math.cos(startRad);
    const y1 = 50 + 40 * Math.sin(startRad);
    const x2 = 50 + 40 * Math.cos(endRad);
    const y2 = 50 + 40 * Math.sin(endRad);

    if (entries.length === 1) {
      slices.push(
        <circle key={action} cx="50" cy="50" r="40" fill={PIE_COLORS[action] || '#666'} />
      );
    } else {
      slices.push(
        <path
          key={action}
          d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`}
          fill={PIE_COLORS[action] || '#666'}
        />
      );
    }
  }

  return (
    <div className="stats-pie-container">
      <svg className="stats-pie-svg" viewBox="0 0 100 100">
        {slices}
        <circle cx="50" cy="50" r="20" fill="#0c1a44" />
      </svg>
      <div className="stats-pie-legend">
        {entries.map(([action, count]) => (
          <div key={action} className="stats-pie-legend-item">
            <div className="stats-pie-dot" style={{ background: PIE_COLORS[action] || '#666' }} />
            <span style={{ textTransform: 'capitalize' }}>{action}</span>
            <span style={{ color: '#888', marginLeft: 'auto' }}>
              {((count / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getAdvancedStats(stats) {
  const num = (v) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? +Number(v).toFixed(1) : '-');
  // AF is (bets+raises)/calls; the server sends 99 when there are no calls yet.
  const afRaw = stats.af != null ? Number(stats.af) : NaN;
  const af = Number.isFinite(afRaw) && afRaw < 99 ? +afRaw.toFixed(1) : '-';
  return [
    { key: 'vpip', name: 'VPIP', description: 'Voluntarily put chips in the pot', value: num(stats.vpip), unit: '%', goodMin: 22, goodMax: 30 },
    { key: 'pfr', name: 'PFR', description: 'Pre-flop raise %', value: num(stats.pfr), unit: '%', goodMin: 15, goodMax: 22 },
    { key: 'af', name: 'AF', description: 'Aggression factor', value: af, unit: '', goodMin: 2, goodMax: 3 },
    { key: '3bet', name: '3-Bet %', description: 'Pre-flop re-raise %', value: num(stats.threeBet), unit: '%', goodMin: 6, goodMax: 10 },
    { key: 'wtsd', name: 'WTSD', description: 'Went to showdown %', value: num(stats.wtsd), unit: '%', goodMin: 28, goodMax: 35 },
    { key: 'wsd', name: 'W@SD', description: 'Won at showdown %', value: num(stats.wsd), unit: '%', goodMin: 50, goodMax: 55 },
  ];
}

function getStatIndicator(value, goodMin, goodMax) {
  if (value === '-' || value == null || isNaN(value)) return { color: '#8fa8d8', label: 'Not enough data' };
  if (value >= goodMin && value <= goodMax) return { color: '#4ADE80', label: 'Good' };
  const marginMin = goodMin - (goodMax - goodMin) * 0.5;
  const marginMax = goodMax + (goodMax - goodMin) * 0.5;
  if (value >= marginMin && value <= marginMax) return { color: '#FBBF24', label: 'Marginal' };
  return { color: '#60A5FA', label: 'Off target' };
}

const STATS_TIMEOUT_MS = 10000;

// 2026-10-11 (.online R2 — C10 / APPUI-10 / APPUI-49). Every number here is
// the SERVER's: getDetailedStats (answered for an unseated socket since R2,
// DB-backed) for the HUD stats / distribution / actions / positions, and the
// server's lifetime achievements (getAchievements; snapshot ids otherwise).
// Nothing falls back to this browser's own counts — a stat the server has
// not tracked shows "-", and before the server answers the panel says so.
export default function StatsPanel({ onClose }) {
  const progress = useProgressStore((s) => s.progress);
  const [detailedStats, setDetailedStats] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | unavailable
  const [liveAchievements, setLiveAchievements] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) { setStatus('unavailable'); return undefined; }
    const handler = (stats) => {
      if (!stats || typeof stats !== 'object') return;
      setDetailedStats(stats);
      setStatus('ready');
    };
    const onList = (payload) => { if (payload && Array.isArray(payload.lifetime)) setLiveAchievements(payload.lifetime); };
    socket.on('detailedStats', handler);
    socket.on('achievementsList', onList);
    socket.emit('getDetailedStats');
    socket.emit('getAchievements');
    const t = setTimeout(() => setStatus((s) => (s === 'loading' ? 'unavailable' : s)), STATS_TIMEOUT_MS);
    return () => { clearTimeout(t); socket.off('detailedStats', handler); socket.off('achievementsList', onList); };
  }, []);

  // Server values only: the detailed answer, else the server's own
  // playerProgress counters for the overview (never the local VPIP / PFR).
  const stats = detailedStats || {};
  const overview = detailedStats || progress || {};
  const totalHands = Number(overview.totalHandsPlayed) || 0;
  const handsWon = Number(overview.handsWon) || 0;
  const tracked = Number(stats.handsTracked ?? stats.totalHandsPlayed) || 0;
  const achievements = sortAchievementRows(lifetimeAchievementRows(liveAchievements, overview.achievements || progress?.achievements));
  const handsPerRank = stats.handsPerRank || {};
  const actionCounts = stats.actionCounts || {};
  const chipHistory = Array.isArray(stats.chipHistory) ? stats.chipHistory.filter((v) => Number.isFinite(Number(v))).map(Number) : [];
  const positionWins = stats.positionStats || stats.positionWins || {};

  const maxRankCount = Math.max(1, ...Object.values(handsPerRank).map((v) => Number(v) || 0));

  return createPortal(
    <div className="stats-overlay" onClick={onClose}>
      <div className="stats-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="My stats">
        <div className="stats-header">
          <div className="stats-title">My Stats</div>
          <button className="stats-close" onClick={onClose}>Close</button>
        </div>

        {status !== 'ready' && (
          <div className="stats-source-note">
            {status === 'loading' ? 'Loading your stats from the server…' : 'Your detailed stats are not available right now — try again in a moment.'}
          </div>
        )}

        {/* Overview */}
        <div className="stats-overview">
          <div className="stats-overview-card">
            <div className="stats-overview-value">{overview.level || 1}</div>
            <div className="stats-overview-label">Level</div>
          </div>
          <div className="stats-overview-card">
            <div className="stats-overview-value">{totalHands.toLocaleString()}</div>
            <div className="stats-overview-label">Hands Played</div>
          </div>
          <div className="stats-overview-card">
            <div className="stats-overview-value">
              {totalHands > 0 ? `${(Math.min(handsWon, totalHands) / totalHands * 100).toFixed(1)}%` : '0%'}
            </div>
            <div className="stats-overview-label">Win Rate</div>
          </div>
          <div className="stats-overview-card">
            <div className="stats-overview-value">{(Number(overview.biggestPot) || 0).toLocaleString()}</div>
            <div className="stats-overview-label">Biggest Pot</div>
          </div>
          <div className="stats-overview-card">
            <div className="stats-overview-value">{Number(overview.bestStreak) || 0}</div>
            <div className="stats-overview-label">Best Streak</div>
          </div>
          <div className="stats-overview-card">
            <div className="stats-overview-value">{(Number(overview.chips) || 0).toLocaleString()}</div>
            <div className="stats-overview-label">Chips</div>
          </div>
        </div>

        {/* Advanced Stats */}
        <div className="stats-section-title">Advanced Stats{status === 'ready' && tracked > 0 ? ` (${tracked.toLocaleString()} hands tracked)` : ''}</div>
        <div className="stats-advanced-grid">
          {getAdvancedStats(stats).map((stat) => {
            const indicator = getStatIndicator(stat.value, stat.goodMin, stat.goodMax);
            return (
              <div key={stat.key} className="stats-advanced-card">
                <div className="stats-advanced-header">
                  <span className="stats-advanced-name">{stat.name}</span>
                  <span
                    className="stats-advanced-indicator"
                    style={{ background: indicator.color }}
                    title={indicator.label}
                  />
                </div>
                <div className="stats-advanced-value">
                  {stat.value}{stat.value === '-' ? '' : stat.unit}
                </div>
                <div className="stats-advanced-desc">{stat.description}</div>
                <div className="stats-advanced-range">
                  Good: {stat.goodMin}{stat.unit} - {stat.goodMax}{stat.unit}
                </div>
              </div>
            );
          })}
        </div>

        {/* Session Graph */}
        <div className="stats-section-title">Chip Count (Last 20 Hands)</div>
        <SessionGraph chipHistory={chipHistory} />

        {/* Hand Distribution */}
        <div className="stats-section-title">Hand Distribution</div>
        <div className="stats-bars">
          {HAND_RANKS.map((rank, i) => {
            const count = Number(handsPerRank[rank]) || 0;
            const pct = (count / maxRankCount) * 100;
            return (
              <div key={rank} className="stats-bar-row">
                <span className="stats-bar-label">{rank}</span>
                <div className="stats-bar-track">
                  <div
                    className="stats-bar-fill"
                    style={{ width: `${pct}%`, background: BAR_COLORS[i] }}
                  />
                </div>
                <span className="stats-bar-value">{count}</span>
              </div>
            );
          })}
        </div>

        {/* Action Breakdown */}
        <div className="stats-section-title">Action Breakdown</div>
        <PieChart actionCounts={actionCounts} />

        {/* Position Stats */}
        <div className="stats-section-title">Win Rate by Position</div>
        <div className="stats-position-grid">
          {['early', 'middle', 'late', 'blind'].map((pos) => {
            const data = positionWins[pos] || { wins: 0, total: 0 };
            const total = Number(data.total ?? data.played) || 0;
            const wins = Number(data.wins ?? data.won) || 0;
            const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
            return (
              <div key={pos} className="stats-position-card">
                <div className="stats-position-label">{pos}</div>
                <div className="stats-position-value">{winRate}%</div>
                <div className="stats-position-count">{wins}/{total} hands</div>
              </div>
            );
          })}
        </div>

        {/* Achievements — the server's ids and names */}
        <div className="stats-section-title">Achievements ({achievements.filter((a) => a.unlocked).length}/{achievements.length})</div>
        <div className="stats-achievements-grid">
          {achievements.map((ach) => (
            <div key={ach.id} className={`stats-achievement-card ${ach.unlocked ? 'unlocked' : ''}`}>
              <div className="stats-achievement-name">
                {ach.unlocked ? '★ ' : '☆ '}{ach.name}
              </div>
              <div className="stats-achievement-desc">{ach.description}</div>
              {ach.unlocked ? (
                <div className="stats-achievement-status">Unlocked</div>
              ) : (
                <div className="stats-achievement-status stats-achievement-status--locked">Locked</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>, document.body);
}
