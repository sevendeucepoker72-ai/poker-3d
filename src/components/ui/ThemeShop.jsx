import { useProgressStore } from '../../store/progressStore';
import { getSocket } from '../../services/socketService';
import './ThemeShop.css';

export const TABLE_THEMES = {
  classic_blue: {
    id: 'classic_blue',
    name: 'Classic Blue',
    cost: 0,
    felt: '#2874a6',
    rail: '#8B5E3C',
    railInner: '#A0704C',
    accent: '#8B6914',
    bettingLine: '#0f4a6e',
    textColor: '#153a55',
  },
  casino_royale: {
    id: 'casino_royale',
    name: 'Casino Royale',
    cost: 500,
    felt: '#1a5c2a',
    rail: '#8B6914',
    railInner: '#B8860B',
    accent: '#C41E3A',
    bettingLine: '#0d3a18',
    textColor: '#0a2e12',
  },
  midnight_purple: {
    id: 'midnight_purple',
    name: 'Midnight Purple',
    cost: 300,
    felt: '#4a1d6e',
    rail: '#C0C0C0',
    railInner: '#A0A0A0',
    accent: '#9370DB',
    bettingLine: '#2d1045',
    textColor: '#1a0a2e',
  },
  ocean_breeze: {
    id: 'ocean_breeze',
    name: 'Ocean Breeze',
    cost: 400,
    felt: '#1a7a7a',
    rail: '#F5F5F5',
    railInner: '#E0E0E0',
    accent: '#00BCD4',
    bettingLine: '#0d4a4a',
    textColor: '#0a3535',
  },
  royal_gold: {
    id: 'royal_gold',
    name: 'Royal Gold',
    cost: 800,
    felt: '#0a1a3a',
    rail: '#B8860B',
    railInner: '#DAA520',
    accent: '#FFD700',
    bettingLine: '#061228',
    textColor: '#040d1e',
  },
  neon_vegas: {
    id: 'neon_vegas',
    name: 'Neon Vegas',
    cost: 600,
    felt: '#0a0a0a',
    rail: '#1a1a2e',
    railInner: '#222',
    accent: '#00FF66',
    bettingLine: '#001a0d',
    textColor: '#003311',
    glow: true,
  },
};

export default function ThemeShop({ onClose }) {
  const progress = useProgressStore((s) => s.progress);
  const stars = progress?.stars || 0;
  const ownedThemes = progress?.ownedThemes || ['classic_blue'];
  const equippedTheme = progress?.equippedTableTheme || 'classic_blue';

  const handleBuy = (themeId, cost) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('purchaseTheme', { themeId, cost });
    }
  };

  const handleEquip = (themeId) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('equipTheme', { themeId });
    }
  };

  return (
    <div className="theme-shop-overlay" onClick={onClose}>
      <div className="theme-shop-panel" onClick={(e) => e.stopPropagation()}>
        <div className="theme-shop-header">
          <div className="theme-shop-title">Table Themes</div>
          <div className="theme-shop-stars">{stars.toLocaleString()} Stars</div>
          <button className="theme-shop-close" onClick={onClose}>Close</button>
        </div>

        <div className="theme-grid">
          {Object.values(TABLE_THEMES).map((theme) => {
            const owned = ownedThemes.includes(theme.id);
            const equipped = equippedTheme === theme.id;
            const canAfford = stars >= theme.cost;

            return (
              <div
                key={theme.id}
                className={`theme-card ${equipped ? 'equipped' : ''} ${owned ? 'owned' : ''}`}
              >
                <div className={`theme-preview ${theme.glow ? 'theme-neon-glow' : ''}`}>
                  <div className="theme-felt" style={{ background: theme.felt }} />
                  <div className="theme-rail" style={{ background: theme.rail }}>
                    <div className="theme-accent-line" style={{ background: theme.accent }} />
                  </div>
                </div>

                <div className="theme-name">{theme.name}</div>
                <div className={`theme-cost ${theme.cost === 0 ? 'free' : ''}`}>
                  {theme.cost === 0 ? 'Free' : `${theme.cost} Stars`}
                </div>

                {equipped ? (
                  <button className="theme-btn theme-btn-equipped">Equipped</button>
                ) : owned ? (
                  <button className="theme-btn theme-btn-equip" onClick={() => handleEquip(theme.id)}>
                    Equip
                  </button>
                ) : (
                  <button
                    className="theme-btn theme-btn-buy"
                    disabled={!canAfford}
                    onClick={() => handleBuy(theme.id, theme.cost)}
                  >
                    Buy ({theme.cost} Stars)
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
