import { useProgressStore } from '../../store/progressStore';
import { getSocket } from '../../services/socketService';
import './Progression.css';

function getMissionIcon(type) {
  switch (type) {
    case 'PlayHands': return '\u{1F3B4}';
    case 'WinHands': return '\u{1F3C6}';
    case 'WinPotOver': return '\u{1F4B0}';
    case 'GetHandRank': return '\u{2660}';
    case 'PlayAllIn': return '\u{1F525}';
    case 'WinStreak': return '\u{26A1}';
    case 'FoldPreFlop': return '\u{1F6E1}';
    case 'WinWithBluff': return '\u{1F3AD}';
    default: return '\u{1F3AF}';
  }
}

function formatTimeRemaining(timestamp) {
  const remaining = timestamp - Date.now();
  if (remaining <= 0) return 'Refreshing...';

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function MissionsPanel() {
  const progress = useProgressStore((s) => s.progress);
  const missionsExpanded = useProgressStore((s) => s.missionsExpanded);
  const setMissionsExpanded = useProgressStore((s) => s.setMissionsExpanded);

  if (!progress || !missionsExpanded) return null;

  const missions = progress.dailyMissions || [];
  const today = new Date().toISOString().split('T')[0];
  const canClaimDailyBonus = progress.lastDailyBonusClaimed !== today;

  const handleClaimMission = (missionId) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('claimMission', { missionId });
    }
  };

  const handleClaimDailyBonus = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit('claimDailyBonus');
    }
  };

  const handleClose = (e) => {
    e.stopPropagation();
    setMissionsExpanded(false);
  };

  return (
    <div className="missions-panel-overlay" onClick={handleClose}>
      <div className="missions-panel" onClick={(e) => e.stopPropagation()}>
        <div className="missions-header">
          <h2>Daily Missions</h2>
          <button className="missions-close-btn" onClick={handleClose}>
            &times;
          </button>
        </div>

        {canClaimDailyBonus && (
          <button className="daily-bonus-btn" onClick={handleClaimDailyBonus}>
            <span className="daily-bonus-icon">&#127873;</span>
            <div className="daily-bonus-text">
              <span className="daily-bonus-title">Daily Login Bonus</span>
              <span className="daily-bonus-streak">
                Streak: {progress.dailyLoginStreak || 0} day{(progress.dailyLoginStreak || 0) !== 1 ? 's' : ''}
              </span>
            </div>
            <span className="daily-bonus-claim">CLAIM</span>
          </button>
        )}

        <div className="missions-list">
          {missions.map((mission) => {
            const progressPercent = mission.target > 0
              ? Math.min((mission.progress / mission.target) * 100, 100)
              : 0;

            return (
              <div
                key={mission.id}
                className={`mission-card ${mission.completed ? 'mission-complete' : ''} ${mission.claimed ? 'mission-claimed' : ''}`}
              >
                <div className="mission-icon">{getMissionIcon(mission.type)}</div>
                <div className="mission-info">
                  <div className="mission-description">{mission.description}</div>
                  <div className="mission-progress-row">
                    <div className="mission-progress-track">
                      <div
                        className="mission-progress-fill"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <span className="mission-progress-text">
                      {mission.progress}/{mission.target}
                    </span>
                  </div>
                </div>
                <div className="mission-reward-section">
                  <div className="mission-reward-preview">
                    <span className="mission-reward-chips">{mission.reward.chips}</span>
                    {mission.reward.stars > 0 && (
                      <span className="mission-reward-stars">+{mission.reward.stars}&#9733;</span>
                    )}
                    <span className="mission-reward-xp">+{mission.reward.xp}XP</span>
                  </div>
                  {mission.completed && !mission.claimed && (
                    <button
                      className="mission-claim-btn"
                      onClick={() => handleClaimMission(mission.id)}
                    >
                      CLAIM
                    </button>
                  )}
                  {mission.claimed && (
                    <span className="mission-claimed-label">Claimed</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="missions-timer">
          Refreshes in: {formatTimeRemaining(progress.dailyMissionsRefreshAt)}
        </div>

        {progress.achievements && progress.achievements.length > 0 && (
          <div className="achievements-section">
            <h3>Achievements ({progress.achievements.length})</h3>
            <div className="achievements-badges">
              {progress.achievements.map((achId) => (
                <span key={achId} className="achievement-badge" title={achId}>
                  &#127942;
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
              <span className="stat-value">{progress.totalHandsPlayed}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Hands Won</span>
              <span className="stat-value">{progress.handsWon}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Win Rate</span>
              <span className="stat-value">
                {progress.totalHandsPlayed > 0
                  ? Math.round((progress.handsWon / progress.totalHandsPlayed) * 100)
                  : 0}%
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Biggest Pot</span>
              <span className="stat-value">{(progress.biggestPot || 0).toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Best Streak</span>
              <span className="stat-value">{progress.bestStreak}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Current Streak</span>
              <span className="stat-value">{progress.currentStreak}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
