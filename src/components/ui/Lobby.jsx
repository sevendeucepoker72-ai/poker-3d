import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { useProgressStore } from '../../store/progressStore';
import ProgressBar from './ProgressBar';
import MissionsPanel from './MissionsPanel';
import StatsPanel from './StatsPanel';
import ThemeShop from './ThemeShop';
import BattlePass from './BattlePass';
import RankBadge, { getRankInfo, getNextRankInfo, RANK_TIERS } from './RankBadge';
import CreateTableModal from './CreateTableModal';
import TournamentLobby from './TournamentLobby';
import QualifierLobby from './QualifierLobby';
import Leaderboard from './Leaderboard';
import FriendSystem from './FriendSystem';
import UnlocksPanel from './UnlocksPanel';
import VIPPanel from './VIPPanel';
import LoginRewards from './LoginRewards';
import ThemeToggle from './ThemeToggle';
import NotificationCenter from './NotificationCenter';
import SettingsPanel from './SettingsPanel';
// Modal-only panels — deferred via lazy() + Suspense so the initial Lobby
// chunk drops ~200 KB worth of code the user rarely opens. Each is
// rendered behind a `show*` boolean that's false on mount.
const EquityCalculator    = lazy(() => import('./EquityCalculator'));
const HandRangeChart      = lazy(() => import('../game/HandRangeChart'));
const LeakFinder          = lazy(() => import('./LeakFinder'));
const BankrollGraph       = lazy(() => import('./BankrollGraph'));
const HandQuiz            = lazy(() => import('./HandQuiz'));
const AdvancedAnalytics   = lazy(() => import('./AdvancedAnalytics'));
const StakingMarketplace  = lazy(() => import('./StakingMarketplace'));
const TournamentBracket   = lazy(() => import('./TournamentBracket'));
const TournamentDirector  = lazy(() => import('./TournamentDirector'));
const HandHistoryImporter = lazy(() => import('./HandHistoryImporter'));
const SocialBracket       = lazy(() => import('./SocialBracket'));
const BankrollAI          = lazy(() => import('./BankrollAI'));
const NFTBadges           = lazy(() => import('./NFTBadges'));
const AdminDashboard      = lazy(() => import('./AdminDashboard'));
const ExportData          = lazy(() => import('./ExportData'));
// Kept eager — rendered in the default lobby view, not gated behind a modal.
import ClubsPanel from './ClubsPanel';
import SpinWheel from './SpinWheel';
import ScratchCards from './ScratchCards';
import MultiTableView from './MultiTableView';
import PlayerProfile from './PlayerProfile';
import { getSocket } from '../../services/socketService';
import { PlayerAvatar } from '../../hooks/useAvatar';
import './Lobby.css';

const VARIANT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'holdem', label: "Hold'em" },
  { key: 'omaha', label: 'Omaha' },
  { key: 'short-deck', label: 'Short Deck' },
  { key: 'draw', label: 'Draw' },
  { key: 'stud', label: 'Stud' },
];

const VARIANT_BADGE_COLORS = {
  'texas-holdem': '#4ADE80',
  'omaha': '#F59E0B',
  'omaha-hi-lo': '#F97316',
  'short-deck': '#3B82F6',
  'five-card-draw': '#A855F7',
  'triple-draw': '#8B5CF6',
  'seven-card-stud': '#EF4444',
  'razz': '#EC4899',
};

const ALL_ACHIEVEMENTS = [
  { id: 'first_win', name: 'First Blood', description: 'Win your first hand', icon: '\u{1F3AF}' },
  { id: 'high_roller', name: 'High Roller', description: 'Win a pot over 50,000', icon: '\u{1F4B0}' },
  { id: 'streak_5', name: 'Hot Streak', description: 'Win 5 hands in a row', icon: '\u{1F525}' },
  { id: 'streak_10', name: 'Unstoppable', description: 'Win 10 hands in a row', icon: '\u{26A1}' },
  { id: 'hands_100', name: 'Card Shark', description: 'Play 100 hands', icon: '\u{1F3B4}' },
  { id: 'hands_1000', name: 'Veteran', description: 'Play 1000 hands', icon: '\u{1F396}' },
  { id: 'royal_flush', name: 'Royal Flush!', description: 'Get a Royal Flush', icon: '\u{1F451}' },
  { id: 'bluff_master', name: 'Bluff Master', description: 'Win 10 hands with less than a pair', icon: '\u{1F3AD}' },
  { id: 'all_in_warrior', name: 'All-In Warrior', description: 'Go all-in and win 20 times', icon: '\u{2694}' },
  { id: 'social_butterfly', name: 'Social Butterfly', description: 'Send 50 chat messages', icon: '\u{1F98B}' },
];

const VIP_TIERS = [
  { name: 'Bronze', minXP: 0, color: '#CD7F32', xpRate: '1x' },
  { name: 'Silver', minXP: 1000, color: '#C0C0C0', xpRate: '1.5x' },
  { name: 'Gold', minXP: 5000, color: '#FFD700', xpRate: '2x' },
  { name: 'Platinum', minXP: 20000, color: '#B388FF', xpRate: '3x' },
];

function getVIPTier(xp) {
  for (let i = VIP_TIERS.length - 1; i >= 0; i--) {
    if (xp >= VIP_TIERS[i].minXP) return VIP_TIERS[i];
  }
  return VIP_TIERS[0];
}

function matchesFilter(variant, filter) {
  if (filter === 'all') return true;
  if (filter === 'holdem') return variant === 'texas-holdem';
  if (filter === 'omaha') return variant === 'omaha' || variant === 'omaha-hi-lo';
  if (filter === 'short-deck') return variant === 'short-deck';
  if (filter === 'draw') return variant === 'five-card-draw' || variant === 'triple-draw';
  if (filter === 'stud') return variant === 'seven-card-stud' || variant === 'razz';
  return true;
}

// ─── Animated counter hook ───
function useAnimatedCounter(target, duration = 700) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  useEffect(() => {
    const start = prevRef.current;
    const diff = target - start;
    if (Math.abs(diff) < 2) { setDisplay(target); prevRef.current = target; return; }
    const startTime = performance.now();
    let frame;
    const step = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(start + diff * eased));
      if (t < 1) { frame = requestAnimationFrame(step); }
      else { prevRef.current = target; }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return display;
}

// ─── Featured Table Banner ───
function FeaturedTableBanner({ tables, onSpectate }) {
  const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_COLORS = { s: '#fff', h: '#EF4444', d: '#EF4444', c: '#fff' };

  // Recompute featured table whenever any table's pot or playerCount changes
  // — not just when the list reference changes. Previously an in-place delta
  // that mutated { pot, playerCount } on an existing table element wouldn't
  // invalidate the memo, so the banner showed stale numbers until the next
  // full list replacement.
  const tablesSignature = useMemo(
    () => (tables || []).map(t => `${t.tableId}:${t.pot || 0}:${t.playerCount || 0}:${t.phase || ''}`).join('|'),
    [tables]
  );
  const featured = useMemo(() => {
    if (!tables || tables.length === 0) return null;
    return tables.reduce((best, t) => {
      const score = (t.pot || 0) * 2 + (t.playerCount || 0) * 500;
      const bScore = (best.pot || 0) * 2 + (best.playerCount || 0) * 500;
      return score > bScore ? t : best;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, tablesSignature]);

  if (!featured || (featured.playerCount || 0) < 2) return null;

  const cards = featured.communityCards || [];
  const seatedPlayers = (featured.seats || []).filter(s => s?.playerName);

  return (
    <div className="featured-table-banner">
      <div className="ftb-top">
        <span className="ftb-label">🔥 FEATURED TABLE</span>
        <span className="ftb-phase">{featured.phase || 'Pre-Flop'}</span>
      </div>
      <div className="ftb-name">{featured.tableName || `Table ${featured.tableId?.slice(0,8)}`}</div>
      <div className="ftb-meta">
        <span className="ftb-meta-item">💰 {(featured.pot || 0).toLocaleString()} pot</span>
        <span className="ftb-meta-item">👥 {featured.playerCount}/{featured.maxSeats}</span>
        <span className="ftb-meta-item">🃏 {featured.smallBlind}/{featured.bigBlind} blinds</span>
      </div>
      <div className="ftb-bottom">
        {cards.length > 0 ? (
          <div className="ftb-cards">
            {cards.map((c, i) => {
              const suit = c?.slice(-1);
              const rank = c?.slice(0, -1);
              return <span key={i} className="ftb-card" style={{ color: SUIT_COLORS[suit] || '#fff' }}>{rank}{SUIT_SYMBOLS[suit] || suit}</span>;
            })}
          </div>
        ) : <div className="ftb-no-cards">Waiting for cards…</div>}
        <div className="ftb-avatars">
          {seatedPlayers.slice(0, 6).map((s, i) => (
            <div key={i} className="ftb-avatar" title={s.playerName}>{s.playerName.charAt(0).toUpperCase()}</div>
          ))}
          {seatedPlayers.length > 6 && <div className="ftb-avatar ftb-avatar--more">+{seatedPlayers.length - 6}</div>}
        </div>
        <button className="ftb-spectate-btn" onClick={() => onSpectate(featured.tableId)}>👁 Spectate</button>
      </div>
    </div>
  );
}

// ─── Mission Strip ───
const PLACEHOLDER_MISSIONS = [
  { name: 'Win 3 Hands', progress: 1, target: 3, icon: '🏆', xp: 100 },
  { name: 'Play 10 Hands', progress: 4, target: 10, icon: '🃏', xp: 75 },
  { name: 'Raise 5 Times', progress: 2, target: 5, icon: '⚡', xp: 50 },
];

function MissionStrip({ missions, onOpenMissions }) {
  const now = new Date();
  const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  const hoursLeft = Math.floor((midnight - now) / 3600000);
  const minsLeft = Math.floor(((midnight - now) % 3600000) / 60000);
  const timeStr = hoursLeft > 0 ? `${hoursLeft}h ${minsLeft}m` : `${minsLeft}m`;

  const displayMissions = (missions && missions.length > 0) ? missions.slice(0, 3) : PLACEHOLDER_MISSIONS;

  return (
    <div className="mission-strip">
      <div className="mission-strip-header">
        <span className="mission-strip-title">📋 Daily Missions</span>
        <span className="mission-strip-refresh">Resets in {timeStr}</span>
      </div>
      <div className="mission-strip-scroll">
        {displayMissions.map((m, i) => {
          const pct = Math.min(100, ((m.progress || 0) / (m.target || 1)) * 100);
          const done = pct >= 100;
          return (
            <div key={i} className={`mission-chip ${done ? 'mission-chip--done' : ''}`} onClick={onOpenMissions}>
              <span className="mission-chip-icon">{m.icon || '🎯'}</span>
              <div className="mission-chip-body">
                <div className="mission-chip-name">{m.name}</div>
                <div className="mission-chip-bar-track">
                  <div className="mission-chip-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="mission-chip-prog">{m.progress || 0}/{m.target || 1}</div>
              </div>
              <div className="mission-chip-xp">+{m.xp || 0}<span style={{fontSize:'0.6rem'}}> XP</span></div>
              {done && <div className="mission-chip-check">✓</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sparkline SVG ───
function Sparkline({ data, width = 120, height = 36, color = '#00D9FF' }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const last = data[data.length - 1];
  const isUp = last >= data[0];
  const lineColor = isUp ? '#4ADE80' : '#EF4444';
  const fillId = `sf${Math.random().toString(36).slice(2,6)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={parseFloat(pts.split(' ').pop().split(',')[0])} cy={parseFloat(pts.split(' ').pop().split(',')[1])} r="2.5" fill={lineColor} />
    </svg>
  );
}

// ─── Progress Ring (SVG arc around avatar) ───
function ProgressRing({ pct, size = 56, stroke = 3, color = '#00D9FF', children }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: stroke + 2, borderRadius: '50%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  );
}

// ─── Swipeable Card Deck ───
function SwipeCards({ cards }) {
  const [idx, setIdx] = useState(0);
  const startX = useRef(null);
  const onStart = (clientX) => { startX.current = clientX; };
  const onEnd = (clientX) => {
    if (startX.current === null) return;
    const dx = clientX - startX.current;
    if (Math.abs(dx) > 40) setIdx(i => dx < 0 ? Math.min(i + 1, cards.length - 1) : Math.max(i - 1, 0));
    startX.current = null;
  };
  return (
    <div className="swipe-cards-wrap"
      onMouseDown={e => onStart(e.clientX)}
      onMouseUp={e => onEnd(e.clientX)}
      onTouchStart={e => onStart(e.touches[0].clientX)}
      onTouchEnd={e => onEnd(e.changedTouches[0].clientX)}
    >
      <div className="swipe-cards-track" style={{ transform: `translateX(${-idx * 100}%)` }}>
        {cards.map((card, i) => (
          <div key={i} className="swipe-card-slide">{card}</div>
        ))}
      </div>
      {cards.length > 1 && (
        <div className="swipe-dots">
          {cards.map((_, i) => (
            <button key={i} className={`swipe-dot ${i === idx ? 'active' : ''}`} onClick={() => setIdx(i)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Smart Table Recommendation ───
function RecommendCard({ tables, playerChips, nameInput, connected, onJoin }) {
  const rec = useMemo(() => {
    if (!tables.length || !playerChips) return null;
    const ideal = playerChips / 20;
    const open = tables.filter(t => (t.playerCount || 0) < (t.maxSeats || 9));
    if (!open.length) return null;
    return open.reduce((best, t) => {
      const diff = Math.abs((t.bigBlind || 0) - ideal);
      const bDiff = Math.abs((best.bigBlind || 0) - ideal);
      return diff < bDiff ? t : best;
    });
  }, [tables, playerChips]);

  if (!rec) return null;
  const open = (rec.maxSeats || 9) - (rec.playerCount || 0);
  return (
    <div className="recommend-card">
      <div className="recommend-card-label">💡 Recommended for you</div>
      <div className="recommend-card-body">
        <div className="recommend-card-info">
          <div className="recommend-card-name">{rec.tableName || `Table ${rec.tableId?.slice(0,6)}`}</div>
          <div className="recommend-card-sub">{rec.smallBlind}/{rec.bigBlind} blinds · {open} seat{open !== 1 ? 's' : ''} open · {(rec.minBuyIn || 0).toLocaleString()} min</div>
        </div>
        <button className="recommend-card-btn" onClick={() => onJoin(rec)} disabled={!nameInput.trim() || !connected}>
          Join →
        </button>
      </div>
    </div>
  );
}

// ─── Section Header Component ───
function SectionHeader({ children }) {
  return (
    <div className="lobby-section-header">
      <h2 className="lobby-section-title">{children}</h2>
      <div className="lobby-section-divider" />
    </div>
  );
}

// ─── Seat Selection Overlay Component ───
function SeatPicker({ table, playerName, avatar, onJoin, onClose }) {
  const maxSeats = table.maxSeats || 9;
  const seats = table.seats || [];

  const seatElements = Array.from({ length: maxSeats }, (_, i) => {
    const angle = (Math.PI / 2) - (i * (2 * Math.PI / maxSeats));
    const rx = 140;
    const ry = 100;
    const cx = 200;
    const cy = 150;
    const x = cx + Math.cos(angle) * rx;
    const y = cy - Math.sin(angle) * ry;

    const seatInfo = seats[i];
    const isOccupied = seatInfo && seatInfo.playerName;

    return (
      <div
        key={i}
        onClick={() => !isOccupied && onJoin(i)}
        style={{
          position: 'absolute',
          left: x - 36,
          top: y - 22,
          width: 72,
          height: 44,
          borderRadius: '10px',
          border: isOccupied ? '2px solid #555' : '2px solid #4ADE80',
          background: isOccupied ? 'rgba(60,60,60,0.8)' : 'rgba(34,197,94,0.15)',
          color: isOccupied ? '#999' : '#4ADE80',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isOccupied ? 'not-allowed' : 'pointer',
          fontSize: '0.7rem',
          fontWeight: 600,
          transition: 'all 0.2s',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          if (!isOccupied) {
            e.currentTarget.style.background = 'rgba(34,197,94,0.35)';
            e.currentTarget.style.transform = 'scale(1.08)';
            e.currentTarget.style.boxShadow = '0 0 12px rgba(74,222,128,0.4)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isOccupied) {
            e.currentTarget.style.background = 'rgba(34,197,94,0.15)';
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = 'none';
          }
        }}
      >
        <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>Seat {i + 1}</span>
        {isOccupied ? (
          <span style={{ fontSize: '0.65rem', color: '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 64 }}>
            {seatInfo.playerName}
          </span>
        ) : (
          <span style={{ fontSize: '0.65rem' }}>Open</span>
        )}
      </div>
    );
  });

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #1a1a4e, #0d0d2a)',
          border: '2px solid #4ADE80',
          borderRadius: '20px',
          padding: '30px',
          width: 440,
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ color: '#E0E0E0', margin: '0 0 8px', textAlign: 'center', fontSize: '1.1rem' }}>
          Choose Your Seat
        </h3>
        <p style={{ color: '#8888AA', margin: '0 0 16px', textAlign: 'center', fontSize: '0.8rem' }}>
          {table.tableName || `Table ${table.tableId}`} &mdash; Blinds {table.smallBlind}/{table.bigBlind}
        </p>

        <div style={{
          position: 'relative',
          width: 400,
          height: 300,
          margin: '0 auto',
        }}>
          <div style={{
            position: 'absolute',
            left: 80,
            top: 60,
            width: 240,
            height: 180,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #1e5e3a, #0d3a20)',
            border: '4px solid #7B5230',
            boxShadow: 'inset 0 0 30px rgba(0,0,0,0.3), 0 0 20px rgba(0,0,0,0.4)',
          }}>
            <div style={{
              position: 'absolute',
              inset: 15,
              borderRadius: '50%',
              border: '1px solid rgba(255,215,0,0.15)',
            }} />
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: 'rgba(255,215,0,0.2)',
              fontSize: '0.8rem',
              fontWeight: 700,
              letterSpacing: 2,
            }}>
              AMERICAN PUB POKER
            </div>
          </div>

          {seatElements}
        </div>

        <button
          onClick={onClose}
          style={{
            display: 'block',
            margin: '12px auto 0',
            padding: '8px 24px',
            border: '1px solid #666',
            borderRadius: '8px',
            background: 'transparent',
            color: '#999',
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Inline Friends List (simplified, non-overlay) ───
function InlineFriendsList({ onJoinFriendTable }) {
  const STORAGE_KEY = 'app_poker_friends';
  const DEFAULT_FRIENDS = [
    { id: 1, name: 'AceKiller99', status: 'online', lastSeen: null, tableId: null, tableName: null },
    { id: 2, name: 'BluffQueen', status: 'in-game', lastSeen: null, tableId: 'tbl-001', tableName: 'Table Vegas' },
    { id: 3, name: 'RiverRat42', status: 'online', lastSeen: null, tableId: null, tableName: null },
    { id: 4, name: 'ChipStack_Pro', status: 'offline', lastSeen: '2026-03-27T14:30:00', tableId: null, tableName: null },
    { id: 5, name: 'PocketRockets', status: 'in-game', lastSeen: null, tableId: 'tbl-002', tableName: "High Roller's Den" },
    { id: 6, name: 'FoldEmFiona', status: 'offline', lastSeen: '2026-03-26T22:15:00', tableId: null, tableName: null },
  ];

  const [friends] = useState(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return DEFAULT_FRIENDS;
  });

  const [inviteSent, setInviteSent] = useState(null);

  const statusColors = { online: '#4ADE80', 'in-game': '#FBBF24', offline: '#666' };
  const statusLabels = { online: 'Online', 'in-game': 'In Game', offline: 'Offline' };

  const onlineFriends = friends.filter((f) => f.status === 'online');
  const inGameFriends = friends.filter((f) => f.status === 'in-game');
  const offlineFriends = friends.filter((f) => f.status === 'offline');
  const sortedFriends = [...onlineFriends, ...inGameFriends, ...offlineFriends];

  const handleInvite = (friend) => {
    setInviteSent(friend.id);
    setTimeout(() => setInviteSent(null), 2000);
  };

  return (
    <div className="inline-friends-list">
      <div className="inline-friends-header">
        <span className="inline-friends-online-count">
          {onlineFriends.length + inGameFriends.length} / {friends.length} online
        </span>
      </div>
      {sortedFriends.map((friend) => (
        <div key={friend.id} className="inline-friend-card">
          <div className="inline-friend-avatar" style={{ borderColor: statusColors[friend.status] }}>
            {friend.name.charAt(0).toUpperCase()}
            <span className="inline-friend-dot" style={{ background: statusColors[friend.status] }} />
          </div>
          <div className="inline-friend-info">
            <div className="inline-friend-name">{friend.name}</div>
            <div className="inline-friend-status" style={{ color: statusColors[friend.status] }}>
              {statusLabels[friend.status]}
            </div>
          </div>
          {friend.status === 'online' && (
            <button
              className="inline-friend-invite-btn"
              onClick={() => handleInvite(friend)}
              disabled={inviteSent === friend.id}
            >
              {inviteSent === friend.id ? 'Sent!' : 'Invite'}
            </button>
          )}
          {friend.status === 'in-game' && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
              <span style={{ fontSize: '0.65rem', color: '#FBBF24', maxWidth: 80, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{friend.tableName || 'In Game'}</span>
              {friend.tableId && onJoinFriendTable && (
                <button
                  style={{ fontSize:'0.7rem', padding:'2px 8px', borderRadius:6, border:'1px solid #FBBF24', background:'transparent', color:'#FBBF24', cursor:'pointer' }}
                  onClick={() => onJoinFriendTable(friend.tableId)}
                >Join</button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Inline Leaderboard (simplified, non-overlay) ───
function InlineLeaderboard() {
  const playerName = useGameStore((s) => s.playerName);
  const MOCK_NAMES = [
    'AceKing99', 'PokerShark', 'BluffMaster', 'RiverRat',
    'ChipLeader', 'NutFlush', 'HighRoller', 'PocketRocket',
  ];

  const data = MOCK_NAMES.map((name, i) => ({
    name,
    chipsWon: Math.round((MOCK_NAMES.length - i) * 6000),
    rank: i + 1,
    isCurrentPlayer: false,
  }));
  // Insert player, then SORT by chips desc before assigning ranks.
  // Prior version spliced at index 4 and re-ranked by position, which
  // meant the player at 22,500 got rank #5 while the real #6 at 24,000
  // sat just below — leaderboard positions didn't match the chip order
  // (observed 2026-04-22 audit).
  data.push({
    name: playerName || 'You',
    chipsWon: 22500,
    rank: 0, // placeholder, assigned after sort
    isCurrentPlayer: true,
  });
  data.sort((a, b) => b.chipsWon - a.chipsWon);
  data.forEach((d, i) => d.rank = i + 1);

  const getRankIcon = (rank) => {
    if (rank === 1) return '\u{1F947}';
    if (rank === 2) return '\u{1F948}';
    if (rank === 3) return '\u{1F949}';
    return `#${rank}`;
  };

  return (
    <div className="inline-leaderboard">
      {data.slice(0, 8).map((entry) => (
        <div
          key={entry.rank}
          className={`inline-lb-row ${entry.isCurrentPlayer ? 'inline-lb-row-current' : ''} ${entry.rank <= 3 ? 'inline-lb-row-top' : ''}`}
        >
          <span className="inline-lb-rank">{getRankIcon(entry.rank)}</span>
          <PlayerAvatar playerId={entry.name} name={entry.name} size={24} style={{ flexShrink: 0 }} />
          <span className="inline-lb-name">{entry.name}</span>
          <span className="inline-lb-chips">{entry.chipsWon.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Quick Games Grid (reusable) ───
function QuickGamesGrid({ nameInput, connected, onHeadsUp, onSpinGo, onAllIn }) {
  return (
    <div className="quick-games-grid">
      <div className="quick-game-card quick-game-headsup">
        <div className="quick-game-icon">&#9889;</div>
        <div className="quick-game-info">
          <h3>Heads-Up Snap</h3>
          <p>1v1 | 5 min | Fast blinds</p>
        </div>
        <button
          className="btn-quick-game"
          onClick={onHeadsUp}
          disabled={!nameInput.trim() || !connected}
        >
          Play
        </button>
      </div>
      <div className="quick-game-card quick-game-spin">
        <div className="quick-game-icon">&#127920;</div>
        <div className="quick-game-info">
          <h3>Spin & Go</h3>
          <p>3 players | Random prize up to 25x</p>
        </div>
        <button
          className="btn-quick-game"
          onClick={onSpinGo}
          disabled={!nameInput.trim() || !connected}
        >
          Play
        </button>
      </div>
      <div className="quick-game-card quick-game-allin">
        <div className="quick-game-icon">&#128165;</div>
        <div className="quick-game-info">
          <h3>All-In or Fold</h3>
          <p>Shove or fold | Fast & fun</p>
        </div>
        <button
          className="btn-quick-game"
          onClick={onAllIn}
          disabled={!nameInput.trim() || !connected}
        >
          Play
        </button>
      </div>
    </div>
  );
}

// ─── Table List with Filters ───
const TABLE_PAGE_SIZE = 20;

function TableListSection({ tables, connected, nameInput, variantFilter, setVariantFilter, searchText, setSearchText, stakesFilter, setStakesFilter, seatsFilter, setSeatsFilter, onJoinTable, onWatch, playerChips }) {
  const [hoveredTableId, setHoveredTableId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(TABLE_PAGE_SIZE);
  const [sortBy, setSortBy] = useState('players'); // 'players' | 'pot' | 'blinds'
  const [sortDir, setSortDir] = useState('desc');

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(key); setSortDir('desc'); }
  };

  // Reset visible count when filters change
  useEffect(() => { setVisibleCount(TABLE_PAGE_SIZE); }, [variantFilter, stakesFilter, seatsFilter, searchText, sortBy, sortDir]);

  // Find best-match table for player's stack (#5) — memoized
  const recommendedTable = useMemo(() => {
    if (!playerChips || tables.length === 0) return null;
    const ideal = playerChips / 20;
    let best = null, bestDiff = Infinity;
    tables.forEach(t => {
      const diff = Math.abs((t.bigBlind || 0) - ideal);
      if (diff < bestDiff) { bestDiff = diff; best = t; }
    });
    return best;
  }, [playerChips, tables]);

  // Memoize filtering — only recomputes when tables or filter values change
  const filteredTables = useMemo(() => tables.filter((t) => {
    if (!matchesFilter(t.variant || 'texas-holdem', variantFilter)) return false;
    if (searchText.trim()) {
      const name = (t.tableName || `Table ${t.tableId}`).toLowerCase();
      if (!name.includes(searchText.trim().toLowerCase())) return false;
    }
    if (stakesFilter !== 'all') {
      const bb = t.bigBlind || 0;
      if (stakesFilter === 'micro' && (bb < 2 || bb > 10)) return false;
      if (stakesFilter === 'low' && (bb < 20 || bb > 50)) return false;
      if (stakesFilter === 'medium' && (bb < 100 || bb > 200)) return false;
      if (stakesFilter === 'high' && bb < 400) return false;
    }
    if (seatsFilter !== 'all') {
      const max = t.maxSeats || 9;
      if (seatsFilter === 'full' && (max < 7 || max > 9)) return false;
      if (seatsFilter === 'short' && (max < 5 || max > 6)) return false;
      if (seatsFilter === 'headsup' && max !== 2) return false;
    }
    return true;
  }), [tables, variantFilter, searchText, stakesFilter, seatsFilter]);

  // Sort
  const sortedTables = useMemo(() => {
    const copy = [...filteredTables];
    copy.sort((a, b) => {
      let va, vb;
      if (sortBy === 'players') { va = a.playerCount || 0; vb = b.playerCount || 0; }
      else if (sortBy === 'pot') { va = a.pot || 0; vb = b.pot || 0; }
      else { va = a.bigBlind || 0; vb = b.bigBlind || 0; }
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return copy;
  }, [filteredTables, sortBy, sortDir]);

  // Only render the first N tables — "Show more" loads the next page
  const visibleTables = sortedTables.slice(0, visibleCount);
  const hasMore = visibleCount < filteredTables.length;

  return (
    <div className="table-list">
      <div className="table-filters">
        <div className="table-filters-row">
          <input
            type="text"
            className="table-search-input"
            placeholder="Search tables..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <select className="table-filter-select" value={variantFilter} onChange={(e) => setVariantFilter(e.target.value)}>
            <option value="all">All Variants</option>
            <option value="holdem">Texas Hold'em</option>
            <option value="omaha">Omaha</option>
            <option value="short-deck">Short Deck</option>
            <option value="draw">Draw</option>
            <option value="stud">Stud</option>
          </select>
          <select className="table-filter-select" value={stakesFilter} onChange={(e) => setStakesFilter(e.target.value)}>
            <option value="all">All Stakes</option>
            <option value="micro">Micro (1/2-5/10)</option>
            <option value="low">Low (10/20-25/50)</option>
            <option value="medium">Medium (50/100-100/200)</option>
            <option value="high">High (200/400+)</option>
          </select>
          <select className="table-filter-select" value={seatsFilter} onChange={(e) => setSeatsFilter(e.target.value)}>
            <option value="all">All Seats</option>
            <option value="full">Full (7-9)</option>
            <option value="short">Short (5-6)</option>
            <option value="headsup">Heads-Up (2)</option>
          </select>
        </div>
        <div className="table-filters-tabs">
          {VARIANT_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setVariantFilter(f.key)}
              className={`table-filter-tab ${variantFilter === f.key ? 'active' : ''}`}
            >
              {f.label}
            </button>
          ))}
          <div className="table-sort-group">
            {[['players','👥'],['pot','💰'],['blinds','🃏']].map(([key, icon]) => (
              <button
                key={key}
                className={`table-sort-btn ${sortBy === key ? 'active' : ''}`}
                onClick={() => toggleSort(key)}
              >
                {icon} {key} {sortBy === key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!connected && (
        <div className="table-card" style={{ justifyContent: 'center', color: '#8888AA' }}>
          Connecting to server...
        </div>
      )}
      {connected && filteredTables.length === 0 && (
        <div className="table-card" style={{ justifyContent: 'center', color: '#8888AA' }}>
          No tables available{(variantFilter !== 'all' || stakesFilter !== 'all' || seatsFilter !== 'all' || searchText.trim()) ? ' matching your filters' : ''}. Try Quick Play!
        </div>
      )}
      {visibleTables.map((table) => {
        const isRecommended = recommendedTable?.tableId === table.tableId;
        const isHovered = hoveredTableId === table.tableId;
        const communityCards = table.communityCards || [];
        const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
        const SUIT_COLORS = { s: '#E0E0E0', h: '#EF4444', d: '#EF4444', c: '#E0E0E0' };
        return (
          <div
            key={table.tableId}
            className={`table-card ${isRecommended ? 'table-card--recommended' : ''} ${table.variant ? `table-card--${table.variant}` : 'table-card--texas-holdem'}`}
            onMouseEnter={() => setHoveredTableId(table.tableId)}
            onMouseLeave={() => setHoveredTableId(null)}
            style={{ position: 'relative' }}
          >
            {isRecommended && (
              <span className="table-recommended-badge">⭐ Best Match</span>
            )}
            <div className="table-info">
              <h3>
                {table.tableName || `Table ${table.tableId}`}
                {table.variantName && (
                  <span style={{
                    marginLeft: '8px',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    background: VARIANT_BADGE_COLORS[table.variant] || '#666',
                    color: '#fff',
                    verticalAlign: 'middle',
                  }}>
                    {table.variantName}
                  </span>
                )}
              </h3>
              <div className="table-details">
                <span>Blinds: {table.smallBlind}/{table.bigBlind}</span>
                <span>Min Buy: {(table.minBuyIn || 0).toLocaleString()}</span>
                <span>Players: {table.playerCount}/{table.maxSeats}</span>
                {table.spectatorCount > 0 && (
                  <span style={{ color: '#B388FF' }}>
                    Watching: {table.spectatorCount}
                  </span>
                )}
              </div>
              {/* Mini seat visualization */}
              <div className="table-seat-preview">
                {Array.from({ length: table.maxSeats || 9 }, (_, i) => {
                  const s = (table.seats || [])[i];
                  const isOccupied = !!s?.playerName;
                  return (
                    <div
                      key={i}
                      className={`table-seat-dot ${isOccupied ? 'table-seat-dot--occupied' : ''}`}
                      title={s?.playerName || `Seat ${i + 1} (empty)`}
                    />
                  );
                })}
              </div>
              {/* Hover preview */}
              {isHovered && (
                <div className="table-hover-preview">
                  <div className="thp-row">
                    <span className="thp-label">Phase</span>
                    <span className="thp-val">{table.phase || 'Waiting'}</span>
                    {table.pot > 0 && <><span className="thp-label" style={{marginLeft:8}}>Pot</span><span className="thp-val" style={{color:'#4ADE80'}}>{(table.pot||0).toLocaleString()}</span></>}
                  </div>
                  {/* Seat occupancy bar */}
                  <div className="thp-seats-bar">
                    {Array.from({ length: table.maxSeats || 9 }, (_, i) => {
                      const s = (table.seats || [])[i];
                      return <div key={i} className={`thp-seat-slot ${s?.playerName ? 'thp-seat-slot--taken' : ''}`} title={s?.playerName || 'Empty'}>
                        {s?.playerName ? s.playerName.charAt(0).toUpperCase() : ''}
                      </div>;
                    })}
                  </div>
                  {communityCards.length > 0 ? (
                    <div className="thp-cards">
                      {communityCards.map((c, i) => {
                        const suit = c?.slice(-1);
                        const rank = c?.slice(0, -1);
                        return (
                          <span key={i} className="thp-card" style={{ color: SUIT_COLORS[suit] || '#ffffff' }}>
                            {rank}{SUIT_SYMBOLS[suit] || suit}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="thp-no-cards">No cards dealt yet</div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className="btn-primary"
                onClick={() => onJoinTable(table)}
                disabled={!nameInput.trim() || table.playerCount >= table.maxSeats}
              >
                {table.playerCount >= table.maxSeats ? 'Full' : 'Join'}
              </button>
              <button
                style={{
                  padding: '8px 14px',
                  border: '1px solid #B388FF',
                  borderRadius: '8px',
                  background: 'transparent',
                  color: '#B388FF',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  transition: 'all 0.2s',
                }}
                onClick={() => onWatch(table.tableId)}
              >
                Watch
              </button>
            </div>
          </div>
        );
      })}
      {hasMore && (
        <button
          className="table-show-more-btn"
          onClick={() => setVisibleCount(c => c + TABLE_PAGE_SIZE)}
        >
          Show {Math.min(TABLE_PAGE_SIZE, filteredTables.length - visibleCount)} more tables
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// MAIN LOBBY COMPONENT
// ═══════════════════════════════════════════
export default function Lobby({ activeTab = 'home', onTabChange, pwaAction = null, waitlistContext = null }) {
  const setScreen = useGameStore((s) => s.setScreen);
  const playerName = useGameStore((s) => s.playerName);
  const setPlayerName = useGameStore((s) => s.setPlayerName);
  const chips = useGameStore((s) => s.chips);
  const avatar = useGameStore((s) => s.avatar);

  const logout = useGameStore((s) => s.logout);
  const isLoggedIn = useGameStore((s) => s.isLoggedIn);

  const connected = useTableStore((s) => s.connected);
  const tables = useTableStore((s) => s.tables);
  const requestTableList = useTableStore((s) => s.requestTableList);
  const joinTable = useTableStore((s) => s.joinTable);
  const quickPlay = useTableStore((s) => s.quickPlay);
  const quickHeadsUp = useTableStore((s) => s.quickHeadsUp);
  const quickSpinGo = useTableStore((s) => s.quickSpinGo);
  const quickAllInOrFold = useTableStore((s) => s.quickAllInOrFold);
  const spectateTable = useTableStore((s) => s.spectateTable);
  const gameState = useTableStore((s) => s.gameState);
  const handHistories = useTableStore((s) => s.handHistories);

  const progress = useProgressStore((s) => s.progress);
  // Authoritative chip balance comes from gameStore, which is set from
  // loginResult.userData.chips (the server's DB view). progressStore's
  // `chips` field has a 5000 default that stays until an explicit server
  // push updates it — so a user with a real 0 balance would see "5,000"
  // and try to join tables they can't afford. Prefer the gameStore value
  // whenever it's defined (0 IS a valid value), only falling back to the
  // progressStore if gameStore hasn't been populated yet.
  const chipCount = (typeof chips === 'number') ? chips : (progress?.chips ?? 0);

  const [nameInput, setNameInput] = useState(playerName);

  // #1 (audit) — screen transition race guard.
  // Instead of immediately swapping to 'table' the instant we emit a join
  // message, we show a "Joining table…" overlay and wait for gameState to
  // arrive with our seat populated. If 8s pass with no gameState, we give up
  // and surface an error so the user isn't stranded on a blank spinner.
  const [joining, setJoining] = useState(null); // null | { since: number, label: string }
  const [joinError, setJoinError] = useState(null);
  const beginJoin = (label, action) => {
    setJoinError(null);
    setJoining({ since: Date.now(), label });
    try { action(); } catch (e) {
      setJoining(null);
      setJoinError(e?.message || 'Could not start join — try again.');
    }
  };
  // Watch for gameState with our seat — that's the signal that the server
  // has accepted us and play can begin. `gameState.yourSeat >= 0` with a
  // playerName confirms we're actually seated, not just receiving spectator
  // state or a stale previous-table payload.
  useEffect(() => {
    if (!joining) return;
    const seated = gameState?.yourSeat >= 0 && gameState?.seats?.[gameState.yourSeat]?.playerName;
    if (seated) {
      setJoining(null);
      setJoinError(null);
      setScreen('table');
    }
  }, [joining, gameState, setScreen]);
  useEffect(() => {
    if (!joining) return;
    const id = setTimeout(() => {
      setJoining(null);
      setJoinError('Server didn\'t respond in time. Check your connection and try again.');
    }, 8000);
    return () => clearTimeout(id);
  }, [joining]);

  // Listen for server `error` events while the join spinner is up — if the
  // server rejects the join (insufficient chips, table full, variant
  // mismatch, banned, etc.) surface the REAL message immediately instead of
  // making the user wait 8s for the generic watchdog. joinError is also set
  // from `joinError` events (private-table invite path).
  useEffect(() => {
    if (!joining) return;
    const socket = getSocket();
    if (!socket) return;
    const onServerError = (err) => {
      if (!err) return;
      setJoining(null);
      setJoinError(err.message || 'Server rejected the join.');
    };
    socket.on('error', onServerError);
    socket.on('joinError', onServerError);
    return () => {
      socket.off('error', onServerError);
      socket.off('joinError', onServerError);
    };
  }, [joining]);

  // Session tracker
  const sessionStartRef = useRef(Date.now());
  const sessionStartChipsRef = useRef(null);
  const [sessionHands, setSessionHands] = useState(0);
  const [sessionNet, setSessionNet] = useState(0);
  const prevHandCountRef = useRef(0);
  useEffect(() => {
    const count = handHistories?.length || 0;
    if (count > prevHandCountRef.current) setSessionHands(s => s + (count - prevHandCountRef.current));
    prevHandCountRef.current = count;
  }, [handHistories]);

  // Track session net chips (initialise once chips are known)
  useEffect(() => {
    if (sessionStartChipsRef.current === null && chipCount > 0) {
      sessionStartChipsRef.current = chipCount;
    } else if (sessionStartChipsRef.current !== null) {
      setSessionNet(chipCount - sessionStartChipsRef.current);
    }
  }, [chipCount]);

  // Achievement toast
  const [achievementToast, setAchievementToast] = useState(null);
  const prevAchievementsRef = useRef(null);
  useEffect(() => {
    const current = progress?.achievements || [];
    if (prevAchievementsRef.current === null) { prevAchievementsRef.current = current; return; }
    const newOnes = current.filter(id => !prevAchievementsRef.current.includes(id));
    if (newOnes.length > 0) {
      const achData = ALL_ACHIEVEMENTS.find(a => a.id === newOnes[0]);
      if (achData) {
        setAchievementToast(achData);
        setTimeout(() => setAchievementToast(null), 4000);
      }
    }
    prevAchievementsRef.current = current;
  }, [progress?.achievements]);

  // Return player detection (last session > 24h ago)
  const [isReturningPlayer] = useState(() => {
    try {
      const last = sessionStorage.getItem('app_poker_last_session');
      if (!last) { sessionStorage.setItem('app_poker_last_session', Date.now().toString()); return false; }
      const diff = Date.now() - parseInt(last, 10);
      sessionStorage.setItem('app_poker_last_session', Date.now().toString());
      return diff > 24 * 60 * 60 * 1000;
    } catch { return false; }
  });
  const [returnBannerDismissed, setReturnBannerDismissed] = useState(false);

  // Daily bonus claimed state
  const [dailyBonusClaimed, setDailyBonusClaimed] = useState(() => {
    try {
      const raw = sessionStorage.getItem('app_poker_login_rewards');
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const stored = raw ? JSON.parse(raw) : null;
      return !!(stored && stored.lastClaimDate === todayStr);
    } catch { return false; }
  });

  // #8 sticky quick play
  const quickPlayRef = useRef(null);
  const [showStickyPlay, setShowStickyPlay] = useState(false);
  useEffect(() => {
    const el = quickPlayRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setShowStickyPlay(!e.isIntersecting), { threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [activeTab]);

  // #3 — chip count animation
  const chipsPrevRef = useRef(null);
  const [chipsPulse, setChipsPulse] = useState(false);
  useEffect(() => {
    if (chipsPrevRef.current !== null && chipCount > chipsPrevRef.current) {
      setChipsPulse(true);
      setTimeout(() => setChipsPulse(false), 800);
    }
    chipsPrevRef.current = chipCount;
  }, [chipCount]);

  // #1 — activity ticker events
  const ACTIVITY_EVENTS = [
    '🏆 AceKing99 won 14,200 chips at Table Vegas',
    '🃏 BluffMaster hit a straight flush!',
    '⚡ HighRoller went all-in and doubled up',
    '🎯 PocketRocket won 3 hands in a row',
    '💰 New table: NL 50/100 — 3 seats open',
    '🔥 RiverRat is on a 7-hand win streak',
    '🎲 Spin & Go jackpot: 25x multiplier hit!',
    '♠ ChipLeader eliminated 4 players in tournament',
    '🚀 NutFlush took down the main pot with a bluff',
    '🎁 Daily bonus claimed by 42 players today',
  ];
  const [activityIdx, setActivityIdx] = useState(0);
  const [activityFading, setActivityFading] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      setActivityFading(true);
      setTimeout(() => {
        setActivityIdx(i => (i + 1) % ACTIVITY_EVENTS.length);
        setActivityFading(false);
      }, 400);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const [showStats, setShowStats] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showUnlocks, setShowUnlocks] = useState(false);
  const [showVIP, setShowVIP] = useState(false);
  const [showBattlePass, setShowBattlePass] = useState(false);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [showLoginRewards, setShowLoginRewards] = useState(false);
  const [loginRewardsAutoOpened, setLoginRewardsAutoOpened] = useState(false);
  const [variantFilter, setVariantFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [stakesFilter, setStakesFilter] = useState('all');
  const [seatsFilter, setSeatsFilter] = useState('all');
  const [seatPickerTable, setSeatPickerTable] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showEquityCalc, setShowEquityCalc] = useState(false);
  const [showRangeChart, setShowRangeChart] = useState(false);
  const [showHandQuiz, setShowHandQuiz] = useState(false);
  const [showClubs, setShowClubs] = useState(false);
  const [showLeakFinder, setShowLeakFinder] = useState(false);
  const [showBankrollGraph, setShowBankrollGraph] = useState(false);
  const [showSpinWheel, setShowSpinWheel] = useState(false);
  const [showScratchCards, setShowScratchCards] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [showExportData, setShowExportData] = useState(false);
  const [showAdvancedAnalytics, setShowAdvancedAnalytics] = useState(false);
  const [showStakingMarketplace, setShowStakingMarketplace] = useState(false);
  const [showTournamentBracket, setShowTournamentBracket] = useState(false);
  const [showTournamentDirector, setShowTournamentDirector] = useState(false);
  const [showHandHistoryImporter, setShowHandHistoryImporter] = useState(false);
  const [showMultiTable, setShowMultiTable] = useState(false);
  const [showSocialBracket, setShowSocialBracket] = useState(false);
  const [showBankrollAI, setShowBankrollAI] = useState(false);
  const [showPlayerProfile, setShowPlayerProfile] = useState(false);
  const [showNFTBadges, setShowNFTBadges] = useState(false);

  // Player search state
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');
  const [playerSearchResults, setPlayerSearchResults] = useState([]);
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);
  const playerSearchTimerRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handleResults = ({ results }) => {
      setPlayerSearchResults(results || []);
      setPlayerSearchLoading(false);
    };
    socket.on('playerSearchResults', handleResults);
    return () => socket.off('playerSearchResults', handleResults);
  }, []);

  const handlePlayerSearch = useCallback((val) => {
    setPlayerSearchQuery(val);
    clearTimeout(playerSearchTimerRef.current);
    if (val.trim().length < 2) { setPlayerSearchResults([]); setPlayerSearchLoading(false); return; }
    setPlayerSearchLoading(true);
    playerSearchTimerRef.current = setTimeout(() => {
      // getSocket() is intentionally called INSIDE the setTimeout so if the
      // socket reconnects between the debounce start and its fire, we use
      // the current module-level socket — not a captured stale reference.
      // Do not hoist `const sock = getSocket()` outside the timer.
      const socket = getSocket();
      socket?.emit('searchPlayers', { query: val.trim() });
    }, 350);
  }, []);

  // Request table list on mount and when connected
  useEffect(() => {
    if (connected) {
      requestTableList();
      const interval = setInterval(requestTableList, 5000);
      return () => clearInterval(interval);
    }
  }, [connected, requestTableList]);

  // Auto-show login rewards if today's reward hasn't been claimed.
  // Respects a per-day "dismissed" flag in sessionStorage so closing the
  // modal without claiming doesn't keep reopening it every time the
  // lobby re-mounts (observed 2026-04-22: modal re-appeared aggressively
  // across navigations). The dismissed flag is sessionStorage-scoped so
  // it resets when the browser closes — by tomorrow the modal will
  // re-prompt (since the date rolls over too).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('app_poker_login_rewards');
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const stored = raw ? JSON.parse(raw) : null;
      const dismissedToday = sessionStorage.getItem('app_poker_login_rewards_dismissed') === todayStr;
      if ((!stored || stored.lastClaimDate !== todayStr) && !dismissedToday) {
        setShowLoginRewards(true);
        setLoginRewardsAutoOpened(true);
      }
    } catch { /* ignore */ }
  }, []);

  // Auto-show daily spin wheel once per day until the user spins.
  // Runs AFTER the login rewards timer (6s offset) so the two don't
  // stack on top of each other on first login. Locks via localStorage
  // so "once per day" survives refresh inside the day. Spin completion
  // also writes this key (see SpinWheel) so a successful spin clears
  // the auto-open for the rest of the day.
  useEffect(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    let spunToday = false;
    try {
      spunToday = localStorage.getItem('app_poker_last_spin_date') === todayStr;
    } catch { /* ignore */ }
    if (spunToday) return;
    const t = setTimeout(() => setShowSpinWheel(true), 6000);
    return () => clearTimeout(t);
  }, []);

  // Listen for bottom nav actions (legacy support)
  useEffect(() => {
    const handler = (e) => {
      const tab = e.detail?.tab;
      if (tab && onTabChange) {
        onTabChange(tab);
      }
    };
    window.addEventListener('bottomNavAction', handler);
    return () => window.removeEventListener('bottomNavAction', handler);
  }, [onTabChange]);

  const handleJoinTable = (table) => {
    if (!nameInput.trim()) return;
    // Try preferred seat first (#14)
    try {
      const prefKey = `app_poker_prefSeat_${table.tableName || table.tableId}`;
      const savedSeat = sessionStorage.getItem(prefKey);
      if (savedSeat !== null) {
        const seatIdx = parseInt(savedSeat, 10);
        const seats = table.seats || [];
        const isTaken = seats[seatIdx] && seats[seatIdx].playerName;
        if (!isTaken && seatIdx >= 0 && seatIdx < (table.maxSeats || 9)) {
          setPlayerName(nameInput.trim());
          beginJoin('Joining table…', () => {
            // Pass expectedVariant so the server rejects the join (instead of
            // silently seating) if the table's variant has drifted from the
            // list view the user tapped.
            joinTable(table.tableId, nameInput.trim(), seatIdx, table.minBuyIn || 1000, avatar, table.variant || 'texas-holdem');
          });
          return;
        }
      }
    } catch { /* ignore, fall through to seat picker */ }
    setSeatPickerTable(table);
  };

  const handleSeatSelected = (seatIndex) => {
    if (!nameInput.trim() || !seatPickerTable) return;
    setPlayerName(nameInput.trim());
    // Save preferred seat for this table (#14)
    try {
      const prefKey = `app_poker_prefSeat_${seatPickerTable.tableName || seatPickerTable.tableId}`;
      sessionStorage.setItem(prefKey, String(seatIndex));
    } catch { /* ignore */ }
    const tbl = seatPickerTable;
    setSeatPickerTable(null);
    beginJoin('Joining table…', () => {
      joinTable(tbl.tableId, nameInput.trim(), seatIndex, tbl.minBuyIn || 1000, avatar);
    });
  };

  // Auto-trigger PWA shortcut action once connected + name is set
  useEffect(() => {
    if (!pwaAction || !connected || !nameInput.trim()) return;
    const name = nameInput.trim();
    setPlayerName(name);
    if (pwaAction === 'quickplay') beginJoin('Finding a game…', () => quickPlay(name, avatar));
    else if (pwaAction === 'spingo') beginJoin('Finding a Spin & Go…', () => quickSpinGo(name, avatar));
  }, [pwaAction, connected, nameInput]); // eslint-disable-line

  const handleQuickPlay = () => {
    if (!nameInput.trim()) return;
    setPlayerName(nameInput.trim());
    beginJoin('Finding a game…', () => quickPlay(nameInput.trim(), avatar));
  };

  const handleQuickHeadsUp = () => {
    if (!nameInput.trim()) return;
    setPlayerName(nameInput.trim());
    beginJoin('Finding a heads-up match…', () => quickHeadsUp(nameInput.trim()));
  };

  const handleQuickSpinGo = () => {
    if (!nameInput.trim()) return;
    setPlayerName(nameInput.trim());
    beginJoin('Finding a Spin & Go…', () => quickSpinGo(nameInput.trim()));
  };

  const handleQuickAllInOrFold = () => {
    if (!nameInput.trim()) return;
    setPlayerName(nameInput.trim());
    beginJoin('Finding an All-In or Fold game…', () => quickAllInOrFold(nameInput.trim()));
  };

  const handleWatch = (tableId) => {
    // Spectator mode doesn't produce a `yourSeat` so we DO transition directly.
    spectateTable(tableId);
    setScreen('table');
  };

  const winRate = progress?.winRate ?? 0;
  const handsToday = progress?.handsToday ?? 0;
  const currentStreak = progress?.currentStreak ?? 0;
  const bestHand = progress?.bestHand || 'None yet';
  const biggestPot = progress?.biggestPot ?? 0;
  const currentLevel = progress?.level ?? 1;
  const currentXP = progress?.xp ?? 0;
  const xpToNextLevel = progress?.xpToNextLevel ?? 140;
  const xpPercent = xpToNextLevel > 0 ? Math.min((currentXP / xpToNextLevel) * 100, 100) : 0;
  const starCount = progress?.stars || 0;
  const vipTier = getVIPTier(currentXP);

  // Animated chip counter
  const animatedChips = useAnimatedCounter(chipCount);

  // 7-day sparkline — real data from dailyChipHistory, padded with current chips
  const sparklineData = useMemo(() => {
    const history = progress?.dailyChipHistory || [];
    const points = history.slice(-7).map(h => h.chips);
    // Pad to 7 points if not enough history
    while (points.length < 7) points.unshift(points[0] ?? chipCount ?? 5000);
    return points;
  }, [progress?.dailyChipHistory, chipCount]);

  // Rank info for home tab widget
  const homeRankInfo = useMemo(() => {
    const elo = progress?.elo ?? 500;
    const rankName = progress?.rank ?? 'Silver I';
    const info = getRankInfo(rankName);
    const nextInfo = getNextRankInfo(rankName);
    const currentMin = info.min;
    const nextMin = nextInfo ? nextInfo.min : info.min + 200;
    const pct = nextInfo ? Math.min(100, ((elo - currentMin) / (nextMin - currentMin)) * 100) : 100;
    const eloToNext = nextInfo ? Math.max(0, nextMin - elo) : 0;
    return { elo, rankName, info, nextInfo, pct, eloToNext, rankedWins: progress?.rankedWins ?? 0, rankedLosses: progress?.rankedLosses ?? 0 };
  }, [progress]);

  // Live total players online across all tables
  const totalPlayersOnline = useMemo(() => tables.reduce((sum, t) => sum + (t.playerCount || 0), 0), [tables]);

  // #8 — resume: player is still seated
  const isSeated = gameState?.yourSeat >= 0 && gameState?.seats?.[gameState.yourSeat]?.playerName;

  // #9 — chip tier for avatar glow
  const chipTier = chipCount >= 1000000 ? 'legendary' : chipCount >= 100000 ? 'gold' : chipCount >= 10000 ? 'silver' : 'bronze';

  // Achievements
  const unlockedAchievements = progress?.achievements || [];
  const achievementsWithStatus = ALL_ACHIEVEMENTS.map((a) => ({
    ...a,
    unlocked: unlockedAchievements.includes(a.id),
  }));

  // ─── Tab Content Renderers ───

  const renderHomeTab = () => {
    // Swipeable card 1: Player card with progress ring + sparkline
    const playerCard = (
      <div className="lobby-player-card lobby-player-card--unified">
        <div className="upc-top">
          {/* Avatar with XP progress ring (upgrade #2) */}
          <ProgressRing pct={xpPercent} size={58} stroke={3} color={homeRankInfo.info.color}>
            <div
              className={`lobby-player-avatar lobby-player-avatar--${chipTier} upc-avatar-inner`}
              style={avatar?.seatColor ? { background: avatar.seatColor } : avatar?.skinTone ? { background: avatar.skinTone } : {}}
            >
              {avatar?.photo
                ? <img src={avatar.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' }} />
                : (nameInput || 'P').charAt(0).toUpperCase()
              }
            </div>
          </ProgressRing>
          <div className="upc-identity">
            <input className="upc-name-input" value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Your name" maxLength={20} />
            <div className="upc-level-row">
              <span className="lobby-player-level">Level {currentLevel}</span>
              <span className="upc-xp">{currentXP.toLocaleString()} / {xpToNextLevel.toLocaleString()} XP</span>
            </div>
          </div>
          <div className="upc-resources">
            <span className={`lobby-player-chips ${chipsPulse ? 'lobby-chips--pulse' : ''}`}>🪙 {chipCount.toLocaleString()}</span>
            {starCount > 0 && <span className="lobby-player-stars">⭐ {starCount.toLocaleString()}</span>}
          </div>
        </div>
        <div className="upc-stats">
          <div className="stat-chip"><span className="stat-icon">🎯</span><span className="stat-value">{winRate}%</span><span className="stat-label">Win</span></div>
          <div className="stat-chip"><span className="stat-icon">🤚</span><span className="stat-value">{handsToday}</span><span className="stat-label">Today</span></div>
          <div className="stat-chip"><span className="stat-icon">🔥</span><span className="stat-value">{currentStreak}W</span><span className="stat-label">Streak</span></div>
          {biggestPot > 0 && <div className="stat-chip"><span className="stat-icon">💰</span><span className="stat-value">{biggestPot >= 1000 ? `${(biggestPot/1000).toFixed(1)}k` : biggestPot}</span><span className="stat-label">Best</span></div>}
        </div>
        {/* Sparkline (upgrade #1) */}
        <div className="upc-sparkline">
          <span className="upc-sparkline-label">7-day</span>
          <Sparkline data={sparklineData} width={110} height={32} />
          <span className="upc-sparkline-trend" style={{ color: sparklineData[6] >= sparklineData[0] ? '#4ADE80' : '#EF4444' }}>
            {sparklineData[6] >= sparklineData[0] ? '▲' : '▼'} {sparklineData[0] > 0 ? Math.abs(Math.round((sparklineData[6] - sparklineData[0]) / sparklineData[0] * 100)) : 0}%
          </span>
        </div>
      </div>
    );

    // Swipeable card 2: Rank ELO card (upgrade #5)
    const rankCard = (
      <div className="lobby-player-card lobby-player-card--unified rank-card">
        <div className="rank-card-header">
          <span style={{ fontSize: '2rem' }}>{homeRankInfo.info.icon}</span>
          <div className="rank-card-title">
            <div style={{ color: homeRankInfo.info.color, fontWeight: 700, fontSize: '1.1rem' }}>{homeRankInfo.rankName}</div>
            <div style={{ color: '#aaaaaa', fontSize: '0.75rem' }}>{homeRankInfo.elo} ELO · {homeRankInfo.rankedWins}W {homeRankInfo.rankedLosses}L</div>
          </div>
          <div className="rank-card-elo">{homeRankInfo.elo}</div>
        </div>
        <div className="rank-card-bar-track">
          <div className="rank-card-bar-fill" style={{ width: `${homeRankInfo.pct}%`, background: `linear-gradient(90deg, ${homeRankInfo.info.color}88, ${homeRankInfo.info.color})` }} />
        </div>
        {homeRankInfo.nextInfo ? (
          <div className="rank-card-next">{homeRankInfo.eloToNext} ELO to <strong style={{ color: homeRankInfo.info.color }}>{homeRankInfo.nextInfo.name}</strong></div>
        ) : (
          <div className="rank-card-next" style={{ color: homeRankInfo.info.color }}>MAX RANK — Champion 🏆</div>
        )}
        {/* Mini sparkline repurposed as ELO history placeholder */}
        <div className="upc-sparkline" style={{ marginTop: 8 }}>
          <span className="upc-sparkline-label">ELO trend</span>
          <Sparkline data={(() => { const eh = progress?.eloHistory || []; const pts = eh.slice(-7).map(h => h.elo); while (pts.length < 7) pts.unshift(pts[0] ?? progress?.elo ?? 500); return pts; })()} width={110} height={28} />
        </div>
      </div>
    );

    // Swipeable card 3: Session stats (upgrade #4)
    const sessionCard = (
      <div className="lobby-player-card lobby-player-card--unified session-card">
        <div className="session-card-header">⏱ This Session</div>
        <div className="session-card-stats">
          <div className="session-stat">
            <div className="session-stat-val">{sessionHands}</div>
            <div className="session-stat-label">Hands</div>
          </div>
          <div className="session-stat">
            <div className="session-stat-val" style={{ color: sessionNet >= 0 ? '#4ADE80' : '#EF4444' }}>
              {sessionNet >= 0 ? '+' : ''}{sessionNet.toLocaleString()}
            </div>
            <div className="session-stat-label">Net chips</div>
          </div>
          <div className="session-stat">
            <div className="session-stat-val">{Math.floor((Date.now() - sessionStartRef.current) / 60000)}m</div>
            <div className="session-stat-label">Played</div>
          </div>
        </div>
        {sessionHands === 0 && <div className="session-card-empty">Play a hand to start tracking this session</div>}
      </div>
    );

    return (
    <div className="lobby-tab-content lobby-tab-fade lobby-home-layout" key="home">
      {/* Achievement toast (upgrade #6) */}
      {achievementToast && (
        <div className="achievement-toast">
          <span className="achievement-toast-icon">{achievementToast.icon}</span>
          <div className="achievement-toast-body">
            <div className="achievement-toast-title">Achievement Unlocked!</div>
            <div className="achievement-toast-name">{achievementToast.name}</div>
          </div>
          <button className="achievement-toast-close" onClick={() => setAchievementToast(null)}>✕</button>
        </div>
      )}

      {/* ── LEFT COLUMN ── */}
      <div className="lobby-home-main">

        {/* Return player banner (upgrade #8) */}
        {isReturningPlayer && !returnBannerDismissed && (
          <div className="return-banner">
            <span className="return-banner-icon">👋</span>
            <div className="return-banner-text">
              <div className="return-banner-title">Welcome back, {nameInput || 'Player'}!</div>
              <div className="return-banner-sub">You last played over 24h ago · {chipCount.toLocaleString()} chips waiting</div>
            </div>
            <button className="return-banner-dismiss" onClick={() => setReturnBannerDismissed(true)}>✕</button>
          </div>
        )}

        {/* Featured Table Banner */}
        <FeaturedTableBanner tables={tables} onSpectate={handleWatch} />

        {/* Daily Bonus Banner */}
        {!dailyBonusClaimed && (
          <div className="daily-bonus-banner" onClick={() => { setShowLoginRewards(true); setLoginRewardsAutoOpened(false); }}>
            <span className="daily-bonus-icon">🎁</span>
            <div className="daily-bonus-text">
              <div className="daily-bonus-title">Daily Bonus Ready!</div>
              <div className="daily-bonus-sub">Tap to claim your reward</div>
            </div>
            <button className="daily-bonus-btn" onClick={(e) => { e.stopPropagation(); setShowLoginRewards(true); setLoginRewardsAutoOpened(false); setDailyBonusClaimed(true); }}>Claim</button>
          </div>
        )}

        {/* Mission Strip */}
        <MissionStrip missions={progress?.missions} onOpenMissions={() => {}} />

        {/* Swipeable cards: player / rank / session (upgrades #1 #2 #4 #5 #9) */}
        <SwipeCards cards={[playerCard, rankCard, sessionCard]} />

        {/* Smart recommendation (upgrade #3) */}
        <RecommendCard tables={tables} playerChips={chipCount} nameInput={nameInput} connected={connected} onJoin={handleJoinTable} />

        {/* Hero CTA block */}
        <div className="lobby-cta-block" ref={quickPlayRef}>
          {isSeated ? (
            <button className="btn-resume btn-resume--hero" onClick={() => setScreen('table')}>
              ↩ Return to Table
            </button>
          ) : (
            <button className="btn-quick-play btn-quick-play--hero" onClick={handleQuickPlay} disabled={!nameInput.trim() || !connected}>
              ⚡ QUICK PLAY
            </button>
          )}
          <div className="lobby-cta-secondary">
            <button className="btn-accent" onClick={() => setScreen('customizer')}>Customize Avatar</button>
            <button className="btn-career" onClick={() => setScreen('career')}>Career Mode</button>
          </div>
        </div>

        {/* #6 Recent Hands — always visible */}
        <div className="recent-hands-widget">
          <div className="recent-hands-header">
            <span className="recent-hands-title">🕐 Recent Hands</span>
            {handHistories && handHistories.length > 0 && (
              <span className="recent-hands-count">{handHistories.length} played</span>
            )}
          </div>
          {handHistories && handHistories.length > 0 ? (
            <div className="recent-hands-list">
              {handHistories.slice().reverse().slice(0, 3).map((h, i) => {
                const myResult = h.winners?.find(w => w.seatIndex === h.yourSeat);
                const won = !!myResult;
                const amount = myResult?.chipsWon || 0;
                const handName = myResult?.handName || (won ? 'Winner' : 'Folded');
                return (
                  <div key={i} className={`recent-hand-item ${won ? 'rhi--win' : 'rhi--loss'}`}>
                    <span className="rhi-icon">{won ? '🏆' : '📉'}</span>
                    <div className="rhi-info">
                      <span className="rhi-hand">{handName}</span>
                      <span className="rhi-table">{h.tableName || 'Table'}</span>
                    </div>
                    <span className="rhi-amount" style={{ color: won ? '#4ADE80' : '#EF4444' }}>
                      {won ? `+${amount.toLocaleString()}` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="recent-hands-empty">Play a hand to see your history here</div>
          )}
        </div>

        {/* Quick Games */}
        <SectionHeader>Quick Games</SectionHeader>
        <QuickGamesGrid nameInput={nameInput} connected={connected} onHeadsUp={handleQuickHeadsUp} onSpinGo={handleQuickSpinGo} onAllIn={handleQuickAllInOrFold} />

        {/* Tournaments */}
        <SectionHeader>Tournaments</SectionHeader>
        <TournamentLobby />
        <MissionsPanel />
      </div>

      {/* ── RIGHT SIDEBAR (#9) ── */}
      <div className="lobby-home-sidebar">
        <SectionHeader>Leaderboard</SectionHeader>
        <InlineLeaderboard />
        <SectionHeader>Friends</SectionHeader>
        <InlineFriendsList onJoinFriendTable={handleWatch} />
      </div>

      {/* Sticky Quick Play bar */}
      {showStickyPlay && activeTab === 'home' && !isSeated && (
        <div className="lobby-sticky-play">
          <button className="btn-quick-play btn-quick-play--sticky" onClick={handleQuickPlay} disabled={!nameInput.trim() || !connected}>
            ⚡ QUICK PLAY
          </button>
        </div>
      )}
    </div>
    );
  };

  const renderPlayTab = () => (
    <div className="lobby-tab-content lobby-tab-fade" key="play">
      {/* Qualifiers */}
      <SectionHeader>Qualifier Tournaments</SectionHeader>
      <QualifierLobby onSpectate={() => setScreen('table')} />

      {/* Cash Games — #7 two-column grid on wider screens */}
      <SectionHeader>Cash Games</SectionHeader>
      <div className="table-list-grid">
      <TableListSection
        tables={tables}
        connected={connected}
        nameInput={nameInput}
        variantFilter={variantFilter}
        setVariantFilter={setVariantFilter}
        searchText={searchText}
        setSearchText={setSearchText}
        stakesFilter={stakesFilter}
        setStakesFilter={setStakesFilter}
        seatsFilter={seatsFilter}
        setSeatsFilter={setSeatsFilter}
        onJoinTable={handleJoinTable}
        onWatch={handleWatch}
        playerChips={chipCount}
      />
      </div>

      {/* Quick Games */}
      <SectionHeader>Quick Games</SectionHeader>
      <QuickGamesGrid
        nameInput={nameInput}
        connected={connected}
        onHeadsUp={handleQuickHeadsUp}
        onSpinGo={handleQuickSpinGo}
        onAllIn={handleQuickAllInOrFold}
      />

      {/* Tournaments */}
      <SectionHeader>Tournaments</SectionHeader>
      <TournamentLobby />
      <div style={{ display: 'flex', gap: '10px', marginTop: '12px', marginBottom: '8px' }}>
        <button
          className="btn-accent"
          style={{ flex: 1, padding: '10px 16px', fontSize: '0.85rem', background: 'linear-gradient(135deg, #0EA5E9, #38BDF8)', color: '#0a0a1a' }}
          onClick={() => setShowTournamentBracket(true)}
        >
          🏆 Live Bracket
        </button>
        <button
          className="btn-accent"
          style={{ flex: 1, padding: '10px 16px', fontSize: '0.85rem', background: 'linear-gradient(135deg, #8B5CF6, #7C3AED)', color: '#fff' }}
          onClick={() => setShowTournamentDirector(true)}
        >
          🎬 TD Suite
        </button>
      </div>
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ marginBottom: '8px', background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: '#0a0a1a', borderColor: 'rgba(245,158,11,0.4)' }}
        onClick={() => setShowStakingMarketplace(true)}
      >
        💼 Staking Marketplace
      </button>
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ marginBottom: '16px', background: 'linear-gradient(135deg, #475569, #334155)', color: '#e2e8f0', borderColor: 'rgba(71,85,105,0.4)' }}
        onClick={() => setShowMultiTable(true)}
      >
        ⊞ Multi-Table View
      </button>

      {/* Create Private Table */}
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ marginTop: '20px', background: 'linear-gradient(135deg, #B388FF, #7C3AED)', color: '#fff', borderColor: 'rgba(179,136,255,0.5)' }}
        onClick={() => setShowCreateTable(true)}
      >
        Create / Join Private Table
      </button>
    </div>
  );

  const renderSocialTab = () => (
    <div className="lobby-tab-content lobby-tab-fade" key="social">
      {/* Clubs */}
      <SectionHeader>Private Clubs</SectionHeader>
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ marginBottom: '24px' }}
        onClick={() => setShowClubs(true)}
      >
        Manage Clubs
      </button>

      {/* Social Bracket Tournaments */}
      <SectionHeader>Friend Tournaments</SectionHeader>
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ marginBottom: '24px', background: 'linear-gradient(135deg, #F59E0B, #FBBF24)', color: '#0a0a1a', borderColor: 'rgba(245,158,11,0.4)' }}
        onClick={() => setShowSocialBracket(true)}
      >
        🏆 Social Bracket Tournaments
      </button>

      {/* Friends */}
      <SectionHeader>Friends</SectionHeader>
      <InlineFriendsList onJoinFriendTable={handleWatch} />
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ marginTop: '8px', marginBottom: '24px' }}
        onClick={() => setShowFriends(true)}
      >
        Manage Friends
      </button>

      {/* Leaderboard */}
      <SectionHeader>Leaderboard</SectionHeader>
      <InlineLeaderboard />
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ marginTop: '8px', marginBottom: '24px' }}
        onClick={() => setShowLeaderboard(true)}
      >
        Full Leaderboard
      </button>

      {/* Find Players */}
      <SectionHeader>Find Players</SectionHeader>
      <div className="lobby-placeholder-section">
        <input
          type="text"
          className="table-search-input"
          placeholder="Search by username..."
          style={{ width: '100%', marginBottom: '8px' }}
          value={playerSearchQuery}
          onChange={(e) => handlePlayerSearch(e.target.value)}
        />
        {playerSearchLoading && (
          <p style={{ color: '#6b6b8a', fontSize: '0.8rem', margin: 0 }}>Searching…</p>
        )}
        {!playerSearchLoading && playerSearchQuery.length >= 2 && playerSearchResults.length === 0 && (
          <p style={{ color: '#6b6b8a', fontSize: '0.8rem', margin: 0 }}>No players found.</p>
        )}
        {playerSearchResults.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {playerSearchResults.map((p) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '8px 12px',
              }}>
                <span style={{ color: '#e0e0ff', fontWeight: 600 }}>{p.username}</span>
                <span style={{ color: '#888', fontSize: '0.8rem' }}>Lv.{p.level} · {(p.chips || 0).toLocaleString()} chips</span>
              </div>
            ))}
          </div>
        )}
        {!playerSearchQuery && (
          <p style={{ color: '#6b6b8a', fontSize: '0.8rem', margin: 0 }}>Type at least 2 characters to search</p>
        )}
      </div>
    </div>
  );

  const renderProfileTab = () => (
    <div className="lobby-tab-content lobby-tab-fade" key="profile">
      {/* Player Info Card with Banner */}
      <div className="lobby-profile-banner-wrap">
        <div className="lobby-profile-banner" />
        <div className="lobby-profile-card lobby-profile-card--with-banner">
          <div className="lobby-profile-avatar lobby-profile-avatar--overlap" style={{ background: 'transparent', overflow: 'hidden' }}>
            <PlayerAvatar playerId={nameInput || playerName} name={nameInput || playerName} size={72} style={{ border: '3px solid #16162e' }} />
          </div>
          <div className="lobby-profile-details">
            <div className="lobby-profile-name">
              <input
                type="text"
                placeholder="Enter your name..."
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="name-input"
                maxLength={20}
                style={{ width: '180px' }}
              />
            </div>
            <div className="lobby-profile-level">Level {currentLevel}</div>
            <div className="lobby-profile-xp-bar">
              <div className="lobby-profile-xp-fill" style={{ width: `${xpPercent}%` }} />
            </div>
            <div className="lobby-profile-xp-label">{currentXP.toLocaleString()} / {xpToNextLevel.toLocaleString()} XP</div>
          </div>
          <div className="lobby-profile-resources">
            <span className="lobby-player-chips">🪙 {chipCount.toLocaleString()} chips</span>
            <span className="lobby-player-stars">⭐ {starCount.toLocaleString()} stars</span>
          </div>
        </div>
      </div>

      {/* Quick stats row */}
      <div className="quick-stats-bar" style={{ marginBottom: '20px' }}>
        <div className="stat-chip">
          <span className="stat-icon">&#127919;</span>
          <span className="stat-label">Win Rate:</span>
          <span className="stat-value">{winRate}%</span>
        </div>
        <div className="stat-chip">
          <span className="stat-icon">&#9995;</span>
          <span className="stat-label">Hands:</span>
          <span className="stat-value">{handsToday}</span>
        </div>
        <div className="stat-chip">
          <span className="stat-icon">&#128293;</span>
          <span className="stat-label">Streak:</span>
          <span className="stat-value">{currentStreak}W</span>
        </div>
        <div className="stat-chip">
          <span className="stat-icon">&#127183;</span>
          <span className="stat-label">Best:</span>
          <span className="stat-value">{bestHand}</span>
        </div>
      </div>

      {/* Ranked card */}
      {(() => {
        const elo = progress?.elo ?? 500;
        const rankName = progress?.rank ?? 'Silver I';
        const info = getRankInfo(rankName);
        const nextInfo = getNextRankInfo(rankName);
        const rankedWins = progress?.rankedWins ?? 0;
        const rankedLosses = progress?.rankedLosses ?? 0;
        const peakElo = progress?.peakElo ?? elo;
        const currentMin = info.min;
        const nextMin = nextInfo ? nextInfo.min : info.min + 200;
        const progressPct = nextInfo
          ? Math.min(100, ((elo - currentMin) / (nextMin - currentMin)) * 100)
          : 100;
        return (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid ${info.color}33`,
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.6rem' }}>{info.icon}</span>
                <div>
                  <div style={{ color: info.color, fontWeight: 700, fontSize: '1rem' }}>{rankName}</div>
                  <div style={{ color: '#8888AA', fontSize: '0.72rem' }}>
                    {rankedWins}W · {rankedLosses}L · Peak: {peakElo} ELO
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: info.color, fontWeight: 700, fontSize: '1.2rem' }}>{elo}</div>
                <div style={{ color: '#8888AA', fontSize: '0.65rem' }}>ELO</div>
              </div>
            </div>
            {/* Progress to next rank */}
            {nextInfo && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#8888AA', marginBottom: '4px' }}>
                  <span>{rankName}</span>
                  <span>{nextInfo.name} ({nextMin} ELO)</span>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progressPct}%`, background: `linear-gradient(90deg, ${info.color}88, ${info.color})`, borderRadius: '3px', transition: 'width 0.4s' }} />
                </div>
              </div>
            )}
            {!nextInfo && (
              <div style={{ color: info.color, fontSize: '0.78rem', textAlign: 'center' }}>MAX RANK ACHIEVED</div>
            )}
          </div>
        );
      })()}

      {/* My Stats button */}
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ background: 'linear-gradient(135deg, #B388FF, #7C3AED)', color: '#fff', marginBottom: '12px' }}
        onClick={() => setShowStats(true)}
      >
        My Stats
      </button>

      {/* Admin-only: manual restore button. Server rejects non-admins. */}
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ marginBottom: '12px', background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: '#0a0a1a', fontWeight: 800 }}
        onClick={() => {
          const socket = getSocket();
          if (!socket?.connected) return;
          const handler = (res) => {
            socket.off('adminRestoreBalanceResult', handler);
            if (res?.success) {
              alert(`Restored ${res.chips.toLocaleString()} chips + ${res.stars.toLocaleString()} stars`);
            } else {
              alert(`Restore failed: ${res?.error || 'unknown'}`);
            }
          };
          socket.on('adminRestoreBalanceResult', handler);
          socket.emit('adminRestoreBalance');
        }}
      >
        🔁 Restore Missing Balance (Admin)
      </button>

      {/* Tools section */}
      <SectionHeader>Tools</SectionHeader>
      {(() => {
        const toolBtnStyle = { flex: 1, padding: '12px 16px', fontSize: '0.85rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(0,217,255,0.15)', color: '#ccc', borderRadius: 10, cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' };
        return <>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowEquityCalc(true)}
        >
          📊 Equity Calc
        </button>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowRangeChart(true)}
        >
          🎯 Range Chart
        </button>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowLeakFinder(true)}
        >
          🔍 Leak Finder
        </button>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowBankrollGraph(true)}
        >
          📈 Bankroll Graph
        </button>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowAdvancedAnalytics(true)}
        >
          📊 Advanced Analytics
        </button>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowHandHistoryImporter(true)}
        >
          📂 Import Hand History
        </button>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowBankrollAI(true)}
        >
          💹 Bankroll AI
        </button>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowNFTBadges(true)}
        >
          🏅 NFT Badges
        </button>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowPlayerProfile(true)}
        >
          👤 My Profile Page
        </button>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowExportData(true)}
        >
          📤 Export Data
        </button>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setShowHandQuiz(true)}
        >
          🧠 Hand Quiz
        </button>
      </div>
      </>; })()}

      {/* Achievements Preview */}
      <SectionHeader>Achievements</SectionHeader>
      <div className="lobby-achievements-grid">
        {achievementsWithStatus.slice(0, 4).map((a) => (
          <div
            key={a.id}
            className={`lobby-achievement-card ${a.unlocked ? 'unlocked' : 'locked'}`}
          >
            <span className="lobby-achievement-icon">{a.icon}</span>
            <span className="lobby-achievement-name">{a.name}</span>
            <span className="lobby-achievement-desc">{a.description}</span>
          </div>
        ))}
      </div>

      {/* VIP Status Inline Card */}
      <SectionHeader>VIP Status</SectionHeader>
      <div className="lobby-vip-inline-card" style={{ borderLeftColor: vipTier.color }}>
        <div className="lobby-vip-badge" style={{ background: vipTier.color, color: '#0a0a1a' }}>
          {vipTier.name}
        </div>
        <div className="lobby-vip-info">
          <span style={{ color: vipTier.color, fontWeight: 600 }}>{currentXP.toLocaleString()} XP</span>
          <span style={{ color: '#8888AA', fontSize: '0.8rem' }}>{vipTier.xpRate} XP rate</span>
        </div>
        <button
          className="btn-accent"
          style={{ padding: '6px 16px', fontSize: '0.8rem' }}
          onClick={() => setShowVIP(true)}
        >
          Details
        </button>
      </div>

      {/* Unlocks & Hand History */}
      <div className="lobby-profile-buttons">
        <button
          className="btn-accent"
          style={{ flex: 1, background: 'linear-gradient(135deg, #22C55E, #16A34A)', color: '#fff', borderColor: 'rgba(34,197,94,0.5)' }}
          onClick={() => setShowUnlocks(true)}
        >
          Unlocks
        </button>
        <button
          className="btn-accent"
          style={{ flex: 1 }}
          onClick={() => {}}
        >
          Hand History
        </button>
      </div>
    </div>
  );

  const renderShopTab = () => {
    // Persistence-sweep helpers: ownership / equipped state from server-hydrated store.
    const ownedBy = progress?.ownedBy || {};
    const equippedBy = progress?.equippedBy || {};
    const isOwned = (type, id) => !!ownedBy[type]?.has?.(id);
    const isEquipped = (type, id) => equippedBy[type] === id;
    const onBuy = (type, id) => {
      const socket = getSocket();
      if (!socket) return;
      socket.emit('purchaseShopItem', { itemType: type, itemId: id });
    };
    const onEquip = (type, id) => {
      const socket = getSocket();
      if (!socket) return;
      socket.emit('equipItem', { itemType: type, itemId: id });
    };
    const actionLabel = (type, id, price) => {
      if (isEquipped(type, id)) return 'Equipped';
      if (isOwned(type, id)) return 'Equip';
      return price;
    };
    const actionClick = (type, id) => () => {
      if (isEquipped(type, id)) return;
      if (isOwned(type, id)) onEquip(type, id);
      else                   onBuy(type, id);
    };

    return (
    <div className="lobby-tab-content lobby-tab-fade" key="shop">
      {/* Sticky currency balance — always visible at the top of the shop
          so the user knows what they can afford before browsing. */}
      <div className="lobby-shop-balance" style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', marginBottom: '14px',
        background: 'linear-gradient(135deg, rgba(14,14,36,0.95), rgba(26,16,46,0.95))',
        border: '1px solid rgba(255, 215, 0, 0.35)',
        borderRadius: '10px',
        boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
      }}>
        <span style={{ color: '#FFD700', fontWeight: 800, fontSize: '1.02rem', letterSpacing: '0.3px' }}>
          ⭐ {(progress?.stars ?? 0).toLocaleString()} Stars
        </span>
        <span style={{ color: '#00D9FF', fontWeight: 700, fontSize: '0.95rem' }}>
          🪙 {(progress?.chips ?? chipCount ?? 0).toLocaleString()} Chips
        </span>
      </div>

      {/* Battle Pass */}
      <SectionHeader>Battle Pass</SectionHeader>
      <button
        className="btn-accent lobby-full-width-btn lobby-bp-btn"
        onClick={() => setShowBattlePass(true)}
      >
        ⚔️ Season 1: The River — View Battle Pass
      </button>

      {/* Daily Rewards */}
      <SectionHeader>Daily Rewards</SectionHeader>
      <div className="lobby-daily-rewards-inline">
        <LoginRewards
          onClose={() => {}}
          autoOpened={false}
          inline={true}
        />
      </div>
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ marginBottom: '12px', background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: '#0a0a1a', borderColor: 'rgba(245,158,11,0.5)' }}
        onClick={() => { setShowLoginRewards(true); setLoginRewardsAutoOpened(false); }}
      >
        Open Daily Rewards
      </button>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
        <button
          className="btn-accent"
          style={{ flex: 1, padding: '10px 16px', fontSize: '0.85rem', background: 'linear-gradient(135deg, #EC4899, #F472B6)', color: '#fff' }}
          onClick={() => setShowSpinWheel(true)}
        >
          Daily Spin
        </button>
        <button
          className="btn-accent"
          style={{ flex: 1, padding: '10px 16px', fontSize: '0.85rem', background: 'linear-gradient(135deg, #A855F7, #C084FC)', color: '#fff' }}
          onClick={() => setShowScratchCards(true)}
        >
          Scratch Cards
        </button>
      </div>

      {/* Table Themes — inline grid. The previous "Browse Table Themes"
          modal button opened a nested overlay that didn't work (click
          was swallowed by something in the Lobby tree). Inline grid
          using the same isOwned/isEquipped/actionClick pattern as the
          other shop sections works directly. */}
      <SectionHeader>Table Themes</SectionHeader>
      <div className="lobby-card-backs-grid">
        {[
          { id: 'classic_blue',     name: 'Classic Blue',     felt: '#2874a6', rail: '#8B5E3C', price: 0 },
          { id: 'green_felt',       name: 'Green Felt',       felt: '#1a5c2a', rail: '#8B6914', price: 0 },
          { id: 'midnight_purple',  name: 'Midnight Purple',  felt: '#4a1d6e', rail: '#C0C0C0', price: 300 },
          { id: 'ocean_breeze',     name: 'Ocean Breeze',     felt: '#1a7a7a', rail: '#F5F5F5', price: 400 },
          { id: 'casino_royale',    name: 'Casino Royale',    felt: '#1a5c2a', rail: '#B8860B', price: 500 },
          { id: 'neon_vegas',       name: 'Neon Vegas',       felt: '#0a0a0a', rail: '#1a1a2e', price: 600 },
          { id: 'carbon_black',     name: 'Carbon Black',     felt: '#18181b', rail: '#3f3f46', price: 700 },
          { id: 'royal_gold',       name: 'Royal Gold',       felt: '#0a1a3a', rail: '#DAA520', price: 800 },
          { id: 'cherry_wood',      name: 'Cherry Wood',      felt: '#3d1a1a', rail: '#7c2d12', price: 900 },
          { id: 'cosmic_nebula',    name: 'Cosmic Nebula',    felt: '#312e81', rail: '#a78bfa', price: 1500 },
        ].map((theme) => {
          const owned = isOwned('theme', theme.id) || theme.price === 0;
          const equipped = isEquipped('theme', theme.id);
          return (
            <div
              key={theme.id}
              onClick={actionClick('theme', theme.id)}
              className={`lobby-card-back ${owned ? 'owned' : 'locked'}`}
              style={{ cursor: equipped ? 'default' : 'pointer', outline: equipped ? '2px solid #10B981' : 'none' }}
            >
              <div className="lobby-card-back-preview" style={{ background: theme.felt, border: `3px solid ${theme.rail}` }}>
                <span style={{ fontSize: '1.2rem' }}>♠</span>
              </div>
              <span className="lobby-card-back-name">{theme.name}</span>
              <span className="lobby-card-back-price" style={{ color: equipped ? '#10B981' : '#00D9FF' }}>
                {equipped ? 'Equipped' : owned ? 'Equip' : `${theme.price} ⭐`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Card Backs */}
      <SectionHeader>Card Backs</SectionHeader>
      <div className="lobby-card-backs-grid">
        {[
          { id: 'classic_red',     name: 'Classic Red',     color: '#DC2626', price: 0 },
          { id: 'royal_blue',      name: 'Royal Blue',      color: '#2563EB', price: 0 },
          { id: 'silver_foil',     name: 'Silver Foil',     color: '#C0C0C0', price: 400 },
          { id: 'gold_premium',    name: 'Gold Premium',    color: '#D97706', price: 500 },
          { id: 'neon_green',      name: 'Neon Green',      color: '#16A34A', price: 500 },
          { id: 'holographic',     name: 'Holographic',     color: '#A78BFA', price: 800 },
          { id: 'dragon',          name: 'Dragon',          color: '#DC2626', price: 1200 },
          { id: 'phoenix',         name: 'Phoenix',         color: '#F59E0B', price: 1500 },
          { id: 'diamond_pattern', name: 'Diamond',         color: '#B9F2FF', price: 2000 },
          { id: 'mythic',          name: 'Mythic',          color: '#FF1744', price: 5000 },
        ].map((card) => {
          const owned = isOwned('card_back', card.id) || card.price === 0;
          const equipped = isEquipped('card_back', card.id);
          return (
            <div
              key={card.id}
              onClick={actionClick('card_back', card.id)}
              className={`lobby-card-back ${owned ? 'owned' : 'locked'}`}
              style={{ cursor: equipped ? 'default' : 'pointer', outline: equipped ? '2px solid #10B981' : 'none' }}
            >
              <div className="lobby-card-back-preview" style={{ background: `linear-gradient(135deg, ${card.color}, ${card.color}88)` }}>
                <span style={{ fontSize: '1.5rem' }}>{'\u{1F0CF}'}</span>
              </div>
              <span className="lobby-card-back-name">{card.name}</span>
              <span className="lobby-card-back-price" style={{ color: equipped ? '#10B981' : owned ? '#00D9FF' : '#00D9FF' }}>
                {equipped ? 'Equipped' : owned ? 'Equip' : `${card.price} ⭐`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Chip Packs — stars → chips conversion */}
      <SectionHeader>Chip Packs</SectionHeader>
      <div className="lobby-vip-packages">
        {[
          { id: 'refill',  name: 'Refill Stack',  desc: '10,000 chips',     price: 50,    color: '#3B82F6' },
          { id: 'small',   name: 'Small Stack',   desc: '25,000 chips',     price: 100,   color: '#06B6D4' },
          { id: 'medium',  name: 'Medium Stack',  desc: '100,000 chips',    price: 300,   color: '#10B981' },
          { id: 'big',     name: 'Big Stack',     desc: '250,000 chips',    price: 600,   color: '#84CC16' },
          { id: 'pro',     name: 'Pro Stack',     desc: '750,000 chips',    price: 1500,  color: '#8B5CF6' },
          { id: 'whale',   name: 'Whale Stack',   desc: '2,000,000 chips',  price: 3000,  color: '#F59E0B' },
          { id: 'kingpin', name: 'Kingpin Stack', desc: '5,000,000 chips',  price: 6000,  color: '#EC4899' },
          { id: 'emperor', name: 'Emperor Stack', desc: '15,000,000 chips', price: 12000, color: '#FFD700' },
        ].map((pkg) => (
          <div key={pkg.id} className="lobby-vip-package-card" style={{ borderLeftColor: pkg.color }}>
            <div>
              <div style={{ color: pkg.color, fontWeight: 700, fontSize: '0.95rem' }}>{pkg.name}</div>
              <div style={{ color: '#8888AA', fontSize: '0.8rem' }}>{pkg.desc}</div>
            </div>
            <button className="btn-accent" style={{ padding: '6px 16px', fontSize: '0.8rem' }} onClick={() => onBuy('chip_pack', pkg.id)}>
              {pkg.price.toLocaleString()} ⭐
            </button>
          </div>
        ))}
      </div>

      {/* Mystery Boxes — stars → random reward (chips / stars / cosmetic) */}
      <SectionHeader>Mystery Boxes</SectionHeader>
      <div className="lobby-vip-packages">
        {[
          { id: 'basic',     name: '📦 Basic Mystery Box',    desc: 'Roll: chips, stars, or common emote/sound',   price: 500,  color: '#A3A3A3' },
          { id: 'premium',   name: '🎁 Premium Mystery Box',  desc: 'Roll: bigger chips, stars, or silver+ items', price: 2000, color: '#A78BFA' },
          { id: 'legendary', name: '✨ Legendary Mystery Box', desc: 'Roll: huge chips, stars, or diamond+ items',  price: 8000, color: '#FFD700' },
        ].map((box) => (
          <div key={box.id} className="lobby-vip-package-card" style={{ borderLeftColor: box.color }}>
            <div>
              <div style={{ color: box.color, fontWeight: 700, fontSize: '0.95rem' }}>{box.name}</div>
              <div style={{ color: '#8888AA', fontSize: '0.8rem' }}>{box.desc}</div>
            </div>
            <button className="btn-accent" style={{ padding: '6px 16px', fontSize: '0.8rem' }} onClick={() => onBuy('mystery_box', box.id)}>
              {box.price.toLocaleString()} ⭐
            </button>
          </div>
        ))}
      </div>

      {/* Emotes */}
      <SectionHeader>Emotes</SectionHeader>
      <div className="lobby-card-backs-grid">
        {[
          { id: 'nice_hand',   name: 'Nice Hand',   icon: '👍', price: 150 },
          { id: 'good_game',   name: 'Good Game',   icon: '🤝', price: 150 },
          { id: 'well_played', name: 'Well Played', icon: '🎯', price: 150 },
          { id: 'thumbs_up',   name: 'Thumbs Up',   icon: '👍', price: 150 },
          { id: 'clap',        name: 'Clap',        icon: '👏', price: 200 },
          { id: 'love',        name: 'Love',        icon: '❤️', price: 250 },
          { id: 'big_brain',   name: 'Big Brain',   icon: '🧠', price: 200 },
          { id: 'money',       name: 'Money',       icon: '💰', price: 200 },
          { id: 'fire',        name: 'Fire',        icon: '🔥', price: 250 },
          { id: 'tears',       name: 'Tears',       icon: '😭', price: 250 },
          { id: 'rocket',      name: 'Rocket',      icon: '🚀', price: 300 },
          { id: 'crown',       name: 'Crown',       icon: '👑', price: 400 },
          { id: 'sunglasses',  name: 'Cool',        icon: '😎', price: 200 },
          { id: 'laughing',    name: 'Laughing',    icon: '😂', price: 200 },
          { id: 'surprised',   name: 'Surprised',   icon: '😲', price: 200 },
          { id: 'dead',        name: 'Dead',        icon: '💀', price: 300 },
          { id: 'think',       name: 'Thinking',    icon: '🤔', price: 300 },
          { id: 'poker_face',  name: 'Poker Face',  icon: '😐', price: 400 },
          { id: 'mic_drop',    name: 'Mic Drop',    icon: '🎤', price: 500 },
          { id: 'trophy',      name: 'Trophy',      icon: '🏆', price: 600 },
        ].map((e) => {
          const owned = isOwned('emote', e.id);
          return (
            <div
              key={e.id}
              onClick={owned ? undefined : () => onBuy('emote', e.id)}
              className={`lobby-card-back ${owned ? 'owned' : 'locked'}`}
              style={{ cursor: owned ? 'default' : 'pointer' }}
            >
              <div className="lobby-card-back-preview" style={{ background: 'linear-gradient(135deg, #1f2937, #111827)' }}>
                <span style={{ fontSize: '1.8rem' }}>{e.icon}</span>
              </div>
              <span className="lobby-card-back-name">{e.name}</span>
              {owned
                ? <span className="lobby-card-back-price" style={{ color: '#10B981' }}>Owned</span>
                : <span className="lobby-card-back-price">{e.price} ⭐</span>}
            </div>
          );
        })}
      </div>

      {/* Avatar Frames */}
      <SectionHeader>Avatar Frames</SectionHeader>
      <div className="lobby-card-backs-grid">
        {[
          { id: 'bronze',   name: 'Bronze',   color: '#CD7F32', icon: '◯', price: 500 },
          { id: 'silver',   name: 'Silver',   color: '#C0C0C0', icon: '◯', price: 1000 },
          { id: 'gold',     name: 'Gold',     color: '#FFD700', icon: '◯', price: 2000 },
          { id: 'flame',    name: 'Flame',    color: '#FF4500', icon: '🔥', price: 6000 },
          { id: 'ice',      name: 'Ice',      color: '#60A5FA', icon: '❄', price: 6000 },
          { id: 'platinum', name: 'Platinum', color: '#E5E7EB', icon: '◆', price: 8000 },
          { id: 'crown',    name: 'Crown',    color: '#FFD700', icon: '👑', price: 10000 },
          { id: 'diamond',  name: 'Diamond',  color: '#B9F2FF', icon: '◆', price: 5000 },
          { id: 'mythic',   name: 'Mythic',   color: '#FF1744', icon: '★', price: 15000 },
        ].map((f) => {
          const owned = isOwned('frame', f.id);
          const equipped = isEquipped('frame', f.id);
          return (
            <div
              key={f.id}
              onClick={actionClick('frame', f.id)}
              className={`lobby-card-back ${owned ? 'owned' : 'locked'}`}
              style={{ cursor: equipped ? 'default' : 'pointer', outline: equipped ? '2px solid #10B981' : 'none' }}
            >
              <div className="lobby-card-back-preview" style={{ background: `radial-gradient(circle, ${f.color}22 0%, transparent 70%)`, border: `2px solid ${f.color}` }}>
                <span style={{ fontSize: '1.6rem', color: f.color }}>{f.icon}</span>
              </div>
              <span className="lobby-card-back-name">{f.name}</span>
              <span className="lobby-card-back-price" style={{ color: equipped ? '#10B981' : '#00D9FF' }}>
                {equipped ? 'Equipped' : owned ? 'Equip' : `${f.price} ⭐`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Win Celebrations */}
      <SectionHeader>Win Celebrations</SectionHeader>
      <div className="lobby-card-backs-grid">
        {[
          { id: 'confetti',       name: 'Confetti',       icon: '🎉', price: 400 },
          { id: 'chip_rain',      name: 'Chip Rain',      icon: '🪙', price: 800 },
          { id: 'fireworks',      name: 'Fireworks',      icon: '🎆', price: 1200 },
          { id: 'lightning',      name: 'Lightning',      icon: '⚡', price: 1500 },
          { id: 'golden_shower',  name: 'Golden Rain',    icon: '💫', price: 2000 },
          { id: 'dragon_breath',  name: 'Dragon Breath',  icon: '🐉', price: 3000 },
          { id: 'cosmic_burst',   name: 'Cosmic Burst',   icon: '🌌', price: 4000 },
          { id: 'supernova',      name: 'Supernova',      icon: '💥', price: 6000 },
        ].map((w) => {
          const owned = isOwned('celebration', w.id);
          const equipped = isEquipped('celebration', w.id);
          return (
            <div
              key={w.id}
              onClick={actionClick('celebration', w.id)}
              className={`lobby-card-back ${owned ? 'owned' : 'locked'}`}
              style={{ cursor: equipped ? 'default' : 'pointer', outline: equipped ? '2px solid #10B981' : 'none' }}
            >
              <div className="lobby-card-back-preview" style={{ background: 'linear-gradient(135deg, #0e7490, #155e75)' }}>
                <span style={{ fontSize: '1.8rem' }}>{w.icon}</span>
              </div>
              <span className="lobby-card-back-name">{w.name}</span>
              <span className="lobby-card-back-price" style={{ color: equipped ? '#10B981' : '#00D9FF' }}>
                {equipped ? 'Equipped' : owned ? 'Equip' : `${w.price} ⭐`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Mystery Boxes — handled as scratch cards server-side (surprise reveals) */}
      <SectionHeader>Scratch Cards</SectionHeader>
      <div className="lobby-vip-packages">
        <div className="lobby-vip-package-card" style={{ borderLeftColor: '#D97706' }}>
          <div>
            <div style={{ color: '#D97706', fontWeight: 700, fontSize: '0.95rem' }}>🎟️ You have {progress?.scratchCardsAvailable || 0} scratch cards</div>
            <div style={{ color: '#8888AA', fontSize: '0.8rem' }}>Earn 1 card every 20 hands. Reveals chips, stars, or surprise items.</div>
          </div>
          <button
            className="btn-accent"
            style={{ padding: '6px 16px', fontSize: '0.8rem', opacity: (progress?.scratchCardsAvailable || 0) > 0 ? 1 : 0.4 }}
            disabled={(progress?.scratchCardsAvailable || 0) === 0}
            onClick={() => {
              const socket = getSocket();
              socket?.emit('claimScratchCard');
            }}
          >
            Reveal
          </button>
        </div>
      </div>

      {/* Sound Packs */}
      <SectionHeader>Sound Packs</SectionHeader>
      <div className="lobby-card-backs-grid">
        {[
          { id: 'silent_mode',    name: 'Silent Mode',    icon: '🔇', price: 100 },
          { id: 'classic_casino', name: 'Classic Casino', icon: '🎵', price: 300 },
          { id: 'vegas_casino',   name: 'Vegas Casino',   icon: '🎰', price: 300 },
          { id: 'old_school',     name: 'Old School',     icon: '🎼', price: 500 },
          { id: 'cyberpunk',      name: 'Cyberpunk',      icon: '🎧', price: 750 },
          { id: 'fantasy',        name: 'Fantasy',        icon: '🎻', price: 1000 },
        ].map((s) => {
          const owned = isOwned('sound_pack', s.id);
          const equipped = isEquipped('sound_pack', s.id);
          return (
            <div
              key={s.id}
              onClick={actionClick('sound_pack', s.id)}
              className={`lobby-card-back ${owned ? 'owned' : 'locked'}`}
              style={{ cursor: equipped ? 'default' : 'pointer', outline: equipped ? '2px solid #10B981' : 'none' }}
            >
              <div className="lobby-card-back-preview" style={{ background: 'linear-gradient(135deg, #581c87, #3b0764)' }}>
                <span style={{ fontSize: '1.8rem' }}>{s.icon}</span>
              </div>
              <span className="lobby-card-back-name">{s.name}</span>
              <span className="lobby-card-back-price" style={{ color: equipped ? '#10B981' : '#00D9FF' }}>
                {equipped ? 'Active' : owned ? 'Equip' : `${s.price} ⭐`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Player Titles */}
      <SectionHeader>Player Titles</SectionHeader>
      <div className="lobby-vip-packages">
        {[
          { id: 'nitwit',             name: 'Nitwit',             desc: 'For the tightest of the tight',      price: 300,  color: '#A3A3A3' },
          { id: 'calling_station',    name: 'Calling Station',    desc: 'Wear your call stats with pride',    price: 400,  color: '#94A3B8' },
          { id: 'grinder',            name: 'Grinder',            desc: 'Earn it one hand at a time',         price: 500,  color: '#64748B' },
          { id: 'river_rat',          name: 'River Rat',          desc: 'Miracle on the river specialist',    price: 600,  color: '#84CC16' },
          { id: 'chip_leader',        name: 'Chip Leader',        desc: 'Stack the whole table',              price: 700,  color: '#22C55E' },
          { id: 'degenerate',         name: 'Degenerate',         desc: 'No fold button here',                price: 700,  color: '#A78BFA' },
          { id: 'the_shark',          name: 'The Shark',          desc: 'Dangerous waters',                   price: 800,  color: '#06B6D4' },
          { id: 'bad_beat_survivor',  name: 'Bad Beat Survivor',  desc: 'Ran bad, kept playing',              price: 800,  color: '#F97316' },
          { id: 'final_table',        name: 'Final Table',        desc: 'Tournament endgame',                 price: 1000, color: '#3B82F6' },
          { id: 'bluff_master',       name: 'Bluff Master',       desc: 'Show cards, they fold',              price: 1200, color: '#EC4899' },
          { id: 'all_in_legend',      name: 'All-In Legend',      desc: 'Every hand, all-in',                 price: 1500, color: '#F59E0B' },
          { id: 'phantom',            name: 'Phantom',            desc: 'Disappearing act',                   price: 1500, color: '#8B5CF6' },
          { id: 'tournament_champ',   name: 'Tournament Champ',   desc: 'Proven winner',                      price: 2000, color: '#10B981' },
          { id: 'royal',              name: 'Royal',              desc: 'King of the felt',                   price: 3000, color: '#FFD700' },
          { id: 'godmode',            name: 'God Mode',           desc: 'The apex predator',                  price: 8000, color: '#FF1744' },
        ].map((t) => {
          const owned = isOwned('title', t.id);
          const equipped = isEquipped('title', t.id);
          return (
            <div key={t.id} className="lobby-vip-package-card" style={{ borderLeftColor: t.color, outline: equipped ? '2px solid #10B981' : 'none' }}>
              <div>
                <div style={{ color: t.color, fontWeight: 700, fontSize: '0.95rem' }}>{t.name}</div>
                <div style={{ color: '#8888AA', fontSize: '0.8rem' }}>{t.desc}</div>
              </div>
              <button className="btn-accent" style={{ padding: '6px 16px', fontSize: '0.8rem' }} onClick={actionClick('title', t.id)}>
                {equipped ? 'Equipped' : owned ? 'Equip' : `${t.price.toLocaleString()} ⭐`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Chip Skins — how your chips look in the seat stack */}
      <SectionHeader>Chip Skins</SectionHeader>
      <div className="lobby-card-backs-grid">
        {[
          { id: 'classic',      name: 'Classic',      bg: 'linear-gradient(135deg, #64748B, #475569)', emoji: '🪙', price: 0 },
          { id: 'crimson',      name: 'Crimson',      bg: 'linear-gradient(135deg, #DC2626, #991B1B)', emoji: '🪙', price: 400 },
          { id: 'cobalt',       name: 'Cobalt',       bg: 'linear-gradient(135deg, #2563EB, #1E40AF)', emoji: '🪙', price: 500 },
          { id: 'emerald',      name: 'Emerald',      bg: 'linear-gradient(135deg, #059669, #047857)', emoji: '🪙', price: 600 },
          { id: 'amethyst',     name: 'Amethyst',     bg: 'linear-gradient(135deg, #9333EA, #6B21A8)', emoji: '🪙', price: 800 },
          { id: 'gold_rimmed',  name: 'Gold Rimmed',  bg: 'linear-gradient(135deg, #FFD700, #B8860B)', emoji: '🪙', price: 1200 },
          { id: 'neon',         name: 'Neon',         bg: 'linear-gradient(135deg, #00FF88, #00CC6A)', emoji: '🪙', price: 1800 },
          { id: 'holographic',  name: 'Holographic',  bg: 'linear-gradient(135deg, #A78BFA, #F472B6, #60A5FA)', emoji: '🪙', price: 2500 },
          { id: 'mythic',       name: 'Mythic',       bg: 'linear-gradient(135deg, #FF1744, #FF5252)', emoji: '🪙', price: 4000 },
        ].map((s) => {
          const owned = isOwned('chip_skin', s.id) || s.price === 0;
          const equipped = isEquipped('chip_skin', s.id);
          return (
            <div key={s.id} onClick={actionClick('chip_skin', s.id)}
              className={`lobby-card-back ${owned ? 'owned' : 'locked'}`}
              style={{ cursor: equipped ? 'default' : 'pointer', outline: equipped ? '2px solid #10B981' : 'none' }}
            >
              <div className="lobby-card-back-preview" style={{ background: s.bg }}>
                <span style={{ fontSize: '1.8rem' }}>{s.emoji}</span>
              </div>
              <span className="lobby-card-back-name">{s.name}</span>
              <span className="lobby-card-back-price" style={{ color: equipped ? '#10B981' : '#00D9FF' }}>
                {equipped ? 'Equipped' : owned ? 'Equip' : `${s.price} ⭐`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Card Fronts — alt face designs for hero's cards */}
      <SectionHeader>Card Fronts</SectionHeader>
      <div className="lobby-card-backs-grid">
        {[
          { id: 'standard',    name: 'Standard',    emoji: '🂱', price: 0 },
          { id: 'minimal',     name: 'Minimal',     emoji: '♠', price: 400 },
          { id: 'retro',       name: 'Retro',       emoji: '🃞', price: 600 },
          { id: 'modern',      name: 'Modern',      emoji: '🂡', price: 800 },
          { id: 'futuristic',  name: 'Futuristic',  emoji: '🂻', price: 1200 },
          { id: 'luxury',      name: 'Luxury',      emoji: '👑', price: 1800 },
          { id: 'hanafuda',    name: 'Hanafuda',    emoji: '🎴', price: 2200 },
          { id: 'artistic',    name: 'Artistic',    emoji: '🖼', price: 2800 },
        ].map((c) => {
          const owned = isOwned('card_front', c.id) || c.price === 0;
          const equipped = isEquipped('card_front', c.id);
          return (
            <div key={c.id} onClick={actionClick('card_front', c.id)}
              className={`lobby-card-back ${owned ? 'owned' : 'locked'}`}
              style={{ cursor: equipped ? 'default' : 'pointer', outline: equipped ? '2px solid #10B981' : 'none' }}
            >
              <div className="lobby-card-back-preview" style={{ background: 'linear-gradient(135deg, #fff, #e5e7eb)' }}>
                <span style={{ fontSize: '1.8rem', color: '#0a0a0a' }}>{c.emoji}</span>
              </div>
              <span className="lobby-card-back-name">{c.name}</span>
              <span className="lobby-card-back-price" style={{ color: equipped ? '#10B981' : '#00D9FF' }}>
                {equipped ? 'Equipped' : owned ? 'Equip' : `${c.price} ⭐`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Dealer Voices */}
      <SectionHeader>Dealer Voices</SectionHeader>
      <div className="lobby-card-backs-grid">
        {[
          { id: 'standard',     name: 'Standard',       icon: '🎙', price: 0 },
          { id: 'vegas_vet',    name: 'Vegas Veteran',  icon: '🎰', price: 600 },
          { id: 'british_butler', name: 'British Butler', icon: '🎩', price: 800 },
          { id: 'pirate',       name: 'Pirate',         icon: '🏴‍☠️', price: 900 },
          { id: 'robot',        name: 'Robot',          icon: '🤖', price: 1100 },
          { id: 'sportscaster', name: 'Sportscaster',   icon: '📢', price: 1400 },
          { id: 'celebrity',    name: 'Celebrity',      icon: '⭐', price: 2200 },
          { id: 'mythic_sage',  name: 'Mythic Sage',    icon: '🧙', price: 4000 },
        ].map((v) => {
          const owned = isOwned('dealer_voice', v.id) || v.price === 0;
          const equipped = isEquipped('dealer_voice', v.id);
          return (
            <div key={v.id} onClick={actionClick('dealer_voice', v.id)}
              className={`lobby-card-back ${owned ? 'owned' : 'locked'}`}
              style={{ cursor: equipped ? 'default' : 'pointer', outline: equipped ? '2px solid #10B981' : 'none' }}
            >
              <div className="lobby-card-back-preview" style={{ background: 'linear-gradient(135deg, #7c2d12, #431407)' }}>
                <span style={{ fontSize: '1.8rem' }}>{v.icon}</span>
              </div>
              <span className="lobby-card-back-name">{v.name}</span>
              <span className="lobby-card-back-price" style={{ color: equipped ? '#10B981' : '#00D9FF' }}>
                {equipped ? 'Active' : owned ? 'Equip' : `${v.price} ⭐`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Profile Backgrounds */}
      <SectionHeader>Profile Backgrounds</SectionHeader>
      <div className="lobby-card-backs-grid">
        {[
          { id: 'default',         name: 'Default',         bg: 'linear-gradient(135deg, #1e293b, #0f172a)', price: 0 },
          { id: 'sunset',          name: 'Sunset',          bg: 'linear-gradient(135deg, #FB923C, #EF4444)', price: 200 },
          { id: 'city_lights',     name: 'City Lights',     bg: 'linear-gradient(135deg, #1E3A8A, #312E81)', price: 350 },
          { id: 'deep_space',      name: 'Deep Space',      bg: 'linear-gradient(135deg, #030712, #4C1D95)', price: 500 },
          { id: 'aurora',          name: 'Aurora',          bg: 'linear-gradient(135deg, #14B8A6, #8B5CF6)', price: 700 },
          { id: 'volcano',         name: 'Volcano',         bg: 'linear-gradient(135deg, #991B1B, #F59E0B)', price: 900 },
          { id: 'underwater',      name: 'Underwater',      bg: 'linear-gradient(135deg, #0E7490, #1E3A8A)', price: 1100 },
          { id: 'cherry_blossom',  name: 'Cherry Blossom',  bg: 'linear-gradient(135deg, #F472B6, #FBCFE8)', price: 1400 },
          { id: 'diamond_rain',    name: 'Diamond Rain',    bg: 'linear-gradient(135deg, #B9F2FF, #60A5FA)', price: 2500 },
        ].map((b) => {
          const owned = isOwned('profile_bg', b.id) || b.price === 0;
          const equipped = isEquipped('profile_bg', b.id);
          return (
            <div key={b.id} onClick={actionClick('profile_bg', b.id)}
              className={`lobby-card-back ${owned ? 'owned' : 'locked'}`}
              style={{ cursor: equipped ? 'default' : 'pointer', outline: equipped ? '2px solid #10B981' : 'none' }}
            >
              <div className="lobby-card-back-preview" style={{ background: b.bg }} />
              <span className="lobby-card-back-name">{b.name}</span>
              <span className="lobby-card-back-price" style={{ color: equipped ? '#10B981' : '#00D9FF' }}>
                {equipped ? 'Applied' : owned ? 'Apply' : `${b.price} ⭐`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Boosters — consumable XP / chip multipliers */}
      <SectionHeader>Boosters</SectionHeader>
      <div className="lobby-vip-packages">
        {[
          { id: 'xp_2x_15m',    name: '2× XP — 15 min',  desc: 'Doubles XP from wins for 15 minutes',   price: 200,  color: '#A78BFA' },
          { id: 'xp_2x_1h',     name: '2× XP — 1 hour',  desc: 'Doubles XP from wins for 1 hour',       price: 600,  color: '#8B5CF6' },
          { id: 'xp_2x_1d',     name: '2× XP — 1 day',   desc: 'Doubles XP from wins for 24 hours',     price: 2500, color: '#6D28D9' },
          { id: 'chip_1p5x_1h', name: '1.5× Chips — 1h', desc: '+50% chip bonus on big wins (1 hour)',  price: 400,  color: '#F59E0B' },
          { id: 'chip_1p5x_1d', name: '1.5× Chips — 1d', desc: '+50% chip bonus on big wins (1 day)',   price: 2000, color: '#D97706' },
        ].map((b) => (
          <div key={b.id} className="lobby-vip-package-card" style={{ borderLeftColor: b.color }}>
            <div>
              <div style={{ color: b.color, fontWeight: 700, fontSize: '0.95rem' }}>{b.name}</div>
              <div style={{ color: '#8888AA', fontSize: '0.8rem' }}>{b.desc}</div>
            </div>
            <button className="btn-accent" style={{ padding: '6px 16px', fontSize: '0.8rem' }} onClick={() => onBuy('booster', b.id)}>
              {b.price.toLocaleString()} ⭐
            </button>
          </div>
        ))}
      </div>

      {/* VIP Passes */}
      <SectionHeader>VIP Passes</SectionHeader>
      <div className="lobby-vip-packages">
        {[
          { id: 'daily',    name: 'Daily VIP',    desc: '24 hours of premium perks',     price: 300,   color: '#06B6D4' },
          { id: 'weekly',   name: 'Weekly VIP',   desc: '7 days of premium perks',       price: 1500,  color: '#3B82F6' },
          { id: 'monthly',  name: 'Monthly VIP',  desc: '30 days of premium perks',      price: 5000,  color: '#8B5CF6' },
          { id: 'lifetime', name: 'Lifetime VIP', desc: 'All premium perks, forever',    price: 50000, color: '#FFD700' },
        ].map((v) => (
          <div key={v.id} className="lobby-vip-package-card" style={{ borderLeftColor: v.color }}>
            <div>
              <div style={{ color: v.color, fontWeight: 700, fontSize: '0.95rem' }}>{v.name}</div>
              <div style={{ color: '#8888AA', fontSize: '0.8rem' }}>{v.desc}</div>
            </div>
            <button className="btn-accent" style={{ padding: '6px 16px', fontSize: '0.8rem' }} onClick={() => onBuy('vip_pass', v.id)}>
              {v.price.toLocaleString()} ⭐
            </button>
          </div>
        ))}
      </div>

      {/* Bundles — multi-item grants */}
      <SectionHeader>Bundle Deals</SectionHeader>
      <div className="lobby-vip-packages">
        {[
          { id: 'starter',       name: '🎁 Starter Bundle',    desc: '3 items — Silver Foil back, Nice Hand emote, Bronze frame',                price: 800,   color: '#84CC16' },
          { id: 'collector',     name: '📦 Collector Bundle',  desc: '5 items — Gold back, Casino Royale, Silver frame, Crown emote, Chip Rain', price: 2500,  color: '#06B6D4' },
          { id: 'tournament',    name: '🏆 Tournament Bundle', desc: '6 items — Tournament Champ title + premium cosmetics',                     price: 4000,  color: '#F59E0B' },
          { id: 'whale_bundle',  name: '🐋 Whale Bundle',      desc: '8 items — Royal title, Cosmic Nebula, Diamond frame + more',               price: 10000, color: '#A78BFA' },
          { id: 'mythic_bundle', name: '✨ Mythic Bundle',     desc: '9 items — Everything mythic-tier: God Mode title, Supernova, Mythic frame', price: 25000, color: '#FF1744' },
        ].map((b) => (
          <div key={b.id} className="lobby-vip-package-card" style={{ borderLeftColor: b.color }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: b.color, fontWeight: 700, fontSize: '0.95rem' }}>{b.name}</div>
              <div style={{ color: '#8888AA', fontSize: '0.78rem', lineHeight: 1.35 }}>{b.desc}</div>
            </div>
            <button className="btn-accent" style={{ padding: '6px 16px', fontSize: '0.8rem' }} onClick={() => onBuy('bundle', b.id)}>
              {b.price.toLocaleString()} ⭐
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: '24px', padding: '12px', textAlign: 'center', color: '#8888AA', fontSize: '0.8rem', background: 'rgba(0,217,255,0.05)', borderRadius: '8px', border: '1px solid rgba(0,217,255,0.15)' }}>
        💡 Earn ⭐ stars by playing hands, winning pots, daily spins, leveling up, and completing missions/achievements.
      </div>

    </div>
  );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'home': return renderHomeTab();
      case 'play': return renderPlayTab();
      case 'social': return renderSocialTab();
      case 'profile': return renderProfileTab();
      case 'shop': return renderShopTab();
      default: return renderHomeTab();
    }
  };

  return (
    <div className="lobby">
      {/* Floating particles */}
      <div className="lobby-particles">
        <span /><span /><span /><span /><span />
        <span /><span /><span /><span /><span />
      </div>

      {/* Join-in-progress overlay — blocks interaction until server confirms
          our seat via a gameState carrying yourSeat, or the 8s watchdog fires. */}
      {joining && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', inset: 0, zIndex: 3000,
            background: 'rgba(5,8,18,0.72)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            background: 'linear-gradient(135deg,#0d0d2a,#1a1a4e)',
            padding: '26px 32px', borderRadius: 16, textAlign: 'center',
            border: '1px solid rgba(0,217,255,0.3)', color: '#e0e0e0',
            minWidth: 260, boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
          }}>
            <div style={{
              width: 40, height: 40, margin: '0 auto 16px',
              border: '3px solid rgba(0,217,255,0.25)', borderTopColor: '#00D9FF',
              borderRadius: '50%', animation: 'lobbyJoinSpin 0.9s linear infinite',
            }} />
            <div style={{ fontWeight: 700, fontSize: 16, color: '#00D9FF' }}>{joining.label}</div>
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6 }}>Seating you at the table…</div>
            <style>{`@keyframes lobbyJoinSpin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      )}

      {/* Join error toast — shown briefly if the server didn't seat us in time */}
      {joinError && !joining && (
        <div
          role="alert"
          style={{
            position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)',
            zIndex: 3100, background: 'rgba(120,20,20,0.96)', color: '#fff',
            padding: '10px 18px', borderRadius: 10, fontSize: 13, maxWidth: 320,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            border: '1px solid rgba(239,68,68,0.6)',
          }}
          onClick={() => setJoinError(null)}
        >
          ⚠ {joinError} <span style={{ opacity: 0.7, marginLeft: 8 }}>(tap to dismiss)</span>
        </div>
      )}

      {/* Waitlist context banner — shown when player deep-linked from player app */}
      {waitlistContext && (
        <div style={{
          padding: '10px 16px',
          background: 'linear-gradient(90deg, #f59e0b, #d97706)',
          color: '#0f172a',
          fontSize: '13px',
          fontWeight: 600,
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}>
          ⏳ You're {waitlistContext.position ? `#${waitlistContext.position} ` : ''}
          on the waitlist{waitlistContext.venue ? ` for ${waitlistContext.venue}` : ''}
          {waitlistContext.startTime
            ? ` at ${new Date(waitlistContext.startTime).toLocaleString([], { weekday:'short', hour:'numeric', minute:'2-digit' })}`
            : ''}
          {' — '}playing at Beginner's Table while you wait
        </div>
      )}

      {/* Top Bar - always visible */}
      <div className="lobby-top-bar">
        <div className="lobby-top-bar-left">
          <span className="lobby-top-bar-name">{nameInput || 'Player'}</span>
          {/* Animated chip counter */}
          <span className={`lobby-top-bar-chips ${chipsPulse ? 'lobby-chips--pulse' : ''}`}>
            🪙 {animatedChips.toLocaleString()}
          </span>
          {/* Live tables + live player count */}
          {tables.length > 0 && (
            <span className="lobby-live-badge">
              <span className="lobby-live-dot" />
              {tables.length} live
            </span>
          )}
          {totalPlayersOnline > 0 && (
            <span className="lobby-online-count">👥 {totalPlayersOnline.toLocaleString()} playing</span>
          )}
          {/* Connection status */}
          <span className={`lobby-conn-pill ${connected ? 'lobby-conn-pill--on' : 'lobby-conn-pill--off'}`}>
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
            {connected ? 'Online' : 'Offline'}
          </span>
        </div>
        <div className="lobby-top-bar-right">
          <NotificationCenter />
          <ThemeToggle />
          <button
            className="lobby-top-bar-settings"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            &#9881;
          </button>
          <button
            className="lobby-top-bar-settings"
            onClick={() => setShowAdminDashboard(true)}
            title="Admin"
            style={{ fontSize: '0.7rem', color: '#F97316' }}
          >
            Admin
          </button>
          {isLoggedIn && (
            <button
              className="lobby-top-bar-settings"
              onClick={logout}
              title="Logout"
              style={{ fontSize: '0.75rem', color: '#F87171' }}
            >
              Logout
            </button>
          )}
        </div>
      </div>

      {/* #1 Activity ticker */}
      <div className="activity-ticker">
        <span className="activity-ticker-live">● LIVE</span>
        <span className={`activity-ticker-text ${activityFading ? 'activity-ticker-text--fade' : ''}`}>
          {ACTIVITY_EVENTS[activityIdx]}
        </span>
      </div>

      {/* Tab Content with fade transitions */}
      {renderTabContent()}

      {/* ─── Overlay components (preserved) ─── */}
      {showStats && <StatsPanel onClose={() => setShowStats(false)} />}
      {showShop && <ThemeShop onClose={() => setShowShop(false)} />}
      {showLeaderboard && <Leaderboard onClose={() => setShowLeaderboard(false)} />}
      {showFriends && <FriendSystem onClose={() => setShowFriends(false)} />}
      {showUnlocks && <UnlocksPanel onClose={() => setShowUnlocks(false)} />}
      {showVIP && <VIPPanel onClose={() => setShowVIP(false)} />}
      {showBattlePass && <BattlePass onClose={() => setShowBattlePass(false)} />}
      {showCreateTable && (
        <CreateTableModal
          onClose={() => setShowCreateTable(false)}
          playerName={nameInput.trim() || 'Guest'}
          avatar={avatar}
        />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showLoginRewards && (
        <LoginRewards
          onClose={() => {
            setShowLoginRewards(false);
            // Remember that we closed the modal TODAY so the auto-open
            // effect doesn't re-show it on the next nav/re-mount.
            // Scoped to sessionStorage so it naturally resets tomorrow.
            try {
              const today = new Date();
              const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
              sessionStorage.setItem('app_poker_login_rewards_dismissed', todayStr);
            } catch { /* ignore */ }
          }}
          autoOpened={loginRewardsAutoOpened}
        />
      )}
      {seatPickerTable && (
        <SeatPicker
          table={seatPickerTable}
          playerName={nameInput.trim()}
          avatar={avatar}
          onJoin={handleSeatSelected}
          onClose={() => setSeatPickerTable(null)}
        />
      )}
      {/* Lazy-mounted modal panels share a single Suspense boundary so
          their chunks only download when the user opens them. Fallback
          is null — the click triggers the modal open, the chunk loads
          (usually <100ms on warm CDN), and the panel slides in. */}
      <Suspense fallback={null}>
        {showEquityCalc && <EquityCalculator onClose={() => setShowEquityCalc(false)} />}
        {showRangeChart && <HandRangeChart onClose={() => setShowRangeChart(false)} />}
        {showLeakFinder && <LeakFinder onClose={() => setShowLeakFinder(false)} />}
        {showBankrollGraph && <BankrollGraph onClose={() => setShowBankrollGraph(false)} />}
        {showAdminDashboard && <AdminDashboard onClose={() => setShowAdminDashboard(false)} />}
        {showExportData && <ExportData onClose={() => setShowExportData(false)} />}
        {showHandQuiz && <HandQuiz onClose={() => setShowHandQuiz(false)} />}
        {showAdvancedAnalytics && <AdvancedAnalytics progress={progress} handHistories={handHistories || []} onClose={() => setShowAdvancedAnalytics(false)} />}
        {showStakingMarketplace && <StakingMarketplace onClose={() => setShowStakingMarketplace(false)} />}
        {showTournamentBracket && <TournamentBracket onClose={() => setShowTournamentBracket(false)} />}
        {showTournamentDirector && <TournamentDirector onClose={() => setShowTournamentDirector(false)} />}
        {showHandHistoryImporter && <HandHistoryImporter onClose={() => setShowHandHistoryImporter(false)} />}
        {showSocialBracket && <SocialBracket socket={null} onClose={() => setShowSocialBracket(false)} />}
        {showBankrollAI && <BankrollAI currentChips={chipCount} onClose={() => setShowBankrollAI(false)} />}
        {showNFTBadges && <NFTBadges unlockedAchievementIds={progress?.achievements || []} onClose={() => setShowNFTBadges(false)} />}
      </Suspense>
      {/* Eagerly-loaded panels that live inside the default Lobby view
          or are opened so frequently that the lazy round-trip wouldn't
          help. */}
      {showClubs && <ClubsPanel onClose={() => setShowClubs(false)} />}
      {showSpinWheel && <SpinWheel onClose={() => setShowSpinWheel(false)} />}
      {showScratchCards && <ScratchCards onClose={() => setShowScratchCards(false)} />}
      {showMultiTable && <MultiTableView onClose={() => setShowMultiTable(false)} />}
      {showPlayerProfile && <PlayerProfile username={nameInput || 'Player'} socket={null} onClose={() => setShowPlayerProfile(false)} onViewReplay={() => {}} />}
    </div>
  );
}
