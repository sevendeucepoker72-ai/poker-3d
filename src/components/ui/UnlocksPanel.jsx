import { createPortal } from 'react-dom';
import { useProgressStore } from '../../store/progressStore';
import './UnlocksPanel.css';

const UNLOCKS = [
  { level: 1, icon: '\u{1F0CF}', name: 'Basic Tables', description: 'Access to standard poker tables' },
  { level: 3, icon: '\u{1F3B4}', name: 'Omaha Tables', description: 'Play Omaha poker variant' },
  { level: 3, icon: '\u{1F535}', name: 'Blue Felt Theme', description: 'Classic blue felt table theme' },
  { level: 5, icon: '\u{1F3C6}', name: 'Tournament Access', description: 'Enter scheduled tournaments' },
  { level: 5, icon: '\u{1F534}', name: 'Red Felt Theme', description: 'Bold red felt table theme' },
  { level: 8, icon: '\u{1F512}', name: 'Private Tables', description: 'Create invite-only tables' },
  { level: 8, icon: '\u{2B50}', name: 'Gold Card Back', description: 'Premium gold card back design' },
  { level: 10, icon: '\u{1F451}', name: 'VIP Tables', description: 'Exclusive high-stakes tables' },
  { level: 10, icon: '\u{1F60E}', name: 'Custom Emotes', description: 'Unique emotes at the table' },
  { level: 15, icon: '\u{1F3A8}', name: 'All Themes Unlocked', description: 'Every table theme available' },
  { level: 20, icon: '\u{1F525}', name: 'Legendary Card Back', description: 'Animated legendary card back' },
];

export default function UnlocksPanel({ onClose }) {
  const progress = useProgressStore((s) => s.progress);
  const currentLevel = progress?.level || 1;

  return createPortal(
    <div className="unlocks-overlay" onClick={onClose}>
      <div className="unlocks-panel" onClick={(e) => e.stopPropagation()}>
        <div className="unlocks-header">
          <div className="unlocks-title">Unlocks</div>
          <div className="unlocks-level-badge">Level {currentLevel}</div>
          <button className="unlocks-close" onClick={onClose}>Close</button>
        </div>

        <div className="unlocks-list">
          {UNLOCKS.map((item, i) => {
            const unlocked = currentLevel >= item.level;
            return (
              <div
                key={i}
                className={`unlock-item ${unlocked ? 'unlock-item-unlocked' : 'unlock-item-locked'}`}
              >
                <div className="unlock-level-tag">
                  <span>Lv.{item.level}</span>
                </div>
                <div className={`unlock-icon ${unlocked ? '' : 'unlock-icon-locked'}`}>
                  {unlocked ? item.icon : '\u{1F512}'}
                </div>
                <div className="unlock-info">
                  <div className="unlock-name">{item.name}</div>
                  <div className="unlock-desc">{item.description}</div>
                </div>
                <div className={`unlock-status ${unlocked ? 'unlock-status-yes' : 'unlock-status-no'}`}>
                  {unlocked ? 'Unlocked' : `Level ${item.level}`}
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
