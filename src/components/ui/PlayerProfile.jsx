import React, { useState, useEffect } from 'react';
import { useProgressStore } from '../../store/progressStore';
import { useGameStore } from '../../store/gameStore';
import { RANK_TIERS } from './RankBadge';
import './PlayerProfile.css';

// Mirror the server display-name whitelist (authManager.setDisplayName):
// ASCII letters/digits/space/_.'- , at least one alphanumeric, length 2-20.
function validateDisplayName(name) {
  const n = (name || '').trim();
  if (n.length < 2 || n.length > 20) return 'Name must be 2-20 characters.';
  if (!/^[A-Za-z0-9 _.'-]+$/.test(n)) return 'Only letters, numbers, spaces and _ . \' - allowed.';
  if (!/[A-Za-z0-9]/.test(n)) return 'Name needs at least one letter or number.';
  return null;
}

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

// 2026-06-19 fix: rank ladder unified onto RankBadge's RANK_TIERS (the single
// source used by nameplates/leaderboard). Previously PlayerProfile had its OWN
// 12-tier ladder with different thresholds, so the same ELO showed a different
// rank here than on the badge elsewhere. RANK_TIERS is descending by `min` and
// carries a per-tier `icon`.
function getRankFromElo(elo = 0) {
  const current = RANK_TIERS.find((t) => elo >= t.min) || RANK_TIERS[RANK_TIERS.length - 1];
  const idx = RANK_TIERS.indexOf(current);
  const next = idx > 0 ? RANK_TIERS[idx - 1] : null; // descending → lower index = higher tier
  const progress = next
    ? Math.round(((elo - current.min) / (next.min - current.min)) * 100)
    : 100;
  return { current, next, icon: current.icon, progress };
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

export default function PlayerProfile({ username, socket, onClose, onViewReplay }) {
  const ownProgress = useProgressStore((s) => s.progress);
  const ownUsername = useProgressStore((s) => s.username);

  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAllAchievements, setShowAllAchievements] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [localName, setLocalName] = useState(null); // optimistic override after a rename

  const isOwnProfile = username === ownUsername || username === null;

  const handleSaveName = () => {
    const err = validateDisplayName(nameInput);
    if (err) { setNameError(err); return; }
    if (!socket) { setNameError('Not connected.'); return; }
    setSavingName(true);
    setNameError('');
    socket.emit('setDisplayName', { name: nameInput.trim() });
    socket.once('setDisplayNameResult', (data) => {
      setSavingName(false);
      if (data?.success) {
        const nm = data.displayName || nameInput.trim();
        setLocalName(nm);
        try { useGameStore.getState().setPlayerName(nm); } catch { /* ignore */ }
        setEditingName(false);
      } else {
        setNameError(data?.error || 'Failed to update name.');
      }
    });
  };

  useEffect(() => {
    if (!username) return;

    if (isOwnProfile) {
      // Always render real store data — a brand-new player showing level 1 /
      // 0 hands is honest. No mock fabrication.
      setProfileData(buildProfileFromProgress(ownProgress, ownUsername));
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
      // No socket to fetch another player's real profile — show an honest
      // unavailable state instead of fabricating one.
      setProfileData(null);
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

  if (!profileData) {
    return (
      <div className="player-profile-overlay" onClick={handleOverlayClick}>
        <div className="player-profile-card" role="dialog" aria-modal="true" aria-label={`${username}'s profile`}>
          <button className="profile-close-btn" onClick={onClose} aria-label="Close profile">×</button>
          <div className="profile-loading">Profile unavailable.</div>
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
  // Real session trend from the daily chip snapshot (own profile) or the
  // server-provided sessionHistory (other profiles). No random sample data —
  // <2 points renders an honest empty state below instead of a fake line.
  const dailyChipHistory = isOwnProfile ? (ownProgress?.dailyChipHistory ?? []) : [];
  const sessions = (Array.isArray(sessionHistory) && sessionHistory.length > 0)
    ? sessionHistory
    : dailyChipHistory;
  const hasSessionTrend = Array.isArray(sessions) && sessions.length >= 2;

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
            {editingName ? (
              <div className="profile-name-editor">
                <input
                  className="profile-name-input"
                  value={nameInput}
                  maxLength={20}
                  autoFocus
                  onChange={(e) => { setNameInput(e.target.value); if (nameError) setNameError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                  aria-label="Edit display name"
                />
                <div className="profile-name-editor-actions">
                  <button className="profile-name-save" onClick={handleSaveName} disabled={savingName}>
                    {savingName ? 'Saving…' : 'Save'}
                  </button>
                  <button className="profile-name-cancel" onClick={() => { setEditingName(false); setNameError(''); }} disabled={savingName}>
                    Cancel
                  </button>
                </div>
                {nameError && <div className="profile-name-error">{nameError}</div>}
              </div>
            ) : (
              <h2 className="profile-username">{localName || username}</h2>
            )}
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
              {isOwnProfile && !editingName && (
                <button
                  className="profile-edit-btn"
                  onClick={() => { setNameInput(localName || username || ownUsername || ''); setNameError(''); setEditingName(true); }}
                >✏️ Edit</button>
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
            {hasSessionTrend ? (
              <SessionChart sessions={sessions} />
            ) : (
              <div className="profile-empty-state">Not enough session history yet.</div>
            )}
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
