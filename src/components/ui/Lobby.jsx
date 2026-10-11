import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { useProgressStore, serverWinRate, vipPassActive, equippedIdFor, dailyLoginClaimable } from '../../store/progressStore';
import ProgressBar from './ProgressBar';
import MissionsPanel, { missionIcon } from './MissionsPanel';
import { formatCountdown, nextDenverMidnightMs, denverDateKey } from '../../utils/denverTime';
import { PROFILE_BGS } from '../../utils/economyCatalog';
import { ownHandResult } from '../../utils/handLog';
import { lifetimeAchievementRows, sortAchievementRows } from '../../utils/achievementCatalog';
import StatsPanel from './StatsPanel';
import BattlePass from './BattlePass';
import ShopTab from './ShopTab';
import RankBadge, { getRankInfo, getNextRankInfo, RANK_TIERS } from './RankBadge';
import CreateTableModal from './CreateTableModal';
import TournamentLobby from './TournamentLobby';
import QualifierLobby from './QualifierLobby';
import Leaderboard, { BadgeIcons } from './Leaderboard';
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
const HandReplayViewer    = lazy(() => import('../replay/HandReplayViewer'));
// Kept eager — rendered in the default lobby view, not gated behind a modal.
import ClubsPanel from './ClubsPanel';
import SpinWheel, { spinSeenToday, markSpinSeenToday } from './SpinWheel';
import ScratchCards from './ScratchCards';
import MultiTableView from './MultiTableView';
import PlayerProfile from './PlayerProfile';
import { getSocket } from '../../services/socketService';
import { reportPlayRefusal, runPlayFlow, GAME_SERVER_UNREACHABLE_TEXT } from '../../services/playRefusal';
import { openLiveTableOverlay } from '../../store/liveTableOverlayStore';
// 2026-10-10 (round 3) — the join-error toast stacks below the fixed
// "Return to tournament" banner (the banner reports its bottom edge in the
// tournament-seat store field `bannerBottom`; TournamentSeatNotice.jsx).
import { useTournamentSeatStore } from '../../store/tournamentSeatStore';
import { PlayerAvatar } from '../../hooks/useAvatar';
import { profileTargetOf, profileTargetFromParam } from '../../utils/profileTarget';
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

// R2 (APPUI-49) — achievements are the server's (utils/achievementCatalog);
// the lobby's own list used ids the server never awards.

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

// R2 (C7) — the equipped profile background as the profile banner's style.
function profileBannerStyle(progress) {
  const id = equippedIdFor(progress, 'profile_bg');
  const bg = id && id !== 'default' ? PROFILE_BGS.find((b) => b.id === id)?.bg : null;
  return bg ? { background: bg } : undefined;
}

// ─── Mission Strip ───
// 2026-10-11 (R2, C6 / APPUI-3) — the server's missions (playerProgress
// .missions); tapping any of them opens the Missions panel, where they are
// claimed. No placeholder missions: before the server answers it says so.
function missionRewardShort(r) {
  if (!r) return '';
  if (r.chips > 0) return `+${r.chips >= 1000 ? `${(r.chips / 1000).toFixed(r.chips % 1000 ? 1 : 0)}k` : r.chips}`;
  if (r.stars > 0) return `+${r.stars}⭐`;
  if (r.xp > 0) return `+${r.xp} XP`;
  return '';
}

function MissionStrip({ missions, onOpenMissions }) {
  const timeStr = formatCountdown(nextDenverMidnightMs());
  const list = Array.isArray(missions) ? missions.slice(0, 3) : null;
  const ready = (list || []).filter((m) => m.completed && !m.claimed).length;

  return (
    <div className="mission-strip">
      <button type="button" className="mission-strip-header mission-strip-open" onClick={onOpenMissions}>
        <span className="mission-strip-title">📋 Daily Missions{ready > 0 ? ` · ${ready} to claim` : ''}</span>
        <span className="mission-strip-refresh">New in {timeStr}</span>
      </button>
      <div className="mission-strip-scroll">
        {list === null && (
          <div className="mission-chip mission-chip--loading" onClick={onOpenMissions}>
            <span className="mission-chip-icon">🎯</span>
            <div className="mission-chip-body"><div className="mission-chip-name">Loading today's missions…</div></div>
          </div>
        )}
        {(list || []).map((m) => {
          const pct = Math.min(100, (m.progress / Math.max(1, m.target)) * 100);
          const claimable = m.completed && !m.claimed;
          return (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              className={`mission-chip ${m.completed ? 'mission-chip--done' : ''} ${claimable ? 'mission-chip--claimable' : ''} ${m.claimed ? 'mission-chip--claimed' : ''}`}
              onClick={onOpenMissions}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenMissions(); } }}
            >
              <span className="mission-chip-icon">{missionIcon(m)}</span>
              <div className="mission-chip-body">
                <div className="mission-chip-name">{m.description}</div>
                <div className="mission-chip-bar-track">
                  <div className="mission-chip-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="mission-chip-prog">{m.claimed ? 'Claimed' : claimable ? 'Tap to claim' : `${m.progress}/${m.target}`}</div>
              </div>
              <div className="mission-chip-xp">{missionRewardShort(m.reward)}</div>
              {m.completed && <div className="mission-chip-check">✓</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sparkline SVG ───
function Sparkline({ data, width = 120, height = 36, color = '#ffd24a' }) {
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
  const lineColor = isUp ? '#4ADE80' : '#60A5FA';
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
function ProgressRing({ pct, size = 56, stroke = 3, color = '#ffd24a', children }) {
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
function InlineFriendsList({ onOpenProfile }) {
  // 2026-06-18 Phase 3b — real friends from poker-server (was sessionStorage mock).
  const [friends, setFriends] = useState([]);
  const [inviteSent, setInviteSent] = useState(null);
  // R2 (APPUI-47) — an invite names the table he is SEATED at (never a
  // spectated or stale one); with no seat there is nothing to invite to, so
  // Invite is not offered (it used to send an invite with no table).
  const inviteTableId = useTableStore((s) => {
    const gs = s.gameState;
    const seated = gs && gs.isSpectator !== true && !s.isSpectating && Number.isInteger(gs.yourSeat) && gs.yourSeat >= 0;
    return seated && gs.tableId != null ? gs.tableId : null;
  });

  useEffect(() => {
    const s = getSocket();
    if (!s) return undefined;
    const onList = (d) => setFriends((d?.friends || []).filter((f) => f.status === 'accepted'));
    const onChanged = () => { if (s.connected) s.emit('getFriends'); };
    s.on('friendsList', onList);
    s.on('friendsChanged', onChanged);
    if (s.connected) s.emit('getFriends');
    const t = setTimeout(() => { if (s.connected) s.emit('getFriends'); }, 600);
    return () => { clearTimeout(t); s.off('friendsList', onList); s.off('friendsChanged', onChanged); };
  }, []);

  const statusColors = { online: '#27e0a0', 'in-game': '#ffd24a', offline: '#8298c4' };
  const statusLabels = { online: 'Online', 'in-game': 'In Game', offline: 'Offline' };
  const order = { online: 0, 'in-game': 1, offline: 2 };
  const sortedFriends = [...friends].sort((a, b) => (order[a.presence] ?? 3) - (order[b.presence] ?? 3));
  const onlineCount = friends.filter((f) => f.presence === 'online' || f.presence === 'in-game').length;

  const handleInvite = (friend) => {
    if (!inviteTableId) return;
    const s = getSocket();
    if (s?.connected) s.emit('inviteFriendToTable', { userId: friend.userId, tableId: inviteTableId });
    setInviteSent(friend.userId);
    setTimeout(() => setInviteSent(null), 2000);
  };

  return (
    <div className="inline-friends-list">
      <div className="inline-friends-header">
        <span className="inline-friends-online-count">{onlineCount} / {friends.length} online</span>
      </div>
      {sortedFriends.length === 0 && (
        <div style={{ padding: 8, color: '#8298c4', fontSize: '0.8rem', textAlign: 'center' }}>
          No friends yet — add some in the Friends panel.
        </div>
      )}
      {sortedFriends.map((friend) => {
        const name = String(friend.username ?? 'Player');
        const target = onOpenProfile ? profileTargetOf(friend, name) : null;
        return (
        <div key={friend.userId} className="inline-friend-card">
          <div className="inline-friend-avatar" style={{ borderColor: statusColors[friend.presence] }}>
            {name.charAt(0).toUpperCase()}
            <span className="inline-friend-dot" style={{ background: statusColors[friend.presence] }} />
          </div>
          <div
            className={`inline-friend-info ${target ? 'inline-friend-info--link' : ''}`}
            onClick={target ? () => onOpenProfile(target) : undefined}
          >
            <div className="inline-friend-name">{name}</div>
            <div className="inline-friend-status" style={{ color: statusColors[friend.presence] }}>
              {statusLabels[friend.presence]}
            </div>
          </div>
          {friend.presence === 'online' && inviteTableId && (
            <button
              className="inline-friend-invite-btn"
              onClick={() => handleInvite(friend)}
              disabled={inviteSent === friend.userId}
              title="Invite to the table you are seated at"
            >
              {inviteSent === friend.userId ? 'Sent!' : 'Invite'}
            </button>
          )}
          {friend.presence === 'in-game' && (
            <span style={{ fontSize: '0.65rem', color: '#ffd24a' }}>Playing…</span>
          )}
        </div>
        );
      })}
    </div>
  );
}

// ─── Inline Leaderboard (simplified, non-overlay) ───
function InlineLeaderboard({ onOpenProfile }) {
  const [entries, setEntries] = useState(null);
  // 2026-06-18 Phase 3b — real leaderboard from poker-server (was MOCK_NAMES).
  // R2 (APPUI-50 / addendum) — only the ALL-TIME answer is shown here (the
  // full board's Weekly / Daily / Season answers arrive on the same event and
  // used to replace it under an all-time look), "you" is the server's isYou.
  useEffect(() => {
    const s = getSocket();
    if (!s) return undefined;
    const onData = (d) => { if (d && d.period === 'alltime') setEntries(Array.isArray(d.entries) ? d.entries : []); };
    s.on('leaderboardData', onData);
    if (s.connected) s.emit('getLeaderboard', { period: 'alltime' });
    const t = setTimeout(() => { if (s.connected) s.emit('getLeaderboard', { period: 'alltime' }); }, 600);
    return () => { clearTimeout(t); s.off('leaderboardData', onData); };
  }, []);

  const getRankIcon = (rank) => {
    if (rank === 1) return '\u{1F947}';
    if (rank === 2) return '\u{1F948}';
    if (rank === 3) return '\u{1F949}';
    return `#${rank}`;
  };

  const data = (entries || []).slice(0, 8).map((e, i) => {
    const name = String(e.displayName ?? e.username ?? 'Player');
    return {
      name,
      chips: Number(e.chips) || 0,
      rank: Number(e.rank) || i + 1,
      isYou: e.isYou === true,
      // R2 — the row's opaque public id (or his own row): opens that profile exactly.
      target: profileTargetOf(e, name),
      badges: e.badges,
    };
  });

  return (
    <div className="inline-leaderboard">
      <div className="inline-lb-caption">All-time · ranked by chip balance</div>
      {entries === null && (
        <div className="inline-lb-row" style={{ opacity: 0.6, justifyContent: 'center' }}>Loading leaderboard…</div>
      )}
      {entries !== null && data.length === 0 && (
        <div className="inline-lb-row" style={{ opacity: 0.6, justifyContent: 'center' }}>No ranked players yet.</div>
      )}
      {data.map((entry) => {
        const canOpen = typeof onOpenProfile === 'function' && entry.target != null;
        return (
          <div
            key={`${entry.rank}-${entry.name}`}
            className={`inline-lb-row ${entry.isYou ? 'inline-lb-row-current' : ''} ${entry.rank <= 3 ? 'inline-lb-row-top' : ''} ${canOpen ? 'inline-lb-row-link' : ''}`}
            onClick={canOpen ? () => onOpenProfile(entry.target) : undefined}
          >
            <span className="inline-lb-rank">{getRankIcon(entry.rank)}</span>
            <PlayerAvatar playerId={entry.name} name={entry.name} size={24} style={{ flexShrink: 0 }} />
            <span className="inline-lb-name">{entry.name}{entry.isYou ? ' (you)' : ''}<BadgeIcons badges={entry.badges} /></span>
            <span className="inline-lb-chips">{entry.chips.toLocaleString()}</span>
          </div>
        );
      })}
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
export default function Lobby({ activeTab = 'home', onTabChange, pwaAction = null, onPwaActionConsumed = null, waitlistContext = null }) {
  const setScreen = useGameStore((s) => s.setScreen);
  const playerName = useGameStore((s) => s.playerName);
  const setPlayerName = useGameStore((s) => s.setPlayerName);
  const chips = useGameStore((s) => s.chips);
  const avatar = useGameStore((s) => s.avatar);

  const logout = useGameStore((s) => s.logout);
  const isLoggedIn = useGameStore((s) => s.isLoggedIn);
  // 2026-10-09 (D1 / T2) — the explicit Sign Out waits (≤2s) for
  // poker-server's 'revokeSignInTokens' acknowledgement before the session is
  // torn down.
  const signingOut = useGameStore((s) => s.signingOut);

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
  const tournamentBannerUp = useTournamentSeatStore((s) => s.awaySeats.length > 0 || !!s.notice);
  const tournamentBannerBottom = useTournamentSeatStore((s) => s.bannerBottom);
  // "Broke refill" — when the wallet drops below the cheapest cash table's
  // 5,000 min buy-in, the player can claim unlimited +5,000 top-ups to keep
  // playing (server enforces the < 5,000 gate). Drives the banner button.
  const [refilling, setRefilling] = useState(false);
  const [refillToast, setRefillToast] = useState(null); // null | { ok: bool, text }
  const refillTimerRef = useRef(null);
  // 2026-07-06 audit P2 — capture the seat we were ALREADY on (if any) when a
  // join starts. The watchdog below must not transition to 'table' on that
  // stale prior-table payload — only on a genuinely NEW seating. Signature is
  // `${tableId}:${seatIndex}`; null when not currently seated. Works for both
  // targeted joins (join table B) and matchmaking (server picks the table).
  const seatSig = (gs) =>
    (gs?.yourSeat >= 0 && gs?.seats?.[gs.yourSeat]?.playerName)
      ? `${gs.tableId ?? '?'}:${gs.yourSeat}`
      : null;
  // 2026-10-07 — the play-refusal replay (services/playRefusal.js): when a
  // join is refused login_required on a tab that is still signed in (socket
  // reconnected and not re-authenticated yet), the socket is re-authenticated
  // silently and the WHOLE join — spinner and seat watcher included — is run
  // again once via the latest beginJoin. Skipped if the Lobby has unmounted.
  const beginJoinRef = useRef(null);
  const lobbyMountedRef = useRef(false);
  useEffect(() => {
    lobbyMountedRef.current = true;
    return () => { lobbyMountedRef.current = false; };
  }, []);
  const beginJoin = (label, action) => {
    setJoinError(null);
    setJoining({ since: Date.now(), label, fromSig: seatSig(gameState) });
    try {
      runPlayFlow(() => {
        if (lobbyMountedRef.current && beginJoinRef.current) beginJoinRef.current(label, action);
      }, action);
    } catch (e) {
      setJoining(null);
      setJoinError(e?.message || 'Could not start join — try again.');
    }
  };
  useEffect(() => { beginJoinRef.current = beginJoin; });
  // Watch for gameState with our seat — that's the signal that the server
  // has accepted us and play can begin. `gameState.yourSeat >= 0` with a
  // playerName confirms we're actually seated, not just receiving spectator
  // state or a stale previous-table payload.
  useEffect(() => {
    if (!joining) return;
    // 2026-07-06 audit P2 — require a seated signature that DIFFERS from the one
    // captured at join start. Without this, beginning a join while a stale
    // prior-table gameState still shows us seated transitioned instantly to
    // that OLD table, orphaning the new join.
    const sig = seatSig(gameState);
    if (sig && sig !== joining.fromSig) {
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
      // 2026-10-07 — a suspension / account-required refusal (codes
      // player_suspended, login_required, guest_disabled) is shown verbatim by
      // the shared PlayRefusalNotice, which also offers sign-in. Don't show it
      // a second time in the banner below.
      if (reportPlayRefusal(err)) { setJoinError(null); return; }
      setJoinError(err.message || 'Server rejected the join.');
    };
    socket.on('error', onServerError);
    socket.on('joinError', onServerError);
    return () => {
      socket.off('error', onServerError);
      socket.off('joinError', onServerError);
    };
  }, [joining]);

  // Broke-refill claim. The refilled balance itself arrives via the normal
  // playerProgress → gameStore.chips sync (App.jsx), so we only drive the
  // button state + a small confirmation toast off the `refillResult` ack.
  const handleClaimRefill = () => {
    const socket = getSocket();
    if (!socket) { setRefillToast({ ok: false, text: 'Not connected — try again.' }); return; }
    setRefilling(true);
    setRefillToast(null);
    socket.emit('claimRefill');
    // Safety net: if the socket dropped and no ack returns, re-enable the button.
    if (refillTimerRef.current) clearTimeout(refillTimerRef.current);
    refillTimerRef.current = setTimeout(() => {
      refillTimerRef.current = null;
      setRefilling(false);
      setRefillToast({ ok: false, text: 'Timed out — try again.' });
    }, 8000);
  };
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onRefill = (res) => {
      if (refillTimerRef.current) { clearTimeout(refillTimerRef.current); refillTimerRef.current = null; }
      setRefilling(false);
      if (res?.success) {
        setRefillToast({ ok: true, text: `+${(res.added || 5000).toLocaleString()} chips added. Good luck!` });
        setTimeout(() => setRefillToast(null), 3500);
      } else if (res?.error === 'not_broke') {
        // Balance already recovered (a hand paid out / grant landed) — silently clear.
        setRefillToast(null);
      } else if (res?.error === 'chips_on_table') {
        // R2 (addendum / ECON-19) — the server's own sentence: he still has
        // chips at a table, so the refill is not for him right now.
        setRefillToast({ ok: false, text: typeof res.message === 'string' && res.message ? res.message : 'You still have chips at a table — the refill is only for an empty bankroll.' });
      } else {
        setRefillToast({ ok: false, text: 'Could not add chips — try again.' });
      }
    };
    socket.on('refillResult', onRefill);
    return () => socket.off('refillResult', onRefill);
  }, []);

  // Session tracker — R2 (APPUI-15): "This Session" counts his own LIVE
  // hands (progressStore.session: hands / wins / net from his row of each
  // hand), not the length of the table store's list (cleared when he leaves
  // a table, refilled from the server at sign-in) or wallet swings (buy-ins).
  const session = useProgressStore((s) => s.session);
  const handLog = useProgressStore((s) => s.handLog);
  const sessionHands = session?.hands || 0;
  const sessionNet = session?.net || 0;

  // (R2 — the lobby's own achievement toast is gone: it duplicated the
  // server-driven "Achievement Unlocked!" toast.)

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

  // R2 (APPUI-36) — the daily reward is claimable when the SERVER's Denver
  // claim date (playerProgress.lastLoginClaimDate) is not today's Denver date.
  // (The banner used to read a sessionStorage key nothing wrote, so it showed
  // "Daily Bonus Ready!" for a reward already claimed.)
  const dailyClaimable = dailyLoginClaimable(progress);

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
  // Honest generic filler shown ONLY when there's no real recent activity yet —
  // no fabricated player names/amounts (that was the old fake ticker).
  const ACTIVITY_FALLBACK = [
    '♠ Welcome to American Pub Poker',
    '🃏 Join a table to start playing',
    '🏆 Climb the leaderboard for championship seats',
    '🎁 Claim your daily bonus every 24 hours',
  ];
  // Real recent activity streamed from the server (big wins, tournament wins).
  const [liveActivity, setLiveActivity] = useState([]);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onFeed = (feed) => { if (Array.isArray(feed)) setLiveActivity(feed); };
    socket.on('activityFeed', onFeed);
    return () => socket.off('activityFeed', onFeed);
  }, []);
  const activityEvents = liveActivity.length > 0 ? liveActivity : ACTIVITY_FALLBACK;
  const [activityIdx, setActivityIdx] = useState(0);
  const [activityFading, setActivityFading] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      setActivityFading(true);
      setTimeout(() => {
        setActivityIdx(i => (i + 1) % activityEvents.length);
        setActivityFading(false);
      }, 400);
    }, 4000);
    return () => clearInterval(timer);
  }, [activityEvents.length]);

  const [showStats, setShowStats] = useState(false);
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
  // R2 (APPUI-38) — the Shop's "Reveal" opens the scratch panel and scratches
  // one card right away, so the result is shown (it used to emit
  // claimScratchCard with nobody listening).
  const [scratchAutoStart, setScratchAutoStart] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [showExportData, setShowExportData] = useState(false);
  const [replayHand, setReplayHand] = useState(null);
  const [showAdvancedAnalytics, setShowAdvancedAnalytics] = useState(false);
  const [showStakingMarketplace, setShowStakingMarketplace] = useState(false);
  const [showTournamentBracket, setShowTournamentBracket] = useState(false);
  const [bracketTournament, setBracketTournament] = useState(null);
  // Live Bracket: while the modal is open, fetch the running tournament's
  // standings (the server defaults to the first running one) and poll for
  // updates. TournamentBracket renders empty without this `tournament` prop.
  useEffect(() => {
    if (!showTournamentBracket) { setBracketTournament(null); return; }
    const socket = getSocket();
    if (!socket) return;
    const onStandings = (data) => setBracketTournament(data || null);
    socket.on('tournamentStandings', onStandings);
    const fetchStandings = () => socket.emit('getTournamentStandings', {});
    fetchStandings();
    const iv = setInterval(fetchStandings, 3000);
    return () => { clearInterval(iv); socket.off('tournamentStandings', onStandings); };
  }, [showTournamentBracket]);
  const [showTournamentDirector, setShowTournamentDirector] = useState(false);
  // Success toast surfaced when the server acks a custom tournament create
  // (`customTournamentCreated { tournamentId, name }`). null | { text }.
  const [tdNotice, setTdNotice] = useState(null);
  // Emitted by the TournamentDirector wizard's Create button. The server
  // handler is admin-gated; non-admins get a `socialBracketError`-style
  // rejection there (surfaced via the generic error toast). We just fire the
  // event and close the director — success is confirmed by the listener below.
  const handleCreateCustomTournament = useCallback((config) => {
    getSocket()?.emit('createCustomTournament', { config });
    setShowTournamentDirector(false);
  }, []);
  // Listen for the create ack + refresh the tournament list so the new event
  // shows up immediately.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onCreated = (data) => {
      setTdNotice({ text: `✓ Tournament created: ${data?.name || 'Custom Tournament'}` });
      socket.emit('getTournaments');
      setTimeout(() => setTdNotice(null), 4000);
    };
    socket.on('customTournamentCreated', onCreated);
    return () => socket.off('customTournamentCreated', onCreated);
  }, []);
  const [showHandHistoryImporter, setShowHandHistoryImporter] = useState(false);
  const [showMultiTable, setShowMultiTable] = useState(false);
  // 2026-10-09 (R2) — the multi-table overlay puts live tables on screen: the
  // (lobby-only) guest carry-over prompt waits until it closes, never covers
  // play (store/liveTableOverlayStore.js).
  useEffect(() => (showMultiTable ? openLiveTableOverlay() : undefined), [showMultiTable]);
  const [showSocialBracket, setShowSocialBracket] = useState(
    () => { try { return !!new URLSearchParams(window.location.search).get('bracket'); } catch { return false; } }
  );
  const [showBankrollAI, setShowBankrollAI] = useState(false);
  // R2 (APPUI-14) — the profile on screen: { own: true } (his own, by
  // identity) or { publicId, userId, name } (another player, opened by id).
  const [profileTarget, setProfileTarget] = useState(null);
  const openProfile = useCallback((t) => { if (t) setProfileTarget(t); }, []);
  // A shared `?profile=<public id>` link (or an older `?profile=<user id>`) opens that profile once.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const id = url.searchParams.get('profile');
      if (!id) return;
      url.searchParams.delete('profile');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      const t = profileTargetFromParam(id);
      if (t) setProfileTarget(t);
    } catch { /* ignore */ }
  }, []);
  const [showNFTBadges, setShowNFTBadges] = useState(false);

  // Player search state
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');
  const [playerSearchResults, setPlayerSearchResults] = useState([]);
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);
  const [playerSearchError, setPlayerSearchError] = useState(null);
  const playerSearchTimerRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handleResults = (payload) => {
      const results = payload && Array.isArray(payload.results) ? payload.results : [];
      setPlayerSearchResults(results);
      setPlayerSearchError(payload && payload.error === 'login_required' ? 'Sign in to search for players.'
        : payload && payload.error === 'rate_limited' ? 'Too many searches — wait a moment.' : null);
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
  // R2 (APPUI-36) — opens once the server has said the reward is claimable
  // (hydrated progress), at most once per lobby visit, and not again on a
  // Denver day he closed it.
  const loginRewardsAutoRef = useRef(false);
  useEffect(() => {
    if (loginRewardsAutoRef.current || !dailyClaimable) return;
    loginRewardsAutoRef.current = true;
    let dismissedToday = false;
    try { dismissedToday = sessionStorage.getItem('app_poker_login_rewards_dismissed') === denverDateKey(); } catch { /* ignore */ }
    if (dismissedToday) return;
    setShowLoginRewards(true);
    setLoginRewardsAutoOpened(true);
  }, [dailyClaimable]);

  // Auto-show the daily spin once per Denver day until he spins (per
  // account on this device — SpinWheel writes the same key), 6s after the
  // lobby shows and never on top of the daily rewards.
  const playerUserId = useGameStore((s) => s.userId);
  const progressHydrated = progress?.hydrated === true;
  const spinUsedToday = progress?.dailySpinClaimed === true; // C5 (the server's Denver day)
  useEffect(() => {
    if (!progressHydrated || showLoginRewards || spinUsedToday) return undefined;
    if (spinSeenToday(playerUserId)) return undefined;
    const t = setTimeout(() => {
      if (!spinSeenToday(playerUserId)) {
        markSpinSeenToday(playerUserId);
        setShowSpinWheel(true);
      }
    }, 6000);
    return () => clearTimeout(t);
  }, [progressHydrated, showLoginRewards, playerUserId, spinUsedToday]);

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
      // 2026-06-19 fix: pass the table's variant as expectedVariant (6th arg) so
      // the server's variant-mismatch guard fires on the seat-picker path too —
      // previously omitted here, so a tableId that converted variant server-side
      // could seat you at the wrong game.
      joinTable(tbl.tableId, nameInput.trim(), seatIndex, tbl.minBuyIn || 1000, avatar, tbl.variant);
    });
  };

  // Auto-trigger PWA shortcut action once connected + name is set
  // 2026-10-11 (APPUI-12) — once per launch: App's consumePwaAction() answers
  // true only the first time (it then clears the action and the ?action= URL
  // parameter), so a later Lobby mount (Back to Lobby) never auto-joins again.
  useEffect(() => {
    if (!pwaAction || !connected || !nameInput.trim()) return;
    if (typeof onPwaActionConsumed === 'function' && onPwaActionConsumed('used') === false) return;
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

  // 2026-10-11 (APPUI-9) — the server's lifetime handsWon / totalHandsPlayed,
  // never the local hand count (that showed impossible 300%+ win rates).
  const winRate = serverWinRate(progress);
  const handsToday = progress?.handsToday ?? 0;
  const currentStreak = progress?.currentStreak ?? 0;
  const bestHand = progress?.bestHand || 'None yet';
  const biggestPot = progress?.biggestPot ?? 0;
  const currentLevel = progress?.level ?? 1;
  const currentXP = progress?.xp ?? 0;
  const xpToNextLevel = progress?.xpToNextLevel ?? 140;
  const xpPercent = xpToNextLevel > 0 ? Math.min((currentXP / xpToNextLevel) * 100, 100) : 0;
  const starCount = progress?.stars || 0;
  // R2 (APPUI-33) — the XP-rate tier is by cumulative season XP (totalXp),
  // the same number the server applies the perk on (not the per-level xp).
  const seasonXp = Number(progress?.totalXp) || 0;
  const vipTier = getVIPTier(seasonXp);

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

  // R2 (APPUI-15) — his own result in each of his last hands (newest first).
  const recentOwn = useMemo(() => {
    const out = [];
    for (let i = handLog.length - 1; i >= 0 && out.length < 3; i--) {
      const r = ownHandResult(handLog[i], playerName);
      if (r) out.push({ rec: handLog[i], r });
    }
    return out;
  }, [handLog, playerName]);

  // Achievements
  const unlockedAchievements = progress?.achievements || [];
  const achievementsWithStatus = sortAchievementRows(lifetimeAchievementRows(null, unlockedAchievements)).map((a) => ({
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
          <span className="upc-sparkline-trend" style={{ color: sparklineData[6] >= sparklineData[0] ? '#4ADE80' : '#60A5FA' }}>
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
        {/* Mini sparkline of real ELO history — honest empty state until the
            server populates enough trend data. Padding with the current elo
            would draw a fake flat line, so we only render a sparkline once
            there are >=2 DISTINCT elo values. */}
        <div className="upc-sparkline" style={{ marginTop: 8 }}>
          <span className="upc-sparkline-label">ELO trend</span>
          {(() => {
            const eh = progress?.eloHistory || [];
            const pts = eh.slice(-7).map(h => h.elo).filter(v => typeof v === 'number');
            const distinct = new Set(pts);
            if (distinct.size < 2) {
              return <span className="upc-sparkline-empty">No rank trend yet</span>;
            }
            return <Sparkline data={pts} width={110} height={28} />;
          })()}
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
            <div className="session-stat-val" style={{ color: sessionNet >= 0 ? '#4ADE80' : '#93C5FD' }}>
              {sessionNet >= 0 ? '+' : ''}{sessionNet.toLocaleString()}
            </div>
            <div className="session-stat-label">Net chips</div>
          </div>
          <div className="session-stat">
            <div className="session-stat-val">{Math.floor((Date.now() - (session?.startedAt || Date.now())) / 60000)}m</div>
            <div className="session-stat-label">Played</div>
          </div>
        </div>
        {sessionHands === 0 && <div className="session-card-empty">Play a hand to start tracking this session</div>}
      </div>
    );

    return (
    <div className="lobby-tab-content lobby-tab-fade lobby-home-layout" key="home">
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

        {/* Daily Bonus Banner — R2 (APPUI-36): shown while the server's
            Denver claim date says today's reward is unclaimed. */}
        {dailyClaimable && (
          <div className="daily-bonus-banner" onClick={() => { setShowLoginRewards(true); setLoginRewardsAutoOpened(false); }}>
            <span className="daily-bonus-icon">🎁</span>
            <div className="daily-bonus-text">
              <div className="daily-bonus-title">Daily Bonus Ready!</div>
              <div className="daily-bonus-sub">Tap to claim your reward</div>
            </div>
            <button className="daily-bonus-btn" onClick={(e) => { e.stopPropagation(); setShowLoginRewards(true); setLoginRewardsAutoOpened(false); }}>Claim</button>
          </div>
        )}

        {/* Mission Strip — the server's missions; opens the Missions panel (C6) */}
        <MissionStrip
          missions={progress?.missions ?? null}
          onOpenMissions={() => useProgressStore.getState().setMissionsExpanded(true)}
        />

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
            {recentOwn.length > 0 && (
              <span className="recent-hands-count">{recentOwn.length} shown</span>
            )}
          </div>
          {recentOwn.length > 0 ? (
            <div className="recent-hands-list">
              {recentOwn.map(({ rec, r }, i) => {
                const label = r.won ? (r.handName || 'Won') : r.folded ? 'Folded' : (r.handName || 'Lost');
                const amount = r.won ? `+${r.chipsWon.toLocaleString()}` : (typeof r.net === 'number' && r.net < 0 ? r.net.toLocaleString() : '—');
                return (
                  <div key={`${rec.handNumber}-${i}`} className={`recent-hand-item ${r.won ? 'rhi--win' : 'rhi--loss'}`} onClick={() => setReplayHand(rec)} role="button" tabIndex={0}>
                    <span className="rhi-icon">{r.won ? '🏆' : r.folded ? '🃏' : '📉'}</span>
                    <div className="rhi-info">
                      <span className="rhi-hand">{label}</span>
                      <span className="rhi-table">{rec.tableName || `Hand #${rec.handNumber ?? '—'}`}</span>
                    </div>
                    <span className="rhi-amount" style={{ color: r.won ? '#4ADE80' : '#93C5FD' }}>{amount}</span>
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
        <InlineLeaderboard onOpenProfile={openProfile} />
        <SectionHeader>Friends</SectionHeader>
        <InlineFriendsList onOpenProfile={openProfile} />
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
          style={{ flex: 1, padding: '10px 16px', fontSize: '0.85rem', background: 'linear-gradient(135deg, #3b82f6, #38BDF8)', color: '#0a0a1a' }}
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
      <InlineFriendsList onOpenProfile={openProfile} />
      <button
        className="btn-accent lobby-full-width-btn"
        style={{ marginTop: '8px', marginBottom: '24px' }}
        onClick={() => setShowFriends(true)}
      >
        Manage Friends
      </button>

      {/* Leaderboard */}
      <SectionHeader>Leaderboard</SectionHeader>
      <InlineLeaderboard onOpenProfile={openProfile} />
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
          placeholder="Search players by display name..."
          style={{ width: '100%', marginBottom: '8px' }}
          value={playerSearchQuery}
          onChange={(e) => handlePlayerSearch(e.target.value)}
        />
        {playerSearchLoading && (
          <p style={{ color: '#6b6b8a', fontSize: '0.8rem', margin: 0 }}>Searching…</p>
        )}
        {!playerSearchLoading && playerSearchError && (
          <p style={{ color: '#9fb3d9', fontSize: '0.8rem', margin: 0 }}>{playerSearchError}</p>
        )}
        {!playerSearchLoading && !playerSearchError && playerSearchQuery.length >= 2 && playerSearchResults.length === 0 && (
          <p style={{ color: '#6b6b8a', fontSize: '0.8rem', margin: 0 }}>No players found.</p>
        )}
        {playerSearchResults.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* R2 (addendum / APPUI-14) — a public name and a level only
                (never chips); a result with an id (the server's public id)
                opens that profile. */}
            {playerSearchResults.map((p, i) => {
              const name = String(p.displayName ?? p.username ?? 'Player');
              const target = profileTargetOf(p, name);
              const canOpen = target != null;
              return (
                <div
                  key={p.id ?? `${name}-${i}`}
                  className={`player-search-row ${canOpen ? 'player-search-row--link' : ''}`}
                  onClick={canOpen ? () => openProfile(target) : undefined}
                >
                  <span className="player-search-name">{name}</span>
                  <span className="player-search-level">Lv.{Number(p.level) || 1}{canOpen ? ' · View profile' : ''}</span>
                </div>
              );
            })}
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
        {/* R2 (C7) — the equipped profile background (Shop) is drawn here. */}
        <div className="lobby-profile-banner" style={profileBannerStyle(progress)} />
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

      {/* Admin-only: manual restore button. Server rejects non-admins.
          2026-05-19 audit — also hide from the client-side UI if the
          user isn't an admin (UX cleanup). Empirical bug from Chrome
          play test: a guest user (no admin role) was shown this button
          and the "Admin" link in the top-right header. Server enforces
          (returns "Access denied. Admin privileges required.") but a
          guest seeing those affordances is confusing. */}
      {useGameStore.getState().isAdmin && (
        <button
          className="btn-accent lobby-full-width-btn"
          style={{ marginBottom: '12px', background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: '#0a0a1a', fontWeight: 800 }}
          onClick={() => {
            const socket = getSocket();
            if (!socket?.connected) return;
            const handler = (res) => {
              socket.off('adminRestoreBalanceResult', handler);
              if (res?.success) {
                setJoinError(`Restored ${res.chips.toLocaleString()} chips + ${res.stars.toLocaleString()} stars`);
                setTimeout(() => setJoinError(null), 4000);
              } else {
                setJoinError(`Restore failed: ${res?.error || 'unknown'}`);
                setTimeout(() => setJoinError(null), 4000);
              }
            };
            socket.on('adminRestoreBalanceResult', handler);
            socket.emit('adminRestoreBalance');
          }}
        >
          🔁 Restore Missing Balance (Admin)
        </button>
      )}

      {/* Tools section */}
      <SectionHeader>Tools</SectionHeader>
      {(() => {
        const toolBtnStyle = { flex: 1, padding: '12px 16px', fontSize: '0.85rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(120, 160, 255,0.15)', color: '#ccc', borderRadius: 10, cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' };
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
          🏅 Achievement Badges
        </button>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
        <button
          className="btn-accent"
          style={toolBtnStyle}
          onClick={() => setProfileTarget({ own: true })}
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

      {/* VIP Status Inline Card — R2 (APPUI-33 / C8): the XP-rate tier by
          cumulative season XP (totalXp, what the server uses), plus the VIP
          pass state. */}
      <SectionHeader>VIP Status</SectionHeader>
      <div className="lobby-vip-inline-card" style={{ borderLeftColor: vipTier.color }}>
        <div className="lobby-vip-badge" style={{ background: vipTier.color, color: '#0a0a1a' }}>
          {vipTier.name}
        </div>
        <div className="lobby-vip-info">
          <span style={{ color: vipTier.color, fontWeight: 600 }}>{seasonXp.toLocaleString()} season XP</span>
          <span style={{ color: '#9fb3d9', fontSize: '0.8rem' }}>
            {vipTier.xpRate} XP rate · {vipPassActive(progress) ? `VIP pass active (${formatCountdown(progress.vip.expiresAt)} left)` : 'no VIP pass'}
          </span>
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
          onClick={() => {
            const last = recentOwn[0]?.rec || handLog[handLog.length - 1];
            if (!last) { setJoinError('No hands recorded yet — play some hands first.'); setTimeout(() => setJoinError(null), 3500); return; }
            setReplayHand(last);
          }}
        >
          Hand History
        </button>
      </div>
    </div>
  );

  // 2026-10-11 (R2, C7 / C8) — the Shop tab lives in ShopTab.jsx: what each
  // item does, Equip / Unequip from the server's equipped / owned state, two-
  // tap buying, the VIP pass + monthly bonus, boosters, Battle Pass Premium.
  // The dead Theme Shop modal (a second, different price list) is gone.
  const renderShopTab = () => (
    <ShopTab
      progress={progress}
      chipCount={chipCount}
      onOpenBattlePass={() => setShowBattlePass(true)}
      onOpenDailyRewards={() => { setShowLoginRewards(true); setLoginRewardsAutoOpened(false); }}
      onOpenSpin={() => setShowSpinWheel(true)}
      onOpenScratch={(autoStart) => { setScratchAutoStart(!!autoStart); setShowScratchCards(true); }}
      onOpenVip={() => setShowVIP(true)}
    />
  );

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
            border: '1px solid rgba(120, 160, 255,0.3)', color: '#e0e0e0',
            minWidth: 260, boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
          }}>
            <div style={{
              width: 40, height: 40, margin: '0 auto 16px',
              border: '3px solid rgba(120, 160, 255,0.25)', borderTopColor: '#ffd24a',
              borderRadius: '50%', animation: 'lobbyJoinSpin 0.9s linear infinite',
            }} />
            <div style={{ fontWeight: 700, fontSize: 16, color: '#ffd24a' }}>{joining.label}</div>
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6 }}>Seating you at the table…</div>
            <style>{`@keyframes lobbyJoinSpin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      )}

      {/* Join error toast — shown briefly if the server didn't seat us in time.
          2026-10-07: blue + gold, not red (owner preference).
          2026-10-10 (round 3): while the fixed "Return to tournament" banner
          is up it sits BELOW that banner (the bottom edge it reports; 240px
          until it has) and above it in z-order — never drawn under it. */}
      {joinError && !joining && (
        <div
          role="alert"
          className="lobby-join-error-toast"
          style={{
            position: 'fixed',
            top: tournamentBannerUp ? Math.max(80, tournamentBannerBottom > 0 ? tournamentBannerBottom + 10 : 240) : 80,
            left: '50%', transform: 'translateX(-50%)',
            zIndex: tournamentBannerUp ? 10045 : 3100, background: 'linear-gradient(135deg, rgba(12,28,72,0.97), rgba(8,18,48,0.97))',
            color: '#ffd24a',
            padding: '10px 18px', borderRadius: 10, fontSize: 13, maxWidth: 320,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,210,74,0.55)',
          }}
          onClick={() => setJoinError(null)}
        >
          ⚠ {joinError} <span style={{ opacity: 0.7, marginLeft: 8 }}>(tap to dismiss)</span>
        </div>
      )}

      {/* Broke-refill banner — appears whenever the wallet can't cover the
          cheapest cash table (5,000 min buy-in). Unlimited free top-ups keep
          a busted player in the game; the server enforces the < 5,000 gate. */}
      {/* R2 (addendum / APPUI P3) — never while he is seated (his chips are on
          the table, so "Out of chips?" was wrong), sits ABOVE the bottom nav
          (safe area included — it used to cover the nav), and shows the
          server's chips_on_table answer when he has chips at another table. */}
      {Number.isFinite(chips) && chips < 5000 && !joining && !isSeated && (
        <div className="lobby-refill-banner">
          <div className="lobby-refill-title">Low on chips</div>
          <div className="lobby-refill-text">
            You have {(chips || 0).toLocaleString()} in your bankroll. Get 5,000 free chips to sit back down — whenever your bankroll runs out.
          </div>
          <button
            className="lobby-refill-btn"
            onClick={handleClaimRefill}
            disabled={refilling}
          >
            {refilling ? 'Adding…' : 'Get 5,000 free chips'}
          </button>
          {refillToast && (
            <div className={`lobby-refill-note ${refillToast.ok ? 'lobby-refill-note--ok' : ''}`}>
              {refillToast.text}
            </div>
          )}
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
          {/* Admin link only renders for users whose loginResult flagged
              them as admin. Server enforces the actual privilege; this
              just hides the affordance from guest + regular players.
              Empirical bug from Chrome play test: a `Play as Guest`
              account saw the "Admin" link at top-right and a "Restore
              Missing Balance (Admin)" button in the lobby — both went
              to access-denied screens. UX cleanup. 2026-05-19. */}
          {useGameStore.getState().isAdmin && (
            <button
              className="lobby-top-bar-settings"
              onClick={() => setShowAdminDashboard(true)}
              title="Admin"
              style={{ fontSize: '0.7rem', color: '#F97316' }}
            >
              Admin
            </button>
          )}
          {isLoggedIn && (
            <button
              className="lobby-top-bar-settings"
              onClick={logout}
              disabled={signingOut}
              title="Logout"
              style={signingOut
                /* T9 — "Signing out…" is blue, never red (owner preference); the idle Logout keeps its HEAD colour. */
                ? { fontSize: '0.75rem', color: '#cfe0ff', opacity: 0.75, cursor: 'default' }
                : { fontSize: '0.75rem', color: '#cfe0ff' }}
            >
              {signingOut ? 'Signing out…' : 'Logout'}
            </button>
          )}
        </div>
      </div>

      {/* #1 Activity ticker */}
      <div className="activity-ticker">
        <span className="activity-ticker-live">● LIVE</span>
        <span className={`activity-ticker-text ${activityFading ? 'activity-ticker-text--fade' : ''}`}>
          {activityEvents[activityIdx % activityEvents.length]}
        </span>
      </div>

      {/* Tab Content with fade transitions */}
      {renderTabContent()}

      {/* ─── Overlay components (preserved) ─── */}
      {showStats && <StatsPanel onClose={() => setShowStats(false)} />}
      {showLeaderboard && <Leaderboard onClose={() => setShowLeaderboard(false)} onOpenProfile={(t) => { setShowLeaderboard(false); openProfile(t); }} />}
      {showFriends && <FriendSystem onClose={() => setShowFriends(false)} onOpenProfile={(t) => { setShowFriends(false); openProfile(t); }} />}
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
            // Remember that we closed the modal TODAY (Denver — the reward's
            // calendar) so the auto-open doesn't re-show it on the next
            // nav/re-mount. Scoped to sessionStorage; tomorrow's date differs.
            try {
              sessionStorage.setItem('app_poker_login_rewards_dismissed', denverDateKey());
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
        {replayHand && <HandReplayViewer history={replayHand} onClose={() => setReplayHand(null)} />}
        {showHandQuiz && <HandQuiz onClose={() => setShowHandQuiz(false)} />}
        {showAdvancedAnalytics && <AdvancedAnalytics progress={progress} handLog={handLog} myName={playerName} onClose={() => setShowAdvancedAnalytics(false)} />}
        {/* 2026-10-09 (D3) — refusal handling passed in (see StakingMarketplace). */}
        {showStakingMarketplace && (
          <StakingMarketplace
            playerName={playerName}
            chips={progress?.chips ?? chipCount ?? 0}
            onClose={() => setShowStakingMarketplace(false)}
            onPlayRefusal={reportPlayRefusal}
            runPlayFlow={runPlayFlow}
            unreachableText={GAME_SERVER_UNREACHABLE_TEXT}
          />
        )}
        {showTournamentBracket && <TournamentBracket tournament={bracketTournament} onClose={() => setShowTournamentBracket(false)} />}
        {showTournamentDirector && <TournamentDirector onClose={() => setShowTournamentDirector(false)} onCreateTournament={handleCreateCustomTournament} playerName={playerName} />}
        {showHandHistoryImporter && <HandHistoryImporter onClose={() => setShowHandHistoryImporter(false)} />}
        {/* 2026-10-09 — side-bet refusals: handling passed in (see SocialBracket). */}
        {showSocialBracket && (
          <SocialBracket
            socket={getSocket()}
            onClose={() => setShowSocialBracket(false)}
            onPlayRefusal={reportPlayRefusal}
            runPlayFlow={runPlayFlow}
          />
        )}
        {showBankrollAI && <BankrollAI currentChips={chipCount} onClose={() => setShowBankrollAI(false)} />}
        {showNFTBadges && <NFTBadges socket={getSocket()} unlockedAchievementIds={progress?.achievements || []} onClose={() => setShowNFTBadges(false)} />}
      </Suspense>
      {/* Eagerly-loaded panels that live inside the default Lobby view
          or are opened so frequently that the lazy round-trip wouldn't
          help. */}
      {showClubs && <ClubsPanel onClose={() => setShowClubs(false)} />}
      {showSpinWheel && <SpinWheel onClose={() => setShowSpinWheel(false)} />}
      {showScratchCards && <ScratchCards autoStart={scratchAutoStart} onClose={() => { setShowScratchCards(false); setScratchAutoStart(false); }} />}
      {showMultiTable && <MultiTableView onClose={() => setShowMultiTable(false)} />}
      {profileTarget && <PlayerProfile target={profileTarget} socket={getSocket()} onClose={() => setProfileTarget(null)} onViewReplay={(h) => { setProfileTarget(null); setReplayHand(h); }} />}

      {/* Custom-tournament create confirmation toast (GAP 14). Root-level so it
          shows regardless of which lobby tab is active after the director closes. */}
      {tdNotice && (
        <div
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10000, padding: '10px 18px', borderRadius: 10,
            background: 'linear-gradient(135deg, #8B5CF6, #7C3AED)', color: '#fff',
            fontSize: 14, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
          onClick={() => setTdNotice(null)}
        >
          {tdNotice.text}
        </div>
      )}
    </div>
  );
}
