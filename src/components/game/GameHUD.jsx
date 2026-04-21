import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../../store/gameStore';
import { useTableStore } from '../../store/tableStore';
import { useShallow } from 'zustand/react/shallow';
import { SUIT_INDEX_TO_SYMBOL, SUIT_INDEX_TO_COLOR, serverRankDisplay, getCardColor } from '../../utils/cardUtils';
import TableReactions from './TableReactions';
import { evaluateHandStrength, getWinningCardIndices } from '../../utils/handStrength';
import { calculateOuts, analyzeBoardTexture } from '../../utils/outsCalculator';
import useSoundEffects from '../../hooks/useSoundEffects';
import TrainingOverlay from './TrainingOverlay';
import EmoteWheel, { EMOTE_MAP } from './EmoteWheel';
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
import { useProgressStore } from '../../store/progressStore';
import { useEquityWorker } from '../../hooks/useEquityWorker';
import { getSocket, subscribeConnectionStatus } from '../../services/socketService';
import { useTimerStore } from '../../store/timerStore';
import { loadHotkeys } from '../ui/HotkeySettings';
import { useAFKTracker } from '../../hooks/useAFKTracker';
import './GameHUD.css';

import OverlayBoundary from '../ui/OverlayBoundary';

// ─── Lazy-loaded overlays — only downloaded when first opened ─────────────────
const HandReplayViewer  = lazy(() => import('../replay/HandReplayViewer'));
const HotkeySettings    = lazy(() => import('../ui/HotkeySettings'));
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

export default function GameHUD() {
  const { calculateEquity } = useEquityWorker();

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
    sittingOut,
    toggleSitOut,
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
      sittingOut: s.sittingOut,
      toggleSitOut: s.toggleSitOut,
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
      setEliminatedPosition({ position: data.position, totalPlayers: data.totalPlayers });
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

  // Auto-action state (pre-select before your turn)
  const [autoAction, setAutoAction] = useState(null); // 'fold' | 'check' | 'call' | 'callAny' | null
  const autoActionRef = useRef(null);

  // Pre-action buttons (Upgrade 1)
  const [preAction, setPreAction] = useState(null); // null | 'checkFold' | 'callAny' | 'checkOnly'

  // Last raise replay (Upgrade 4)
  const lastRaiseRef = useRef(null);

  // Action history strip (Upgrade 6)
  const [actionHistory, setActionHistory] = useState([]);
  const prevSeatsRef = useRef(null);
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
  const [sfxVolume, setSfxVolume] = useState(() => {
    try { return parseFloat(sessionStorage.getItem('app_poker_sfxVol') ?? '0.8'); } catch { return 0.8; }
  });
  useEffect(() => { sessionStorage.setItem('app_poker_sfxVol', sfxVolume); }, [sfxVolume]);

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
  const [insuranceDismissed, setInsuranceDismissed] = useState(false);

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
  const sessionHandsRef = useRef(0);
  const sessionBiggestPotRef = useRef(0);
  const sessionPrevPhaseRef = useRef(null);

  // Track previous phase for sound triggers
  const prevPhaseRef = useRef(null);
  const prevIsMyTurnRef = useRef(false);

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
  const isSeated = myPlayer != null;

  // Persist sit-out preference across a refresh or reconnect. Without this,
  // an intentionally sat-out player gets re-seated on every reload because
  // `sittingOut` lives only in the in-memory store. On mount (first time we
  // see a seat), if the stored flag is TRUE and we aren't already sitting
  // out, replay the toggle. On every change, mirror to sessionStorage.
  const sittingOutPersistDidRestore = useRef(false);
  useEffect(() => {
    if (sittingOutPersistDidRestore.current || !isSeated) return;
    sittingOutPersistDidRestore.current = true;
    try {
      if (sessionStorage.getItem('app_poker_sittingOut') === '1' && !sittingOut) {
        toggleSitOut && toggleSitOut();
      }
    } catch { /* ignore */ }
  }, [isSeated, sittingOut, toggleSitOut]);
  useEffect(() => {
    try { sessionStorage.setItem('app_poker_sittingOut', sittingOut ? '1' : '0'); }
    catch { /* ignore */ }
  }, [sittingOut]);

  // AFK tracker — installed here so `isSeated` and `sittingOut` are in scope.
  const { isAFK } = useAFKTracker({
    active: isSeated && !sittingOut,
    onAFK: () => {
      const socket = getSocket();
      socket?.emit('playerAFK');
    },
    onBack: () => {
      const socket = getSocket();
      socket?.emit('playerBack');
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
  // PWA audit #9: hold Screen Wake Lock while deciding so the phone
  // doesn't sleep and drop the socket / auto-fold. Released when turn
  // ends or component unmounts. Hook is a no-op on unsupported browsers.
  useWakeLock(isMyTurn);

  // Keep refs in sync immediately after derivation (no render lag)
  isMyTurnRef.current = isMyTurn;

  // Auto-fold when the server is waiting on us but we're sitting out (joined mid-hand)
  useEffect(() => {
    if (!serverThinksItsMyTurn) return;
    if (!sittingOutUntilNextHand.current) return;
    if (!phase || phase === 'WaitingForPlayers' || phase === 'HandComplete') return;
    sendAction('fold');
  }, [serverThinksItsMyTurn, phase, sendAction]);
  const myChips = myPlayer?.chipCount ?? 0;
  const currentBetToMatch = Math.max(0, gameState?.currentBetToMatch || 0);
  const myCurrentBet = myPlayer?.currentBet || 0;
  const callAmount = Math.max(0, currentBetToMatch - myCurrentBet);
  callAmountRef.current = callAmount;
  // minRaise from server = getMinRaise() = currentBetToMatch + lastRaiseAmount (already the total to raise to)
  // Audit fix #18: use ?? so server-sent minRaise === 0 is respected as a legal
  // value (e.g. no previous bet this street) instead of silently falling back
  // to currentBetToMatch + BB, which would over-require a raise.
  const minRaiseTotal = gameState?.minRaise ?? (currentBetToMatch + (gameState?.bigBlind || 20));
  const maxRaise = myChips;

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

  // Bomb Pot info
  const isBombPot = gameState?.bombPot || false;

  // Dealer's Choice info
  const isDealersChoice = gameState?.dealersChoice || false;
  const dealersChoiceVariant = gameState?.dealersChoiceVariant || null;
  const dealersChoiceNext = gameState?.dealersChoiceNext || null;

  // Ante info
  const anteAmount = gameState?.ante || 0;

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

  // Pot odds calculation
  const potOdds = callAmount > 0 ? (pot / callAmount) : 0;
  // Audit fix #4: drop trailing .0 for whole-number ratios so "3:1" renders
  // instead of "3.0:1". Consistent with how experienced players read pot-odds.
  const potOddsDisplay = callAmount > 0
    ? (Math.abs(potOdds - Math.round(potOdds)) < 0.05
        ? `${Math.round(potOdds)}:1`
        : `${potOdds.toFixed(1)}:1`)
    : null;
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
  const getSPRColor = (s) => s === null ? '#6b7280' : Number(s) >= 8 ? '#4ADE80' : Number(s) >= 3 ? '#F59E0B' : '#EF4444';
  const getSPRLabel = (s) => s === null ? '' : Number(s) >= 8 ? 'Deep' : Number(s) >= 3 ? 'Mid' : 'Short';
  const spr = pot > 0 ? (myChips / pot).toFixed(1) : null;
  const sprColor = getSPRColor(spr);
  const sprLabel = getSPRLabel(spr);

  // Pre-flop hand tier (for card glow) (Upgrade 3)
  const preflopTier = (() => {
    if (yourCards.length < 2 || communityCards.length > 0) return null;
    const [c1, c2] = yourCards;
    const r1 = Math.max(c1.rank, c2.rank);
    const r2 = Math.min(c1.rank, c2.rank);
    const suited = c1.suit === c2.suit;
    const isPair = r1 === r2;
    // Premium: AA, KK, QQ, JJ, AKs, AKo
    if ((isPair && r1 >= 11) || (r1 === 14 && r2 === 13)) return 'premium';
    // Strong: TT-88, AQ, AJ, KQ suited
    if ((isPair && r1 >= 8) || (r1 === 14 && r2 >= 10) || (r1 === 13 && r2 === 12 && suited)) return 'strong';
    // Playable: 77-55, suited aces, broadway
    if ((isPair && r1 >= 5) || (r1 === 14 && suited) || (r1 >= 11 && r2 >= 10)) return 'playable';
    return 'marginal';
  })();

  // Straddle: player is UTG (first to act after big blind) in PreFlop
  const bigBlind = gameState?.bigBlind || 50;
  const straddleAmount = 2 * bigBlind;
  // Determine if player is UTG: in PreFlop, activeSeat === yourSeat means it's our turn,
  // and we check if we are the first actor (UTG position)
  const isUTG = phase === 'PreFlop' && isMyTurn && gameState?.isFirstActor;

  // Insurance: player is all-in and waiting for remaining community cards
  const isPlayerAllIn = myPlayer?.isAllIn || (myPlayer?.chipCount === 0 && myPlayer?.currentBet > 0);
  const cardsStillToCome = phase === 'PreFlop' ? 5 - communityCards.length :
    phase === 'Flop' ? 5 - communityCards.length :
    phase === 'Turn' ? 5 - communityCards.length : 0;
  const showInsurancePanel = isPlayerAllIn && cardsStillToCome > 0 && !insuranceDismissed &&
    (phase === 'Flop' || phase === 'Turn' || phase === 'PreFlop');
  // Insurance equity now discounts by live opponents. Previous math ignored
  // folded hands, which inflated strength (since their cards are no longer in
  // the deck) and generously over-offered insurance cashout.
  const liveOpponents = Math.max(
    0,
    ((gameState?.seats || []).filter((s, i) => s?.playerName && !s?.folded && i !== yourSeat).length)
  );
  const opponentDiscount = liveOpponents <= 1 ? 1 : Math.max(0.4, 1 - 0.08 * (liveOpponents - 1));
  const insuranceEquity = handStrength ? Math.round(handStrength.strength * 100 * opponentDiscount) : 50;
  const insuranceCashout = Math.round(pot * (insuranceEquity / 100) * 0.9); // 90% of equity value

  // Session stats tracking: initialize start chips, count hands, track biggest pot
  useEffect(() => {
    if (myChips > 0 && sessionStartChipsRef.current === null) {
      sessionStartChipsRef.current = myChips;
    }
  }, [myChips]);
  useEffect(() => {
    if (phase === 'PreFlop' && sessionPrevPhaseRef.current !== 'PreFlop') {
      sessionHandsRef.current += 1;
    }
    sessionPrevPhaseRef.current = phase;
  }, [phase]);
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
    const bbHalf = Math.max(1, Math.floor((gameState?.bigBlind || 20) / 2));
    const coarse = Math.max(bbHalf, Math.floor(minRaiseTotal / 10));
    return Math.max(1, Math.min(coarse, usable));
  }, [minRaiseTotal, maxRaise, gameState?.bigBlind]);

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

  // Initialize raise amount when turn starts — single effect, reads all memory sources
  const prevIsMyTurnForRaiseRef = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnForRaiseRef.current) {
      // #1 — if there's no legal raise (all-in already, or ≤0 effective stack),
      // don't bother computing a raise amount; UI will hide the raise slider.
      if (maxRaise <= 0 || minRaiseTotal > maxRaise) {
        setRaiseAmount(0);
        setShowRaiseSlider && setShowRaiseSlider(false);
        prevIsMyTurnForRaiseRef.current = isMyTurn;
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
        setRaiseAmount(amount);
      } else {
        // Clamp properly: the previous `Math.max(minRaiseTotal, Math.min(minRaiseTotal, maxRaise))`
        // was a no-op that could exceed `maxRaise`. Use the real clamp so the
        // slider's initial value is always legal.
        setRaiseAmount(Math.min(Math.max(minRaiseTotal, 0), Math.max(maxRaise, 0)));
      }
    }
    prevIsMyTurnForRaiseRef.current = isMyTurn;
  }, [isMyTurn, minRaiseTotal, maxRaise, pot]);

  // Clear "checkOnly" pre-action when someone bets (check is no longer available)
  useEffect(() => {
    if (preAction === 'checkOnly' && callAmount > 0) {
      setPreAction(null);
    }
  }, [callAmount, preAction]);

  // Upgrade 1: fire pre-action when it becomes our turn
  const prevIsMyTurnForPreActionRef = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnForPreActionRef.current && preAction) {
      const action = preAction;
      setPreAction(null);
      if (action === 'checkFold') {
        if (callAmount === 0) {
          playSound('check'); sendAction('check');
        } else {
          playSound('fold'); sendAction('fold');
        }
      } else if (action === 'callAny') {
        playSound('bet'); sendAction('call');
      } else if (action === 'checkOnly') {
        if (callAmount === 0) {
          playSound('check'); sendAction('check');
        }
        // no action if there's a bet
      }
    }
    prevIsMyTurnForPreActionRef.current = isMyTurn;
  }, [isMyTurn, preAction, callAmount, sendAction, playSound]);

  // Close raise slider and all-in confirm when turn ends
  useEffect(() => {
    if (!isMyTurn) {
      setShowRaiseSlider(false);
      setShowAllInConfirm(false);
      clearTimeout(foldTimerRef.current);
      setFoldPending(false);
    }
  }, [isMyTurn]);

  // Audit fix #3: reset raise amount whenever the hand number advances so
  // "Raise 678" stale from the previous hand doesn't bleed into the next one's
  // action bar before the player has interacted. Runs for every hand boundary,
  // including the first hand dealt after joining.
  const prevHandNumberRef = useRef(null);
  useEffect(() => {
    const hn = gameState?.handNumber ?? gameState?.handId ?? null;
    if (hn == null) return;
    if (prevHandNumberRef.current != null && prevHandNumberRef.current !== hn) {
      setRaiseAmount(0);
      lastRaiseRef.current = null;
      setPreAction(null);
      setFoldPending(false);
      setShowAllInConfirm(false);
      hasSentActionRef.current = false;
      autoFoldedRef.current = false;
    }
    prevHandNumberRef.current = hn;
  }, [gameState?.handNumber, gameState?.handId]);

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
    if (prev) {
      const newEntries = [];
      currentSeats.forEach((seat, i) => {
        if (!seat || seat.state !== 'occupied') return;
        const prevSeat = prev[i];
        const action = seat.lastAction;
        if (!action || action === 'None') return;
        if (prevSeat && prevSeat.lastAction === action && prevSeat.currentBet === seat.currentBet) return;
        const name = seat.playerName || `P${i + 1}`;
        let entry = '';
        const act = action.toLowerCase();
        // Disambiguate raises: "raised to X" when we can surface the new total,
        // and "raised from Y to X" when we have the previous bet snapshot. A
        // plain "raised 250" used to be ambiguous between "raised to 250" and
        // "raised by 250" — several users misread it as the raise delta.
        const prevBet = prevSeat?.currentBet || 0;
        const curBet = seat.currentBet || 0;
        const raiseDelta = curBet - prevBet;
        if (act.includes('fold')) entry = `${name} folded`;
        else if (act.includes('check')) entry = `${name} checked`;
        else if (act.includes('call')) entry = `${name} called ${curBet > 0 ? curBet.toLocaleString() : ''}`;
        else if (act.includes('raise') || act.includes('bet')) {
          if (curBet > 0 && raiseDelta > 0 && prevBet > 0) {
            entry = `${name} raised to ${curBet.toLocaleString()} (+${raiseDelta.toLocaleString()})`;
          } else if (curBet > 0) {
            entry = `${name} raised to ${curBet.toLocaleString()}`;
          } else {
            entry = `${name} raised`;
          }
        }
        else if (act.includes('all-in') || act.includes('allin')) entry = `${name} went all-in`;
        else entry = `${name} ${action}`;
        if (entry) newEntries.push(entry.trim());
      });
      if (newEntries.length > 0) {
        setActionHistory(prev2 => [...newEntries, ...prev2].slice(0, 3));
      }
    }
    prevSeatsRef.current = currentSeats.map(s => s ? { lastAction: s.lastAction, currentBet: s.currentBet, state: s.state } : null);
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
      prevSeatsRef.current = null;
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

  useEffect(() => {
    // Play 'turn' when it becomes player's turn
    if (isMyTurn && !prevIsMyTurnRef.current) {
      playSound('turn');
    }
    prevIsMyTurnRef.current = isMyTurn;
  }, [isMyTurn, playSound]);

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
        voiceLine = `Winner: ${winners[0].playerName}!`;
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

      // Build per-pot lines if potBreakdown available, else fall back to totals
      const potBreakdown = handResult.potBreakdown;
      let lines;
      if (potBreakdown && potBreakdown.length > 0) {
        // Flatten winnerAmounts across pots, labeled by pot name. Dedup key
        // uses (seatIndex, potIndex) — the previous (name, potName, amount)
        // key incorrectly collapsed two distinct players sharing the same pot
        // for the same amount into a single row.
        lines = potBreakdown.flatMap((pot, potIndex) =>
          (pot.winnerAmounts || []).map(wa => {
            const winnerInfo = handResult.winners.find(w => w.seatIndex === wa.seatIndex);
            return {
              name: winnerInfo?.playerName || `Seat ${wa.seatIndex + 1}`,
              amount: wa.amount,
              potName: pot.name,
              potIndex,
              seatIndex: wa.seatIndex,
              handName: winnerInfo?.handName || '',
            };
          })
        );
        const seen = new Set();
        lines = lines.filter(l => {
          const key = `${l.seatIndex}:${l.potIndex}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } else {
        lines = handResult.winners.map(w => ({
          name: w.playerName,
          amount: w.chipsWon || 0,
          potName: 'Main Pot',
          handName: w.handName || '',
        }));
      }

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
      if (mySeat?.chips != null) {
        useProgressStore.getState().updateChips(mySeat.chips);
      }
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
    if (isMyTurn) {
      timerWarningPlayed.current = false;
      timerStartedRef.current = false;

      const tick = () => {
        timerStartedRef.current = true;
        // Require a real server timestamp; skip ticks before reconnect settles.
        if (!serverTurnStartedAt || !serverTurnTimeout) {
          setTimeLeft(Math.ceil((serverTurnTimeout || 30000) / 1000));
          return;
        }
        const elapsed = Date.now() - serverTurnStartedAt;
        const timeoutSec = Math.max(1, Math.ceil(serverTurnTimeout / 1000));
        const rawRemaining = Math.ceil((serverTurnTimeout - elapsed) / 1000);
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
  }, [isMyTurn, serverTurnStartedAt, serverTurnTimeout]);

  // Execute auto-action when it becomes your turn
  useEffect(() => {
    if (isMyTurn && autoActionRef.current) {
      const action = autoActionRef.current;
      autoActionRef.current = null;
      setAutoAction(null);

      if (action === 'fold') {
        playSound('fold');
        sendAction('fold');
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
  }, [isMyTurn, callAmount, myChips, sendAction, playSound]);

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

  // Auto-fold: simple countdown — when timer hits 0, fold immediately.
  // timerStartedRef guards against a React race where timeLeft is still 0 from the
  // previous turn when isMyTurn first becomes true (setTimeLeft(30) is async).
  const autoFoldedRef = useRef(false);
  const timerStartedRef = useRef(false); // true only after the first interval tick
  useEffect(() => {
    // Extra belt-and-suspenders: atomically claim the fold slot by flipping
    // BOTH refs before even computing the action. This blocks any parallel
    // manual-fold click handler from re-firing between tick and emit on a
    // laggy network (refs are synchronous, so the second caller finds the
    // flag already set and bails out).
    if (isMyTurn && timeLeft <= 0 && timerStartedRef.current && !autoFoldedRef.current && !hasSentActionRef.current) {
      autoFoldedRef.current = true;
      hasSentActionRef.current = true;
      console.log('[Timer] Timer expired — auto-folding');
      playSound('fold');
      if (callAmount === 0) {
        sendAction('check');
      } else {
        sendAction('fold');
      }
    }
    if (!isMyTurn) {
      autoFoldedRef.current = false;
      hasSentActionRef.current = false;
      timerStartedRef.current = false;
    }
  }, [timeLeft, isMyTurn, callAmount, sendAction, playSound]);

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
    if (!isMyTurn) {
      lastWarningTickRef.current = null;
      return;
    }
    if (timeLeft > 5 || timeLeft <= 0) return;
    if (lastWarningTickRef.current === timeLeft) return;
    lastWarningTickRef.current = timeLeft;
    playSound('timer');
  }, [timeLeft, isMyTurn, playSound]);

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
  useEffect(() => {
    if (autoRebuy && phase === 'HandComplete' && prevPhaseForRebuyRef.current !== 'HandComplete') {
      if (myChips <= 0) {
        const minBuyIn = gameState?.minBuyIn || 5000;
        const socket = getSocket();
        if (socket?.connected) {
          socket.emit('rebuy', { amount: minBuyIn });
          addToast(`♻ Auto-rebuying ${minBuyIn.toLocaleString()} chips`, 'success');
        }
      }
    }
    prevPhaseForRebuyRef.current = phase;
  }, [phase, autoRebuy, myChips, gameState]);

  // Record opponent stats when hand completes
  const prevPhaseForStatsRef = useRef(null);
  useEffect(() => {
    if (phase === 'HandComplete' && prevPhaseForStatsRef.current !== 'HandComplete') {
      recordHandStats(seats, yourSeat, gameState);
    }
    prevPhaseForStatsRef.current = phase;
  }, [phase, seats, yourSeat, gameState]);

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
        player: seat.playerName || `P${i+1}`,
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

  // Persist auto-rebuy preference
  useEffect(() => {
    sessionStorage.setItem('app_poker_autoRebuy', autoRebuy ? 'true' : 'false');
  }, [autoRebuy]);

  // Persist Auto Deal preference (#11)
  useEffect(() => {
    sessionStorage.setItem('app_poker_autoDeal', autoDeal ? 'true' : 'false');
  }, [autoDeal]);

  // Auto Deal: auto-start next hand after HandComplete (#11)
  useEffect(() => {
    if (autoDeal && phase === 'HandComplete' && !isSpectating) {
      if (autoDealTimerRef.current) clearTimeout(autoDealTimerRef.current);
      autoDealTimerRef.current = setTimeout(() => {
        startHand();
      }, 2000);
    }
    return () => {
      if (autoDealTimerRef.current) clearTimeout(autoDealTimerRef.current);
    };
  }, [autoDeal, phase, isSpectating, startHand]);

  // Fast Mode: emit to server when toggled (#12)
  useEffect(() => {
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('setFastMode', { enabled: fastMode });
    }
  }, [fastMode]);

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

    // Check if we already calculated for this exact state
    const stateKey = `${phase}-${communityCards.length}-${showdownHands.map(h => h.seatIndex).join(',')}`;
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
    calculateEquity(playerHands, communityCards, deckRemaining, 1000)
      .then((result) => {
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
    const handler = (data) => {
      if (data && data.amount) {
        setMissedBlindsAmount(data.amount);
        if (data.type) setMissedBlindsType(data.type);
      }
    };
    const postedHandler = () => { setMissedBlindsAmount(0); setMissedBlindsType(null); };
    const errorHandler = (data) => {
      // Audit fix: surface server-side refusal to the player. Previously
      // insufficient_chips silently failed; now a toast explains why.
      if (data?.message) {
        try { addToast(data.message, data.code === 'insufficient_chips' ? 'error' : 'warn', 3500); } catch {}
      }
    };
    socket.on('missedBlinds', handler);
    socket.on('missedBlindsPosted', postedHandler);
    socket.on('missedBlindsError', errorHandler);
    return () => {
      socket.off('missedBlinds', handler);
      socket.off('missedBlindsPosted', postedHandler);
      socket.off('missedBlindsError', errorHandler);
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

  // === Mucked Hand Reveal: show button for 5 seconds after folding ===
  const prevFoldedRef = useRef(false);
  useEffect(() => {
    const folded = myPlayer?.folded || false;
    if (folded && !prevFoldedRef.current && yourCards.length > 0) {
      setShowMuckButton(true);
      if (muckTimerRef.current) clearTimeout(muckTimerRef.current);
      muckTimerRef.current = setTimeout(() => setShowMuckButton(false), 5000);
    }
    if (phase === 'WaitingForPlayers' || phase === 'PreFlop') {
      setShowMuckButton(false);
      setMuckedHands([]);
    }
    prevFoldedRef.current = folded;
    return () => { if (muckTimerRef.current) clearTimeout(muckTimerRef.current); };
  }, [myPlayer?.folded, phase, yourCards.length]);

  // Listen for mucked hand reveals from other players
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (data) => {
      if (data && data.cards && data.playerName) {
        const addedAt = Date.now();
        setMuckedHands((prev) => [...prev, { playerName: data.playerName, cards: data.cards, addedAt }]);
        // Auto-dismiss after 4 seconds
        setTimeout(() => {
          setMuckedHands((prev) => prev.filter((m) => m.addedAt !== addedAt));
        }, 4000);
      }
    };
    socket.on('muckedHandRevealed', handler);
    return () => socket.off('muckedHandRevealed', handler);
  }, []);

  // Track when player folds (for rabbit hunting)
  const prevMyPlayerRef = useRef(null);
  useEffect(() => {
    if (myPlayer && myPlayer.folded && prevMyPlayerRef.current && !prevMyPlayerRef.current.folded) {
      setPlayerFoldedThisHand(true);
    }
    if (phase === 'PreFlop' || phase === 'WaitingForPlayers') {
      setPlayerFoldedThisHand(false);
      clearRabbitCards();
      setShowRabbitPanel(false);
    }
    prevMyPlayerRef.current = myPlayer ? { ...myPlayer } : null;
  }, [myPlayer, phase, clearRabbitCards]);

  // Rabbit hunt socket listener
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (data) => {
      if (data && data.cards) {
        setRabbitCards(data.cards);
        setShowRabbitPanel(true);
      }
    };
    socket.on('rabbitHuntResult', handler);
    return () => socket.off('rabbitHuntResult', handler);
  }, [setRabbitCards]);

  // Reset insurance dismissed flag each hand
  useEffect(() => {
    if (phase === 'PreFlop' || phase === 'WaitingForPlayers') {
      setInsuranceDismissed(false);
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
            ? `Fav ${val.toLocaleString()} capped at all-in (${maxRaise.toLocaleString()})`
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
    // Standard NL pot-sized raise: raise to (pot + callAmount + callAmount) × fraction
    // i.e., after you call, the pot would be (pot + callAmount), then you raise that amount
    const potAfterCall = pot + callAmount;
    const amount = callAmount + Math.round(potAfterCall * fraction);
    const clamped = Math.max(minRaiseTotal, Math.min(amount, maxRaise));
    // Surface a subtle toast when a preset gets clamped so the user knows
    // the "½ Pot" (etc.) button worked, it just hit the stack ceiling.
    if (clamped !== amount) {
      try {
        addToast(
          clamped >= maxRaise
            ? `Capped at all-in (${maxRaise.toLocaleString()})`
            : `Raised to minimum (${minRaiseTotal.toLocaleString()})`,
          'info'
        );
      } catch { /* addToast not in scope yet at first render — silent */ }
    }
    return clamped;
  };

  // Chip denomination breakdown helper
  const chipDenominations = [
    { value: 1000, color: '#0d0d0d', border: '#00D9FF', label: '1K' },
    { value: 500, color: '#166534', border: '#4ADE80', label: '500' },
    { value: 100, color: '#991B1B', border: '#FCA5A5', label: '100' },
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
        // Audit fix #6: on a free street, the configured check/call key
        // ALREADY routed to check — but a user remapping "F" to both fold
        // and checkCall used to fold a free card. Now we unify the fold key
        // on free streets to also check, matching the Fold button's click
        // behavior before we hid it.
        if (callAmount === 0) handleAction('check');
        else handleAction('call');
      }],
      ['raise', () => {
        if (maxRaise <= 0 || minRaiseTotal > maxRaise) return;
        const amt = (typeof raiseAmount === 'number' && raiseAmount >= minRaiseTotal)
          ? snapRaiseToStep(raiseAmount)
          : minRaiseTotal;
        handleAction('raise', amt);
      }],
      ['allIn', () => handleAction('allIn')],
      ['fold', () => {
        // Free street → treat fold key as check (mirrors the now-hidden
        // Fold button's old click behavior so keyboard + UI agree).
        if (callAmount === 0) { handleAction('check'); return; }
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
  }, [isMyTurn, handleAction, callAmount, raiseAmount, hotkeys, showRaiseSlider, showAllInConfirm, isTouchDevice, minRaiseTotal, maxRaise, snapRaiseToStep]);

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

  // Sync color blind mode from sessionStorage changes
  useEffect(() => {
    const handleStorage = () => {
      try {
        const raw = sessionStorage.getItem('app_poker_settings');
        if (raw) setColorBlindMode(JSON.parse(raw).colorBlindMode || false);
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', handleStorage);
    // Also poll periodically in case same-tab changes
    const interval = setInterval(handleStorage, 2000);
    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(interval);
    };
  }, []);

  // Touch gesture handlers — use refs so handlers are stable and never re-register
  const handleTouchStart = useCallback((e) => {
    if (!isTouchDevice || !isMyTurnRef.current) return;
    // Don't intercept touches on action buttons, overlays, cards, or interactive UI
    if (e.target.closest('.action-btn, .pre-action-btn, .ab-preset, .chat-toggle, .adv-tool-btn, .hud-cards, .card-peek, .card-slot, .raise-quick-btn, .raise-nudge-btn, .rail-btn, .rail-btn-wrap, .showdown-overlay, .showdown-panel, .winner-banner, .phase-banner, .gesture-hint-overlay, .allin-confirm-overlay, .gesture-raise-overlay')) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    touchTimerRef.current = setTimeout(() => {
      setShowRaiseSlider(true);
      touchStartRef.current = null;
    }, 500);
  }, [isTouchDevice]); // stable — reads isMyTurn via ref

  const handleTouchMove = useCallback((e) => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
    if (!touchStartRef.current || !isMyTurnRef.current) return;
    if (e.target.closest('.action-btn, .pre-action-btn, .ab-preset, .chat-toggle, .adv-tool-btn, .hud-cards, .card-peek, .card-slot, .raise-quick-btn, .raise-nudge-btn, .rail-btn, .rail-btn-wrap, .showdown-overlay, .showdown-panel, .winner-banner, .phase-banner, .gesture-hint-overlay, .allin-confirm-overlay, .gesture-raise-overlay')) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    // Tap — check or call
    if (dt < 200 && absDx < 15 && absDy < 15) {
      if (callAmountRef.current === 0) {
        flashGesture('call');
        handleAction('check');
      } else {
        flashGesture('call');
        handleAction('call');
      }
      return;
    }
    // Horizontal swipe — fold (left) or call/check (right)
    if (absDx > 60 && absDx > absDy * 1.5 && dt < 500) {
      if (dx < 0) {
        flashGesture('fold');
        handleAction('fold');
      } else {
        flashGesture('call');
        if (callAmountRef.current === 0) handleAction('check');
        else handleAction('call');
      }
      return;
    }
    // Swipe UP — open raise slider
    if (dy < -70 && absDy > absDx * 1.5 && dt < 500) {
      flashGesture('raise');
      setShowRaiseSlider(true);
    }
  }, [handleAction, flashGesture]); // stable — reads isMyTurn/callAmount via refs

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

  // Attach touch event listeners
  useEffect(() => {
    if (!isTouchDevice) return;
    const hud = document.querySelector('.hud');
    if (!hud) return;
    hud.addEventListener('touchstart', handleTouchStart, { passive: true });
    hud.addEventListener('touchmove', handleTouchMove, { passive: true });
    hud.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      hud.removeEventListener('touchstart', handleTouchStart);
      hud.removeEventListener('touchmove', handleTouchMove);
      hud.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isTouchDevice, handleTouchStart, handleTouchMove, handleTouchEnd]); // stable refs — won't re-register

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

  const handleBackToLobby = useCallback(() => {
    // Audit fix #10: require confirmation mid-hand so a misclick doesn't
    // abandon a live decision and auto-fold at the server. Waiting /
    // complete / showdown states leave without asking (nothing at stake).
    const inLiveHand = phase && phase !== 'WaitingForPlayers' && phase !== 'HandComplete' && phase !== 'Showdown';
    const mySeatObj = gameState?.seats?.[yourSeat];
    const myChipsAtRisk = (mySeatObj?.currentBet || 0) > 0 || !!mySeatObj?.folded === false;
    if (inLiveHand && isMyTurn) {
      const ok = typeof window !== 'undefined' && window.confirm('Leave the table mid-turn? Your hand will be auto-folded.');
      if (!ok) return;
    } else if (inLiveHand && myChipsAtRisk) {
      const ok = typeof window !== 'undefined' && window.confirm('Leave mid-hand? You\'ll forfeit any chips already in the pot.');
      if (!ok) return;
    }
    leaveTable();
    setScreen('lobby');
  }, [leaveTable, setScreen, phase, gameState?.seats, yourSeat, isMyTurn]);

  const isWaiting = phase === 'WaitingForPlayers' || phase === 'HandComplete';
  const isShowdown = phase === 'Showdown';
  const lastHandHistory = handHistories.length > 0 ? handHistories[handHistories.length - 1] : null;
  const winnerSeatSet = handResult ? new Set((handResult.winners ?? []).map((w) => w.seatIndex)) : new Set();

  // Timer percentage for circular indicator
  const timerPct = (timeLeft / 30) * 100;
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
    <div className="hud">
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
                background: 'rgba(0,217,255,0.12)', color: '#00D9FF',
                border: '1px solid rgba(0,217,255,0.35)',
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
        {trainingEnabled && (
          <button
            className="hud-training-badge"
            onClick={() => {
              const socket = getSocket();
              setTrainingEnabled(false);
              if (socket?.connected) socket.emit('setTrainingMode', { enabled: false });
            }}
            title="Training mode is ON. Click to turn off."
            aria-label="Training mode active, click to disable"
          >
            🎓 Training
          </button>
        )}
        <div className="hud-center-info">
          <div className="hud-pot">
            <span className="hud-pot-dot">●</span> Pot: <span className={potFlashing ? 'hud-pot-amount--flash' : ''}>{pot.toLocaleString()}</span>
            {anteAmount > 0 && (
              <span className="hud-ante-badge">Ante: {anteAmount.toLocaleString()}</span>
            )}
            {/* SPR badge (#3) */}
            {pot > 0 && myChips > 0 && phase !== 'WaitingForPlayers' && (() => {
              const spr = myChips / pot;
              const sprColor = spr < 3 ? '#ef4444' : spr < 8 ? '#f59e0b' : '#4ade80';
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
          {/* Blind level timer (#4) */}
          {gameState?.blindLevel && gameState?.nextBlindIn > 0 && (
            <div className="blind-level-timer">
              <div className="blind-level-bar">
                <div className="blind-level-bar-fill" style={{
                  width: `${Math.min(100, (gameState.nextBlindIn / (gameState.blindLevelDuration || 600)) * 100)}%`,
                  background: gameState.nextBlindIn < 30 ? '#ef4444' : gameState.nextBlindIn < 60 ? '#f59e0b' : '#4ade80',
                }} />
              </div>
              <span className="blind-level-label">Level {gameState.blindLevel} · Next in {Math.ceil(gameState.nextBlindIn)}s</span>
            </div>
          )}
          <div className="hud-phase" data-phase={phaseLabel}>
            {isDealersChoice && dealersChoiceVariant && (
              <span className="dealers-choice-label">
                {dealersChoiceVariant.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            )}
            {!isDealersChoice && variantName !== "Texas Hold'em" && (
              <span style={{ color: '#00D9FF', marginRight: '6px', fontSize: '0.75rem' }}>
                {variantName}
              </span>
            )}
            {phaseLabel}
            <span className="hud-blinds-info">
              Blinds: {(gameState?.smallBlind || 25).toLocaleString()}/{bigBlind.toLocaleString()}
              {anteAmount > 0 && ` Ante: ${anteAmount.toLocaleString()}`}
            </span>
            {isDealersChoice && dealersChoiceNext && (
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
            title={connStatus === 'connected' ? 'Connected' : connStatus === 'reconnecting' ? 'Reconnecting…' : 'Disconnected'}
          />
          {/* Sit Out quick-access button */}
          <button
            className={`sit-out-quick-btn ${sittingOut ? 'sit-out-quick-btn--active' : ''}`}
            onClick={toggleSitOut}
            title={sittingOut ? 'Sitting Out — click to return' : 'Sit Out (auto-fold each hand)'}
          >
            {sittingOut ? '🪑 Sitting Out' : '🪑 Sit Out'}
          </button>

          {/* ⋯ Options dropdown — contains Sit Out, Training, and all settings */}
          <div className="hud-options-wrapper" ref={optionsRef}>
            <button
              className={`hud-icon-btn ${showOptions ? 'hud-icon-btn-active' : ''} ${sittingOut ? 'hud-icon-btn-sitout' : ''}`}
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
                {/* Training row */}
                <div className="options-row">
                  <span className="options-label">🎓 Training</span>
                  <button
                    className={`options-toggle ${trainingEnabled ? 'options-on' : 'options-off'}`}
                    onClick={toggleTraining}
                  >{trainingEnabled ? 'ON' : 'OFF'}</button>
                </div>
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
                    onClick={() => setFastMode(!fastMode)}
                  >{fastMode ? 'ON' : 'OFF'}</button>
                </div>
                <div className="options-row">
                  <span className="options-label">Quick Show</span>
                  <button
                    className={`options-toggle ${quickShowdown ? 'options-on' : 'options-off'}`}
                    onClick={() => setQuickShowdown(!quickShowdown)}
                  >{quickShowdown ? 'ON' : 'OFF'}</button>
                </div>
                <div className="options-row">
                  <span className="options-label">Auto Rebuy</span>
                  <button
                    className={`options-toggle ${autoRebuy ? 'options-on' : 'options-off'}`}
                    onClick={() => setAutoRebuy(!autoRebuy)}
                  >{autoRebuy ? 'ON' : 'OFF'}</button>
                </div>
                <div className="options-divider" />
                <button className="options-action-btn options-bomb"
                  onClick={() => { const socket = getSocket(); if (socket?.connected) socket.emit('triggerBombPot', {}); setShowOptions(false); }}>
                  💣 Bomb Pot
                </button>
                <button className="options-action-btn" onClick={() => { setShowRangeChart(true); setShowOptions(false); }}>
                  📊 Range Chart
                </button>
                <button className="options-action-btn" onClick={() => { setShowEquityCalc(true); setShowOptions(false); }}>
                  🔢 Equity Calc
                </button>
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
                  <span className="options-volume-label">{sfxVolume === 0 ? 'Muted' : sfxVolume < 0.3 ? 'Low' : sfxVolume < 0.7 ? 'Medium' : 'Loud'}</span>
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
                      { key: 'checkFold', icon: '🔄', label: 'Check/Fold' },
                      { key: 'callAny',   icon: '✋', label: 'Call Any' },
                      { key: 'checkOnly', icon: '✓', label: 'Check' },
                    ].map(({ key, icon, label }) => {
                      const active = preAction === key;
                      return (
                        <button
                          key={key}
                          role="radio"
                          aria-checked={active}
                          className={`options-queue-chip ${active ? 'options-queue-chip--active' : ''}`}
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
                      style={{ marginTop: 4, fontSize: '0.68rem', color: '#FCA5A5' }}
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
                    {[
                      { key: 'blue',    label: '🔵 Speed',    preview: 'linear-gradient(135deg, #1a3a6e, #0f2447)' },
                      { key: 'green',   label: '🟢 Classic',  preview: 'linear-gradient(135deg, #2e7d52, #1a5438)' },
                      { key: 'black',   label: '⬛ Midnight', preview: 'linear-gradient(135deg, #1a1a2e, #0d0d1a)' },
                      { key: 'crimson', label: '🔴 Crimson',  preview: 'linear-gradient(135deg, #7c1d1d, #4a0f0f)' },
                    ].map(({ key, label, preview }) => {
                      const active = (sessionStorage.getItem('app_poker_theme') || 'blue') === key;
                      return (
                        <button
                          key={key}
                          role="radio"
                          aria-checked={active}
                          className={`options-theme-swatch ${active ? 'options-theme-swatch--active' : ''}`}
                          title={label}
                          style={{ background: preview }}
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('poker:set-theme', { detail: { key } }));
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
                {/* Customize Avatar — moved into Options per user request.
                    AvatarCustomizer is a full-screen 3D view (Canvas +
                    OrbitControls), not an overlay, so clicking it leaves
                    the table. Same confirmation pattern as Back to Lobby
                    for mid-hand exits so a stray tap doesn't auto-fold
                    a live hand. */}
                <button
                  className="options-action-btn"
                  onClick={() => {
                    const inLiveHand = phase && phase !== 'WaitingForPlayers'
                      && phase !== 'HandComplete' && phase !== 'Showdown';
                    const mySeatObj = gameState?.seats?.[yourSeat];
                    const chipsAtRisk = (mySeatObj?.currentBet || 0) > 0;
                    if (inLiveHand && (isMyTurn || chipsAtRisk)) {
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
                  {toolbarGroups.analysis && (
                    <div className="options-adv-grid">
                      <button className={`options-adv-btn ${showRangeViz ? 'active' : ''}`} onClick={() => setShowRangeViz(v => !v)}>🎯 Range Matrix</button>
                      <button className={`options-adv-btn ${showHeatmap ? 'active' : ''}`} onClick={() => setShowHeatmap(v => !v)}>🌡 Equity Heatmap</button>
                      <button className={`options-adv-btn ${showTimingTells ? 'active' : ''}`} onClick={() => setShowTimingTells(v => !v)}>⏱ Timing Tells</button>
                      <button className={`options-adv-btn ${showSpectatorPredict ? 'active' : ''}`} onClick={() => setShowSpectatorPredict(v => !v)}>🔮 Predict Winner</button>
                      <button className={`options-adv-btn ${gtoVisible ? 'active' : ''}`} onClick={() => setGtoVisible(v => !v)}>📈 GTO Overlay</button>
                      <button className={`options-adv-btn ${showGTOSolver ? 'active' : ''}`} onClick={() => setShowGTOSolver(v => !v)}>♟ GTO Solver</button>
                      <button className="options-adv-btn" onClick={() => setShowProvablyFair(true)}>🔐 Provably Fair</button>
                    </div>
                  )}

                  {/* Coach group — AI rail, commentary, pause-and-coach, post-hand review */}
                  <button
                    className={`options-adv-header ${toolbarGroups.coach ? 'options-adv-header--open' : ''}`}
                    onClick={() => setToolbarGroups(g => ({ ...g, coach: !g.coach }))}
                  >🧠 Coach Mode {toolbarGroups.coach ? '▾' : '▸'}</button>
                  {toolbarGroups.coach && (
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

          <span className="hud-name">{playerName}</span>
          {/* Chip stack visual */}
          <div className={`hud-chip-stack ${myChips >= 5000 ? 'chip-deep' : myChips >= 1500 ? 'chip-mid' : 'chip-short'}`}>
            <span className="chip-coins">
              {myChips >= 5000 ? '🪙🪙🪙' : myChips >= 1500 ? '🪙🪙' : '🪙'}
            </span>
            <span className="chip-amount">{myChips.toLocaleString()}</span>
          </div>
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

      {/* Bomb Pot Banner */}
      {isBombPot && (
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
                {hoveredCardIdx === i && (outsInfo || boardTexture) && (
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
              the memo still has cached labels from the previous board). */}
          {boardTexture && boardTexture.labels.length > 0 &&
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

      {/* Side Pot Breakdown — only when someone is actually all-in */}
      {gameState?.pots && gameState.pots.length > 1 &&
       seats?.some(s => s?.state === 'occupied' && s?.allIn) &&
       phase !== 'WaitingForPlayers' && (
        <div className="side-pot-breakdown">
          {gameState.pots.map((p, i) => {
            const accentColors = ['#00D9FF', '#6AB4FF', '#A78BFA', '#4ADE80'];
            const accent = accentColors[i % accentColors.length];
            const label = i === 0 ? 'Main Pot' : `Side Pot ${i}`;
            const eligible = p.eligiblePlayers && p.eligiblePlayers.length > 0
              ? p.eligiblePlayers.map(idx => seats[idx]?.playerName || `P${idx + 1}`)
              : [];
            return (
              <div key={i} className="side-pot-item" style={{ borderLeftColor: accent }}>
                <div className="side-pot-header">
                  <span className="side-pot-label" style={{ color: accent }}>{label}</span>
                  {i > 0 && <span className="side-pot-tag">ALL-IN</span>}
                </div>
                <div className="side-pot-amount">{p.amount.toLocaleString()}</div>
                {eligible.length > 0 && (
                  <div className="side-pot-players">
                    {eligible.map((name, j) => (
                      <span key={j} className="side-pot-player-chip">{name}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Chopped Pot Display (#19) */}
      {gameState?.isChoppedPot && gameState?.chopDetails && (phase === 'Showdown' || phase === 'HandComplete') && (
        <div className="chop-pot-banner">
          <div className="chop-pot-title">Split Pot!</div>
          <div className="chop-pot-shares">
            {gameState.chopDetails.map((d, i) => (
              <span key={i} className="chop-pot-share">
                {d.playerName}: {d.share.toLocaleString()}
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
              <div key={i} className="equity-badge" title={`${seat.playerName}: ${pct}% equity`}>
                <span className="equity-player-name">{seat.playerName}</span>
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

      {/* AFK "You're Away" indicator */}
      {isAFK && (
        <div className="afk-away-banner">
          <span>🌙</span>
          <span>You're away — hands will be auto-folded</span>
          <button className="afk-back-btn" onClick={() => {
            const socket = getSocket();
            socket?.emit('playerBack');
            setAfkWarning(false);
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
      {missedBlindsAmount > 0 && !sittingOut && (
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
              socket.emit('postMissedBlinds');
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
        {isMyTurn && (
          <div className="action-timer-strip">
            <div
              className={`action-timer-strip-fill ${timeLeft <= 5 ? 'action-timer-strip--danger' : ''}`}
              style={{ width: `${(timeLeft / 30) * 100}%` }}
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
        <div className={`hud-cards hud-cards-floating ${isMyTurn ? 'hud-cards-active' : ''} ${holeCardCount >= 4 ? 'hud-cards-many' : ''} ${preflopTier ? `hud-cards-tier-${preflopTier}` : ''} ${cardsDealt ? 'hud-cards--dealt' : ''}`}>
          {yourCards.length > 0 ? (
            yourCards.map((card, i) => {
              const isSelected = selectedDiscards.includes(i) || (isPineapple && pineappleDiscardIndex === i);
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
                cardClick = () => toggleDiscard(i);
                cardTitle = isSelected ? 'Click to keep' : 'Click to discard';
              } else if (canPineappleDiscard) {
                cardClick = () => {
                  setPineappleDiscardIndex(i);
                  const socket = getSocket();
                  socket?.emit('selectPineappleDiscard', { cardIndex: i });
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
                        ...(isSelected ? { border: '2px solid #EF4444', boxShadow: '0 0 8px rgba(239, 68, 68, 0.5)' } : {}),
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
                    <div className="card-peek-back" />
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

        {/* Player nameplate — rendered from HUD (not 3D scene) so position:fixed works */}
        {myPlayer && yourSeat >= 0 && (
          <div className="hud-nameplate-me">
            <div className="hud-np-avatar" style={{ background: '#16a34a' }}>
              {(playerName || 'P').charAt(0).toUpperCase()}
            </div>
            <div className="hud-np-info">
              <span className="hud-np-name">{playerName}</span>
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
            Outs Counter + draws info below, which isn't shown by the pill. */}
        {showHandStrength && handStrength && (
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
                  position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.85)', border: '1px solid #fcd34d',
                  borderRadius: 12, padding: '12px 24px', zIndex: 100, textAlign: 'center',
                }}>
                  <div style={{ color: '#fcd34d', fontWeight: 800, fontSize: '1.1rem' }}>
                    You placed {eliminatedPosition.position}{eliminatedPosition.position === 1 ? 'st' : eliminatedPosition.position === 2 ? 'nd' : eliminatedPosition.position === 3 ? 'rd' : 'th'}
                  </div>
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

              <div style={{ color: '#00D9FF', textAlign: 'center' }}>
                <div style={{ fontWeight: 700 }}>Spectating</div>
                {tournamentSpectator?.status && (
                  <div style={{ fontSize: '0.75rem', color: '#888' }}>
                    {tournamentSpectator.status.alivePlayers} players | {tournamentSpectator.status.tables} tables | Lvl {tournamentSpectator.status.blindLevel}
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
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 999,
                background: 'rgba(0,217,255,0.08)', color: '#00D9FF',
                border: '1px solid rgba(0,217,255,0.25)', fontSize: 13, fontWeight: 600,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: '#00D9FF',
                  animation: 'livePulse 1.2s ease-in-out infinite',
                }} />
                {phase === 'HandComplete' ? 'Starting next hand…' : 'Waiting for players…'}
              </span>
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
              <style>{`@keyframes livePulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>
            </div>
          ) : hasDrawPhase && isDrawPhase ? (
            /* Draw Phase */
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#00D9FF', fontSize: '0.85rem' }}>
                Select cards to discard ({selectedDiscards.length} selected)
              </span>
              <button
                className="action-btn raise"
                onClick={handleDraw}
                style={{ background: 'linear-gradient(135deg, #A855F7, #7C3AED)' }}
              >
                {selectedDiscards.length === 0 ? 'Stand Pat' : `Discard & Draw ${selectedDiscards.length}`}
              </button>
            </div>
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
                    className={`pre-action-btn${preAction === 'checkFold' ? ' active' : ''}`}
                    aria-label={preAction === 'checkFold' ? 'Cancel pre-action: check or fold' : 'Queue pre-action: check or fold on my turn'}
                    aria-pressed={preAction === 'checkFold'}
                    onClick={() => setPreAction(preAction === 'checkFold' ? null : 'checkFold')}
                  >
                    <span className="pre-action-icon">🔄</span>
                    <span className="pre-action-label">Check/Fold</span>
                  </button>
                  <button
                    className={`pre-action-btn${preAction === 'callAny' ? ' active' : ''}`}
                    aria-label={preAction === 'callAny' ? 'Cancel pre-action: call any' : 'Queue pre-action: call any bet on my turn'}
                    aria-pressed={preAction === 'callAny'}
                    onClick={() => setPreAction(preAction === 'callAny' ? null : 'callAny')}
                  >
                    <span className="pre-action-icon">✋</span>
                    <span className="pre-action-label">Call Any</span>
                  </button>
                  <button
                    className={`pre-action-btn${preAction === 'checkOnly' ? ' active' : ''}`}
                    aria-label={preAction === 'checkOnly' ? 'Cancel pre-action: check if possible' : 'Queue pre-action: check if still free when action returns'}
                    aria-pressed={preAction === 'checkOnly'}
                    onClick={() => setPreAction(preAction === 'checkOnly' ? null : 'checkOnly')}
                  >
                    <span className="pre-action-icon">✓</span>
                    <span className="pre-action-label">Check</span>
                  </button>
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
                {callAmount > 0 && (
                <button
                  className={`action-btn fold ${foldPending ? 'fold-pending' : ''}`}
                  disabled={!isMyTurn}
                  aria-label={
                    !isMyTurn
                      ? 'Fold button, not your turn'
                      : foldPending
                        ? `Confirm fold by tapping again. You would give up a call of ${callAmount.toLocaleString()} chips.`
                        : `Fold. Call amount ${callAmount.toLocaleString()} chips. ${isMyTurn && timeLeft > 0 ? `Timer ${Math.round(timeLeft)} seconds remaining.` : ''}`
                  }
                  onClick={() => {
                    // Audit fix #12: dedupe double-tap. If the turn has already
                    // sent an action this cycle, ignore subsequent clicks so a
                    // stale fold doesn't fire a second time after the server
                    // has already moved the turn on. Pairs with
                    // hasSentActionRef reset on turn entry.
                    if (hasSentActionRef.current) return;
                    const bigBet = myChips > 0 && callAmount > myChips * 0.25;
                    if (bigBet && !foldPending) {
                      // First tap: show confirmation; auto-dismiss after 3s so
                      // a stale "Fold?" state never catches the user by surprise
                      // on the NEXT tap (which was the previous bug — foldPending
                      // never timed out, so tap-wait-tap folded without confirm).
                      setFoldPending(true);
                      clearTimeout(foldTimerRef.current);
                      foldTimerRef.current = setTimeout(() => setFoldPending(false), 3000);
                    } else {
                      // Second tap (or small bet): fold immediately
                      clearTimeout(foldTimerRef.current);
                      handleAction('fold');
                      setFoldPending(false);
                    }
                  }}
                >
                  {foldPending ? 'Fold?' : 'Fold'}
                  {/* Keyboard-hint chip removed per user request — PWA users
                      have no keyboard and desktop players already know the
                      bindings. Same reason the bottom .hud-hotkey-hints
                      strip was dropped below. */}
                </button>
                )}

                {/* CHECK / CALL with pot odds below */}
                <div className="ab-call-group">
                  {callAmount === 0 ? (
                    <button
                      className="action-btn check"
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
                      aria-label={!isMyTurn ? `Call button, not your turn. Call amount ${callAmount.toLocaleString()} chips.` : `Call ${callAmount.toLocaleString()} chips. ${pot > 0 ? `Pot odds require ${Math.round(100 * callAmount / (pot + callAmount))} percent equity to break even.` : ''} ${handStrength ? `Current hand strength ${Math.round(handStrength.strength * 100)} percent.` : ''} ${isMyTurn && timeLeft > 0 ? `Timer ${Math.round(timeLeft)} seconds remaining.` : ''}`}
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
                      <span className="action-amount-sub">{callAmount.toLocaleString()}</span>
                      {(potOddsDisplay || handStrength) && (
                        <span className="action-meta-row">
                          {potOddsDisplay && (
                            <span className="action-odds-sub">
                              {potOddsDisplay}&nbsp;·&nbsp;{Math.round(100 * callAmount / (pot + callAmount))}%
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

                {/* PRESETS — flat text buttons. Only show when a legal raise
                    is actually possible (min ≤ max and max > 0) — otherwise
                    the player is effectively all-in-or-fold. */}
                {isMyTurn && maxRaise > 0 && minRaiseTotal <= maxRaise && (
                  <div className="ab-presets">
                    <button className="ab-preset" onClick={() => setRaiseAmountSafe(potFraction(1/2))}>½ Pot</button>
                    <button className="ab-preset" onClick={() => setRaiseAmountSafe(potFraction(2/3))}>2/3 Pot</button>
                    <button className="ab-preset ab-preset--active" onClick={() => setRaiseAmountSafe(potFraction(1))}>Pot</button>
                    <button className="ab-preset" onClick={() => setRaiseAmountSafe(Math.max(minRaiseTotal, Math.min(bigBlind * 3, maxRaise)))}>3x BB</button>
                  </div>
                )}

                {/* RAISE — inline slider with confirm. Hidden entirely when no
                    legal raise exists (was previously rendered as a disabled
                    slider, which confused users in all-in scenarios). */}
                {maxRaise > 0 && minRaiseTotal <= maxRaise && (
                  <div className="raise-inline-group">
                    <div className="raise-inline-slider-wrap">
                      <span className="raise-inline-val">{raiseAmount.toLocaleString()}</span>
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
                      const displayAmount = (typeof raiseAmount === 'number' && raiseAmount > 0)
                        ? raiseAmount
                        : minRaiseTotal;
                      return (
                        <button
                          className="action-btn raise"
                          disabled={!isMyTurn}
                          aria-label={!isMyTurn ? `Raise button, not your turn. Amount ${displayAmount.toLocaleString()}.` : `Raise to ${displayAmount.toLocaleString()} chips. ${isMyTurn && timeLeft > 0 ? `Timer ${Math.round(timeLeft)} seconds remaining.` : ''}`}
                          onClick={() => handleAction('raise', displayAmount)}
                        >
                          Raise<br />{displayAmount.toLocaleString()}
                        </button>
                      );
                    })()}
                  </div>
                )}

                {/* ALL-IN */}
                <button
                  className="action-btn allin"
                  disabled={!isMyTurn}
                  aria-label={!isMyTurn ? 'All-in button, not your turn' : `Push all ${myChips.toLocaleString()} chips all-in. ${skipAllInConfirm ? 'Confirmation skipped — single tap commits.' : 'Opens confirmation dialog.'}`}
                  onClick={() => {
                    if (skipAllInConfirm) handleAction('allIn');
                    else setShowAllInConfirm(true);
                  }}
                >
                  {/* Audit fix #20: label shows the actual shove amount so a
                      short-stack user can see "All-In 1,240" at a glance
                      rather than just "All-In" and guess the commitment. */}
                  <span className="action-verb">All-In</span>
                  {myChips > 0 && (
                    <span className="action-amount-sub">{myChips.toLocaleString()}</span>
                  )}
                </button>

              </div>{/* end action-bar-flat */}

              {/* Keyboard-hint strip removed per user request — PWA users
                  have no keyboard, and desktop users who use hotkeys already
                  know them (or can open Options → Shortcuts to review). The
                  showShortcuts viewer + editable HotkeySettings both still
                  live in the Options menu, so the keybinds remain
                  discoverable without nagging the action bar each turn. */}

              {/* raise row moved to raise-panel-float below hud-bottom */}

              {/* STRADDLE (UTG only, active turn) */}
              {isUTG && isMyTurn && (
                <button
                  className="action-btn straddle"
                  onClick={() => {
                    const socket = getSocket();
                    if (socket?.connected) socket.emit('straddle');
                    playSound('bet');
                  }}
                >
                  Straddle {straddleAmount.toLocaleString()}
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
      {handStrength && yourCards.length > 0 && !myPlayer?.folded && phase !== 'HandComplete' && createPortal(
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
                background:
                  handStrength.strength < 0.2 ? '#DC2626' :
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
        </div>,
        document.body
      )}

      {/* Pot odds — on the table below "AMERICAN PUB POKER" */}
      {callAmount > 0 && potOddsDisplay && createPortal(
        <div className={`table-pot-odds ${potOddsGood ? 'table-pot-odds--good' : 'table-pot-odds--bad'}`}>
          Pot Odds: {potOddsDisplay}
        </div>,
        document.body
      )}

      {/* Action history — top-left below hand strength label */}
      {actionHistory.length > 0 && createPortal(
        <div className="action-history-floating">
          {actionHistory.slice(0, 3).map((a, i) => (
            <span key={i} className={`action-hist-item ${i === 0 ? 'action-hist-latest' : ''}`}>{a}</span>
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
            {handResult.potBreakdown && handResult.potBreakdown.some(p => (p.winnerAmounts || []).length > 0) ? (
              handResult.potBreakdown.map((pot, pi) => (
                <div key={pi} className="showdown-pot-section">
                  <div className="showdown-pot-label">{pot.name}</div>
                  {(pot.winnerAmounts || []).map((wa, wi) => {
                    const winnerInfo = handResult.winners.find(w => w.seatIndex === wa.seatIndex);
                    return (
                      <div key={wi} className="showdown-winner-row">
                        <div className="showdown-winner-badge">WIN</div>
                        <div className="showdown-player-name showdown-winner-name">
                          {winnerInfo?.playerName || `Seat ${wa.seatIndex + 1}`}
                        </div>
                        {winnerInfo?.handName && <div className="showdown-hand-name">{winnerInfo.handName}</div>}
                        <div className="showdown-chips-won">+{wa.amount.toLocaleString()} chips</div>
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
                    {winner.playerName}
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
                let detailedName = hand.handName;
                if (hand.holeCards.length > 0 && communityCards.length >= 3) {
                  const evalResult = evaluateHandStrength(hand.holeCards, communityCards, { variant: gameVariant });
                  if (evalResult.detailedName) detailedName = evalResult.detailedName;
                }
                return (
                  <div
                    key={hand.seatIndex}
                    className={`showdown-hand-row ${isWinner ? 'showdown-hand-winner' : 'showdown-hand-loser'}`}
                  >
                    <div className="showdown-hand-player">{hand.playerName}</div>
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
                  </div>
                );
              })}
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
                <div className="showdown-winner-name">{winner.playerName}</div>
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
            const socket = getSocket();
            if (socket?.connected) socket.emit('showMuckedHand', { cards: yourCards });
            setShowMuckButton(false);
          }}>Show Hand</button>
          <button className="show-muck-btn show-muck-btn--muck" onClick={() => setShowMuckButton(false)}>Muck</button>
        </div>
      )}

      {/* Show hand after winning by fold (#6) */}
      {showHandPrompt && yourCards.length > 0 && (
        <div className="show-muck-prompt">
          <button className="show-muck-btn show-muck-btn--show" onClick={() => {
            const socket = getSocket();
            if (socket?.connected) socket.emit('showMuckedHand', { cards: yourCards });
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
              <span className="mucked-hand-player">{mh.playerName} shows:</span>
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
      {phase === 'HandComplete' && playerFoldedThisHand && !rabbitCards && !showShowdown && (
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
            <div className="showdown-title" style={{ color: '#00D9FF' }}>
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

      {/* Insurance panel (all-in, waiting for cards) */}
      {showInsurancePanel && !insuranceDismissed && (
        <div className="insurance-panel">
          <div className="insurance-title">{'\uD83D\uDEE1\uFE0F'} Insurance</div>
          <div className="insurance-question">
            Lock in {insuranceEquity}% equity for {insuranceCashout.toLocaleString()} chips?
          </div>
          <div className="insurance-details">
            <span>Pot: {pot.toLocaleString()}</span>
            <span>Equity: {insuranceEquity}%</span>
          </div>
          <div className="insurance-actions">
            <button
              className="insurance-btn insurance-accept"
              onClick={() => {
                const socket = getSocket();
                if (socket?.connected) socket.emit('acceptInsurance', {
                  equityPct: insuranceEquity,
                  cashoutAmount: insuranceCashout,
                });
                setInsuranceDismissed(true);
              }}
            >
              Accept
            </button>
            <button
              className="insurance-btn insurance-decline"
              onClick={() => setInsuranceDismissed(true)}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* Spectator banner */}
      {isSpectating && (
        <div style={{
          position: 'fixed', top: '44px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0, 217, 255, 0.15)', border: '1px solid #B388FF',
          borderRadius: '8px', padding: '8px 24px', zIndex: 600,
          display: 'flex', alignItems: 'center', gap: '12px',
          color: '#00D9FF', fontSize: '0.9rem', fontWeight: 600,
        }}>
          Spectating
          <button
            onClick={() => { stopSpectating(); useGameStore.getState().setScreen('lobby'); }}
            style={{
              background: 'none', border: '1px solid #B388FF', color: '#00D9FF',
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

      {/* Right rail — Last Hand + React. Emote wheel moved to a
          separate left-rail container per user ("put the emote button
          on the left side of the screen, even with the last hand
          button"). Both rails share a `bottom` so their top edges
          line up across the screen. */}
      {!isSpectating && (
        <>
          <div className="right-rail-btns">
            {lastHandHistory && !showShowdown && (
              <button className="rail-btn" onClick={() => setShowReplay(true)}>🃏 Last Hand</button>
            )}
            <div className="rail-btn-wrap"><TableReactions /></div>
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
            {gestureFlash === 'fold' ? 'Fold' : gestureFlash === 'raise' ? 'Raise ↑' : 'Call'}
          </div>
        </div>
      )}

      {/* Touch gesture hint overlay (first mobile visit) */}
      {showGestureHint && (
        <div className="gesture-hint-overlay" onClick={() => setShowGestureHint(false)}>
          <div className="gesture-hint-panel">
            <div className="gesture-hint-title">Touch Controls</div>
            <div className="gesture-hint-row--new">
              <span className="gesture-hint-icon--lg">👆</span>
              <span className="gesture-hint-text"><strong>Tap</strong> — Check / Call</span>
            </div>
            <div className="gesture-hint-row--new">
              <span className="gesture-hint-icon--lg">⬅️</span>
              <span className="gesture-hint-text"><strong>Swipe Left</strong> — Fold</span>
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
      {showRaiseSlider && isMyTurn && (
        <div className="gesture-raise-overlay" onClick={() => setShowRaiseSlider(false)}>
          <div className="gesture-raise-panel" onClick={(e) => e.stopPropagation()}>
            <div style={{ color: '#00D9FF', fontWeight: 700, marginBottom: '10px', textAlign: 'center' }}>Raise Amount</div>
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
              <button className="raise-nudge-btn" onClick={() => setRaiseAmount(a => Math.max(minRaiseTotal, a - bigBlind))}>−</button>
              <input
                type="range"
                min={minRaiseTotal}
                max={maxRaise}
                step={Math.max(1, Math.floor(minRaiseTotal / 4))}
                value={Math.max(minRaiseTotal, Math.min(raiseAmount || minRaiseTotal, maxRaise))}
                onChange={(e) => setRaiseAmount(Number(e.target.value))}
                className="raise-slider"
              />
              <button className="raise-nudge-btn" onClick={() => setRaiseAmount(a => Math.min(maxRaise, a + bigBlind))}>+</button>
            </div>
            <div className="raise-amount-display">
              {raiseAmount.toLocaleString()}
              {pot > 0 && <span className="raise-pot-pct"> ({Math.round(raiseAmount / pot * 100)}% pot)</span>}
            </div>
            <button
              className="action-btn raise"
              onClick={() => { handleAction('raise', raiseAmount); setShowRaiseSlider(false); }}
              style={{ width: '100%' }}
            >
              Raise {raiseAmount.toLocaleString()}
            </button>
          </div>
        </div>
      )}

      {/* Floating emotes above seats */}
      {emotes.map((emote, i) => {
        const emoteData = EMOTE_MAP[emote.emoteId];
        if (!emoteData) return null;
        // Position emotes centered around the table, spread based on ACTUAL seat
        // count. Previous math assumed 8 seats, so on 6-max the first seat
        // shifted way off-center and seat 9 on a 10-max went off-screen.
        const seatCount = Math.max(2, gameState?.maxSeats || (seats?.length || 8));
        // Map seat 0..seatCount-1 to range [-200, +200] evenly
        const offsetX = seatCount === 1
          ? 0
          : ((emote.seatIndex / (seatCount - 1)) * 400) - 200;
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
            <div style={{ fontSize: '0.6rem', color: '#ccc', textAlign: 'center' }}>{emote.playerName}</div>
          </div>
        );
      })}

      {/* Replay viewer overlay — wrapped so a chunk-load failure doesn't
          blank the whole HUD. OverlayBoundary falls back to a small toast. */}
      <OverlayBoundary name="Hand Replay" onClose={() => setShowReplay(false)}>
        <Suspense fallback={null}>
          {showReplay && lastHandHistory && (
            <HandReplayViewer history={lastHandHistory} onClose={() => setShowReplay(false)} />
          )}
        </Suspense>
      </OverlayBoundary>

      {/* Training overlay */}
      {trainingEnabled && <TrainingOverlay />}

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

      {/* Opponent quick-stats popup */}
      {opponentStats && (
        <div className="opp-stats-popup" onClick={() => setOpponentStats(null)}>
          <div className="opp-stats-name">{opponentStats.name}</div>
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

      {/* Chat panel — memoized sub-component, only re-renders on message/open changes */}
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

      {/* Hand Range Chart overlay */}
      {showRangeChart && <HandRangeChart onClose={() => setShowRangeChart(false)} />}

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
          setShowGtoSolver(false);
          setShowPredictionMarket(false);
          setShowHandHeatmap(false);
        }}
      >
      <Suspense fallback={null}>
        {showEquityCalc && <EquityCalculator onClose={() => setShowEquityCalc(false)} />}

        {/* GTO Overlay — always mounted, toggled via visibility */}
        <GTOOverlay
          holeCards={yourCards}
          communityCards={gameState?.communityCards}
          pot={gameState?.pot}
          callAmount={gameState?.callAmount || gameState?.toCall}
          numOpponents={(gameState?.seats || []).filter(s => s?.playerName && !s?.folded).length - 1}
          phase={phase}
          visible={gtoVisible && isMyTurn}
        />

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

        {showPostHandCoach && lastHandHistory && (
          <PostHandCoach
            handHistory={lastHandHistory}
            playerName={gameState?.seats?.[yourSeat]?.playerName || ''}
            onClose={() => setShowPostHandCoach(false)}
          />
        )}
      </Suspense>
      </OverlayBoundary>

      {/* Post-Hand Analysis Panel */}
      {(phase === 'Showdown' || phase === 'HandComplete') && handResult && (
        <PostHandAnalysis
          gameState={gameState}
          yourSeat={yourSeat}
          handHistory={lastHandHistory}
        />
      )}

      {/* Voice Chat */}
      <Suspense fallback={null}>
        <VoiceChat
          tableId={gameState?.tableId}
          username={gameState?.seats?.[yourSeat]?.playerName || 'Player'}
          visible={showVoiceChat}
        />
      </Suspense>

      {/* Lazy-loaded overlays — code-split, loaded on first open */}
      <Suspense fallback={null}>
        <TimingTellTracker
          gameState={gameState}
          visible={showTimingTells}
          onClose={() => setShowTimingTells(false)}
        />
        <TableCommentary
          socket={getSocket()}
          gameState={gameState}
          visible={showCommentary}
          onClose={() => setShowCommentary(false)}
        />
        <RangeVisualizer
          holeCards={yourCards}
          equity={equityResults?.[yourSeat] ?? null}
          potOdds={callAmount > 0 ? Math.round(callAmount / (pot + callAmount) * 100) : 0}
          visible={showRangeViz}
          onClose={() => setShowRangeViz(false)}
        />
        <SpectatorPredict
          tableId={gameState?.tableId}
          gameState={gameState}
          socket={getSocket()}
          visible={showSpectatorPredict}
          onClose={() => setShowSpectatorPredict(false)}
        />
        <PauseCoach
          visible={showPauseCoach}
          gameState={gameState}
          yourCards={yourCards}
          onResume={() => setShowPauseCoach(false)}
          onClose={() => setShowPauseCoach(false)}
        />
        <StreamOverlay
          gameState={gameState}
          yourCards={yourCards}
          visible={showStream}
          onClose={() => setShowStream(false)}
        />
        <GTOSolver
          gameState={gameState}
          yourCards={yourCards}
          positionLabel={gameState?.seats?.[yourSeat]?.positionLabel || ''}
          equity={equityResults?.[yourSeat] ?? null}
          visible={showGTOSolver}
          onClose={() => setShowGTOSolver(false)}
        />
        <CoachingRail
          gameState={gameState}
          yourCards={yourCards}
          equity={equityResults?.[yourSeat] ?? null}
          isMyTurn={isMyTurn}
          socket={getSocket()}
          visible={showCoachingRail}
          onClose={() => setShowCoachingRail(false)}
        />
        <SessionRecap
          visible={showSessionRecap}
          sessionStats={{
            handsPlayed: sessionHandsRef.current,
            netChips: myChips - (sessionStartChipsRef.current ?? myChips),
            winRate: sessionHandsRef.current > 0 ? Math.round(((myChips - (sessionStartChipsRef.current ?? myChips)) / sessionHandsRef.current) * 10) / 10 : 0,
            biggestPot: sessionBiggestPotRef.current,
          }}
          socket={getSocket()}
          onClose={() => setShowSessionRecap(false)}
          onOpenAnalytics={() => {}}
          onViewReplay={() => {}}
        />
        <PredictionMarket
          gameState={gameState}
          socket={getSocket()}
          visible={showPredictionMarket}
          onClose={() => setShowPredictionMarket(false)}
        />
        <HandHeatmap
          seats={gameState?.seats || []}
          equityResults={equityResults || {}}
          mySeatIndex={yourSeat}
          communityCards={communityCards}
          visible={showHeatmap}
        />
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
            <div className="allin-confirm-title">Go All-In?</div>
            <div className="allin-confirm-amount">
              {myChips.toLocaleString()} chips
            </div>
            <div className="allin-confirm-actions">
              <button
                className="allin-confirm-btn allin-confirm-yes"
                onClick={() => {
                  setShowAllInConfirm(false);
                  handleAction('allIn');
                }}
              >
                Confirm All-In
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
