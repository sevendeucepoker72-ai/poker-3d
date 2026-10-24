import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../../store/gameStore';
import { useTableStore, SIT_OUT_PREF_KEY } from '../../store/tableStore';
import { useShallow } from 'zustand/react/shallow';
import { SUIT_INDEX_TO_SYMBOL, SUIT_INDEX_TO_COLOR, serverRankDisplay, getCardColor } from '../../utils/cardUtils';
import { evaluateHandStrength, getWinningCardIndices } from '../../utils/handStrength';
import { calculateOuts, analyzeBoardTexture } from '../../utils/outsCalculator';
// Gameplay audit 2026-10-21 (C1) — the action bar's rules, kept pure + probed.
import {
  raiseLimits, allInButtonMode, shownRaiseAmount, betVerb, callView, queuedCallAnyAction,
  preActionKeysFor, turnDecisionKey, drawTurnInfo, preflopTierOf, leaveConfirmText,
  handIsOver, revealDecision, pineappleAckRefused, SHOW_AT_HAND_END_TEXT,
  allInHiddenText,
  // Sit & Go fix-all F2 — the live strip's lines ('Name bet 40' opens a street).
  stripActionEntry, isStripBetEntry,
  // Sit & Go fix-all C4 — a queued Fold checks when checking is free.
  queuedFoldAction, foldIsFree, QUEUED_FOLD_CHECKED_TEXT, QUEUED_FOLD_TITLE,
  FOLD_FREE_HINT_TEXT, FOLD_FREE_ARIA_TEXT,
} from '../../utils/actionBar';
// Gameplay audit 2026-10-21 (C2) — winner banner / showdown rows / equity per
// variant / hand boundary rules, kept pure + probed.
import {
  winnerBannerLines, perPotUsable, potWinnerRows, showdownRowHandName, equitySimFor,
  isNextHandAtSameTable, rabbitHuntOffered,
  // Sit & Go fix-all F20 — auto-mucked losing hands at the showdown.
  muckedShowdownRows, ownHandMucked, MUCKED_TEXT, OWN_MUCKED_TEXT,
} from '../../utils/tableRender';
// R1 (2026-10-11) — the table's defensive payload readers (names, shown cards,
// the server's insurance quote, rebuy policy) and the sound settings keys.
import {
  safeName, nameInitial, sanitizeShownCards, readInsuranceQuote, readInsuranceAccepted,
  rebuyAllowedFlag, rebuyAmountFor,
} from '../../utils/tablePayload';
import useSoundEffects, { readSoundPrefs, SOUND_SETTINGS_EVENT, TABLE_SOUND_KEY } from '../../hooks/useSoundEffects';
import TrainingOverlay from './TrainingOverlay';
import EmoteWheel from './EmoteWheel';
import { EMOTE_MAP } from './emoteCatalog';
// PWA audit #9: request Screen Wake Lock while the user has an active
// turn so the phone doesn't auto-sleep mid-decision (which would drop
// the socket and auto-fold). Hook self-gates on browser support.
import useWakeLock from '../../hooks/useWakeLock';
/* MobileMoreSheet import removed — its floating ⋯ FAB was merged into
   the top-right Options dropdown per user request. The component file
   is kept in the tree in case the bottom-sheet pattern is needed
   elsewhere later, but nothing imports it now. */
import WinConfetti from './WinConfetti';
import SessionTracker from './SessionTracker';
import HandRangeChart from './HandRangeChart';
import PostHandAnalysis from './PostHandAnalysis';
import { recordHandStats, getOpponentStats } from '../../utils/opponentTracker';
// Sit & Go fix-all C5 — his own last hand (the bust hand) after a bust.
import { lastOwnHandOf } from '../../utils/handLog';
// Sit & Go fix-all F7 — a paid bust's place + prize line.
import { bustBannerPrizeLine } from '../../utils/tournamentFinish';
import { useProgressStore } from '../../store/progressStore';
import { useEquityWorker } from '../../hooks/useEquityWorker';
import { getSocket, subscribeConnectionStatus } from '../../services/socketService';
import { reportPlayRefusal, notePlayAttempt } from '../../services/playRefusal';
import { useTimerStore, serverNow } from '../../store/timerStore';
// 2026-10-10 (S2) — a LIVE tournament seat is kept in play (absent) when the
// player leaves the table screen; he is told so first and returns from the lobby.
import {
  useTournamentSeatStore, isTournamentSeatView, leaveTournamentSeatToLobby, eliminationShownElsewhere,
  TOURNAMENT_SEAT_AWAY_ACTS_TEXT, awaySeatOfTournament, awaySeatKey,
} from '../../store/tournamentSeatStore';
import { returnToTournament } from '../../services/tournamentReturn';
import { TournamentLeaveDialog } from '../ui/TournamentSeatNotice';
// 2026-10-22 — the tournament's running level clock, standings line and
// held-table banner, from the OPTIONAL gameState.tournamentClock.
import { TournamentClockStrip, TournamentHeldBanner } from './TournamentClockStrip';
import { tableTournamentClock, formatSecondsClock, spectatorStatusText, handLevelOf, blindsLineText, nextLevelText } from '../../utils/tournamentClock';
import { useTournamentClockStore } from '../../store/tournamentClockStore';
// 2026-10-23 (owner: "Turn all off") — no help tools at a QUALIFIER table.
import { helpToolsOffAt, helpToolsOffAtAnyTable, QUALIFIER_HELP_TOOLS_OFF_TEXT } from '../../utils/qualifierHelpTools';
// Gameplay audit 2026-10-21 (C3) — multi-table scope of the seat controls,
// per-table Sit Out, replies for another table, the Back button, the Dealer's
// Choice label.
import { tableScope, isOtherTableReply, sittingOutHereOf, dealersChoiceTruthful } from '../../utils/tableFlows';
import { setTableBackHandler } from '../../services/tableBack';
import { loadHotkeys } from '../ui/HotkeySettings';
import { useAFKTracker } from '../../hooks/useAFKTracker';
import { notify } from '../../hooks/usePushNotifications';
import { liveTableIds } from '../../store/tableStore';
import { OPEN_TABLE_PICKER_EVENT } from './MultiTableTabs';
import useTableGeometry from './useTableGeometry';
// R2 (C7 / C8) — the hero's own seat look + the equipped table theme.
import { seatLook, feltForTheme } from '../scene/tableCosmetics';
import './GameHUD.css';
// R2 (TABLEUI-8/9) — the phone layout layer; imported LAST so it is the final
// layer of the table cascade (it reads useTableGeometry's measured CSS vars).
import './TableLayout.css';

import OverlayBoundary from '../ui/OverlayBoundary';

// HandReplayViewer is imported eagerly — lazy()-loading was causing the
// "Last Hand" button to silently do nothing when a stale service-worker
// cached a bad chunk reference. It's small enough to bundle with GameHUD
// directly, and it's the single most-used overlay.
import HandReplayViewer from '../replay/HandReplayViewer';

// ─── Lazy-loaded overlays — only downloaded when first opened ─────────────────
const HotkeySettings    = lazy(() => import('../ui/HotkeySettings'));
const AchievementsPanel = lazy(() => import('../ui/AchievementsPanel'));
const EquityCalculator  = lazy(() => import('../ui/EquityCalculator'));
const ProvablyFair      = lazy(() => import('../ui/ProvablyFair'));
const ShareReplay       = lazy(() => import('../ui/ShareReplay'));
const GTOOverlay        = lazy(() => import('../ui/GTOOverlay'));
const PostHandCoach     = lazy(() => import('../ui/PostHandCoach'));
const VoiceChat         = lazy(() => import('../ui/VoiceChat'));
const TimingTellTracker = lazy(() => import('../ui/TimingTellTracker'));
const TableCommentary   = lazy(() => import('../ui/TableCommentary'));
const RangeVisualizer   = lazy(() => import('../ui/RangeVisualizer'));
const SpectatorPredict  = lazy(() => import('../ui/SpectatorPredict'));
const PauseCoach        = lazy(() => import('../ui/PauseCoach'));
const StreamOverlay     = lazy(() => import('../ui/StreamOverlay'));
const CoachingRail      = lazy(() => import('../ui/CoachingRail'));
const SessionRecap      = lazy(() => import('../ui/SessionRecap'));
const GTOSolver         = lazy(() => import('../ui/GTOSolver'));
const PredictionMarket  = lazy(() => import('../ui/PredictionMarket'));
const HandHeatmap       = lazy(() => import('../ui/HandHeatmap'));

// ─── Static data outside the component so it never recreates ─────────────────
const QUICK_CHATS = ['Nice hand', 'Good luck', 'gg', 'lol'];
const GIF_REACTIONS = [
  { emoji: '\uD83C\uDF89', label: 'Nice!' },
  { emoji: '\uD83D\uDE02', label: 'LOL' },
  { emoji: '\uD83D\uDD25', label: 'Hot!' },
  { emoji: '\uD83D\uDC80', label: 'RIP' },
  { emoji: '\uD83D\uDC4F', label: 'GG' },
  { emoji: '\uD83D\uDE24', label: 'Tilted' },
];

// ─── Memoized chat panel — only re-renders when messages or open state changes ─
const ChatPanel = React.memo(function ChatPanel({ chatOpen, setChatOpen, chatUnread, setChatUnread, chatMessages, chatInput, setChatInput, chatEndRef, handleSendChat, handleChatKeyDown }) {
  return (
    <div className={`chat-panel ${chatOpen ? 'chat-open' : 'chat-closed'}`}>
      <button className="chat-toggle" onClick={() => { setChatOpen(o => !o); setChatUnread(0); }}>
        <span className="chat-toggle-icon">💬</span>
        {!chatOpen && chatUnread > 0 && (
          <span className="chat-unread-badge">{chatUnread}</span>
        )}
        <span className="chat-toggle-label">{chatOpen ? '▼' : '▲'}</span>
      </button>
      {chatOpen && (
        <div className="chat-body">
          <div className="chat-messages">
            {chatMessages.map((msg, i) => (
              <div key={i} className="chat-msg">
                <span className="chat-msg-name">{msg.playerName}:</span>{' '}
                <span className="chat-msg-text">{msg.message}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="chat-quick">
            {QUICK_CHATS.map((text) => (
              <button key={text} className="chat-quick-btn" onClick={() => handleSendChat(text)}>
                {text}
              </button>
            ))}
          </div>
          <div className="chat-gif-reactions">
            {GIF_REACTIONS.map((r) => (
              <button key={r.label} className="chat-gif-btn" onClick={() => handleSendChat(`${r.emoji} ${r.label}`)}>
                {r.emoji} {r.label}
              </button>
            ))}
          </div>
          <div className="chat-input-row">
            <input
              type="text"
              className="chat-input"
              placeholder="Type a message..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleChatKeyDown}
              maxLength={200}
            />
            <button className="chat-send" onClick={() => handleSendChat(chatInput)}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
});

const haptic = (pattern) => { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) {} };

// R2 (S2) — what a refused table action means when the server sends only its
// stable code (every current server message is shown verbatim instead).
const ACTION_ERROR_TEXT = {
  straddle_not_allowed: 'Straddles are only available at cash tables.',
  bomb_pot_not_allowed: 'Bomb pots are only available at Hold\'em and Omaha cash tables.',
  invalid_draw: 'That draw is not allowed right now.',
  no_seat_available: 'No seat is free at this table right now.',
  server_restarting: 'Server is restarting — try again in a moment.',
  sit_out_limit: 'You were sitting out for a while, so your seat was released and your chips went back to your balance.',
};
// The fixed-limit variants (the server's bettingStructure 'fixed-limit').
const FIXED_LIMIT_VARIANT = /^(seven-card-stud|seven-card-stud-hi-lo|razz|triple-draw)$/;

// R1 (TABLEUI-2) — the ONLY surface a touch gesture may start on: the table
// felt (PokerTable2D's oval, drawn under the HUD). Anything interactive, a
// seat, or any HUD layer drawn over the felt is never a gesture surface.
const GESTURE_SURFACE_SELECTOR = '.table2d-felt';
const GESTURE_BLOCKED_SELECTOR = [
  'button', 'input', 'select', 'textarea', 'a', 'label',
  '[role="button"]', '[role="dialog"]', '[role="slider"]', '[contenteditable="true"]',
  '.hud', '.hud-top', '.hud-bottom', '.hud-options-dropdown', '.raise-inline-group',
  '.seat-pod', '.table2d-emoji-picker', '.table2d-emoji-backdrop',
].join(', ');
// Layers drawn OVER the felt that let touches fall through to it
// (pointer-events: none) — the hero's nameplate and cards, the board, the hand
// strength pill, pot odds, the action history — plus the seats (a near-miss
// on a seat): a touch on or right next to them is not a touch on bare felt.
const GESTURE_KEEP_OUT_SELECTOR = [
  '.hud-nameplate-me', '.hud-cards', '.hud-community', '.hand-strength-portal',
  '.table-pot-odds', '.action-history-floating', '.seat-pod',
].join(', ');
const GESTURE_KEEP_OUT_PAD = 8;
function pointInsideAny(x, y, selector, pad) {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return true;
  }
  return false;
}
function gestureStartAllowed(target, x, y) {
  if (!target || typeof target.closest !== 'function') return false;
  if (!target.closest(GESTURE_SURFACE_SELECTOR)) return false;
  if (target.closest(GESTURE_BLOCKED_SELECTOR)) return false;
  if (typeof x === 'number' && typeof y === 'number'
    && pointInsideAny(x, y, GESTURE_KEEP_OUT_SELECTOR, GESTURE_KEEP_OUT_PAD)) return false;
  return true;
}

export default function GameHUD() {
  const { calculateEquity } = useEquityWorker();
  // R2 (TABLEUI-8/9) — measured bar / top bar / felt geometry → CSS vars.
  useTableGeometry();
  // R2 (TABLEUI-14) — the tab bar shows only with 2+ live seats; with one the
  // HUD no longer reserves its 36px band.
  const liveTableCount = useTableStore((s) => liveTableIds(s.activeTables).length);

  const { setScreen, playerName } = useGameStore(
    useShallow((s) => ({ setScreen: s.setScreen, playerName: s.playerName }))
  );

  // Game state slice — re-renders only when one of these values changes
  const gameState = useTableStore((s) => s.gameState);
  const {
    mySeat,
    sendAction,
    startHand,
    leaveTable,
    trainingEnabled,
    toggleTraining,
    setTrainingEnabled,
    sittingOut,
    toggleSitOut,
    setSitOut,
    currentTableId,
    isSpectating,
    stopSpectating,
    selectedDiscards,
    toggleDiscard,
    sendDraw,
    rabbitCards,
    setRabbitCards,
    clearRabbitCards,
    requestRabbitHunt,
  } = useTableStore(
    useShallow((s) => ({
      mySeat: s.mySeat,
      sendAction: s.sendAction,
      startHand: s.startHand,
      leaveTable: s.leaveTable,
      trainingEnabled: s.trainingEnabled,
      toggleTraining: s.toggleTraining,
      setTrainingEnabled: s.setTrainingEnabled,
      sittingOut: s.sittingOut,
      toggleSitOut: s.toggleSitOut,
      setSitOut: s.setSitOut,
      currentTableId: s.currentTableId,
      isSpectating: s.isSpectating,
      stopSpectating: s.stopSpectating,
      selectedDiscards: s.selectedDiscards,
      toggleDiscard: s.toggleDiscard,
      sendDraw: s.sendDraw,
      rabbitCards: s.rabbitCards,
      setRabbitCards: s.setRabbitCards,
      clearRabbitCards: s.clearRabbitCards,
      requestRabbitHunt: s.requestRabbitHunt,
    }))
  );
  // Chat and emotes in separate subscriptions — they update frequently and should
  // only trigger re-renders of the chat panel, not the entire HUD.
  const chatMessages = useTableStore((s) => s.chatMessages);
  const sendChat = useTableStore((s) => s.sendChat);
  // R2 (TABLEUI-10) — the training panel's open state + the badge's equity.
  const trainingPanelOpen = useTableStore((s) => s.trainingPanelOpen);
  const setTrainingPanelOpen = useTableStore((s) => s.setTrainingPanelOpen);
  const trainingEquityPct = useTableStore((s) => {
    const e = s.trainingData && s.trainingData.equity;
    return typeof e === 'number' && Number.isFinite(e) ? Math.round(Math.max(0, Math.min(100, e))) : null;
  });
  const emotes = useTableStore((s) => s.emotes);
  const handHistories = useTableStore((s) => s.handHistories);

  // Sound effects
  const { playSound } = useSoundEffects();

  // Raise slider state
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [showRaisePanel, setShowRaisePanel] = useState(false);

  // Timer state (local countdown derived from server timestamp)
  const [timeLeft, setTimeLeft] = useState(30);
  const timerRef = useRef(null);
  const timerWarningPlayed = useRef(false);
  const setTurnTiming  = useTimerStore((s) => s.setTurnTiming);
  const clearTurnTiming = useTimerStore((s) => s.clearTurnTiming);

  // Showdown overlay state
  const [showShowdown, setShowShowdown] = useState(false);
  const showdownTimerRef = useRef(null);

  // Tournament spectator state
  const [tournamentSpectator, setTournamentSpectator] = useState(null); // {tournamentId, tableId, tableIds, status}
  const [eliminatedPosition, setEliminatedPosition] = useState(null); // {position, totalPlayers}

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const specHandler = (data) => setTournamentSpectator(data);
    const elimHandler = (data) => {
      // S2 round 2 (P-e) — busted at a tournament table the player is NOT
      // playing on screen (his absent seat blinded out while he sits at a cash
      // table): his own table stays; App.jsx shows a notice. Only the table he
      // is watching / was seated at switches to the spectator view.
      // Round 3 (P-e'): a cash table he only WATCHES (P-d marks it) stays too.
      if (eliminationShownElsewhere(useTableStore.getState().gameState, data)) return;
      // Sit & Go fix-all F7 — `prize` (present when the place is paid and final).
      setEliminatedPosition({ position: data.position, totalPlayers: data.totalPlayers, prize: data.prize });
      setTournamentSpectator({
        tournamentId: data.tournamentId,
        tableId: data.tableId,
        tableIds: data.tableIds,
        status: data.status,
      });
    };
    socket.on('spectatingTournament', specHandler);
    socket.on('eliminatedToSpectator', elimHandler);
    return () => {
      socket.off('spectatingTournament', specHandler);
      socket.off('eliminatedToSpectator', elimHandler);
    };
  }, []);

  // Sit & Go fix-all C3 — the spectating line from the LIVE state (pure, probed).
  const spectatorStatusLine = spectatorStatusText(gameState, tournamentSpectator);

  const handleNextTable = (dir) => {
    const socket = getSocket();
    if (!socket || !tournamentSpectator) return;
    socket.emit('spectateNextTable', {
      tournamentId: tournamentSpectator.tournamentId,
      currentTableId: tournamentSpectator.tableId,
      direction: dir,
    });
  };

  // Last hand panel state
  const [showLastHand, setShowLastHand] = useState(false);

  // Replay viewer state
  const [showReplay, setShowReplay] = useState(false);
  // Sit & Go fix-all C5 — the record the replay opens (null = the latest);
  // a busted player opens HIS last hand (the bust hand), not the table's latest.
  const [replayRecord, setReplayRecord] = useState(null);

  // Auto-action state (pre-select before your turn)
  const [autoAction, setAutoAction] = useState(null); // 'fold' | 'check' | 'call' | 'callAny' | null
  const autoActionRef = useRef(null);

  // Pre-action buttons (Upgrade 1)
  const [preAction, setPreAction] = useState(null); // null | 'fold' | 'checkFold' | 'callAny' | 'checkOnly'

  // Last raise replay (Upgrade 4)
  const lastRaiseRef = useRef(null);

  // Action history strip (Upgrade 6)
  const [actionHistory, setActionHistory] = useState([]);
  const prevSeatsRef = useRef(null);
  const prevSeatsPhaseRef = useRef(null); // the street prevSeatsRef was taken on (F2)
  // Stable fingerprint for seat actions — only changes when actions change,
  // avoiding the JSON.stringify-in-deps anti-pattern that re-runs every render.
  const lastActionsFingerprint = useMemo(
    () => (gameState?.seats || []).map((s) => s?.lastAction || '').join('|'),
    [gameState?.seats]
  );

  // Bet sizing memory (Upgrade 7)
  const betMemoryRef = useRef(null);

  // Range chart and equity calculator overlays
  const [showRangeChart, setShowRangeChart] = useState(false);
  const [showEquityCalc, setShowEquityCalc] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);

  // New advanced features
  const [showProvablyFair, setShowProvablyFair] = useState(false);
  const [showShareReplay, setShowShareReplay] = useState(false);
  const [showPostHandCoach, setShowPostHandCoach] = useState(false);
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const [gtoVisible, setGtoVisible] = useState(false);
  const [showTimingTells, setShowTimingTells] = useState(false);
  const [showCommentary, setShowCommentary] = useState(false);
  const [showCoachingRail, setShowCoachingRail] = useState(false);
  const [showRangeViz, setShowRangeViz] = useState(false);
  const [showSpectatorPredict, setShowSpectatorPredict] = useState(false);
  const [showPauseCoach, setShowPauseCoach] = useState(false);
  const [showStream, setShowStream] = useState(false);
  const [showGTOSolver, setShowGTOSolver] = useState(false);
  const [showSessionRecap, setShowSessionRecap] = useState(false);
  const [showPredictionMarket, setShowPredictionMarket] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const deckCommitment = useTableStore((s) => s.deckCommitment);
  const deckRevelation = useTableStore((s) => s.deckRevelation);

  // Color blind mode (from settings)
  const [colorBlindMode, setColorBlindMode] = useState(() => {
    try {
      const raw = sessionStorage.getItem('app_poker_settings');
      if (raw) return JSON.parse(raw).colorBlindMode || false;
    } catch { /* ignore */ }
    return false;
  });

  // Touch gesture state
  const touchStartRef = useRef(null);
  const touchTimerRef = useRef(null);
  const [showGestureHint, setShowGestureHint] = useState(false);
  // Gesture flash feedback: null | 'fold' | 'call' | 'raise'
  const [gestureFlash, setGestureFlash] = useState(null);
  const gestureFlashTimerRef = useRef(null);
  const flashGesture = useCallback((type) => {
    clearTimeout(gestureFlashTimerRef.current);
    setGestureFlash(type);
    gestureFlashTimerRef.current = setTimeout(() => setGestureFlash(null), 450);
  }, []);

  // Upgrade: fold confirmation micro-animation
  const [foldPending, setFoldPending] = useState(false);
  const [foldFreeArmed, setFoldFreeArmed] = useState(false); // C4: armed while checking is free
  // Ref mirrors foldPending state synchronously so the click handler sees
  // the updated value within the same event-loop tick. Without it, a fast
  // double-tap can produce two "click 1" runs (both seeing foldPending=
  // false because React batches the state update), neither of which fires
  // handleAction('fold') — the hand then times out on the server's 30s
  // clock. Observed 2026-04-22 during audit: intended fold appeared to
  // mis-fire as a later-hand action. Use the ref for the conditional,
  // keep setFoldPending in sync with it for the visual pulse/hint.
  const foldPendingRef = useRef(false);
  const foldTimerRef = useRef(null);
  // Hotkey hint fade-out — visible for 30s per turn, then fades. Reset on
  // every new turn so the user always gets a reminder on their first action
  // in a fresh session but doesn't have permanent visual noise.
  const [hotkeyHintsVisible, setHotkeyHintsVisible] = useState(true);
  const [hotkeyHintsFading, setHotkeyHintsFading] = useState(false);
  const showBigBetConfirmRef = useRef(false);
  const [showRaiseSlider, setShowRaiseSlider] = useState(false);
  const isTouchDevice = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

  // Refs so touch handlers never need to re-register when these change
  // NOTE: these are declared here but populated after isMyTurn/callAmount are derived below
  const isMyTurnRef = useRef(false);
  const callAmountRef = useRef(0);
  // R1 (TABLEUI-2) — more gesture guards, read through refs so the document
  // touch listeners stay stable: the Options menu is open (a tap only closes
  // it), a legal raise exists (swipe up / hold), and the latest action
  // handlers (handleAction + the shared two-step fold).
  const optionsOpenRef = useRef(false);
  const canRaiseRef = useRef(false);
  const aofRef = useRef(false); // gameplay audit F107 — All-In-or-Fold table
  // F107 fix-up — at that table, Check is offered on a free street (its
  // server takes a check when nothing is owed: actionBar.aofAllowsCheck).
  const aofFreeCheckRef = useRef(false);
  // Gameplay audit F130 / G169 — a draw round is not a betting decision: the
  // seat that closed the betting stays in activeSeatIndex (isMyTurn), but no
  // check / call / raise is legal until the next betting round.
  const drawRoundRef = useRef(false);
  const gestureActRef = useRef({ handleAction: null, requestFold: null });

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);
  const [chatUnread, setChatUnread] = useState(0);
  const prevChatLenRef = useRef(0);

  // Hotkey settings state
  const [hotkeyOpen, setHotkeyOpen] = useState(false);
  const [hotkeys, setHotkeys] = useState(loadHotkeys);

  // Options dropdown state
  const [showOptions, setShowOptions] = useState(false);
  const optionsRef = useRef(null);

  // Bet sizing memory: last raise as percentage of pot
  const lastRaisePctRef = useRef(null);
  const [favBetSizes, setFavBetSizes] = useState(() => {
    try {
      const stored = sessionStorage.getItem('app_poker_betSizes');
      if (stored) return JSON.parse(stored);
    } catch (e) { /* ignore */ }
    return [null, null, null];
  });

  // Auto-rebuy state. Defaults ON — in testing mode / live-room mode,
  // players never want to see the "you're broke" prompt. If they bust,
  // the next hand starts with a fresh min-buyin stack. Server-side has a
  // matching free-reload in autoStartNextHand.
  const [autoRebuy, setAutoRebuy] = useState(() => {
    try {
      const raw = sessionStorage.getItem('app_poker_autoRebuy');
      if (raw === null) return true;
      return raw === 'true';
    } catch (e) { return true; }
  });
  const [rebuyNotification, setRebuyNotification] = useState(null);
  const prevPhaseForRebuyRef = useRef(null);

  // Connection status dot
  const [connStatus, setConnStatus] = useState('connected');

  // Unified toast queue — { id, msg, type: 'info'|'success'|'warn' }
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  // Opponent stats hover popup
  const [opponentStats, setOpponentStats] = useState(null); // { name, vpip, pfr, threeBet, af, hands }
  const opponentStatsTimerRef = useRef(null);

  // === Rabbit Hunt state ===
  const [showRabbitPanel, setShowRabbitPanel] = useState(false);
  // Client-side rabbit-hunt throttle. Timestamp (ms) until the next request is
  // allowed. 0 = ready. Cleared at start of each hand.
  const [rabbitHuntCooldownUntil, setRabbitHuntCooldownUntil] = useState(0);
  // Re-render once per second while the cooldown is active so the countdown
  // label in the button updates.
  const [, setRabbitTick] = useState(0);
  useEffect(() => {
    if (rabbitHuntCooldownUntil <= Date.now()) return;
    const id = setInterval(() => setRabbitTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [rabbitHuntCooldownUntil]);
  const [playerFoldedThisHand, setPlayerFoldedThisHand] = useState(false);

  // === Sound volume (#8) ===
  // R1 (TABLEUI-13) — this slider's key is now read by useSoundEffects (it used
  // to read a key nobody wrote); the write notifies the hook at once.
  const [sfxVolume, setSfxVolume] = useState(() => {
    try {
      const v = parseFloat(sessionStorage.getItem(TABLE_SOUND_KEY) ?? '0.8');
      return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
    } catch { return 0.8; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(TABLE_SOUND_KEY, String(sfxVolume)); } catch { /* ignore */ }
    try { window.dispatchEvent(new Event(SOUND_SETTINGS_EVENT)); } catch { /* ignore */ }
  }, [sfxVolume]);

  // === Keyboard shortcuts overlay (#9) ===
  const [showShortcuts, setShowShortcuts] = useState(false);
  useEffect(() => {
    const handler = (e) => {
      if (e.key === '?' && !e.target.matches('input,textarea')) setShowShortcuts(v => !v);
      if (e.key === 'Escape') setShowShortcuts(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // === Show hand after winning without showdown (#6) ===
  const [showHandPrompt, setShowHandPrompt] = useState(false);
  const showHandTimerRef = useRef(null);

  // === Auto Deal state (#11) ===
  // Default ON — the server now auto-starts hands every 12s heartbeat (and
  // 3s after every HandComplete), so the manual "Start Hand" button is
  // vestigial. Auto-deal is kept as a client-side redundancy so even if
  // server scheduling stalls, the client fires startHand() 2s after HandComplete.
  const [autoDeal, setAutoDeal] = useState(() => {
    try {
      const raw = sessionStorage.getItem('app_poker_autoDeal');
      if (raw === null) return true; // default ON for new users
      return raw === 'true';
    } catch (e) { return true; }
  });
  const autoDealTimerRef = useRef(null);

  // === Fast Mode state (#12) ===
  const [fastMode, setFastMode] = useState(false);

  // === Quick Showdown state (#13) ===
  const [quickShowdown, setQuickShowdown] = useState(() => {
    try {
      const raw = sessionStorage.getItem('app_poker_settings');
      if (raw) return JSON.parse(raw).quickShowdown || false;
    } catch { /* ignore */ }
    return false;
  });

  // === Equity display state (#17) ===
  const [equityResults, setEquityResults] = useState(null);
  const equityCalculatedRef = useRef(null);

  // === Advanced toolbar collapsible groups ===
  const [toolbarGroups, setToolbarGroups] = useState({ analysis: false, live: false, coach: false });

  // === Straddle state ===
  // (no extra state needed beyond gameState)

  // === Insurance state ===
  const [showInsurance, setShowInsurance] = useState(false);
  // R1 (contract #1) — the hand whose quote was accepted or declined here (the
  // panel stays closed for that hand only).
  const [insuranceClosedHand, setInsuranceClosedHand] = useState(null);

  // === Mucked Hand Reveal state ===
  const [showMuckButton, setShowMuckButton] = useState(false);
  const muckTimerRef = useRef(null);
  const [muckedHands, setMuckedHands] = useState([]);

  // === Time Bank state ===
  const timeBankRef = useRef(60); // 60 seconds reserve per session
  const [timeBankLeft, setTimeBankLeft] = useState(60);
  const [timeBankActive, setTimeBankActive] = useState(false);

  // === Dealer Voice Lines state ===
  const [dealerVoice, setDealerVoice] = useState(null);
  const [dealerVoiceKey, setDealerVoiceKey] = useState(0);
  const dealerVoiceTimerRef = useRef(null);
  const dealerVoiceFadingRef = useRef(false);
  const prevPhaseForVoiceRef = useRef(null);

  // === All-In Confirmation state ===
  const [showAllInConfirm, setShowAllInConfirm] = useState(false);
  // Stale-modal guard: close automatically if the player stops being active
  // (lost turn, disconnect mid-decision) or after 10 seconds — prevents a
  // frozen overlay from blocking action buttons on the next hand.
  const allInConfirmTimerRef = useRef(null);
  const skipAllInConfirm = (() => {
    try {
      const raw = sessionStorage.getItem('app_poker_settings');
      if (raw) return JSON.parse(raw).skipAllInConfirmation || false;
    } catch { /* ignore */ }
    return false;
  })();

  // === Bet History Strip state (Upgrade 4) ===
  const [streetActions, setStreetActions] = useState([]);
  const prevActionsRef = useRef([]);
  const prevPhaseForStreetRef = useRef(null);

  // === Community Card Hover state (Upgrade 6) ===
  const [hoveredCardIdx, setHoveredCardIdx] = useState(null);

  // === Appearance upgrades ===
  const [potPulsing, setPotPulsing] = useState(false);
  const [potFlashing, setPotFlashing] = useState(false);
  const potFlashTimerRef = useRef(null);
  const prevPotRef = useRef(0);
  const [phaseBanner, setPhaseBanner] = useState(null); // 'THE FLOP' | 'THE TURN' | etc.
  const [cardsDealt, setCardsDealt] = useState(false);
  const prevCardCountRef = useRef(0);

  // === Winner Banner state ===
  const [winnerBanner, setWinnerBanner] = useState(null);
  const [winnerBannerFading, setWinnerBannerFading] = useState(false);
  const winnerBannerTimerRef = useRef(null);
  const winnerBannerShownRef = useRef(null);

  // === Big Win Confetti state ===
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiChips, setConfettiChips] = useState(0);
  const confettiShownRef = useRef(null);

  // === AFK tracking state ===
  const [afkWarning, setAfkWarning] = useState(false); // true when 1-min warning active
  const [afkWarningSecs, setAfkWarningSecs] = useState(60);

  // AFK tracker is wired up after `isSeated`/`sittingOut` are derived (see below).
  // We declare a placeholder here just so existing references compile; the real
  // hook is invoked further down.

  // Countdown within the AFK warning banner
  useEffect(() => {
    if (!afkWarning) return;
    const t = setInterval(() => setAfkWarningSecs(s => {
      if (s <= 1) { clearInterval(t); setAfkWarning(false); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [afkWarning]);

  // === Session stats tracking (for SessionRecap) ===
  const sessionStartChipsRef = useRef(null);
  const sessionStartTimeRef = useRef(Date.now());
  const sessionHandsRef = useRef(0);
  const sessionBiggestPotRef = useRef(0);
  const sessionPrevHandRef = useRef(null);

  // Track previous phase for sound triggers
  const prevPhaseRef = useRef(null);
  const prevIsMyTurnRef = useRef(null);

  // Tracks whether we've already sent an action this turn — prevents timer auto-fold race
  const hasSentActionRef = useRef(false);

  // Derive values from server game state.
  // Defensive schema guard — if an older / regressed server revision drops
  // fields we expect (seats, pots, communityCards, yourCardVisibility), we
  // log ONCE and keep rendering with sane defaults rather than crashing on
  // a `.length` or bracket access below. The ref gates the log so a shape
  // mismatch doesn't spam the console every tick.
  const schemaWarnedRef = useRef(false);
  useEffect(() => {
    if (!gameState || schemaWarnedRef.current) return;
    const missing = [];
    if (!Array.isArray(gameState.seats)) missing.push('seats');
    if (gameState.communityCards !== undefined && !Array.isArray(gameState.communityCards)) missing.push('communityCards');
    if (gameState.pots !== undefined && !Array.isArray(gameState.pots)) missing.push('pots');
    if (missing.length > 0) {
      schemaWarnedRef.current = true;
      // eslint-disable-next-line no-console
      console.warn('[GameHUD] gameState schema mismatch — missing/invalid:', missing, '(falling back to defaults)');
    }
  }, [gameState]);
  const phase = gameState?.phase || 'WaitingForPlayers';
  const pot = gameState?.pot || 0;
  const communityCards = gameState?.communityCards || [];
  const activeSeat = gameState?.activeSeatIndex ?? -1;
  const yourSeat = gameState?.yourSeat ?? mySeat;
  const seats = gameState?.seats || [];
  const myPlayer = yourSeat >= 0 && seats[yourSeat] ? seats[yourSeat] : null;
  // R2 (C7 / C8) — the hero's equipped look from his own seat's `cosmetics`
  // (what everyone else at the table sees): frame / VIP, title, badge, back.
  const heroLook = seatLook(myPlayer?.cosmetics);
  // R2 (C7) — the table theme he equipped (`myTheme`) and whether the felt
  // picker below overrides it (mirrors PokerTable2D's rule).
  const myThemeId = gameState?.myTheme ?? null;
  const equippedFelt = feltForTheme(myThemeId);
  const [feltPickedFor, setFeltPickedFor] = useState(undefined);
  const equippedFeltShown = !!equippedFelt && feltPickedFor !== myThemeId;
  const isSeated = myPlayer != null;
  // R2 (P3 / TABLEUI-15) — this socket PLAYS this table (not watching it).
  const seatedHere = isSeated && !isSpectating && gameState?.isSpectator !== true;
  // 2026-10-10 (S2) — is the table on screen this socket's LIVE tournament
  // seat? Leaving it keeps it in play (absent), so the player is told first
  // (TournamentLeaveDialog); `tournamentLeaveVia` = what he tapped.
  const tournamentSeat = useTournamentSeatStore((s) => s.seat);
  const onTournamentSeat = isTournamentSeatView(gameState, yourSeat, tournamentSeat);
  const [tournamentLeaveVia, setTournamentLeaveVia] = useState(null);

  // 2026-10-23 (owner: "Turn all off") — the table on screen is a QUALIFIER
  // table (start or overflow, seated or watching): no help tool is offered or
  // drawn here (utils/qualifierHelpTools.js). Every one that is open when the
  // player lands on such a table (moved by a rebalance, a tab switch, the
  // qualifier start) is closed. Cash tables are unchanged.
  const helpToolsOff = helpToolsOffAt(gameState);
  // Review fix-up: ANY of his tables (on screen, a multi-table entry, his live
  // tournament seat) is a qualifier table. The Last Hand replay then shows no
  // hand-strength percent (handHistories holds every table's hands, so on an
  // extra cash tab the last hand can be the qualifier's).
  const qualifierTableOpen = useTableStore((s) => helpToolsOffAtAnyTable(s.gameState, s.activeTables, tournamentSeat));
  const helpToolsOffRef = useRef(helpToolsOff);
  useEffect(() => {
    helpToolsOffRef.current = helpToolsOff;
    if (!helpToolsOff) return;
    setShowRangeChart(false);
    setShowEquityCalc(false);
    setShowPostHandCoach(false);
    setGtoVisible(false);
    setShowTimingTells(false);
    setShowCommentary(false);
    setShowCoachingRail(false);
    setShowRangeViz(false);
    setShowPauseCoach(false);
    setShowGTOSolver(false);
    setShowHeatmap(false);
    setOpponentStats(null);
    setToolbarGroups((g) => (g.coach ? { ...g, coach: false } : g));
    // eslint-disable-next-line no-console
    console.info('[GameHUD] help tools off at this qualifier table');
  }, [helpToolsOff]);

  // Persist sit-out preference across a refresh or reconnect. Without this,
  // an intentionally sat-out player gets re-seated on every reload because
  // `sittingOut` lives only in the in-memory store. On mount (first time we
  // see a seat), if the stored flag is TRUE and we aren't already sitting
  // out, replay the toggle. On every change, mirror to sessionStorage.
  // Gameplay audit F156 / F87 (2026-10-21) — the Sit Out state of the seat ON
  // SCREEN: multi-table mode reads that table's own frame (the server stamps
  // `sittingOut` on every seat frame), single-table mode the store flag.
  const sittingOutHere = sittingOutHereOf({ currentTableId, gameState, sittingOut });
  const sittingOutPersistDidRestore = useRef(false);
  useEffect(() => {
    if (sittingOutPersistDidRestore.current || !isSeated) return;
    sittingOutPersistDidRestore.current = true;
    // F87 / F156 — the remembered Sit Out is the MAIN seat's (single-table
    // mode only), replayed as an explicit Sit Out: a bare toggle sat him IN
    // when the restored seat was already sitting out.
    if (currentTableId) return;
    try {
      if (sessionStorage.getItem(SIT_OUT_PREF_KEY) === '1' && !sittingOut) {
        setSitOut && setSitOut(true);
      }
    } catch { /* ignore */ }
  }, [isSeated, sittingOut, setSitOut, currentTableId]);
  useEffect(() => {
    if (currentTableId) return; // (multi-table: per table, nothing to remember for a reload)
    try { sessionStorage.setItem(SIT_OUT_PREF_KEY, sittingOut ? '1' : '0'); }
    catch { /* ignore */ }
  }, [sittingOut, currentTableId]);

  // F156 — away / back: single-table mode no table named (the main seat, as
  // before); multi-table mode one per seated table, each naming its table.
  // Always an object payload (a payload-taking server handler refuses a
  // missing one; an older server ignores it).
  const emitAwayAll = useCallback((event) => {
    const socket = getSocket();
    if (!socket) return;
    const st = useTableStore.getState();
    if (!st.currentTableId) { socket.emit(event, {}); return; }
    const ids = liveTableIds(st.activeTables);
    if (!ids.length) { socket.emit(event, { tableId: st.currentTableId }); return; }
    ids.forEach((id) => socket.emit(event, { tableId: id }));
  }, []);

  // AFK tracker — installed here so `isSeated` and `sittingOut` are in scope.
  const { isAFK } = useAFKTracker({
    active: isSeated && !sittingOutHere,
    onAFK: () => {
      emitAwayAll('playerAFK');
    },
    onBack: () => {
      emitAwayAll('playerBack');
      setAfkWarning(false);
    },
    onWarning: (secsLeft) => {
      setAfkWarning(true);
      setAfkWarningSecs(secsLeft);
    },
  });

  // Track which hand was in progress when the player first joined the table.
  // Default to NOT sitting out — only flip to true if we positively detect that
  // we joined mid-hand AND missed the deal (no hole cards arriving).
  const joinedHandIdRef = useRef(null);
  const sittingOutUntilNextHand = useRef(false);
  const currentHandId = gameState?.handId ?? gameState?.handNumber ?? null;

  // Record the first observed hand id. We only flag mid-hand sit-out if the
  // player joins after the deal AND has no hole cards. Refs are mutated during
  // render here so the very first JSX evaluation sees the correct values.
  if (joinedHandIdRef.current === null && currentHandId != null) {
    joinedHandIdRef.current = currentHandId;
    const joinedMidHand =
      phase !== 'WaitingForPlayers' &&
      phase !== 'HandComplete' &&
      yourSeat >= 0 &&
      (!gameState?.yourCards || gameState.yourCards.length === 0);
    sittingOutUntilNextHand.current = joinedMidHand;
  }

  // When a new hand starts (handId changes), we're no longer sitting out
  useEffect(() => {
    if (currentHandId != null && currentHandId !== joinedHandIdRef.current) {
      sittingOutUntilNextHand.current = false;
    }
  }, [currentHandId]);

  // If the server sent us hole cards we were already dealt into this hand (reconnect).
  // Clear the sit-out flag so the action bar activates — don't penalise reconnects.
  const serverCards = gameState?.yourCards || [];
  useEffect(() => {
    if (serverCards.length > 0 && sittingOutUntilNextHand.current) {
      sittingOutUntilNextHand.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCards.length]);

  // Cards can come from the server (yourCards) or the client dealer animation (seatCards)
  const seatCards = useGameStore((s) => s.seatCards);
  const clientCards = (yourSeat >= 0 && seatCards[yourSeat]) || [];
  const rawCards = serverCards.length > 0 ? serverCards : clientCards;
  // Hide cards if we joined mid-hand
  const yourCards = sittingOutUntilNextHand.current ? [] : rawCards;
  const serverThinksItsMyTurn = activeSeat === yourSeat && yourSeat >= 0;
  const isMyTurn = serverThinksItsMyTurn && yourCards.length > 0;
  // Gameplay audit G169 / F134 (2026-10-21) — draw rounds are played by every
  // seat at once on the server's own draw clock (`drawStartedAt`); the seat in
  // activeSeatIndex is just whoever closed the betting. `isMyDraw` = he still
  // owes a draw on that clock. isMyTurn keeps its meaning (actions, hotkeys).
  // F134 fix-up — an all-in seat owes a draw too (the server waits for it).
  const { canDrawNow, drawClockKnown, isMyDraw } = drawTurnInfo(gameState, {
    yourSeat, yourCardsLen: yourCards.length, myPlayer,
  });
  // Gameplay audit F130 / F131 — one key per server decision point, so two
  // decisions in a row (the big blind checks his option, then is first on the
  // flop) each get a fresh per-turn lock + raise size.
  const decisionKey = turnDecisionKey({
    isMyTurn,
    tableId: gameState?.tableId,
    handNumber: gameState?.handNumber ?? gameState?.handId,
    phase,
  });
  // PWA audit #9: hold Screen Wake Lock while deciding so the phone
  // doesn't sleep and drop the socket / auto-fold. Released when turn
  // ends or component unmounts. Hook is a no-op on unsupported browsers.
  useWakeLock(isMyTurn || isMyDraw);

  // Keep refs in sync immediately after derivation (no render lag)
  isMyTurnRef.current = isMyTurn;
  optionsOpenRef.current = showOptions;

  // Auto-fold when the server is waiting on us but we're sitting out (joined mid-hand).
  //
  // 2026-04-22 audit fixes:
  //   - Block fold during Showdown/HandComplete (belt + suspenders over the
  //     existing HandComplete check; Showdown slipped through previously).
  //   - Delay the emit by 1s. On reconnect the client can see
  //     serverThinksItsMyTurn flip true BEFORE hole cards / phase land in a
  //     later delta, and we were folding a perfectly playable hand. A short
  //     delay + cleanup gives the delta stream time to settle; if the turn
  //     moves or the phase changes to Showdown/HandComplete first, the
  //     cleanup cancels the pending fold.
  useEffect(() => {
    if (!serverThinksItsMyTurn) return;
    if (!sittingOutUntilNextHand.current) return;
    if (!phase || phase === 'WaitingForPlayers' || phase === 'HandComplete' || phase === 'Showdown') return;
    const t = setTimeout(() => {
      // Re-check at fire time: hole cards may have landed in a later delta,
      // which clears sittingOutUntilNextHand (the effect ~40 lines below), i.e.
      // we WERE dealt in — never fold a live hand. serverCards.length is in the
      // deps too, so arriving cards also re-run this effect and its cleanup
      // cancels this pending timer before it can fire.
      if (!sittingOutUntilNextHand.current) return;
      sendAction('fold');
    }, 1000);
    return () => clearTimeout(t);
  }, [serverThinksItsMyTurn, phase, sendAction, serverCards.length]);
  // 2026-05-26 — fall back to `chips` field. The seat object's
  // canonical field is `chipCount`, but some broadcast paths (notably
  // the post-handComplete settle pass + the levelUp/awardChips payloads)
  // surface the at-table stack as `chips`. Reading only `chipCount`
  // here caused the upper-right HUD balance to flash "Josh Hall 0"
  // between hands while the player's actual stack was intact. Line 3331
  // (the nameplate me below) already had the dual fallback —
  // synchronizing this one closes the discrepancy.
  const myChips = myPlayer?.chipCount ?? myPlayer?.chips ?? 0;
  const currentBetToMatch = Math.max(0, gameState?.currentBetToMatch || 0);
  const myCurrentBet = myPlayer?.currentBet || 0;
  const callAmount = Math.max(0, currentBetToMatch - myCurrentBet);
  callAmountRef.current = callAmount;
  // minRaise from server = getMinRaise() = currentBetToMatch + lastRaiseAmount (already the total to raise to)
  // Audit fix #18: use ?? so server-sent minRaise === 0 is respected as a legal
  // value (e.g. no previous bet this street) instead of silently falling back
  // to currentBetToMatch + BB, which would over-require a raise.
  // Sit & Go fix-all F18 — the level the HAND is played at (a tournament
  // level-up mid-hand applies from the next hand): the Blinds line, the
  // big-blind stack counts and the 3x BB / sizing buttons use it; the table's
  // current level shows as 'Next' (utils/tournamentClock, pure, probed).
  const handLevel = handLevelOf(gameState);
  const minRaiseTotal = gameState?.minRaise ?? (currentBetToMatch + (handLevel.bb || 20));
  // #11 (2026-07-01 audit): the raise arg is a "raise TO" total, and the server
  // only converts to all-in when (total − myCurrentBet) >= chipCount. myChips
  // (chipCount) already excludes chips committed this street, so a max of
  // myChips could never reach a true all-in when myCurrentBet > 0 (it left
  // myCurrentBet behind). The real max raise-to total is chipCount + currentBet.
  // Gameplay audit F12 / F41 / F107 (2026-10-21) — and never more than the
  // server's `maxRaise` (pot limit / fixed limit), no raise controls when the
  // server says the betting is not open to him (`canRaise === false`) or at an
  // All-In-or-Fold table. Keys absent (older server): stack max, as before.
  // F12 fix-up — `canRaise` decides only on HIS turn (the server sends false
  // for a folded seat / Showdown too): off-turn the bar keeps its shape.
  const limits = raiseLimits({ myChips, myCurrentBet, minRaiseTotal, callAmount, gameState, isMyTurn });
  const maxRaise = limits.maxRaise;
  const raiseControlsOk = limits.raiseControlsOk;
  const isAof = limits.isAof;
  // F107 fix-up — All-In-or-Fold with nothing to call, on a server that takes
  // a check there: Check (button, pre-actions, key, tap / swipe right).
  const aofFreeCheck = limits.aofFreeCheck;
  const allInMode = allInButtonMode(limits);
  // The pre-actions this table takes (F107), as a string for effect deps.
  const preActionKeys = preActionKeysFor(gameState);
  const preActionKeysSig = preActionKeys.join(',');
  canRaiseRef.current = raiseControlsOk;
  aofRef.current = isAof;
  aofFreeCheckRef.current = aofFreeCheck;
  drawRoundRef.current = !!(gameState?.hasDrawPhase && gameState?.isDrawPhase);
  // F126 — the Call button's real amount / pot odds (a call above his stack
  // commits only the stack; the excess he cannot win).
  const callShown = callView({ callAmount, myChips, myCurrentBet, pot, seats, yourSeat });
  // F133 — an opening bet reads "Bet", not "Raise".
  const raiseVerb = betVerb(currentBetToMatch);

  // Variant info
  const variantName = gameState?.variantName || "Texas Hold'em";
  const holeCardCount = gameState?.holeCardCount || 2;
  const hasDrawPhase = gameState?.hasDrawPhase || false;
  const isStudGame = gameState?.isStudGame || false;
  const isDrawPhase = gameState?.isDrawPhase || false;
  const drawPhase = gameState?.drawPhase || null;
  // Pineapple / Crazy Pineapple: server signals when the discard window is active.
  const isPineapple = gameState?.isPineapple || false;
  const pineappleDiscardActive = gameState?.pineappleDiscardActive || false;
  const [pineappleDiscardIndex, setPineappleDiscardIndex] = useState(null);
  // Reset selection whenever the discard window closes or a new hand starts.
  // Previously the index only cleared on `pineappleDiscardActive` going false,
  // which meant a server crash or race mid-discard could strand the old index
  // into the next hand (cosmetic desync in the card selection UI).
  useEffect(() => {
    if (!pineappleDiscardActive) setPineappleDiscardIndex(null);
  }, [pineappleDiscardActive]);
  useEffect(() => {
    if (phase === 'PreFlop' || phase === 'WaitingForPlayers') {
      setPineappleDiscardIndex(null);
    }
  }, [phase]);
  // Gameplay audit F34 (2026-10-21) — the server refused the pick (it came
  // after the discard was made): unmark it and say so. An older server's
  // refusals carry no tableId; a newer one names the table (only the table on
  // screen counts).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onAck = (d) => {
      const gs = useTableStore.getState().gameState;
      if (!pineappleAckRefused(d, gs?.tableId != null ? String(gs.tableId) : null)) return;
      setPineappleDiscardIndex(null);
      try { addToast('Too late to choose — the server discarded for you.', 'info', 3500); } catch { /* ignore */ }
    };
    socket.on('pineappleDiscardAck', onAck);
    return () => socket.off('pineappleDiscardAck', onAck);
  // (addToast is declared further down and stable)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bomb Pot info
  // Bomb-pot banner gating. Two independent suppression states:
  //   1. `bombPotAutoSuppressed` — 45s per-hand timer safety net.
  //      Resets between hands so a LEGITIMATE bomb pot can show on
  //      the next hand if one is actually triggered.
  //   2. `bombPotUserDismissed` — explicit user dismiss from Options.
  //      PERMANENT for the session until the user themselves triggers
  //      a new bomb pot (via the 💣 Bomb Pot button, which clears it
  //      so the fresh one can show). Never auto-resets, so a stale
  //      server flag can never bring the banner back after dismissal.
  const rawBombPotFlag = gameState?.bombPot || false;
  const handNumber = gameState?.handNumber;
  const [bombPotAutoSuppressed, setBombPotAutoSuppressed] = useState(false);
  const [bombPotUserDismissed, setBombPotUserDismissed] = useState(false);
  const lastBombPotHandRef = useRef(null);
  useEffect(() => {
    // Auto-suppression resets each new hand (so legitimate bomb pots
    // can still fire on a fresh hand). User-dismiss is NOT touched.
    if (handNumber != null && handNumber !== lastBombPotHandRef.current) {
      lastBombPotHandRef.current = handNumber;
      setBombPotAutoSuppressed(false);
    }
  }, [handNumber]);
  useEffect(() => {
    if (!rawBombPotFlag) return;
    const t = setTimeout(() => setBombPotAutoSuppressed(true), 45_000);
    return () => clearTimeout(t);
  }, [rawBombPotFlag, handNumber]);
  const isBombPot = rawBombPotFlag && !bombPotAutoSuppressed && !bombPotUserDismissed;
  // Alias kept for the Options "Dismiss" button below.
  const setBombPotSuppressed = setBombPotUserDismissed;

  // Dealer's Choice info
  const isDealersChoice = gameState?.dealersChoice || false;
  // Gameplay audit F15 (2026-10-21) — the Dealer's Choice label / Next line
  // only when the label names the game actually dealt (the server never
  // rebuilt the table: "Omaha" over a Hold'em deal); else the real game name.
  const dcTruthful = isDealersChoice && dealersChoiceTruthful(gameState);
  const dealersChoiceVariant = gameState?.dealersChoiceVariant || null;
  const dealersChoiceNext = gameState?.dealersChoiceNext || null;

  // Ante info
  const anteAmount = handLevel.ante || 0;

  // Hand strength evaluation — memoized so it only reruns when cards change.
  // Variant-aware: Omaha games must use EXACTLY 2 hole cards + 3 community
  // (otherwise a 1-hole-card flush/straight gets scored as made when it isn't).
  // We pass the variant through so `evaluateHandStrength` can enforce the rule;
  // if the util doesn't recognize the variant, it falls back to Hold'em rules.
  const gameVariant = gameState?.variant || gameState?.variantName || 'texas-holdem';
  // Audit fix #13: hide hand-strength overlay if we've folded — otherwise a
  // screen-watcher could infer our hole cards from the equity/strength bar
  // after we muck. yourCards is still populated briefly so the overlay keeps
  // rendering otherwise.
  const showHandStrength = yourCards.length > 0
    && communityCards.length >= 3
    && !myPlayer?.folded;
  const handStrength = useMemo(
    () => showHandStrength ? evaluateHandStrength(yourCards, communityCards, { variant: gameVariant }) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showHandStrength, gameVariant, yourCards.map(c => `${c.rank}-${c.suit}`).join(','), communityCards.map(c => `${c.rank}-${c.suit}`).join(',')]
  );

  // Outs calculation — memoized, only runs on Flop/Turn
  const showOuts = yourCards.length > 0 && (phase === 'Flop' || phase === 'Turn');
  const outsInfo = useMemo(
    () => showOuts ? calculateOuts(yourCards, communityCards) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showOuts, yourCards.map(c => `${c.rank}-${c.suit}`).join(','), communityCards.map(c => `${c.rank}-${c.suit}`).join(',')]
  );

  // Board texture analysis — memoized after flop
  const boardTexture = useMemo(
    () => communityCards.length >= 3 ? analyzeBoardTexture(communityCards) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [communityCards.map(c => `${c.rank}-${c.suit}`).join(',')]
  );

  // Winning card indices for glow effect during showdown/hand complete
  const isShowdownPhase = phase === 'Showdown' || phase === 'HandComplete';
  const winningCardIndices = isShowdownPhase && handStrength && handStrength.bestFive.length > 0
    ? getWinningCardIndices(yourCards, communityCards, handStrength.bestFive)
    : null;

  // Pot odds calculation — gameplay audit F126: on the EFFECTIVE call and pot
  // (callView). Audit fix #4 (no trailing ".0") lives in callView.
  const potOdds = callShown.potOdds;
  const potOddsDisplay = callAmount > 0 ? callShown.potOddsDisplay : null;
  // Determine if pot odds are "good" relative to hand strength
  // Good odds = pot odds ratio is favorable compared to hand strength
  const potOddsGood = handStrength ? potOdds > (1 / Math.max(handStrength.strength, 0.05)) : potOdds > 3;

  // Last aggressor from street action history
  const lastAggressorInfo = (() => {
    for (let i = streetActions.length - 1; i >= 0; i--) {
      const a = streetActions[i];
      if (a.action === 'raise' || a.action === 'bet') return a;
    }
    return null;
  })();

  // Stack-to-Pot Ratio (Upgrade 2) — helper keeps top-bar badge and action-bar
  // SPR display in lockstep; the two places used to inline their own copy of
  // this threshold ladder.
  // R3 (K1-7) — no red: the Short tier is blue (amber is already Mid).
  const getSPRColor = (s) => s === null ? '#6b7280' : Number(s) >= 8 ? '#4ADE80' : Number(s) >= 3 ? '#F59E0B' : '#60A5FA';
  const getSPRLabel = (s) => s === null ? '' : Number(s) >= 8 ? 'Deep' : Number(s) >= 3 ? 'Mid' : 'Short';
  const spr = pot > 0 ? (myChips / pot).toFixed(1) : null;
  const sprColor = getSPRColor(spr);
  const sprLabel = getSPRLabel(spr);

  // Pre-flop hand tier (for card glow) (Upgrade 3). Gameplay audit G173: a
  // Hold'em ladder, so only for a two-card hand before the board — Stud /
  // Razz / Draw / Badugi / Omaha were rated from their first two cards all
  // hand (K-K "Premium" in Razz).
  const preflopTier = preflopTierOf(yourCards, communityCards, { isStudGame, hasDrawPhase });

  // Straddle — R2 (C11 / TABLEUI-19): the SERVER says when this seat may
  // straddle right now (`isFirstActor`: preflop, first to act, nothing
  // voluntary yet, a cash table, the stack covers it — always present, false
  // for spectators). The button was gated on that key while no server sent
  // it, so it never showed. An older server (no key) shows nothing.
  const bigBlind = handLevel.bb || 50;
  const straddleAmount = 2 * bigBlind;
  // R2 review (K1-4) — straddle / bomb pot are sent WITHOUT a tableId (the
  // server applies them to the MAIN seat), so they are offered only while the
  // main seat's table is the one on screen — never at an extra (multi-table)
  // seat, whose flags would have acted at the main table.
  const shownIsExtraSeat = useTableStore((st) => {
    const tid = st.gameState?.tableId;
    if (tid == null || st.currentTableId == null) return false;
    const e = st.activeTables && typeof st.activeTables.get === 'function' ? st.activeTables.get(String(tid)) : null;
    return !!(e && e.extra);
  });
  const isUTG = gameState?.isFirstActor === true && seatedHere && !shownIsExtraSeat;
  // Bomb Pot — R2 (C11 / GAME-12): offered only where the server runs one
  // (`canBombPot`: Hold'em / Omaha cash tables); elsewhere it dealt Stud /
  // Draw / Short Deck hands wrong. An older server (no key): not offered.
  const canBombPot = gameState?.canBombPot === true && seatedHere && !shownIsExtraSeat;

  // Insurance — R1 (TABLEUI-1 / ECON-1, CONTRACTS R1 #1). The panel is driven
  // ONLY by the server's quote for this seat and this hand
  // (`gameState.insuranceQuote` = { handNumber, cashout, equityPct, pot }, null
  // otherwise). The old client-side pricing (hand-strength heuristic x a guessed
  // opponent discount) offered numbers the server never paid — wrong equity,
  // multiway and tournament spots, before a call — and is gone. Accept sends
  // only { tableId, handNumber }; the server re-checks and settles at exactly
  // its quoted cashout, and its `insuranceAccepted` numbers are what the toast
  // shows.
  const insuranceQuote = readInsuranceQuote(gameState);
  // R2 (Addendum) — the server's decision window (`expiresAt`, server clock):
  // a live countdown, and the panel closes when it runs out (the server
  // releases the runout then; Accept after that is refused anyway).
  const [insuranceNow, setInsuranceNow] = useState(() => serverNow());
  // the window's full length as first seen (the bar's 100%)
  const [insuranceWindowMs, setInsuranceWindowMs] = useState(7000);
  const insuranceExpiresAt = insuranceQuote ? insuranceQuote.expiresAt : null;
  useEffect(() => {
    if (!insuranceExpiresAt) return undefined;
    const now = serverNow();
    setInsuranceNow(now);
    setInsuranceWindowMs(Math.max(1000, insuranceExpiresAt - now));
    const id = setInterval(() => setInsuranceNow(serverNow()), 250);
    return () => clearInterval(id);
  }, [insuranceExpiresAt]);
  const insuranceSecsLeft = insuranceExpiresAt ? Math.max(0, Math.ceil((insuranceExpiresAt - insuranceNow) / 1000)) : null;
  const showInsurancePanel = !!insuranceQuote && !isSpectating
    && insuranceClosedHand !== insuranceQuote.handNumber
    && (insuranceSecsLeft === null || insuranceSecsLeft > 0);

  // Session stats tracking: initialize start chips, count hands, track biggest pot
  useEffect(() => {
    if (myChips > 0 && sessionStartChipsRef.current === null) {
      sessionStartChipsRef.current = myChips;
    }
  }, [myChips]);
  // Gameplay audit G171 (2026-10-21) — a hand counts when the hand number goes
  // up at the same table (Stud never shows 'PreFlop': it counted 0 hands);
  // a table switch or a reconnect's first frame is not a hand.
  const sessionHandTableId = gameState?.tableId ?? null;
  const sessionHandNumber = gameState?.handNumber ?? null;
  useEffect(() => {
    if (sessionHandTableId == null || sessionHandNumber == null) return;
    const next = { tableId: sessionHandTableId, handNumber: sessionHandNumber };
    if (isNextHandAtSameTable(sessionPrevHandRef.current, next)) sessionHandsRef.current += 1;
    sessionPrevHandRef.current = next;
  }, [sessionHandTableId, sessionHandNumber]);
  useEffect(() => {
    if (pot > sessionBiggestPotRef.current) {
      sessionBiggestPotRef.current = pot;
    }
  }, [pot]);

  // Draw handler
  const handleDraw = useCallback(() => {
    sendDraw(selectedDiscards);
  }, [sendDraw, selectedDiscards]);

  // Audit fix #1 + #11: compute the slider step size ONCE and snap all
  // setRaiseAmount callsites to that step so the Raise-button label and
  // the slider thumb always agree. Root cause of the "Raise113 vs slider 125"
  // bug: potFraction() returned a value that wasn't step-aligned; the
  // browser snapped the slider thumb visually to the nearest step (125),
  // but the React state (113) was sent on click. Now all writes snap first.
  const raiseStepSize = React.useMemo(() => {
    if (maxRaise <= 0 || minRaiseTotal > maxRaise) return 1;
    const usable = Math.max(1, maxRaise - minRaiseTotal);
    // Granularity target: ~20 positions across the usable range, but never
    // smaller than BB/2 so the slider doesn't feel twitchy on deep stacks.
    const bbHalf = Math.max(1, Math.floor((handLevel.bb || 20) / 2));
    const coarse = Math.max(bbHalf, Math.floor(minRaiseTotal / 10));
    return Math.max(1, Math.min(coarse, usable));
  }, [minRaiseTotal, maxRaise, handLevel.bb]);

  const snapRaiseToStep = React.useCallback((val) => {
    if (!Number.isFinite(val)) return minRaiseTotal;
    if (val <= minRaiseTotal) return minRaiseTotal;
    if (val >= maxRaise) return maxRaise;
    const offset = val - minRaiseTotal;
    const snapped = Math.round(offset / raiseStepSize) * raiseStepSize + minRaiseTotal;
    return Math.max(minRaiseTotal, Math.min(snapped, maxRaise));
  }, [minRaiseTotal, maxRaise, raiseStepSize]);

  // setRaiseAmountSafe always snaps; use this instead of setRaiseAmount
  // from preset/favorite/keyboard paths.
  const setRaiseAmountSafe = React.useCallback((val) => {
    setRaiseAmount(snapRaiseToStep(val));
  }, [snapRaiseToStep]);

  // Initialize raise amount when turn starts — single effect, reads all memory sources.
  // Gameplay audit F130 / F131 (2026-10-21): keyed on the server DECISION
  // point (decisionKey), not on the isMyTurn edge — a second decision in a row
  // (big blind's option, then first on the flop) re-initialises instead of
  // keeping the last street's size (which could exceed the new stack). It
  // also owns the hand / table reset to 0 (it used to sit in a LATER effect,
  // which ran after this one in the same commit when the hand's first frame
  // put him on the clock — the size ended at 0 and the touch overlay sent
  // 'raise 0').
  const prevRaiseDecisionKeyRef = useRef(null);
  const prevRaiseHandKeyRef = useRef(null);
  const raiseHandNo = gameState?.handNumber ?? gameState?.handId ?? null;
  const raiseHandKey = raiseHandNo == null ? null
    : `${gameState?.tableId != null ? String(gameState.tableId) : ''}|${raiseHandNo}`;
  useEffect(() => {
    const handChanged = raiseHandKey != null && prevRaiseHandKeyRef.current != null
      && prevRaiseHandKeyRef.current !== raiseHandKey;
    if (raiseHandKey != null) prevRaiseHandKeyRef.current = raiseHandKey;
    if (!decisionKey) {
      prevRaiseDecisionKeyRef.current = null;
      // Audit fix #3: a new hand (or another table on screen) starts from no
      // remembered size ("Raise 678" from the previous hand).
      if (handChanged) setRaiseAmount(0);
      return;
    }
    if (decisionKey === prevRaiseDecisionKeyRef.current) return;
    prevRaiseDecisionKeyRef.current = decisionKey;
    // #1 — if there's no legal raise (all-in already, ≤0 effective stack, or
    // the server says the betting is not open to him), don't bother computing
    // a raise amount; UI will hide the raise slider.
    if (!raiseControlsOk) {
      setRaiseAmount(0);
      setShowRaiseSlider && setShowRaiseSlider(false);
      return;
    }
    // Try bet sizing memory in order: in-memory ref → sessionStorage → pot fraction → minRaise
    let amount = null;
    if (betMemoryRef.current != null && pot > 0) {
      const pct = betMemoryRef.current / pot;
      amount = Math.round(pot * pct);
    } else {
      try {
        const pct = parseFloat(sessionStorage.getItem('poker_last_raise_pct'));
        if (!isNaN(pct) && pot > 0) amount = Math.round(pot * pct);
      } catch { /* ignore */ }
    }
    if (amount != null && amount >= minRaiseTotal && amount <= maxRaise) {
      // (snapped like every other write, so the label and the thumb agree)
      setRaiseAmount(snapRaiseToStep(amount));
    } else {
      // Clamp properly: the previous `Math.max(minRaiseTotal, Math.min(minRaiseTotal, maxRaise))`
      // was a no-op that could exceed `maxRaise`. Use the real clamp so the
      // slider's initial value is always legal.
      setRaiseAmount(Math.min(Math.max(minRaiseTotal, 0), Math.max(maxRaise, 0)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionKey, raiseHandKey, raiseControlsOk, minRaiseTotal, maxRaise, pot]);

  // Clear "checkOnly" pre-action when someone bets (check is no longer available)
  useEffect(() => {
    if (preAction === 'checkOnly' && callAmount > 0) {
      setPreAction(null);
    }
  }, [callAmount, preAction]);

  // Upgrade 1: fire pre-action when it becomes our turn.
  // Sets `hasSentActionRef` so a manual tap in the same tick gets dedup'd
  // instead of causing a double-fire. Observed 2026-04-22: a user with
  // Check/Fold pre-armed who then tapped Call saw their hand folded even
  // though Call was tapped — pre-action fired first, user's tap landed on
  // a disabled-button state but client already queued a send. Fix here
  // also closes the race by bailing if an action was already sent this
  // turn (e.g., the user manually acted milliseconds before the effect
  // ran).
  const prevIsMyTurnForPreActionRef = useRef(false);
  // R2 review (K1-1) — a pre-action belongs to the table + hand it was armed
  // at. Multi-table: switching to table B on the render its turn opens used to
  // fire an armed Fold / Check-Fold / Call Any from table A AT TABLE B (this
  // effect runs before the table-change reset below). Stamped when armed
  // (declared first, so it runs before the firing effect in the same commit).
  const preActionCtxRef = useRef(null);
  const preActionTableId = gameState?.tableId != null ? String(gameState.tableId) : null;
  const preActionHand = gameState?.handNumber ?? gameState?.handId ?? null;
  useEffect(() => {
    if (!preAction) { preActionCtxRef.current = null; return; }
    if (!preActionCtxRef.current) preActionCtxRef.current = { tableId: preActionTableId, hand: preActionHand };
  }, [preAction]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnForPreActionRef.current && preAction) {
      const ctx = preActionCtxRef.current;
      if (ctx && (ctx.tableId !== preActionTableId || ctx.hand !== preActionHand)) {
        // Armed at another table (or hand): never act here — drop it.
        preActionCtxRef.current = null;
        setPreAction(null);
        prevIsMyTurnForPreActionRef.current = isMyTurn;
        return;
      }
      if (hasSentActionRef.current) {
        // User already manually acted (or an action is mid-flight).
        // Clear the pre-action silently; don't double-send.
        setPreAction(null);
      } else if (isAof && !preActionKeysSig.split(',').includes(preAction)) {
        // Gameplay audit F107 — All-In-or-Fold: the server refuses a call, so
        // only the pre-actions this table offers may fire (Fold; Check/Fold
        // and Check too where its server takes a free check). One armed
        // before the table kind was known is dropped, never turned into an
        // all-in.
        setPreAction(null);
      } else {
        const action = preAction;
        setPreAction(null);
        hasSentActionRef.current = true;
        // Tell the player WHAT their queued pre-action just did, the instant it
        // fires — otherwise an armed Fold/Check-Fold folds them the moment their
        // turn opens and reads as "it folded me when I was going to bet".
        const preToast = (msg, type) => { try { addToast(msg, type, 2600); } catch { /* addToast defined later in render; safe when this effect actually runs */ } };
        if (action === 'fold') {
          // Sit & Go fix-all C4 (owner 2026-10-23) — a queued Fold acts as
          // Check/Fold: when checking is free it CHECKS (folding a free hand
          // only gives chips away — audit hand 11), facing a bet it folds.
          if (queuedFoldAction(callAmount, { isAof, aofFreeCheck }) === 'check') {
            playSound('check'); sendAction('check');
            preToast(`⚡ ${QUEUED_FOLD_CHECKED_TEXT}`, 'info');
          } else {
            playSound('fold'); sendAction('fold');
            preToast('⚡ Queued action fired: Folded', 'warn');
          }
        } else if (action === 'checkFold') {
          if (callAmount === 0) {
            playSound('check'); sendAction('check');
            preToast('⚡ Queued action fired: Checked', 'info');
          } else {
            playSound('fold'); sendAction('fold');
            preToast('⚡ Queued action fired: Folded (faced a bet)', 'warn');
          }
        } else if (action === 'callAny') {
          // Gameplay audit F132 — nothing to call is a CHECK ('call' with
          // nothing owed is refused and the table waited on him).
          if (queuedCallAnyAction(callAmount) === 'check') {
            playSound('check'); sendAction('check');
            preToast('⚡ Queued action fired: Checked', 'info');
          } else {
            playSound('bet'); sendAction('call');
            preToast('⚡ Queued action fired: Called', 'info');
          }
        } else if (action === 'checkOnly') {
          if (callAmount === 0) {
            playSound('check'); sendAction('check');
          } else {
            // Not free — clear the flag so a manual action can fire.
            hasSentActionRef.current = false;
          }
        }
      }
    }
    prevIsMyTurnForPreActionRef.current = isMyTurn;
  }, [isMyTurn, preAction, callAmount, sendAction, playSound, preActionTableId, preActionHand, isAof, aofFreeCheck, preActionKeysSig]);

  // Close raise slider and all-in confirm when turn ends
  useEffect(() => {
    if (!isMyTurn) {
      setShowRaiseSlider(false);
      setShowAllInConfirm(false);
      clearTimeout(foldTimerRef.current);
      // R1 — the REF too: an armed first Fold tap (or swipe) whose turn ended
      // stayed armed, so the next turn's first tap folded with no confirm.
      foldPendingRef.current = false;
      setFoldPending(false);
    }
  }, [isMyTurn]);

  // Audit fix #3: reset raise amount whenever the hand number advances so
  // "Raise 678" stale from the previous hand doesn't bleed into the next one's
  // action bar before the player has interacted. Runs for every hand boundary,
  // including the first hand dealt after joining.
  const prevHandNumberRef = useRef(null);
  // R2 (TABLEUI-14/18) — and whenever ANOTHER table takes the screen (multi
  // table): two tables can be on the same hand number, and a Fold armed at
  // table A ("Fold?") used to fold at table B with a single tap.
  const prevHandTableRef = useRef(null);
  useEffect(() => {
    const hn = gameState?.handNumber ?? gameState?.handId ?? null;
    if (hn == null) return;
    const tid = gameState?.tableId != null ? String(gameState.tableId) : null;
    const tableChanged = prevHandTableRef.current != null && tid != null && prevHandTableRef.current !== tid;
    if (tid != null) prevHandTableRef.current = tid;
    if ((prevHandNumberRef.current != null && prevHandNumberRef.current !== hn) || tableChanged) {
      // (the raise size's own reset lives in the raise-init effect above —
      // gameplay audit F131: here it overwrote the new turn's size with 0)
      lastRaiseRef.current = null;
      setPreAction(null);
      clearTimeout(foldTimerRef.current);
      foldPendingRef.current = false;
      setFoldPending(false);
      setShowAllInConfirm(false);
      hasSentActionRef.current = false;
      autoFoldedRef.current = false;
      // Gameplay audit G171 (2026-10-21) — every per-hand UI reset happens on
      // THIS edge (a new hand, or another table on screen). Stud never shows
      // 'PreFlop', so the resets keyed on it never ran there: a dead 'Show
      // Rabbit' after every hand, the last winner banner over the whole next
      // hand, a stale Show / Muck prompt. (The PreFlop resets below stay.)
      setPlayerFoldedThisHand(false);
      clearRabbitCards();
      setShowRabbitPanel(false);
      setRabbitHuntCooldownUntil(0);
      if (winnerBannerTimerRef.current) { clearTimeout(winnerBannerTimerRef.current); winnerBannerTimerRef.current = null; }
      setWinnerBanner(null);
      setWinnerBannerFading(false);
      equityCalculatedRef.current = null;
      setShowMuckButton(false);
      setMuckedHands([]);
      setShowHandPrompt(false);
      setPineappleDiscardIndex(null);
      pendingShowRef.current = null;
    }
    prevHandNumberRef.current = hn;
  }, [gameState?.handNumber, gameState?.handId, gameState?.tableId, clearRabbitCards]);

  // Mobile audit M2: iOS software-keyboard handling. When the chat / chip /
  // rabbit-hunt input focuses on iOS Safari, the keyboard (~290-380px tall)
  // slides up from the bottom and covers the `.hud-bottom` action row —
  // making the Fold/Call/Raise/All-In buttons unreachable. We listen to
  // `window.visualViewport` for keyboard-triggered resizes and set a CSS
  // custom property `--kb-offset` that `.hud-bottom` reads to shift up.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      // Keyboard offset = how much the visual viewport bottom has been pushed
      // up from the layout viewport. 0 when no keyboard.
      const offset = Math.max(0, (window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--kb-offset', `${offset}px`);
      // Toggle a class so CSS can also use it for sizing / opacity / etc.
      if (offset > 60) root.classList.add('kb-open');
      else root.classList.remove('kb-open');
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--kb-offset');
      root.classList.remove('kb-open');
    };
  }, []);

  // Reset all local UI state when leaving table (gameState becomes null)
  useEffect(() => {
    if (gameState === null) {
      setShowConfetti(false);
      setWinnerBanner(null);
      setWinnerBannerFading(false);
      setPreAction(null);
      setAutoAction(null);
      setShowShowdown(false);
      clearTimeout(foldTimerRef.current);
      foldPendingRef.current = false;
      setFoldPending(false);
      setRaiseAmount(0);
      setShowRaiseSlider(false);
      setShowAllInConfirm(false);
      setShowLastHand(false);
      setPhaseBanner(null);
      setCardsDealt(false);
      hasSentActionRef.current = false;
      autoFoldedRef.current = false;
    }
  }, [gameState]);

  // (Upgrade 7 merged into the raise initialization effect above)

  // Upgrade 6: action history strip — watch seat lastAction changes
  useEffect(() => {
    if (!gameState?.seats) return;
    const currentSeats = gameState.seats;
    const prev = prevSeatsRef.current;
    // Sit & Go fix-all F2 — the snapshot carries its street: a batched delta
    // never compares a new street's bets against the last street's.
    const samePhase = prevSeatsPhaseRef.current === phase;
    if (prev) {
      const newEntries = [];
      // The street is still open (no seat had a bet in the snapshot of THIS
      // street): a bet now is the street's first bet — 'Name bet 40'.
      const streetOpen = !samePhase || prev.every((p) => !p || !(Number(p.currentBet) > 0));
      currentSeats.forEach((seat, i) => {
        if (!seat || seat.state !== 'occupied') return;
        const prevSeat = prev[i];
        const action = seat.lastAction;
        if (!action || action === 'None') return;
        if (prevSeat && prevSeat.lastAction === action && prevSeat.currentBet === seat.currentBet) return;
        if (typeof action !== 'string') return;
        const name = safeName(seat.playerName, '') || `P${i + 1}`;
        // Raises read "raised to X (+Y)" (never the ambiguous "raised 250");
        // the rules live in utils/actionBar.js (pure, probed).
        const entry = stripActionEntry({
          name,
          action,
          prevBet: samePhase ? (prevSeat?.currentBet || 0) : 0,
          curBet: seat.currentBet || 0,
          streetOpen,
        });
        if (entry) newEntries.push(entry);
      });
      if (newEntries.length > 0) {
        setActionHistory(prev2 => [...newEntries, ...prev2].slice(0, 3));
      }
    }
    prevSeatsRef.current = currentSeats.map(s => s ? { lastAction: s.lastAction, currentBet: s.currentBet, state: s.state } : null);
    prevSeatsPhaseRef.current = phase;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastActionsFingerprint]);

  // Clear action history on EVERY phase transition — previously only cleared
  // on new-hand boundaries, so late-street history could include stale Pre-Flop
  // lines pushed off-screen but still retained until the last 3 recycled.
  const prevPhaseForHistoryRef = useRef(phase);
  useEffect(() => {
    if (prevPhaseForHistoryRef.current !== phase) {
      prevPhaseForHistoryRef.current = phase;
      setActionHistory([]);
      // Sit & Go fix-all F2 — a snapshot already taken of THIS street (the
      // seats reset for it: no bets, no actions) is kept, so the street's first
      // action — its opening bet — reaches the strip; any other is dropped.
      if (prevSeatsPhaseRef.current !== phase) prevSeatsRef.current = null;
    }
  }, [phase]);

  // Close options dropdown when clicking/tapping outside
  useEffect(() => {
    if (!showOptions) return;
    const handler = (e) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target)) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [showOptions]);

  // Track unread chat messages when panel is closed
  useEffect(() => {
    if (!chatOpen && chatMessages.length > prevChatLenRef.current) {
      setChatUnread(u => u + (chatMessages.length - prevChatLenRef.current));
    }
    prevChatLenRef.current = chatMessages.length;
  }, [chatMessages, chatOpen]);

  // Sound effects for phase changes and turn
  useEffect(() => {
    // Play 'deal' when phase changes to PreFlop
    if (phase === 'PreFlop' && prevPhaseRef.current !== 'PreFlop') {
      playSound('shuffle');
      setTimeout(() => playSound('deal'), 300);
    }
    // Play community card reveal sound for Flop/Turn/River
    if (
      (phase === 'Flop' || phase === 'Turn' || phase === 'River') &&
      prevPhaseRef.current !== phase
    ) {
      playSound('community');
    }
    // Play 'win' when phase changes to HandComplete
    if (phase === 'HandComplete' && prevPhaseRef.current !== 'HandComplete') {
      playSound('win');
    }
    prevPhaseRef.current = phase;
  }, [phase, playSound]);

  // Gameplay audit G169 / F130 (2026-10-21) — every decision he owes rings:
  // a new betting decision (also a second one in a row: big blind's option,
  // then first on the flop) and, on the server's draw clock, a draw he still
  // owes (every undrawn seat — not only the seat that closed the betting).
  const turnAlertKey = drawClockKnown
    ? (isMyDraw ? `draw|${gameState?.tableId ?? ''}|${gameState?.handNumber ?? ''}|${phase}` : null)
    : decisionKey;
  useEffect(() => {
    // Play 'turn' when it becomes player's turn
    if (turnAlertKey && turnAlertKey !== prevIsMyTurnRef.current) {
      playSound('turn');
      // Local push when the tab is backgrounded so a player who switched away
      // doesn't time out. Foreground players already see the on-screen turn UI,
      // so only fire when hidden to avoid spam. notify.yourTurn self-guards on
      // Notification.permission==='granted'.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        notify.yourTurn();
      }
    }
    // (holds the last alerted key now; null between turns)
    prevIsMyTurnRef.current = turnAlertKey;
  }, [turnAlertKey, playSound]);

  // Pot pulse + amount flash animation when pot increases
  useEffect(() => {
    if (pot > prevPotRef.current && prevPotRef.current > 0) {
      setPotPulsing(true);
      const t1 = setTimeout(() => setPotPulsing(false), 600);
      // Flash the pot amount green when chips are added
      clearTimeout(potFlashTimerRef.current);
      setPotFlashing(true);
      potFlashTimerRef.current = setTimeout(() => setPotFlashing(false), 500);
      return () => { clearTimeout(t1); clearTimeout(potFlashTimerRef.current); };
    }
    prevPotRef.current = pot;
  }, [pot]);

  // Card deal animation — fires when cards go from 0 → N
  useEffect(() => {
    const prev = prevCardCountRef.current;
    const curr = yourCards.length;
    prevCardCountRef.current = curr;
    if (curr > 0 && prev === 0) {
      setCardsDealt(false);
      const t = setTimeout(() => setCardsDealt(true), 20);
      return () => clearTimeout(t);
    }
    if (curr === 0) setCardsDealt(false);
  }, [yourCards.length]);

  // Phase transition banner
  useEffect(() => {
    const bannerMap = { Flop: 'THE FLOP', Turn: 'THE TURN', River: 'THE RIVER', Showdown: 'SHOWDOWN' };
    const label = bannerMap[phase];
    if (label && prevPhaseRef.current !== phase) {
      setPhaseBanner(label);
      const t = setTimeout(() => setPhaseBanner(null), 1800);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // === Dealer Voice Lines: trigger on phase transitions ===
  useEffect(() => {
    const prev = prevPhaseForVoiceRef.current;
    let voiceLine = null;

    if (phase === 'PreFlop' && prev !== 'PreFlop') {
      voiceLine = 'Shuffle up and deal!';
    } else if (phase === 'Flop' && prev !== 'Flop') {
      voiceLine = 'The Flop';
    } else if (phase === 'Turn' && prev !== 'Turn') {
      voiceLine = 'The Turn';
    } else if (phase === 'River' && prev !== 'River') {
      voiceLine = 'The River';
    } else if (phase === 'Showdown' && prev !== 'Showdown') {
      voiceLine = 'Showdown!';
    } else if (phase === 'HandComplete' && prev !== 'HandComplete') {
      // Winner line
      const winners = gameState?.handResult?.winners;
      if (winners && winners.length > 0) {
        voiceLine = `Winner: ${safeName(winners[0]?.playerName, 'Player')}!`;
      }
    }

    // Check for all-in: any seat that just went all-in
    if (!voiceLine && gameState?.seats) {
      const allInPlayer = gameState.seats.find((s) => s?.allIn && s?.lastAction?.startsWith('All-In'));
      if (allInPlayer && prev === phase) {
        // Only on new all-in action, not phase change
      }
    }

    if (voiceLine) {
      // Respect in-progress fade: if we're already fading out, let it finish
      // (400ms) before queueing the next voice line. Previously, back-to-back
      // phase changes within 2s would clear the fade timer mid-transition and
      // the CSS fade class never applied — line visually popped instead of faded.
      const startVoice = () => {
        dealerVoiceFadingRef.current = false;
        setDealerVoice(voiceLine);
        dealerVoiceTimerRef.current = setTimeout(() => {
          dealerVoiceFadingRef.current = true;
          setDealerVoiceKey((k) => k + 1); // force re-render for fade
          setTimeout(() => {
            setDealerVoice(null);
            dealerVoiceFadingRef.current = false;
          }, 400);
        }, 2000);
      };
      if (dealerVoiceFadingRef.current) {
        // In the middle of a fade-out already; chain the next line after it.
        setTimeout(startVoice, 400);
      } else {
        if (dealerVoiceTimerRef.current) clearTimeout(dealerVoiceTimerRef.current);
        startVoice();
      }
    }

    prevPhaseForVoiceRef.current = phase;

    return () => {
      if (dealerVoiceTimerRef.current) clearTimeout(dealerVoiceTimerRef.current);
    };
  }, [phase, gameState?.handResult, gameState?.seats]);

  // === All-in voice line: detect when someone goes all-in ===
  const prevAllInRef = useRef(new Set());
  useEffect(() => {
    if (!gameState?.seats) return;
    const currentAllIn = new Set();
    gameState.seats.forEach((s, i) => { if (s?.allIn) currentAllIn.add(i); });
    const newAllIns = [...currentAllIn].filter((i) => !prevAllInRef.current.has(i));
    if (newAllIns.length > 0 && phase !== 'HandComplete' && phase !== 'WaitingForPlayers') {
      if (dealerVoiceTimerRef.current) clearTimeout(dealerVoiceTimerRef.current);
      dealerVoiceFadingRef.current = false;
      setDealerVoice('All-in!');
      dealerVoiceTimerRef.current = setTimeout(() => {
        dealerVoiceFadingRef.current = true;
        setDealerVoice((v) => v);
        setTimeout(() => {
          setDealerVoice(null);
          dealerVoiceFadingRef.current = false;
        }, 400);
      }, 2000);
    }
    prevAllInRef.current = currentAllIn;
  }, [gameState?.seats, phase]);

  // === Big Win Confetti: trigger on big wins ===
  const handResult = gameState?.handResult || null;
  useEffect(() => {
    if (!handResult?.winners || handResult === confettiShownRef.current) return;
    const myWin = handResult.winners.find((w) => w.seatIndex === yourSeat);
    if (myWin) {
      const chipsWon = myWin.chipsWon || 0;
      const lastBet = myPlayer?.currentBet || 0;
      const isBigWin = chipsWon > 2000 || (lastBet > 0 && chipsWon >= lastBet * 5);
      if (isBigWin) {
        confettiShownRef.current = handResult;
        setConfettiChips(chipsWon);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3500);
      }
    }
  }, [handResult, yourSeat, myPlayer]);

  // === Show hand after winning without showdown (#6) ===
  useEffect(() => {
    if (phase === 'HandComplete' && handResult?.winners?.some(w => w.seatIndex === yourSeat) &&
        handResult?.winners?.[0]?.handName === 'Won by fold') {
      setShowHandPrompt(true);
      if (showHandTimerRef.current) clearTimeout(showHandTimerRef.current);
      showHandTimerRef.current = setTimeout(() => setShowHandPrompt(false), 5000);
    }
    if (phase === 'PreFlop' || phase === 'WaitingForPlayers') setShowHandPrompt(false);
    return () => { if (showHandTimerRef.current) clearTimeout(showHandTimerRef.current); };
  }, [phase, handResult, yourSeat]);

  // === Winner Banner: show after HandComplete ===
  useEffect(() => {
    // Clear immediately when a new hand starts — don't let stale banners bleed in
    if (phase === 'PreFlop' || phase === 'WaitingForPlayers') {
      if (winnerBannerTimerRef.current) { clearTimeout(winnerBannerTimerRef.current); winnerBannerTimerRef.current = null; }
      setWinnerBanner(null);
      setWinnerBannerFading(false);
      return;
    }
    if (phase === 'HandComplete' && handResult?.winners?.length > 0 && handResult !== winnerBannerShownRef.current) {
      winnerBannerShownRef.current = handResult;

      // Gameplay audit F19 / F20 (2026-10-21) — per pot only when the server's
      // pot list names every pot's winners; a fold win (and an older server's
      // Omaha Hi-Lo pot) listed none and the banner came up empty. Else one
      // line per winner from the totals. One line per seat per pot.
      const lines = winnerBannerLines(handResult);
      setWinnerBanner({ lines });
      setWinnerBannerFading(false);
      if (winnerBannerTimerRef.current) clearTimeout(winnerBannerTimerRef.current);
      winnerBannerTimerRef.current = setTimeout(() => {
        setWinnerBannerFading(true);
        setTimeout(() => {
          setWinnerBanner(null);
          setWinnerBannerFading(false);
        }, 600);
      }, 3500);
    }
    return () => {
      if (winnerBannerTimerRef.current) clearTimeout(winnerBannerTimerRef.current);
    };
  }, [phase, handResult]);

  // === XP Award: record hand and award XP on hand completion ===
  const xpRecordedRef = useRef(null);
  useEffect(() => {
    if (phase === 'HandComplete' && handResult && handResult !== xpRecordedRef.current) {
      xpRecordedRef.current = handResult;
      const myWin = (handResult.winners ?? []).find((w) => w.seatIndex === yourSeat);
      const mySeat = gameState?.seats?.[yourSeat];
      // Check if player voluntarily put chips in preflop (VPIP) or raised preflop (PFR)
      const myActions = handResult?.playerActions?.[yourSeat] || gameState?.actionLog?.filter(a => a.seatIndex === yourSeat) || [];
      const voluntaryPut = myActions.some(a => ['call','raise','bet'].includes(a?.action || a?.type));
      const preflopRaise = myActions.some(a => (a?.action === 'raise' || a?.type === 'raise') && (a?.phase === 'PreFlop' || a?.street === 'preflop'));
      const raiseCount = myActions.filter(a => (a?.action === 'raise' || a?.type === 'raise')).length;
      // Use actual showdown hand name even on losses (for bestHand tracking)
      const myShowdownHand = handResult?.showdownHands?.find(h => h.seatIndex === yourSeat)?.handName || '';
      useProgressStore.getState().recordHand({
        won: !!myWin,
        potSize: pot || 0,  // always use full pot for XP calc, not just chipsWon
        handName: myWin?.handName || myShowdownHand,
        chipsAfter: mySeat?.chips ?? mySeat?.chipCount ?? null,
        voluntaryPut,
        preflopRaise,
        position: gameState?.seatPositions?.[yourSeat] || '',
        holeCards: yourCards,
        communityCards: communityCards,
        actions: myActions,
        handId: gameState?.handId || gameState?.handNumber,
        raiseCount,
      });
      // 2026-04-22 audit fix: do NOT write mySeat.chips into the wallet.
      // mySeat.chips is the on-table stack (buy-in minus losses plus
      // winnings), NOT the player's off-table wallet balance. Mirroring
      // it into progressStore.chips caused the HUD to briefly display
      // the seated stack as the wallet total, and — worse — any code
      // path that persisted progressStore.chips back to the server
      // would be overwriting the real wallet with a seated-stack value.
      //
      // Wallet chips are server-authoritative and arrive via the
      // `playerProgress` socket event (see CLAUDE.md — "Chip mutations
      // flow through server-authoritative paths ONLY"). Leave that as
      // the sole source of truth for users.chips on the client.
    }
  }, [phase, handResult, yourSeat, pot]);

  // Show showdown overlay when hand result is available
  useEffect(() => {
    if (
      (phase === 'Showdown' || phase === 'HandComplete') &&
      handResult &&
      handResult.showdownHands &&
      handResult.showdownHands.length > 0
    ) {
      setShowShowdown(true);
      // Auto-dismiss: 1.5s if quick showdown, else 5s (#13)
      const showdownDelay = quickShowdown ? 1500 : 5000;
      if (showdownTimerRef.current) clearTimeout(showdownTimerRef.current);
      showdownTimerRef.current = setTimeout(() => {
        setShowShowdown(false);
      }, showdownDelay);
    } else if (phase !== 'Showdown' && phase !== 'HandComplete') {
      // New hand started — clear immediately so it can't block action buttons
      setShowShowdown(false);
      if (showdownTimerRef.current) {
        clearTimeout(showdownTimerRef.current);
        showdownTimerRef.current = null;
      }
    }
    // Also force-close if a new hand has started (PreFlop) regardless of other conditions
    if (phase === 'PreFlop') {
      setShowShowdown(false);
      if (showdownTimerRef.current) {
        clearTimeout(showdownTimerRef.current);
        showdownTimerRef.current = null;
      }
    }
    return () => {
      if (showdownTimerRef.current) clearTimeout(showdownTimerRef.current);
    };
  }, [phase, handResult, quickShowdown]);

  // Sync server turn timestamp to shared timer store (for all seat pod rings)
  const serverTurnStartedAt = gameState?.turnStartedAt || 0;
  const serverTurnTimeout   = gameState?.turnTimeout || 30000;
  // Gameplay audit G169 (2026-10-21) — in a draw round the hero's clock is the
  // server's DRAW clock (drawStartedAt + drawTimeout) while he still owes a
  // draw; the betting clock in turnStartedAt belongs to whoever closed the
  // betting and is stale there. No drawStartedAt (older server): as before.
  const clockOn = drawClockKnown ? isMyDraw : isMyTurn;
  const clockStart = drawClockKnown ? gameState.drawStartedAt : serverTurnStartedAt;
  const clockTimeout = drawClockKnown
    ? ((typeof gameState?.drawTimeout === 'number' && gameState.drawTimeout > 0) ? gameState.drawTimeout : 30000)
    : serverTurnTimeout;
  useEffect(() => {
    if (serverTurnStartedAt > 0) {
      setTurnTiming(serverTurnStartedAt, serverTurnTimeout);
    } else {
      clearTurnTiming();
    }
  }, [serverTurnStartedAt, serverTurnTimeout, setTurnTiming, clearTurnTiming]);

  // Turn timer: hero countdown derived from server timestamp.
  // Defensive guards against reconnect drift:
  //  • Don't tick at all until BOTH serverTurnStartedAt and serverTurnTimeout
  //    have been populated (was previously using `|| Date.now()` fallback,
  //    which during reconnect could produce a 30s display that immediately
  //    jumped to 0 when the real value arrived).
  //  • Clamp remaining to the timeout-in-seconds ceiling, not just >= 0,
  //    so a future-dated serverTurnStartedAt (clock skew) doesn't briefly
  //    show e.g. 120s on a 30s budget.
  useEffect(() => {
    if (clockOn) {
      timerWarningPlayed.current = false;
      timerStartedRef.current = false;

      const tick = () => {
        timerStartedRef.current = true;
        // Require a real server timestamp; skip ticks before reconnect settles.
        if (!clockStart || !clockTimeout) {
          setTimeLeft(Math.ceil((clockTimeout || 30000) / 1000));
          return;
        }
        // R2 (P3) — on the SERVER's clock (_serverTs offset), not the device's.
        const elapsed = serverNow() - clockStart;
        const timeoutSec = Math.max(1, Math.ceil(clockTimeout / 1000));
        const rawRemaining = Math.ceil((clockTimeout - elapsed) / 1000);
        const remaining = Math.max(0, Math.min(timeoutSec, rawRemaining));
        setTimeLeft(remaining);
        if (remaining <= 0) {
          clearInterval(timerRef.current);
        }
      };
      tick(); // immediate first tick
      timerRef.current = setInterval(tick, 1000);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else {
      setTimeLeft(30);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [clockOn, clockStart, clockTimeout]);

  // Execute auto-action when it becomes your turn
  useEffect(() => {
    if (isMyTurn && autoActionRef.current) {
      const action = autoActionRef.current;
      autoActionRef.current = null;
      setAutoAction(null);

      if (action === 'fold') {
        // Sit & Go fix-all C4 — like the queued pre-action: checks when free.
        if (queuedFoldAction(callAmount, { isAof, aofFreeCheck }) === 'check') {
          playSound('check');
          sendAction('check');
        } else {
          playSound('fold');
          sendAction('fold');
        }
      } else if (action === 'check' && callAmount === 0) {
        playSound('check');
        sendAction('check');
      } else if (action === 'check' && callAmount > 0) {
        // Can't check, need to call — don't auto-act, let player decide
      } else if (action === 'call') {
        playSound('call');
        sendAction('call');
      } else if (action === 'callAny') {
        // Safety cap: standard poker UX is to fold when the queued call
        // amount exceeds the player's stack (e.g., opponent re-raised huge
        // after we queued Call Any). Rather than silently put the player
        // all-in, fold — they can always explicitly click Call to commit.
        if (callAmount > myChips) {
          playSound('fold');
          sendAction('fold');
        } else {
          playSound('call');
          sendAction('call');
        }
      }
    }
  }, [isMyTurn, callAmount, myChips, sendAction, playSound, isAof, aofFreeCheck]);

  // Sync ref with state
  useEffect(() => {
    autoActionRef.current = autoAction;
  }, [autoAction]);

  // Clear auto-action and pre-action when a new hand starts
  useEffect(() => {
    if (phase === 'WaitingForPlayers' || phase === 'HandComplete' || phase === 'PreFlop') {
      setAutoAction(null);
      setPreAction(null);
    }
  }, [phase]);

  const autoFoldedRef = useRef(false);
  const timerStartedRef = useRef(false); // true only after the first interval tick
  // 2026-07-06 — DO NOT auto-fold/check off the local countdown. The turn-timer
  // expiry is handled AUTHORITATIVELY BY THE SERVER (poker-server index.ts turn
  // timer folds if facing a bet, else checks, at TURN_TIMEOUT_MS). The client
  // countdown above is DISPLAY-ONLY.
  //
  // Emitting a fold/check off the local clock stole live hands from players
  // ("it folds when I didn't push anything"): `Date.now() - serverTurnStartedAt`
  // (~line 1565) has NO clock-skew correction, so a device whose clock runs a bit
  // fast hits 0 early and folded a playable hand; and a stale `timeLeft === 0`
  // carried into a fresh turn (setTimeLeft is async) fired an instant fold via
  // the timerStartedRef race. Both are gone now — the server is the sole timeout
  // authority and can't hang (it always acts at 30s), so the client never needs
  // to. When our countdown shows 0 we simply leave the buttons live until the
  // server resolves the turn. This effect now only resets the per-turn action
  // guards when the turn ends.
  // Gameplay audit F130 (2026-10-21) — and when a NEW decision point opens
  // while it stays his turn (the big blind checks his option and is first on
  // the flop: isMyTurn never went false, so hotkeys and felt gestures stayed
  // locked by the previous street's action). Never on the turn's first frame
  // (null → key): the pre-action effect may have just sent for it.
  const prevDecisionKeyForLockRef = useRef(null);
  useEffect(() => {
    const prev = prevDecisionKeyForLockRef.current;
    prevDecisionKeyForLockRef.current = decisionKey;
    if (!decisionKey || (prev && prev !== decisionKey)) {
      autoFoldedRef.current = false;
      hasSentActionRef.current = false;
      timerStartedRef.current = false;
    }
    if (decisionKey && prev && prev !== decisionKey) {
      // nothing armed for the previous decision carries over
      clearTimeout(foldTimerRef.current);
      foldPendingRef.current = false;
      setFoldPending(false);
      setShowAllInConfirm(false);
    }
  }, [decisionKey]);

  // All-In confirm modal watchdog — clear on turn end or after 10s idle.
  useEffect(() => {
    if (!showAllInConfirm) {
      if (allInConfirmTimerRef.current) {
        clearTimeout(allInConfirmTimerRef.current);
        allInConfirmTimerRef.current = null;
      }
      return;
    }
    if (!isMyTurn) {
      // Turn ended (timeout, disconnect, server advanced hand) — close modal.
      setShowAllInConfirm(false);
      return;
    }
    allInConfirmTimerRef.current = setTimeout(() => {
      setShowAllInConfirm(false);
    }, 10000);
    return () => {
      if (allInConfirmTimerRef.current) clearTimeout(allInConfirmTimerRef.current);
    };
  }, [showAllInConfirm, isMyTurn]);

  // Hotkey-hints fade manager: reset on each new turn, begin fade after 24s,
  // fully hide at 30s. Cleans up on unmount or turn change.
  useEffect(() => {
    if (!isMyTurn) {
      setHotkeyHintsVisible(true);
      setHotkeyHintsFading(false);
      return;
    }
    setHotkeyHintsVisible(true);
    setHotkeyHintsFading(false);
    const fadeStart = setTimeout(() => setHotkeyHintsFading(true), 24000);
    const hideEnd = setTimeout(() => setHotkeyHintsVisible(false), 30000);
    return () => {
      clearTimeout(fadeStart);
      clearTimeout(hideEnd);
    };
  }, [isMyTurn]);

  // Timer warning sound when < 5 seconds — gated on the timeLeft VALUE that
  // last played rather than a 900ms timer (which was racing with the 1s tick
  // and could fire twice per second). Now each new `timeLeft` integer plays
  // exactly one warning tone.
  const lastWarningTickRef = useRef(null);
  useEffect(() => {
    // G169 — the clock on screen (betting turn, or his draw on the draw clock)
    if (!clockOn) {
      lastWarningTickRef.current = null;
      return;
    }
    if (timeLeft > 5 || timeLeft <= 0) return;
    if (lastWarningTickRef.current === timeLeft) return;
    lastWarningTickRef.current = timeLeft;
    playSound('timer');
  }, [timeLeft, clockOn, playSound]);

  // Scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Auto-rebuy: fires ONLY when the player has truly busted (0 chips), not
  // just short-stacked. Previously used `myChips < minBuyIn` which topped
  // up any under-min stack every hand — that's free chips every time you
  // lose a pot, not real poker. Now matches PokerStars / GG: rebuy on bust
  // to the starting stack; short-stacked players play out of it or leave.
  // 2026-10-10 (round 3) — only for a player SEATED here (a spectator has no
  // seat: myChips read 0 and every HandComplete sent a refused 'rebuy' plus a
  // false "Auto-rebuying" toast), and never at a tournament table (the server
  // refuses tournament rebuys).
  // R1 (TOURNEY-1, CONTRACTS R1 #2) — the server says per table whether a rebuy
  // is allowed (`rebuyAllowed`: false at tournaments and the quick tables —
  // Spin & Go, career, heads-up, all-in-or-fold — which refuse it with
  // `rebuy_not_allowed`). Auto-rebuy and its Options toggle follow it; a
  // missing key (an older server) keeps the old client-side rule. The amount is
  // the table's own `minBuyIn` (5000 only when an older server doesn't say).
  const rebuyFlag = rebuyAllowedFlag(gameState);
  const rebuySeated = !isSpectating && !gameState?.isSpectator && !!myPlayer && yourSeat >= 0;
  const rebuyTableAllows = rebuyFlag === null
    ? (gameState?.isTournament !== true && gameState?.tournamentId == null && !onTournamentSeat)
    : (rebuyFlag === true && !onTournamentSeat);
  const rebuySeatHere = rebuySeated && rebuyTableAllows;
  const rebuyOptionShown = rebuyFlag !== false;
  // Gameplay audit F149 (2026-10-21) — the auto-rebuy says only what it SENT
  // ("Rebuying…"); the success line waits for the server's `rebuyComplete`,
  // and a refusal is the server's own words (actionErrorHandler). After an
  // "Insufficient chips for rebuy" it pauses at that table (a busted seat sees
  // HandComplete every hand — the same refused rebuy + toast pair repeated
  // each hand) until his stack is back above 0, the table changes, or he
  // turns Auto Rebuy off and on.
  const autoRebuySentAtRef = useRef(0);
  const autoRebuyPausedAtRef = useRef(null);
  const shownTableIdForRebuy = gameState?.tableId != null ? String(gameState.tableId) : null;
  useEffect(() => {
    if (myChips > 0 || !autoRebuy || (autoRebuyPausedAtRef.current && autoRebuyPausedAtRef.current !== shownTableIdForRebuy)) {
      autoRebuyPausedAtRef.current = null;
    }
  }, [myChips, autoRebuy, shownTableIdForRebuy]);
  useEffect(() => {
    if (autoRebuy && rebuySeatHere && phase === 'HandComplete' && prevPhaseForRebuyRef.current !== 'HandComplete') {
      if (myChips <= 0 && !(autoRebuyPausedAtRef.current && autoRebuyPausedAtRef.current === shownTableIdForRebuy)) {
        const minBuyIn = rebuyAmountFor(gameState, 5000);
        const socket = getSocket();
        if (socket?.connected) {
          // (tableId = the table on screen in multi-table mode, the main seat
          // otherwise — an older server ignores it and tops up the main seat)
          const payload = { amount: minBuyIn, tableId: useTableStore.getState().currentTableId || undefined };
          // 2026-10-07 — replayable once if refused login_required on a
          // still-signed-in tab (services/playRefusal.js).
          notePlayAttempt(() => { const s = getSocket(); if (s?.connected) s.emit('rebuy', payload); });
          socket.emit('rebuy', payload);
          autoRebuySentAtRef.current = Date.now();
          addToast(`♻ Rebuying ${minBuyIn.toLocaleString()} chips…`, 'info');
        }
      }
    }
    prevPhaseForRebuyRef.current = phase;
  }, [phase, autoRebuy, myChips, gameState, rebuySeatHere, shownTableIdForRebuy]);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onRebuyComplete = (d) => {
      if (!d || d.success !== true) return;
      autoRebuyPausedAtRef.current = null;
      const added = Number(d.added);
      if (Number.isFinite(added) && added > 0) {
        addToast(`♻ Rebuy complete: +${added.toLocaleString()} chips`, 'success');
      }
    };
    socket.on('rebuyComplete', onRebuyComplete);
    return () => socket.off('rebuyComplete', onRebuyComplete);
  // (addToast is declared further down and stable — not a dep here)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Record opponent stats from each completed hand's full action log. Phase 5:
  // driven by the handHistory record (which now carries the street-tagged
  // actionLog) rather than gameState — keyed by handNumber so it fires exactly
  // once per hand even if handHistories is capped/trimmed.
  const lastStatHandRef = useRef(null);
  useEffect(() => {
    const rec = handHistories.length ? handHistories[handHistories.length - 1] : null;
    if (rec && rec.handNumber !== lastStatHandRef.current) {
      lastStatHandRef.current = rec.handNumber;
      recordHandStats(rec, yourSeat);
    }
  }, [handHistories, yourSeat]);

  // Build bet history strip for current street (Upgrade 4)
  useEffect(() => {
    if (!gameState?.seats || phase === 'WaitingForPlayers') {
      setStreetActions([]);
      prevActionsRef.current = [];
      return;
    }
    // On new street, clear
    if (phase !== prevPhaseForStreetRef.current) {
      setStreetActions([]);
      prevActionsRef.current = [];
      prevPhaseForStreetRef.current = phase;
      return;
    }
    // Detect new actions from seat lastAction changes
    const newActions = [];
    gameState.seats.forEach((seat, i) => {
      if (!seat || seat.state !== 'occupied') return;
      const prevSeat = prevActionsRef.current[i];
      const action = seat.lastAction;
      if (!action || action === 'None') return;
      if (prevSeat && prevSeat.lastAction === action && prevSeat.currentBet === seat.currentBet) return;
      newActions.push({
        player: safeName(seat.playerName, '') || `P${i+1}`,
        action,
        amount: seat.currentBet > 0 ? seat.currentBet : null,
        isMe: i === yourSeat,
      });
    });
    if (newActions.length > 0) {
      setStreetActions(prev => {
        const combined = [...prev, ...newActions];
        return combined.slice(-6);
      });
    }
    prevActionsRef.current = gameState.seats.map(s => s ? { lastAction: s.lastAction, currentBet: s.currentBet } : null);
  }, [gameState?.seats]);

  // Clear street actions on new phase (Upgrade 4)
  useEffect(() => {
    setStreetActions([]);
    prevActionsRef.current = [];
    prevPhaseForStreetRef.current = phase;
  }, [phase]);

  // Connection status subscription
  useEffect(() => {
    const unsub = subscribeConnectionStatus((status) => setConnStatus(status));
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  // Opponent stats popup — triggered by 'viewOpponentStats' custom event from table seats
  useEffect(() => {
    const handler = (e) => {
      // 2026-10-23 — no opponent stats (a HUD) at a qualifier table.
      if (helpToolsOffRef.current) return;
      const name = e.detail;
      const stats = getOpponentStats(name);
      setOpponentStats(stats && stats.hands > 0 ? { name, ...stats } : { name, hands: 0 });
      clearTimeout(opponentStatsTimerRef.current);
      opponentStatsTimerRef.current = setTimeout(() => setOpponentStats(null), 6000);
    };
    window.addEventListener('viewOpponentStats', handler);
    return () => {
      window.removeEventListener('viewOpponentStats', handler);
      clearTimeout(opponentStatsTimerRef.current);
    };
  }, []);

  // Toast helper — auto-dismisses after `duration` ms
  const addToast = useCallback((msg, type = 'info', duration = 3000) => {
    const id = ++toastIdRef.current;
    setToasts(q => [...q, { id, msg, type }]);
    setTimeout(() => setToasts(q => q.filter(t => t.id !== id)), duration);
  }, []);

  // R1 (CONTRACTS R1 #1) — the insurance confirmation shows the SERVER's
  // numbers (`insuranceAccepted { cashout, equityPct }`), at the table where
  // Accept was tapped. (It used to be an app-wide "Mission Complete!" popup
  // echoing whatever the server computed, e.g. "3520% equity".)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onAccepted = (data) => {
      const acc = readInsuranceAccepted(data);
      if (!acc) return;
      addToast(
        acc.equityPct === null
          ? `🛡 Insurance locked in — ${acc.cashout.toLocaleString()} chips guaranteed`
          : `🛡 Insurance locked in — ${acc.cashout.toLocaleString()} chips guaranteed (${acc.equityPct}% equity)`,
        'success',
        4500,
      );
    };
    socket.on('insuranceAccepted', onAccepted);
    return () => socket.off('insuranceAccepted', onAccepted);
  }, [addToast]);

  // R1 (TABLEUI-12) — a tap queued while the connection was down is held until
  // the server restores the seat; if that never happens it is dropped (see
  // socketService). Say so and let the player act again this turn.
  useEffect(() => {
    const onDropped = (e) => {
      hasSentActionRef.current = false;
      const t = e?.detail?.type;
      const label = t === 'allIn' ? 'All-In' : typeof t === 'string' && t ? t.charAt(0).toUpperCase() + t.slice(1) : 'action';
      addToast(`Your ${label} was not sent — the connection dropped. Please act again.`, 'warn', 4000);
    };
    window.addEventListener('poker:queued-action-dropped', onDropped);
    return () => window.removeEventListener('poker:queued-action-dropped', onDropped);
  }, [addToast]);

  // Persist auto-rebuy preference
  useEffect(() => {
    sessionStorage.setItem('app_poker_autoRebuy', autoRebuy ? 'true' : 'false');
  }, [autoRebuy]);

  // Persist Auto Deal preference (#11)
  useEffect(() => {
    sessionStorage.setItem('app_poker_autoDeal', autoDeal ? 'true' : 'false');
  }, [autoDeal]);

  // Auto Deal: auto-start next hand after HandComplete (#11)
  // 2026-10-10 (S1/S2) — never at a tournament table: poker-server deals
  // tournament hands itself, behind its tournament guards (pause, waiting for
  // players, a table break, a pending bust check), and a client 'startHand'
  // must not race them.
  useEffect(() => {
    if (autoDeal && phase === 'HandComplete' && !isSpectating && !onTournamentSeat) {
      if (autoDealTimerRef.current) clearTimeout(autoDealTimerRef.current);
      autoDealTimerRef.current = setTimeout(() => {
        startHand();
      }, 2000);
    }
    return () => {
      if (autoDealTimerRef.current) clearTimeout(autoDealTimerRef.current);
    };
  }, [autoDeal, phase, isSpectating, startHand, onTournamentSeat]);

  // Fast Mode (#12) — R2 (P3 / GAME-11): fast mode is the PLAYER's own
  // setting on the server (`fastModeSet { enabled }`), so it is sent only
  // when he flips the toggle. The old effect also sent it on every mount — a
  // `setFastMode false` that switched fast mode off whenever the table opened.
  const toggleFastMode = useCallback(() => {
    const next = !fastMode;
    setFastMode(next);
    const socket = getSocket();
    if (socket?.connected) socket.emit('setFastMode', { enabled: next });
  }, [fastMode]);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onSet = (d) => { if (d && typeof d.enabled === 'boolean') setFastMode(d.enabled); };
    socket.on('fastModeSet', onSet);
    return () => socket.off('fastModeSet', onSet);
  }, []);
  // R3 (K1-6) — the server stamps this session's fast-mode choice on every
  // per-player state (`fastMode`): after a page reload or a seat restore the
  // toggle shows what the server applies, not a stale local OFF.
  const serverFastMode = gameState?.fastMode;
  useEffect(() => {
    if (typeof serverFastMode === 'boolean') setFastMode(serverFastMode);
  }, [serverFastMode]);

  // Persist Quick Showdown preference (#13)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('app_poker_settings');
      const settings = raw ? JSON.parse(raw) : {};
      settings.quickShowdown = quickShowdown;
      sessionStorage.setItem('app_poker_settings', JSON.stringify(settings));
    } catch { /* ignore */ }
  }, [quickShowdown]);

  // === All-in Equity Simulation (#17) ===
  useEffect(() => {
    if (!gameState || !seats) { setEquityResults(null); return; }
    // Check if all active (non-folded) players are all-in, or it's showdown with cards visible
    const activePlayers = seats.filter(s => s && s.state === 'occupied' && !s.folded && !s.eliminated);
    if (activePlayers.length < 2) { setEquityResults(null); return; }

    const allAllIn = activePlayers.every(s => s.allIn || s.chipCount === 0);
    const isShowdownPhase = phase === 'Showdown' || phase === 'HandComplete';
    if (!allAllIn && !isShowdownPhase) { setEquityResults(null); return; }

    // Only compute if we have showdown hands (cards visible)
    const showdownHands = gameState?.handResult?.showdownHands;
    if (!showdownHands || showdownHands.length < 2) { setEquityResults(null); return; }

    // Gameplay audit G170 (2026-10-21) — the worker simulates HIGH Hold'em /
    // Omaha hands on a board. Stud / Razz / Draw / Badugi (no board, lowball),
    // Short Deck (its own ranking) and Omaha Hi-Lo (split pots) get no badges:
    // they showed the server's winner as the underdog. Omaha uses the worker's
    // exactly-two-hole-cards rule (it counted illegal one-card flushes).
    const sim = equitySimFor(gameState);
    if (!sim) { setEquityResults(null); return; }

    // Check if we already calculated for this exact state (table, hand and
    // variant included: Stud never reaches PreFlop, where the key was reset)
    const stateKey = `${gameState?.tableId ?? ''}-${gameState?.handNumber ?? ''}-${gameState?.variant ?? ''}-${phase}-${communityCards.length}-${showdownHands.map(h => h.seatIndex).join(',')}`;
    if (equityCalculatedRef.current === stateKey) return;
    equityCalculatedRef.current = stateKey;

    // Build inputs for simulation
    const playerHands = showdownHands.map(h => h.holeCards || []);
    const usedCards = new Set();
    for (const h of showdownHands) {
      for (const c of (h.holeCards || [])) usedCards.add(`${c.rank}-${c.suit}`);
    }
    for (const c of communityCards) usedCards.add(`${c.rank}-${c.suit}`);

    // Build remaining deck
    const deckRemaining = [];
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 2; rank <= 14; rank++) {
        if (!usedCards.has(`${rank}-${suit}`)) {
          deckRemaining.push({ rank, suit });
        }
      }
    }

    // Run simulation in the equity web worker to avoid blocking the UI
    calculateEquity(playerHands, communityCards, deckRemaining, 1000, sim.omaha)
      .then((result) => {
        // a result for a state that has moved on (next hand / table) is dropped
        if (equityCalculatedRef.current !== stateKey) return;
        const equityMap = {};
        showdownHands.forEach((h, i) => {
          equityMap[h.seatIndex] = result.playerEquities[i];
        });
        setEquityResults(equityMap);
      })
      .catch(() => {
        setEquityResults(null);
      });
  }, [gameState, seats, phase, communityCards]);

  // Reset equity when new hand starts
  useEffect(() => {
    if (phase === 'PreFlop' || phase === 'WaitingForPlayers') {
      setEquityResults(null);
      equityCalculatedRef.current = null;
    }
  }, [phase]);

  // === Missed Blinds listener (refactored for audit findings) ===
  const [missedBlindsAmount, setMissedBlindsAmount] = useState(0);
  const [missedBlindsType, setMissedBlindsType] = useState(null); // 'small' | 'big' | 'both' | null
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    // F156 — a reply for another table (multi-table) is not this table's.
    const otherTable = (data) => isOtherTableReply(data, useTableStore.getState().gameState?.tableId);
    const handler = (data) => {
      if (otherTable(data)) return;
      if (data && data.amount) {
        setMissedBlindsAmount(data.amount);
        if (data.type) setMissedBlindsType(data.type);
      }
    };
    const postedHandler = (data) => { if (otherTable(data)) return; setMissedBlindsAmount(0); setMissedBlindsType(null); };
    const errorHandler = (data) => {
      if (otherTable(data)) return;
      // Audit fix: surface server-side refusal to the player. Previously
      // insufficient_chips silently failed; now a toast explains why.
      if (data?.message) {
        try { addToast(data.message, data.code === 'insufficient_chips' ? 'error' : 'warn', 3500); } catch {}
      }
    };
    // 2026-06-11 audit M7: when the server REJECTS an action (e.g. "Not your
    // turn", "Invalid action", "Duplicate action") it does NOT advance the
    // turn — so hasSentActionRef stayed true and every subsequent tap was
    // dedup'd, locking the player out of acting for the rest of their turn.
    // Clear the ref on any server error so they can retry, and surface the
    // reason (previously action errors only hit console.error in App.jsx).
    const actionErrorHandler = (data) => {
      hasSentActionRef.current = false;
      // 2026-07-05 stale-action guard: the server rejects a click made against a
      // decision point that already moved on (STALE_STATE) and pushes fresh
      // state in the same breath, so the UI re-syncs on its own. Clear the ref so
      // the player can act on the new state, but suppress the toast — nothing
      // went wrong from their side, the table just advanced. Real errors (not
      // your turn, invalid amount, insufficient chips) still surface.
      if (data?.code === 'STALE_STATE') return;
      // R2 (P3) — Auto Deal: the late startHand of two clients (or of a client
      // racing the server's own auto-start) is answered "Hand already in
      // progress". Nothing went wrong for anyone, so no toast.
      if (data?.message === 'Hand already in progress') return;
      // Gameplay audit F149 — our auto-rebuy was refused for lack of chips:
      // pause it at this table (the toast below says why, once).
      if (data?.message === 'Insufficient chips for rebuy' && Date.now() - autoRebuySentAtRef.current < 15000) {
        const gsNow = useTableStore.getState().gameState;
        autoRebuyPausedAtRef.current = gsNow?.tableId != null ? String(gsNow.tableId) : null;
      }
      // 2026-10-07 — a play refusal (suspended / no account, e.g. on rebuy or
      // a career start) is shown by the shared PlayRefusalNotice, verbatim and
      // without the 3s auto-hide. Don't toast it a second time.
      if (reportPlayRefusal(data)) return;
      // R2 (S2 sit-out limit) — a ring seat sat out 30 hands was released and
      // its stack went back to the wallet; the server already made him a
      // spectator of the table (full state + `spectating`). Say why, longer.
      if (data?.code === 'sit_out_limit') {
        const why = (typeof data.message === 'string' && data.message) || ACTION_ERROR_TEXT.sit_out_limit;
        const gs = useTableStore.getState().gameState;
        const kind = gs?.tableKind;
        const canSit = !(gs?.isTournament === true || gs?.tournamentId != null) && (kind == null || kind === 'cash');
        const next = canSit ? ' You are watching the table now. Tap Sit Here on an open seat to play again.' : ' You are watching the table now.';
        try { addToast(`${why}${next}`, 'info', 9000); } catch { /* ignore */ }
        return;
      }
      // R2 (S2, GAME-9) — fixed limit (Stud, Razz, Triple Draw) allows a bet
      // and three raises a round; the server refuses the next raise with only
      // "Invalid action: raise" (no state key says the round is capped), so
      // say what it means there.
      if (data?.message === 'Invalid action: raise' && FIXED_LIMIT_VARIANT.test(String(useTableStore.getState().gameState?.variant || ''))) {
        try { addToast('Raising is capped this round (a bet and three raises). You can call or fold.', 'warn', 3500); } catch { /* ignore */ }
        return;
      }
      // R2 — every refusal is a toast, never a crash: the server's own words,
      // else a plain sentence for the stable code.
      const text = (typeof data?.message === 'string' && data.message) || ACTION_ERROR_TEXT[data?.code] || '';
      if (text) {
        try { addToast(text, 'warn', 3500); } catch { /* ignore */ }
      }
    };
    socket.on('missedBlinds', handler);
    socket.on('missedBlindsPosted', postedHandler);
    socket.on('missedBlindsError', errorHandler);
    socket.on('error', actionErrorHandler);
    return () => {
      socket.off('missedBlinds', handler);
      socket.off('missedBlindsPosted', postedHandler);
      socket.off('missedBlindsError', errorHandler);
      socket.off('error', actionErrorHandler);
    };
  }, []);

  // Sync from gameState (canonical source after server broadcast).
  useEffect(() => {
    if (gameState?.missedBlinds && gameState.missedBlinds > 0) {
      setMissedBlindsAmount(gameState.missedBlinds);
      if (gameState.missedBlindType) setMissedBlindsType(gameState.missedBlindType);
    } else if (gameState && !gameState.missedBlinds) {
      // Explicitly cleared by server — clear locally too.
      setMissedBlindsAmount(0);
      setMissedBlindsType(null);
    }
  }, [gameState?.missedBlinds, gameState?.missedBlindType]);

  // 2026-05-26 defensive belt-and-braces clear: if the player is dealt
  // hole cards in a fresh hand and is not flagged as sitting out, the
  // missed-blind debt cannot logically still be open — the server posts
  // any owed dead-blind chips at the start of every hand (PokerTable.ts
  // ~line 583, `deadBlindOwedChips` auto-paid in startHand). So when we
  // see PreFlop + own hole cards + not sitting out, clear locally even
  // if the server's delta forgot to send `missedBlinds: null`. This
  // protects against future regressions in the server-side null-clear
  // and against any delta race where the missedBlinds field is stale
  // between the post-resolution and the next broadcast.
  useEffect(() => {
    const inActiveHand =
      (phase === 'PreFlop' || phase === 'Flop' || phase === 'Turn' || phase === 'River') &&
      yourCards.length > 0 &&
      !sittingOutHere;
    if (inActiveHand && missedBlindsAmount > 0) {
      setMissedBlindsAmount(0);
      setMissedBlindsType(null);
    }
  }, [phase, yourCards.length, sittingOutHere, missedBlindsAmount]);

  // === Mucked Hand Reveal: show button for 5 seconds after folding ===
  const prevFoldedRef = useRef(false);
  useEffect(() => {
    const folded = myPlayer?.folded || false;
    if (folded && !prevFoldedRef.current && yourCards.length > 0) {
      setShowMuckButton(true);
      if (muckTimerRef.current) clearTimeout(muckTimerRef.current);
      muckTimerRef.current = setTimeout(() => setShowMuckButton(false), 5000);
    }
    // G171 fix-up — not while the phase reads 'PreFlop': a pre-flop fold
    // raised the prompt and this cleared it in the same run (no Show / Muck
    // after a pre-flop fold in Hold'em, Omaha, Draw), and every PreFlop re-run
    // wiped the shown hands. The new-hand edge above clears both per hand.
    if (phase === 'WaitingForPlayers') {
      setShowMuckButton(false);
      setMuckedHands([]);
    }
    prevFoldedRef.current = folded;
  }, [myPlayer?.folded, phase, yourCards.length]);
  // G171 — the 5s timer is cancelled only on unmount: the per-run cleanup
  // killed it at the next street, leaving Show / Muck up for the whole hand
  // (and, in Stud, for good).
  useEffect(() => () => { if (muckTimerRef.current) clearTimeout(muckTimerRef.current); }, []);

  // Gameplay audit F21 (2026-10-21) — a folded hand is shown to the table
  // only once the hand is OVER (TDA: no disclosing a folded hand while action
  // is pending; it gave the players still in the pot card-removal info).
  // 'Show Hand' tapped mid-hand is remembered and sent when this hand reaches
  // HandComplete / Showdown at this table (dropped if the hand or the table
  // changes first). The server holds a mid-hand request the same way
  // (`muckedHandShowQueued`).
  const pendingShowRef = useRef(null); // { tableId, handNumber }
  const emitShowMuckedHand = useCallback((handNumber) => {
    const socket = getSocket();
    if (!socket?.connected) return;
    socket.emit('showMuckedHand', {
      tableId: useTableStore.getState().currentTableId || undefined,
      handNumber,
    });
  }, []);
  const requestShowHand = useCallback(() => {
    const gs = useTableStore.getState().gameState;
    if (!gs) return;
    if (handIsOver(gs.phase)) {
      pendingShowRef.current = null;
      emitShowMuckedHand(gs.handNumber);
      return;
    }
    pendingShowRef.current = { tableId: gs.tableId != null ? String(gs.tableId) : null, handNumber: gs.handNumber };
    addToast(SHOW_AT_HAND_END_TEXT, 'info');
  }, [emitShowMuckedHand, addToast]);
  const showTableId = gameState?.tableId != null ? String(gameState.tableId) : null;
  const showHandNo = gameState?.handNumber ?? null;
  useEffect(() => {
    const p = pendingShowRef.current;
    if (!p) return;
    if (p.tableId !== showTableId || p.handNumber !== showHandNo) { pendingShowRef.current = null; return; }
    if (handIsOver(phase)) {
      pendingShowRef.current = null;
      emitShowMuckedHand(p.handNumber);
    }
  }, [phase, showTableId, showHandNo, emitShowMuckedHand]);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onQueued = () => { addToast(SHOW_AT_HAND_END_TEXT, 'info'); };
    socket.on('muckedHandShowQueued', onQueued);
    return () => socket.off('muckedHandShowQueued', onQueued);
  }, [addToast]);

  // Listen for mucked hand reveals from other players.
  // R1 (TABLEUI-5, CONTRACTS R1 #4) — the payload is checked before it is
  // stored: an array of real cards ({rank 2-14, suit 0-3 or a suit name}),
  // else the whole reveal is dropped (`cards: [null]` / 'x' used to crash
  // every client at the table). The name is made safe too.
  // F21 — a reveal for another table is ignored; one for the hand still being
  // played here (an older server relaying an older client's mid-hand show) is
  // HELD and shown when that hand ends (dropped if the hand changes first).
  const heldRevealsRef = useRef([]); // [{ tableId, handNumber, entry }]
  const showMuckedEntry = useCallback((entry) => {
    const addedAt = Date.now() + Math.random();
    setMuckedHands((prev) => [...prev, { ...entry, addedAt }]);
    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      setMuckedHands((prev) => prev.filter((m) => m.addedAt !== addedAt));
    }, 4000);
  }, []);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (data) => {
      if (!data || typeof data !== 'object') return;
      const cards = sanitizeShownCards(data.cards);
      if (!cards) {
        try { console.warn('[table-payload] dropped a shown-hand payload with invalid cards'); } catch { /* ignore */ }
        return;
      }
      const seatNo = Number.isInteger(data.seatIndex) && data.seatIndex >= 0 ? data.seatIndex + 1 : null;
      const playerName = safeName(data.playerName, '') || (seatNo ? `Seat ${seatNo}` : 'Player');
      const gs = useTableStore.getState().gameState;
      const verdict = revealDecision(data, {
        shownTableId: gs?.tableId != null ? String(gs.tableId) : null,
        handNumber: gs?.handNumber ?? null,
        phase: gs?.phase,
      });
      if (verdict === 'ignore') return;
      if (verdict === 'hold') {
        heldRevealsRef.current = [...heldRevealsRef.current, {
          tableId: gs?.tableId != null ? String(gs.tableId) : null,
          handNumber: data.handNumber,
          entry: { playerName, cards },
        }];
        return;
      }
      showMuckedEntry({ playerName, cards });
    };
    socket.on('muckedHandRevealed', handler);
    return () => socket.off('muckedHandRevealed', handler);
  }, [showMuckedEntry]);
  useEffect(() => {
    const held = heldRevealsRef.current;
    if (!held.length) return;
    const keep = [];
    held.forEach((h) => {
      if (h.tableId !== showTableId || h.handNumber !== showHandNo) return; // the hand moved on: dropped
      if (handIsOver(phase)) showMuckedEntry(h.entry);
      else keep.push(h);
    });
    heldRevealsRef.current = keep;
  }, [phase, showTableId, showHandNo, showMuckedEntry]);

  // Track when player folds (for rabbit hunting)
  // Gameplay audit G171 (2026-10-21) — a fold counts only inside one hand at
  // one table (the pre-fold of a sit-out at the deal is not his fold), and
  // the flag is cleared on the hand boundary edge, not while the phase reads
  // PreFlop: that cleared a pre-flop fold in the same run (no rabbit after a
  // pre-flop fold) and never ran in Stud (a dead rabbit after every hand).
  const prevMyPlayerRef = useRef(null);
  const foldHandKey = `${gameState?.tableId ?? ''}:${gameState?.handNumber ?? ''}`;
  useEffect(() => {
    const prev = prevMyPlayerRef.current;
    if (myPlayer && myPlayer.folded && prev && !prev.folded && prev.handKey === foldHandKey) {
      setPlayerFoldedThisHand(true);
    }
    if (phase === 'WaitingForPlayers') setPlayerFoldedThisHand(false);
    if (phase === 'PreFlop' || phase === 'WaitingForPlayers') {
      clearRabbitCards();
      setShowRabbitPanel(false);
    }
    prevMyPlayerRef.current = myPlayer ? { ...myPlayer, handKey: foldHandKey } : null;
  }, [myPlayer, phase, clearRabbitCards, foldHandKey]);

  // Rabbit hunt socket listener
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (data) => {
      // F156 — another table's rabbit (multi-table) is not shown here.
      if (isOtherTableReply(data, useTableStore.getState().gameState?.tableId)) return;
      // R1 (contract #4) — only a real card list (a board has at most 5).
      const cards = data && typeof data === 'object' ? sanitizeShownCards(data.cards, 5) : null;
      if (cards) {
        setRabbitCards(cards);
        setShowRabbitPanel(true);
      }
    };
    socket.on('rabbitHuntResult', handler);
    return () => socket.off('rabbitHuntResult', handler);
  }, [setRabbitCards]);

  // Reset per-hand insurance UI each hand (R1: an accepted / declined quote is
  // remembered by its handNumber, so no reset is needed for that).
  useEffect(() => {
    if (phase === 'PreFlop' || phase === 'WaitingForPlayers') {
      setShowInsurance(false);
      // Also reset the rabbit-hunt cooldown — fresh hand gets a fresh request.
      setRabbitHuntCooldownUntil(0);
    }
  }, [phase]);

  // Favorite bet size helpers. Storage key retained for backward compat with
  // existing users; all raise-memory state (favs + last pct) will migrate to
  // the unified `app_poker_raiseMemory` blob on next save.
  const RAISE_MEM_KEY = 'app_poker_raiseMemory';
  const saveFavBetSize = (index) => {
    const newFavs = [...favBetSizes];
    newFavs[index] = raiseAmount;
    setFavBetSizes(newFavs);
    sessionStorage.setItem('app_poker_betSizes', JSON.stringify(newFavs));
    // Unified blob (mirror) — single source of truth going forward.
    try {
      const mem = JSON.parse(sessionStorage.getItem(RAISE_MEM_KEY) || '{}');
      mem.favSizes = newFavs;
      sessionStorage.setItem(RAISE_MEM_KEY, JSON.stringify(mem));
    } catch { /* ignore */ }
  };

  const loadFavBetSize = (index) => {
    const val = favBetSizes[index];
    if (val == null) return;
    const clamped = Math.max(minRaiseTotal, Math.min(val, maxRaise));
    const snapped = snapRaiseToStep(clamped);
    setRaiseAmount(snapped);
    // Audit fix #16: surface silent clamping so the player knows why their
    // saved size didn't stick (e.g. short stack after a bust).
    if (snapped !== val) {
      try {
        addToast(
          snapped >= maxRaise
            ? (limits.capBelowStack
              ? `Fav ${val.toLocaleString()} capped at the max bet (${maxRaise.toLocaleString()})`
              : `Fav ${val.toLocaleString()} capped at all-in (${maxRaise.toLocaleString()})`)
            : snapped <= minRaiseTotal
              ? `Fav ${val.toLocaleString()} raised to min (${minRaiseTotal.toLocaleString()})`
              : `Fav ${val.toLocaleString()} snapped to ${snapped.toLocaleString()}`,
          'info',
          2200
        );
      } catch { /* addToast not in scope yet at first render — silent */ }
    }
  };

  // Delete / reset — previously users had no way to clear a slot they'd
  // accidentally filled with a bad size. Right-click / long-press on a fav
  // slot calls clearFavBetSize; the toolbar "Reset Sizes" menu clears all.
  const clearFavBetSize = (index) => {
    const newFavs = [...favBetSizes];
    newFavs[index] = null;
    setFavBetSizes(newFavs);
    sessionStorage.setItem('app_poker_betSizes', JSON.stringify(newFavs));
    try {
      const mem = JSON.parse(sessionStorage.getItem(RAISE_MEM_KEY) || '{}');
      mem.favSizes = newFavs;
      sessionStorage.setItem(RAISE_MEM_KEY, JSON.stringify(mem));
    } catch { /* ignore */ }
  };
  const clearAllFavBetSizes = () => {
    const newFavs = [null, null, null];
    setFavBetSizes(newFavs);
    sessionStorage.setItem('app_poker_betSizes', JSON.stringify(newFavs));
    try {
      sessionStorage.removeItem(RAISE_MEM_KEY);
    } catch { /* ignore */ }
  };

  // GIF reaction buttons for chat
  // GIF_REACTIONS and QUICK_CHATS are module-level constants above

  // Pot fraction helpers
  const potFraction = (fraction) => {
    // Standard NL pot-sized raise, as a RAISE-TO total (what 'raise' sends):
    // call first (the pot becomes pot + callAmount), then raise that much on
    // top of the bet to match. R2 (P3): it used to return callAmount + that,
    // which left out the hero's OWN chips already in this street
    // (myCurrentBet) — every preset from the blinds or after a re-raise came
    // up short (SB facing the BB: "Pot" sent 250 instead of 300).
    const potAfterCall = pot + callAmount;
    const amount = currentBetToMatch + Math.round(potAfterCall * fraction);
    const clamped = Math.max(minRaiseTotal, Math.min(amount, maxRaise));
    // Surface a subtle toast when a preset gets clamped so the user knows
    // the "½ Pot" (etc.) button worked, it just hit the stack ceiling.
    if (clamped !== amount) {
      try {
        addToast(
          clamped >= maxRaise
            ? (limits.capBelowStack
              ? `Capped at the max bet (${maxRaise.toLocaleString()})`
              : `Capped at all-in (${maxRaise.toLocaleString()})`)
            : `Raised to minimum (${minRaiseTotal.toLocaleString()})`,
          'info'
        );
      } catch { /* addToast not in scope yet at first render — silent */ }
    }
    return clamped;
  };

  // Chip denomination breakdown helper
  const chipDenominations = [
    { value: 1000, color: '#081434', border: '#ffd24a', label: '1K' },
    { value: 500, color: '#166534', border: '#4ADE80', label: '500' },
    // R3 (K1-7) — no red chip: 100 is casino black.
    { value: 100, color: '#111827', border: '#9CA3AF', label: '100' },
    { value: 25, color: '#1E40AF', border: '#93C5FD', label: '25' },
    { value: 5, color: '#ffffff', border: '#999', label: '5' },
  ];

  const getChipBreakdown = (amount) => {
    const result = [];
    let remaining = amount;
    for (const denom of chipDenominations) {
      const count = Math.floor(remaining / denom.value);
      if (count > 0) {
        result.push({ ...denom, count });
        remaining -= count * denom.value;
      }
    }
    return result;
  };

  // Action handlers with sound effects + bet sizing memory
  const handleAction = useCallback((type, amount) => {
    hasSentActionRef.current = true; // mark action sent — stops auto-fold timer race
    // Also clear any queued pre-action so the useEffect can't double-fire
    // a conflicting action (e.g., user tapped Call but had Check/Fold
    // queued — without this, pre-action would fold them). 2026-04-22.
    setPreAction(null);
    switch (type) {
      case 'fold':  haptic(200);              playSound('fold');  break;
      case 'check': haptic(50);               playSound('check'); break;
      case 'call':  haptic(80);               playSound('bet');   break;
      case 'raise': haptic([50, 30, 50]);     playSound('bet');   break;
      case 'allIn': haptic([100,50,200]);     playSound('allin'); break;
      default: break;
    }
    // Remember raise as % of pot for bet sizing memory
    if (type === 'raise' && amount && pot > 0) {
      lastRaisePctRef.current = amount / pot;
    }
    // Upgrade 4: track last raise amount for replay button
    if (type === 'raise' && amount) {
      lastRaiseRef.current = amount;
    }
    // Upgrade 7: save bet sizing memory
    if (type === 'raise' && amount) {
      betMemoryRef.current = amount;
      if (pot > 0) {
        sessionStorage.setItem('poker_last_raise_pct', (amount / pot).toFixed(2));
      }
    }
    sendAction(type, amount);
  }, [sendAction, playSound, pot]);

  // R1 (TABLEUI-2) — ONE two-step fold shared by the Fold button and the
  // swipe-left gesture: the first tap / swipe arms it ("Fold? Tap again", 3s),
  // the second folds. A gesture fold never skips the confirm the button has.
  // Returns 'armed' | 'folded' | 'ignored'.
  const requestFold = useCallback(() => {
    // Audit fix #12: dedupe — if an action already went out this turn, ignore.
    if (hasSentActionRef.current) return 'ignored';
    if (!foldPendingRef.current) {
      foldPendingRef.current = true;
      setFoldPending(true);
      // Sit & Go fix-all C4 — folding when checking is free: the armed button
      // says "Checking is free" (a second tap within 3 s still folds), so no
      // path folds a free hand in one tap.
      setFoldFreeArmed(foldIsFree(callAmount, { isAof, aofFreeCheck }));
      clearTimeout(foldTimerRef.current);
      foldTimerRef.current = setTimeout(() => {
        foldPendingRef.current = false;
        setFoldPending(false);
        setFoldFreeArmed(false);
      }, 3000);
      return 'armed';
    }
    clearTimeout(foldTimerRef.current);
    foldPendingRef.current = false;
    setFoldPending(false);
    setFoldFreeArmed(false);
    handleAction('fold');
    return 'folded';
  }, [handleAction, callAmount, isAof, aofFreeCheck]);
  gestureActRef.current = { handleAction, requestFold };

  // Time Bank handler (Upgrade 5)
  const handleTimeBank = useCallback(() => {
    if (timeBankRef.current <= 0 || timeBankActive) return;
    const bankTime = Math.min(timeBankRef.current, 30);
    timeBankRef.current -= bankTime;
    setTimeBankLeft(timeBankRef.current);
    setTimeBankActive(true);
    // Add bank time to countdown
    setTimeLeft(prev => prev + bankTime);
    // Deactivate after bank time used up
    setTimeout(() => setTimeBankActive(false), bankTime * 1000);
  }, [timeBankActive]);

  // Reload hotkeys when settings panel closes
  useEffect(() => {
    if (!hotkeyOpen) {
      setHotkeys(loadHotkeys());
    }
  }, [hotkeyOpen]);

  // Keyboard shortcuts (using customizable hotkeys).
  // Guards, in order:
  //  1. Input/textarea focused → user is typing, don't fire actions.
  //  2. Any contenteditable element focused → same reasoning.
  //  3. `chatOpen` true AND event target is inside chat panel → focus trap.
  //  4. Escape ALWAYS handled regardless of turn — closes any open modal.
  //  5. On touch devices with an external BT keyboard, require a chord key
  //     (Ctrl/Alt/Meta/Shift) to avoid accidental taps on the on-screen
  //     keyboard triggering fold/call by coincidence. (Re-uses the
  //     isTouchDevice flag declared earlier in the component.)
  const handleKeyDown = useCallback((e) => {
    // #3: Escape always closes an open raise slider or all-in confirm first.
    if (e.key === 'Escape') {
      if (showRaiseSlider) {
        setShowRaiseSlider(false);
        e.preventDefault();
        return;
      }
      if (showAllInConfirm) {
        setShowAllInConfirm(false);
        e.preventDefault();
        return;
      }
    }
    // #4: focus trap — input/textarea/contentEditable suppress hotkeys.
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.target?.isContentEditable) return;

    if (!isMyTurn) return;
    // (a draw round: the draw bar's own controls only — F130 / G169)
    if (drawRoundRef.current) return;

    // #7: touch device + no modifier → ignore. Physical BT keyboard users
    // almost always type with modifiers for chorded commands, so this is a
    // cheap way to skip the stray taps while still letting power users hit
    // Ctrl+F for fold, Cmd+C for call, etc. if they want.
    if (isTouchDevice && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return;

    // Audit fix #12: if we've already sent an action this turn, don't fire
    // another one on a double-press. Pairs with the fold-button click guard.
    if (hasSentActionRef.current) return;

    // Audit fix #22: build a priority-ordered map of hotkey → action handler
    // so that remapping multiple actions to the same key is deterministic
    // (check/call wins, then raise, then all-in, then fold) AND doesn't
    // fire TWO actions on one keystroke. Previous if/else chain would only
    // ever fire the first branch anyway, but without telling the user that
    // their fold+call-on-same-key remap was a silent no-op.
    const key = e.key;
    const handlers = [
      ['checkCall', () => {
        e.preventDefault();
        // Gameplay audit F107 — All-In-or-Fold: the server refuses a call, so
        // the key does nothing there (never an all-in in disguise) — except a
        // free check where its server takes one (aofFreeCheck).
        if (isAof && !aofFreeCheck) return;
        // Audit fix #6: on a free street, the configured check/call key
        // ALREADY routed to check — but a user remapping "F" to both fold
        // and checkCall used to fold a free card. Now we unify the fold key
        // on free streets to also check, matching the Fold button's click
        // behavior before we hid it.
        if (callAmount === 0) handleAction('check');
        else handleAction('call');
      }],
      ['raise', () => {
        // F12 / F41 / F107 — only when the server lets him raise, to its cap.
        if (!raiseControlsOk) return;
        const amt = (typeof raiseAmount === 'number' && raiseAmount >= minRaiseTotal)
          ? snapRaiseToStep(raiseAmount)
          : minRaiseTotal;
        handleAction('raise', amt);
      }],
      ['allIn', () => {
        // F12 — betting not reopened to him (or the fixed-limit cap is
        // reached): the server would only call.
        if (allInMode === 'hidden') {
          addToast(allInHiddenText(callAmount), 'info', 3500);
          return;
        }
        handleAction('allIn');
      }],
      ['fold', () => {
        // Free street → treat fold key as check (mirrors the now-hidden
        // Fold button's old click behavior so keyboard + UI agree).
        // F107 — at All-In-or-Fold with no check (an older server): on a
        // free street the key is the Fold button's two-step fold (never a
        // one-key fold of a free hand). Where Check is offered it checks.
        if (callAmount === 0) {
          if (isAof && !aofFreeCheck) requestFold();
          else handleAction('check');
          return;
        }
        handleAction('fold');
      }],
    ];
    const seen = new Set();
    for (const [name, fn] of handlers) {
      const k = hotkeys[name];
      if (!k) continue;
      if (seen.has(k)) continue; // dedupe: if two actions share a key, first wins
      seen.add(k);
      if (key === k) { fn(); return; }
    }
  }, [isMyTurn, handleAction, requestFold, callAmount, raiseAmount, hotkeys, showRaiseSlider, showAllInConfirm, isTouchDevice, minRaiseTotal, raiseControlsOk, snapRaiseToStep, isAof, aofFreeCheck, allInMode, addToast]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Chat send handler — strips HTML-ish sequences before sending. React escapes
  // on render too (text nodes, no dangerouslySetInnerHTML), but we defense-in-
  // depth here so the server never sees raw `<script>` or data: URIs.
  const handleSendChat = useCallback((message) => {
    if (!message || !message.trim()) return;
    const sanitized = message
      .trim()
      .replace(/<[^>]*>/g, '')          // strip HTML tags
      .replace(/javascript:/gi, '')     // strip inline script scheme
      .replace(/data:\s*text\/html/gi, '') // strip html data URIs
      .slice(0, 200);                   // enforce server cap client-side too
    if (!sanitized) return;
    sendChat(sanitized);
    setChatInput('');
  }, [sendChat]);

  const handleChatKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendChat(chatInput);
    }
  }, [chatInput, handleSendChat]);

  // Sync color blind mode from sessionStorage changes.
  //
  // Previously this block ran a 2s setInterval polling sessionStorage, which
  // burned CPU / kept the tab non-idle every 2s for the entire session just to
  // detect an occasional settings toggle. Replaced with an event-driven listener:
  //
  //   - 'storage' event: cross-tab sessionStorage mutations
  //   - 'poker:settings-changed' custom event: same-tab mutations (dispatch this
  //     from every `sessionStorage.setItem('app_poker_settings', ...)` call site)
  //
  // TODO(perf): dispatch window.dispatchEvent(new Event('poker:settings-changed'))
  // at the write sites (currently GameHUD.jsx ~line 1827 `quickShowdown` useEffect
  // and SettingsPanel.jsx STORAGE_KEY setter). Until both write sites emit the
  // event, a 30s stopgap poll remains so a toggle eventually propagates to this
  // instance; 30s is 15× cheaper than the previous 2s cadence.
  useEffect(() => {
    const handleStorage = () => {
      try {
        const raw = sessionStorage.getItem('app_poker_settings');
        if (raw) setColorBlindMode(JSON.parse(raw).colorBlindMode || false);
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('poker:settings-changed', handleStorage);
    // Stopgap fallback poll — 30s (was 2s). Remove once all write sites dispatch
    // the 'poker:settings-changed' event.
    const interval = setInterval(handleStorage, 30000);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('poker:settings-changed', handleStorage);
      clearInterval(interval);
    };
  }, []);

  // Touch gestures — R1 (TABLEUI-2, 2026-10-11). The listeners used to sit on
  // the .hud root, whose only tappable parts are its CONTROLS (the felt is a
  // separate layer under it), so tapping Options / Sit Out / Back / a toggle /
  // the raise label / a gap between buttons sent CALL or CHECK, and a quick drag
  // of the raise slider sent FOLD — even on a free street. Now:
  //   - a gesture starts ONLY on the table felt (gestureStartAllowed), never on
  //     a button, input, seat, the top bar, the Options menu, the raise slider
  //     group or anything drawn over the felt; not while the Options menu is
  //     open (that tap just closes it); one finger only; once per turn;
  //   - swipe left on a free street CHECKS (never folds a free card);
  //   - swipe left facing a bet goes through the SAME two-step confirm as the
  //     Fold button (requestFold): the first swipe arms "Fold?", a second swipe
  //     (or a tap on Fold) within 3s folds.
  // Handlers read everything through refs, so they never re-register.
  const handleTouchStart = useCallback((e) => {
    touchStartRef.current = null;
    if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null; }
    if (!isTouchDevice || !isMyTurnRef.current) return;
    if (drawRoundRef.current) return;                       // a draw round: no betting gestures
    if (!e.touches || e.touches.length !== 1) return;     // pinch / two fingers: never an action
    if (optionsOpenRef.current) return;                     // this tap only closes the Options menu
    if (hasSentActionRef.current) return;                   // already acted this turn
    const touch = e.touches[0];
    if (!gestureStartAllowed(e.target, touch.clientX, touch.clientY)) return; // bare felt only
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    // Hold (500ms, no movement) — open the raise slider when a raise is legal.
    touchTimerRef.current = setTimeout(() => {
      touchTimerRef.current = null;
      if (!touchStartRef.current || !isMyTurnRef.current || !canRaiseRef.current) return;
      touchStartRef.current = null;
      setShowRaiseSlider(true);
    }, 500);
  }, [isTouchDevice]);

  const handleTouchMove = useCallback(() => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  const handleTouchCancel = useCallback(() => {
    if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null; }
    touchStartRef.current = null;
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || !isMyTurnRef.current || hasSentActionRef.current || drawRoundRef.current) return;
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const { handleAction: act, requestFold: fold } = gestureActRef.current;
    if (!act || !fold) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const dt = Date.now() - start.time;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const free = callAmountRef.current === 0;
    // Gameplay audit F107 — All-In-or-Fold: no call gestures (the server
    // refuses a call); swipe left is the two-step fold. A free check is a
    // check there too where its server takes one (aofFreeCheck).
    const aof = aofRef.current && !(free && aofFreeCheckRef.current);
    // Tap — check (free) or call
    if (dt < 200 && absDx < 15 && absDy < 15) {
      if (aof) return;
      flashGesture(free ? 'check' : 'call');
      act(free ? 'check' : 'call');
      return;
    }
    // Horizontal swipe — left: fold (two-step) or CHECK on a free street;
    // right: check / call
    if (absDx > 60 && absDx > absDy * 1.5 && dt < 500) {
      if (dx < 0) {
        if (free && !aof) { flashGesture('check'); act('check'); return; }
        const r = fold();
        if (r === 'armed') flashGesture('foldArm');
        else if (r === 'folded') flashGesture('fold');
      } else {
        if (aof) return;
        flashGesture(free ? 'check' : 'call');
        act(free ? 'check' : 'call');
      }
      return;
    }
    // Swipe UP — open raise slider (only when a raise is legal)
    if (dy < -70 && absDy > absDx * 1.5 && dt < 500 && canRaiseRef.current) {
      flashGesture('raise');
      setShowRaiseSlider(true);
    }
  }, [flashGesture]); // stable — reads turn / call amount / handlers via refs

  // Show gesture hint on first mobile visit
  useEffect(() => {
    if (!isTouchDevice) return;
    const hintKey = 'poker3d_gestureHintShown';
    try {
      if (!sessionStorage.getItem(hintKey)) {
        setShowGestureHint(true);
        sessionStorage.setItem(hintKey, 'true');
        const timer = setTimeout(() => setShowGestureHint(false), 5000);
        return () => clearTimeout(timer);
      }
    } catch { /* ignore */ }
  }, [isTouchDevice]);

  // Attach touch event listeners — R1: on the document (a touch on the felt is
  // NOT inside .hud); gestureStartAllowed decides whether a touch is a gesture.
  useEffect(() => {
    if (!isTouchDevice) return undefined;
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchCancel);
      if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null; }
    };
  }, [isTouchDevice, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel]); // stable refs — won't re-register

  // Phase display label
  const phaseLabel = {
    WaitingForPlayers: 'Waiting for Players',
    PreFlop: 'Pre-Flop',
    Flop: 'Flop',
    Turn: 'Turn',
    River: 'River',
    Showdown: 'Showdown',
    HandComplete: 'Hand Complete',
    // Draw game phases
    Deal: 'Deal',
    Bet1: 'Betting Round 1',
    Draw1: 'Draw 1',
    Bet2: 'Betting Round 2',
    Draw2: 'Draw 2',
    Bet3: 'Betting Round 3',
    Draw3: 'Draw 3',
    Bet4: 'Betting Round 4',
    // Stud game phases
    ThirdStreet: '3rd Street',
    FourthStreet: '4th Street',
    FifthStreet: '5th Street',
    SixthStreet: '6th Street',
    SeventhStreet: '7th Street',
  }[phase] || phase;

  // R2 (S1, ECON-8) — a VOLUNTARY leave from a Spin & Go forfeits the entry
  // (a prize format: the stack is never cashed). While the game is on and he
  // still has chips, every way off the table asks first.
  const [quickGameOverTable, setQuickGameOverTable] = useState(null);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onOver = (d) => { if (d && d.tableId != null) setQuickGameOverTable(String(d.tableId)); };
    socket.on('quickGameOver', onOver);
    return () => socket.off('quickGameOver', onOver);
  }, []);
  const spinGoEntryLive = gameState?.tableKind === 'spingo' && seatedHere && !!myPlayer
    && !myPlayer.eliminated && (myPlayer.chipCount ?? 0) > 0
    && quickGameOverTable !== String(gameState?.tableId);

  // R2 (S1, TOURNEY-9) — his tournament started while he plays THIS table: the
  // server dealt his tournament seat in absent (`tournamentSeatKept` with
  // `atStart: true`; App.jsx keeps it as an away seat). Offer to go there:
  // leave this table, then Return to the tournament seat.
  const [tourneyStartOffer, setTourneyStartOffer] = useState(null);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onKept = (d) => {
      if (!d || d.atStart !== true || d.tableId == null) return;
      setTourneyStartOffer({
        tournamentId: d.tournamentId != null ? String(d.tournamentId) : null,
        tableId: String(d.tableId),
        name: typeof d.tournamentName === 'string' && d.tournamentName.trim() ? d.tournamentName.trim() : 'Your tournament',
      });
    };
    socket.on('tournamentSeatKept', onKept);
    return () => socket.off('tournamentSeatKept', onKept);
  }, []);
  const goToTournamentSeat = useCallback(() => {
    const offer = tourneyStartOffer;
    if (!offer) return;
    const inLiveHand = phase && phase !== 'WaitingForPlayers' && phase !== 'HandComplete' && phase !== 'Showdown';
    if (onTournamentSeat) {
      const ok = typeof window !== 'undefined' && window.confirm(`Go to ${offer.name}? Your seat at this tournament stays in play while you are away.`);
      if (!ok) return;
      leaveTournamentSeatToLobby('lobby', gameState);
      leaveTable();
    } else if (seatedHere) {
      const parts = ['Leave this table and take your tournament seat?'];
      parts.push(spinGoEntryLive ? 'Leaving forfeits your Spin & Go entry.' : 'Your chips here go back to your balance.');
      if (inLiveHand) parts.push('Your hand here will be folded.');
      const ok = typeof window !== 'undefined' && window.confirm(parts.join(' '));
      if (!ok) return;
      leaveTable();
    } else if (isSpectating || gameState?.isSpectator === true) {
      stopSpectating();
    }
    setTourneyStartOffer(null);
    setScreen('lobby');
    const entry = offer.tournamentId ? awaySeatOfTournament(offer.tournamentId) : null;
    const key = entry ? awaySeatKey(entry) : null;
    // (the leave first reaches the server; the lobby's Return banner shows the
    // answer and offers Return again if it is refused)
    setTimeout(() => { returnToTournament(key).catch(() => { /* answered in the store */ }); }, 700);
  }, [tourneyStartOffer, phase, onTournamentSeat, seatedHere, spinGoEntryLive, isSpectating, gameState, leaveTable, stopSpectating, setScreen]);

  const handleBackToLobby = useCallback(() => {
    // 2026-10-10 (S2) — a LIVE tournament seat: say what leaving means (the
    // seat stays in play, auto-folded, until he returns) before leaving.
    // Gameplay audit F139 — answers what happened (the browser / Android Back
    // button runs this too): 'dialog' | 'stayed' | 'left'.
    if (onTournamentSeat) {
      setTournamentLeaveVia('lobby');
      return 'dialog';
    }
    // R2 (S1) — a Spin & Go in play: leaving forfeits the entry (one confirm,
    // which also covers a hand in progress).
    if (spinGoEntryLive) {
      const ok = typeof window !== 'undefined' && window.confirm('Leaving forfeits your Spin & Go entry. Leave anyway?');
      if (!ok) return 'stayed';
      leaveTable();
      setScreen('lobby');
      return 'left';
    }
    // R2 (TABLEUI-15) — a SPECTATOR has nothing at stake: no forfeit confirm
    // (`!!undefined === false` made every watcher confirm "forfeit any chips
    // already in the pot"), and 'stopSpectating' — 'leaveTable' is a no-op on
    // the server for a watcher, which stayed subscribed to the table's room.
    if (isSpectating || gameState?.isSpectator === true || !isSeated) {
      if (isSpectating || gameState?.isSpectator === true) stopSpectating();
      else leaveTable();
      setScreen('lobby');
      return 'left';
    }
    // Audit fix #10: require confirmation mid-hand so a misclick doesn't
    // abandon a live decision and auto-fold at the server. Waiting /
    // complete / showdown states leave without asking (nothing at stake).
    const inLiveHand = phase && phase !== 'WaitingForPlayers' && phase !== 'HandComplete' && phase !== 'Showdown';
    const mySeatObj = gameState?.seats?.[yourSeat];
    // Gameplay audit F148 (2026-10-21) — an ALL-IN seat at a ring table keeps
    // its hand on the server when he leaves (paid at the hand's end), so it
    // is not told it forfeits the pot; elsewhere the old texts stay.
    const confirmText = leaveConfirmText({
      inLiveHand: !!inLiveHand, isMyTurn, seat: mySeatObj, rebuyAllowed: rebuyAllowedFlag(gameState),
    });
    if (confirmText) {
      const ok = typeof window !== 'undefined' && window.confirm(confirmText);
      if (!ok) return 'stayed';
    }
    leaveTable();
    setScreen('lobby');
    return 'left';
  }, [leaveTable, setScreen, phase, gameState, yourSeat, isMyTurn, onTournamentSeat, isSpectating, isSeated, stopSpectating, spinGoEntryLive]);
  // Gameplay audit F139 (2026-10-21) — the browser / Android Back button on
  // the table runs this same Back to Lobby (App.jsx popstate; services/
  // tableBack): it used to switch screens only, leaving the seat dealt in.
  const backToLobbyRef = useRef(handleBackToLobby);
  useEffect(() => { backToLobbyRef.current = handleBackToLobby; }, [handleBackToLobby]);
  useEffect(() => setTableBackHandler(() => backToLobbyRef.current()), []);

  // S2 — the player confirmed leaving his LIVE tournament seat: the lobby
  // remembers it ("Return to tournament"), then the socket leaves the table
  // (poker-server keeps the seat in play, absent — never stood up or cashed).
  const confirmTournamentLeave = useCallback(() => {
    const via = tournamentLeaveVia === 'customizer' ? 'customizer' : 'lobby';
    setTournamentLeaveVia(null);
    leaveTournamentSeatToLobby(via, gameState);
    leaveTable();
    setScreen(via);
  }, [tournamentLeaveVia, gameState, leaveTable, setScreen]);

  const isWaiting = phase === 'WaitingForPlayers' || phase === 'HandComplete';
  // 2026-10-22 — the server's OPTIONAL tournament clock (null / absent on a
  // cash table and on an older server: then nothing below changes). A held
  // tournament table (prestart, break, director pause) shows why instead of
  // "Waiting for players…" and offers no "Deal now" (the server refuses it:
  // 'tournament_hand_held').
  // Review fix-up: only on a table whose gameState says isTournament (the
  // server ALWAYS sends it, false on cash — a merged clock the server left out
  // after a move to a cash table never renders), and a 'tournamentResumed'
  // event newer than the clock frame ends the held state (resumedClock).
  const rawTournamentClock = gameState?.tournamentClock;
  const isTournamentState = gameState?.isTournament;
  const tournamentResumedAt = useTournamentClockStore((s) => (
    gameState?.tournamentId != null ? s.resumedAt[String(gameState.tournamentId)] : undefined));
  const tournamentView = useMemo(
    () => tableTournamentClock({ isTournament: isTournamentState, tournamentClock: rawTournamentClock }, tournamentResumedAt),
    [isTournamentState, rawTournamentClock, tournamentResumedAt],
  );
  const tournamentClock = tournamentView.clock;
  const showTournamentClock = tournamentView.show;
  const tournamentHeld = tournamentView.held;
  const isShowdown = phase === 'Showdown';
  const lastHandHistory = handHistories.length > 0 ? handHistories[handHistories.length - 1] : null;
  // Sit & Go fix-all C5 — his own newest hand (pure, probed: utils/handLog).
  const ownLastHand = useMemo(() => lastOwnHandOf(handHistories), [handHistories]);
  const winnerSeatSet = handResult ? new Set((handResult.winners ?? []).map((w) => w.seatIndex)) : new Set();

  // Normalize the in-memory hand-history buffer into the shape SessionRecap's
  // "Hand of the Session" reducer expects ({ pot, cards, result }). Records
  // store pots as pots[].amount and hole cards as {rank, suit-index}; convert
  // hero (yourSeat) cards to the string glyph form CardGlyph parses (e.g. 'Ah').
  const recapHandHistory = useMemo(() => {
    // Suit index -> single letter used by SessionRecap.CardGlyph (0=h,1=d,2=c,3=s)
    const SUIT_IDX_TO_LETTER = { 0: 'h', 1: 'd', 2: 'c', 3: 's' };
    const cardToStr = (c) => {
      if (!c || typeof c.rank === 'undefined') return null;
      const letter = SUIT_IDX_TO_LETTER[c.suit] ?? '';
      return `${serverRankDisplay(c.rank)}${letter}`;
    };
    return handHistories
      .map((h) => {
        if (!h || !Array.isArray(h.players)) return null;
        const pot = Array.isArray(h.pots) ? h.pots.reduce((s, p) => s + (p?.amount || 0), 0) : 0;
        const hero = h.players.find((p) => p.seatIndex === yourSeat);
        const cards = hero && Array.isArray(hero.holeCards)
          ? hero.holeCards.map(cardToStr).filter(Boolean)
          : [];
        const heroWon = Array.isArray(h.winners) && hero
          ? h.winners.some((w) => w.seatIndex === hero.seatIndex)
          : undefined;
        return {
          pot,
          cards,
          result: heroWon === undefined ? undefined : (heroWon ? 'win' : 'loss'),
          handNumber: h.handNumber,
        };
      })
      .filter(Boolean);
  }, [handHistories, yourSeat]);

  // Timer percentage for circular indicator
  // R2 (P3) — against the table's real turn length (fast mode is shorter).
  // G169 — the clock on screen (the draw clock in a draw round).
  const turnSecs = Math.max(1, Math.ceil((clockTimeout || 30000) / 1000));
  const timerPct = (timeLeft / turnSecs) * 100;
  const timerDanger = timeLeft <= 5;

  // Quick chat presets
  // QUICK_CHATS is a module-level constant above

  // Card rendering helper for overlays
  const renderMiniCard = (card, highlight = false) => (
    <span
      className={`mini-card ${highlight ? 'mini-card-highlight' : ''}`}
      style={{ color: getCardColor(card.suit, colorBlindMode) }}
      key={`${card.rank}-${card.suit}`}
    >
      {serverRankDisplay(card.rank)}{SUIT_INDEX_TO_SYMBOL[card.suit]}
    </span>
  );

  // Check if a card is in the best five
  const isInBestFive = (card, bestFive) => {
    if (!bestFive || bestFive.length === 0) return false;
    return bestFive.some((c) => c.rank === card.rank && c.suit === card.suit);
  };

  return (
    <div className={`hud ${liveTableCount >= 2 ? 'hud--tabs' : 'hud--no-tabs'}`}>
      {/* 2026-10-10 (S2) — leaving a LIVE tournament seat keeps it in play. */}
      {tournamentLeaveVia && (
        <TournamentLeaveDialog
          name={tournamentSeat?.name}
          via={tournamentLeaveVia}
          onStay={() => setTournamentLeaveVia(null)}
          onLeave={confirmTournamentLeave}
        />
      )}
      {/* ── Winner Banner ── */}
      {winnerBanner && (
        <div className={`winner-banner${winnerBannerFading ? ' winner-banner-out' : ''}`}>
          {winnerBanner.lines.length === 1 ? (
            // Single winner — compact inline format
            <>
              <span className="winner-banner-name">{winnerBanner.lines[0].name}</span>
              <span> wins </span>
              <span className="winner-banner-amount">+{winnerBanner.lines[0].amount.toLocaleString()}</span>
              {winnerBanner.lines[0].handName && winnerBanner.lines[0].handName !== 'Won by fold' && (
                <span className="winner-banner-hand"> — {winnerBanner.lines[0].handName}</span>
              )}
            </>
          ) : (
            // Multi-pot — stacked lines
            <div className="winner-banner-multipot">
              {winnerBanner.lines.map((line, i) => (
                <div key={i} className="winner-banner-pot-line">
                  <span className="winner-banner-pot-name">{line.potName}:</span>
                  <span className="winner-banner-name"> {line.name}</span>
                  <span> </span>
                  <span className="winner-banner-amount">+{line.amount.toLocaleString()}</span>
                  {line.handName && line.handName !== 'Won by fold' && (
                    <span className="winner-banner-hand"> — {line.handName}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Verify Deck chip — shows when the server has revealed this hand's
              seed so the player can inspect the provably-fair proof. Previously
              the ProvablyFair overlay was only reachable via a deeply-nested
              toolbar button; most users never saw that it existed. */}
          {deckRevelation && (
            <button
              type="button"
              className="winner-banner-verify"
              onClick={(e) => { e.stopPropagation(); setShowProvablyFair(true); }}
              style={{
                marginLeft: 10, padding: '2px 10px', borderRadius: 999,
                background: 'rgba(120, 160, 255,0.12)', color: '#ffd24a',
                border: '1px solid rgba(120, 160, 255,0.35)',
                fontSize: '0.75rem', cursor: 'pointer',
              }}
            >
              🔐 Verify Deck
            </button>
          )}
        </div>
      )}

      {/* Top bar */}
      <div className="hud-top">
        <button className="hud-back" onClick={handleBackToLobby}>
          Back to Lobby
        </button>
        {/* Duplicate-audit #10: Training mode is a dedicated practice
            mode that changes AI behavior + shows coaching tips. Users
            enabled it via Options but had no visible indicator they
            were in it — easy to forget. Small glowing pill next to
            Back button so it's always visible but unobtrusive. Click
            to turn it back off. */}
        {/* R2 (TABLEUI-10) — the badge is the training panel's DOCK: it shows
            the hand's equity and opens / minimizes the panel (which has its
            own close = turn training off). It used to turn training off. */}
        {/* 2026-10-23 — never at a qualifier table (help tools off). */}
        {trainingEnabled && !helpToolsOff && (
          <button
            className={`hud-training-badge${trainingPanelOpen ? ' hud-training-badge--open' : ''}`}
            onClick={() => setTrainingPanelOpen(!trainingPanelOpen)}
            title={trainingPanelOpen ? 'Minimize the training panel' : 'Open the training panel'}
            aria-expanded={trainingPanelOpen}
            aria-label={`Training mode on${trainingEquityPct !== null ? `, ${trainingEquityPct}% equity` : ''}. ${trainingPanelOpen ? 'Minimize' : 'Open'} the training panel`}
          >
            🎓 <span className="hud-training-badge__label">Training</span>
            {trainingEquityPct !== null && <span className="hud-training-badge__eq">{trainingEquityPct}%</span>}
          </button>
        )}
        <div className="hud-center-info">
          <div className="hud-pot">
            <span className="hud-pot-dot">●</span> Pot: <span className={potFlashing ? 'hud-pot-amount--flash' : ''}>{pot.toLocaleString()}</span>
            {anteAmount > 0 && (
              <span className="hud-ante-badge">Ante: {anteAmount.toLocaleString()}</span>
            )}
            {/* SPR badge (#3) — 2026-10-23: not at a qualifier table (help tools off). */}
            {!helpToolsOff && pot > 0 && myChips > 0 && phase !== 'WaitingForPlayers' && (() => {
              const spr = myChips / pot;
              // R3 (K1-7) — no red: short SPR is blue (amber is mid).
              const sprColor = spr < 3 ? '#60a5fa' : spr < 8 ? '#f59e0b' : '#4ade80';
              return <span className="spr-badge" style={{ color: sprColor }}>SPR {spr.toFixed(1)}</span>;
            })()}
            {/* Side pot breakdown — shown only when 2+ pots exist (all-in situation) */}
            {(() => {
              const pots = gameState?.pots;
              if (!pots || pots.length < 2) return null;
              return (
                <div className="side-pot-row">
                  {pots.map((p, i) => (
                    <span key={p.name} className={`side-pot-pill ${i === 0 ? 'side-pot-pill--main' : 'side-pot-pill--side side-pot-pill--new'}`}>
                      {p.name}: {p.amount.toLocaleString()}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
          {/* 2026-10-22 — the tournament's level clock (m:ss, ticking locally
              from levelEndsAt) + standings line, when the server sends
              tournamentClock; else the old blind level timer (#4), in m:ss. */}
          {showTournamentClock ? (
            <TournamentClockStrip clock={tournamentClock} />
          ) : gameState?.blindLevel && gameState?.nextBlindIn > 0 && (
            <div className="blind-level-timer">
              <div className="blind-level-bar">
                <div className="blind-level-bar-fill" style={{
                  width: `${Math.min(100, (gameState.nextBlindIn / (gameState.blindLevelDuration || 600)) * 100)}%`,
                  // R3 (K1-7) — no red: the last 30s are amber, the 30-60s gold.
                  background: gameState.nextBlindIn < 30 ? '#f59e0b' : gameState.nextBlindIn < 60 ? '#ffd24a' : '#4ade80',
                }} />
              </div>
              <span className="blind-level-label">Level {gameState.blindLevel} · Next in {formatSecondsClock(gameState.nextBlindIn)}</span>
            </div>
          )}
          <div className="hud-phase" data-phase={phaseLabel}>
            {dcTruthful && (
              <span className="dealers-choice-label">
                {dealersChoiceVariant.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            )}
            {!dcTruthful && variantName !== "Texas Hold'em" && (
              <span style={{ color: '#ffd24a', marginRight: '6px', fontSize: '0.75rem' }}>
                {variantName}
              </span>
            )}
            {phaseLabel}
            <span className="hud-blinds-info">
              {blindsLineText({ sb: handLevel.sb || 25, bb: bigBlind, ante: anteAmount })}
              {handLevel.next && (
                <span className="hud-blinds-next"> · {nextLevelText(handLevel)}</span>
              )}
            </span>
            {dcTruthful && dealersChoiceNext && (
              <span className="dealers-choice-next">
                Next: {dealersChoiceNext.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            )}
          </div>
        </div>
        <div className="hud-player">
          {/* Connection status dot */}
          <span
            className={`conn-dot conn-dot--${connStatus}`}
            title={connStatus === 'connected' ? 'Connected'
              : connStatus === 'reconnecting' ? 'Reconnecting…'
              : connStatus === 'error' ? 'Connection problem — retrying…'
              : connStatus === 'failed' ? 'Connection lost — tap to reconnect'
              : 'Disconnected'}
          />
          {/* Sit Out quick-access button — R2 (P3): a seat's control, never
              shown to a spectator (who also has no name / 0-chip stack here). */}
          {seatedHere && (
          <button
            className={`sit-out-quick-btn ${sittingOutHere ? 'sit-out-quick-btn--active' : ''}`}
            onClick={toggleSitOut}
            /* Round 6 (P-j) — at a TOURNAMENT table sitting out = absent: the
               seat stays dealt in, posts its blinds and is auto-acted (P-i).
               Round 7 (Z11): said in visible text too (tournament-sitout-note). */
            title={onTournamentSeat
              ? (sittingOutHere
                ? `Sitting Out — you are still dealt in: your blinds are posted and ${TOURNAMENT_SEAT_AWAY_ACTS_TEXT}. Click to return`
                : `Sit Out (you stay dealt in: your blinds are posted and ${TOURNAMENT_SEAT_AWAY_ACTS_TEXT})`)
              : (sittingOutHere ? 'Sitting Out — click to return' : 'Sit Out (auto-fold each hand)')}
          >
            {sittingOutHere ? '🪑 Sitting Out' : '🪑 Sit Out'}
          </button>
          )}

          {/* ⋯ Options dropdown — contains Sit Out, Training, and all settings */}
          <div className="hud-options-wrapper" ref={optionsRef}>
            <button
              className={`hud-icon-btn ${showOptions ? 'hud-icon-btn-active' : ''} ${sittingOutHere ? 'hud-icon-btn-sitout' : ''}`}
              onClick={() => setShowOptions(!showOptions)}
              title="Table Options"
            >
              ⋯
              <span className="icon-btn-label">Options</span>
            </button>
            {showOptions && (
              <div className="hud-options-dropdown">
                {/* Duplicate-audit #3: Sit Out row removed — the quick-access
                    "🪑 Sit Out" button directly above the Options gear
                    already toggles the same `sittingOut` state. Leaving
                    both rendered was confusing redundant UI. */}
                {/* Training row. 2026-10-23 (owner: "Turn all off") — at a
                    qualifier table every help tool is off: one line says so
                    in its place (blue / gold), and Training, Range Chart,
                    Equity Calc, the hand-reading Analysis tools and Coach
                    Mode are not offered below. */}
                {helpToolsOff ? (
                  <div className="options-help-off-note" role="note">
                    {QUALIFIER_HELP_TOOLS_OFF_TEXT}
                  </div>
                ) : (
                <div className="options-row">
                  <span className="options-label">🎓 Training</span>
                  <button
                    className={`options-toggle ${trainingEnabled ? 'options-on' : 'options-off'}`}
                    onClick={toggleTraining}
                  >{trainingEnabled ? 'ON' : 'OFF'}</button>
                </div>
                )}
                <div className="options-divider" />
                <div className="options-row">
                  <span className="options-label">Auto Deal</span>
                  <button
                    className={`options-toggle ${autoDeal ? 'options-on' : 'options-off'}`}
                    onClick={() => setAutoDeal(!autoDeal)}
                  >{autoDeal ? 'ON' : 'OFF'}</button>
                </div>
                <div className="options-row">
                  <span className="options-label">Fast Mode</span>
                  <button
                    className={`options-toggle ${fastMode ? 'options-on' : 'options-off'}`}
                    onClick={toggleFastMode}
                  >{fastMode ? 'ON' : 'OFF'}</button>
                </div>
                <div className="options-row">
                  <span className="options-label">Quick Show</span>
                  <button
                    className={`options-toggle ${quickShowdown ? 'options-on' : 'options-off'}`}
                    onClick={() => setQuickShowdown(!quickShowdown)}
                  >{quickShowdown ? 'ON' : 'OFF'}</button>
                </div>
                {/* R1 (contract #2) — not offered where the server refuses rebuys. */}
                {rebuyOptionShown && (
                <div className="options-row options-row--auto-rebuy">
                  <span className="options-label">Auto Rebuy</span>
                  <button
                    className={`options-toggle ${autoRebuy ? 'options-on' : 'options-off'}`}
                    onClick={() => setAutoRebuy(!autoRebuy)}
                  >{autoRebuy ? 'ON' : 'OFF'}</button>
                </div>
                )}
                <div className="options-divider" />
                {/* R2 (C11) — offered only where the server runs bomb pots. */}
                {canBombPot && (
                <button className="options-action-btn options-bomb"
                  onClick={() => {
                    const socket = getSocket();
                    // F156 — the table on screen (multi-table), else the main seat.
                    if (socket?.connected) socket.emit('triggerBombPot', { tableId: tableScope(useTableStore.getState().currentTableId) });
                    // A fresh bomb pot should actually show its banner
                    // even if the user previously dismissed a stale one.
                    setBombPotUserDismissed(false);
                    setShowOptions(false);
                  }}>
                  💣 Bomb Pot
                </button>
                )}
                {/* Hard dismiss for the banner. Forces local suppression
                    regardless of whatever the server-side flag says.
                    R2 — offered while there is a bomb pot banner to dismiss. */}
                {isBombPot && (
                <button className="options-action-btn options-bomb-dismiss"
                  onClick={() => { setBombPotSuppressed(true); setShowOptions(false); }}>
                  ✕ Dismiss Bomb Pot Banner
                </button>
                )}
                {!helpToolsOff && (
                <button className="options-action-btn" onClick={() => { setShowRangeChart(true); setShowOptions(false); }}>
                  📊 Range Chart
                </button>
                )}
                {!helpToolsOff && (
                <button className="options-action-btn" onClick={() => { setShowEquityCalc(true); setShowOptions(false); }}>
                  🔢 Equity Calc
                </button>
                )}
                <button className="options-action-btn" onClick={() => { setShowAchievements(true); setShowOptions(false); }}>
                  🏆 Achievements
                </button>
                {/* R2 (APPUI-16) — the replay's way in on a phone (the Last Hand
                    rail button is hidden on touch screens). */}
                {lastHandHistory && (
                  <button className="options-action-btn options-last-hand" onClick={() => {
                    // C5 — while spectating, his own last hand (the bust hand).
                    setReplayRecord(isSpectating ? ownLastHand : null);
                    setShowReplay(true);
                    setShowOptions(false);
                  }}>
                    🃏 Last hand replay
                  </button>
                )}
                <div className="options-divider" />
                {/* Sound volume (#8) */}
                <div className="options-row options-row--volume">
                  <span className="options-label">{sfxVolume === 0 ? '🔇' : sfxVolume < 0.5 ? '🔉' : '🔊'} Sound</span>
                  <div className="options-volume-wrap">
                    <input
                      type="range" min="0" max="1" step="0.05"
                      value={sfxVolume}
                      onChange={e => setSfxVolume(parseFloat(e.target.value))}
                      className="options-volume-slider"
                    />
                    <span className="options-volume-pct">{Math.round(sfxVolume * 100)}%</span>
                  </div>
                  <span className="options-volume-label">{readSoundPrefs().muted ? 'Muted in Settings' : sfxVolume === 0 ? 'Muted' : sfxVolume < 0.3 ? 'Low' : sfxVolume < 0.7 ? 'Medium' : 'Loud'}</span>
                </div>
                {/* Keyboard shortcuts (#9) — read-only reference list */}
                <button className="options-action-btn" onClick={() => { setShowShortcuts(true); setShowOptions(false); }}>
                  ⌨️ Shortcuts
                </button>
                {/* Hotkey Settings — moved here from the standalone floating
                    ⚙ gear per user request. Opens the editable HotkeySettings
                    panel where each action's key can be remapped. */}
                <button
                  className="options-action-btn"
                  onClick={() => { setHotkeyOpen(true); setShowOptions(false); }}
                >
                  ⚙ Hotkey Settings
                </button>
                {/* Pre-action queue — formerly on the floating ⋯ MoreSheet,
                    now a compact 3-pill row inline in Options. Each chip
                    toggles its pre-action (click-again to clear). Active
                    pill gets a cyan ring to mirror the Queue badge pattern
                    the MoreSheet used. */}
                <div className="options-queue-row" role="radiogroup" aria-label="Queue next action">
                  <span className="options-label">⚡ Queue Action</span>
                  <div className="options-queue-chips">
                    {[
                      { key: 'fold',      icon: '🚫', label: 'Fold' },
                      { key: 'checkFold', icon: '🔄', label: 'Check/Fold' },
                      { key: 'callAny',   icon: '✋', label: 'Call Any' },
                      { key: 'checkOnly', icon: '✓', label: 'Check' },
                    // F107 — at an All-In-or-Fold table: Fold (+ Check/Fold
                    // and Check where its server takes a free check)
                    ].filter(({ key }) => preActionKeys.includes(key)).map(({ key, icon, label }) => {
                      const active = preAction === key;
                      return (
                        <button
                          key={key}
                          role="radio"
                          aria-checked={active}
                          className={`options-queue-chip ${active ? 'options-queue-chip--active' : ''}`}
                          // C4 — a queued Fold checks when checking is free.
                          title={key === 'fold' ? QUEUED_FOLD_TITLE : undefined}
                          onClick={() => setPreAction(active ? null : key)}
                        >
                          <span className="options-queue-icon">{icon}</span>
                          <span className="options-queue-label">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {preAction && (
                    <button
                      className="options-action-btn"
                      onClick={() => setPreAction(null)}
                      style={{ marginTop: 4, fontSize: '0.68rem', color: '#93C5FD' }}
                    >✕ Clear queued action</button>
                  )}
                </div>
                {/* Table felt theme picker. Four swatches inline — tap
                    to apply. Driven via the `poker:set-theme` window
                    event so PokerTable2D (sibling) picks up the change
                    without prop-drilling. Matches the emoji-picker
                    plumbing. Active swatch gets a cyan ring. */}
                <div className="options-theme-row" role="radiogroup" aria-label="Table felt color">
                  <span className="options-label">🎨 Table Felt</span>
                  <div className="options-theme-swatches">
                    {/* R2 (C7) — the theme equipped in the shop (myTheme). */}
                    {equippedFelt && (
                      <button
                        role="radio"
                        aria-checked={equippedFeltShown}
                        className={`options-theme-swatch options-theme-swatch--equipped ${equippedFeltShown ? 'options-theme-swatch--active' : ''}`}
                        title={`Your theme: ${equippedFelt.name}`}
                        aria-label={`Your theme: ${equippedFelt.name}`}
                        style={{ background: equippedFelt.felt }}
                        onClick={() => {
                          setFeltPickedFor(undefined);
                          window.dispatchEvent(new CustomEvent('poker:set-theme', { detail: { key: 'equipped' } }));
                        }}
                      >{equippedFeltShown ? '✓' : '★'}</button>
                    )}
                    {[
                      { key: 'blue',    label: '🔵 Speed',    preview: 'linear-gradient(135deg, #1a3a6e, #0f2447)' },
                      { key: 'green',   label: '🟢 Classic',  preview: 'linear-gradient(135deg, #2e7d52, #1a5438)' },
                      { key: 'black',   label: '⬛ Midnight', preview: 'linear-gradient(135deg, #0c1a44, #0d0d1a)' },
                      // R3 (K1-7) — no red: key 'crimson' kept (saved picks), drawn ocean-teal.
                      { key: 'crimson', label: '🌊 Ocean',    preview: 'linear-gradient(135deg, #1b7187, #0d3a48)' },
                    ].map(({ key, label, preview }) => {
                      const active = !equippedFeltShown && (sessionStorage.getItem('app_poker_theme') || 'blue') === key;
                      return (
                        <button
                          key={key}
                          role="radio"
                          aria-checked={active}
                          className={`options-theme-swatch ${active ? 'options-theme-swatch--active' : ''}`}
                          title={label}
                          style={{ background: preview }}
                          onClick={() => {
                            // R2 (C7) — a pick here wins over the equipped theme it was made against.
                            setFeltPickedFor(myThemeId);
                            window.dispatchEvent(new CustomEvent('poker:set-theme', { detail: { key, over: myThemeId } }));
                            /* Don't close the Options menu — let the user
                               compare themes live. Close with the gear
                               toggle or tap outside when satisfied. */
                          }}
                        >{active ? '✓' : ''}</button>
                      );
                    })}
                  </div>
                </div>
                {/* Pick Avatar Emoji — quick in-game seat-emoji swap.
                    The picker itself lives inside PokerTable2D (it needs
                    the hero emoji state + sessionStorage wiring); we open
                    it here via a window CustomEvent so GameHUD doesn't
                    need to prop-drill into a sibling component. */}
                <button
                  className="options-action-btn"
                  onClick={() => {
                    setShowOptions(false);
                    window.dispatchEvent(new CustomEvent('poker:open-emoji-picker'));
                  }}
                >
                  😀 Pick Avatar Emoji
                </button>
                {/* R2 (TABLEUI-14) — the multi-table "+" lives here while only one
                    seat is live (the tab bar shows from two seats on). */}
                {/* R2 review (K1-3) — never while a Spin & Go entry is live: Back
                    to Lobby from the extra table would forfeit the Spin & Go seat
                    without its forfeit warning (that check reads the table shown). */}
                {seatedHere && !onTournamentSeat && liveTableCount < 2 && !spinGoEntryLive && (
                  <button
                    className="options-action-btn options-open-table"
                    onClick={() => {
                      setShowOptions(false);
                      window.dispatchEvent(new Event(OPEN_TABLE_PICKER_EVENT));
                    }}
                  >
                    ➕ Open another table
                  </button>
                )}
                {/* Customize Avatar — moved into Options per user request.
                    AvatarCustomizer is a full-screen 3D view (Canvas +
                    OrbitControls), not an overlay, so clicking it leaves
                    the table. Same confirmation pattern as Back to Lobby
                    for mid-hand exits so a stray tap doesn't auto-fold
                    a live hand. */}
                <button
                  className="options-action-btn"
                  onClick={() => {
                    // S2 — a LIVE tournament seat: the same explanation as
                    // Back to Lobby before the table screen is left.
                    if (onTournamentSeat) {
                      setShowOptions(false);
                      setTournamentLeaveVia('customizer');
                      return;
                    }
                    const inLiveHand = phase && phase !== 'WaitingForPlayers'
                      && phase !== 'HandComplete' && phase !== 'Showdown';
                    const mySeatObj = gameState?.seats?.[yourSeat];
                    const chipsAtRisk = (mySeatObj?.currentBet || 0) > 0;
                    if (spinGoEntryLive) {
                      // R2 (S1) — leaving a Spin & Go in play forfeits the entry.
                      const ok = typeof window !== 'undefined'
                        && window.confirm('Customize avatar? Leaving the table forfeits your Spin & Go entry.');
                      if (!ok) return;
                    } else if (inLiveHand && (isMyTurn || chipsAtRisk)) {
                      const ok = typeof window !== 'undefined'
                        && window.confirm('Customize avatar? You\'ll leave the table and your hand will be auto-folded.');
                      if (!ok) return;
                    }
                    setShowOptions(false);
                    leaveTable();
                    setScreen('customizer');
                  }}
                >
                  🧑 Customize Avatar
                </button>

                {/* ─────────────────────────────────────────────────
                    Advanced tools — moved in from the floating
                    .adv-toolbar per user request. Same three collapsible
                    groups (Analysis / Coach / Live), same toggles, same
                    state. `toolbarGroups` kept as the open/close store.
                    ───────────────────────────────────────────────── */}
                <div className="options-adv-section">
                  {/* Analysis group — range matrix, heatmaps, GTO, provably fair */}
                  <button
                    className={`options-adv-header ${toolbarGroups.analysis ? 'options-adv-header--open' : ''}`}
                    onClick={() => setToolbarGroups(g => ({ ...g, analysis: !g.analysis }))}
                  >📊 Analysis Tools {toolbarGroups.analysis ? '▾' : '▸'}</button>
                  {/* 2026-10-23 — at a qualifier table only Predict Winner and
                      Provably Fair (neither reads his hand) stay here. */}
                  {toolbarGroups.analysis && (
                    <div className="options-adv-grid">
                      {!helpToolsOff && <button className={`options-adv-btn ${showRangeViz ? 'active' : ''}`} onClick={() => setShowRangeViz(v => !v)}>🎯 Range Matrix</button>}
                      {!helpToolsOff && <button className={`options-adv-btn ${showHeatmap ? 'active' : ''}`} onClick={() => setShowHeatmap(v => !v)}>🌡 Equity Heatmap</button>}
                      {!helpToolsOff && <button className={`options-adv-btn ${showTimingTells ? 'active' : ''}`} onClick={() => setShowTimingTells(v => !v)}>⏱ Timing Tells</button>}
                      <button className={`options-adv-btn ${showSpectatorPredict ? 'active' : ''}`} onClick={() => setShowSpectatorPredict(v => !v)}>🔮 Predict Winner</button>
                      {!helpToolsOff && <button className={`options-adv-btn ${gtoVisible ? 'active' : ''}`} onClick={() => setGtoVisible(v => !v)}>📈 GTO Overlay</button>}
                      {!helpToolsOff && <button className={`options-adv-btn ${showGTOSolver ? 'active' : ''}`} onClick={() => setShowGTOSolver(v => !v)}>♟ GTO Solver</button>}
                      <button className="options-adv-btn" onClick={() => setShowProvablyFair(true)}>🔐 Provably Fair</button>
                    </div>
                  )}

                  {/* Coach group — AI rail, commentary, pause-and-coach, post-hand review.
                      2026-10-23 — the whole group is off at a qualifier table. */}
                  {!helpToolsOff && (
                  <button
                    className={`options-adv-header ${toolbarGroups.coach ? 'options-adv-header--open' : ''}`}
                    onClick={() => setToolbarGroups(g => ({ ...g, coach: !g.coach }))}
                  >🧠 Coach Mode {toolbarGroups.coach ? '▾' : '▸'}</button>
                  )}
                  {toolbarGroups.coach && !helpToolsOff && (
                    <div className="options-adv-grid">
                      <button className={`options-adv-btn ${showCoachingRail ? 'active' : ''}`} onClick={() => setShowCoachingRail(v => !v)}>🧠 AI Coach Rail</button>
                      <button className={`options-adv-btn ${showCommentary ? 'active' : ''}`} onClick={() => setShowCommentary(v => !v)}>🎓 Table Commentary</button>
                      <button className={`options-adv-btn ${showPauseCoach ? 'active' : ''}`} onClick={() => setShowPauseCoach(v => !v)} disabled={!isMyTurn}>⏸ Pause & Coach</button>
                      <button className="options-adv-btn" onClick={() => setShowPostHandCoach(true)} disabled={!lastHandHistory}>🤖 Post-Hand Review</button>
                    </div>
                  )}

                  {/* Live group — voice chat, streaming, prediction market, share hand */}
                  <button
                    className={`options-adv-header ${toolbarGroups.live ? 'options-adv-header--open' : ''}`}
                    onClick={() => setToolbarGroups(g => ({ ...g, live: !g.live }))}
                  >📡 Live & Social {toolbarGroups.live ? '▾' : '▸'}</button>
                  {toolbarGroups.live && (
                    <div className="options-adv-grid">
                      <button className={`options-adv-btn ${showVoiceChat ? 'active' : ''}`} onClick={() => setShowVoiceChat(v => !v)}>🎙 Voice Chat</button>
                      <button className={`options-adv-btn ${showStream ? 'active' : ''}`} onClick={() => setShowStream(v => !v)}>📺 Go Live</button>
                      <button className={`options-adv-btn ${showPredictionMarket ? 'active' : ''}`} onClick={() => setShowPredictionMarket(v => !v)}>🎲 Prediction Market</button>
                      <button className="options-adv-btn" onClick={() => setShowShareReplay(true)} disabled={!lastHandHistory}>🔗 Share Hand</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {seatedHere ? (
            <>
              <span className="hud-name">{safeName(playerName, '')}</span>
              {/* Chip stack visual */}
              <div className={`hud-chip-stack ${myChips >= 5000 ? 'chip-deep' : myChips >= 1500 ? 'chip-mid' : 'chip-short'}`}>
                <span className="chip-coins">
                  {myChips >= 5000 ? '🪙🪙🪙' : myChips >= 1500 ? '🪙🪙' : '🪙'}
                </span>
                <span className="chip-amount">{myChips.toLocaleString()}</span>
              </div>
            </>
          ) : (
            <span className="hud-spectator-tag">Watching</span>
          )}
        </div>
      </div>

      {/* Table vignette */}
      <div className="table-vignette" />

      {/* Phase transition banner */}
      {phaseBanner && (
        <div className="phase-banner">
          <span className="phase-banner-text">{phaseBanner}</span>
        </div>
      )}

      {/* Bomb Pot Banner — only during live hand phases. Without the
          phase guard, a stale server-side bombPot flag (e.g. table went
          idle before the flag cleared) would leave the banner flashing
          forever at the top of the screen. */}
      {/* Bomb pots skip preflop and play Flop -> Turn -> River. Anything
          else (PreFlop / WaitingForPlayers / HandComplete / Showdown)
          with bombPot=true is stale state leaking across hands — don't
          flash the banner. */}
      {isBombPot && (phase === 'Flop' || phase === 'Turn' || phase === 'River') && (
        <div className="bomb-pot-banner">
          BOMB POT!
        </div>
      )}

      {/* Active player indicator — rendered inside hud-bottom (see below) */}

      {/* Community cards display (center of screen, above table) */}
      {communityCards.length > 0 && (
        <div className="hud-community">
          {communityCards.map((card, i) => {
            const isWinCard = winningCardIndices && winningCardIndices.communityIndices.includes(i);
            return (
              <div
                key={i}
                className={`community-card ${isWinCard ? 'card-winner-glow' : ''}`}
                style={{ color: getCardColor(card.suit, colorBlindMode), position: 'relative' }}
                onMouseEnter={() => setHoveredCardIdx(i)}
                onMouseLeave={() => setHoveredCardIdx(null)}
              >
                <span className="card-rank">{serverRankDisplay(card.rank)}</span>
                <span className="card-suit">{SUIT_INDEX_TO_SYMBOL[card.suit]}</span>
                {/* 2026-10-23 — no outs / texture popup at a qualifier table. */}
                {hoveredCardIdx === i && !helpToolsOff && (outsInfo || boardTexture) && (
                  <div className="card-hover-popup">
                    {outsInfo && outsInfo.outs > 0 && (
                      <>
                        <div className="chp-row"><span className="chp-label">Outs</span><span className="chp-val">{outsInfo.outs}</span></div>
                        <div className="chp-row"><span className="chp-label">Next</span><span className="chp-val">{outsInfo.nextCardPct}%</span></div>
                        {phase === 'Flop' && <div className="chp-row"><span className="chp-label">River</span><span className="chp-val">{outsInfo.byRiverPct}%</span></div>}
                        {outsInfo.draws.slice(0,2).map(d => <div key={d} className="chp-draw">{d}</div>)}
                      </>
                    )}
                    {boardTexture && boardTexture.labels.length > 0 && (
                      <div className="chp-texture">{boardTexture.labels.join(' · ')}</div>
                    )}
                    {!outsInfo?.outs && (!boardTexture || boardTexture.labels.length === 0) && (
                      <div className="chp-texture">No draw info</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {/* Board Texture Badge — color-coded. Gated on live phase so it
              doesn't linger during WaitingForPlayers / new-hand preload (where
              the memo still has cached labels from the previous board).
              2026-10-23 — not at a qualifier table (help tools off). */}
          {!helpToolsOff && boardTexture && boardTexture.labels.length > 0 &&
           (phase === 'Flop' || phase === 'Turn' || phase === 'River' || phase === 'Showdown' || phase === 'HandComplete') && (
            <div className={`board-texture-badge ${
              boardTexture.labels.some(l => l === 'Monotone') ? 'board-texture--monotone' :
              boardTexture.labels.some(l => l === 'Paired') ? 'board-texture--paired' :
              boardTexture.labels.some(l => /flush|straight|draw/i.test(l) || l === 'Two-tone') ? 'board-texture--wet' :
              'board-texture--dry'
            }`}>
              {boardTexture.labels.join(' / ')}
            </div>
          )}
        </div>
      )}

      {/* Side-pot breakdown panel removed — the compact .side-pot-row
          pills next to the phase label already surface Main Pot / Side
          Pot N totals, and this floating panel was pure duplication. */}

      {/* Chopped Pot Display (#19) */}
      {gameState?.isChoppedPot && gameState?.chopDetails && (phase === 'Showdown' || phase === 'HandComplete') && (
        <div className="chop-pot-banner">
          <div className="chop-pot-title">Split Pot!</div>
          <div className="chop-pot-shares">
            {(gameState.chopDetails || []).map((d, i) => (
              <span key={i} className="chop-pot-share">
                {safeName(d.playerName, 'Player')}: {(Number(d.share) || 0).toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* All-in Equity Display (#17). Worker results are sanitized before
          render — NaN/fractional/negative/oversized values all coerce to a
          valid 0-100 integer. Previously a broken worker response could paint
          "NaN%" or "45.77777777%" directly into the badge. */}
      {equityResults && Object.keys(equityResults).length > 0 && (
        <div className="equity-badges-container">
          {seats.map((seat, i) => {
            if (!seat || seat.state !== 'occupied' || seat.folded || equityResults[i] === undefined) return null;
            const raw = Number(equityResults[i]);
            const pct = Number.isFinite(raw) ? Math.round(Math.max(0, Math.min(100, raw))) : 0;
            return (
              <div key={i} className="equity-badge" title={`${safeName(seat.playerName, 'Player')}: ${pct}% equity`}>
                <span className="equity-player-name">{safeName(seat.playerName, 'Player')}</span>
                <span className="equity-pct">{pct}%</span>
              </div>
            );
          })}
        </div>
      )}

      {/* AFK Warning Banner */}
      {afkWarning && !isAFK && (
        <div className="afk-warning-banner">
          <span className="afk-warning-icon">⚠️</span>
          <span>You'll be marked away in <strong>{afkWarningSecs}s</strong> due to inactivity</span>
          <button className="afk-warning-dismiss" onClick={() => setAfkWarning(false)}>I'm here</button>
        </div>
      )}

      {/* AFK "You're Away" indicator. Round 7 (Z11): at a TOURNAMENT seat
          the seat stays dealt in and is checked when a check is free, else
          folded (P-i / P-j) — never "auto-folded". Cash tables unchanged. */}
      {isAFK && (
        <div className={`afk-away-banner${onTournamentSeat ? ' afk-away-banner--tournament' : ''}`}>
          <span>🌙</span>
          <span>{onTournamentSeat ? `You're away — you stay dealt in: ${TOURNAMENT_SEAT_AWAY_ACTS_TEXT}.` : "You're away — hands will be auto-folded"}</span>
          <button className="afk-back-btn" onClick={() => {
            emitAwayAll('playerBack');
            setAfkWarning(false);
          }}>I'm back</button>
        </div>
      )}

      {/* Round 7 (Z11) — Sit Out at a TOURNAMENT seat, said in VISIBLE text
          (the button's title is hover-only, never seen on a phone): the seat
          stays dealt in, posts its blinds and is checked or folded (P-j /
          P-i). Blue, never red. Cash tables keep the plain button. */}
      {onTournamentSeat && sittingOutHere && !isAFK && (
        <div className="afk-away-banner afk-away-banner--tournament tournament-sitout-note" role="status">
          <span>🪑</span>
          <span>{`Sitting out — you stay dealt in: your blinds are posted and ${TOURNAMENT_SEAT_AWAY_ACTS_TEXT}.`}</span>
          {/* Review (round 7): 'playerBack' ALWAYS means "not sitting out" (safe
              to repeat) — a toggle could sit him OUT when the local flag was stale. */}
          <button className="afk-back-btn" onClick={() => {
            // F156 — this table's seat (multi-table: named), else the main seat.
            const st = useTableStore.getState();
            const scope = tableScope(st.currentTableId);
            getSocket()?.emit('playerBack', scope === undefined ? {} : { tableId: scope });
            try {
              st.setSittingOut(false);
              if (scope !== undefined) st.patchTableState(scope, { sittingOut: false });
            } catch { /* ignore */ }
          }}>I'm back</button>
        </div>
      )}

      {/* Missed Blinds Button — audit refactor.
          Previously hidden during PreFlop/Flop/Turn/River/Showdown, which
          meant it was hidden for ~95% of the time a hand was in progress,
          and specifically hidden exactly when the player needed to post
          to re-enter (TDA Rule 6-10 violation: "player cannot receive
          cards until dead blind is posted"). Now visible in EVERY phase
          as long as they owe, and the button shows a clear disabled state
          when chips are insufficient rather than silently failing. */}
      {missedBlindsAmount > 0 && !sittingOutHere && (
        <div className="missed-blinds-panel">
          <div className="missed-blinds-text">
            {missedBlindsType === 'both'
              ? 'You missed both blinds while sitting out.'
              : missedBlindsType === 'small'
                ? 'You missed your small blind while sitting out.'
                : 'You missed your big blind while sitting out.'}
            <small style={{ display: 'block', opacity: 0.75, marginTop: 2 }}>
              Post to re-enter the rotation. Dead money — doesn't count toward any call.
            </small>
          </div>
          <button
            className="action-btn deal"
            disabled={myChips < missedBlindsAmount}
            onClick={() => {
              const socket = getSocket();
              if (!socket?.connected) return;
              if (myChips < missedBlindsAmount) {
                try { addToast('Not enough chips — rebuy first, then post.', 'error', 3000); } catch {}
                return;
              }
              // F156 — the table on screen (multi-table), else the main seat.
              socket.emit('postMissedBlinds', { tableId: tableScope(useTableStore.getState().currentTableId) });
            }}
            style={{ fontSize: '0.85rem' }}
            aria-label={`Post dead blinds of ${missedBlindsAmount.toLocaleString()} chips to re-enter the hand rotation${myChips < missedBlindsAmount ? ' — not enough chips' : ''}`}
          >
            {myChips < missedBlindsAmount
              ? `Need ${(missedBlindsAmount - myChips).toLocaleString()} more chips`
              : `Post Blinds: ${missedBlindsAmount.toLocaleString()}`}
          </button>
        </div>
      )}

      {/* Bottom action bar */}
      {/* Duplicate-audit #6: Mini pot pill removed — the top-bar .hud-pot
          (line ~2451) already shows the pot amount in large friendly
          numbers, always visible. Two floating pots showing the same
          number above each other was pure redundancy. Side-pot labels
          are still surfaced via the .side-pot-breakdown chip row. */}

      <div className={`hud-bottom ${isMyTurn ? 'hud-bottom--my-turn' : ''}`}>
        {/* Turn timer progress bar — thin strip at very top of action bar */}
        {clockOn && (
          <div className="action-timer-strip">
            <div
              className={`action-timer-strip-fill ${timeLeft <= 5 ? 'action-timer-strip--danger' : ''}`}
              style={{ width: `${Math.max(0, Math.min(100, timerPct))}%` }}
            />
          </div>
        )}

        {/* LEFT: turn timer pill + hand strength meter */}
        <div className="hud-bottom-left">
          {/* Hand strength identifier moved out of the action bar to a
              portal-mounted pill above the table — see
              `hand-strength-portal` render further down. Keeping this slot
              intentionally empty preserves the action bar's flex layout so
              the centre column stays centred. */}
          {/* Timer fully on nameplates — no HUD timer elements */}
        </div>

        {/* CENTRE: action buttons panel */}
        <div className="hud-bottom-panel">
        {/* Player's hole cards */}
        {isPineapple && pineappleDiscardActive && yourCards.length === 3 && (
          <div
            style={{
              position: 'absolute',
              top: '-28px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '4px 12px',
              background: pineappleDiscardIndex != null
                ? 'rgba(16, 185, 129, 0.95)'
                : 'linear-gradient(90deg, #f59e0b, #d97706)',
              color: '#0f172a',
              fontSize: '12px',
              fontWeight: 700,
              borderRadius: '999px',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              zIndex: 10,
            }}
          >
            {pineappleDiscardIndex != null
              ? '✓ Card marked — click another to change'
              : '⚠️ Pick one card to discard'}
          </div>
        )}
        {/* 2026-10-23 — the starting-hand tier glow is a hint: not at a qualifier table. */}
        <div className={`hud-cards hud-cards-floating ${isMyTurn ? 'hud-cards-active' : ''} ${holeCardCount >= 4 ? 'hud-cards-many' : ''} ${preflopTier && !helpToolsOff ? `hud-cards-tier-${preflopTier}` : ''} ${cardsDealt ? 'hud-cards--dealt' : ''}`}>
          {yourCards.length > 0 ? (
            yourCards.map((card, i) => {
              // Gameplay audit G172 / F134 — a discard selection is drawn only
              // while he can still draw this round (a stale one never raises
              // cards in a betting round or the next hand).
              const isSelected = (canDrawNow && selectedDiscards.includes(i)) || (isPineapple && pineappleDiscardIndex === i);
              const isSmall = holeCardCount >= 4;
              const isWinHoleCard = winningCardIndices && winningCardIndices.holeIndices.includes(i);

              // For stud games, show face-up indicator
              const studInfo = gameState?.yourCardVisibility?.[i];
              const isFaceUp = studInfo?.faceUp;

              // Card click: (1) draw-game discard toggle, (2) pineapple discard choice
              const canPineappleDiscard = isPineapple && pineappleDiscardActive && yourCards.length === 3;
              let cardClick;
              let cardTitle = 'Hover to peek';
              if (hasDrawPhase && isDrawPhase) {
                // F134 — only while he still owes this round's draw (not
                // folded, not already drawn; an all-in seat draws too): the
                // server refuses the rest.
                if (canDrawNow) {
                  cardClick = () => toggleDiscard(i);
                  cardTitle = isSelected ? 'Click to keep' : 'Click to discard';
                }
              } else if (canPineappleDiscard) {
                cardClick = () => {
                  setPineappleDiscardIndex(i);
                  const socket = getSocket();
                  // (tableId: the table on screen in multi-table mode — an
                  // older server ignores it and uses the main seat)
                  socket?.emit('selectPineappleDiscard', { cardIndex: i, tableId: useTableStore.getState().currentTableId || undefined });
                };
                cardTitle = isSelected ? 'Marked to discard — click another to change' : 'Click to discard this card';
              }

              return (
                <div
                  key={`${card.rank}-${card.suit}-${i}`}
                  className={`card-peek ${isWinHoleCard ? 'card-winner-glow' : ''}`}
                  onClick={cardClick}
                  title={cardTitle}
                  style={{
                    ...(isSelected ? { transform: 'translateY(-8px)' } : {}),
                    ...(canPineappleDiscard ? { cursor: 'pointer' } : {}),
                  }}
                >
                  <div className="card-peek-inner">
                    {/* Front face - card value */}
                    <div
                      className="card-peek-front"
                      style={{
                        color: getCardColor(card.suit, colorBlindMode),
                        // R3 (K1-7) — a selected discard is outlined gold, not red.
                        ...(isSelected ? { border: '2px solid #ffd24a', boxShadow: '0 0 8px rgba(255, 210, 74, 0.5)' } : {}),
                      }}
                    >
                      <span className="card-rank">{serverRankDisplay(card.rank)}</span>
                      <span className="card-suit">{SUIT_INDEX_TO_SYMBOL[card.suit]}</span>
                      {/* Stud: only show U/D badge on 3rd card onward — first two
                          are always hole cards and a badge there was cosmetic noise. */}
                      {isStudGame && isFaceUp !== undefined && i >= 2 && (
                        <span style={{
                          position: 'absolute',
                          top: '-4px',
                          right: '-4px',
                          fontSize: '0.5rem',
                          background: isFaceUp ? '#4ADE80' : '#666',
                          color: '#fff',
                          borderRadius: '50%',
                          width: '12px',
                          height: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          {isFaceUp ? 'U' : 'D'}
                        </span>
                      )}
                    </div>
                    {/* Back face - red/gold pattern */}
                    <div className={`card-peek-back${heroLook.cardBack ? ` ${heroLook.cardBack}` : ''}`} />
                  </div>
                </div>
              );
            })
          ) : (
            <>
              {Array.from({ length: holeCardCount }, (_, i) => (
                <div key={i} className="card-slot" style={holeCardCount >= 4 ? { width: '50px', height: '70px', fontSize: '22px' } : {}}>?</div>
              ))}
            </>
          )}
        </div>

        {/* Player nameplate — rendered from HUD (not 3D scene) so
            position:fixed works. When it's my turn, wrap it with a
            countdown ring overlay (per user request: "put my turn
            time countdown thing around my name plate instead").
            The ring is an SVG rounded-rect stroke sized 1:1 to the
            nameplate via position:absolute inset:-6. Only hero gets
            this — all other seats keep their own avatar-centric rings. */}
        {myPlayer && yourSeat >= 0 && (
          <div className={`hud-nameplate-me ${isMyTurn ? 'hud-nameplate-me--active' : ''}${heroLook.frameClass ? ` ${heroLook.frameClass}` : ''}`}>
            {heroLook.title && <span className={heroLook.titleClass}>{heroLook.title}</span>}
            {heroLook.vip && <span className="np-vip" title="VIP">VIP</span>}
            {clockOn && (() => {
              // Use the same 0–30s base as the seat-pod timer ring.
              const pct = Math.max(0, Math.min(100, timerPct));
              // R3 (K1-7) — the last 5s are blue, not red (the ring is gold).
              const danger = timeLeft <= 5;
              // Perimeter length scales with a 2:1 aspect (~220 for
              // typical nameplate width 180 × height 48; rx:10 rounds).
              // We use `pathLength="100"` so strokeDashoffset is simple
              // and works regardless of element width.
              return (
                <svg
                  className="hud-nameplate-me__timer-ring"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <rect
                    x="1" y="1" width="98" height="98" rx="10" ry="10"
                    pathLength="100"
                    fill="none"
                    stroke={danger ? '#60a5fa' : '#f5c451'}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray="100"
                    strokeDashoffset={100 - pct}
                    style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.4s' }}
                  />
                </svg>
              );
            })()}
            <div className="hud-np-avatar" style={{ background: 'linear-gradient(135deg,#1e3a8a,#0d2c53)' }}>
              {nameInitial(playerName, 'P')}
            </div>
            <div className="hud-np-info">
              <span className="hud-np-name">{safeName(playerName, '')}{heroLook.badge && <span className="np-badge" title={heroLook.badge.name}>{heroLook.badge.icon}</span>}</span>
              <span className="hud-np-chips">● {(myPlayer.chipCount ?? myPlayer.chips ?? 0).toLocaleString()} · {bigBlind > 0 ? Math.round((myPlayer.chipCount ?? myPlayer.chips ?? 0) / bigBlind) : 0}bb</span>
            </div>
            {gameState?.seatPositions?.[yourSeat] && (
              <span className="hud-np-pos">{gameState.seatPositions[yourSeat]}</span>
            )}
          </div>
        )}

        {/* Hand-strength info merged into the top-center `.hand-strength-portal`
            pill per user request ("pair of sevens queen kicker on top left
            + pair weak up top middle — combine these"). The .hand-strength-bar
            block here was the duplicate. This container is kept only for the
            Outs Counter + draws info below, which isn't shown by the pill.
            2026-10-23 — no outs counter at a qualifier table. */}
        {!helpToolsOff && showHandStrength && handStrength && (
          <div className="hand-strength-container">
            {/* Outs Counter */}
            {outsInfo && outsInfo.outs > 0 && (
              <div className="outs-display">
                <span className="outs-count">{outsInfo.outs} outs</span>
                <span className="outs-pct">({outsInfo.nextCardPct}% next{phase === 'Flop' ? ` / ${outsInfo.byRiverPct}% river` : ''})</span>
                <div className="outs-draws">
                  {outsInfo.draws.map((d) => (
                    <span key={d} className="outs-draw-tag">{d}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}


        <div className="hud-actions">
          {/* ── Always-visible action bar ── */}
          {isSpectating ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', justifyContent: 'center' }}>
              {/* Eliminated banner */}
              {eliminatedPosition && (
                <div style={{
                  // 2026-07-05 mobile audit fix: +safe-area, and lowered to clear the
                  // spectator banner above it (both show at once after a tournament bust).
                  position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 92px)', left: '50%', transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.85)', border: '1px solid #fcd34d',
                  borderRadius: 12, padding: '12px 24px', zIndex: 100, textAlign: 'center',
                }}>
                  {/* Sit & Go fix-all F7 — a paid place says its prize. */}
                  {bustBannerPrizeLine(eliminatedPosition) ? (
                    <div className="tournament-bust-prize" style={{ color: '#fcd34d', fontWeight: 800, fontSize: '1.1rem' }}>
                      {bustBannerPrizeLine(eliminatedPosition)}
                    </div>
                  ) : (
                    <div style={{ color: '#fcd34d', fontWeight: 800, fontSize: '1.1rem' }}>
                      You placed {eliminatedPosition.position}{eliminatedPosition.position === 1 ? 'st' : eliminatedPosition.position === 2 ? 'nd' : eliminatedPosition.position === 3 ? 'rd' : 'th'}
                    </div>
                  )}
                  <div style={{ color: '#888', fontSize: '0.8rem' }}>out of {eliminatedPosition.totalPlayers} players</div>
                </div>
              )}

              {/* Tournament spectator controls */}
              {tournamentSpectator && tournamentSpectator.tableIds?.length > 1 && (
                <button onClick={() => handleNextTable('prev')} style={{
                  padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer', fontWeight: 600,
                }}>Prev Table</button>
              )}

              <div style={{ color: '#ffd24a', textAlign: 'center' }}>
                <div style={{ fontWeight: 700 }}>Spectating</div>
                {/* Sit & Go fix-all C5 — his own last hand (the bust hand) stays
                    one tap away while he watches. */}
                {ownLastHand && (
                  <button
                    className="spectator-last-hand-btn"
                    onClick={() => { setReplayRecord(ownLastHand); setShowReplay(true); }}
                    style={{
                      marginTop: 4, padding: '4px 10px', borderRadius: 8, background: 'rgba(96,165,250,0.15)',
                      border: '1px solid rgba(96,165,250,0.5)', color: '#ffd24a', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem',
                    }}
                  >
                    🃏 Your last hand
                  </button>
                )}
                {/* Sit & Go fix-all C3 — the line follows the live clock (busts,
                    level-ups), not the snapshot taken when he started watching. */}
                {spectatorStatusLine && (
                  <div className="spectator-status-line" style={{ fontSize: '0.75rem', color: '#888' }}>
                    {spectatorStatusLine}
                  </div>
                )}
              </div>

              {tournamentSpectator && tournamentSpectator.tableIds?.length > 1 && (
                <button onClick={() => handleNextTable('next')} style={{
                  padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer', fontWeight: 600,
                }}>Next Table</button>
              )}
            </div>
          ) : isWaiting ? (
            /* Live-room behavior: the server auto-starts the next hand every
               12s heartbeat (and 3s after HandComplete). Players should never
               need to click a button to continue play. We show a passive
               "Starting next hand…" indicator instead, but keep a small
               manual Deal escape hatch in case the server stalls. */
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', width: '100%' }}>
              {/* 2026-10-22 — a HELD tournament table says why (cards at
                  11:00 / break / director pause) and offers no Deal now. */}
              {tournamentHeld ? (
                <TournamentHeldBanner clock={tournamentClock} />
              ) : (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 999,
                background: 'rgba(120, 160, 255,0.08)', color: '#ffd24a',
                border: '1px solid rgba(120, 160, 255,0.25)', fontSize: 13, fontWeight: 600,
              }}>
                {/* R2 (TABLEUI-17) — CSS-owned so phones / reduced motion stop it. */}
                <span className="hud-waiting-dot" aria-hidden="true" />
                {phase === 'HandComplete' ? 'Starting next hand…' : 'Waiting for players…'}
              </span>
              )}
              {!tournamentHeld && (
              <button
                className="action-btn deal"
                onClick={startHand}
                style={{
                  padding: '6px 14px', fontSize: 12, opacity: 0.55,
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.18)',
                  color: '#aaa',
                }}
                title="Force the next hand to start immediately"
              >
                Deal now
              </button>
              )}
            </div>
          ) : hasDrawPhase && isDrawPhase ? (
            /* Draw Phase — gameplay audit F134 / G169 (2026-10-21): the draw
               controls only while he still owes this round's draw (the server
               refuses a folded seat or a second draw), with the server's draw
               clock when it sends one; otherwise a passive line (never the
               betting bar: its pre-actions would queue bets mid-draw). */
            canDrawNow ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#ffd24a', fontSize: '0.85rem' }}>
                Select cards to discard ({selectedDiscards.length} selected)
              </span>
              {drawClockKnown && isMyDraw && (
                <span
                  className={`hud-draw-clock${timeLeft <= 5 ? ' hud-draw-clock--low' : ''}`}
                  aria-label={`${timeLeft} seconds left to draw`}
                  style={{ color: timeLeft <= 5 ? '#60a5fa' : '#ffd24a', fontWeight: 700, fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}
                >
                  {timeLeft}s
                </span>
              )}
              <button
                className="action-btn raise"
                onClick={handleDraw}
                style={{ background: 'linear-gradient(135deg, #A855F7, #7C3AED)' }}
              >
                {selectedDiscards.length === 0 ? 'Stand Pat' : `Discard & Draw ${selectedDiscards.length}`}
              </button>
            </div>
            ) : (
            <div className="hud-draw-waiting" style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', width: '100%' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 999,
                background: 'rgba(120, 160, 255,0.08)', color: '#ffd24a',
                border: '1px solid rgba(120, 160, 255,0.25)', fontSize: 13, fontWeight: 600,
              }}>
                <span className="hud-waiting-dot" aria-hidden="true" />
                {myPlayer?.folded ? 'You folded — waiting for the others to draw…' : 'Waiting for others to draw…'}
              </span>
            </div>
            )
          ) : (
            /* Normal betting — always rendered, disabled when not our turn */
            <>
              {/* Pre-action pills — shown above buttons while waiting (not during
                  showdown/hand end, and explicitly not for spectators). The outer
                  isSpectating branch already hides this whole block, but adding
                  the guard here too is defense-in-depth against future refactors
                  and against the case where `isSpectating` flips stale after a
                  leave-table event and the UI lingers mid-transition. */}
              {/* Audit fix #14: also suppress pre-actions whenever the server
                  has already emitted a handResult payload, which happens a
                  beat before `phase` flips to 'HandComplete'. Without this
                  co-check a click in that ~200ms race queues an illegal
                  action that the server then rejects. */}
              {!isMyTurn && !isSpectating
                && phase !== 'Showdown' && phase !== 'HandComplete'
                && !gameState?.handResult && (
                <div className="pre-action-btns">
                  <button
                    className={`pre-action-btn${preAction === 'fold' ? ' active' : ''}`}
                    title={QUEUED_FOLD_TITLE}
                    aria-label={preAction === 'fold' ? 'Cancel pre-action: auto fold' : `Queue pre-action: ${QUEUED_FOLD_TITLE}`}
                    aria-pressed={preAction === 'fold'}
                    onClick={() => setPreAction(preAction === 'fold' ? null : 'fold')}
                  >
                    <span className="pre-action-icon">🚫</span>
                    <span className="pre-action-label">Fold</span>
                  </button>
                  {/* Gameplay audit F107 — All-In-or-Fold: the server refuses
                      a call, so only Fold may be queued there — plus
                      Check/Fold and Check where its server takes a free check
                      (preActionKeysFor). */}
                  {preActionKeys.includes('checkFold') && (
                  <button
                    className={`pre-action-btn${preAction === 'checkFold' ? ' active' : ''}`}
                    aria-label={preAction === 'checkFold' ? 'Cancel pre-action: check or fold' : 'Queue pre-action: check or fold on my turn'}
                    aria-pressed={preAction === 'checkFold'}
                    onClick={() => setPreAction(preAction === 'checkFold' ? null : 'checkFold')}
                  >
                    <span className="pre-action-icon">🔄</span>
                    <span className="pre-action-label">Check/Fold</span>
                  </button>
                  )}
                  {preActionKeys.includes('callAny') && (
                  <button
                    className={`pre-action-btn${preAction === 'callAny' ? ' active' : ''}`}
                    aria-label={preAction === 'callAny' ? 'Cancel pre-action: call any' : 'Queue pre-action: call any bet on my turn'}
                    aria-pressed={preAction === 'callAny'}
                    onClick={() => setPreAction(preAction === 'callAny' ? null : 'callAny')}
                  >
                    <span className="pre-action-icon">✋</span>
                    <span className="pre-action-label">Call Any</span>
                  </button>
                  )}
                  {preActionKeys.includes('checkOnly') && (
                  <button
                    className={`pre-action-btn${preAction === 'checkOnly' ? ' active' : ''}`}
                    aria-label={preAction === 'checkOnly' ? 'Cancel pre-action: check if possible' : 'Queue pre-action: check if still free when action returns'}
                    aria-pressed={preAction === 'checkOnly'}
                    onClick={() => setPreAction(preAction === 'checkOnly' ? null : 'checkOnly')}
                  >
                    <span className="pre-action-icon">✓</span>
                    <span className="pre-action-label">Check</span>
                  </button>
                  )}
                </div>
              )}
            {/* Audit fix #19: aria-live="polite" so screen readers announce
                when the action buttons enable/disable as turn transfers. */}
            <div
              className={`hud-actions-inner ${!isMyTurn ? 'hud-actions--inactive' : ''}`}
              role="group"
              aria-label="Poker action controls"
              aria-live="polite"
            >
              {/* Single flat row: Timer | Fold | Call | presets | Raise | All-In */}
              <div className="action-bar-flat">

                {/* FOLD — instant on small bets, confirmation required for large commitments.
                    When callAmount === 0, folding is functionally a check — route to `check`
                    to save the server round-trip and avoid the "why did I fold a free card"
                    confusion when a user reflex-taps Fold on a free-check street. */}
                {/* Audit fix #6: on a free street (callAmount === 0), the
                    Fold button is redundant with the Check button rendered to
                    its right — and clicking it routed to `check` anyway,
                    which confused users ("the button says Fold but I checked").
                    Hide it entirely when there's nothing to fold. */}
                {/* Gameplay audit F107 — at an All-In-or-Fold table whose
                    server refuses Check (an older server), Fold is offered on
                    a free street too: Fold / All-In are the only actions it
                    takes. Where Check is offered (aofFreeCheck) a free street
                    is like any other table's. */}
                {(callAmount > 0 || (isAof && !aofFreeCheck)) && (
                <button
                  className={`action-btn fold ${foldPending ? 'fold-pending' : ''}`}
                  disabled={!isMyTurn}
                  aria-label={
                    !isMyTurn
                      ? 'Fold button, not your turn'
                      : foldPending && foldFreeArmed
                        ? FOLD_FREE_ARIA_TEXT
                      : foldPending
                        ? `Confirm fold by tapping again. You would give up a call of ${callShown.effectiveCall.toLocaleString()} chips.`
                        : `Fold. Call amount ${callShown.effectiveCall.toLocaleString()} chips. ${isMyTurn && timeLeft > 0 ? `Timer ${Math.round(timeLeft)} seconds remaining.` : ''}`
                  }
                  onClick={(e) => {
                    // Two-step fold, shared with the swipe-left gesture (R1):
                    // the ref-based confirm (no React batching race) + the
                    // audit fix #12 dedupe live in requestFold.
                    requestFold();
                    // Stop the event so the click can't bubble to an
                    // ancestor listener that re-routes it to another
                    // action (root-cause theory for the 2026-04-22 audit
                    // "fold became a raise" anomaly).
                    e.stopPropagation();
                  }}
                >
                  {/* Two-line layout: verb + confirm hint. When foldPending
                      is true, swap the hint to "Tap again" so the user has
                      an unambiguous next-step indicator. */}
                  <span className="action-verb">{foldPending ? 'Fold?' : 'Fold'}</span>
                  {/* Short hint — the long "Double-click to confirm fold"
                      was truncating to "Double..." after the button was
                      narrowed and moved right (2026-04-22 audit). Short
                      text avoids the ellipsis at every breakpoint. */}
                  <span className="fold-confirm-hint">
                    {foldPending ? (foldFreeArmed ? FOLD_FREE_HINT_TEXT : 'Tap again') : 'Tap 2x'}
                  </span>
                </button>
                )}

                {/* CHECK / CALL with pot odds below.
                    Gameplay audit F107 — not at an All-In-or-Fold table (the
                    server refuses a call): a note says what the table allows,
                    except on a free street where its server takes a check
                    (aofFreeCheck) — then the Check button. */}
                {isAof && !aofFreeCheck ? (
                  <span className="ab-aof-note" style={{ color: '#ffd24a', fontSize: '0.72rem', fontWeight: 700, alignSelf: 'center', whiteSpace: 'nowrap' }}>
                    All-In or Fold
                  </span>
                ) : (
                <div className="ab-call-group">
                  {callAmount === 0 ? (
                    <button
                      className={`action-btn check${aofFreeCheck ? ' ab-aof-check' : ''}`}
                      disabled={!isMyTurn}
                      aria-label={!isMyTurn ? 'Check button, not your turn' : `Check for free. ${isMyTurn && timeLeft > 0 ? `Timer ${Math.round(timeLeft)} seconds remaining.` : ''}`}
                      onClick={() => handleAction('check')}
                    >
                      Check
                    </button>
                  ) : (
                    <button
                      className="action-btn call"
                      disabled={!isMyTurn}
                      aria-label={!isMyTurn ? `Call button, not your turn. Call amount ${callShown.effectiveCall.toLocaleString()} chips${callShown.callIsAllIn ? ', all-in' : ''}.` : `Call ${callShown.callIsAllIn ? 'all-in ' : ''}${callShown.effectiveCall.toLocaleString()} chips. ${!helpToolsOff && callShown.effectivePot > 0 ? `Pot odds require ${callShown.breakEvenPct} percent equity to break even.` : ''} ${!helpToolsOff && handStrength ? `Current hand strength ${Math.round(handStrength.strength * 100)} percent.` : ''} ${isMyTurn && timeLeft > 0 ? `Timer ${Math.round(timeLeft)} seconds remaining.` : ''}`}
                      onClick={() => handleAction('call')}
                    >
                      {/* Audit fix #2 + #5: each span is a block-level stacked
                          line in CSS (.action-btn.call display: flex column)
                          so the label reads vertically:
                            Call
                            1,200
                            3:1 · 14%   Eq: 50%
                          Previously all four spans rendered inline, producing
                          `Call1,2003:1 · 14%Eq: 50%` on scan. */}
                      <span className="action-verb">Call</span>
                      {/* Gameplay audit F126 — a call above his stack commits
                          only the stack (the server makes it an all-in). */}
                      <span className="action-amount-sub">
                        {callShown.effectiveCall.toLocaleString()}
                        {callShown.callIsAllIn && <span className="action-call-allin-tag"> All-In</span>}
                      </span>
                      {/* 2026-10-23 — no odds / equity line at a qualifier table. */}
                      {!helpToolsOff && (potOddsDisplay || handStrength) && (
                        <span className="action-meta-row">
                          {potOddsDisplay && (
                            <span className="action-odds-sub">
                              {potOddsDisplay}&nbsp;·&nbsp;{callShown.breakEvenPct}%
                            </span>
                          )}
                          {handStrength ? (
                            <span className="action-equity-sub">
                              {' '}Eq&nbsp;{Math.round(handStrength.strength * 100)}%
                            </span>
                          ) : preflopTier ? (
                            /* Audit fix #8: keep the equity-like column
                               populated pre-flop so the Call button's layout
                               doesn't visually reflow when the flop hits.
                               Shows a qualitative tier ("Premium"/"Strong"/…)
                               since quantitative equity needs board cards. */
                            <span className="action-equity-sub action-equity-sub--tier">
                              {' '}{preflopTier.charAt(0).toUpperCase() + preflopTier.slice(1)}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </button>
                  )}
                  {/* Pot odds moved to table overlay */}
                </div>
                )}

                {/* PRESETS — flat text buttons. Only show when a legal raise
                    is actually possible (min ≤ max and max > 0) — otherwise
                    the player is effectively all-in-or-fold. */}
                {/* R2 — each preset carries a short label too (½ ⅔ Pot 3x):
                    phones show it so the presets share the slider's row. */}
                {isMyTurn && raiseControlsOk && (
                  <div className="ab-presets">
                    <button className="ab-preset" aria-label="Half pot" onClick={() => setRaiseAmountSafe(potFraction(1/2))}><span className="ab-preset-full">½ Pot</span><span className="ab-preset-short" aria-hidden="true">½</span></button>
                    <button className="ab-preset" aria-label="Two thirds pot" onClick={() => setRaiseAmountSafe(potFraction(2/3))}><span className="ab-preset-full">2/3 Pot</span><span className="ab-preset-short" aria-hidden="true">⅔</span></button>
                    <button className="ab-preset ab-preset--active" aria-label="Pot" onClick={() => setRaiseAmountSafe(potFraction(1))}><span className="ab-preset-full">Pot</span><span className="ab-preset-short" aria-hidden="true">Pot</span></button>
                    <button className="ab-preset ab-preset--3bb" aria-label="Three big blinds" onClick={() => setRaiseAmountSafe(Math.max(minRaiseTotal, Math.min(bigBlind * 3, maxRaise)))}><span className="ab-preset-full">3x BB</span><span className="ab-preset-short" aria-hidden="true">3x</span></button>
                  </div>
                )}

                {/* RAISE — inline slider with confirm. Hidden entirely when no
                    legal raise exists (was previously rendered as a disabled
                    slider, which confused users in all-in scenarios). */}
                {/* Gameplay audit F12 / F41 — only when the server lets him
                    raise (canRaise) and up to its cap (maxRaise). */}
                {raiseControlsOk && (
                  <div className="raise-inline-group">
                    <div className="raise-inline-slider-wrap">
                      {/* F131 — never "0": the amount the button sends */}
                      <span className="raise-inline-val">{shownRaiseAmount(raiseAmount, minRaiseTotal, maxRaise).toLocaleString()}</span>
                      <input
                        type="range"
                        min={minRaiseTotal}
                        max={maxRaise}
                        step={raiseStepSize}
                        value={Math.max(minRaiseTotal, Math.min(raiseAmount || minRaiseTotal, maxRaise))}
                        onChange={(e) => {
                          // Audit fix #17: coalesce rapid-fire drag events to
                          // the next animation frame — avoids iOS Safari stutter
                          // when the browser fires a slider onChange on every
                          // pixel of travel.
                          const v = Number(e.target.value);
                          if (window.__raiseSliderRaf) cancelAnimationFrame(window.__raiseSliderRaf);
                          window.__raiseSliderRaf = requestAnimationFrame(() => {
                            setRaiseAmountSafe(v);
                            window.__raiseSliderRaf = null;
                          });
                        }}
                        onKeyDown={(e) => {
                          // Escape blurs the slider so keyboard users aren't trapped
                          // in the range input; the global Escape handler (elsewhere
                          // in this file) also hides the slider overlay.
                          if (e.key === 'Escape' && e.currentTarget) e.currentTarget.blur();
                        }}
                        className="raise-inline-slider"
                        disabled={!isMyTurn}
                        aria-label={`Raise amount slider. Minimum ${minRaiseTotal.toLocaleString()}, maximum ${maxRaise.toLocaleString()}, current ${(raiseAmount || minRaiseTotal).toLocaleString()}.`}
                        aria-valuemin={minRaiseTotal}
                        aria-valuemax={maxRaise}
                        aria-valuenow={raiseAmount || minRaiseTotal}
                      />
                    </div>
                    {(() => {
                      // Defensive: raiseAmount is initialized to 0 and should always
                      // be a number, but a rapid re-render during `setRaiseAmount(undefined)`
                      // could briefly leave it falsy. Fall back to `minRaiseTotal` so the
                      // Raise button never renders "Raise\n(blank)".
                      // F130 — also never above the max (a size kept from an
                      // earlier street could exceed the stack left).
                      const displayAmount = shownRaiseAmount(raiseAmount, minRaiseTotal, maxRaise);
                      // F133 — an opening bet is a Bet.
                      const verbAria = raiseVerb === 'Bet' ? 'Bet' : 'Raise to';
                      return (
                        <button
                          className="action-btn raise"
                          disabled={!isMyTurn}
                          aria-label={!isMyTurn ? `${raiseVerb} button, not your turn. Amount ${displayAmount.toLocaleString()}.` : `${verbAria} ${displayAmount.toLocaleString()} chips. ${isMyTurn && timeLeft > 0 ? `Timer ${Math.round(timeLeft)} seconds remaining.` : ''}`}
                          onClick={() => handleAction('raise', displayAmount)}
                        >
                          {raiseVerb}<br />{displayAmount.toLocaleString()}
                        </button>
                      );
                    })()}
                  </div>
                )}

                {/* ALL-IN — gameplay audit F12 / F41 / F107 (2026-10-21):
                    'hidden' when the server would only turn it into a call
                    (betting not reopened: the Call button covers it); 'call'
                    at an All-In-or-Fold table (no Call button there — it
                    sends 'allIn', answered as a call); 'max' when pot / fixed
                    limit caps the bet below his stack (it raises to the cap —
                    the server clamps an 'allIn' to the same number). */}
                {allInMode === 'call' ? (
                <button
                  className="action-btn allin action-btn--aof-call"
                  disabled={!isMyTurn}
                  aria-label={!isMyTurn ? 'Call button, not your turn' : `Call ${callShown.effectiveCall.toLocaleString()} chips.`}
                  onClick={() => handleAction('allIn')}
                >
                  <span className="action-verb">Call</span>
                  <span className="action-amount-sub">{callShown.effectiveCall.toLocaleString()}</span>
                </button>
                ) : allInMode !== 'hidden' && (
                <button
                  className={`action-btn allin${allInMode === 'max' ? ' action-btn--max-raise' : ''}`}
                  disabled={!isMyTurn}
                  aria-label={!isMyTurn
                    ? (allInMode === 'max' ? 'Maximum raise button, not your turn' : 'All-in button, not your turn')
                    : allInMode === 'max'
                      ? `Raise to the maximum ${maxRaise.toLocaleString()}. ${skipAllInConfirm ? 'Confirmation skipped — single tap commits.' : 'Opens confirmation dialog.'}`
                      : `Push all ${myChips.toLocaleString()} chips all-in. ${skipAllInConfirm ? 'Confirmation skipped — single tap commits.' : 'Opens confirmation dialog.'}`}
                  onClick={() => {
                    if (skipAllInConfirm) handleAction('allIn');
                    else setShowAllInConfirm(true);
                  }}
                >
                  {/* Audit fix #20: label shows the actual shove amount so a
                      short-stack user can see "All-In 1,240" at a glance
                      rather than just "All-In" and guess the commitment.
                      F41 — at a capped table the raise-TO total of the cap. */}
                  <span className="action-verb">{allInMode === 'max' ? limits.capVerb : 'All-In'}</span>
                  {allInMode === 'max' ? (
                    <span className="action-amount-sub">{maxRaise.toLocaleString()}</span>
                  ) : myChips > 0 && (
                    <span className="action-amount-sub">{myChips.toLocaleString()}</span>
                  )}
                </button>
                )}

              </div>{/* end action-bar-flat */}

              {/* Keyboard-hint strip removed per user request — PWA users
                  have no keyboard, and desktop users who use hotkeys already
                  know them (or can open Options → Shortcuts to review). The
                  showShortcuts viewer + editable HotkeySettings both still
                  live in the Options menu, so the keybinds remain
                  discoverable without nagging the action bar each turn. */}

              {/* raise row moved to raise-panel-float below hud-bottom */}

              {/* STRADDLE — R2 (C11): when the server's `isFirstActor` says
                  this seat may straddle right now (its own turn, preflop). */}
              {isUTG && isMyTurn && (
                <button
                  className="action-btn straddle"
                  onClick={() => {
                    // (No action-sent lock: the server answers a refused
                    // straddle with nothing, which would lock the turn. A
                    // second tap is refused server-side — no longer first.)
                    const socket = getSocket();
                    if (!socket?.connected) return;
                    // F156 — the table on screen (multi-table), else the main seat.
                    socket.emit('straddle', { tableId: tableScope(useTableStore.getState().currentTableId) });
                    playSound('bet');
                  }}
                >
                  <span className="action-verb">Straddle</span>
                  <span className="action-amount-sub">{straddleAmount.toLocaleString()}</span>
                </button>
              )}

              {/* Last aggressor badge (moved out of call-with-odds wrapper) */}
              {lastAggressorInfo && (
                <span className="last-aggressor-badge">← {lastAggressorInfo.player} raised</span>
              )}

            </div>
            </>
          )}
        </div>
        </div>{/* end hud-bottom-panel */}
      </div>

      {/* Floating ⋯ More FAB + MobileMoreSheet removed per user request:
          "put the three dot menu at the bottom right into the options
          menu". The pre-action queue (the MoreSheet's only genuinely
          unique feature) is now an entry inside the top-right Options
          dropdown as "⚡ Queue Action". Last Hand / Stats / Tools were
          already reachable via the existing rail buttons + Options. */}

      {/* Hand strength identifier — moved out of the action bar per user
          feedback. Portalled into <body> so it floats above the table as a
          compact, color-coded pill ("Pair of Queens · Light") regardless of
          which element contains the HUD. Positioned top-centre of the table
          area via `.hand-strength-portal` CSS; hidden on handComplete so it
          doesn't linger on the next-hand overlay. */}
      {/* R2 (P3) — rendered INSIDE the HUD (was a <body> portal at z 180, above
          the Options menu and the all-in confirm); TableLayout.css places it
          clear of the pot and Options. */}
      {/* 2026-10-23 — at a qualifier table only the plain hand name (what he
          holds, no strength bar / tier / percent: help tools off). */}
      {helpToolsOff && handStrength && yourCards.length > 0 && !myPlayer?.folded && phase !== 'HandComplete' && (
        <div
          className="hand-strength-portal hand-strength-portal--plain"
          role="status"
          aria-live="polite"
          aria-label={`Your hand: ${handStrength.detailedName || handStrength.name}`}
        >
          <span className="hsp-label">{handStrength.detailedName || handStrength.name}</span>
        </div>
      )}
      {!helpToolsOff && handStrength && yourCards.length > 0 && !myPlayer?.folded && phase !== 'HandComplete' && (
        <div
          className={`hand-strength-portal hand-strength-portal--${
            handStrength.strength < 0.2 ? 'weak' :
            handStrength.strength < 0.4 ? 'light' :
            handStrength.strength < 0.7 ? 'medium' :
            handStrength.strength < 0.9 ? 'strong' : 'monster'
          }`}
          role="status"
          aria-live="polite"
          aria-label={`Your hand: ${handStrength.name}, ${
            handStrength.strength < 0.2 ? 'weak' :
            handStrength.strength < 0.4 ? 'light' :
            handStrength.strength < 0.7 ? 'medium' :
            handStrength.strength < 0.9 ? 'strong' : 'monster'
          } at ${Math.round(handStrength.strength * 100)} percent`}
        >
          <div className="hsp-bar">
            <div
              className="hsp-fill"
              style={{
                width: `${Math.round(handStrength.strength * 100)}%`,
                // R3 (K1-7) — no red: the weakest tier is blue (orange / yellow are taken).
                background:
                  handStrength.strength < 0.2 ? '#2563EB' :
                  handStrength.strength < 0.4 ? '#F97316' :
                  handStrength.strength < 0.7 ? '#EAB308' :
                  handStrength.strength < 0.9 ? '#22C55E' : '#FFD700',
              }}
            />
          </div>
          {/* Combined display: detailed name (e.g. "Pair of Sevens, Queen
              kicker") in place of the short name ("Pair"). The standalone
              top-left .hand-strength-container rendered the exact same
              info; now we show it only once — in this pill. */}
          <span className="hsp-label">{handStrength.detailedName || handStrength.name}</span>
          <span className="hsp-tier">
            {handStrength.strength < 0.2 ? 'Weak' :
             handStrength.strength < 0.4 ? 'Light' :
             handStrength.strength < 0.7 ? 'Medium' :
             handStrength.strength < 0.9 ? 'Strong' : 'Monster'}
          </span>
        </div>
      )}

      {/* Pot odds — on the table below "AMERICAN PUB POKER".
          Gate by phase so the badge doesn't render "Pot Odds: 0:1" on
          HandComplete (pot reset to 0 but callAmount can linger from
          the final street). 2026-04-22 audit fix.
          2026-10-23 — not at a qualifier table (its good / bad colour is advice). */}
      {!helpToolsOff && callAmount > 0 && potOddsDisplay && phase !== 'HandComplete' && phase !== 'Showdown' && phase !== 'WaitingForPlayers' && createPortal(
        <div className={`table-pot-odds ${potOddsGood ? 'table-pot-odds--good' : 'table-pot-odds--bad'}`}>
          Pot Odds: {potOddsDisplay}
        </div>,
        document.body
      )}

      {/* Action history — top-left below hand strength label */}
      {actionHistory.length > 0 && createPortal(
        <div className="action-history-floating">
          {actionHistory.slice(0, 3).map((a, i) => (
            <span key={i} className={`action-hist-item ${i === 0 ? 'action-hist-latest' : ''}${isStripBetEntry(a) ? ' action-hist-bet' : ''}`}>{a}</span>
          ))}
        </div>,
        document.body
      )}

      {/* Showdown Results Overlay */}
      {showShowdown && handResult && handResult.showdownHands && handResult.showdownHands.length > 0 && (
        <div className="showdown-overlay" onClick={() => setShowShowdown(false)}>
          <div className="showdown-panel" onClick={(e) => e.stopPropagation()}>
            <div className="showdown-title">Showdown</div>

            {/* Winners — per-pot if available, otherwise totals */}
            {/* F19 / F20 — per pot only when every pot with chips names its winners. */}
            {perPotUsable(handResult) ? (
              handResult.potBreakdown.map((pot, pi) => (
                <div key={pi} className="showdown-pot-section">
                  <div className="showdown-pot-label">{safeName(pot?.name, '') || 'Main Pot'}</div>
                  {potWinnerRows(pot).map((wa, wi) => {
                    const winnerInfo = handResult.winners.find(w => w.seatIndex === wa.seatIndex);
                    return (
                      <div key={wi} className="showdown-winner-row">
                        <div className="showdown-winner-badge">WIN</div>
                        <div className="showdown-player-name showdown-winner-name">
                          {safeName(winnerInfo?.playerName, '') || `Seat ${wa.seatIndex + 1}`}
                        </div>
                        {winnerInfo?.handName && <div className="showdown-hand-name">{winnerInfo.handName}</div>}
                        <div className="showdown-chips-won">+{(Number(wa.amount) || 0).toLocaleString()} chips</div>
                        {winnerInfo?.bestFiveCards && winnerInfo.bestFiveCards.length > 0 && (
                          <div className="showdown-best-cards">
                            {winnerInfo.bestFiveCards.map((c) => renderMiniCard(c, true))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              handResult.winners.map((winner) => (
                <div key={winner.seatIndex} className="showdown-winner-row">
                  <div className="showdown-winner-badge">WINNER</div>
                  <div className="showdown-player-name showdown-winner-name">
                    {safeName(winner.playerName, 'Player')}
                  </div>
                  <div className="showdown-hand-name">{winner.handName}</div>
                  <div className="showdown-chips-won">+{winner.chipsWon.toLocaleString()} chips</div>
                  {winner.bestFiveCards && winner.bestFiveCards.length > 0 && (
                    <div className="showdown-best-cards">
                      {winner.bestFiveCards.map((c) => renderMiniCard(c, true))}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* All showdown hands — skip rows whose holeCards haven't
                hydrated yet (client may receive the showdown envelope before
                the encrypted cards are decrypted). Variant-aware eval.
                If EVERY hand is still unhydrated we show a placeholder so the
                overlay doesn't look broken. */}
            <div className="showdown-hands">
              {handResult.showdownHands.filter(h => Array.isArray(h.holeCards) && h.holeCards.length > 0).length === 0 && (
                <div
                  className="showdown-hand-row"
                  style={{ opacity: 0.7, fontStyle: 'italic', justifyContent: 'center', padding: '16px 0' }}
                >
                  Waiting for cards to reveal…
                </div>
              )}
              {handResult.showdownHands.filter(h => Array.isArray(h.holeCards) && h.holeCards.length > 0).map((hand) => {
                const isWinner = winnerSeatSet.has(hand.seatIndex);
                // Gameplay audit F128 (2026-10-21) — the client's detailed name
                // only where its evaluator ranks like the server (Hold'em,
                // Pineapple, Omaha); Short Deck / Omaha Hi-Lo / Stud / Draw
                // show the server's name (it is the hand that was paid).
                const detailedName = showdownRowHandName(hand, communityCards, gameState, evaluateHandStrength);
                return (
                  <div
                    key={hand.seatIndex}
                    className={`showdown-hand-row ${isWinner ? 'showdown-hand-winner' : 'showdown-hand-loser'}`}
                  >
                    <div className="showdown-hand-player">{safeName(hand.playerName, 'Player')}</div>
                    <div className="showdown-hand-cards">
                      {/* Hole cards */}
                      <span className="showdown-hole-label">Hole:</span>
                      {hand.holeCards.map((c) =>
                        renderMiniCard(c, isInBestFive(c, hand.bestFiveCards))
                      )}
                    </div>
                    <div className="showdown-hand-eval">
                      {detailedName}
                    </div>
                    {/* Sit & Go fix-all F20 — his own losing hand was mucked:
                        only he sees it. */}
                    {hand.seatIndex === yourSeat && ownHandMucked(handResult, yourSeat) && (
                      <div className="showdown-own-mucked" style={{ fontSize: '0.72rem', color: '#93c5fd' }}>{OWN_MUCKED_TEXT}</div>
                    )}
                  </div>
                );
              })}
              {/* F20 — the other mucked hands: the name and "Mucked", never cards. */}
              {muckedShowdownRows(handResult, gameState?.seats, yourSeat).map((m) => (
                <div key={`muck-${m.seatIndex}`} className="showdown-hand-row showdown-hand-loser showdown-hand-mucked">
                  <div className="showdown-hand-player">{m.playerName}</div>
                  <div className="showdown-hand-eval" style={{ color: '#93c5fd' }}>{MUCKED_TEXT}</div>
                </div>
              ))}
            </div>

            <div className="showdown-dismiss">Click anywhere to dismiss</div>
          </div>
        </div>
      )}

      {/* Won by fold - show simple winner overlay */}
      {showShowdown && handResult && (!handResult.showdownHands || handResult.showdownHands.length === 0) && (
        <div className="showdown-overlay" onClick={() => setShowShowdown(false)}>
          <div className="showdown-panel showdown-panel-small">
            {handResult.winners.map((winner) => (
              <div key={winner.seatIndex} className="showdown-winner-row">
                <div className="showdown-winner-name">{safeName(winner.playerName, 'Player')}</div>
                <div className="showdown-hand-name">{winner.handName}</div>
                <div className="showdown-chips-won">+{winner.chipsWon.toLocaleString()} chips</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Show / Muck after folding */}
      {showMuckButton && yourCards.length > 0 && (
        <div className="show-muck-prompt">
          <button className="show-muck-btn show-muck-btn--show" onClick={() => {
            // F21 — shown now only if the hand is over, else at its end.
            requestShowHand();
            setShowMuckButton(false);
          }}>Show Hand</button>
          <button className="show-muck-btn show-muck-btn--muck" onClick={() => setShowMuckButton(false)}>Muck</button>
        </div>
      )}

      {/* Show hand after winning by fold (#6) */}
      {showHandPrompt && yourCards.length > 0 && (
        <div className="show-muck-prompt">
          <button className="show-muck-btn show-muck-btn--show" onClick={() => {
            // (the uncontested winner's prompt shows at hand end — sent now)
            emitShowMuckedHand(useTableStore.getState().gameState?.handNumber);
            setShowHandPrompt(false);
          }}>Show Hand</button>
          <button className="show-muck-btn show-muck-btn--muck" onClick={() => setShowHandPrompt(false)}>Muck</button>
        </div>
      )}

      {/* Mucked hand reveals from other players */}
      {muckedHands.length > 0 && (
        <div className="mucked-hands-container">
          {muckedHands.map((mh, idx) => (
            <div key={mh.addedAt ?? idx} className="mucked-hand-reveal">
              <span className="mucked-hand-player">{safeName(mh.playerName, 'Player')} shows:</span>
              <div className="mucked-hand-cards">
                {mh.cards.map((c, ci) => renderMiniCard(c, false))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rabbit Hunt button (after hand ends, player folded).
          Tracks a 20s client-side cooldown so the user can't spam requests
          (server throttles too, but silently — the button just looked broken
          between taps). Cooldown resets on next hand. */}
      {/* G171 — only a board game has a rabbit (Stud / Draw answered nothing). */}
      {phase === 'HandComplete' && playerFoldedThisHand && !rabbitCards && !showShowdown && rabbitHuntOffered(gameState) && (
        <button
          className="rabbit-hunt-btn"
          disabled={rabbitHuntCooldownUntil > Date.now()}
          style={rabbitHuntCooldownUntil > Date.now() ? { opacity: 0.55, cursor: 'default' } : undefined}
          onClick={() => {
            if (rabbitHuntCooldownUntil > Date.now()) return;
            requestRabbitHunt();
            setRabbitHuntCooldownUntil(Date.now() + 20000);
          }}
        >
          {rabbitHuntCooldownUntil > Date.now()
            ? `Rabbit (${Math.ceil((rabbitHuntCooldownUntil - Date.now()) / 1000)}s)`
            : `Show Rabbit \uD83D\uDC30`}
        </button>
      )}

      {/* Rabbit Hunt overlay panel */}
      {showRabbitPanel && rabbitCards && rabbitCards.length > 0 && (
        <div className="rabbit-overlay" onClick={() => setShowRabbitPanel(false)}>
          <div className="showdown-panel showdown-panel-small rabbit-panel" onClick={(e) => e.stopPropagation()}>
            <div className="showdown-title" style={{ color: '#ffd24a' }}>
              {'\uD83D\uDC30'} Rabbit Hunt
            </div>
            <div style={{ textAlign: 'center', color: '#aaaaaa', fontSize: '0.8rem', marginBottom: '10px' }}>
              Remaining community cards that would have been dealt:
            </div>
            <div className="rabbit-cards">
              {rabbitCards.map((card, i) => (
                <div
                  key={i}
                  className="community-card"
                  style={{ color: getCardColor(card.suit, colorBlindMode), pointerEvents: 'auto' }}
                >
                  <span className="card-rank">{serverRankDisplay(card.rank)}</span>
                  <span className="card-suit">{SUIT_INDEX_TO_SYMBOL[card.suit]}</span>
                </div>
              ))}
            </div>
            <div className="showdown-dismiss">Click anywhere to dismiss</div>
          </div>
        </div>
      )}

      {/* Insurance panel — R1: ONLY the server's quote for this seat + hand
          (gameState.insuranceQuote); its cashout + equity are shown as sent. */}
      {showInsurancePanel && (
        <div className="insurance-panel insurance-panel--server-quote">
          <div className="insurance-title">{'\uD83D\uDEE1\uFE0F'} Insurance</div>
          {insuranceSecsLeft !== null && (
            <div className="insurance-countdown" role="timer" aria-live="off" aria-label={`${insuranceSecsLeft} seconds to decide`}>
              <span className="insurance-countdown__bar" style={{ transform: `scaleX(${Math.max(0, Math.min(1, (insuranceExpiresAt - insuranceNow) / insuranceWindowMs))})` }} />
              <span className="insurance-countdown__text">Decide in {insuranceSecsLeft}s</span>
            </div>
          )}
          <div className="insurance-question">
            Lock in {insuranceQuote.equityPct}% equity for {insuranceQuote.cashout.toLocaleString()} chips?
          </div>
          <div className="insurance-details">
            <span>Pot: {(insuranceQuote.pot ?? pot).toLocaleString()}</span>
            <span>Equity: {insuranceQuote.equityPct}%</span>
          </div>
          <div className="insurance-actions">
            <button
              className="insurance-btn insurance-accept"
              onClick={() => {
                const socket = getSocket();
                if (!socket?.connected) {
                  addToast('Not connected — try Accept again in a moment.', 'warn', 3000);
                  return;
                }
                // No client numbers: the server prices and settles its own quote.
                socket.emit('acceptInsurance', { tableId: gameState?.tableId, handNumber: insuranceQuote.handNumber });
                setInsuranceClosedHand(insuranceQuote.handNumber);
              }}
            >
              Accept
            </button>
            <button
              className="insurance-btn insurance-decline"
              onClick={() => {
                // R1 review (R1REV-MONEY-2): tell the server, so the table's
                // decision window closes now instead of waiting out the full
                // timer. Fire-and-forget: the server is silent on anything
                // invalid and the panel closes either way.
                getSocket()?.emit('declineInsurance', { tableId: gameState?.tableId, handNumber: insuranceQuote.handNumber });
                setInsuranceClosedHand(insuranceQuote.handNumber);
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* R2 (S1) — his tournament started while he plays this table. */}
      {tourneyStartOffer && (
        <div className="hud-tourney-start-offer" role="status">
          <span className="hud-tourney-start-offer__text">
            {'\uD83C\uDFC6'} {tourneyStartOffer.name} has started. Your seat is waiting.
          </span>
          <button type="button" className="hud-tourney-start-offer__go" onClick={goToTournamentSeat}>
            Go to your tournament seat
          </button>
          <button type="button" className="hud-tourney-start-offer__close" aria-label="Not now" onClick={() => setTourneyStartOffer(null)}>{'\u2715'}</button>
        </div>
      )}

      {/* Spectator banner */}
      {isSpectating && (
        <div style={{
          // 2026-07-05 mobile audit fix: was top:44px (hardcoded), which slid under
          // the notch / the top HUD bar on notched iPhones in PWA standalone. Offset
          // by the safe-area top inset so it clears both.
          position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 48px)', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(120, 160, 255, 0.15)', border: '1px solid #B388FF',
          borderRadius: '8px', padding: '8px 24px', zIndex: 600,
          display: 'flex', alignItems: 'center', gap: '12px',
          color: '#ffd24a', fontSize: '0.9rem', fontWeight: 600,
        }}>
          Spectating
          <button
            onClick={() => { stopSpectating(); useGameStore.getState().setScreen('lobby'); }}
            style={{
              background: 'none', border: '1px solid #B388FF', color: '#ffd24a',
              padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem',
            }}
          >
            Leave
          </button>
        </div>
      )}

      {/* Right rail buttons — unified column */}

      {/* Duplicate-audit #1: Static Last-Hand summary panel removed. It was
          rendering the same hand recap that HandReplayViewer (opened by
          the rail Replay button) already shows interactively with a
          timeline scrubber. Users had two rail buttons ("Last Hand" +
          "Replay") opening overlapping views of the same data; now the
          single rail button opens the interactive version. */}

      {/* Right rail — Last Hand. Left rail — Emote (single merged
          reaction button per user "merge react and emote buttons").
          TableReactions removed from the rail; EmoteWheel is the
          single reaction entry point. */}
      {!isSpectating && (
        <>
          <div className="right-rail-btns">
            {lastHandHistory && (
              <button className="rail-btn" onClick={() => setShowReplay(true)}>🃏 Last Hand</button>
            )}
          </div>
          <div className="left-rail-btns">
            <div className="rail-btn-wrap"><EmoteWheel disabled={isSpectating} /></div>
          </div>
        </>
      )}

      {/* Legacy emote position removed — now in right rail */}
      {false && (
        <div style={{ position: 'fixed', bottom: '70px', right: '10px', zIndex: 500 }}>
          <EmoteWheel disabled={isSpectating} />
        </div>
      )}

      {/* Gesture flash — brief full-screen color flash on swipe/tap gestures */}
      {gestureFlash && (
        <div
          className={`gesture-flash-overlay gesture-flash-overlay--${gestureFlash}`}
          key={`flash-${Date.now()}`}
        >
          <div className="gesture-flash-label">
            {gestureFlash === 'fold' ? 'Fold'
              : gestureFlash === 'foldArm' ? 'Fold? Swipe again'
              : gestureFlash === 'check' ? 'Check'
              : gestureFlash === 'raise' ? 'Raise ↑' : 'Call'}
          </div>
        </div>
      )}

      {/* Touch gesture hint overlay (first mobile visit). R1: gestures work on
          the table felt only; swipe-left asks twice, and checks a free street. */}
      {showGestureHint && (
        <div className="gesture-hint-overlay" onClick={() => setShowGestureHint(false)}>
          <div className="gesture-hint-panel">
            <div className="gesture-hint-title">Touch Controls</div>
            <div className="gesture-hint-text gesture-hint-felt-only" style={{ textAlign: 'center', opacity: 0.8, marginBottom: 6 }}>On the table felt:</div>
            <div className="gesture-hint-row--new">
              <span className="gesture-hint-icon--lg">👆</span>
              <span className="gesture-hint-text"><strong>Tap</strong> — Check / Call</span>
            </div>
            <div className="gesture-hint-row--new">
              <span className="gesture-hint-icon--lg">⬅️</span>
              <span className="gesture-hint-text"><strong>Swipe Left</strong> — Fold (swipe twice) · Check when free</span>
            </div>
            <div className="gesture-hint-row--new">
              <span className="gesture-hint-icon--lg">➡️</span>
              <span className="gesture-hint-text"><strong>Swipe Right</strong> — Check / Call</span>
            </div>
            <div className="gesture-hint-row--new">
              <span className="gesture-hint-icon--lg">⬆️</span>
              <span className="gesture-hint-text"><strong>Swipe Up</strong> — Open Raise</span>
            </div>
            <div className="gesture-hint-row--new">
              <span className="gesture-hint-icon--lg">🤚</span>
              <span className="gesture-hint-text"><strong>Hold</strong> — Open Raise</span>
            </div>
            <div className="gesture-hint-dismiss">Tap anywhere to dismiss</div>
          </div>
        </div>
      )}

      {/* Raise slider overlay for touch */}
      {showRaiseSlider && isMyTurn && raiseControlsOk && (
        <div className="gesture-raise-overlay" onClick={() => setShowRaiseSlider(false)}>
          <div className="gesture-raise-panel" onClick={(e) => e.stopPropagation()}>
            <div style={{ color: '#ffd24a', fontWeight: 700, marginBottom: '10px', textAlign: 'center' }}>{raiseVerb === 'Bet' ? 'Bet Amount' : 'Raise Amount'}</div>
            {/* Quick-pick presets */}
            <div className="raise-quick-presets">
              {[
                { label: 'Min', fn: () => minRaiseTotal },
                { label: '½P', fn: () => potFraction(0.5) },
                { label: '¾P', fn: () => potFraction(0.75) },
                { label: 'Pot', fn: () => potFraction(1) },
                { label: '2x', fn: () => potFraction(2) },
              ].map(({ label, fn }) => (
                <button key={label} className="raise-quick-btn" onClick={() => setRaiseAmount(Math.max(minRaiseTotal, Math.min(fn(), maxRaise)))}>
                  {label}
                </button>
              ))}
            </div>
            {/* Slider with nudge buttons */}
            <div className="raise-slider-row">
              <button className="raise-nudge-btn" onClick={() => setRaiseAmount(a => Math.max(minRaiseTotal, shownRaiseAmount(a, minRaiseTotal, maxRaise) - bigBlind))}>−</button>
              <input
                type="range"
                min={minRaiseTotal}
                max={maxRaise}
                step={Math.max(1, Math.floor(minRaiseTotal / 4))}
                value={Math.max(minRaiseTotal, Math.min(raiseAmount || minRaiseTotal, maxRaise))}
                onChange={(e) => setRaiseAmount(Number(e.target.value))}
                className="raise-slider"
              />
              <button className="raise-nudge-btn" onClick={() => setRaiseAmount(a => Math.min(maxRaise, Math.max(minRaiseTotal, shownRaiseAmount(a, minRaiseTotal, maxRaise) + bigBlind)))}>+</button>
            </div>
            {/* F131 — the amount shown and sent is never 0 (a hand's first
                turn used to leave the size at 0: "Raise 0", refused). */}
            <div className="raise-amount-display">
              {shownRaiseAmount(raiseAmount, minRaiseTotal, maxRaise).toLocaleString()}
              {pot > 0 && <span className="raise-pot-pct"> ({Math.round(shownRaiseAmount(raiseAmount, minRaiseTotal, maxRaise) / pot * 100)}% pot)</span>}
            </div>
            <button
              className="action-btn raise"
              onClick={() => { handleAction('raise', shownRaiseAmount(raiseAmount, minRaiseTotal, maxRaise)); setShowRaiseSlider(false); }}
              style={{ width: '100%' }}
            >
              {raiseVerb === 'Bet' ? 'Bet' : 'Raise to'} {shownRaiseAmount(raiseAmount, minRaiseTotal, maxRaise).toLocaleString()}
            </button>
          </div>
        </div>
      )}

      {/* Floating emotes above seats. The HERO's own emote launches
          from their nameplate and floats straight up, so the user
          sees their reaction rise right out of the "You" chip at the
          bottom of the screen. Other seats' emotes use the legacy
          center-of-table spread. */}
      {emotes.map((emote, i) => {
        const emoteData = EMOTE_MAP[emote.emoteId];
        if (!emoteData) return null;
        const isMine = yourSeat >= 0 && emote.seatIndex === yourSeat;
        if (isMine) {
          return (
            <div
              key={`${emote.timestamp}-${i}`}
              className="emote-float emote-float--hero"
              style={{
                position: 'fixed',
                bottom: 'calc(var(--kb-offset, 0px) + 250px)',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 600,
                fontSize: '2.8rem',
                textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                pointerEvents: 'none',
                animation: 'emoteFloatHero 2s ease-out forwards',
                textAlign: 'center',
              }}
            >
              <div>{emoteData.icon}</div>
              <div style={{ fontSize: '0.65rem', color: '#4ade80', fontWeight: 700 }}>{safeName(emote.playerName, '')}</div>
            </div>
          );
        }
        // Non-hero seats: legacy center-table spread.
        const seatCount = Math.max(2, gameState?.maxSeats || (seats?.length || 8));
        // G182 — the server now sends maxSeats (a 6-max cap): a seat index at
        // or past it (a cap lowered under a seated player) stays in the spread.
        const offsetX = seatCount === 1
          ? 0
          : ((Math.min(Math.max(0, Number(emote.seatIndex) || 0), seatCount - 1) / (seatCount - 1)) * 400) - 200;
        return (
          <div
            key={`${emote.timestamp}-${i}`}
            className="emote-float"
            style={{
              position: 'fixed',
              top: '30%',
              left: `calc(50% + ${offsetX}px)`,
              zIndex: 600,
              animation: 'emoteFloat 2s ease-out forwards',
              fontSize: '2.5rem',
              textShadow: '0 2px 8px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}
          >
            {emoteData.icon}
            <div style={{ fontSize: '0.6rem', color: '#ccc', textAlign: 'center' }}>{safeName(emote.playerName, '')}</div>
          </div>
        );
      })}

      {/* Replay viewer overlay — wrapped so a chunk-load failure doesn't
          blank the whole HUD. OverlayBoundary falls back to a small toast. */}
      <OverlayBoundary name="Hand Replay" onClose={() => { setShowReplay(false); setReplayRecord(null); }}>
        <Suspense fallback={null}>
          {/* 2026-10-23 review fix-up: while a qualifier table is open the
              replay shows a revealed hand's name only, no strength percent. */}
          {showReplay && (replayRecord || lastHandHistory) && (
            <HandReplayViewer history={replayRecord || lastHandHistory} onClose={() => { setShowReplay(false); setReplayRecord(null); }} hideStrength={helpToolsOff || qualifierTableOpen} />
          )}
        </Suspense>
      </OverlayBoundary>

      {/* Training overlay — 2026-10-23: never at a qualifier table (the
          server's trainingData, if any, is not drawn there). */}
      {trainingEnabled && !helpToolsOff && <TrainingOverlay />}

      {/* Floating Hotkey gear button removed — moved into Options menu
          per user request ("move hotkey settings up into the options
          menu"). The overlay itself still renders conditionally below,
          opened via the new Options > Hotkey Settings item. */}

      {/* Hotkey settings overlay */}
      <OverlayBoundary name="Hotkey Settings" onClose={() => setHotkeyOpen(false)}>
        <Suspense fallback={null}>
          <HotkeySettings open={hotkeyOpen} onClose={() => setHotkeyOpen(false)} />
        </Suspense>
      </OverlayBoundary>

      {/* Unified toast stack (replaces inline rebuy notification) */}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map(t => (
            <div key={t.id} className={`toast-item toast-item--${t.type}`}>
              {t.msg}
            </div>
          ))}
        </div>
      )}

      {/* Opponent quick-stats popup — 2026-10-23: never at a qualifier table. */}
      {opponentStats && !helpToolsOff && (
        <div className="opp-stats-popup" onClick={() => setOpponentStats(null)}>
          <div className="opp-stats-name">{safeName(opponentStats.name, 'Player')}</div>
          {opponentStats.hands > 0 ? (
            <div className="opp-stats-grid">
              <div className="opp-stat"><span className="opp-stat-label">VPIP</span><span className="opp-stat-val">{opponentStats.vpip ?? '--'}%</span></div>
              <div className="opp-stat"><span className="opp-stat-label">PFR</span><span className="opp-stat-val">{opponentStats.pfr ?? '--'}%</span></div>
              <div className="opp-stat"><span className="opp-stat-label">3-Bet</span><span className="opp-stat-val">{opponentStats.threeBet ?? '--'}%</span></div>
              <div className="opp-stat"><span className="opp-stat-label">Agg</span><span className="opp-stat-val">{opponentStats.af?.toFixed(1) ?? '--'}</span></div>
              <div className="opp-stat opp-stat--full"><span className="opp-stat-label">Hands</span><span className="opp-stat-val">{opponentStats.hands}</span></div>
            </div>
          ) : (
            <div className="opp-stats-no-data">No data yet</div>
          )}
        </div>
      )}

      {/* Chat panel — disabled 2026-04-22 per user request ("get rid of live
          chat for now"). All chat state + handlers still live above so this
          is a one-line revert when we want it back. ChatPanel component and
          its styles intentionally preserved in the source. */}
      {false && (
      <ChatPanel
        chatOpen={chatOpen}
        setChatOpen={setChatOpen}
        chatUnread={chatUnread}
        setChatUnread={setChatUnread}
        chatMessages={chatMessages}
        chatInput={chatInput}
        setChatInput={setChatInput}
        chatEndRef={chatEndRef}
        handleSendChat={handleSendChat}
        handleChatKeyDown={handleChatKeyDown}
      />
      )}

      {/* Dealer Voice Line bubble */}
      {dealerVoice && (
        <div className={`dealer-voice ${dealerVoiceFadingRef.current ? 'dealer-voice-out' : ''}`}>
          <span className="dealer-voice-icon">{'\u2660'}</span>
          {dealerVoice}
        </div>
      )}

      {/* Big Win Confetti */}
      {showConfetti && <WinConfetti chipsWon={confettiChips} />}

      {/* Session Tracker (bottom-left) */}
      <SessionTracker />

      {/* Keyboard Shortcuts Overlay (#9) */}
      {showShortcuts && (
        <div className="shortcuts-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="shortcuts-panel" onClick={e => e.stopPropagation()}>
            <div className="shortcuts-title">⌨️ Keyboard Shortcuts</div>
            <div className="shortcuts-grid">
              {[
                [hotkeys.fold === ' ' ? 'Space' : hotkeys.fold.toUpperCase(), 'Fold'],
                [hotkeys.checkCall === ' ' ? 'Space' : hotkeys.checkCall.toUpperCase(), 'Check / Call'],
                [hotkeys.raise.toUpperCase(), 'Raise'],
                ['A', 'All-In'],
                ['?', 'Toggle shortcuts'],
                ['Esc', 'Close overlay'],
              ].map(([key, label]) => (
                <div key={key} className="shortcut-row">
                  <kbd className="shortcut-key">{key}</kbd>
                  <span className="shortcut-label">{label}</span>
                </div>
              ))}
            </div>
            <button className="shortcuts-close" onClick={() => setShowShortcuts(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Range Chart and Equity Calc - hidden until needed, no floating buttons */}

      {/* Hand Range Chart overlay (2026-10-23: never at a qualifier table) */}
      {showRangeChart && !helpToolsOff && <HandRangeChart onClose={() => setShowRangeChart(false)} />}

      {/* Equity Calculator, GTO, Provably Fair, Share, Coach, Voice — lazy loaded.
          Wrapped in OverlayBoundary so a failed chunk load for any of these
          doesn't take down the whole HUD with React's default error behavior. */}
      <OverlayBoundary
        name="Advanced Overlays"
        onClose={() => {
          setShowEquityCalc(false);
          setShowProvablyFair(false);
          setShowShareReplay(false);
          setShowPostHandCoach(false);
          setShowVoiceChat(false);
          setShowTimingTells(false);
          setShowCommentary(false);
          setShowRangeViz(false);
          setShowSpectatorPredict(false);
          setShowPauseCoach(false);
          setShowStream(false);
          setShowSessionRecap(false);
          setShowGTOSolver(false);
          setShowPredictionMarket(false);
          setShowHeatmap(false);
          setShowAchievements(false);
        }}
      >
      <Suspense fallback={null}>
        {showAchievements && <AchievementsPanel onClose={() => setShowAchievements(false)} />}
        {showEquityCalc && !helpToolsOff && <EquityCalculator onClose={() => setShowEquityCalc(false)} />}

        {showProvablyFair && (
          <ProvablyFair
            commitment={deckCommitment}
            revelation={deckRevelation}
            onClose={() => setShowProvablyFair(false)}
          />
        )}

        {showShareReplay && lastHandHistory && (
          <ShareReplay
            history={lastHandHistory}
            onClose={() => setShowShareReplay(false)}
          />
        )}

        {showPostHandCoach && !helpToolsOff && lastHandHistory && (
          <PostHandCoach
            handHistory={lastHandHistory}
            playerName={gameState?.seats?.[yourSeat]?.playerName || ''}
            onClose={() => setShowPostHandCoach(false)}
          />
        )}
      </Suspense>
      </OverlayBoundary>

      {/* Post-Hand Analysis Panel ("GTO suggests") — 2026-10-23: never at a
          qualifier table (help tools off). */}
      {!helpToolsOff && (phase === 'Showdown' || phase === 'HandComplete') && handResult && (
        <PostHandAnalysis
          gameState={gameState}
          yourSeat={yourSeat}
          handHistory={lastHandHistory}
        />
      )}

      {/* R2 (APPUI-45/46) — the opt-in floating panels (Predict Winner,
          Prediction Market, Voice Chat, the GTO overlay + solver) share ONE
          dock. Desktop: display:contents, every panel keeps its own corner.
          Phones (TableLayout.css): a column under the top bar sized to the
          measured bars, so none sits on the action bar, the hero's cards or
          another panel (they were fixed at bottom:116px — ON the 143-149px
          portrait bar — and over each other). */}
      <OverlayBoundary
        name="Table Panels"
        onClose={() => {
          setShowSpectatorPredict(false);
          setShowPredictionMarket(false);
          setShowVoiceChat(false);
          setGtoVisible(false);
          setShowGTOSolver(false);
        }}
      >
        <div className="hud-panel-dock">
          <Suspense fallback={null}>
            <SpectatorPredict
              tableId={gameState?.tableId}
              gameState={gameState}
              socket={getSocket()}
              visible={showSpectatorPredict}
              onClose={() => setShowSpectatorPredict(false)}
            />
            {/* 2026-10-09 — refusal handling passed in (PredictionMarket is in
                the manual 'game-overlays' chunk; see its header). */}
            <PredictionMarket
              gameState={gameState}
              socket={getSocket()}
              visible={showPredictionMarket}
              onClose={() => setShowPredictionMarket(false)}
              onPlayRefusal={reportPlayRefusal}
              notePlayAttempt={notePlayAttempt}
            />
            <VoiceChat
              tableId={gameState?.tableId}
              username={gameState?.seats?.[yourSeat]?.playerName || 'Player'}
              visible={showVoiceChat}
            />
            {/* GTO Overlay — always mounted, toggled via visibility.
                2026-10-23: neither GTO panel is mounted at a qualifier table. */}
            {!helpToolsOff && (
            <GTOOverlay
              holeCards={yourCards}
              communityCards={gameState?.communityCards}
              pot={gameState?.pot}
              callAmount={gameState?.callAmount || gameState?.toCall}
              numOpponents={(gameState?.seats || []).filter(s => s?.playerName && !s?.folded).length - 1}
              phase={phase}
              omaha={/omaha/i.test(gameVariant)}
              visible={gtoVisible && isMyTurn}
            />
            )}
            {!helpToolsOff && (
            <GTOSolver
              gameState={gameState}
              yourCards={yourCards}
              positionLabel={gameState?.seats?.[yourSeat]?.positionLabel || ''}
              equity={equityResults?.[yourSeat] ?? null}
              visible={showGTOSolver}
              onClose={() => setShowGTOSolver(false)}
            />
            )}
          </Suspense>
        </div>
      </OverlayBoundary>

      {/* Lazy-loaded overlays — code-split, loaded on first open.
          2026-10-23 (owner: "Turn all off") — at a qualifier table the help
          tools (Timing Tells, Table Commentary, Range Matrix, Pause & Coach,
          AI Coach Rail and its coach whispers, Equity Heatmap) are NOT
          mounted: nothing to show, no socket listener. Go Live and the
          session recap stay. */}
      <Suspense fallback={null}>
        {!helpToolsOff && (
        <TimingTellTracker
          gameState={gameState}
          visible={showTimingTells}
          onClose={() => setShowTimingTells(false)}
        />
        )}
        {!helpToolsOff && (
        <TableCommentary
          socket={getSocket()}
          gameState={gameState}
          visible={showCommentary}
          onClose={() => setShowCommentary(false)}
        />
        )}
        {!helpToolsOff && (
        <RangeVisualizer
          holeCards={yourCards}
          equity={equityResults?.[yourSeat] ?? null}
          potOdds={callAmount > 0 ? callShown.breakEvenPct : 0}
          visible={showRangeViz}
          onClose={() => setShowRangeViz(false)}
        />
        )}
        {!helpToolsOff && (
        <PauseCoach
          visible={showPauseCoach}
          gameState={gameState}
          yourCards={yourCards}
          pot={callShown.callIsAllIn ? callShown.effectivePot : pot}
          callAmount={callShown.effectiveCall}
          raiseAmount={raiseAmount || minRaiseTotal}
          onResume={() => setShowPauseCoach(false)}
          onClose={() => setShowPauseCoach(false)}
        />
        )}
        <StreamOverlay
          gameState={gameState}
          yourCards={yourCards}
          visible={showStream}
          onClose={() => setShowStream(false)}
        />
        {!helpToolsOff && (
        <CoachingRail
          gameState={gameState}
          yourCards={yourCards}
          equity={equityResults?.[yourSeat] ?? null}
          isMyTurn={isMyTurn}
          socket={getSocket()}
          visible={showCoachingRail}
          onClose={() => setShowCoachingRail(false)}
        />
        )}
        {/* GAP: notify.sessionEnd(net) has no wiring point here — there is no
            setShowSessionRecap(true) call site in this client, so the recap
            modal is never opened and the session-end rising edge doesn't
            exist. Wiring the notification requires the session-end trigger to
            be implemented first (see gap-spec #18, which is server-coupled and
            out of scope for this client-only pass). Not faking a trigger. */}
        <SessionRecap
          visible={showSessionRecap}
          sessionStats={{
            handsPlayed: sessionHandsRef.current,
            netChips: myChips - (sessionStartChipsRef.current ?? myChips),
            winRate: sessionHandsRef.current > 0 ? Math.round(((myChips - (sessionStartChipsRef.current ?? myChips)) / sessionHandsRef.current) * 10) / 10 : 0,
            biggestPot: sessionBiggestPotRef.current,
            sessionMinutes: Math.max(0, Math.round((Date.now() - sessionStartTimeRef.current) / 60000)),
            handHistory: recapHandHistory,
          }}
          socket={getSocket()}
          onClose={() => setShowSessionRecap(false)}
          onOpenAnalytics={() => {
            if (!lastHandHistory) return;
            setShowSessionRecap(false);
            setShowPostHandCoach(true);
          }}
          onViewReplay={() => {
            if (!lastHandHistory) return;
            setShowSessionRecap(false);
            setShowReplay(true);
          }}
        />
        {!helpToolsOff && (
        <HandHeatmap
          seats={gameState?.seats || []}
          equityResults={equityResults || {}}
          mySeatIndex={yourSeat}
          communityCards={communityCards}
          visible={showHeatmap}
        />
        )}
      </Suspense>

      {/* Advanced-tools toolbar — moved inside the Options dropdown per
          user request ("menus with the range matrix, the coach mode,
          and voice options need to be moved into options"). The whole
          floating `.adv-toolbar` portal is gone; its three groups
          (Analysis / Coach / Live) now render inside the Options menu
          as labeled sections. See GameHUD.jsx Options dropdown body. */}

      {/* All-In Confirmation Popup.
          Two UX fixes vs. the previous version:
            • Overlay click no longer auto-dismisses — this is a high-stakes
              decision, an errant tap outside the card shouldn't silently
              discard the confirm. User must use the Cancel button.
            • Stale modal guard: if the player's turn ends without resolving
              the dialog (e.g. disconnect mid-confirm), we auto-close after 10s
              OR on `!isMyTurn`, so the next turn's action buttons aren't hidden
              behind a frozen overlay. */}
      {showAllInConfirm && (
        <div
          className="allin-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Go all-in confirmation"
          onClick={(e) => { e.stopPropagation(); /* intentionally non-dismissive */ }}
        >
          <div className="allin-confirm-panel" onClick={(e) => e.stopPropagation()}>
            {/* F41 — at a pot / fixed-limit cap below his stack it is a raise
                to the maximum, not an all-in. */}
            <div className="allin-confirm-title">{allInMode === 'max' ? `Raise to the maximum (${maxRaise.toLocaleString()})?` : 'Go All-In?'}</div>
            <div className="allin-confirm-amount">
              {allInMode === 'max'
                ? `${Math.max(0, maxRaise - myCurrentBet).toLocaleString()} more chips`
                : `${myChips.toLocaleString()} chips`}
            </div>
            <div className="allin-confirm-actions">
              <button
                className="allin-confirm-btn allin-confirm-yes"
                onClick={() => {
                  setShowAllInConfirm(false);
                  handleAction('allIn');
                }}
              >
                {allInMode === 'max' ? `Confirm ${limits.capVerb}` : 'Confirm All-In'}
              </button>
              <button
                className="allin-confirm-btn allin-confirm-no"
                onClick={() => setShowAllInConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
