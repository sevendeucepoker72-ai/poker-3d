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
import { useTimerStore, serverNow } from '../../store/timerStore';
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
// 2026-10-23 (owner: "Turn all off") — no VPIP/PFR seat stats at a qualifier table.
import { helpToolsOffAt } from '../../utils/qualifierHelpTools';
import { useAvatar, PlayerAvatar } from '../../hooks/useAvatar';
// R1 (AUTH-6, contract #3) — a seat name is shown as text and indexed for the
// avatar initial; a non-string name used to throw for every viewer.
import { safeName, nameInitial } from '../../utils/tablePayload';
import { TABLE_GEOMETRY_EVENT } from '../game/useTableGeometry';
// R2 (C7 / C8) — the shop cosmetics the server sends per seat + myTheme.
import { feltForTheme, seatLook } from './tableCosmetics';
// Gameplay audit C2 (2026-10-21) — the seat ring / opponents' cards rules.
import {
  tableBackCount, opponentCardSlots, seatSittingOut, seatCapOf,
  seatMoveFrameIsForTable, rotationSeats, positionLabel,
  blindSeatsOf, shownCardKey,
} from '../../utils/tableRender';
// Gameplay audit F78 (C3) — a queued move that did not happen ends its pill.
import { pendingMoveExpired } from '../../utils/tableFlows';
import { rowNotDealtIn } from '../../utils/handLog';
import { handLevelOf } from '../../utils/tournamentClock';
import './PokerTable2D.css';
import './TableCosmetics.css';

/* ── Player-notes callback (App.jsx sets this) ─────────────── */
let _onOpenPlayerNotes = null;
export function setOnOpenPlayerNotes(fn) { _onOpenPlayerNotes = fn; }

/* ── Table themes ──────────────────────────────────────────── */
// felt gradients are spotlit (bright hotspot high, deep falloff to the rim) so
// the brushed-gold rail + inset vignette read with real depth. rail/railMid are
// legacy (the rail is now a universal gold conic in CSS) but kept for safety.
const TABLE_THEMES = {
  green: {
    felt: 'radial-gradient(ellipse at 50% 30%, #3a9a68 0%, #1f6544 42%, #124430 68%, #0a3020 100%)',
    rail: '#2a1f0f', railMid: '#4a3418', name: '🟢 Classic',
  },
  blue: {
    felt: 'radial-gradient(ellipse at 50% 30%, #235a95 0%, #164277 40%, #0d2c53 68%, #08203e 100%)',
    rail: '#0a0f20', railMid: '#1e3060', name: '🔵 Speed',
  },
  black: {
    felt: 'radial-gradient(ellipse at 50% 30%, #1a2f66 0%, #101a3e 45%, #0a0d20 70%, #04040c 100%)',
    rail: '#1a1505', railMid: '#8B7355', name: '⬛ Midnight',
  },
  // R3 (K1-7) — no red: the 'crimson' key (a saved pick) now draws an ocean-teal felt.
  crimson: {
    felt: 'radial-gradient(ellipse at 50% 30%, #2f9db0 0%, #1b7187 40%, #104a5c 68%, #08303e 100%)',
    rail: '#04161c', railMid: '#1b5866', name: '🌊 Ocean',
  },
};
const THEME_KEYS = Object.keys(TABLE_THEMES);

/* ── Chip denominations ────────────────────────────────────── */
// R3 (K1-7) — no red / rose chips: 100k plaque black + gold, 500 purple.
const CHIP_DENOMS = [
  { value: 100000, color: '#111827', stripe: '#ffd24a', plaque: true  },
  { value: 50000,  color: '#7f8c8d', stripe: '#bdc3c7', plaque: true  },
  { value: 10000,  color: '#d35400', stripe: '#f0a070'                },
  { value: 5000,   color: '#7f8c8d', stripe: '#bdc3c7'                },
  { value: 1000,   color: '#ecf0f1', stripe: '#2c3e7a'                },
  { value: 500,    color: '#7c3aed', stripe: '#c4b5fd'                },
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
// R3 (K1-7) — no red in the name-hash colours (the red entry is sky blue).
const AVATAR_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b',
  '#10b981','#3b82f6','#0ea5e9','#3b82f6',
  '#84cc16','#f97316',
];
function getAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++)
    h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/* ── Position label ─────────────────────────────────────────
   Gameplay audit G175 (2026-10-21) — the rules live in utils/tableRender.js:
   positions go round the seats the SERVER rotates the button over (no busted
   seat, no player who sat down mid-hand, nothing in Stud), and 3-handed the
   big blind reads BB (it read CO). G175 fix-up: when the server names this
   hand's blind seats (sbSeat -1 = a dead small blind; dead button) the
   badges follow them; an older server (no seats: null) keeps the walk. */
function getPositionLabel(seatIndex, dealerButtonSeat, occupiedSeats, sbSeat = null, bbSeat = null) {
  const blinds = Number.isInteger(bbSeat) && Number.isInteger(sbSeat) ? { sb: sbSeat, bb: bbSeat } : null;
  return positionLabel(seatIndex, dealerButtonSeat, occupiedSeats, SEAT_COUNT, blinds);
}

/* R2 (TABLEUI-15) — can a SPECTATOR sit at this table through joinTable? Only
   a public cash table (C1: joinTable refuses tournament, quick, private and
   club tables). A missing tableKind (older server) keeps the old behaviour
   for anything that is not a tournament. */
function spectatorCanSit(gs) {
  if (!gs) return false;
  if (gs.isTournament === true || gs.tournamentId != null) return false;
  const kind = gs.tableKind;
  return kind == null || kind === 'cash';
}

/* ── 2-D seat layout ──────────────────────────────────────────
   Evenly-spaced seats around the ellipse starting at π/2 (bottom).
   9 seats → 40° between each. No per-seat angle tweaks. */
const SEAT_ANGLES = Array.from({ length: SEAT_COUNT }, (_, i) =>
  Math.PI / 2 + i * (2 * Math.PI / SEAT_COUNT)
);
// Rail box-shadow extends 22px beyond felt edge; add ~10px clearance = 32px
const RAIL_CLEARANCE = 32;

/* ============================================================
   Card2D — playing card with deal animation
   ============================================================ */
function Card2D({ card, faceUp = true, small = false, dealDelay = 0, backClass = '' }) {
  if (!faceUp || !card) {
    return (
      <div
        className={`card2d card2d--back card2d--deal${small ? ' card2d--small' : ''}${backClass ? ` ${backClass}` : ''}`}
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
function ChipStack({ amount, side = null }) {
  if (!amount || amount <= 0) return null;
  const label =
    amount >= 10000 ? `${Math.round(amount / 1000)}K`
    : amount >= 1000 ? `${(amount / 1000).toFixed(1)}K`
    : amount.toLocaleString();
  const stack = buildChipStack(amount);
  let diskIndex = 0;
  return (
    <div className={`chip-stack${side ? ` chip-stack--in-${side}` : ''}`}>
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

  const lower = String(text).toLowerCase();
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
  style, dealerButtonSeat, occupiedSeats, sbSeat, bbSeat,
  handResult, phase, onClickNameplate,
  bigBlind, heroEmoji, onSitHere, winStreak,
  isTournament, heroAlreadySeated, isPendingMoveTarget,
  onBetSlide, spectatorSits, betSide, backCount, beyondCap, handNumber,
  hideStats,
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
  // Gameplay audit G181 (2026-10-21) — the server never sets state
  // 'sitting_out' (the seat stays 'occupied'); it sends `sittingOut` per seat.
  const isSittingOut = seatSittingOut(serverSeat);

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
    holeCards = [], lastAction: rawLastAction, eliminated,
    missedBlind, deadBlindOwedChips,
  } = serverSeat || {};
  // R1 (AUTH-6) — always a string here, whatever the frame carried.
  const name = safeName(playerName || _name || '', '');
  const lastAction = typeof rawLastAction === 'string' ? rawLastAction : null;
  // Show a small red badge on any seat currently owing dead blinds, so
  // observers can instantly see who skipped their turn and why they
  // aren't being dealt in. Only render if owed > 0 (non-null missedBlind
  // can linger before reset).
  const hasDeadBlindDebt = (deadBlindOwedChips || 0) > 0;

  // Bet-slide trigger: when this seat's committed bet INCREASES
  // (bet / raise / call / blind post), ask the table to fling a chip stack
  // from this seat to the pot. `currentBet` is reset to 0 by the server each
  // street, so a DECREASE is never a wager — fire only on increase. prevBetRef
  // starts null so mounting mid-hand (rejoin / spectate) never fires spuriously.
  // Must stay above the early return at line ~374 so hook order is stable.
  const prevBetRef = useRef(null);
  useEffect(() => {
    if (!isOccupied && !isSittingOut) { prevBetRef.current = null; return; }
    const cur = currentBet || 0;
    const prev = prevBetRef.current;
    prevBetRef.current = cur;
    if (prev === null) return;
    if (cur > prev) onBetSlide?.(seatIndex);
  }, [currentBet, isOccupied, isSittingOut, seatIndex, onBetSlide]);

  /* ── Empty / vacatable seat ─────────────────────────────────
     Renders an "Open" placeholder for any seat that isn't actively
     playing: truly empty seats, and also seats where the server
     still has an `eliminated` flag set from a prior bust that hasn't
     been cleaned up yet. Previously `if (eliminated) return null`
     skipped rendering entirely, so the seat position was physically
     missing from the oval — visually the table looked like it had
     fewer than 9 seats. Treating eliminated-but-still-there as "Open"
     matches player intuition: a busted-out seat is available to sit.

     2026-06-11 — but ONLY for tournaments. `eliminated` is set the instant
     a seat's chipCount hits 0 (PokerTable.ts:444 / index.ts:2747 — i.e. the
     moment a player goes all-in or busts). At a CASH table that player is
     reloaded to the min buy-in on the very next hand, so rendering them as
     an empty "Open" seat for that window made the player VANISH from their
     seat and pop back a moment later — the long-standing "random players
     disappearing mid-hand" report. Gate on isTournament so a cash bust
     stays visibly seated (it just shows 0 chips) right through the reload;
     a real tournament bust still clears to Open. */
  if (!serverSeat || (!isOccupied && !isSittingOut) || (eliminated && isTournament)) {
    // Gameplay audit G182 (2026-10-21) — a seat past the table's cap
    // (heads-up, 6-max Draw / Omaha-6, a small home game) does not exist: no
    // "Open" pod, no Sit Here / Move here (a move there could never happen).
    if (beyondCap) return null;
    // Disable "Sit Here" for tournament tables — TournamentManager owns
    // seating there. Still show the "Open" placeholder so the oval layout
    // stays 9-wide and spectators can see where the empty seats are.
    // R2 (TABLEUI-15) — a spectator sits only where joinTable can seat him.
    const canInteract = heroAlreadySeated ? !isTournament : !!spectatorSits;
    // When the hero is already seated, the action is a seat MOVE (cash
    // tables only). Show a different label so the intent is explicit.
    const btnLabel = heroAlreadySeated ? 'Move here' : 'Sit Here';
    // A spectator sees "Sit Here" at once (a phone has no hover); a seated
    // player still taps once to reveal "Move here" (no accidental moves).
    const showSitBtn = canInteract && (hovered || (!heroAlreadySeated && spectatorSits));
    return (
      <div
        className={`seat-pod seat-pod--empty ${isPendingMoveTarget ? 'seat-pod--pending-move' : ''}`}
        data-seat-index={seatIndex}
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
          <div className="seat-pod__label" style={{ color: '#3b82f6', fontWeight: 700 }}>
            Moving here…
          </div>
        ) : showSitBtn ? (
          <button
            className={`seat-pod__sit-btn${!heroAlreadySeated ? ' seat-pod__sit-btn--spectator' : ''}`}
            onClick={(e) => { e.stopPropagation(); if (onSitHere) onSitHere(seatIndex); }}
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
  const posLabel = getPositionLabel(seatIndex, dealerButtonSeat, occupiedSeats, sbSeat, bbSeat);
  // Use avatar seatColor > skinTone > name-hash color
  const avatarColor = serverSeat?.avatar?.seatColor || serverSeat?.avatar?.skinTone || getAvatarColor(name || '?');
  const avatarPhoto = serverSeat?.avatar?.photo || null;

  const showdown = phase === 'Showdown' || phase === 'HandComplete';
  // Only consider handResult valid during Showdown/HandComplete. If the server
  // leaves handResult on state into the next PreFlop (which it currently does),
  // the WINNER banner + dealer-D ghost from the prior hand stick on the seat
  // during the new deal. Gating by phase drops those floaters at the hand
  // boundary so observers don't see stale UI. Fixed 2026-04-22.
  const winnerInfo = showdown ? handResult?.winners?.find(w => w.seatIndex === seatIndex) : null;
  const isWinner = !!winnerInfo;

  // 2026-04-22 audit fix: tighten the phase gate on revealing other players'
  // hole cards. Previously a lingering holeCards array (e.g. from a stale
  // handResult or a delta that carried cards but no phase update yet) could
  // briefly render opponent cards face-up outside Showdown/HandComplete.
  // Require: Showdown or HandComplete phase AND the seat isn't folded/mucked.
  // Defensive — never reveal cards just because the server sent them.
  const canRevealAtShowdown =
    (phase === 'Showdown' || phase === 'HandComplete') &&
    !isFolded &&
    !serverSeat?.mucked;
  const showCardsFaceUp =
    isMyPlayer ||
    (canRevealAtShowdown && holeCards?.length > 0 && holeCards[0]?.rank != null);
  // R2 (P3) — backs only for a seat DEALT IN to this hand: a player who sat
  // down mid-hand or sits out holds no cards (`hasCards`, sent with every
  // seat; a payload without it falls back to the seat's own cards).
  const dealtIn = typeof serverSeat?.hasCards === 'boolean'
    ? serverSeat.hasCards
    : (Array.isArray(serverSeat?.holeCards) ? serverSeat.holeCards.length > 0 : true);
  const showCardBacks   = dealtIn && !isFolded && !isMyPlayer && phase !== 'WaitingForPlayers' && phase !== 'HandComplete';
  // F125 / F136 — the face-down row (backs + Stud up-cards) and its fan class.
  const cardSlots = opponentCardSlots(serverSeat, backCount);
  const cardKeyTag = handNumber != null ? `${handNumber}:` : '';
  const shownCount = showCardsFaceUp && holeCards?.length > 0 ? holeCards.length : cardSlots.length;
  const cardRowClass = `${shownCount > 2 ? ' seat-pod__cards--many' : ''}${
    showCardsFaceUp ? (shownCount > 2 ? ' seat-pod__cards--shown' : '') : (cardSlots.some((c) => c.card) ? ' seat-pod__cards--stud' : '')}`;

  // Derive timer % from server timestamp (timerTick forces re-render each second)
  const timerPct = (() => {
    void timerTick; // used for re-render dependency
    if (!isActive || !turnStartedAt) return 100;
    // R2 (P3) — on the SERVER's clock (_serverTs offset), not the device's.
    const elapsed = serverNow() - turnStartedAt;
    return Math.max(0, Math.min(100, ((turnTimeout - elapsed) / turnTimeout) * 100));
  })();

  const stackBBs = bigBlind > 0 ? chips / bigBlind : 999;
  // R3 (K1-7) — under 10 BB is blue (amber is already the 10-25 BB tier).
  const stackColor =
    stackBBs < 10 ? '#60a5fa' :
    stackBBs < 25 ? '#fbbf24' :
    stackBBs > 50 ? '#4ade80' : '#e2e8f0';

  const avatarContent = isMyPlayer && heroEmoji
    ? heroEmoji
    : isSittingOut
    ? '💤'
    : nameInitial(name);

  // ── Nameplate enrichment data ──────────────────────────────
  const tag    = !isMyPlayer && name ? getPlayerTag(name) : null;
  const tagDef = tag?.color ? COLOR_TAGS.find(t => t.id === tag.color) : null;

  // 2026-10-23 — `hideStats`: a qualifier table (help tools off), no HUD stats.
  const stats     = !isMyPlayer && name && !hideStats ? getOpponentStats(name) : null;
  const showStats = stats && stats.hands >= 5;

  const rankInfo = serverSeat?.rank ? getRankInfo(serverSeat.rank) : null;

  // R2 (C7 / C8) — the seated account's equipped look: card back, nameplate
  // frame (or the VIP gold frame), title, season badge, VIP badge. A seat
  // without `cosmetics` (older server, AI) draws exactly as before.
  const look = seatLook(serverSeat?.cosmetics);
  const hasLook = !!(look.frameClass || look.vip || look.title || look.badge);

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
      data-seat-index={seatIndex}
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

      {/* Hole cards (opponents: face-down; showdown: face-up).
          Gameplay audit F125 / F136 (2026-10-21) — the variant's real card
          count (Omaha 4-6, Draw 5, Badugi 4, Pineapple 3 until the discard)
          and, in Stud / Razz / Stud 8, the server's public up-cards face up
          (they were two blank backs). */}
      {!isMyPlayer && (showCardsFaceUp || showCardBacks) && (
        <div className={`seat-pod__cards${hovered ? ' seat-pod__cards--hovered' : ''}${cardRowClass}`}>
          {/* F125 fix-up — face up under the key the same card had face
              down, so the showdown turns it over in place (a new key
              remounted it and replayed the deal-in, every variant). The
              hand number is part of the key: a new hand's cards deal in
              fresh, even where the last hand's shown cards were still up. */}
          {showCardsFaceUp && holeCards?.length > 0
            ? holeCards.map((c, i) => (
                <Card2D key={`${cardKeyTag}${shownCardKey(cardSlots, i)}`} card={c} faceUp small dealDelay={i * 0.07} />
              ))
            : cardSlots.map((slot, i) => (
                slot.card
                  ? <Card2D key={`${cardKeyTag}${slot.key}`} card={slot.card} faceUp small dealDelay={i * 0.07} />
                  : <Card2D key={`${cardKeyTag}${slot.key}`} card={null} faceUp={false} small dealDelay={i * 0.07} backClass={look.cardBack} />
              ))
          }
        </div>
      )}

      {/* Avatar with optional timer ring + all-in pulse ring.
          Hero's own seat skips the avatar-ring: the nameplate timer-ring
          (rendered by GameHUD) is the sole hero countdown now. Showing both
          is redundant and caused the "3 timers at once" complaint
          2026-04-22. Opponents still get the avatar ring so the player
          knows whose turn it is. */}
      <div className="seat-pod__avatar-wrap">
        {isActive && !isMyPlayer && (
          <svg className="seat-pod__timer-ring" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="22" stroke="rgba(255,255,255,0.12)" strokeWidth="3" fill="none" />
            <circle
              cx="25" cy="25" r="22"
              stroke={timerPct < 25 ? '#f59e0b' : '#4ade80'}
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

      {/* Hero YOU badge removed per user request ("get rid of where it
          says you"). The hero already has a distinct cyan ring + their
          name rendered in the hud-nameplate-me below the cards, so the
          extra "YOU" label was redundant. */}
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
        <div className={`seat-pod__nameplate${isSittingOut ? ' seat-pod__nameplate--sitout' : ''}${hasLook ? ` np-cos ${look.frameClass}` : ''}`}>
          {look.vip && <span className="np-vip" title="VIP">VIP</span>}

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
            {look.badge && <span className="np-badge" title={look.badge.name}>{look.badge.icon}</span>}
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

          {look.title && <div className={look.titleClass}>{look.title}</div>}

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
      {currentBet > 0 && <ChipStack amount={currentBet} key={currentBet} side={betSide} />}
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
  // Sit & Go fix-all F18 — stacks in big blinds use the HAND's level (a
  // tournament level-up mid-hand applies from the next hand).
  const bigBlind       = handLevelOf(gameState).bb || (gameState?.bigBlind ?? (gameState?.smallBlind ?? 0) * 2);
  const communityCards = gameState?.communityCards ?? [];
  // 2026-10-23 (owner: "Turn all off") — a qualifier table: no seat HUD stats.
  const helpToolsOff = helpToolsOffAt(gameState);

  // Pending-seat-move state. When the server ACKs a `moveSeat` request it
  // emits `moveSeatPending { pendingSeat }`; on execution at the next
  // hand boundary it emits `moveSeatComplete { newSeat }` which clears.
  // Gameplay audit G182 / F78 (2026-10-21) — the pill belongs to ONE table:
  // a pending frame naming another table than the one on screen (multi-table)
  // is ignored; a complete / cancelled frame ends only its own table's move
  // (one naming no table — an older server — ends it); the pill shows only
  // on its table.
  const [pendingMove, setPendingMove] = useState(null); // { tableId, seat, handNumber }
  const shownTableIdRef = useRef(null);
  const shownTableId = gameState?.tableId ?? null;
  useEffect(() => { shownTableIdRef.current = shownTableId; }, [shownTableId]);
  const shownHandRef = useRef(null);
  const shownHandNo = gameState?.handNumber ?? null;
  useEffect(() => { shownHandRef.current = shownHandNo; }, [shownHandNo]);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onPending = (d) => {
      if (d?.pendingSeat == null || !seatMoveFrameIsForTable(d, shownTableIdRef.current)) return;
      setPendingMove({ tableId: d.tableId ?? shownTableIdRef.current, seat: d.pendingSeat, handNumber: shownHandRef.current });
    };
    const onEnded = (d) => setPendingMove((pm) => (
      pm && (pm.tableId == null || seatMoveFrameIsForTable(d, pm.tableId)) ? null : pm
    ));
    const onComplete = onEnded;
    const onCancelled = onEnded;
    socket.on('moveSeatPending', onPending);
    socket.on('moveSeatComplete', onComplete);
    socket.on('moveSeatCancelled', onCancelled);
    return () => {
      socket.off('moveSeatPending', onPending);
      socket.off('moveSeatComplete', onComplete);
      socket.off('moveSeatCancelled', onCancelled);
    };
  }, []);

  // F78 (C3) — a later hand at that table with him not in the target seat:
  // the move was dropped at the boundary (an older server says nothing).
  useEffect(() => {
    if (pendingMoveExpired(pendingMove, gameState)) setPendingMove(null);
  }, [pendingMove, gameState]);

  const pendingSeat = pendingMove
    && (pendingMove.tableId == null || String(pendingMove.tableId) === String(gameState?.tableId ?? ''))
    ? pendingMove.seat : null;

  // Gameplay audit G175 (2026-10-21) — the seats the server rotates the
  // button / blinds over this hand (busted seats, mid-hand joiners and Stud
  // are out); only the position badges read it.
  const occupiedSeats = rotationSeats(seats, { phase, isStudGame: gameState?.isStudGame === true });
  // G175 fix-up — this hand's blind seats when the server sends them.
  const blindSeats = blindSeatsOf(gameState);
  // F136 — how many cards an opponent holds face down at this table.
  const backCount = tableBackCount(gameState);
  // G182 — seats this table can seat (the server's maxSeats; 9 when absent).
  const seatCap = seatCapOf(gameState, SEAT_COUNT);

  // R2 (TABLEUI-15) — a spectator of a joinable table sees "Sit Here" on every open seat.
  const viewerCanSit = (yourSeat < 0 || gameState?.isSpectator === true) && spectatorCanSit(gameState);

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
        // Gameplay audit G179 — a hand he sat out / sat down during is no loss.
        if (!winnerNames.has(pName) && rowNotDealtIn(hist, p)) continue;
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
      // R2 (TABLEUI-8/9) — GameHUD's useTableGeometry re-reads the felt rect
      // (the board, hero cards and pot label are placed from it).
      try { window.dispatchEvent(new Event(TABLE_GEOMETRY_EVENT)); } catch { /* ignore */ }
    };
    const ro = new ResizeObserver(update);
    if (sceneRef.current) ro.observe(sceneRef.current);
    if (feltRef.current)  ro.observe(feltRef.current);
    update();
    return () => ro.disconnect();
  }, []);

  /* ── Chip-to-pot flyers ──────────────────────────────────────
     A short-lived list of chip stacks flung from a seat to the pot on each
     wager (fired by SeatPod's bet-diff effect via onBetSlide). Positions
     reuse the EXACT seat-placement math (duplicated below, NOT shared — so
     the live seat map at ~1058 is never touched and seats can never move).
     The px travel-delta is measured once at spawn from sceneRef (not per
     frame); the keyframe then animates a GPU-only translate. The layer is an
     absolute, pointer-events:none sibling inside .table2d-scene, so it never
     affects feltRef's rect or the seat layout. */
  const [chipFlyers, setChipFlyers] = useState([]);
  const flyerIdRef = useRef(0);
  const flyPosRef = useRef({ seatEllipse: null, yourSeat: -1 });
  flyPosRef.current = { seatEllipse, yourSeat };
  const handleBetSlide = useCallback((seatIndex) => {
    const scene = sceneRef.current;
    const { seatEllipse: se, yourSeat: ys } = flyPosRef.current;
    if (!scene || !se) return;
    const sr = scene.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    // Identical rotation + ellipse math as the seat map (kept in lock-step).
    const heroAngle = ys >= 0 ? SEAT_ANGLES[ys] : Math.PI / 2;
    const angle = SEAT_ANGLES[seatIndex] + (Math.PI / 2 - heroAngle);
    const seatLeft = (se.cx + Math.cos(angle) * se.xR) * 100;
    const seatTop  = (se.cy + Math.sin(angle) * se.yR) * 100;
    // Target = felt centre (se.cx/se.cy) — the same measured point seats orbit.
    const dx = (se.cx * 100 - seatLeft) / 100 * sr.width;
    const dy = (se.cy * 100 - seatTop)  / 100 * sr.height;
    const id = flyerIdRef.current++;
    setChipFlyers(f => [...f, { id, left: seatLeft, top: seatTop, dx, dy }]);
    setTimeout(() => setChipFlyers(f => f.filter(x => x.id !== id)), 650);
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
  // R2 (C7) — the felt of the table theme the player EQUIPPED in the shop
  // (`gameState.myTheme`, server-validated). It wins over the Options felt
  // picker until he picks a felt there while it is equipped (a later equip
  // shows again). Unknown / no theme: the picker's felt, as before.
  const myTheme = gameState?.myTheme ?? null;
  const shopFelt = feltForTheme(myTheme);
  const [feltPickedFor, setFeltPickedFor] = useState(undefined);
  const feltBg = shopFelt && feltPickedFor !== myTheme ? shopFelt.felt : theme.felt;

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
      // R2 (C7) — 'equipped' = back to the shop theme; a felt key = the
      // player's own pick, over the equipped theme it was picked against.
      if (key === 'equipped') { setFeltPickedFor(undefined); return; }
      if (key && TABLE_THEMES[key]) {
        setThemeKey(key);
        setFeltPickedFor(e?.detail?.over ?? null);
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
  // `_onOpenPlayerNotes` is a module-level `let` set via setOnOpenPlayerNotes
  // (see top of file). Module bindings are read at CALL time, not captured
  // at useCallback-definition time, so an empty deps array is correct here —
  // every click reads the currently-registered handler, even if it was
  // registered after this component mounted. Do NOT add `_onOpenPlayerNotes`
  // to the deps array: it's not a React value and the lint rule would never
  // flag it anyway.
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
    // G182 — no seat past the table's cap (the server refuses it).
    if (!(seatIndex < seatCapOf(gameState, SEAT_COUNT))) return;
    const alreadySeated = yourSeat >= 0 && !gameState?.isSpectator;
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
    } else if (spectatorCanSit(gameState) && gameState?.tableId) {
      // R2 (TABLEUI-15) — a spectator takes THIS seat through joinTable (the
      // server honours seatIndex when it is empty, else picks another); the
      // old 'takeSeat' had no server handler and did nothing. The buy-in is the
      // table's minimum (the server clamps it); the account's display name is
      // used server-side whatever is sent (R1 contract #3). No expectedVariant:
      // he is joining the table he is looking at.
      const gs = useGameStore.getState();
      useTableStore.getState().joinTable(
        gameState.tableId, gs.playerName, seatIndex,
        Number(gameState?.minBuyIn) > 0 ? Number(gameState.minBuyIn) : 0,
        gs.avatar,
      );
    }
  }, [yourSeat, gameState]);
  // F78 — the cancel names the table on screen (the server answers
  // moveSeatCancelled for it; an older server ignores the payload).
  const cancelPendingMove = useCallback(() => {
    const socket = getSocket();
    if (socket?.connected) socket.emit('cancelMoveSeat', { tableId: pendingMove?.tableId ?? gameState?.tableId ?? undefined });
  }, [pendingMove, gameState?.tableId]);

  return (
    <div className="table2d-scene" ref={sceneRef}>
      {/* Dark background */}
      <div className="table2d-bg" />
      {/* Atmosphere: overhead light shaft + drifting motes (decorative) */}
      <div className="table2d-rays" />
      <div className="table2d-motes">
        <span className="table2d-mote table2d-mote--1" />
        <span className="table2d-mote table2d-mote--2" />
        <span className="table2d-mote table2d-mote--3" />
        <span className="table2d-mote table2d-mote--4" />
      </div>

      {/* ── Felt oval ─────────────────────────────────────── */}
      {/* .table2d-felt is now the RAIL (brushed-gold conic, animated angle);
         the felt SURFACE is inset inside it. Kept exactly the same outer size
         so feltRef's rect — which drives seat positioning — is unchanged.
         theme.felt is passed as a CSS var so the surface can layer texture
         over the (still theme-selectable) felt colour. */}
      <div
        className="table2d-felt"
        ref={feltRef}
        style={{ '--felt-bg': feltBg }}
      >
       <div className="table2d-felt__surface">
        {/* drifting spotlight caustic on the felt */}
        <div className="table2d-felt__spot" />
        {/* Pot-sweep victory glow — felt erupts warm gold as the pot is won.
            Absolutely positioned + pointer-events:none, so it never touches
            feltRef's rect or the seat layout. Gated to the showdown window. */}
        {(phase === 'Showdown' || phase === 'HandComplete') &&
          (handResult?.winners?.length ?? 0) > 0 && (
            <div className="table2d-felt__win-glow" aria-hidden="true" />
        )}
        {/* Logo watermark — embossed gold medallion */}
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
       </div>{/* /.table2d-felt__surface */}
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
            background: '#3b82f6', animation: 'movePendPulse 1.2s infinite',
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
        // R2 (TABLEUI-9) — a SIDE seat's bet chips go toward the felt (left of a
        // right-hand seat, right of a left-hand one); stacked above it they
        // covered the nameplate of the seat above.
        const betSide = Math.abs(y) <= 0.6 ? (x > 0 ? 'left' : 'right') : null;
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
            /* Gameplay audit G169 (2026-10-21) — in a draw round on the
               server's draw clock every seat draws at once: no "to act" ring
               (it was the closer's stale betting clock running out). */
            isActive={activeSeat === i && !(gameState?.isDrawPhase && gameState?.drawStartedAt > 0)}
            style={{
              left: `${leftPct}%`,
              top:  `${topPct}%`,
            }}
            dealerButtonSeat={dealerSeat}
            occupiedSeats={occupiedSeats}
            sbSeat={blindSeats ? blindSeats.sb : null}
            bbSeat={blindSeats ? blindSeats.bb : null}
            handResult={handResult}
            phase={phase}
            onClickNameplate={onClickNameplate}
            bigBlind={bigBlind}
            heroEmoji={heroEmoji}
            onSitHere={onSitHere}
            winStreak={winStreaks.get(seatName) ?? 0}
            isTournament={isTournamentTbl}
            heroAlreadySeated={yourSeat >= 0 && !gameState?.isSpectator}
            spectatorSits={viewerCanSit}
            isPendingMoveTarget={pendingSeat === i}
            onBetSlide={handleBetSlide}
            betSide={betSide}
            backCount={backCount}
            beyondCap={i >= seatCap}
            handNumber={gameState?.handNumber ?? null}
            hideStats={helpToolsOff}
          />
        );
      })}

      {/* Chip-to-pot flyers — absolute, pointer-events:none; sibling of the
          seat pods so it shares the scene coordinate space but never touches
          feltRef / seat layout. Each travels from its seat to the felt centre. */}
      {chipFlyers.map(fl => (
        <div
          key={fl.id}
          className="chip-fly"
          style={{
            left: `${fl.left}%`,
            top: `${fl.top}%`,
            '--fly-dx': `${fl.dx}px`,
            '--fly-dy': `${fl.dy}px`,
          }}
          aria-hidden="true"
        >
          <span className="chip-fly__disc" />
          <span className="chip-fly__disc" />
          <span className="chip-fly__disc" />
        </div>
      ))}
    </div>
  );
}
