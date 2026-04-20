import { useState, useMemo, useRef, useEffect } from 'react';
import { useProgressStore } from '../../store/progressStore';
import { useGameStore } from '../../store/gameStore';
import { createPortal } from 'react-dom';
import { getSocket } from '../../services/socketService';
import { useBackButtonClose } from '../../hooks/useBackButtonClose';
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
  // Premium stored in both sessionStorage (for instant UI) AND user stats (server-side source of truth)
  const [hasPremium, setHasPremium] = useState(() => {
    // Check server-side source first (synced from user stats on login), fall back to sessionStorage
    try {
      if (progress?.battlePassPremium) return true;
      return sessionStorage.getItem('app_bp_premium') === 'true';
    } catch { return false; }
  });
  // Server is the source of truth for claimed tiers (user_battle_pass_claims).
  // `progress.battlePassClaimed` is hydrated by durableState on login.
  const claimedTiers = progress?.battlePassClaimed || [];

  const currentXP = progress?.totalXp ?? 0;
  const currentTier = Math.min(TOTAL_TIERS, Math.floor(currentXP / XP_PER_TIER));
  const tierProgress = ((currentXP % XP_PER_TIER) / XP_PER_TIER) * 100;

  // Visible window — show current tier ±5
  const [scrollTier, setScrollTier] = useState(Math.max(1, currentTier - 2));
  const visibleTiers = TIERS.slice(scrollTier - 1, scrollTier + 9);

  // Track active listeners so unmounting mid-claim doesn't leave ghost handlers
  // on the shared socket. Also prevents listener buildup if the user spams Claim.
  const activeListenersRef = useRef(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const sock = getSocket();
      if (sock) {
        activeListenersRef.current.forEach((fn) => sock.off('battlePassTierClaimed', fn));
      }
      activeListenersRef.current.clear();
    };
  }, []);

  // Hardware back button closes the modal (not the app) on Android/iOS
  useBackButtonClose(true, onClose);

  const claimable = useMemo(
    () => TIERS.filter(t => t.tier <= currentTier && !claimedTiers.includes(t.tier)),
    [currentTier, claimedTiers]
  );

  function claimTier(tier) {
    if (claimedTiers.includes(tier)) return;
    const socket = getSocket();
    if (!socket) return;
    // Optimistic: local immediate update; server will re-broadcast durableState
    // on success. On failure, next durableState hydration will correct.
    const onResult = (res) => {
      socket.off('battlePassTierClaimed', onResult);
      activeListenersRef.current.delete(onResult);
      if (!mountedRef.current) return;
      if (!res?.success && res?.error !== 'already_claimed') {
        console.warn('claimBattlePassTier failed:', res?.error);
      }
      // Always refresh from server
      socket.emit('getDurableState', { seasonId: 'season_1_the_river' });
    };
    activeListenersRef.current.add(onResult);
    socket.on('battlePassTierClaimed', onResult);
    socket.emit('claimBattlePassTier', { seasonId: 'season_1_the_river', tierId: tier });
  }

  const [claimingAll, setClaimingAll] = useState(false);

  function claimAll() {
    if (claimingAll) return; // debounce — user can't mash button to spam server
    const socket = getSocket();
    if (!socket) return;
    setClaimingAll(true);
    for (const t of claimable) {
      socket.emit('claimBattlePassTier', { seasonId: 'season_1_the_river', tierId: t.tier });
    }
    const tid = setTimeout(() => {
      socket.emit('getDurableState', { seasonId: 'season_1_the_river' });
      if (mountedRef.current) setClaimingAll(false);
    }, 800);
    // Hook into our unmount cleanup (mounted state already tracked above)
    // via a tiny ref check — if component unmounts first, clear the timer.
    const unmountInterval = setInterval(() => {
      if (!mountedRef.current) {
        clearTimeout(tid);
        clearInterval(unmountInterval);
      }
    }, 200);
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
              <button
                className="bp-claim-all-btn"
                onClick={claimAll}
                disabled={claimingAll}
                style={{ opacity: claimingAll ? 0.6 : 1, cursor: claimingAll ? 'default' : 'pointer' }}
              >
                {claimingAll ? 'Claiming…' : `Claim All (${claimable.length})`}
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
            <button className="bp-upgrade-btn" onClick={() => {
              const socket = typeof getSocket === 'function' ? getSocket() : null;
              // Premium MUST go through the server so Stars get deducted and
              // the entitlement persists. Previously an offline fallback set
              // `app_bp_premium=true` locally — user saw premium UI but server
              // never granted the rewards, causing a sync mismatch on next login.
              if (!socket?.connected) {
                alert('Not connected to server. Please try again when the connection indicator is green.');
                return;
              }
              socket.emit('purchaseBattlePass', {}, (ack) => {
                if (ack?.success) {
                  sessionStorage.setItem('app_bp_premium', 'true');
                  setHasPremium(true);
                } else {
                  alert(ack?.error || 'Purchase failed — not enough Stars');
                }
              });
            }}>
              ⭐ Go Premium · 950 Stars
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
