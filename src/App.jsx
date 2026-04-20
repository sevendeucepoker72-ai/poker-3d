import { useEffect, useState, useRef, Component, lazy, Suspense } from 'react';
import { useGameStore } from './store/gameStore';
import { useTableStore } from './store/tableStore';
import { getAuthToken, setAuthToken, clearAuthToken, isKeepSignedIn } from './services/tokenStorage';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('CAUGHT ERROR:', error.message, error.stack); }
  render() {
    if (this.state.error) return <div style={{color:'red',padding:20,background:'#111',whiteSpace:'pre-wrap'}}>
      <h2>GameHUD Crashed</h2><p>{this.state.error.message}</p><p>{this.state.error.stack}</p>
      <button onClick={() => this.setState({error:null})}>Retry</button>
    </div>;
    return this.props.children;
  }
}
import { useProgressStore } from './store/progressStore';
import { connectToServer, getSocket, subscribeConnectionStatus } from './services/socketService';
import { initPersistence, syncToServer, installBeforeUnloadSync } from './services/persistenceService';
import LoadingScreen from './components/ui/LoadingScreen';
import LoginScreen from './components/ui/LoginScreen';
import AuthCallback from './components/ui/AuthCallback';
import { isAuthCallback as checkIsAuthCallback, refreshAccessToken } from './services/authService';
// Heavy screens loaded lazily — only when the user first navigates to them
const Lobby = lazy(() => import('./components/ui/Lobby'));
const AvatarCustomizer = lazy(() => import('./components/ui/AvatarCustomizer'));
const GameScene = lazy(() => import('./components/scene/GameScene'));
const GameHUD = lazy(() => import('./components/game/GameHUD'));
const CareerMode = lazy(() => import('./components/career/CareerMode'));
import AchievementPopup from './components/ui/AchievementPopup';
import LevelUpPopup from './components/ui/LevelUpPopup';
import MissionsPanel from './components/ui/MissionsPanel';
import SpinReveal from './components/ui/SpinReveal';
import MultiTableTabs from './components/game/MultiTableTabs';
import PlayerNotes from './components/ui/PlayerNotes';
import BottomNav from './components/ui/BottomNav';
import PWAInstallPrompt from './components/ui/PWAInstallPrompt';
import { setOnOpenPlayerNotes } from './components/scene/PokerTable2D';
import KeyboardShortcuts from './components/ui/KeyboardShortcuts';
import Tutorial from './components/ui/Tutorial';
import HandReplayViewer from './components/replay/HandReplayViewer';
import './components/ui/Transitions.css';

/** Decode a ?replay=... URL param into a history object (returns null on failure). */
function parseReplayParam() {
  try {
    const param = new URLSearchParams(window.location.search).get('replay');
    if (!param) return null;
    return JSON.parse(decodeURIComponent(atob(param)));
  } catch (_) {
    return null;
  }
}

/** PWA shortcut action from manifest (e.g. ?action=quickplay) */
function getPWAAction() {
  return new URLSearchParams(window.location.search).get('action') || null;
}

/**
 * Deep-link from player app (americanpub.poker). Two shapes:
 *   1. Waitlist hand-off: ?context=waitlist&gameId=...&position=...&venue=...&startTime=...&token=...
 *      App auto-auths and joins Beginner's Table with waitlist banner.
 *   2. General "Play Online": ?token=...
 *      App auto-auths only; user lands on the normal lobby signed in.
 * Returns null when neither applies.
 */
function parseDeepLinkContext() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) return null;

    const ctx = (params.get('context') === 'waitlist')
      ? {
          source: 'waitlist',
          token,
          gameId: params.get('gameId') || null,
          position: Number(params.get('position')) || null,
          venue: params.get('venue') || null,
          startTime: params.get('startTime') || null,
        }
      : { source: 'general', token };

    // Scrub the token + context params from the URL bar immediately so the
    // ticket doesn't sit in window.location / history / referrer / page title.
    // The parsed context stays in React state.
    try {
      const cleanPath = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, cleanPath || '/');
    } catch { /* ignore */ }

    return ctx;
  } catch (_) {
    return null;
  }
}

// Username chooser — shown after first phone login
function ChooseUsernameScreen() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = () => {
    if (!name.trim() || name.trim().length < 2) { setError('Name must be at least 2 characters'); return; }
    setLoading(true);
    setError('');
    const socket = getSocket();
    if (!socket) { setError('Not connected'); setLoading(false); return; }
    socket.emit('setDisplayName', { name: name.trim() });
    socket.once('setDisplayNameResult', (data) => {
      setLoading(false);
      if (data.success) {
        useGameStore.getState().setPlayerName(data.displayName);
        useGameStore.getState().setScreen('lobby');
      } else {
        setError(data.error || 'Failed to set name');
      }
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a1628', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <div style={{ width: 360, padding: 32, background: '#111827', borderRadius: 16, border: '1px solid rgba(0,217,255,0.2)' }}>
        <h2 style={{ color: '#00D9FF', margin: '0 0 8px', textAlign: 'center' }}>Choose Your Name</h2>
        <p style={{ color: '#888', fontSize: '0.85rem', textAlign: 'center', margin: '0 0 24px' }}>
          This is how other players will see you at the table.
        </p>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Enter display name" maxLength={20} autoFocus
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 10, fontSize: '1rem',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(0,217,255,0.3)',
            color: '#fff', outline: 'none', boxSizing: 'border-box',
          }}
        />
        {error && <div style={{ color: '#F87171', fontSize: '0.8rem', marginTop: 8 }}>{error}</div>}
        <button onClick={handleSubmit} disabled={loading} style={{
          width: '100%', padding: '14px', marginTop: 16, borderRadius: 10,
          background: 'linear-gradient(135deg, #00D9FF, #00D9FFbb)',
          color: '#0a0a1a', border: 'none', cursor: 'pointer',
          fontWeight: 700, fontSize: '1rem', opacity: loading ? 0.6 : 1,
        }}>
          {loading ? 'Setting...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

// Thin fallback shown while a lazy chunk loads
function ChunkLoader() {
  return <div style={{ position:'fixed', inset:0, background:'#000000', display:'flex', alignItems:'center', justifyContent:'center', color:'#aaaaaa', fontFamily:'system-ui', fontSize:'0.9rem' }}>Loading…</div>;
}

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const isLoggedIn = useGameStore((s) => s.isLoggedIn);
  const [connStatus, setConnStatus] = useState('disconnected');
  const [loading, setLoading] = useState(true);
  const [loadingExiting, setLoadingExiting] = useState(false);
  // OAuth2 callback detection
  const [isOAuthCallback] = useState(() => checkIsAuthCallback());
  // Shared replay link — show viewer without requiring login
  const [sharedReplay] = useState(() => parseReplayParam());
  // PWA shortcut action — auto-trigger after login
  const [pwaAction] = useState(() => getPWAAction());
  // Deep-link from player app (americanpub.poker). Either a waitlist hand-off
  // (auto-seat at Beginner's + banner) or a general play ticket (auth-only).
  const [deepLinkContext] = useState(() => parseDeepLinkContext());
  const waitlistContext = deepLinkContext?.source === 'waitlist' ? deepLinkContext : null;
  const [deepLinkTimedOut, setDeepLinkTimedOut] = useState(false);
  const [showSpinReveal, setShowSpinReveal] = useState(false);
  const [spinMultiplier, setSpinMultiplier] = useState(2);
  const [quickGameResult, setQuickGameResult] = useState(null);
  const [notesPlayer, setNotesPlayer] = useState(null);
  // Active nav tab — persisted in sessionStorage so a screen transition
  // (lobby → table → lobby) or a tab-close-and-reopen doesn't reset the user
  // to "home". Bounded to known tabs; unknown values fall back to 'home'.
  const [activeNavTab, setActiveNavTab] = useState(() => {
    try {
      const saved = sessionStorage.getItem('poker_active_nav_tab');
      const KNOWN = new Set(['home', 'play', 'friends', 'shop', 'profile']);
      return KNOWN.has(saved) ? saved : 'home';
    } catch { return 'home'; }
  });
  useEffect(() => {
    try { sessionStorage.setItem('poker_active_nav_tab', activeNavTab); } catch { /* ignore */ }
  }, [activeNavTab]);

  // Transition state
  const [displayedScreen, setDisplayedScreen] = useState(screen);
  const [transitionClass, setTransitionClass] = useState('');
  const prevScreenRef = useRef(screen);

  // PWA audit #5: Android back-button handling. In an installed PWA the
  // hardware/gesture back button normally EXITS the app — which is
  // jarring mid-hand. Push a synthetic history entry on table entry,
  // then intercept popstate to show a leave-confirm toast instead of
  // letting the navigation proceed. On lobby back press, the app
  // exits normally (expected behaviour).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (screen !== 'table') return;
    // Push a guard entry so back pops *this* synthetic one instead of
    // exiting the PWA's history stack.
    const guard = { __pokerGuard: true, at: Date.now() };
    try { window.history.pushState(guard, ''); } catch { /* ignore */ }
    const onPopState = (e) => {
      // Still on table → user wants to leave. Confirm if mid-hand.
      const inLiveHand = useTableStore.getState().gameState?.phase &&
        !['WaitingForPlayers', 'HandComplete', 'Showdown'].includes(
          useTableStore.getState().gameState.phase
        );
      if (inLiveHand) {
        const ok = window.confirm('Leave the table mid-hand? Your hand will be auto-folded.');
        if (!ok) {
          // Re-push guard so the next back press is still caught.
          try { window.history.pushState(guard, ''); } catch {}
          return;
        }
      }
      useGameStore.getState().setScreen?.('lobby');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [screen]);

  // Handle screen transitions
  useEffect(() => {
    const prevScreen = prevScreenRef.current;
    prevScreenRef.current = screen;

    if (prevScreen === screen) return;

    // Determine transition direction
    const goingToTable = screen === 'table' && (prevScreen === 'lobby' || !prevScreen);
    const goingToLobby = screen === 'lobby' && prevScreen === 'table';

    if (goingToTable) {
      setTransitionClass('slide-in-right');
      setDisplayedScreen(screen);
    } else if (goingToLobby) {
      setTransitionClass('slide-in-left');
      setDisplayedScreen(screen);
    } else {
      setTransitionClass('');
      setDisplayedScreen(screen);
    }

    // Clear transition class after animation
    const timer = setTimeout(() => setTransitionClass(''), 300);
    return () => clearTimeout(timer);
  }, [screen]);

  // Handle bottom nav tab changes
  const handleNavTabChange = (tabId) => {
    setActiveNavTab(tabId);
  };

  // Show loading screen for 2 seconds, then fade out
  useEffect(() => {
    const exitTimer = setTimeout(() => setLoadingExiting(true), 1700);
    const doneTimer = setTimeout(() => setLoading(false), 2200);
    return () => { clearTimeout(exitTimer); clearTimeout(doneTimer); };
  }, []);

  // Wire up player notes callback from 3D scene
  useEffect(() => {
    setOnOpenPlayerNotes((playerName) => setNotesPlayer(playerName));
    return () => setOnOpenPlayerNotes(null);
  }, []);

  // Install persistence: flush to server on tab close + sync every 30s
  useEffect(() => {
    const cleanupBeforeUnload = installBeforeUnloadSync();
    const interval = setInterval(syncToServer, 30_000);
    return () => {
      clearInterval(interval);
      if (typeof cleanupBeforeUnload === 'function') cleanupBeforeUnload();
    };
  }, []);

  // Track connection status for UI banner
  useEffect(() => {
    const unsubscribe = subscribeConnectionStatus((status) => setConnStatus(status));
    return unsubscribe;
  }, []);

  // Connect to server on mount and wire up event listeners
  useEffect(() => {
    const socket = connectToServer();
    const emoteTimeouts = new Set();
    const quickGameTimeouts = new Set();
    const tournamentTimeouts = new Set();

    socket.on('connect', () => useTableStore.getState().setConnected(true));
    socket.on('disconnect', () => useTableStore.getState().setConnected(false));

    // Re-authenticate on every socket connect (initial + reconnect). Railway
    // restarts, brief network drops, and phone-locks all produce a new socket
    // id on the server, so the authSessions entry for the old id is gone —
    // we have to redo the handshake or any in-game action we emit next will
    // be rejected as unauthenticated. Uses the stored OAuth access token.
    socket.on('connect', () => {
      // Use tokenStorage so both localStorage (keep-signed-in) and
      // sessionStorage (tab-only) variants are checked on reconnect.
      const token = getAuthToken();
      if (!token) return;
      const st = useGameStore.getState();
      if (!st.isLoggedIn) return;
      socket.emit('oauthLogin', { accessToken: token });

      // PWA audit #2 + #11: after (re)connecting, if the user was
      // previously on a table, explicitly request a fresh game-state
      // sync. The server's reservedSeats restore path kicks in from
      // the oauthLogin handler, but this extra emit guarantees the
      // client has the current hand + seat occupancy + turn state,
      // protecting against the "resume to a stale table view" bug.
      const ts = useTableStore.getState();
      if (ts.gameState?.tableId || ts.currentTableId) {
        const tableId = ts.gameState?.tableId || ts.currentTableId;
        setTimeout(() => {
          try { socket.emit('syncTableState', { tableId }); } catch {}
        }, 350); // slight delay so oauthLogin auth completes first
      }
    });

    // Handle both full state and delta patches from the server
    socket.on('gameState', (data) => {
      let state;
      if (data && typeof data === 'object' && 'full' in data) {
        // New delta-aware protocol
        if (data.full) {
          // Full state replacement
          state = data.state;
          useTableStore.getState().setGameState(state);
        } else {
          // Partial delta — merge into current state
          const prev = useTableStore.getState().gameState;
          state = prev ? { ...prev, ...data.delta } : data.delta;
          // Clear stale hole cards whenever handId changes, regardless of
          // whether the delta itself includes fresh cards (they'll arrive in
          // a subsequent message). This prevents old cards leaking into a new hand.
          if (data.delta?.handId != null && prev?.handId != null && data.delta.handId !== prev.handId) {
            if (!data.delta.yourCards) state.yourCards = [];
            if (!data.delta.selectedDiscards) state.selectedDiscards = [];
            if (!data.delta.handResult) state.handResult = null;
          }
          useTableStore.getState().setGameState(state);
        }
      } else {
        // Legacy full-state format (backwards compatibility)
        state = data;
        useTableStore.getState().setGameState(state);
      }

      useTableStore.getState().setMySeat(state?.yourSeat ?? -1);

      // Handle spectator mode
      if (state?.isSpectator) {
        useTableStore.getState().setIsSpectating(true);
      }

      // Handle training data from server
      if (state?.trainingData) {
        useTableStore.getState().setTrainingData(state.trainingData);
      } else if (state !== null) {
        useTableStore.getState().setTrainingData(null);
      }

      // Update multi-table state if applicable
      if (state?.tableId) {
        useTableStore.getState().updateActiveTable(state.tableId, state);
      }
    });

    socket.on('tableList', (tables) => useTableStore.getState().setTables(tables));

    socket.on('error', (err) => console.error('Server error:', err));

    socket.on('handStarted', (state) => {
      useTableStore.getState().setGameState(state);
      useTableStore.getState().setMySeat(state?.yourSeat ?? -1);
    });

    socket.on('chatMessage', (msg) => {
      useTableStore.getState().addChatMessage(msg);
    });

    // Training mode toggle acknowledgment
    socket.on('trainingToggled', (data) => {
      useTableStore.getState().setTrainingEnabled(data.enabled);
    });

    // Sit out toggle acknowledgment
    socket.on('sitOutToggled', (data) => {
      useTableStore.getState().setSittingOut(data.sittingOut);
    });

    // Spin & Go reveal
    socket.on('spinReveal', (data) => {
      setSpinMultiplier(data.multiplier);
      setShowSpinReveal(true);
    });

    // Quick game over
    socket.on('quickGameOver', (data) => {
      setQuickGameResult(data);
      const t = setTimeout(() => {
        quickGameTimeouts.delete(t);
        setQuickGameResult(null);
      }, 5000);
      quickGameTimeouts.add(t);
    });

    // Quick game started notification
    socket.on('quickGameStarted', (data) => {
      // Game mode info
    });

    // Career game started
    socket.on('careerGameStarted', (data) => {
      // Career game started
    });

    // Progression events — also restore client-only data on first load
    socket.on('playerProgress', (progress) => {
      useProgressStore.getState().setProgress(progress);
      initPersistence(progress);
      // First playerProgress after login → pull durable state (inventory, BP claims, prefs…)
      if (!socket.__durableFetched) {
        socket.__durableFetched = true;
        socket.emit('getDurableState', { seasonId: 'season_1_the_river' });
      }
    });

    // Full durable-state snapshot (inventory + BP claims + customization + prefs + stars)
    socket.on('durableState', (payload) => {
      useProgressStore.getState().setDurableState(payload || {});
      // Also hydrate the avatar store from server customization so the user's
      // look follows them across devices.
      const c = payload?.customization;
      if (c && Object.keys(c).length > 0) {
        const current = useGameStore.getState().avatar;
        useGameStore.setState({ avatar: { ...current, ...c, faceShape: { ...(current.faceShape || {}), ...(c.faceShape || {}) } } });
      }
    });

    // Partial inventory update after buy/equip
    socket.on('inventoryUpdated', (payload) => {
      useProgressStore.getState().setInventory(payload?.inventory || []);
    });

    socket.on('achievementUnlocked', (data) => {
      useProgressStore.getState().addNotification({
        type: 'achievement',
        message: `${data.name} - ${data.description}`,
        reward: data.reward,
      });
    });

    socket.on('levelUp', (data) => {
      useProgressStore.getState().setLevelUpData(data);
    });

    socket.on('missionComplete', (data) => {
      useProgressStore.getState().addNotification({
        type: 'mission',
        message: data.description,
        reward: data.reward,
      });
    });

    socket.on('dailyBonusClaimed', (data) => {
      useProgressStore.getState().addNotification({
        type: 'mission',
        message: `Daily Bonus (Day ${data.streak})`,
        reward: { chips: data.chips, xp: 0, stars: data.stars },
      });
    });

    socket.on('missionClaimed', (data) => {
      // Progress update will come via playerProgress event
    });

    // Hand history from server — kept in memory only (server is source of
    // truth; it broadcasts durableState on reconnect so we rehydrate). No
    // sessionStorage mirror per the "no sessionStorage" policy.
    socket.on('handHistory', (history) => {
      useTableStore.getState().addHandHistory(history);
    });

    // Provably fair
    socket.on('deckCommitment', (data) => {
      useTableStore.getState().setDeckCommitment(data);
    });
    socket.on('deckSeedRevealed', (data) => {
      useTableStore.getState().setDeckRevelation(data);
    });

    // Staking
    socket.on('stakingUpdated', (data) => {
      useTableStore.getState().setStakingOffers(data.offers || []);
    });

    // Emote events
    socket.on('emote', (data) => {
      const store = useTableStore.getState();
      const timestamp = Date.now();
      store.addEmote({ ...data, timestamp });
      // Auto-remove after 2.5 seconds using the same timestamp
      const t = setTimeout(() => {
        emoteTimeouts.delete(t);
        useTableStore.getState().removeEmote(timestamp);
      }, 2500);
      emoteTimeouts.add(t);
    });

    // Spectator mode acknowledgment
    socket.on('spectating', (data) => {
      useTableStore.getState().setIsSpectating(true);
    });

    // Theme purchase/equip
    socket.on('themePurchased', (data) => {
      useProgressStore.getState().addNotification({
        type: 'mission',
        message: `Theme "${data.themeId}" purchased!`,
        reward: { chips: 0, xp: 0 },
      });
    });
    socket.on('themeEquipped', (data) => {
      // Progress will update via playerProgress
    });

    // Tournament events
    socket.on('tournamentStarted', (data) => {
      useGameStore.getState().setScreen('table');
    });
    socket.on('blindLevelUp', (data) => {
      useProgressStore.getState().addNotification({
        type: 'mission',
        message: `Blind Level Up: ${data.sb}/${data.bb}`,
        reward: { chips: 0, xp: 0 },
      });
    });
    socket.on('playerEliminated', (data) => {
      useProgressStore.getState().addNotification({
        type: 'achievement',
        message: `${data.playerName} eliminated (${data.position}${getOrdinal(data.position)})`,
        reward: { chips: 0, xp: 0 },
      });
    });
    socket.on('tournamentFinished', (data) => {
      // Show results via quick game result overlay
      if (data.results && data.results.length > 0) {
        const winner = data.results.find((r) => r.position === 1);
        setQuickGameResult({
          type: 'tournament',
          winner: winner?.playerName || 'Unknown',
          message: `Tournament Complete! ${winner?.playerName} wins ${winner?.payout?.toLocaleString() || 0} chips!`,
        });
        const t = setTimeout(() => {
          tournamentTimeouts.delete(t);
          setQuickGameResult(null);
        }, 8000);
        tournamentTimeouts.add(t);
      }
    });

    // Multi-table events
    socket.on('additionalTableJoined', (data) => {
      const store = useTableStore.getState();
      store.updateActiveTable(data.tableId, data.gameState);
      if (!store.currentTableId) {
        store.switchActiveTable(data.tableId);
      }
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('gameState');
      socket.off('tableList');
      socket.off('error');
      socket.off('handStarted');
      socket.off('chatMessage');
      socket.off('trainingToggled');
      socket.off('sitOutToggled');
      socket.off('spinReveal');
      socket.off('quickGameOver');
      socket.off('quickGameStarted');
      socket.off('careerGameStarted');
      socket.off('playerProgress');
      socket.off('achievementUnlocked');
      socket.off('levelUp');
      socket.off('missionComplete');
      socket.off('dailyBonusClaimed');
      socket.off('missionClaimed');
      socket.off('handHistory');
      socket.off('durableState');
      socket.off('inventoryUpdated');
      socket.off('deckCommitment');
      socket.off('deckSeedRevealed');
      socket.off('stakingUpdated');
      socket.off('emote');
      socket.off('spectating');
      socket.off('themePurchased');
      socket.off('themeEquipped');
      socket.off('tournamentStarted');
      socket.off('blindLevelUp');
      socket.off('playerEliminated');
      socket.off('tournamentFinished');
      socket.off('additionalTableJoined');
      // Clear any pending timeouts from inside listeners to prevent leaks
      emoteTimeouts.forEach(clearTimeout); emoteTimeouts.clear();
      quickGameTimeouts.forEach(clearTimeout); quickGameTimeouts.clear();
      tournamentTimeouts.forEach(clearTimeout); tournamentTimeouts.clear();
    };
  }, []);

  // Auto-login: try OAuth refresh token first, then legacy token
  useEffect(() => {
    // Skip auto-login if we're handling an OAuth callback
    if (isOAuthCallback) return;

    let cancelled = false;
    const socket = getSocket();
    if (!socket) return;

    const clearStoredTokens = () => {
      // Clear BOTH stores for each key so localStorage-backed "Keep me
      // signed in" sessions are also purged on auto-login failure.
      clearAuthToken();
      for (const k of ['poker_keep_signed_in','poker_oauth_refresh','poker_oauth_id_token','poker_token_expiry']) {
        try { localStorage.removeItem(k); } catch {}
        try { sessionStorage.removeItem(k); } catch {}
      }
    };

    // Attempt OAuth refresh token flow — check localStorage first
    // (keep-signed-in) then sessionStorage fallback.
    const oauthRefresh = (() => {
      try { return localStorage.getItem('poker_oauth_refresh') || sessionStorage.getItem('poker_oauth_refresh'); }
      catch { return null; }
    })();
    if (oauthRefresh) {
      let oauthResultListener = null;
      let oauthConnectHandler = null;
      let oauthTimeoutId = null;

      refreshAccessToken(oauthRefresh)
        .then((tokens) => {
          if (cancelled) return;
          // Use tokenStorage so the access token respects "Keep me signed in".
          setAuthToken(tokens.access_token);
          // OAuth refresh token / id token / expiry: also route to the
          // same storage the auth token went to (localStorage if
          // keep-signed-in, sessionStorage otherwise).
          const keep = isKeepSignedIn();
          const store = keep ? localStorage : sessionStorage;
          try { store.setItem('poker_oauth_refresh', tokens.refresh_token); } catch {}
          try { store.setItem('poker_oauth_id_token', tokens.id_token || ''); } catch {}
          try { store.setItem('poker_token_expiry', String(Date.now() + tokens.expires_in * 1000)); } catch {}

          const handleResult = (result) => {
            if (cancelled) return;
            socket.off('loginResult', handleResult);
            oauthResultListener = null;
            if (oauthTimeoutId) {
              clearTimeout(oauthTimeoutId);
              oauthTimeoutId = null;
            }
            if (result?.success && result.userData) {
              useGameStore.getState().oauthLogin(tokens, result.userData);
            } else {
              clearStoredTokens();
            }
          };

          const doAuth = () => {
            if (cancelled) return;
            oauthConnectHandler = null;
            socket.emit('oauthLogin', { accessToken: tokens.access_token });
            // Start the 8s watchdog ONLY after we actually emit — previously the
            // timer started at setup time, so a slow `connect` could eat the
            // whole budget before the emit ever fired.
            oauthTimeoutId = setTimeout(() => {
              if (cancelled) return;
              oauthTimeoutId = null;
              if (oauthResultListener) {
                socket.off('loginResult', oauthResultListener);
                oauthResultListener = null;
              }
            }, 8000);
          };

          oauthResultListener = handleResult;
          socket.on('loginResult', handleResult);
          if (socket.connected) {
            doAuth();
          } else {
            oauthConnectHandler = doAuth;
            socket.once('connect', doAuth);
          }
        })
        .catch(() => {
          if (cancelled) return;
          // PWA audit #3: iOS Safari / PWA Storage Access API evicts
          // localStorage after ~7 days of no app interaction. When the
          // user comes back, the refresh token we saved is gone AND the
          // call fails silently. Previously this path tried a legacy
          // auto-login which also has no valid token — so the UI got
          // stuck on "Signing in…" forever. Clear BOTH stores and hand
          // off to the legacy path; if it also fails we land cleanly
          // on the login screen rather than infinite-spinnering.
          for (const k of ['poker_oauth_refresh','poker_oauth_id_token','poker_token_expiry','poker_auth_token']) {
            try { localStorage.removeItem(k);   } catch {}
            try { sessionStorage.removeItem(k); } catch {}
          }
          tryLegacyAutoLogin();
        });

      return () => {
        cancelled = true;
        if (oauthTimeoutId) clearTimeout(oauthTimeoutId);
        if (oauthResultListener) socket.off('loginResult', oauthResultListener);
        if (oauthConnectHandler) socket.off('connect', oauthConnectHandler);
      };
    }

    // Legacy token auto-login (existing HS256 JWT).
    // tokenStorage.getAuthToken reads localStorage (persistent) first,
    // then sessionStorage fallback — so "Keep me signed in" actually
    // works across browser restarts.
    function tryLegacyAutoLogin() {
      const savedToken = getAuthToken();
      if (!savedToken) return;

      let timeoutId = null;

      const handleAutoLoginResult = (result) => {
        if (cancelled) return;
        clearTimeout(timeoutId);
        socket.off('loginResult', handleAutoLoginResult);
        if (result?.success && result.userData) {
          // Re-persist the refreshed token using the user's stored
          // keep-signed-in preference. Preserves localStorage placement.
          setAuthToken(result.token);
          useGameStore.getState().login(result.userData, result.token);
        } else {
          clearStoredTokens();
        }
      };

      const doLogin = () => {
        if (cancelled) return;
        socket.on('loginResult', handleAutoLoginResult);
        socket.emit('tokenLogin', { token: savedToken });
        timeoutId = setTimeout(() => {
          if (cancelled) return;
          socket.off('loginResult', handleAutoLoginResult);
          clearStoredTokens();
        }, 5000);
      };

      if (socket.connected) doLogin();
      else socket.once('connect', doLogin);
    }

    tryLegacyAutoLogin();
    return () => { cancelled = true; };
  }, [isOAuthCallback]);

  // Handle seat reconnection after token login.
  // Server now force-emits a full gameState on reconnect (see emitGameState
  // with forceFullState=true in poker-server), so we no longer rely on the
  // broadcast delta catching us up. This handler jumps the user straight to
  // the table screen so they don't have to manually re-navigate after the
  // server restored their seat — critical on mobile where a phone lock /
  // network blip is the most common reconnect cause.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleReconnected = (data) => {
      console.log('[App] Reconnected to reserved seat', data);
      try {
        const store = useGameStore.getState();
        if (store.isLoggedIn) {
          store.setScreen('table');
        }
      } catch { /* ignore */ }
    };

    socket.on('reconnectedToTable', handleReconnected);
    return () => socket.off('reconnectedToTable', handleReconnected);
  }, []);

  // OAuth2 token refresh timer — refresh 5 minutes before expiry
  useEffect(() => {
    const expiry = useGameStore.getState().oauthTokenExpiry;
    if (!expiry) return;

    const refreshAt = expiry - 5 * 60 * 1000;
    const delay = refreshAt - Date.now();
    if (delay <= 0) return;

    const timer = setTimeout(async () => {
      // Check both stores for the refresh token (keep-signed-in lives in localStorage).
      let refresh = null;
      try { refresh = localStorage.getItem('poker_oauth_refresh') || sessionStorage.getItem('poker_oauth_refresh'); } catch {}
      if (!refresh) return;
      try {
        const tokens = await refreshAccessToken(refresh);
        setAuthToken(tokens.access_token);
        const keep = isKeepSignedIn();
        const store = keep ? localStorage : sessionStorage;
        try { store.setItem('poker_oauth_refresh', tokens.refresh_token); } catch {}
        try { store.setItem('poker_token_expiry', String(Date.now() + tokens.expires_in * 1000)); } catch {}
        const state = useGameStore.getState();
        state.setAuth(state.userId, tokens.access_token);
      } catch {
        // Refresh failed; user will need to re-login when token expires
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [useGameStore((s) => s.oauthTokenExpiry)]);

  // Deep-link from player app. If it's a waitlist hand-off, emit
  // joinWithWaitlistContext so the server auto-seats the player at Beginner's
  // Table with the banner. If it's a general play ticket, emit authWithTicket
  // so the server just authenticates and drops the user into the normal lobby.
  //
  // CRITICAL: we also listen for `loginResult` from the server and complete
  // the login via useGameStore. Without this listener the deep-link spinner
  // stays forever because the store never transitions to isLoggedIn=true.
  const didEmitDeepLinkRef = useRef(false);
  useEffect(() => {
    if (!deepLinkContext) return;
    if (didEmitDeepLinkRef.current) return;
    const socket = getSocket();
    if (!socket) return;

    let cancelled = false;
    let connectHandler = null;
    let timeoutId = null;

    const handleLoginResult = (result) => {
      if (cancelled) return;
      if (result?.success && result.userData) {
        try {
          if (result.token) setAuthToken(result.token);
          sessionStorage.setItem('poker_keep_signed_in', '1');
        } catch {}
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        setDeepLinkTimedOut(false);
        useGameStore.getState().login(result.userData, result.token);
      } else {
        // Surface the actual server error (token_already_used / ticket_expired /
        // token_verify_failed) so the spinner stops and the user sees a sensible
        // "Sign in manually" path instead of an infinite retry loop.
        console.error('[deep-link] authWithTicket failed:', result?.error);
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        setDeepLinkTimedOut(true);
      }
    };
    socket.on('loginResult', handleLoginResult);

    // auth-only tickets can fire before isLoggedIn (that's the point); waitlist
    // tickets also include auth, so same rule applies.
    const emit = () => {
      if (cancelled) return;
      if (didEmitDeepLinkRef.current) return;
      didEmitDeepLinkRef.current = true;
      connectHandler = null;
      if (deepLinkContext.source === 'waitlist') {
        socket.emit('joinWithWaitlistContext', {
          token: deepLinkContext.token,
          context: {
            source: 'waitlist',
            gameId: deepLinkContext.gameId,
            position: deepLinkContext.position,
            venue: deepLinkContext.venue,
            startTime: deepLinkContext.startTime,
          },
        });
      } else {
        socket.emit('authWithTicket', { token: deepLinkContext.token });
      }

      // Fail-safe: if loginResult never comes back within 15s, surface a
      // retry affordance so the user isn't staring at a forever-spinner.
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        timeoutId = null;
        console.warn('[deep-link] loginResult never received — ticket likely expired or socket stalled');
        setDeepLinkTimedOut(true);
      }, 15000);
    };

    if (socket.connected) {
      emit();
    } else {
      connectHandler = emit;
      socket.once('connect', emit);
    }

    return () => {
      cancelled = true;
      socket.off('loginResult', handleLoginResult);
      if (connectHandler) socket.off('connect', connectHandler);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [deepLinkContext, connStatus]);

  const handleSpinComplete = () => {
    setShowSpinReveal(false);
  };

  // OAuth2 callback — intercept before any other screen
  if (isOAuthCallback) {
    return <AuthCallback />;
  }

  // Shared replay link — show viewer without any auth requirement
  if (sharedReplay) {
    return (
      <HandReplayViewer
        history={sharedReplay}
        onClose={() => { window.history.replaceState(null, '', window.location.pathname); window.location.reload(); }}
      />
    );
  }

  if (loading) {
    return <LoadingScreen exiting={loadingExiting} />;
  }

  if (displayedScreen === 'login') {
    // Deep-link from marketing/player app: we have a signed ticket in the URL
    // and are actively authenticating via authWithTicket. Show a spinner
    // instead of the login screen — making users "sign in again" here is
    // exactly the bug we're avoiding.
    if (deepLinkContext) {
      return (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'linear-gradient(135deg,#0a0a1a,#1a1a3e 60%,#0d0d2b)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#e0e0e0', fontFamily: 'system-ui',
        }}>
          <div style={{
            padding: 32, background: 'rgba(22,33,62,0.95)', borderRadius: 16,
            textAlign: 'center', maxWidth: 360,
          }}>
            {deepLinkTimedOut ? (
              <>
                <div style={{ fontSize: 40, marginBottom: 8 }}>⏱️</div>
                <h2 style={{ color: '#fcd34d', margin: 0, fontSize: 20 }}>Connection timed out</h2>
                <p style={{ opacity: 0.75, marginTop: 10, fontSize: 14, lineHeight: 1.4 }}>
                  We didn't hear back from the server. Your ticket may have expired or your
                  network is unstable. Try again, or sign in normally below.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
                  <button
                    onClick={() => {
                      didEmitDeepLinkRef.current = false;
                      setDeepLinkTimedOut(false);
                      // Force the effect to re-run by bumping connStatus dep via a no-op
                      const socket = getSocket();
                      if (socket) {
                        if (socket.connected) socket.emit('authWithTicket', { token: deepLinkContext.token });
                        else socket.connect();
                      }
                    }}
                    style={{
                      padding: '10px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: 'linear-gradient(135deg,#B388FF,#7C3AED)', color: '#fff', fontWeight: 700,
                    }}
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => {
                      // Drop the deep-link context and fall through to normal login
                      window.location.replace('/');
                    }}
                    style={{
                      padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
                      background: 'transparent', color: '#aaa',
                      border: '1px solid rgba(255,255,255,0.2)',
                    }}
                  >
                    Sign in manually
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{
                  width: 40, height: 40, margin: '0 auto 16px',
                  border: '3px solid rgba(233,69,96,0.3)', borderTopColor: '#e94560',
                  borderRadius: '50%', animation: 'dl-spin 0.8s linear infinite',
                }} />
                <h2 style={{ color: '#fcd34d', margin: 0, fontSize: 22 }}>Signing you in…</h2>
                <p style={{ opacity: 0.7, marginTop: 12, fontSize: 14 }}>
                  Connecting your American Pub Poker session.
                </p>
              </>
            )}
            <style>{`@keyframes dl-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      );
    }
    return <LoginScreen />;
  }

  if (displayedScreen === 'chooseUsername') {
    return <ChooseUsernameScreen />;
  }

  if (displayedScreen === 'customizer') {
    return (
      <Suspense fallback={<ChunkLoader />}>
        <AvatarCustomizer />
        <AchievementPopup />
        <LevelUpPopup />
        <KeyboardShortcuts />
        <Tutorial />
      </Suspense>
    );
  }

  if (displayedScreen === 'career') {
    return (
      <Suspense fallback={<ChunkLoader />}>
        <CareerMode />
        <AchievementPopup />
        <LevelUpPopup />
        <KeyboardShortcuts />
        <Tutorial />
      </Suspense>
    );
  }

  if (displayedScreen === 'table') {
    return (
      <div className={`screen-transition ${transitionClass}`} style={{ position: 'relative', width: '100vw', height: '100vh' }}>
        <MultiTableTabs />
        <Suspense fallback={<ChunkLoader />}><GameScene /></Suspense>
        <ErrorBoundary><Suspense fallback={null}><GameHUD /></Suspense></ErrorBoundary>
        <AchievementPopup />
        <LevelUpPopup />
        <MissionsPanel />

        {/* Player Notes popup */}
        {notesPlayer && (
          <PlayerNotes
            playerName={notesPlayer}
            onClose={() => setNotesPlayer(null)}
          />
        )}

        {/* Spin & Go reveal overlay */}
        {showSpinReveal && (
          <SpinReveal multiplier={spinMultiplier} onComplete={handleSpinComplete} />
        )}

        <KeyboardShortcuts />
        <Tutorial />

        {/* Quick game result overlay */}
        {quickGameResult && (
          <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 900,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{
              background: 'linear-gradient(135deg, #0d0d0d, #111111)',
              border: '2px solid #00D9FF',
              borderRadius: '20px',
              padding: '40px 50px',
              textAlign: 'center',
              color: '#ffffff',
              animation: 'spin-overlay-in 0.3s ease-out',
            }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#00D9FF', marginBottom: '12px' }}>
                Game Over
              </div>
              <div style={{ fontSize: '1.1rem', marginBottom: '8px' }}>
                {quickGameResult.message}
              </div>
              {quickGameResult.multiplier && (
                <div style={{ fontSize: '0.9rem', color: '#00D9FF' }}>
                  Multiplier: {quickGameResult.multiplier}x
                </div>
              )}
              <button
                onClick={() => setQuickGameResult(null)}
                style={{
                  marginTop: '20px',
                  padding: '8px 24px',
                  border: '1px solid #00D9FF',
                  borderRadius: '8px',
                  background: 'transparent',
                  color: '#00D9FF',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`screen-transition ${transitionClass}`}>
      {(connStatus === 'disconnected' || connStatus === 'error') && (
        // PWA audit #7: bumped size + added a bottom mirror so the
        // indicator is unmissable during live play. Top banner catches
        // desktop/landscape; bottom pill is thumb-reachable on mobile
        // portrait where the top of the screen is a dead zone.
        <>
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
            pointerEvents: 'none',
            display: 'flex', justifyContent: 'center',
            paddingTop: 'max(env(safe-area-inset-top, 0px), 6px)',
          }}>
            <div style={{
              pointerEvents: 'auto',
              background: connStatus === 'error' ? 'rgba(220,38,38,0.97)' : 'rgba(234,88,12,0.97)',
              color: '#fff', fontSize: '0.92rem', fontWeight: 700,
              padding: '10px 18px', letterSpacing: '0.03em',
              borderRadius: '0 0 12px 12px',
              maxWidth: 'min(92vw, 560px)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.1)',
              animation: 'connWarnPulse 1.5s ease-in-out infinite alternate',
            }}>
              {connStatus === 'error' ? '⚠ Connection error — retrying…' : '⚠ Reconnecting to server…'}
            </div>
          </div>
          <div style={{
            position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 110px)',
            left: '50%', transform: 'translateX(-50%)',
            zIndex: 99999, pointerEvents: 'none',
          }}>
            <div style={{
              background: connStatus === 'error' ? 'rgba(220,38,38,0.95)' : 'rgba(234,88,12,0.95)',
              color: '#fff', fontSize: '0.78rem', fontWeight: 700,
              padding: '6px 14px', borderRadius: '999px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
              whiteSpace: 'nowrap',
            }}>
              ● Offline — reconnecting
            </div>
          </div>
          <style>{`@keyframes connWarnPulse { from { filter: brightness(0.92) } to { filter: brightness(1.15) } }`}</style>
        </>
      )}
      <Suspense fallback={<ChunkLoader />}>
        <Lobby activeTab={activeNavTab} onTabChange={handleNavTabChange} pwaAction={pwaAction} waitlistContext={waitlistContext} />
      </Suspense>
      <AchievementPopup />
      <LevelUpPopup />
      <BottomNav activeTab={activeNavTab} onTabChange={handleNavTabChange} />
      <KeyboardShortcuts />
      <Tutorial />
      <PWAInstallPrompt />
    </div>
  );
}

function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
