import { useState, useEffect, useMemo, useRef } from 'react';
import { useProgressStore, serverWinRate, isItemOwned, equippedIdFor, vipPassActive } from '../../store/progressStore';
import { useGameStore } from '../../store/gameStore';
import { RANK_TIERS } from './RankBadge';
import { lifetimeAchievementRows, sortAchievementRows } from '../../utils/achievementCatalog';
import { SEASON_BADGES, PROFILE_BGS, vipXpTierFor } from '../../utils/economyCatalog';
import { ownHandResult } from '../../utils/handLog';
import { useDetailedStats } from '../../hooks/useDetailedStats';
import { isPublicId, profileRequestOf, profileAnswerMatches, profileLink, friendRequestOf } from '../../utils/profileTarget';
import { noRedHue } from '../../utils/noRedHue';
import './PlayerProfile.css';

// 2026-10-11 (.online R2 — APPUI-14 / APPUI-49 / C9 / C10).
// - Whose profile it is comes from IDENTITY: `target.own`, or a `target.userId`
//   equal to this account's id. (It compared names with a store field nothing
//   wrote, so his own profile was fetched from the server as a stranger's.)
// - Another player's profile is asked for by ID — the opaque `publicId` the
//   server puts on leaderboard / search / friends rows, or a friend's
//   `userId` (`requestProfile { publicId | userId }`; an older server gets the
//   name as well) — never a name that two players can share. The server's
//   `isYou` turns an id-opened profile into his own. Add Friend sends the same
//   id (`sendFriendRequest { publicId | userId }`), and the shared link carries
//   the public id (`?profile=p…`), never the account id when the server gave one.
// - Achievements are the server's (ids / names; live list when it answers),
//   season badges and the equipped profile background are drawn, and his own
//   VPIP / PFR are the server's tracked stats (getDetailedStats), not this
//   browser's count.

// Mirror the server display-name whitelist (authManager.setDisplayName):
// ASCII letters/digits/space/_.'- , at least one alphanumeric, length 2-20.
function validateDisplayName(name) {
  const n = (name || '').trim();
  if (n.length < 2 || n.length > 20) return 'Name must be 2-20 characters.';
  if (!/^[A-Za-z0-9 _.'-]+$/.test(n)) return 'Only letters, numbers, spaces and _ . \' - allowed.';
  if (!/[A-Za-z0-9]/.test(n)) return 'Name needs at least one letter or number.';
  return null;
}

// Generate a deterministic color from a name
function nameToColor(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  // R3 (APPUI-P3-7) — no red: a hash that lands on red / rose moves to blue.
  const hue = noRedHue(Math.abs(hash) % 360);
  return `hsl(${hue}, 65%, 45%)`;
}

// Simple SVG line chart
function SessionChart({ values }) {
  if (!values || values.length < 2) return null;
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
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="session-chart-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${polyline} ${areaClose}`} fill="url(#chartGrad)" />
      <polyline points={polyline} fill="none" stroke="#ffd24a" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

// Rank ladder: RankBadge's RANK_TIERS (descending by `min`).
function getRankFromElo(elo = 0) {
  const current = RANK_TIERS.find((t) => elo >= t.min) || RANK_TIERS[RANK_TIERS.length - 1];
  const idx = RANK_TIERS.indexOf(current);
  const next = idx > 0 ? RANK_TIERS[idx - 1] : null;
  const progress = next ? Math.round(((elo - current.min) / (next.min - current.min)) * 100) : 100;
  return { current, next, icon: current.icon, progress };
}

// Friend request refusals, in words (the profile was opened by id, so a
// "not found" here is an account that is gone, not a misspelling).
const PROFILE_FRIEND_ERRORS = {
  friend_not_found: 'That player could not be found.',
  friend_name_ambiguous: 'That player could not be identified exactly — try again from their profile.',
};

/** Is this target the signed-in player? (identity, never the name) */
export function isOwnProfileTarget(target, myUserId) {
  if (!target) return false;
  if (target.own === true) return true;
  return target.userId != null && myUserId != null && String(target.userId) === String(myUserId);
}

export default function PlayerProfile({ target, socket, onClose, onViewReplay }) {
  const ownProgress = useProgressStore((s) => s.progress);
  const handLog = useProgressStore((s) => s.handLog);
  const myUserId = useGameStore((s) => s.userId);
  const myName = useGameStore((s) => s.playerName);
  const ownByTarget = isOwnProfileTarget(target, myUserId);
  // The server can say an id-opened profile is his own (`isYou`) — e.g. his row in a search.
  const [answeredIsYou, setAnsweredIsYou] = useState(false);
  const isOwnProfile = ownByTarget || answeredIsYou;
  const targetName = isOwnProfile ? (myName || 'You') : String(target?.name ?? '');
  const requestKey = useMemo(() => {
    const req = ownByTarget ? null : profileRequestOf(target);
    return req ? JSON.stringify(req) : '';
  }, [ownByTarget, target]);

  const [otherProfile, setOtherProfile] = useState(null);
  const [loading, setLoading] = useState(!isOwnProfile);
  const [liveAchievements, setLiveAchievements] = useState(null);
  const [ownPublicId, setOwnPublicId] = useState(null);
  const [friendState, setFriendState] = useState(null); // { ok, text, pending }
  const [showAllAchievements, setShowAllAchievements] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [localName, setLocalName] = useState(null); // optimistic override after a rename
  const friendTimerRef = useRef(null);

  // A different player on screen: forget the previous answer's state.
  useEffect(() => {
    setAnsweredIsYou(false);
    setFriendState(null);
  }, [requestKey]);

  // Another player's profile: by public id / user id (the name too, for an older server).
  useEffect(() => {
    if (ownByTarget || !socket) { setLoading(false); return undefined; }
    const req = requestKey ? JSON.parse(requestKey) : null;
    if (!req) { setLoading(false); return undefined; }
    setLoading(true);
    setOtherProfile(null);
    const handler = (data) => {
      if (!profileAnswerMatches(data, req)) return;
      if (data.isYou === true) setAnsweredIsYou(true);
      setOtherProfile(data.notFound ? { notFound: true } : data);
      setLoading(false);
    };
    socket.on('profileData', handler);
    socket.emit('requestProfile', req);
    const t = setTimeout(() => setLoading(false), 10000);
    return () => { clearTimeout(t); socket.off('profileData', handler); };
  }, [ownByTarget, socket, requestKey]);

  // His own: the server's achievement list + tracked stats (a still-loading record is asked again).
  const { stats: detailed } = useDetailedStats(isOwnProfile && !!socket);
  useEffect(() => {
    if (!isOwnProfile || !socket) return undefined;
    const onList = (payload) => { if (payload && Array.isArray(payload.lifetime)) setLiveAchievements(payload.lifetime); };
    socket.on('achievementsList', onList);
    socket.emit('getAchievements');
    return () => { socket.off('achievementsList', onList); };
  }, [isOwnProfile, socket]);

  // His own public id, for the shareable link: the server's answer about HIM
  // (`isYou`, computed by the server). An older server sends none → the link
  // falls back to the account id.
  useEffect(() => {
    if (!isOwnProfile || !socket || myUserId == null || ownPublicId) return undefined;
    const onData = (data) => {
      if (data && data.isYou === true && isPublicId(data.publicId)) setOwnPublicId(data.publicId);
    };
    socket.on('profileData', onData);
    socket.emit('requestProfile', { userId: myUserId });
    return () => { socket.off('profileData', onData); };
  }, [isOwnProfile, socket, myUserId, ownPublicId]);

  useEffect(() => () => { if (friendTimerRef.current) clearTimeout(friendTimerRef.current); }, []);

  // Add Friend — by the same exact id the profile was opened with.
  const friendReq = !isOwnProfile ? friendRequestOf({ publicId: otherProfile?.publicId || target?.publicId, userId: target?.userId }) : null;
  const handleAddFriend = () => {
    if (!friendReq || !socket || friendState?.pending) return;
    if (!socket.connected) { setFriendState({ ok: false, text: 'Not connected — try again in a moment.' }); return; }
    setFriendState({ pending: true, text: 'Sending…' });
    const done = (next) => {
      socket.off('friendRequestSent', onSent);
      socket.off('friendError', onErr);
      if (friendTimerRef.current) { clearTimeout(friendTimerRef.current); friendTimerRef.current = null; }
      setFriendState(next);
    };
    const onSent = (d) => done({ ok: true, text: d?.status === 'accepted' ? 'You are now friends.' : 'Friend request sent.' });
    const onErr = (d) => done({ ok: false, text: PROFILE_FRIEND_ERRORS[d?.code] || (typeof d?.message === 'string' && d.message) || 'Could not send the request — try again.' });
    socket.on('friendRequestSent', onSent);
    socket.on('friendError', onErr);
    friendTimerRef.current = setTimeout(() => done({ ok: false, text: 'The game server did not answer — try again.' }), 10000);
    socket.emit('sendFriendRequest', friendReq);
  };

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

  const view = useMemo(() => {
    if (isOwnProfile) {
      const p = ownProgress || {};
      const totalHands = Math.max(0, Number(p.totalHandsPlayed) || 0);
      const wins = Math.min(totalHands, Math.max(0, Number(p.handsWon) || 0));
      const seasonXp = Number(p.totalXp) || 0;
      const bgId = equippedIdFor(p, 'profile_bg');
      return {
        name: localName || targetName,
        level: p.level ?? 1,
        elo: p.elo ?? 500,
        wins,
        losses: Math.max(0, totalHands - wins),
        totalHands,
        winRate: serverWinRate(p),
        biggestPot: Number(p.biggestPot) || 0,
        vpip: detailed && detailed.vpip != null ? Number(detailed.vpip) : null,
        pfr: detailed && detailed.pfr != null ? Number(detailed.pfr) : null,
        vipLine: `${vipXpTierFor(seasonXp).name} XP tier${vipPassActive(p) ? ' · VIP pass active' : ''}`,
        achievements: sortAchievementRows(lifetimeAchievementRows(liveAchievements, p.achievements)),
        badges: SEASON_BADGES.filter((b) => isItemOwned(p, 'badge', b.id)),
        bg: bgId && bgId !== 'default' ? PROFILE_BGS.find((b) => b.id === bgId)?.bg : null,
      };
    }
    const d = otherProfile || {};
    const totalHands = Math.max(0, Number(d.totalHands) || 0);
    const wins = Math.min(totalHands, Math.max(0, Number(d.wins) || 0));
    const badgeIds = (Array.isArray(d.badges) ? d.badges : []).map((b) => (typeof b === 'string' ? b : b && b.id));
    return {
      name: String(d.displayName || targetName || 'Player'),
      level: d.level ?? 1,
      elo: d.elo ?? 500,
      wins,
      losses: Math.max(0, totalHands - wins),
      totalHands,
      winRate: Number(d.winRate) || (totalHands > 0 ? Math.round((wins / totalHands) * 1000) / 10 : 0),
      biggestPot: Number(d.biggestPot) || null,
      vpip: d.vpip != null ? Number(d.vpip) : null,
      pfr: d.pfr != null ? Number(d.pfr) : null,
      vipLine: d.vipTier ? `${d.vipTier} XP tier` : null,
      achievements: sortAchievementRows(lifetimeAchievementRows(null, d.unlockedAchievements)),
      badges: SEASON_BADGES.filter((b) => badgeIds.includes(b.id)),
      bg: d.profileBg ? PROFILE_BGS.find((b) => b.id === d.profileBg)?.bg || null : null,
    };
  }, [isOwnProfile, ownProgress, otherProfile, liveAchievements, detailed, localName, targetName]);

  // His own best recent wins (from his own rows of the lobby hand log).
  const notableHands = useMemo(() => {
    if (!isOwnProfile) return [];
    const out = [];
    for (const rec of handLog || []) {
      const r = ownHandResult(rec, myName);
      if (r && r.won) out.push({ rec, r });
    }
    return out.sort((a, b) => b.r.chipsWon - a.r.chipsWon).slice(0, 3);
  }, [isOwnProfile, handLog, myName]);

  const trend = useMemo(() => {
    if (!isOwnProfile) return [];
    let cum = 0;
    const pts = [];
    for (const rec of handLog || []) {
      const r = ownHandResult(rec, myName);
      if (r && typeof r.net === 'number') { cum += r.net; pts.push(cum); }
    }
    return pts.slice(-30);
  }, [isOwnProfile, handLog, myName]);

  const shareLink = profileLink(window.location.origin, isOwnProfile
    ? { publicId: ownPublicId, userId: ownPublicId ? null : myUserId }
    : { publicId: otherProfile?.publicId || target?.publicId, userId: target?.userId });

  function handleCopyLink() {
    if (!shareLink) return;
    const link = shareLink;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  if (!target) return null;

  if (loading) {
    return (
      <div className="player-profile-overlay" onClick={handleOverlayClick}>
        <div className="player-profile-card">
          <div className="profile-loading">Loading profile…</div>
        </div>
      </div>
    );
  }

  if (!isOwnProfile && (!otherProfile || otherProfile.notFound)) {
    return (
      <div className="player-profile-overlay" onClick={handleOverlayClick}>
        <div className="player-profile-card" role="dialog" aria-modal="true" aria-label="Player profile">
          <button className="profile-close-btn" onClick={onClose} aria-label="Close profile">×</button>
          <div className="profile-loading">{otherProfile && otherProfile.notFound ? 'That player could not be found.' : 'Profile unavailable — try again in a moment.'}</div>
        </div>
      </div>
    );
  }

  const shownName = view.name || 'Player';
  const avatarColor = nameToColor(shownName);
  const initial = (shownName[0] ?? '?').toUpperCase();
  const rankInfo = getRankFromElo(view.elo);
  const visibleAchievements = showAllAchievements ? view.achievements : view.achievements.slice(0, 12);

  return (
    <div className="player-profile-overlay" onClick={handleOverlayClick}>
      <div className="player-profile-card" role="dialog" aria-modal="true" aria-label={`${shownName}'s profile`}>
        <button className="profile-close-btn" onClick={onClose} aria-label="Close profile">×</button>

        {/* Header card */}
        <div className="profile-header-card" style={view.bg ? { background: view.bg } : undefined}>
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
              <h2 className="profile-username">
                {shownName}
                {view.badges.map((b) => <span key={b.id} className="profile-season-badge" title={b.name}>{b.icon}</span>)}
              </h2>
            )}
            <div className="profile-badges-row">
              <span className="profile-rank-badge">
                {rankInfo.icon} {rankInfo.current.name}
              </span>
              <span className="profile-level-badge">LVL {view.level}</span>
            </div>
            <div className="profile-action-buttons">
              {shareLink && (
                <button className="profile-copy-btn" onClick={handleCopyLink}>
                  {copied ? '✓ Copied!' : '📋 Copy Profile Link'}
                </button>
              )}
              {!isOwnProfile && friendReq && (
                <button className="profile-friend-btn" onClick={handleAddFriend} disabled={!!friendState?.pending || friendState?.ok === true}>
                  {friendState?.pending ? 'Sending…' : friendState?.ok ? '✓ Requested' : '➕ Add Friend'}
                </button>
              )}
              {isOwnProfile && !editingName && (
                <button
                  className="profile-edit-btn"
                  onClick={() => { setNameInput(shownName); setNameError(''); setEditingName(true); }}
                >✏️ Edit</button>
              )}
            </div>
            {friendState && !friendState.pending && (
              <div className={`profile-friend-note ${friendState.ok ? 'profile-friend-note--ok' : ''}`} role="status">{friendState.text}</div>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="profile-stats-row">
          <div className="profile-stat-card">
            <span className="stat-value">{view.totalHands.toLocaleString()}</span>
            <span className="stat-label">Total Hands</span>
          </div>
          <div className="profile-stat-card">
            <span className="stat-value">{view.winRate}%</span>
            <span className="stat-label">Win Rate</span>
          </div>
          <div className="profile-stat-card">
            <span className="stat-value">{view.biggestPot != null ? view.biggestPot.toLocaleString() : '—'}</span>
            <span className="stat-label">Biggest Pot</span>
          </div>
          <div className="profile-stat-card">
            <span className="stat-value">{view.vpip != null ? `${view.vpip}%` : '—'}</span>
            <span className="stat-label">VPIP</span>
          </div>
          <div className="profile-stat-card">
            <span className="stat-value">{view.pfr != null ? `${view.pfr}%` : '—'}</span>
            <span className="stat-label">PFR</span>
          </div>
        </div>

        {/* Rank progress */}
        <div className="profile-rank-section">
          <div className="rank-section-header">
            <span className="rank-section-title">
              {rankInfo.icon} {rankInfo.current.name}
            </span>
            <span className="rank-elo">ELO: {view.elo}</span>
            <span className="rank-record">{view.wins}W / {view.losses}L</span>
          </div>
          <div className="rank-progress-bar-track">
            <div className="rank-progress-bar-fill" style={{ width: `${rankInfo.progress}%` }} />
          </div>
          {rankInfo.next && (
            <div className="rank-progress-label">
              <span>{rankInfo.current.name}</span>
              <span>{rankInfo.progress}% to {rankInfo.next.name}</span>
              <span>{rankInfo.next.name}</span>
            </div>
          )}
        </div>

        {view.vipLine && (
          <div className="profile-vip-row">
            <span className="vip-tier-badge">⭐ {view.vipLine}</span>
          </div>
        )}

        {/* Achievement wall — the server's achievements */}
        <div className="profile-section">
          <h3 className="profile-section-title">
            Achievements ({view.achievements.filter((a) => a.unlocked).length}/{view.achievements.length})
          </h3>
          <div className="achievement-grid">
            {visibleAchievements.map((a) => (
              <div
                key={a.id}
                className={`achievement-badge-card ${a.unlocked ? 'unlocked' : 'locked'}`}
                title={a.description}
              >
                <span className="achievement-icon">{a.unlocked ? a.icon : '🔒'}</span>
                <span className="achievement-name">{a.name}</span>
              </div>
            ))}
          </div>
          {!showAllAchievements && view.achievements.length > 12 && (
            <button className="view-all-btn" onClick={() => setShowAllAchievements(true)}>
              View all {view.achievements.length}
            </button>
          )}
        </div>

        {isOwnProfile && (
          <div className="profile-section">
            <h3 className="profile-section-title">Results (your recent hands)</h3>
            <div className="session-chart-wrapper">
              {trend.length >= 2 ? (
                <SessionChart values={trend} />
              ) : (
                <div className="profile-empty-state">Not enough recent hands yet.</div>
              )}
            </div>
          </div>
        )}

        {notableHands.length > 0 && (
          <div className="profile-section">
            <h3 className="profile-section-title">Best Recent Wins</h3>
            <div className="hand-history-list">
              {notableHands.map(({ rec, r }, i) => (
                <div key={i} className="hand-history-item" onClick={() => onViewReplay && onViewReplay(rec)}>
                  <div className="hand-info">
                    <span className="hand-name">{r.handName || 'Winning hand'}</span>
                    <span className="hand-date">Hand #{rec.handNumber ?? '—'}</span>
                  </div>
                  <div className="hand-pot">
                    <span className="hand-pot-size">+{r.chipsWon.toLocaleString()} chips</span>
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
