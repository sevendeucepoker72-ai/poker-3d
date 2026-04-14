import { useEffect, useState, useRef, Component, lazy, Suspense } from 'react';
import { useGameStore } from './store/gameStore';
import { useTableStore } from './store/tableStore';

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

// Thin fallback shown while a lazy chunk loads
function ChunkLoader() {
  return <div style={{ position:'fixed', inset:0, background:'#000000', display:'flex', alignItems:'center', justifyContent:'center', color:'#aaaaaa', fontFamily:'system-ui', fontSize:'0.9rem' }}>Loading…</div>;
}

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const [connStatus, setConnStatus] = useState('disconnected');
  const [loading, setLoading] = useState(true);
  const [loadingExiting, setLoadingExiting] = useState(false);
  // Shared replay link — show viewer without requiring login
  const [sharedReplay] = useState(() => parseReplayParam());
  // PWA shortcut action — auto-trigger after login
  const [pwaAction] = useState(() => getPWAAction());
  const [showSpinReveal, setShowSpinReveal] = useState(false);
  const [spinMultiplier, setSpinMultiplier] = useState(2);
  const [quickGameResult, setQuickGameResult] = useState(null);
  const [notesPlayer, setNotesPlayer] = useState(null);
  const [activeNavTab, setActiveNavTab] = useState('home');

  // Transition state
  const [displayedScreen, setDisplayedScreen] = useState(screen);
  const [transitionClass, setTransitionClass] = useState('');
  const prevScreenRef = useRef(screen);

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

    // Hand history from server
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

  // Auto-login with saved token
  useEffect(() => {
    let localToken = null;
    let sessionToken = null;
    try { localToken   = localStorage.getItem('poker_auth_token'); }   catch { /* private mode */ }
    try { sessionToken = sessionStorage.getItem('poker_auth_token'); } catch { /* private mode */ }
    const savedToken = localToken || sessionToken;
    if (!savedToken) return;

    const socket = getSocket();
    if (!socket) return;

    let timeoutId = null;
    let cancelled = false;

    const clearStoredToken = () => {
      try { localStorage.removeItem('poker_auth_token'); }   catch {}
      try { localStorage.removeItem('poker_keep_signed_in'); } catch {}
      try { sessionStorage.removeItem('poker_auth_token'); } catch {}
    };

    const handleAutoLoginResult = (result) => {
      if (cancelled) return;
      clearTimeout(timeoutId);
      socket.off('loginResult', handleAutoLoginResult);
      if (result?.success && result.userData) {
        try {
          if (localToken) {
            localStorage.setItem('poker_auth_token', result.token);
            localStorage.setItem('poker_keep_signed_in', '1');
          } else {
            sessionStorage.setItem('poker_auth_token', result.token);
          }
        } catch {}
        useGameStore.getState().login(result.userData, result.token);
      } else {
        clearStoredToken();
      }
    };

    const tryAutoLogin = () => {
      if (cancelled) return;
      socket.on('loginResult', handleAutoLoginResult);
      socket.emit('tokenLogin', { token: savedToken });

      // If no response within 5 seconds, give up and show login screen
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        socket.off('loginResult', handleAutoLoginResult);
        clearStoredToken();
      }, 5000);
    };

    if (socket.connected) {
      tryAutoLogin();
    } else {
      socket.on('connect', tryAutoLogin);
    }

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      socket.off('connect', tryAutoLogin);
      socket.off('loginResult', handleAutoLoginResult);
    };
  }, []);

  // Handle seat reconnection after token login
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleReconnected = (data) => {
      // Server has re-joined us to our reserved table/seat
      // The broadcastGameState after reconnect will update table state via existing handlers
      console.log('[App] Reconnected to reserved seat', data);
    };

    socket.on('reconnectedToTable', handleReconnected);
    return () => socket.off('reconnectedToTable', handleReconnected);
  }, []);

  const handleSpinComplete = () => {
    setShowSpinReveal(false);
  };

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
    return <LoginScreen />;
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
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
          background: connStatus === 'error' ? 'rgba(220,38,38,0.95)' : 'rgba(180,83,9,0.95)',
          color: '#fff', textAlign: 'center', fontSize: '0.8rem', fontWeight: 600,
          padding: '6px 12px', letterSpacing: '0.03em',
        }}>
          {connStatus === 'error' ? '⚠ Connection error — retrying…' : '⚠ Reconnecting to server…'}
        </div>
      )}
      <Suspense fallback={<ChunkLoader />}>
        <Lobby activeTab={activeNavTab} onTabChange={handleNavTabChange} pwaAction={pwaAction} />
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
