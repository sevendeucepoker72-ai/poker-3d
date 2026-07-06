import { createPortal } from 'react-dom';
import { useProgressStore } from '../../store/progressStore';
import './UnlocksPanel.css';

// REAL level-reward tiers — these mirror the server's level-gated prestige
// achievements (ProgressionManager ACHIEVEMENTS lvl_25..lvl_1000), which
// actually grant the chips/stars shown here when you reach the level. This
// replaces the old panel that advertised fake perks/gates that were never
// enforced or granted (Blue/Red Felt, VIP Tables, Custom Emotes, etc. — none
// of which existed as real level unlocks).
const LEVEL_REWARDS = [
  { level: 25,   id: 'lvl_25',   icon: '\u{1F948}', name: 'Silver Reached',    chips: 10000,    stars: 50 },
  { level: 75,   id: 'lvl_75',   icon: '\u{1F947}', name: 'Gold Reached',      chips: 30000,    stars: 150 },
  { level: 150,  id: 'lvl_150',  icon: '\u{1F48E}', name: 'Diamond Reached',   chips: 100000,   stars: 400 },
  { level: 300,  id: 'lvl_300',  icon: '\u{2B50}',  name: 'Platinum Reached',  chips: 300000,   stars: 1000 },
  { level: 500,  id: 'lvl_500',  icon: '\u{1F451}', name: 'Master Reached',    chips: 1000000,  stars: 3000 },
  { level: 700,  id: 'lvl_700',  icon: '\u{1F3C6}', name: 'Legendary Reached', chips: 2500000,  stars: 6000 },
  { level: 1000, id: 'lvl_1000', icon: '\u{1F525}', name: 'The Ceiling',       chips: 10000000, stars: 20000 },
];

export default function UnlocksPanel({ onClose }) {
  const progress = useProgressStore((s) => s.progress);
  const currentLevel = progress?.level || 1;
  const earned = progress?.achievements || [];

  return createPortal(
    <div className="unlocks-overlay" onClick={onClose}>
      <div className="unlocks-panel" onClick={(e) => e.stopPropagation()}>
        <div className="unlocks-header">
          <div className="unlocks-title">Level Rewards</div>
          <div className="unlocks-level-badge">Level {currentLevel}</div>
          <button className="unlocks-close" onClick={onClose}>Close</button>
        </div>

        <div className="unlocks-list">
          {LEVEL_REWARDS.map((item) => {
            const reached = currentLevel >= item.level;
            const claimed = earned.includes(item.id);
            const status = claimed ? 'Claimed' : reached ? 'Ready' : `Level ${item.level}`;
            return (
              <div
                key={item.id}
                className={`unlock-item ${reached ? 'unlock-item-unlocked' : 'unlock-item-locked'}`}
              >
                <div className="unlock-level-tag">
                  <span>Lv.{item.level}</span>
                </div>
                <div className={`unlock-icon ${reached ? '' : 'unlock-icon-locked'}`}>
                  {reached ? item.icon : '\u{1F512}'}
                </div>
                <div className="unlock-info">
                  <div className="unlock-name">{item.name}</div>
                  <div className="unlock-desc">
                    {'\u{1FA99}'} {item.chips.toLocaleString()} chips &nbsp;&middot;&nbsp; {'\u{2B50}'} {item.stars.toLocaleString()} stars
                  </div>
                </div>
                <div className={`unlock-status ${reached ? 'unlock-status-yes' : 'unlock-status-no'}`}>
                  {status}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
