import { useProgressStore, getLevelTier } from '../../store/progressStore';
import './Progression.css';

export default function ProgressBar() {
  const progress = useProgressStore((s) => s.progress);
  const toggleMissions = useProgressStore((s) => s.toggleMissions);

  if (!progress) return null;

  const tier = getLevelTier(progress.level);
  const xpPercent = progress.xpToNextLevel > 0
    ? Math.min((progress.xp / progress.xpToNextLevel) * 100, 100)
    : 0;

  return (
    <div className="progress-bar-container" onClick={toggleMissions}>
      <div
        className="level-badge"
        style={{
          borderColor: tier.color,
          boxShadow: `0 0 10px ${tier.glow}`,
        }}
      >
        <span className="level-number" style={{ color: tier.color }}>
          {progress.level}
        </span>
      </div>

      <div className="progress-info">
        <div className="progress-top-row">
          <span className="player-level-name">{progress.playerName}</span>
          <span className="xp-text">
            {progress.xp} / {progress.xpToNextLevel} XP
          </span>
        </div>
        <div className="xp-bar-track">
          <div
            className="xp-bar-fill"
            style={{ width: `${xpPercent}%` }}
          />
        </div>
      </div>

      <div className="currency-display">
        <div className="currency-item chips-currency">
          <span className="currency-icon">&#9679;</span>
          <span className="currency-amount">{(progress.chips || 0).toLocaleString()}</span>
        </div>
        <div className="currency-item stars-currency">
          <span className="currency-icon">&#9733;</span>
          <span className="currency-amount">{(progress.stars || 0).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
