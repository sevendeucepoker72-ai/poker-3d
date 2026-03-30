import { useGameStore } from '../../store/gameStore';
import './BottomNav.css';

const TABS = [
  { id: 'home', icon: '\u{1F3E0}', label: 'Home' },
  { id: 'play', icon: '\u{1F3AE}', label: 'Play' },
  { id: 'social', icon: '\u{1F465}', label: 'Social' },
  { id: 'profile', icon: '\u{1F464}', label: 'Profile' },
  { id: 'shop', icon: '\u{1F6D2}', label: 'Shop' },
];

export default function BottomNav({ activeTab, onTabChange }) {
  const screen = useGameStore((s) => s.screen);

  // Only show on lobby screen
  if (screen !== 'lobby') return null;

  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`bottom-nav-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className="bottom-nav-icon">{tab.icon}</span>
          <span className="bottom-nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
