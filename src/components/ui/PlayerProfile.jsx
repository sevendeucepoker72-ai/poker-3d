import React, { useState, useEffect } from 'react';
import { useProgressStore } from '../../store/progressStore';
import './PlayerProfile.css';

// Generate a deterministic color from a username string
function nameToColor(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

// Simple SVG bankroll line chart
function SessionChart({ sessions }) {
  if (!sessions || sessions.length === 0) return null;

  const values = sessions.slice(-10).map((s) => s.chips ?? s.balance ?? s);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 560;
  const H = 200;
  const PAD = 20;

  const points = values.map((v, i) => {
    const x = PAD + (i / Math.max(values.length - 1, 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  });

  const polyline = points.join(' ');
  const areaClose = `${points[points.length - 1].split(',')[0]},${H - PAD} ${PAD},${H - PAD}`;
  const areaPoints = polyline + ' ' + areaClose;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="session-chart-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#chartGrad)" />
      <polyline points={polyline} fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinejoin="round" />
      {values.map((v, i) => {
        const [x, y] = points[i].split(',').map(Number);
        return <circle key={i} cx={x} cy={y} r="4" fill="#6366f1" stroke="#1e1b4b" strokeWidth="1.5" />;
      })}
    </svg>
  );
}

// Rank definitions
const RANKS = [
  { name: 'Bronze I',   threshold: 0    },
  { name: 'Bronze II',  threshold: 100  },
  { name: 'Bronze III', threshold: 200  },
  { name: 'Silver I',   threshold: 400  },
  { name: 'Silver II',  threshold: 600  },
  { name: 'Silver III', threshold: 900  },
  { name: 'Gold I',     threshold: 1200 },
  { name: 'Gold II',    threshold: 1500 },
  { name: 'Gold III',   threshold: 1800 },
  { name: 'Platinum I', threshold: 2200 },
  { name: 'Diamond',    threshold: 2800 },
  { name: 'Master',     threshold: 3500 },
];

const RANK_ICONS = {
  Bronze: '🥉', Silver: '🥈', Gold: '🥇', Platinum: '💎', Diamond: '💠', Master: '👑',
};

function getRankFromElo(elo = 0) {
  let current = RANKS[0];
  let next = RANKS[1];
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (elo >= RANKS[i].threshold) {
      current = RANKS[i];
      next = RANKS[i + 1] || null;
      break;
    }
  }
  const tierName = current.name.split(' ')[0];
  const icon = RANK_ICONS[tierName] || '🎖';
  const progress = next
    ? Math.round(((elo - current.threshold) / (next.threshold - current.threshold)) * 100)
    : 100;
  return { current, next, icon, progress };
}

// Achievement definitions (subset shown in profile wall)
const ACHIEVEMENT_DEFS = [
  { id: 'first_win',      name: 'First Blood',     icon: '🎯', requirement: 'Win your first hand' },
  { id: 'royal_flush',    name: 'Royal Flush',      icon: '👑', requirement: 'Achieve a Royal Flush' },
  { id: 'hands_1000',     name: 'Veteran',          icon: '🎖', requirement: 'Play 1000 hands' },
  { id: 'streak_10',      name: 'Unstoppable',      icon: '⚡', requirement: '10-hand win streak' },
  { id: 'high_roller',    name: 'High Roller',      icon: '💰', requirement: 'Win a pot over 50K' },
  { id: 'tournament_win', name: 'Champion',         icon: '🏆', requirement: 'Win a tournament' },
  { id: 'bluff_caught',   name: 'Caught Bluffing',  icon: '😅', requirement: 'Have your bluff called' },
  { id: 'hands_100',      name: 'Card Shark',       icon: '🃏', requirement: 'Play 100 hands' },
  { id: 'comeback',       name: 'Comeback Kid',     icon: '🔄', requirement: 'Win after being short stack' },
  { id: 'night_owl',      name: 'Night Owl',        icon: '🦉', requirement: 'Play after midnight' },
  { id: 'daily_7',        name: 'Dedicated',        icon: '📅', requirement: '7-day login streak' },
  { id: 'big_bluff',      name: 'The Bluffer',      icon: '🃏', requirement: 'Win a pot with a bluff' },
];

// Sample session data fallback
function generateSampleSessions() {
  const base = 10000;
  return Array.from({ length: 10 }, (_, i) => ({
    chips: base + Math.floor((Math.sin(i * 0.8) + Math.random() - 0.5) * 3000),
  }));
}

export default function PlayerProfile({ username, socket, onClose, onViewReplay }) {
  const ownProgress = useProgressStore((s) => s.progress);
  const ownUsername = useProgressStore((s) => s.username);

  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAllAchievements, setShowAllAchievements] = useState(false);
  const [copied, setCopied] = useState(false);

  const isOwnProfile = username === ownUsername || username === null;

  useEffect(() => {
    if (!username) return;

    if (isOwnProfile) {
      // Use local store data
      const profile = buildProfileFromProgress(ownProgress, ownUsername);
      // Only fall back to mock if there's genuinely no data at all
      const hasData = ownProgress && (ownProgress.level > 1 || (ownProgress.totalHandsPlayed ?? ownProgress.totalHands ?? 0) > 0 || (ownProgress.wins ?? 0) > 0);
      setProfileData(hasData ? profile : buildMockProfile(ownUsername));
      setLoading(false);
    } else if (socket) {
      socket.emit('requestProfile', { username });
      const handler = (data) => {
        if (data.username === username) {
          setProfileData(data);
          setLoading(false);
        }
      };
      socket.on('profileData', handler);
      return () => socket.off('profileData', handler);
    } else {
      // Fallback: generate placeholder data
      setProfileData(buildMockProfile(username));
      setLoading(false);
    }
  }, [username, isOwnProfile, socket, ownProgress, ownUsername]);

  if (!username) return null;

  function buildProfileFromProgress(progress = {}, uname = '') {
    const totalHands = progress.totalHandsPlayed ?? progress.totalHands ?? 0;
    return {
      username: uname,
      level: progress.level ?? 1,
      elo: progress.elo ?? 500,
      wins: progress.wins ?? 0,
      losses: progress.losses ?? 0,
      totalHands,
      winRate: totalHands > 0
        ? ((( progress.wins ?? 0) / totalHands) * 100).toFixed(1)
        : '0.0',
      netChips: progress.netChips ?? 0,
      vpip: progress.vpip ?? 0,
      pfr: progress.pfr ?? 0,
      vipTier: progress.vipTier ?? 'Bronze',
      vipXp: progress.vipXp ?? 0,
      unlockedAchievements: progress.unlockedAchievements ?? [],
      sessionHistory: progress.sessionHistory ?? null,
      handHistory: progress.handHistory ?? [],
    };
  }

  function buildMockProfile(uname) {
    return {
      username: uname,
      level: 12,
      elo: 850,
      wins: 134,
      losses: 98,
      totalHands: 432,
      winRate: '37.2',
      netChips: 14200,
      vpip: 28,
      pfr: 19,
      vipTier: 'Silver',
      vipXp: 4200,
      unlockedAchievements: ['first_win', 'hands_100', 'bluff_caught'],
      sessionHistory: null,
      handHistory: [],
    };
  }

  function handleCopyLink() {
    const link = window.location.origin + '?profile=' + encodeURIComponent(username);
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  if (loading) {
    return (
      <div className="player-profile-overlay" onClick={handleOverlayClick}>
        <div className="player-profile-card">
          <div className="profile-loading">Loading profile…</div>
        </div>
      </div>
    );
  }

  const {
    level, elo, wins, losses, totalHands, winRate,
    netChips, vpip, pfr, vipTier, vipXp,
    unlockedAchievements, sessionHistory, handHistory,
  } = profileData;

  const avatarColor = nameToColor(username);
  const initial = (username[0] ?? '?').toUpperCase();
  const rankInfo = getRankFromElo(elo);
  const sessions = sessionHistory ?? generateSampleSessions();

  const unlockedSet = new Set(unlockedAchievements);
  const achievementsWithState = ACHIEVEMENT_DEFS.map((a) => ({
    ...a,
    unlocked: unlockedSet.has(a.id),
    dateEarned: unlockedSet.has(a.id) ? 'Recently' : null,
  }));

  const visibleAchievements = showAllAchievements
    ? achievementsWithState
    : achievementsWithState.slice(0, 12);

  const netChipsFormatted =
    netChips >= 0
      ? '+' + netChips.toLocaleString()
      : netChips.toLocaleString();

  const recentHands = handHistory.slice(-3).reverse();

  return (
    <div className="player-profile-overlay" onClick={handleOverlayClick}>
      <div className="player-profile-card" role="dialog" aria-modal="true" aria-label={`${username}'s profile`}>

        {/* Close button */}
        <button className="profile-close-btn" onClick={onClose} aria-label="Close profile">×</button>

        {/* Header card */}
        <div className="profile-header-card">
          <div className="profile-avatar" style={{ backgroundColor: avatarColor }}>
            {initial}
          </div>
          <div className="profile-header-info">
            <h2 className="profile-username">{username}</h2>
            <div className="profile-badges-row">
              <span className="profile-rank-badge">
                {rankInfo.icon} {rankInfo.current.name}
              </span>
              <span className="profile-level-badge">LVL {level}</span>
            </div>
            <div className="profile-action-buttons">
              <button className="profile-copy-btn" onClick={handleCopyLink}>
                {copied ? '✓ Copied!' : '📋 Copy Profile Link'}
              </button>
              {isOwnProfile && (
                <button className="profile-edit-btn">✏️ Edit</button>
              )}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="profile-stats-row">
          <div className="profile-stat-card">
            <span className="stat-value">{totalHands.toLocaleString()}</span>
            <span className="stat-label">Total Hands</span>
          </div>
          <div className="profile-stat-card">
            <span className="stat-value">{winRate}%</span>
            <span className="stat-label">Win Rate</span>
          </div>
          <div className="profile-stat-card">
            <span className={`stat-value ${netChips >= 0 ? 'stat-positive' : 'stat-negative'}`}>
              {netChipsFormatted}
            </span>
            <span className="stat-label">Net Chips</span>
          </div>
          <div className="profile-stat-card">
            <span className="stat-value">{vpip}%</span>
            <span className="stat-label">VPIP</span>
          </div>
          <div className="profile-stat-card">
            <span className="stat-value">{pfr}%</span>
            <span className="stat-label">PFR</span>
          </div>
        </div>

        {/* Rank progress */}
        <div className="profile-rank-section">
          <div className="rank-section-header">
            <span className="rank-section-title">
              {rankInfo.icon} {rankInfo.current.name}
            </span>
            <span className="rank-elo">ELO: {elo}</span>
            <span className="rank-record">{wins}W / {losses}L</span>
          </div>
          <div className="rank-progress-bar-track">
            <div
              className="rank-progress-bar-fill"
              style={{ width: `${rankInfo.progress}%` }}
            />
          </div>
          {rankInfo.next && (
            <div className="rank-progress-label">
              <span>{rankInfo.current.name}</span>
              <span>{rankInfo.progress}% to {rankInfo.next.name}</span>
              <span>{rankInfo.next.name}</span>
            </div>
          )}
        </div>

        {/* VIP Status */}
        <div className="profile-vip-row">
          <span className="vip-tier-badge">⭐ {vipTier} VIP</span>
          <span className="vip-xp">{vipXp.toLocaleString()} XP</span>
        </div>

        {/* Achievement wall */}
        <div className="profile-section">
          <h3 className="profile-section-title">Achievements</h3>
          <div className="achievement-grid">
            {visibleAchievements.map((a) => (
              <div
                key={a.id}
                className={`achievement-badge-card ${a.unlocked ? 'unlocked' : 'locked'}`}
                title={a.unlocked ? `${a.name} – ${a.dateEarned}` : a.requirement}
              >
                <span className="achievement-icon">{a.unlocked ? a.icon : '🔒'}</span>
                <span className="achievement-name">{a.name}</span>
                {a.unlocked && a.dateEarned && (
                  <span className="achievement-date">{a.dateEarned}</span>
                )}
              </div>
            ))}
          </div>
          {!showAllAchievements && achievementsWithState.length > 12 && (
            <button
              className="view-all-btn"
              onClick={() => setShowAllAchievements(true)}
            >
              View all {achievementsWithState.length}
            </button>
          )}
        </div>

        {/* Recent sessions chart */}
        <div className="profile-section">
          <h3 className="profile-section-title">Recent Sessions</h3>
          <div className="session-chart-wrapper">
            <SessionChart sessions={sessions} />
          </div>
        </div>

        {/* Best hands */}
        {recentHands.length > 0 && (
          <div className="profile-section">
            <h3 className="profile-section-title">Notable Hands</h3>
            <div className="hand-history-list">
              {recentHands.map((hand, i) => (
                <div
                  key={i}
                  className="hand-history-item"
                  onClick={() => onViewReplay && onViewReplay(hand)}
                >
                  <div className="hand-info">
                    <span className="hand-name">{hand.name ?? 'Notable Hand'}</span>
                    <span className="hand-date">{hand.date ?? 'Recently'}</span>
                  </div>
                  <div className="hand-pot">
                    <span className="hand-pot-size">+{(hand.pot ?? 0).toLocaleString()} chips</span>
                    <button className="hand-replay-btn">▶ Replay</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
