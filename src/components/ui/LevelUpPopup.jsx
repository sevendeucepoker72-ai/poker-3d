import { useProgressStore } from '../../store/progressStore';
import { useTableStore } from '../../store/tableStore';
import './Progression.css';

const ACTIVE_PHASES = new Set(['PreFlop', 'Flop', 'Turn', 'River', 'Showdown']);

export default function LevelUpPopup() {
  const levelUpData = useProgressStore((s) => s.levelUpData);
  const clearLevelUp = useProgressStore((s) => s.clearLevelUp);
  const gamePhase = useTableStore((s) => s.gameState?.phase);

  // Defer the popup until the hand is over so it never blocks player actions
  if (!levelUpData || ACTIVE_PHASES.has(gamePhase)) return null;

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
        <div className="levelup-title">
          {levelUpData.isMilestone ? 'MILESTONE LEVEL!' : 'LEVEL UP!'}
        </div>
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
          {levelUpData.isMilestone && levelUpData.milestoneStars > 0 && (
            <div className="levelup-reward-item" style={{ color: '#FFD700' }}>
              <span>🎉 Milestone bonus: +{levelUpData.milestoneStars.toLocaleString()} stars</span>
            </div>
          )}
        </div>
        <button className="levelup-continue-btn" onClick={clearLevelUp}>
          Continue
        </button>
      </div>
    </div>
  );
}
