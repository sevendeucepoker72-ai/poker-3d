import React, { useState, useEffect, useMemo } from 'react';
import { getSocket } from '../../services/socketService';
import './NFTBadges.css';

// 2026-06-18 — Phase 3e: REAL achievement badges (no crypto). Replaces the
// fake "mint an NFT" veneer (fake wallet / tx hash / "Chain: Base" /
// sessionStorage minting) with the platform's actual durable lifetime
// achievements, served by poker-server. A badge is EARNED automatically the
// moment its achievement unlocks — there is nothing to mint.
//   emit  getAchievements
//   recv  achievementsList { lifetime:[{id,name,description,reward,unlocked,progressMet}], ... }

const RARITY_COLORS = {
  common:    '#94A3B8',
  rare:      '#3B82F6',
  epic:      '#A855F7',
  legendary: '#F59E0B',
};

// Rarity is derived from the achievement's star reward — bigger reward,
// rarer badge. Keeps a single source of truth (the server catalog).
function rarityFor(reward) {
  const stars = reward?.stars || 0;
  if (stars >= 250) return 'legendary';
  if (stars >= 100) return 'epic';
  if (stars >= 25) return 'rare';
  return 'common';
}

// Pick an emoji from the achievement id (the server catalog has no icons).
function iconFor(id) {
  if (id.startsWith('royal')) return '👑';
  if (id.startsWith('straight_flush')) return '🌊';
  if (id.startsWith('quads')) return '🎴';
  if (id.startsWith('full_house')) return '🏠';
  if (id.startsWith('streak')) return '⚡';
  if (id.startsWith('hands')) return '🎖';
  if (id.startsWith('wins')) return '🏅';
  if (id.startsWith('pot')) return '💰';
  if (id.startsWith('bluff')) return '🃏';
  if (id.startsWith('allin')) return '🔥';
  if (id.startsWith('tourney')) return '🏆';
  if (id.startsWith('lvl')) return '⭐';
  if (id.startsWith('social')) return '💬';
  if (id === 'all_variants') return '🎲';
  if (id === 'first_win') return '🎯';
  return '🏅';
}

function BadgeCard({ badge }) {
  const glowColor = RARITY_COLORS[badge.rarity] ?? '#94A3B8';
  const locked = !badge.unlocked;
  return (
    <div
      className={`nft-badge-card rarity-${badge.rarity} ${locked ? 'nft-badge-locked' : 'nft-badge-minted'}`}
      style={{ '--glow-color': glowColor }}
    >
      {locked && (
        <div className="nft-lock-overlay">
          <span className="nft-lock-icon">🔒</span>
          <span className="nft-lock-text">{badge.description}</span>
        </div>
      )}
      <div className="nft-badge-inner">
        <div className="nft-badge-icon">{badge.icon}</div>
        <div className="nft-badge-name">{badge.name}</div>
        <span className="nft-rarity-pill" style={{ background: glowColor + '22', color: glowColor, borderColor: glowColor + '55' }}>
          {badge.rarity.toUpperCase()}
        </span>
        <div className="nft-badge-description">{badge.description}</div>
        {badge.unlocked && (
          <div className="nft-token-info">
            <span className="nft-token-number">✓ Earned</span>
            {badge.reward?.stars ? <span className="nft-tx-hash">+{badge.reward.stars}★</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default function NFTBadges({ socket: socketProp, unlockedAchievementIds = [], onClose }) {
  const socket = socketProp || getSocket();
  const [lifetime, setLifetime] = useState(null); // server catalog | null (loading)
  const [activeTab, setActiveTab] = useState('earned');

  useEffect(() => {
    if (!socket) return undefined;
    const onList = (data) => { if (Array.isArray(data?.lifetime)) setLifetime(data.lifetime); };
    socket.on('achievementsList', onList);
    if (socket.connected) socket.emit('getAchievements');
    return () => socket.off('achievementsList', onList);
  }, [socket]);

  // Build the badge list from the server catalog when available, else fall
  // back to the unlocked-ids hint (so something shows before the socket replies).
  const badges = useMemo(() => {
    const src = lifetime || unlockedAchievementIds.map((id) => ({ id, name: id, description: '', reward: {}, unlocked: true }));
    return src.map((a) => ({
      ...a,
      icon: iconFor(a.id),
      rarity: rarityFor(a.reward),
      unlocked: a.unlocked ?? unlockedAchievementIds.includes(a.id),
    }));
  }, [lifetime, unlockedAchievementIds]);

  const earned = badges.filter((b) => b.unlocked);
  const locked = badges.filter((b) => !b.unlocked);
  const list = activeTab === 'earned' ? earned : locked;

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="nft-overlay" onClick={handleOverlayClick}>
      <div className="nft-modal" role="dialog" aria-modal="true" aria-label="Achievement Badges">
        <button className="nft-close-btn" onClick={onClose} aria-label="Close">×</button>

        {/* Header */}
        <div className="nft-header">
          <div className="nft-title-row">
            <h2 className="nft-title">🏅 Achievement Badges</h2>
            <div className="nft-chain-label">{earned.length} / {badges.length} earned</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="nft-tabs">
          <button
            className={`nft-tab ${activeTab === 'earned' ? 'nft-tab-active' : ''}`}
            onClick={() => setActiveTab('earned')}
          >
            Earned ({earned.length})
          </button>
          <button
            className={`nft-tab ${activeTab === 'locked' ? 'nft-tab-active' : ''}`}
            onClick={() => setActiveTab('locked')}
          >
            Locked ({locked.length})
          </button>
        </div>

        {/* Content */}
        <div className="nft-content">
          {lifetime === null && badges.length === 0 ? (
            <div className="nft-empty-state">Loading badges…</div>
          ) : list.length === 0 ? (
            <div className="nft-empty-state">
              {activeTab === 'earned'
                ? 'No badges earned yet. Keep playing to unlock achievements!'
                : 'Every badge earned. Legendary!'}
            </div>
          ) : (
            <div className="nft-badge-grid">
              {list.map((badge) => <BadgeCard key={badge.id} badge={badge} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
