/**
 * PokerTable2D — PokerBros / PokerStars-style flat 2D table
 * Upgrades v3: community cards on felt, pot label, logo, hero YOU badge,
 *   note color dots, VPIP/PFR, always-visible BB, chip delta flash,
 *   thinking dots, action pill, rank badge, streak, away state, fold-dim,
 *   all-in pulse ring, win streak.
 */
import { memo, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTableStore } from '../../store/tableStore';
import { useGameStore, SEAT_COUNT } from '../../store/gameStore';
import { useTimerStore } from '../../store/timerStore';
import { getSocket } from '../../services/socketService';
import {
  SUIT_SYMBOLS,
  SUIT_INDEX_TO_SYMBOL,
  getCardColor,
  serverRankDisplay,
} from '../../utils/cardUtils';
import { getPlayerTag, COLOR_TAGS } from '../ui/PlayerNotes';
import { getRankInfo } from '../ui/RankBadge';
import { getOpponentStats } from '../../utils/opponentTracker';
import { useAvatar, PlayerAvatar } from '../../hooks/useAvatar';
import './PokerTable2D.css';

/* ── Player-notes callback (App.jsx sets this) ─────────────── */
let _onOpenPlayerNotes = null;
export function setOnOpenPlayerNotes(fn) { _onOpenPlayerNotes = fn; }

/* ── Table themes ──────────────────────────────────────────── */
const TABLE_THEMES = {
  green: {
    felt: 'radial-gradient(ellipse at 50% 35%, #2e7d52 0%, #1a5438 55%, #0f3824 100%)',
    rail: '#2a1f0f', railMid: '#4a3418', name: '🟢 Classic',
  },
  blue: {
    felt: 'radial-gradient(ellipse at 50% 35%, #1a3a6e 0%, #0f2447 55%, #071529 100%)',
    rail: '#0a0f20', railMid: '#1e3060', name: '🔵 Speed',
  },
  black: {
    felt: 'radial-gradient(ellipse at 50% 35%, #1a1a2e 0%, #0d0d1a 55%, #050510 100%)',
    rail: '#1a1505', railMid: '#8B7355', name: '⬛ Midnight',
  },
  crimson: {
    felt: 'radial-gradient(ellipse at 50% 35%, #7c1d1d 0%, #4a0f0f 55%, #2d0808 100%)',
    rail: '#1a0505', railMid: '#6b2020', name: '🔴 Crimson',
  },
};
const THEME_KEYS = Object.keys(TABLE_THEMES);

/* ── Chip denominations ────────────────────────────────────── */
const CHIP_DENOMS = [
  { value: 100000, color: '#c0392b', stripe: '#e8a0a0', plaque: true  },
  { value: 50000,  color: '#7f8c8d', stripe: '#bdc3c7', plaque: true  },
  { value: 10000,  color: '#d35400', stripe: '#f0a070'                },
  { value: 5000,   color: '#7f8c8d', stripe: '#bdc3c7'                },
  { value: 1000,   color: '#ecf0f1', stripe: '#2c3e7a'                },
  { value: 500,    color: '#f1a8c4', stripe: '#e8749c'                },
  { value: 100,    color: '#d4a017', stripe: '#f5d76e'                },
  { value: 25,     color: '#2563eb', stripe: '#93c5fd'                },
  { value: 5,      color: '#d1d5db', stripe: '#9ca3af'                },
];

function buildChipStack(amount) {
  const result = [];
  let rem = Math.round(amount);
  for (const d of CHIP_DENOMS) {
    const n = Math.min(Math.floor(rem / d.value), 5);
    if (n > 0) { result.push({ ...d, count: n }); rem -= n * d.value; }
  }
  return result;
}

/* ── Emoji avatar options ──────────────────────────────────── */
const EMOJI_OPTIONS = [
  '🦅','🐺','🦊','🃏','🎰','🐉','🦁','🐯',
  '🦈','🐻','🤠','😎','🥸','🧠','🔥','💎',
  '🌊','⚡','🌙','☀️',
];

/* ── Avatar colours ─────────────────────────────────────────── */
const AVATAR_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b',
  '#10b981','#3b82f6','#ef4444','#06b6d4',
  '#84cc16','#f97316',
];
function getAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++)
    h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/* ── Position label ─────────────────────────────────────────── */
function getPositionLabel(seatIndex, dealerButtonSeat, occupiedSeats) {
  if (!occupiedSeats || occupiedSeats.length < 2) return '';
  const total = SEAT_COUNT;
  const sorted = [...occupiedSeats].sort((a, b) => {
    const da = (a - dealerButtonSeat + total) % total;
    const db = (b - dealerButtonSeat + total) % total;
    return da - db;
  });
  const pos = sorted.indexOf(seatIndex);
  if (pos === -1) return '';
  const n = sorted.length;
  if (n === 2) return pos === 0 ? 'BTN/SB' : 'BB';
  const labels = ['BTN','SB','BB','UTG','UTG+1','MP','HJ','CO',''];
  if (pos === n - 1) return 'CO';
  if (pos === n - 2 && n >= 5) return 'HJ';
  return labels[pos] ?? '';
}

/* ── 2-D seat layout ────────────────────────────────────────── */
const SEAT_ANGLES = Array.from({ length: SEAT_COUNT }, (_, i) =>
  Math.PI / 2 + i * (2 * Math.PI / SEAT_COUNT)
);
// Rail box-shadow extends 22px beyond felt edge; add ~10px clearance = 32px
const RAIL_CLEARANCE = 32;

/* ============================================================
   Card2D — playing card with deal animation
   ============================================================ */
function Card2D({ card, faceUp = true, small = false, dealDelay = 0 }) {
  if (!faceUp || !card) {
    return (
      <div
        className={`card2d card2d--back card2d--deal${small ? ' card2d--small' : ''}`}
        style={{ animationDelay: `${dealDelay}s` }}
      >
        <div className="card2d__back-pattern" />
      </div>
    );
  }

  const { rank, suit } = card;
  const suitSymbol =
    typeof suit === 'number' ? SUIT_INDEX_TO_SYMBOL[suit] : (SUIT_SYMBOLS[suit] ?? suit);
  const color = getCardColor(suit, false);
  const rankDisplay =
    typeof rank === 'number' ? serverRankDisplay(rank) : (rank ?? '?');

  return (
    <div
      className={`card2d card2d--deal${small ? ' card2d--small' : ''}`}
      style={{ '--card-color': color, animationDelay: `${dealDelay}s` }}
    >
      <div className="card2d__corner card2d__corner--tl">
        <span className="card2d__rank">{rankDisplay}</span>
        <span className="card2d__suit">{suitSymbol}</span>
      </div>
      <div className="card2d__center-suit">{suitSymbol}</div>
      <div className="card2d__corner card2d__corner--br">
        <span className="card2d__rank">{rankDisplay}</span>
        <span className="card2d__suit">{suitSymbol}</span>
      </div>
    </div>
  );
}

/* ============================================================
   CommunityCardsOnFelt — board cards rendered on the felt
   ============================================================ */
function CommunityCardsOnFelt({ cards = [] }) {
  if (!cards || cards.length === 0) return null;
  return (
    <div className="table2d-community">
      {cards.map((card, i) => (
        <div key={i} className="table2d-card-slot">
          <Card2D card={card} faceUp dealDelay={i * 0.09} />
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   ChipStack — visual stacked chips for a bet
   ============================================================ */
function ChipStack({ amount }) {
  if (!amount || amount <= 0) return null;
  const label =
    amount >= 10000 ? `${Math.round(amount / 1000)}K`
    : amount >= 1000 ? `${(amount / 1000).toFixed(1)}K`
    : amount.toLocaleString();
  const stack = buildChipStack(amount);
  let diskIndex = 0;
  return (
    <div className="chip-stack">
      <div className="chip-stack__tower">
        {stack.map((s) =>
          Array.from({ length: s.count }, (_, ci) => {
            const idx = diskIndex++;
            const offset = idx * 3;
            // Subtle deterministic lean — each chip slightly rotated for a natural stack look
            const lean = ((idx * 37 + 13) % 9) - 4;
            if (s.plaque) {
              const plaqueLabel = s.value >= 100000 ? '100K' : s.value >= 50000 ? '50K' : `${s.value / 1000}K`;
              return (
                <div
                  key={`${s.value}-${ci}`}
                  className="chip-stack__plaque"
                  style={{
                    '--chip-c': s.color,
                    '--chip-s': s.stripe,
                    bottom: `${offset}px`,
                    transform: `rotate(${lean * 0.5}deg)`,
                  }}
                >
                  <span className="chip-stack__plaque-label">{plaqueLabel}</span>
                </div>
              );
            }
            return (
              <div
                key={`${s.value}-${ci}`}
                className="chip-stack__disc"
                style={{
                  '--chip-c': s.color,
                  '--chip-s': s.stripe,
                  bottom: `${offset}px`,
                  transform: `rotate(${lean}deg)`,
                }}
              />
            );
          })
        )}
      </div>
      <span className="chip-stack__amount">{label}</span>
    </div>
  );
}

/* ============================================================
   PotChips — mini chip cluster rendered on felt center
   ============================================================ */
function PotChips({ pot }) {
  if (!pot || pot <= 0) return null;
  const stack = buildChipStack(pot).slice(0, 3);
  return (
    <div className="pot-chips">
      {stack.map((s, si) => (
        <div key={si} className="pot-chips__stack">
          {Array.from({ length: Math.min(s.count, 4) }, (_, ci) => (
            <div
              key={ci}
              className="pot-chips__disc"
              style={{
                '--chip-c': s.color,
                '--chip-s': s.stripe,
                bottom: `${ci * 4}px`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   ActionBubble — brief floating action text above seat
   ============================================================ */
function ActionBubble({ action }) {
  const [key, setKey] = useState(0);
  const [text, setText] = useState(null);
  const prevRef = useRef(null);

  useEffect(() => {
    if (action && action !== 'None' && action !== prevRef.current) {
      prevRef.current = action;
      setText(action);
      setKey(k => k + 1);
    }
  }, [action]);

  if (!text) return null;

  const lower = text.toLowerCase();
  let cls = 'bubble--check';
  if (lower.startsWith('fold'))  cls = 'bubble--fold';
  else if (lower.startsWith('raise') || lower.startsWith('bet')) cls = 'bubble--raise';
  else if (lower.startsWith('call')) cls = 'bubble--call';
  else if (lower.includes('all')) cls = 'bubble--allin';

  return (
    <div key={key} className={`seat-pod__action-bubble ${cls}`}>
      {text}
    </div>
  );
}

/* ============================================================
   SeatPod — one player position around the table
   ============================================================ */
const SeatPod = memo(function SeatPod({
  seatIndex, serverSeat, isMyPlayer, isActive,
  style, dealerButtonSeat, occupiedSeats,
  handResult, phase, onClickNameplate,
  bigBlind, heroEmoji, onSitHere, winStreak,
  isTournament, heroAlreadySeated, isPendingMoveTarget,
}) {
  const turnStartedAt = useTimerStore(s => s.turnStartedAt);
  const turnTimeout   = useTimerStore(s => s.turnTimeout);
  const TIMER_TOTAL_S = turnTimeout / 1000;
  const circumference = 2 * Math.PI * 22;
  const [hovered, setHovered] = useState(false);

  // Local tick for smooth ring animation (1s interval while active)
  const [timerTick, setTimerTick] = useState(0);
  useEffect(() => {
    if (!isActive || !turnStartedAt) return;
    setTimerTick(t => t + 1); // immediate re-render
    const id = setInterval(() => setTimerTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [isActive, turnStartedAt]);

  // Chip delta flash — hooks must come before any early return
  const chips = serverSeat?.chipCount ?? 0;
  const prevChipsRef = useRef(null);
  const [chipDelta, setChipDelta] = useState(null);
  const chipDeltaTimerRef = useRef(null);

  const isOccupied   = serverSeat?.state === 'occupied';
  const isSittingOut = serverSeat?.state === 'sitting_out';

  useEffect(() => {
    if (!isOccupied && !isSittingOut) { prevChipsRef.current = null; return; }
    const prev = prevChipsRef.current;
    prevChipsRef.current = chips;
    if (prev === null || prev === chips) return;
    const delta = chips - prev;
    if (delta !== 0) {
      clearTimeout(chipDeltaTimerRef.current);
      setChipDelta(delta);
      chipDeltaTimerRef.current = setTimeout(() => setChipDelta(null), 1200);
    }
  }, [chips, isOccupied, isSittingOut]);

  const {
    playerName, name: _name, currentBet, allIn, folded,
    holeCards = [], lastAction, eliminated,
    missedBlind, deadBlindOwedChips,
  } = serverSeat || {};
  const name = playerName || _name || '';
  // Show a small red badge on any seat currently owing dead blinds, so
  // observers can instantly see who skipped their turn and why they
  // aren't being dealt in. Only render if owed > 0 (non-null missedBlind
  // can linger before reset).
  const hasDeadBlindDebt = (deadBlindOwedChips || 0) > 0;

  /* ── Empty / vacatable seat ─────────────────────────────────
     Renders an "Open" placeholder for any seat that isn't actively
     playing: truly empty seats, and also seats where the server
     still has an `eliminated` flag set from a prior bust that hasn't
     been cleaned up yet. Previously `if (eliminated) return null`
     skipped rendering entirely, so the seat position was physically
     missing from the oval — visually the table looked like it had
     fewer than 9 seats. Treating eliminated-but-still-there as "Open"
     matches player intuition: a busted-out seat is available to sit. */
  if (!serverSeat || (!isOccupied && !isSittingOut) || eliminated) {
    // Disable "Sit Here" for tournament tables — TournamentManager owns
    // seating there. Still show the "Open" placeholder so the oval layout
    // stays 9-wide and spectators can see where the empty seats are.
    const canInteract = !isTournament;
    // When the hero is already seated, the action is a seat MOVE (cash
    // tables only). Show a different label so the intent is explicit.
    const btnLabel = heroAlreadySeated ? 'Move here' : 'Sit Here';
    return (
      <div
        className={`seat-pod seat-pod--empty ${isPendingMoveTarget ? 'seat-pod--pending-move' : ''}`}
        style={{
          ...style,
          ...(isPendingMoveTarget ? {
            outline: '2px dashed rgba(34, 211, 238, 0.8)',
            boxShadow: '0 0 0 6px rgba(34, 211, 238, 0.12)',
            borderRadius: '50%',
          } : {}),
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="seat-pod__avatar-wrap">
          <div className="seat-pod__avatar seat-pod__avatar--empty">+</div>
        </div>
        {isPendingMoveTarget ? (
          <div className="seat-pod__label" style={{ color: '#22D3EE', fontWeight: 700 }}>
            Moving here…
          </div>
        ) : hovered && canInteract ? (
          <button
            className="seat-pod__sit-btn"
            onClick={() => onSitHere && onSitHere(seatIndex)}
          >
            {btnLabel}
          </button>
        ) : (
          <div className="seat-pod__label">Open</div>
        )}
      </div>
    );
  }

  const isFolded = !!folded;
  const posLabel = getPositionLabel(seatIndex, dealerButtonSeat, occupiedSeats);
  // Use avatar seatColor > skinTone > name-hash color
  const avatarColor = serverSeat?.avatar?.seatColor || serverSeat?.avatar?.skinTone || getAvatarColor(name || '?');
  const avatarPhoto = serverSeat?.avatar?.photo || null;

  const winnerInfo = handResult?.winners?.find(w => w.seatIndex === seatIndex);
  const isWinner = !!winnerInfo;
  const showdown = phase === 'Showdown' || phase === 'HandComplete';

  const showCardsFaceUp = isMyPlayer || (showdown && holeCards?.length > 0 && holeCards[0]?.rank != null);
  const showCardBacks   = !isFolded && !isMyPlayer && phase !== 'WaitingForPlayers' && phase !== 'HandComplete';

  // Derive timer % from server timestamp (timerTick forces re-render each second)
  const timerPct = (() => {
    void timerTick; // used for re-render dependency
    if (!isActive || !turnStartedAt) return 100;
    const elapsed = Date.now() - turnStartedAt;
    return Math.max(0, Math.min(100, ((turnTimeout - elapsed) / turnTimeout) * 100));
  })();

  const stackBBs = bigBlind > 0 ? chips / bigBlind : 999;
  const stackColor =
    stackBBs < 10 ? '#f87171' :
    stackBBs < 25 ? '#fbbf24' :
    stackBBs > 50 ? '#4ade80' : '#e2e8f0';

  const avatarContent = isMyPlayer && heroEmoji
    ? heroEmoji
    : isSittingOut
    ? '💤'
    : (name || '?')[0].toUpperCase();

  // ── Nameplate enrichment data ──────────────────────────────
  const tag    = !isMyPlayer && name ? getPlayerTag(name) : null;
  const tagDef = tag?.color ? COLOR_TAGS.find(t => t.id === tag.color) : null;

  const stats     = !isMyPlayer && name ? getOpponentStats(name) : null;
  const showStats = stats && stats.hands >= 5;

  const rankInfo = serverSeat?.rank ? getRankInfo(serverSeat.rank) : null;

  const streak = winStreak ?? 0;

  const classes = [
    'seat-pod',
    isFolded     ? 'seat-pod--folded'   : '',
    isActive     ? 'seat-pod--active'   : '',
    allIn        ? 'seat-pod--allin'    : '',
    isMyPlayer   ? 'seat-pod--hero'     : '',
    isWinner     ? 'seat-pod--winner'   : '',
    hovered      ? 'seat-pod--hovered'  : '',
    isSittingOut ? 'seat-pod--sitout'   : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (!isMyPlayer && name) {
          if (onClickNameplate) onClickNameplate(name);
          window.dispatchEvent(new CustomEvent('viewOpponentStats', { detail: name }));
        }
      }}
    >
      {/* Dealer button */}
      {seatIndex === dealerButtonSeat && <div className="dealer-btn">D</div>}

      {/* Winner label */}
      {isWinner && (
        <div className="seat-pod__winner-label">
          <span className="seat-pod__winner-text">WINNER</span>
          {winnerInfo.handName && (
            <span className="seat-pod__winner-hand">{winnerInfo.handName}</span>
          )}
          {(winnerInfo.chipsWon ?? winnerInfo.amount ?? 0) > 0 && (
            <span className="seat-pod__winner-amount">
              +{(winnerInfo.chipsWon ?? winnerInfo.amount).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {/* Action bubble */}
      <ActionBubble action={lastAction} />

      {/* Hole cards (opponents: face-down; showdown: face-up) */}
      {!isMyPlayer && (showCardsFaceUp || showCardBacks) && (
        <div className={`seat-pod__cards${hovered ? ' seat-pod__cards--hovered' : ''}`}>
          {showCardsFaceUp && holeCards?.length > 0
            ? holeCards.map((c, i) => (
                <Card2D key={i} card={c} faceUp small dealDelay={i * 0.07} />
              ))
            : [0, 1].map(i => (
                <Card2D key={i} card={null} faceUp={false} small dealDelay={i * 0.07} />
              ))
          }
        </div>
      )}

      {/* Avatar with optional timer ring + all-in pulse ring */}
      <div className="seat-pod__avatar-wrap">
        {isActive && (
          <svg className="seat-pod__timer-ring" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="22" stroke="rgba(255,255,255,0.12)" strokeWidth="3" fill="none" />
            <circle
              cx="25" cy="25" r="22"
              stroke={timerPct < 25 ? '#ef4444' : '#4ade80'}
              strokeWidth="3"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - timerPct / 100)}
              strokeLinecap="round"
              transform="rotate(-90 25 25)"
              style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.5s' }}
            />
          </svg>
        )}
        <div
          className={`seat-pod__avatar${isWinner ? ' seat-pod__avatar--win' : ''}${isFolded ? ' seat-pod__avatar--fold' : ''}`}
          style={avatarPhoto ? { background: avatarColor } : { background: 'transparent' }}
        >
          {avatarPhoto
            ? <img src={avatarPhoto} alt={name} className="seat-pod__avatar-photo" />
            : <PlayerAvatar playerId={name} name={name} size={42} style={{ border: '2px solid rgba(255,255,255,0.15)' }} />
          }
        </div>
        {isSittingOut && <div className="seat-pod__away-badge">AWAY</div>}
      </div>

      {/* Hero YOU badge */}
      {isMyPlayer && <div className="seat-pod__you-badge">YOU</div>}
      {hasDeadBlindDebt && (
        <div
          className="seat-pod__owed-badge"
          title={`Owes ${(deadBlindOwedChips || 0).toLocaleString()} in dead blinds (${missedBlind})`}
          aria-label={`${name || 'Player'} owes dead blinds from sitting out`}
        >
          🎯 {(deadBlindOwedChips || 0).toLocaleString()}
        </div>
      )}

      {/* Nameplate — hidden for hero (GameHUD already shows it) */}
      {!isMyPlayer && (
        <div className={`seat-pod__nameplate${isSittingOut ? ' seat-pod__nameplate--sitout' : ''}`}>

          {/* Row 1: note dot + name + rank icon + streak */}
          <div className="seat-pod__name-row">
            {tagDef && (
              <span
                className="seat-pod__note-dot"
                style={{ background: tagDef.color }}
                title={tagDef.label}
              />
            )}
            <div className="seat-pod__name" title={name}>{name}</div>
            {rankInfo && (
              <span className="seat-pod__rank-icon" title={rankInfo.name}>{rankInfo.icon}</span>
            )}
            {streak >= 3 && (
              <span className="seat-pod__streak" title={`${streak} win streak`}>🔥</span>
            )}
            {streak <= -3 && (
              <span className="seat-pod__streak" title={`${Math.abs(streak)} loss streak`}>❄️</span>
            )}
          </div>

          {/* Row 2: chips + BB badge + position */}
          <div className="seat-pod__chips">
            <span style={{ color: stackColor }}>{chips.toLocaleString()}</span>
            {bigBlind > 0 && stackBBs < 999 && (
              <span className="seat-pod__bb-badge" style={{ color: stackColor }}>
                {Math.round(stackBBs)}BB
              </span>
            )}
            {posLabel && (
              <span className={`seat-pod__pos seat-pod__pos--${posLabel.toLowerCase().replace(/[^a-z]/g, '')}`}>
                {posLabel}
              </span>
            )}
          </div>

          {/* Row 3: VPIP/PFR mini-stat (10+ hands observed) */}
          {showStats && (
            <div className="seat-pod__stats" title={`VPIP ${stats.vpip}% / PFR ${stats.pfr}% — ${stats.hands} hands`}>
              {stats.vpip}/{stats.pfr}
            </div>
          )}

          {/* Thinking dots when it's this player's turn */}
          {isActive && (
            <div className="seat-pod__thinking">
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
            </div>
          )}

          {/* Persistent action pill */}
          {lastAction && lastAction !== 'None' && !isActive && (
            <div className={`seat-pod__action-pill apl--${lastAction.toLowerCase().split(' ')[0]}`}>
              {lastAction}
            </div>
          )}

          {allIn && <div className="seat-pod__allin-badge">ALL IN</div>}
          {isSittingOut && <div className="seat-pod__sitout-text">AWAY</div>}
        </div>
      )}

      {/* Chip delta flash */}
      {chipDelta !== null && (
        <div className={`seat-pod__chip-delta ${chipDelta > 0 ? 'chip-delta--gain' : 'chip-delta--loss'}`}>
          {chipDelta > 0 ? '+' : ''}{chipDelta.toLocaleString()}
        </div>
      )}

      {/* Bet chip stack */}
      {currentBet > 0 && <ChipStack amount={currentBet} key={currentBet} />}
    </div>
  );
});

/* ============================================================
   PokerTable2D — main export
   ============================================================ */
export default function PokerTable2D() {
  const gameState      = useTableStore(s => s.gameState);
  const mySeat         = useTableStore(s => s.mySeat);
  const handHistories  = useTableStore(s => s.handHistories);

  const seats          = gameState?.seats ?? [];
  const phase          = gameState?.phase ?? 'WaitingForPlayers';
  const activeSeat     = gameState?.activeSeatIndex ?? -1;
  const dealerSeat     = gameState?.dealerButtonSeat ?? -1;
  const yourSeat       = gameState?.yourSeat ?? mySeat;
  const handResult     = gameState?.handResult ?? null;
  const variantName    = gameState?.variantName || gameState?.variant?.name || '';
  const pot            = gameState?.pot ?? 0;
  const bigBlind       = gameState?.bigBlind ?? (gameState?.smallBlind ?? 0) * 2;
  const communityCards = gameState?.communityCards ?? [];

  // Pending-seat-move state. When the server ACKs a `moveSeat` request it
  // emits `moveSeatPending { pendingSeat }`; on execution at the next
  // hand boundary it emits `moveSeatComplete { newSeat }` which clears.
  const [pendingSeat, setPendingSeat] = useState(null);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onPending = (d) => { if (d?.pendingSeat != null) setPendingSeat(d.pendingSeat); };
    const onComplete = () => setPendingSeat(null);
    const onCancelled = () => setPendingSeat(null);
    socket.on('moveSeatPending', onPending);
    socket.on('moveSeatComplete', onComplete);
    socket.on('moveSeatCancelled', onCancelled);
    return () => {
      socket.off('moveSeatPending', onPending);
      socket.off('moveSeatComplete', onComplete);
      socket.off('moveSeatCancelled', onCancelled);
    };
  }, []);

  const occupiedSeats = seats
    .map((s, i) => (s?.state === 'occupied' ? i : -1))
    .filter(i => i >= 0);

  /* ── Win streak computation (last 8 hands) ───────────────── */
  const winStreaks = useMemo(() => {
    const streaks = new Map();
    if (!handHistories.length) return streaks;

    // Collect W/L per player from recent hands (oldest → newest so push keeps order)
    const playerResults = new Map();
    const recent = handHistories.slice(-8);

    for (const hist of recent) {
      const winnerNames = new Set(
        (hist.winners || [])
          .map(w => w.playerName || w.name)
          .filter(Boolean)
      );
      for (const p of (hist.players || [])) {
        const pName = p.playerName || p.name;
        if (!pName) continue;
        if (!playerResults.has(pName)) playerResults.set(pName, []);
        playerResults.get(pName).push(winnerNames.has(pName));
      }
    }

    for (const [name, results] of playerResults) {
      if (!results.length) continue;
      const last = results[results.length - 1];
      let count = 0;
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i] === last) count++;
        else break;
      }
      streaks.set(name, last ? count : -count);
    }

    return streaks;
  }, [handHistories]);

  /* ── Responsive seat positions (measured from actual felt) ── */
  const sceneRef = useRef(null);
  const feltRef  = useRef(null);
  const [seatEllipse, setSeatEllipse] = useState(null);

  useEffect(() => {
    const update = () => {
      const scene = sceneRef.current;
      const felt  = feltRef.current;
      if (!scene || !felt) return;
      const sr = scene.getBoundingClientRect();
      const fr = felt.getBoundingClientRect();
      if (sr.width === 0 || sr.height === 0) return;
      // Ellipse radii: half-felt plus rail clearance, expressed as fraction of scene
      const xR = (fr.width  / 2 + RAIL_CLEARANCE) / sr.width;
      const yR = (fr.height / 2 + RAIL_CLEARANCE) / sr.height;
      // Felt center relative to scene
      const cx = (fr.left - sr.left + fr.width  / 2) / sr.width;
      const cy = (fr.top  - sr.top  + fr.height / 2) / sr.height;
      setSeatEllipse({ xR, yR, cx, cy });
    };
    const ro = new ResizeObserver(update);
    if (sceneRef.current) ro.observe(sceneRef.current);
    if (feltRef.current)  ro.observe(feltRef.current);
    update();
    return () => ro.disconnect();
  }, []);

  /* ── Table theme ──────────────────────────────────────────────
     Default felt changed from 🟢 Classic green → 🔵 Speed blue per user
     request ("CHANGE THE BASE DEFAULT FELT COLOR TO THE BLUE ONE").
     Existing users with a saved preference in sessionStorage keep
     whatever they last picked — only the fresh-install default shifts. */
  const [themeKey, setThemeKey] = useState(() => {
    try { return sessionStorage.getItem('app_poker_theme') || 'blue'; } catch { return 'blue'; }
  });
  const theme = TABLE_THEMES[themeKey] || TABLE_THEMES.blue;

  const cycleTheme = useCallback(() => {
    const next = THEME_KEYS[(THEME_KEYS.indexOf(themeKey) + 1) % THEME_KEYS.length];
    setThemeKey(next);
    try { sessionStorage.setItem('app_poker_theme', next); } catch {}
  }, [themeKey]);

  // Theme picker wired through the same window-event pattern as the
  // emoji picker so GameHUD's Options menu can drive it without needing
  // to prop-drill between sibling components. `poker:set-theme` with
  // detail:{ key } jumps directly to a chosen theme; `poker:cycle-theme`
  // advances by one (matches the old cycle button's behavior).
  useEffect(() => {
    const onSet = (e) => {
      const key = e?.detail?.key;
      if (key && TABLE_THEMES[key]) {
        setThemeKey(key);
        try { sessionStorage.setItem('app_poker_theme', key); } catch {}
      }
    };
    const onCycle = () => cycleTheme();
    window.addEventListener('poker:set-theme', onSet);
    window.addEventListener('poker:cycle-theme', onCycle);
    return () => {
      window.removeEventListener('poker:set-theme', onSet);
      window.removeEventListener('poker:cycle-theme', onCycle);
    };
  }, [cycleTheme]);

  /* ── Hero emoji avatar ────────────────────────────────────── */
  const [heroEmoji, setHeroEmoji] = useState(() => {
    try { return sessionStorage.getItem('app_poker_emoji') || ''; } catch { return ''; }
  });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const pickEmoji = useCallback((emoji) => {
    setHeroEmoji(emoji);
    setShowEmojiPicker(false);
    try { sessionStorage.setItem('app_poker_emoji', emoji); } catch {}
  }, []);

  // Expose the picker toggle so GameHUD's Options menu can open it after
  // we remove the floating .table2d-emoji-btn. Using a custom window event
  // to avoid importing a shared state slice / prop-drilling through the
  // PokerTable2D → GameHUD boundary (siblings, not parent/child).
  useEffect(() => {
    const open  = () => setShowEmojiPicker(true);
    const close = () => setShowEmojiPicker(false);
    const toggle = () => setShowEmojiPicker((v) => !v);
    window.addEventListener('poker:open-emoji-picker', open);
    window.addEventListener('poker:close-emoji-picker', close);
    window.addEventListener('poker:toggle-emoji-picker', toggle);
    return () => {
      window.removeEventListener('poker:open-emoji-picker', open);
      window.removeEventListener('poker:close-emoji-picker', close);
      window.removeEventListener('poker:toggle-emoji-picker', toggle);
    };
  }, []);

  /* ── Phase banner ─────────────────────────────────────────── */
  const [phaseBanner, setPhaseBanner] = useState(null);
  const phaseBannerTimerRef = useRef(null);
  const prevPhaseRef = useRef(phase);

  useEffect(() => {
    if (phase === prevPhaseRef.current) return;
    prevPhaseRef.current = phase;
    const map = { Flop: 'THE FLOP', Turn: 'THE TURN', River: 'THE RIVER', Showdown: 'SHOWDOWN' };
    const text = map[phase];
    if (text) {
      clearTimeout(phaseBannerTimerRef.current);
      setPhaseBanner(text);
      phaseBannerTimerRef.current = setTimeout(() => setPhaseBanner(null), 1800);
    }
    return () => clearTimeout(phaseBannerTimerRef.current);
  }, [phase]);

  /* ── Callbacks ────────────────────────────────────────────── */
  const onClickNameplate = useCallback(
    (playerName) => { if (_onOpenPlayerNotes) _onOpenPlayerNotes(playerName); },
    []
  );

  // Click on an empty seat. Branches on whether the player is ALREADY
  // seated at this table: if yes, it's a seat-move request (server queues
  // it for the next hand boundary). If no, it's a take-seat request
  // (legacy, currently a no-op on the server — future seat reservation
  // flow lives here). Tournament tables reject moveSeat server-side; the
  // UI also hides the Sit Here button for tournament tables.
  const onSitHere = useCallback((seatIndex) => {
    const socket = getSocket();
    if (!socket?.connected) return;
    const alreadySeated = yourSeat >= 0;
    const isTournament =
      gameState?.isTournament === true ||
      gameState?.tournamentId != null ||
      (gameState?.variantName || '').toLowerCase().includes('tournament');
    if (alreadySeated) {
      if (isTournament) {
        // Tournament seats are controlled by the tournament manager —
        // silently no-op rather than confusing the user with an error.
        return;
      }
      socket.emit('moveSeat', { targetSeatIndex: seatIndex, tableId: gameState?.tableId });
    } else {
      socket.emit('takeSeat', { seatIndex });
    }
  }, [yourSeat, gameState]);
  const cancelPendingMove = useCallback(() => {
    const socket = getSocket();
    if (socket?.connected) socket.emit('cancelMoveSeat');
  }, []);

  return (
    <div className="table2d-scene" ref={sceneRef}>
      {/* Dark background */}
      <div className="table2d-bg" />

      {/* ── Felt oval ─────────────────────────────────────── */}
      <div
        className="table2d-felt"
        ref={feltRef}
        style={{
          background: theme.felt,
          boxShadow: [
            '0 0 60px 10px rgba(0,0,0,0.8)',
            `0 0 0 14px ${theme.rail}`,
            `0 0 0 18px ${theme.railMid}`,
            `0 0 0 22px ${theme.rail}`,
            '0 12px 80px 20px rgba(0,0,0,0.9)',
          ].join(', '),
        }}
      >
        {/* Logo watermark — top of felt */}
        <div className="table2d-felt__logo">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="American Pub Poker"
            className="table2d-logo-img"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              if (e.currentTarget.nextElementSibling) {
                e.currentTarget.nextElementSibling.style.display = 'block';
              }
            }}
          />
          <span className="table2d-logo-fallback">{variantName || 'American Pub Poker'}</span>
        </div>

        {/* Community cards rendered by GameHUD overlay — not duplicated here */}

        {/* Pot chip visual + amount label */}
        {pot > 0 && (
          <div className="table2d-pot-area">
            <PotChips pot={pot} />
            <div className="table2d-pot-label">
              Pot: <strong>{pot.toLocaleString()}</strong>
            </div>
          </div>
        )}

        {/* Phase banner flash */}
        {phaseBanner && (
          <div className="table2d-phase-banner" key={phaseBanner}>
            {phaseBanner}
          </div>
        )}
      </div>

      {/* ── Theme cycle button ─────────────────────────────── */}
      {/* Pending seat-move pill — shows when the player has queued a move
          and it's waiting for the current hand to complete. Tapping
          "Cancel" tells the server to drop the queued move. */}
      {pendingSeat != null && pendingSeat !== yourSeat && (
        <div
          style={{
            position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1500, display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 14px', borderRadius: 999,
            background: 'rgba(14, 116, 144, 0.95)',
            border: '1px solid rgba(34, 211, 238, 0.5)',
            color: '#e0f2fe', fontSize: 13, fontWeight: 600,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          }}
        >
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: '#22D3EE', animation: 'movePendPulse 1.2s infinite',
          }} />
          Moving to seat {pendingSeat + 1} after this hand
          <button
            onClick={cancelPendingMove}
            style={{
              marginLeft: 6, padding: '4px 10px', borderRadius: 6,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.35)',
              color: '#fff', cursor: 'pointer', fontSize: 12,
            }}
          >
            Cancel
          </button>
          <style>{`@keyframes movePendPulse { 0%,100% {opacity:1} 50% {opacity:0.3} }`}</style>
        </div>
      )}

      {/* Floating .table2d-theme-btn REMOVED per user request — the table
          theme cycle button was cluttering the bottom-left corner. Now
          accessible from GameHUD's Options menu as a proper theme picker.
          We still listen for `poker:set-theme` / `poker:cycle-theme`
          window events (see useEffect above) to receive the selection. */}

      {/* Floating .table2d-emoji-btn REMOVED per user request — the emoji
          picker is now triggered from the Options menu in GameHUD via a
          `poker:open-emoji-picker` window event. The picker itself still
          renders here (so it has access to the local heroEmoji state +
          pickEmoji handler); a click outside dismisses it. */}
      {showEmojiPicker && yourSeat >= 0 && (
        <>
          <div className="table2d-emoji-backdrop" onClick={() => setShowEmojiPicker(false)} aria-hidden="true" />
          <div className="table2d-emoji-picker" role="dialog" aria-label="Pick an avatar emoji">
            <div className="table2d-emoji-picker__title">Pick Avatar</div>
            <div className="table2d-emoji-picker__grid">
              {EMOJI_OPTIONS.map(e => (
                <button
                  key={e}
                  className={`table2d-emoji-option ${heroEmoji === e ? 'table2d-emoji-option--active' : ''}`}
                  onClick={() => pickEmoji(e)}
                >
                  {e}
                </button>
              ))}
              <button
                className="table2d-emoji-option table2d-emoji-option--reset"
                onClick={() => pickEmoji('')}
                title="Use initial letter"
              >
                A
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Seat pods ───────────────────────────────────────
          Hero rotation: the GameHUD bottom anchor draws the hero's cards +
          nameplate at the BOTTOM of the screen unconditionally. If we render
          each seat at its raw `SEAT_ANGLES[seatIndex]`, the hero's avatar
          ends up wherever the server placed them (e.g. top-right) while
          their cards sit at the bottom — the user sees a disconnected label
          floating over someone else's seat.
          Fix: rotate the whole map so the hero's seat ALWAYS maps to the
          bottom (angle π/2). Everyone else shifts clockwise around the oval
          relative to them. Spectators / unseated players get no rotation. */}
      {SEAT_ANGLES.map((rawAngle, i) => {
        // Shift so the hero lands on π/2 (bottom of the ellipse in screen-y).
        // `delta` is added to every seat's angle. If hero isn't seated yet
        // (yourSeat < 0), delta=0 → legacy behavior for spectators.
        const heroAngle = yourSeat >= 0 ? SEAT_ANGLES[yourSeat] : Math.PI / 2;
        const delta = (Math.PI / 2) - heroAngle;
        const angle = rawAngle + delta;
        const x = Math.cos(angle);
        const y = Math.sin(angle);
        const seat = seats[i];
        const seatName = seat?.playerName || seat?.name || '';
        // Use measured ellipse if available, otherwise fall back to % heuristic
        const leftPct = seatEllipse
          ? (seatEllipse.cx + x * seatEllipse.xR) * 100
          : 50 + x * 44;
        const topPct = seatEllipse
          ? (seatEllipse.cy + y * seatEllipse.yR) * 100
          : 50 + y * 28;
        const isTournamentTbl =
          gameState?.isTournament === true ||
          gameState?.tournamentId != null ||
          (gameState?.variantName || '').toLowerCase().includes('tournament');
        return (
          <SeatPod
            key={i}
            seatIndex={i}
            serverSeat={seat}
            isMyPlayer={yourSeat === i}
            isActive={activeSeat === i}
            style={{
              left: `${leftPct}%`,
              top:  `${topPct}%`,
            }}
            dealerButtonSeat={dealerSeat}
            occupiedSeats={occupiedSeats}
            handResult={handResult}
            phase={phase}
            onClickNameplate={onClickNameplate}
            bigBlind={bigBlind}
            heroEmoji={heroEmoji}
            onSitHere={onSitHere}
            winStreak={winStreaks.get(seatName) ?? 0}
            isTournament={isTournamentTbl}
            heroAlreadySeated={yourSeat >= 0}
            isPendingMoveTarget={pendingSeat === i}
          />
        );
      })}
    </div>
  );
}
