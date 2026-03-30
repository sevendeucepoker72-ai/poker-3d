import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProgressStore } from '../../store/progressStore';
import { getSocket } from '../../services/socketService';
import './StatsPanel.css';

const ALL_ACHIEVEMENTS = [
  { id: 'first_win', name: 'First Blood', description: 'Win your first hand' },
  { id: 'high_roller', name: 'High Roller', description: 'Win a pot over 50,000' },
  { id: 'streak_5', name: 'Hot Streak', description: 'Win 5 hands in a row' },
  { id: 'streak_10', name: 'Unstoppable', description: 'Win 10 hands in a row' },
  { id: 'hands_100', name: 'Card Shark', description: 'Play 100 hands' },
  { id: 'hands_1000', name: 'Veteran', description: 'Play 1000 hands' },
  { id: 'royal_flush', name: 'Royal Flush!', description: 'Get a Royal Flush' },
  { id: 'bluff_master', name: 'Bluff Master', description: 'Win 10 hands with less than a pair' },
  { id: 'all_in_warrior', name: 'All-In Warrior', description: 'Go all-in and win 20 times' },
  { id: 'social_butterfly', name: 'Social Butterfly', description: 'Send 50 chat messages' },
];

const HAND_RANKS = [
  'High Card', 'One Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind',
  'Straight Flush', 'Royal Flush',
];

const BAR_COLORS = [
  '#64748b', '#3b82f6', '#8b5cf6', '#ec4899',
  '#f97316', '#22c55e', '#06b6d4', '#eab308',
  '#ef4444', '#FFD700',
];

const PIE_COLORS = {
  fold: '#EF4444',
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
        <circle cx="50" cy="50" r="20" fill="#1a1a2e" />
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
  const vpip = stats.vpip || 0;
  const pfr = stats.pfr || 0;
  const af = pfr > 0 ? +(vpip / pfr).toFixed(1) : '-';
  return [
    { key: 'vpip', name: 'VPIP', description: 'Voluntarily Put In Pot', value: vpip, unit: '%', goodMin: 22, goodMax: 30 },
    { key: 'pfr', name: 'PFR', description: 'Pre-Flop Raise %', value: pfr, unit: '%', goodMin: 15, goodMax: 22 },
    { key: 'af', name: 'AF', description: 'Aggression Factor', value: af, unit: '', goodMin: 2, goodMax: 3 },
    { key: '3bet', name: '3-Bet %', description: 'Pre-Flop Re-Raise %', value: '-', unit: '%', goodMin: 6, goodMax: 10 },
    { key: 'wtsd', name: 'WTSD', description: 'Went to Showdown %', value: '-', unit: '%', goodMin: 28, goodMax: 35 },
    { key: 'wsd', name: 'W$SD', description: 'Won $ at Showdown %', value: '-', unit: '%', goodMin: 50, goodMax: 55 },
  ];
}

function getStatIndicator(value, goodMin, goodMax) {
  if (value === '-' || value == null || isNaN(value)) return { color: '#888', label: 'N/A' };
  if (value >= goodMin && value <= goodMax) return { color: '#4ADE80', label: 'Good' };
  const marginMin = goodMin - (goodMax - goodMin) * 0.5;
  const marginMax = goodMax + (goodMax - goodMin) * 0.5;
  if (value >= marginMin && value <= marginMax) return { color: '#FBBF24', label: 'Marginal' };
  return { color: '#EF4444', label: 'Poor' };
}

export default function StatsPanel({ onClose }) {
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

  const stats = detailedStats || progress || {};
  const achievements = stats.achievements || [];
  const handsPerRank = stats.handsPerRank || {};
  const actionCounts = stats.actionCounts || {};
  const chipHistory = stats.chipHistory || [];
  const positionWins = stats.positionWins || {};

  const maxRankCount = Math.max(1, ...Object.values(handsPerRank));

  return createPortal(
    <div className="stats-overlay" onClick={onClose}>
      <div className="stats-panel" onClick={(e) => e.stopPropagation()}>
        <div className="stats-header">
          <div className="stats-title">My Stats</div>
          <button className="stats-close" onClick={onClose}>Close</button>
        </div>

        {/* Overview */}
        <div className="stats-overview">
          <div className="stats-overview-card">
            <div className="stats-overview-value">{stats.level || 1}</div>
            <div className="stats-overview-label">Level</div>
          </div>
          <div className="stats-overview-card">
            <div className="stats-overview-value">{(stats.totalHandsPlayed || 0).toLocaleString()}</div>
            <div className="stats-overview-label">Hands Played</div>
          </div>
          <div className="stats-overview-card">
            <div className="stats-overview-value">
              {stats.totalHandsPlayed > 0
                ? ((stats.handsWon / stats.totalHandsPlayed) * 100).toFixed(1) + '%'
                : '0%'}
            </div>
            <div className="stats-overview-label">Win Rate</div>
          </div>
          <div className="stats-overview-card">
            <div className="stats-overview-value">{(stats.biggestPot || 0).toLocaleString()}</div>
            <div className="stats-overview-label">Biggest Pot</div>
          </div>
          <div className="stats-overview-card">
            <div className="stats-overview-value">{stats.bestStreak || 0}</div>
            <div className="stats-overview-label">Best Streak</div>
          </div>
          <div className="stats-overview-card">
            <div className="stats-overview-value">{(stats.chips || 0).toLocaleString()}</div>
            <div className="stats-overview-label">Chips</div>
          </div>
        </div>

        {/* Advanced Stats */}
        <div className="stats-section-title">Advanced Stats</div>
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
                  {stat.value}{stat.unit}
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
        <div className="stats-section-title">Session Graph (Last 20 Hands)</div>
        <SessionGraph chipHistory={chipHistory} />

        {/* Hand Distribution */}
        <div className="stats-section-title">Hand Distribution</div>
        <div className="stats-bars">
          {HAND_RANKS.map((rank, i) => {
            const count = handsPerRank[rank] || 0;
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
            const winRate = data.total > 0 ? ((data.wins / data.total) * 100).toFixed(1) : '0.0';
            return (
              <div key={pos} className="stats-position-card">
                <div className="stats-position-label">{pos}</div>
                <div className="stats-position-value">{winRate}%</div>
                <div className="stats-position-count">{data.wins}/{data.total} hands</div>
              </div>
            );
          })}
        </div>

        {/* Achievements */}
        <div className="stats-section-title">Achievements</div>
        <div className="stats-achievements-grid">
          {ALL_ACHIEVEMENTS.map((ach) => {
            const unlocked = achievements.includes(ach.id);
            return (
              <div key={ach.id} className={`stats-achievement-card ${unlocked ? 'unlocked' : ''}`}>
                <div className="stats-achievement-name">
                  {unlocked ? '\u2605 ' : '\u2606 '}{ach.name}
                </div>
                <div className="stats-achievement-desc">{ach.description}</div>
                {unlocked ? (
                  <div className="stats-achievement-status">Unlocked</div>
                ) : (
                  <div className="stats-achievement-progress-bar">
                    <div className="stats-achievement-progress-fill" style={{ width: '0%' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>, document.body);
}
