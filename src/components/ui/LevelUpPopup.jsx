import { useProgressStore } from '../../store/progressStore';
import './Progression.css';

export default function LevelUpPopup() {
  const levelUpData = useProgressStore((s) => s.levelUpData);
  const clearLevelUp = useProgressStore((s) => s.clearLevelUp);

  if (!levelUpData) return null;

  return (
    <div className="levelup-overlay" onClick={clearLevelUp}>
      <div className="levelup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="levelup-particles">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="levelup-particle"
              style={{
                '--delay': `${Math.random() * 0.5}s`,
                '--x': `${(Math.random() - 0.5) * 300}px`,
                '--y': `${-Math.random() * 200 - 50}px`,
                '--rotation': `${Math.random() * 720}deg`,
              }}
            />
          ))}
        </div>

        <div className="levelup-crown">&#128081;</div>
        <div className="levelup-title">LEVEL UP!</div>
        <div className="levelup-level">{levelUpData.newLevel}</div>
        <div className="levelup-rewards">
          <div className="levelup-reward-item">
            <span className="levelup-reward-icon chips-color">&#9679;</span>
            <span>+{levelUpData.bonusChips.toLocaleString()} Chips</span>
          </div>
          <div className="levelup-reward-item">
            <span className="levelup-reward-icon stars-color">&#9733;</span>
            <span>+{levelUpData.bonusStars} Stars</span>
          </div>
        </div>
        <button className="levelup-continue-btn" onClick={clearLevelUp}>
          Continue
        </button>
      </div>
    </div>
  );
}
