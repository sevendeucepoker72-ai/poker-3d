import { useEffect, useRef, useState } from 'react';
import { useProgressStore, serverWinRate } from '../../store/progressStore';
import { getSocket } from '../../services/socketService';
import { formatReward, shopErrorText } from '../../utils/economyCatalog';
import { nextDenverMidnightMs, formatCountdown } from '../../utils/denverTime';
import { LIFETIME_ACHIEVEMENTS, achievementIcon } from '../../utils/achievementCatalog';
import './Progression.css';

// 2026-10-11 (.online R2 — C6 / APPUI-3 / ECON-5). Daily missions are the
// SERVER's: three per account per Denver day, progress counted from hands he
// was dealt into, claimed with `claimMission { missionId }` from anywhere (no
// seat needed) → `missionClaimed { missionId, reward }` (or an error), then a
// fresh playerProgress. Nothing here is generated or counted on the client.
// The old "Daily Login Bonus" button (claimDailyBonus) is retired — the daily
// reward is the Daily Rewards calendar (claimDailyLogin).

const CLAIM_TIMEOUT_MS = 10000;

// poker-server R2 missionClaimError codes: progress_loading | mission_not_found |
// mission_expired | mission_incomplete | already_claimed | rate_limited | …
const MISSION_CLAIM_ERRORS = {
  mission_incomplete: 'Finish the mission first.',
  progress_loading: 'Your missions are still loading — try again in a moment.',
  rate_limited: 'Too many tries — wait a moment and try again.',
  mission_not_complete: 'Finish the mission first.',
  not_complete: 'Finish the mission first.',
  already_claimed: 'Already claimed.',
  mission_already_claimed: 'Already claimed.',
  mission_not_found: 'That mission has ended — a new set starts at midnight (Denver time).',
  mission_expired: 'That mission has ended — a new set starts at midnight (Denver time).',
  not_found: 'That mission has ended — a new set starts at midnight (Denver time).',
};

export function missionIcon(m) {
  const t = String(m?.templateId || m?.type || '').toLowerCase();
  if (t.startsWith('play') || t === 'playhands') return '\u{1F3B4}';
  if (t.startsWith('win_') || t === 'winhands') return '\u{1F3C6}';
  if (t.startsWith('pot') || t === 'winpotover') return '\u{1F4B0}';
  if (t.startsWith('allin') || t === 'playallin') return '\u{1F525}';
  if (t.startsWith('streak') || t === 'winstreak') return '\u{26A1}';
  if (t.startsWith('flush') || t === 'gethandrank') return '\u{2660}';
  if (t.startsWith('bluff') || t === 'winwithbluff') return '\u{1F3AD}';
  return '\u{1F3AF}';
}

export default function MissionsPanel() {
  const progress = useProgressStore((s) => s.progress);
  const missionsExpanded = useProgressStore((s) => s.missionsExpanded);
  const setMissionsExpanded = useProgressStore((s) => s.setMissionsExpanded);
  // missionId -> { state: 'pending' | 'done' | 'error', text }
  const [claims, setClaims] = useState({});
  const claimsRef = useRef(claims);
  claimsRef.current = claims;
  const timersRef = useRef(new Map());
  const [, setTick] = useState(0);

  // Server answers for claims sent from here.
  useEffect(() => {
    if (!missionsExpanded) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;
    const settle = (missionId, next) => {
      const t = timersRef.current.get(missionId);
      if (t) { clearTimeout(t); timersRef.current.delete(missionId); }
      setClaims((c) => ({ ...c, [missionId]: next }));
    };
    const onClaimed = (data) => {
      if (!data || data.missionId == null) return;
      settle(String(data.missionId), { state: 'done', text: `Collected ${formatReward(data.reward)}` });
    };
    const onError = (err) => {
      // Only an error that names a mission, or arrives while exactly one claim
      // is pending, belongs to a claim (the socket's `error` is shared).
      const pending = Object.entries(claimsRef.current).filter(([, v]) => v.state === 'pending').map(([k]) => k);
      const id = err && err.missionId != null ? String(err.missionId) : (pending.length === 1 ? pending[0] : null);
      if (!id || !pending.includes(id)) return;
      const code = err && (err.code || err.error);
      if (code === 'already_claimed' || code === 'mission_already_claimed') {
        settle(id, { state: 'done', text: 'Already claimed' });
        return;
      }
      settle(id, { state: 'error', text: MISSION_CLAIM_ERRORS[code] || shopErrorText(err, 'Could not claim — try again.') });
    };
    socket.on('missionClaimed', onClaimed);
    socket.on('missionClaimError', onError);
    socket.on('error', onError);
    return () => {
      socket.off('missionClaimed', onClaimed);
      socket.off('missionClaimError', onError);
      socket.off('error', onError);
    };
  }, [missionsExpanded]);

  // A countdown that stays current while the panel is open.
  useEffect(() => {
    if (!missionsExpanded) return undefined;
    const iv = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(iv);
  }, [missionsExpanded]);

  useEffect(() => () => {
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
  }, []);

  if (!progress || !missionsExpanded) return null;

  const missions = Array.isArray(progress.missions) ? progress.missions : null;

  const handleClaimMission = (missionId) => {
    const socket = getSocket();
    if (!socket || !socket.connected) {
      setClaims((c) => ({ ...c, [missionId]: { state: 'error', text: 'Not connected — try again in a moment.' } }));
      return;
    }
    setClaims((c) => ({ ...c, [missionId]: { state: 'pending', text: 'Claiming…' } }));
    const old = timersRef.current.get(missionId);
    if (old) clearTimeout(old);
    timersRef.current.set(missionId, setTimeout(() => {
      timersRef.current.delete(missionId);
      setClaims((c) => (c[missionId]?.state === 'pending'
        ? { ...c, [missionId]: { state: 'error', text: 'The game server did not answer — try again.' } }
        : c));
    }, CLAIM_TIMEOUT_MS));
    socket.emit('claimMission', { missionId });
  };

  const handleClose = (e) => {
    e.stopPropagation();
    setMissionsExpanded(false);
  };

  const achievementName = (id) => LIFETIME_ACHIEVEMENTS.find((a) => a.id === id)?.name || id;

  return (
    <div className="missions-panel-overlay" onClick={handleClose}>
      <div className="missions-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Daily missions">
        <div className="missions-header">
          <h2>Daily Missions</h2>
          <button className="missions-close-btn" onClick={handleClose} aria-label="Close daily missions">
            &times;
          </button>
        </div>

        <div className="missions-list">
          {missions === null && (
            <div className="missions-empty">Loading today's missions…</div>
          )}
          {missions && missions.length === 0 && (
            <div className="missions-empty">No missions today — check back after midnight (Denver time).</div>
          )}
          {(missions || []).map((mission) => {
            const progressPercent = Math.min((mission.progress / Math.max(1, mission.target)) * 100, 100);
            const claim = claims[mission.id];
            const claimed = mission.claimed || claim?.state === 'done';
            return (
              <div
                key={mission.id}
                className={`mission-card ${mission.completed ? 'mission-complete' : ''} ${claimed ? 'mission-claimed' : ''}`}
              >
                <div className="mission-icon">{missionIcon(mission)}</div>
                <div className="mission-info">
                  <div className="mission-description">{mission.description}</div>
                  <div className="mission-progress-row">
                    <div className="mission-progress-track">
                      <div className="mission-progress-fill" style={{ width: `${progressPercent}%` }} />
                    </div>
                    <span className="mission-progress-text">
                      {mission.progress}/{mission.target}
                    </span>
                  </div>
                  {claim && claim.state !== 'pending' && (
                    <div className={`mission-claim-note mission-claim-note--${claim.state}`}>{claim.text}</div>
                  )}
                </div>
                <div className="mission-reward-section">
                  <div className="mission-reward-preview">
                    {mission.reward.chips > 0 && <span className="mission-reward-chips">{mission.reward.chips.toLocaleString()} chips</span>}
                    {mission.reward.stars > 0 && <span className="mission-reward-stars">+{mission.reward.stars}&#9733;</span>}
                    {mission.reward.xp > 0 && <span className="mission-reward-xp">+{mission.reward.xp} XP</span>}
                  </div>
                  {mission.completed && !claimed && (
                    <button
                      className="mission-claim-btn"
                      onClick={() => handleClaimMission(mission.id)}
                      disabled={claim?.state === 'pending'}
                    >
                      {claim?.state === 'pending' ? 'CLAIMING…' : 'CLAIM'}
                    </button>
                  )}
                  {claimed && <span className="mission-claimed-label">Claimed</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="missions-timer">
          New missions in {formatCountdown(nextDenverMidnightMs())} (midnight, Denver time)
        </div>

        {progress.achievements && progress.achievements.length > 0 && (
          <div className="achievements-section">
            <h3>Achievements ({progress.achievements.length})</h3>
            <div className="achievements-badges">
              {progress.achievements.map((achId) => (
                <span key={achId} className="achievement-badge" title={achievementName(achId)}>
                  {achievementIcon(achId)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="player-stats-section">
          <h3>Stats</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Hands Played</span>
              <span className="stat-value">{(progress.totalHandsPlayed || 0).toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Hands Won</span>
              <span className="stat-value">{(progress.handsWon || 0).toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Win Rate</span>
              <span className="stat-value">{serverWinRate(progress)}%</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Biggest Pot</span>
              <span className="stat-value">{(progress.biggestPot || 0).toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Best Streak</span>
              <span className="stat-value">{progress.bestStreak || 0}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Current Streak</span>
              <span className="stat-value">{progress.currentStreak || 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
