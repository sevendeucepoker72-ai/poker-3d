import { useState, useMemo } from 'react';
import { useProgressStore } from '../../store/progressStore';
import { useGameStore } from '../../store/gameStore';
import { createPortal } from 'react-dom';
import './BattlePass.css';

const SEASON_NAME = 'Season 1: The River';
const TOTAL_TIERS = 50;
const XP_PER_TIER = 500;

// Tier rewards — free track vs premium track
function buildTiers() {
  const tiers = [];
  for (let i = 1; i <= TOTAL_TIERS; i++) {
    const isMilestone = i % 10 === 0;
    const freeReward = i % 10 === 0
      ? { type: 'chips', amount: i * 200, label: `${(i * 200).toLocaleString()} Chips` }
      : i % 5 === 0
        ? { type: 'chips', amount: 500, label: '500 Chips' }
        : { type: 'xp', amount: 100, label: '+100 XP Boost' };

    const premiumReward = isMilestone
      ? i === 10 ? { type: 'cardback', label: 'Dragon Card Back', icon: '🐉' }
        : i === 20 ? { type: 'emote', label: 'Legendary Emote Pack', icon: '✨' }
        : i === 30 ? { type: 'theme', label: 'Neon Vegas Theme', icon: '🎰' }
        : i === 40 ? { type: 'avatar', label: 'Diamond Avatar Frame', icon: '💎' }
        : i === 50 ? { type: 'title', label: '"Season Champion" Title', icon: '🏆' }
        : { type: 'stars', amount: 50, label: '50 Stars' }
      : i % 3 === 0
        ? { type: 'chips', amount: 1000, label: '1,000 Chips', icon: '🪙' }
        : { type: 'stars', amount: 10, label: '10 Stars', icon: '⭐' };

    tiers.push({ tier: i, freeReward, premiumReward, isMilestone });
  }
  return tiers;
}

const TIERS = buildTiers();

export default function BattlePass({ onClose }) {
  const progress = useProgressStore((s) => s.progress);
  const [hasPremium] = useState(() => {
    try { return localStorage.getItem('app_bp_premium') === 'true'; } catch { return false; }
  });
  const [claimedTiers, setClaimedTiers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('app_bp_claimed') || '[]'); } catch { return []; }
  });

  const currentXP = progress?.totalXp ?? 0;
  const currentTier = Math.min(TOTAL_TIERS, Math.floor(currentXP / XP_PER_TIER));
  const tierProgress = ((currentXP % XP_PER_TIER) / XP_PER_TIER) * 100;

  // Visible window — show current tier ±5
  const [scrollTier, setScrollTier] = useState(Math.max(1, currentTier - 2));
  const visibleTiers = TIERS.slice(scrollTier - 1, scrollTier + 9);

  const claimable = useMemo(
    () => TIERS.filter(t => t.tier <= currentTier && !claimedTiers.includes(t.tier)),
    [currentTier, claimedTiers]
  );

  function claimTier(tier) {
    if (!claimedTiers.includes(tier)) {
      const next = [...claimedTiers, tier];
      setClaimedTiers(next);
      localStorage.setItem('app_bp_claimed', JSON.stringify(next));
    }
  }

  function claimAll() {
    const allClaimable = claimable.map(t => t.tier);
    const next = [...new Set([...claimedTiers, ...allClaimable])];
    setClaimedTiers(next);
    localStorage.setItem('app_bp_claimed', JSON.stringify(next));
  }

  return createPortal(
    <div className="bp-overlay" onClick={onClose}>
      <div className="bp-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bp-header">
          <div className="bp-header-left">
            <span className="bp-season-badge">SEASON 1</span>
            <h2 className="bp-title">{SEASON_NAME}</h2>
          </div>
          <div className="bp-header-right">
            {claimable.length > 0 && (
              <button className="bp-claim-all-btn" onClick={claimAll}>
                Claim All ({claimable.length})
              </button>
            )}
            <button className="bp-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Season XP bar */}
        <div className="bp-xp-bar-wrap">
          <div className="bp-xp-bar-labels">
            <span>Tier {currentTier}</span>
            <span>{currentXP.toLocaleString()} XP · {(currentXP % XP_PER_TIER).toLocaleString()} / {XP_PER_TIER} to next tier</span>
            <span>Tier {Math.min(TOTAL_TIERS, currentTier + 1)}</span>
          </div>
          <div className="bp-xp-bar">
            <div className="bp-xp-fill" style={{ width: `${tierProgress}%` }} />
          </div>
        </div>

        {/* Track headers */}
        <div className="bp-tracks-header">
          <div className="bp-track-label bp-track-free">FREE</div>
          <div className="bp-track-tiers-spacer" />
          <div className={`bp-track-label bp-track-premium ${hasPremium ? 'bp-track-premium--owned' : ''}`}>
            PREMIUM {!hasPremium && <span className="bp-upgrade-hint">• Upgrade</span>}
          </div>
        </div>

        {/* Tier rows */}
        <div className="bp-tier-scroll">
          {visibleTiers.map(({ tier, freeReward, premiumReward, isMilestone }) => {
            const unlocked = tier <= currentTier;
            const claimed = claimedTiers.includes(tier);
            const canClaim = unlocked && !claimed;
            return (
              <div key={tier} className={`bp-tier-row ${isMilestone ? 'bp-tier-row--milestone' : ''} ${unlocked ? 'bp-tier-row--unlocked' : ''}`}>
                {/* Free reward */}
                <div className={`bp-reward-cell bp-reward-free ${unlocked ? 'bp-reward--unlocked' : ''} ${claimed ? 'bp-reward--claimed' : ''}`}>
                  <span className="bp-reward-icon">{freeReward.icon || (freeReward.type === 'chips' ? '🪙' : '⚡')}</span>
                  <span className="bp-reward-label">{freeReward.label}</span>
                  {canClaim && <button className="bp-claim-btn" onClick={() => claimTier(tier)}>Claim</button>}
                  {claimed && <span className="bp-claimed-badge">✓</span>}
                </div>

                {/* Tier number */}
                <div className={`bp-tier-num ${tier === currentTier ? 'bp-tier-num--current' : ''} ${isMilestone ? 'bp-tier-num--milestone' : ''}`}>
                  {isMilestone ? <span className="bp-milestone-star">★</span> : null}
                  {tier}
                </div>

                {/* Premium reward */}
                <div className={`bp-reward-cell bp-reward-premium ${hasPremium && unlocked ? 'bp-reward--unlocked' : ''} ${claimed && hasPremium ? 'bp-reward--claimed' : ''} ${!hasPremium ? 'bp-reward--locked' : ''}`}>
                  {!hasPremium && <span className="bp-lock-icon">🔒</span>}
                  <span className="bp-reward-icon">{premiumReward.icon || (premiumReward.type === 'stars' ? '⭐' : '🪙')}</span>
                  <span className="bp-reward-label">{premiumReward.label}</span>
                  {hasPremium && canClaim && <button className="bp-claim-btn bp-claim-btn--premium" onClick={() => claimTier(tier)}>Claim</button>}
                  {hasPremium && claimed && <span className="bp-claimed-badge">✓</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Scroll controls */}
        <div className="bp-scroll-controls">
          <button className="bp-scroll-btn" disabled={scrollTier <= 1} onClick={() => setScrollTier(t => Math.max(1, t - 10))}>◀ Previous</button>
          <span className="bp-scroll-info">Tiers {scrollTier}–{Math.min(TOTAL_TIERS, scrollTier + 9)}</span>
          <button className="bp-scroll-btn" disabled={scrollTier + 9 >= TOTAL_TIERS} onClick={() => setScrollTier(t => Math.min(TOTAL_TIERS - 9, t + 10))}>Next ▶</button>
        </div>

        {/* Upgrade CTA */}
        {!hasPremium && (
          <div className="bp-upgrade-cta">
            <div className="bp-upgrade-text">
              <strong>Upgrade to Premium</strong>
              <span>Unlock exclusive cosmetics, Stars, and milestone rewards for 950 Stars</span>
            </div>
            <button className="bp-upgrade-btn" onClick={() => { localStorage.setItem('app_bp_premium', 'true'); window.location.reload(); }}>
              ⭐ Go Premium · 950 Stars
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
