import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../../store/gameStore';
import { getSocket } from '../../services/socketService';
import './Leaderboard.css';

const TABS = [
  { key: 'alltime', label: 'All-Time' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'daily', label: 'Daily' },
  { key: 'season', label: 'Season' },
];

function getRankDisplay(rank) {
  if (rank === 1) return <span className="rank-trophy">🥇</span>;
  if (rank === 2) return <span className="rank-trophy">🥈</span>;
  if (rank === 3) return <span className="rank-trophy">🥉</span>;
  return <span className="rank-number">{rank}</span>;
}

function getRowClass(entry) {
  const classes = [];
  if (entry.rank === 1) classes.push('leaderboard-row-gold');
  else if (entry.rank === 2) classes.push('leaderboard-row-silver');
  else if (entry.rank === 3) classes.push('leaderboard-row-bronze');
  if (entry.isCurrentPlayer) classes.push('leaderboard-row-current');
  return classes.join(' ');
}

function getWinRateClass(rate) {
  if (rate >= 40) return 'win-rate win-rate-high';
  if (rate >= 25) return 'win-rate win-rate-mid';
  return 'win-rate win-rate-low';
}

const SEASON_REWARDS = [
  { place: '1st', chips: '50,000', badge: 'Gold Badge', color: '#FFD700' },
  { place: '2nd', chips: '25,000', badge: 'Silver Badge', color: '#C0C0C0' },
  { place: '3rd', chips: '10,000', badge: 'Bronze Badge', color: '#CD7F32' },
];

function getSeasonInfo() {
  const now = new Date();
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const seasonNumber = (now.getFullYear() - 2026) * 12 + now.getMonth() + 1;
  const seasonName = `Season ${seasonNumber} - ${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysRemaining = Math.max(0, Math.ceil((endOfMonth - now) / (1000 * 60 * 60 * 24)));
  const totalDays = endOfMonth.getDate();
  const daysPassed = totalDays - daysRemaining;
  const progressPct = Math.round((daysPassed / totalDays) * 100);
  return { seasonName, daysRemaining, progressPct, totalDays, daysPassed };
}

export default function Leaderboard({ onClose }) {
  const playerName = useGameStore((s) => s.playerName);
  const [activeTab, setActiveTab] = useState('alltime');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const seasonInfo = useMemo(() => getSeasonInfo(), []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    setLoading(true);

    const handleData = ({ period, entries: rows }) => {
      if (period !== activeTab) return;
      // Mark the current player
      const marked = rows.map(e => ({
        ...e,
        isCurrentPlayer: e.username === playerName,
      }));
      setEntries(marked);
      setLoading(false);
    };

    socket.on('leaderboardData', handleData);
    socket.emit('getLeaderboard', { period: activeTab });

    return () => socket.off('leaderboardData', handleData);
  }, [activeTab, playerName]);

  const currentPlayer = entries.find(e => e.isCurrentPlayer);

  return createPortal(
    <div className="leaderboard-overlay" onClick={onClose}>
      <div className="leaderboard-panel" onClick={(e) => e.stopPropagation()}>
        <div className="leaderboard-header">
          <div className="leaderboard-title">Leaderboard</div>
          <button className="leaderboard-close" onClick={onClose}>Close</button>
        </div>

        <div className="leaderboard-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`leaderboard-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'season' && (
          <div className="season-info-section">
            <div className="season-header-row">
              <span className="season-name">{seasonInfo.seasonName}</span>
              <span className="season-days-left">{seasonInfo.daysRemaining} days remaining</span>
            </div>
            <div className="season-progress-bar-track">
              <div className="season-progress-bar-fill" style={{ width: `${seasonInfo.progressPct}%` }} />
            </div>
            <div className="season-progress-label">Day {seasonInfo.daysPassed} of {seasonInfo.totalDays}</div>
            <div className="season-rewards-box">
              <div className="season-rewards-title">Season Rewards</div>
              <div className="season-rewards-list">
                {SEASON_REWARDS.map((r) => (
                  <div key={r.place} className="season-reward-item" style={{ borderLeftColor: r.color }}>
                    <span className="season-reward-place" style={{ color: r.color }}>{r.place}</span>
                    <span className="season-reward-detail">{r.chips} chips + {r.badge}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>Loading…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>No data yet — play some hands!</div>
        ) : (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th style={{ textAlign: 'right' }}>Chips</th>
                <th style={{ textAlign: 'right' }}>Hands</th>
                <th style={{ textAlign: 'right' }}>Win %</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.rank + entry.username} className={getRowClass(entry)}>
                  <td className="rank-cell">{getRankDisplay(entry.rank)}</td>
                  <td className={entry.isCurrentPlayer ? 'player-name-current' : 'player-name'}>
                    {entry.username}
                  </td>
                  <td className="chips-won">{(entry.chips || 0).toLocaleString()}</td>
                  <td className="hands-played">{(entry.handsPlayed || 0).toLocaleString()}</td>
                  <td className={getWinRateClass(entry.winRate)}>{entry.winRate || 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {currentPlayer && (
          <div className="leaderboard-summary">
            <span>Your Rank: <span className="your-rank">#{currentPlayer.rank} of {entries.length}</span></span>
            <span>{(currentPlayer.chips || 0).toLocaleString()} chips · {currentPlayer.winRate || 0}% win rate</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
