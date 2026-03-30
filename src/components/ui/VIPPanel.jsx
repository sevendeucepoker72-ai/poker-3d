import { createPortal } from 'react-dom';
import { useProgressStore } from '../../store/progressStore';
import './VIPPanel.css';

const VIP_TIERS = [
  {
    name: 'Bronze',
    minXP: 0,
    maxXP: 999,
    color: '#CD7F32',
    xpRate: '1x',
    perks: ['1x XP rate', 'Standard tables'],
  },
  {
    name: 'Silver',
    minXP: 1000,
    maxXP: 4999,
    color: '#C0C0C0',
    xpRate: '1.5x',
    perks: ['1.5x XP rate', 'Silver nameplate border', 'Priority matchmaking'],
  },
  {
    name: 'Gold',
    minXP: 5000,
    maxXP: 19999,
    color: '#FFD700',
    xpRate: '2x',
    perks: ['2x XP rate', 'Gold nameplate border', 'Exclusive emotes', 'Monthly bonus chips'],
  },
  {
    name: 'Platinum',
    minXP: 20000,
    maxXP: Infinity,
    color: '#B388FF',
    xpRate: '3x',
    perks: ['3x XP rate', 'Platinum nameplate border', 'Priority seating', 'Custom table', 'All exclusive emotes', 'VIP-only tournaments'],
  },
];

function getCurrentTier(xp) {
  for (let i = VIP_TIERS.length - 1; i >= 0; i--) {
    if (xp >= VIP_TIERS[i].minXP) return i;
  }
  return 0;
}

export default function VIPPanel({ onClose }) {
  const progress = useProgressStore((s) => s.progress);
  const currentXP = progress?.xp || 500;
  const tierIndex = getCurrentTier(currentXP);
  const currentTier = VIP_TIERS[tierIndex];
  const nextTier = tierIndex < VIP_TIERS.length - 1 ? VIP_TIERS[tierIndex + 1] : null;

  const progressPct = nextTier
    ? Math.min(100, Math.round(((currentXP - currentTier.minXP) / (nextTier.minXP - currentTier.minXP)) * 100))
    : 100;
  const xpToNext = nextTier ? nextTier.minXP - currentXP : 0;

  return createPortal(
    <div className="vip-overlay" onClick={onClose}>
      <div className="vip-panel" onClick={(e) => e.stopPropagation()}>
        <div className="vip-header">
          <div className="vip-title">VIP Status</div>
          <button className="vip-close" onClick={onClose}>Close</button>
        </div>

        {/* Current Tier Display */}
        <div className="vip-current-tier" style={{ borderColor: currentTier.color }}>
          <div className="vip-tier-badge" style={{ background: currentTier.color, color: '#0a0a1a' }}>
            {currentTier.name}
          </div>
          <div className="vip-xp-info">
            <span className="vip-xp-value" style={{ color: currentTier.color }}>
              {currentXP.toLocaleString()} XP
            </span>
            <span className="vip-xp-rate">{currentTier.xpRate} XP rate</span>
          </div>
          {nextTier && (
            <div className="vip-progress-section">
              <div className="vip-progress-track">
                <div
                  className="vip-progress-fill"
                  style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, ${currentTier.color}, ${nextTier.color})` }}
                />
              </div>
              <div className="vip-progress-label">
                {xpToNext.toLocaleString()} XP to {nextTier.name}
              </div>
            </div>
          )}
          {!nextTier && (
            <div className="vip-max-tier">Maximum tier reached!</div>
          )}
        </div>

        {/* All Tiers */}
        <div className="vip-tiers-list">
          {VIP_TIERS.map((tier, i) => {
            const isCurrent = i === tierIndex;
            const isLocked = i > tierIndex;
            return (
              <div
                key={tier.name}
                className={`vip-tier-card ${isCurrent ? 'vip-tier-card-active' : ''} ${isLocked ? 'vip-tier-card-locked' : ''}`}
                style={{ borderLeftColor: tier.color }}
              >
                <div className="vip-tier-card-header">
                  <span className="vip-tier-name" style={{ color: isLocked ? '#666' : tier.color }}>{tier.name}</span>
                  <span className="vip-tier-range">
                    {tier.maxXP === Infinity
                      ? `${tier.minXP.toLocaleString()}+ XP`
                      : `${tier.minXP.toLocaleString()} - ${tier.maxXP.toLocaleString()} XP`}
                  </span>
                  {isCurrent && <span className="vip-tier-current-badge">Current</span>}
                </div>
                <div className="vip-tier-perks">
                  {tier.perks.map((perk, j) => (
                    <div key={j} className="vip-perk-item">
                      <span className="vip-perk-check" style={{ color: isLocked ? '#444' : tier.color }}>
                        {isLocked ? '\u{25CB}' : '\u{2713}'}
                      </span>
                      <span className={isLocked ? 'vip-perk-locked' : ''}>{perk}</span>
                    </div>
                  ))}
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
