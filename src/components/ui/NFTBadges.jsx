import React, { useState, useEffect, useCallback } from 'react';
import './NFTBadges.css';

// ===== Badge definitions =====
const BADGE_DEFINITIONS = [
  { id: 'first_win',      name: 'First Blood',      icon: '🎯', rarity: 'common',    description: 'Won first hand' },
  { id: 'royal_flush',    name: 'Royal Flush',      icon: '👑', rarity: 'legendary', description: 'Achieved a Royal Flush' },
  { id: 'hands_1000',     name: 'Veteran',          icon: '🎖',  rarity: 'rare',      description: 'Played 1000 hands' },
  { id: 'streak_10',      name: 'Unstoppable',      icon: '⚡', rarity: 'epic',      description: '10-hand win streak' },
  { id: 'high_roller',    name: 'High Roller',      icon: '💰', rarity: 'rare',      description: 'Won pot over 50K' },
  { id: 'tournament_win', name: 'Champion',         icon: '🏆', rarity: 'epic',      description: 'Won a tournament' },
  { id: 'bluff_caught',   name: 'Caught Bluffing',  icon: '😅', rarity: 'common',    description: 'Bluff was called' },
  { id: 'hands_100',      name: 'Card Shark',       icon: '🃏', rarity: 'common',    description: 'Played 100 hands' },
];

const RARITY_COLORS = {
  common:    '#94A3B8',
  rare:      '#3B82F6',
  epic:      '#A855F7',
  legendary: '#F59E0B',
};

const RARITY_REQUIREMENTS = {
  common:    'Complete common achievements',
  rare:      'Complete rare achievements',
  epic:      'Complete epic achievements',
  legendary: 'Complete legendary achievements',
};

const LS_KEY = 'poker_nft_badges';
const FAKE_WALLET = '0x1a2b...3c4d';

// Generate a random 8-char hex tx hash
function fakeTxHash() {
  return '0x' + Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

// Load minted badges from sessionStorage
function loadMintedBadges() {
  try {
    const raw = sessionStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Save minted badges to sessionStorage
function saveMintedBadges(data) {
  try {
    sessionStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}

// Toast component
function Toast({ message, visible }) {
  return (
    <div className={`nft-toast ${visible ? 'nft-toast-visible' : ''}`}>
      {message}
    </div>
  );
}

// Badge card
function BadgeCard({ badge, state, tokenNumber, txHash, onMint, minting }) {
  const glowColor = RARITY_COLORS[badge.rarity] ?? '#94A3B8';

  return (
    <div
      className={`nft-badge-card rarity-${badge.rarity} ${state === 'locked' ? 'nft-badge-locked' : ''} ${state === 'minted' ? 'nft-badge-minted' : ''}`}
      style={{ '--glow-color': glowColor }}
    >
      {/* Locked overlay */}
      {state === 'locked' && (
        <div className="nft-lock-overlay">
          <span className="nft-lock-icon">🔒</span>
          <span className="nft-lock-text">{RARITY_REQUIREMENTS[badge.rarity]}</span>
        </div>
      )}

      <div className="nft-badge-inner">
        <div className="nft-badge-icon">{badge.icon}</div>
        <div className="nft-badge-name">{badge.name}</div>
        <span className="nft-rarity-pill" style={{ background: glowColor + '22', color: glowColor, borderColor: glowColor + '55' }}>
          {badge.rarity.toUpperCase()}
        </span>
        <div className="nft-badge-description">{badge.description}</div>

        {state === 'minted' && (
          <div className="nft-token-info">
            <span className="nft-token-number">Token #{tokenNumber}</span>
            <span className="nft-tx-hash" title={txHash}>TX: {txHash}</span>
          </div>
        )}

        {state === 'available' && (
          <button
            className="nft-mint-btn"
            onClick={() => onMint(badge.id)}
            disabled={minting === badge.id}
          >
            {minting === badge.id ? (
              <span className="nft-spinner" />
            ) : (
              '🔨 Mint Free'
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ===== Main component =====
export default function NFTBadges({ unlockedAchievementIds = [], onClose }) {
  const [mintedBadges, setMintedBadges] = useState(() => loadMintedBadges());
  const [activeTab, setActiveTab] = useState('minted');
  const [minting, setMinting] = useState(null);   // badge id currently being minted
  const [toast, setToast] = useState({ message: '', visible: false });
  const [tokenCounter, setTokenCounter] = useState(0);

  const unlockedSet = new Set(unlockedAchievementIds);

  // Derive per-badge state
  const categorized = BADGE_DEFINITIONS.map((badge) => {
    if (mintedBadges[badge.id]) return { ...badge, state: 'minted', ...mintedBadges[badge.id] };
    if (unlockedSet.has(badge.id)) return { ...badge, state: 'available' };
    return { ...badge, state: 'locked' };
  });

  const mintedList    = categorized.filter((b) => b.state === 'minted');
  const availableList = categorized.filter((b) => b.state === 'available');
  const lockedList    = categorized.filter((b) => b.state === 'locked');

  useEffect(() => {
    setTokenCounter(mintedList.length);
  }, [mintedList.length]);

  const showToast = useCallback((message) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  }, []);

  function handleMint(badgeId) {
    setMinting(badgeId);
    setTimeout(() => {
      const txHash = fakeTxHash();
      const newMinted = {
        ...mintedBadges,
        [badgeId]: {
          txHash,
          tokenNumber: Object.keys(mintedBadges).length + 1,
          mintedAt: new Date().toISOString(),
        },
      };
      setMintedBadges(newMinted);
      saveMintedBadges(newMinted);
      setMinting(null);
      setActiveTab('minted');
      showToast(`✓ Minted! TX: ${txHash}`);
    }, 1500);
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  function renderTabContent() {
    let list;
    if (activeTab === 'minted')    list = mintedList;
    else if (activeTab === 'available') list = availableList;
    else                           list = lockedList;

    if (list.length === 0) {
      const emptyMessages = {
        minted:    'You have not minted any badges yet. Unlock achievements and mint them here!',
        available: 'No badges available to mint right now. Keep playing to unlock achievements.',
        locked:    'All achievements are unlocked! Amazing!',
      };
      return (
        <div className="nft-empty-state">
          {emptyMessages[activeTab]}
        </div>
      );
    }

    return (
      <div className="nft-badge-grid">
        {list.map((badge) => (
          <BadgeCard
            key={badge.id}
            badge={badge}
            state={badge.state}
            tokenNumber={badge.tokenNumber}
            txHash={badge.txHash}
            onMint={handleMint}
            minting={minting}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="nft-overlay" onClick={handleOverlayClick}>
      <div className="nft-modal" role="dialog" aria-modal="true" aria-label="Achievement NFTs">

        {/* Close button */}
        <button className="nft-close-btn" onClick={onClose} aria-label="Close">×</button>

        {/* Header */}
        <div className="nft-header">
          <div className="nft-title-row">
            <h2 className="nft-title">🏅 Achievement NFTs</h2>
            <div className="nft-chain-label">Chain: Base (Free)</div>
          </div>
          <div className="nft-wallet-row">
            <span className="nft-wallet-icon">👛</span>
            <span className="nft-wallet-address">{FAKE_WALLET}</span>
            <span className="nft-minted-count">{mintedList.length} minted</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="nft-tabs">
          <button
            className={`nft-tab ${activeTab === 'minted' ? 'nft-tab-active' : ''}`}
            onClick={() => setActiveTab('minted')}
          >
            Minted ({mintedList.length})
          </button>
          <button
            className={`nft-tab ${activeTab === 'available' ? 'nft-tab-active' : ''}`}
            onClick={() => setActiveTab('available')}
          >
            Available to Mint ({availableList.length})
          </button>
          <button
            className={`nft-tab ${activeTab === 'locked' ? 'nft-tab-active' : ''}`}
            onClick={() => setActiveTab('locked')}
          >
            Locked ({lockedList.length})
          </button>
        </div>

        {/* Content */}
        <div className="nft-content">
          {renderTabContent()}
        </div>

        {/* Toast notification */}
        <Toast message={toast.message} visible={toast.visible} />

      </div>
    </div>
  );
}
