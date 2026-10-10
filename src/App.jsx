import { useEffect, useState, useRef, Component, lazy, Suspense } from 'react';
import { useGameStore } from './store/gameStore';
import { useTableStore } from './store/tableStore';
import { getAuthToken, setAuthToken, clearAuthToken, setOAuthItem } from './services/tokenStorage';
import { runSocketLogin, isCredentialDead, isDefinitiveLoginFailure } from './services/socketAuth';
// 2026-10-07 — game suspension + guest play OFF: server play refusals (C5).
import {
  reportPlayRefusal, playRefusalCode, playRefusalText, refusalNeedsSignIn,
  startAccountSignIn, GUEST_DISABLED,
} from './services/playRefusal';
import PlayRefusalNotice from './components/ui/PlayRefusalNotice';
import { reauthSocket } from './services/socketReauth';
// 2026-10-09 — resumable ticket sessions (R1), guest carry-over (R2) and
// "Create a free account" (R3).
import {
  saveTicketResume, readResumeRecordForBoot, readResumeRecordForUser, clearResumeRecord,
  setTabSession, markTicketSignIn, RESUME_INVALID, RESUME_EVENT,
} from './services/sessionResume';
import { stashGuestCredential } from './services/tokenStorage';
import { maybeOfferGuestCarryOver, resetGuestCarryOver } from './services/guestCarryOver';
import GuestCarryOverPrompt from './components/ui/GuestCarryOverPrompt';
import CreateAccountLink from './components/ui/CreateAccountLink';
// 2026-08-17 P2 — STATIC, deliberately. This was `await import('./services/
// bridge')` inside the boot-auth IIFE, and the comment there claimed the
// Promise.race below covered "a dynamic-import stall". It could not: the import
// was awaited BEFORE the race was constructed, so a stalled module fetch hung
// the whole boot sequence with the deadline not yet armed.
//
// And the fetch was real. Rollup reports INEFFECTIVE_DYNAMIC_IMPORT for this
// module (PlayerAppPushBanner.jsx already imports it statically, so the code
// itself lives in the eager main chunk) — but it still emitted a separate
// 115-byte re-export facade, `assets/bridge-*.js`, which index.html does NOT
// modulepreload. So the dynamic import bought zero code-splitting and cost one
// uncached, un-preloaded, blocking network round-trip on the critical path of
// every bridged sign-in. On the flaky mobile uplinks that dominate this outage,
// a stall there produced ZERO auto-login attempts — the exact outcome this work
// exists to eliminate.
//
// Static import removes the round-trip and the failure mode outright, at no
// byte cost (the module was already in the main chunk). Keep it static.
import { consumeBridgeIfPresent, BRIDGE_EXCHANGE_TIMEOUT_MS } from './services/bridge';
import FriendlyErrorFallback from './components/ui/FriendlyErrorFallback';

// Root ErrorBoundary (2026-04-22 audit fixes).
// Previously this wrapped ONLY GameHUD and rendered the raw stack into the
// DOM, which (a) left everything outside GameHUD unprotected, and (b)
// leaked implementation detail to end users. The boundary now wraps the
// full App tree at the default export site, and renders
// FriendlyErrorFallback. The stack is still logged to console for devs.
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, _info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error && error.stack ? error.stack : error);
  }
  render() {
    if (this.state.error) {
      return <FriendlyErrorFallback onReload={() => {
        // Give the user a soft-reset escape hatch first; if the underlying
        // render failure is deterministic, this will re-throw and they can
        // hit Reload again for a hard page reload.
        this.setState({ error: null });
      }} />;
    }
    return this.props.children;
  }
}
import { useProgressStore } from './store/progressStore';
import { connectToServer, getSocket, subscribeConnectionStatus } from './services/socketService';
import { initPersistence, syncToServer, installBeforeUnloadSync } from './services/persistenceService';
import LoadingScreen from './components/ui/LoadingScreen';
import LoginScreen from './components/ui/LoginScreen';
// 2026-05-04 unified-push phase 3 — cross-site notification banner.
import PlayerAppPushBanner from './components/PlayerAppPushBanner';
import AuthCallback from './components/ui/AuthCallback';
// 2026-05-07 — SilentCallback + trySilentLogin retired. iframe-based silent
// SSO is broken in modern Chrome regardless of cookie config (CHIPS partition
// keys for iframe contexts are scoped to embedding site, not auth-server).
// Cross-site SSO now relies on top-level redirect from LoginScreen, which
// works because top-level navigation to auth-server makes its cookies
// first-party for the duration of the redirect.
// 2026-07-06 P2 auth fix — RefreshTokenRevokedError no longer imported here:
// the steady-state refresh timer (the only consumer) moved to
// services/authScheduler.js; refreshAccessToken is still used by the BOOT
// auto-login path below.
import { isAuthCallback as checkIsAuthCallback, refreshAccessToken, detectInAppBrowser } from './services/authService';
import { logAuthEvent } from './services/authEvents';
import { startAuthCrossTabListener } from './services/authCrossTab';
// Heavy screens loaded lazily — only when the user first navigates to them
const Lobby = lazy(() => import('./components/ui/Lobby'));
const StreamOverlayView = lazy(() => import('./components/ui/StreamOverlayView'));
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
import { API_BASE } from './config';
import { checkSubscriptionHealth, isPushSupported, notify } from './hooks/usePushNotifications';
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

/** OBS browser-source overlay: ?overlay=<tableId>&delay=<sec>&theme=<name> */
function parseOverlayParam() {
  try {
    const p = new URLSearchParams(window.location.search);
    const tableId = p.get('overlay');
    if (!tableId) return null;
    return { tableId, delaySec: Math.max(0, Number(p.get('delay')) || 0), theme: p.get('theme') || 'sapphire' };
  } catch (_) {
    return null;
  }
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
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) { setError('Name must be at least 2 characters'); return; }
    if (trimmed.length > 20) { setError('Name must be 20 characters or less'); return; }
    // Mirror the server-side whitelist (authManager.ts:DISPLAY_NAME_RE)
    // so users get immediate feedback instead of a round-trip rejection.
    // Server is still the real gate — never trust this check alone.
    // 2026-05-13 — narrowed to ASCII-only to match the server-side
    // tightening (display names must be plain English).
    if (!/^[A-Za-z0-9 _.'-]+$/.test(trimmed)) {
      setError("Name can only contain English letters, numbers, spaces, and _ . - '");
      return;
    }
    if (!/[A-Za-z0-9]/.test(trimmed)) {
      setError('Name must contain at least one letter or number');
      return;
    }
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
      <div style={{ width: 'min(360px, calc(100vw - 32px))', padding: 32, background: '#111827', borderRadius: 16, border: '1px solid rgba(120, 160, 255,0.2)' }}>
        <h2 style={{ color: '#ffd24a', margin: '0 0 8px', textAlign: 'center' }}>Choose Your Name</h2>
        <p style={{ color: '#888', fontSize: '0.85rem', textAlign: 'center', margin: '0 0 24px' }}>
          This is how other players will see you at the table.
        </p>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Enter display name" maxLength={20} autoFocus
          aria-label="Enter display name"
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 10, fontSize: '1rem',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(120, 160, 255,0.3)',
            color: '#fff', outline: 'none', boxSizing: 'border-box',
          }}
        />
        {error && <div style={{ color: '#F87171', fontSize: '0.8rem', marginTop: 8 }}>{error}</div>}
        <button onClick={handleSubmit} disabled={loading} style={{
          width: '100%', padding: '14px', marginTop: 16, borderRadius: 10,
          background: 'linear-gradient(135deg, #ffd24a, #ffd24abb)',
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
  return <div style={{ position:'fixed', inset:0, background:'#050c20', display:'flex', alignItems:'center', justifyContent:'center', color:'#aaaaaa', fontFamily:'system-ui', fontSize:'0.9rem' }}>Loading…</div>;
}

function App() {
  const screen = useGameStore((s) => s.screen);
  const isLoggedIn = useGameStore((s) => s.isLoggedIn);
  const [connStatus, setConnStatus] = useState('disconnected');
  const [loading, setLoading] = useState(true);
  const [loadingExiting, setLoadingExiting] = useState(false);
  // OAuth2 callback detection
  //
  // 2026-10-06 — resettable. This used to be a mount-only latch with no
  // setter, so <AuthCallback/> stayed on screen until a full page load. HEAD's
  // only way out was AuthCallback's always-firing 25s timer that reloaded to
  // '/'; once the socket login was routed through runSocketLogin (which clears
  // its watchdog on success) a SUCCESSFUL sign-in sat on "Signing in..."
  // forever. AuthCallback now calls handleAuthCallbackExit when it is done.
  const [isOAuthCallback, setIsOAuthCallback] = useState(() => checkIsAuthCallback());
  // Set when the callback exits signed in (or with a definitive refusal), so
  // the boot auto-login effect — which re-runs when isOAuthCallback flips to
  // false — does not start a second, redundant login on the same socket.
  const skipBootAutoLoginRef = useRef(false);
  const handleAuthCallbackExit = ({ signedIn = false, notice = null } = {}) => {
    console.warn('[auth-callback-exit]', signedIn ? 'signed-in' : (notice ? 'refused' : 'to-login'));
    if (signedIn || notice) skipBootAutoLoginRef.current = true;
    if (notice) {
      try { useGameStore.setState({ sessionExpiredNotice: notice }); } catch { /* best-effort */ }
    }
    try { window.history.replaceState({}, '', '/'); } catch { /* ignore */ }
    setIsOAuthCallback(false);
  };
  // Shared replay link — show viewer without requiring login
  const [sharedReplay] = useState(() => parseReplayParam());
  const [overlayConfig] = useState(() => parseOverlayParam());
  // PWA shortcut action — auto-trigger after login
  const [pwaAction] = useState(() => getPWAAction());
  // Deep-link from player app (americanpub.poker). Either a waitlist hand-off
  // (auto-seat at Beginner's + banner) or a general play ticket (auth-only).
  const [deepLinkContext] = useState(() => parseDeepLinkContext());
  const waitlistContext = deepLinkContext?.source === 'waitlist' ? deepLinkContext : null;
  const [deepLinkTimedOut, setDeepLinkTimedOut] = useState(false);
  // 2026-10-07 — the deep-link ticket was REFUSED as a play refusal
  // ({code, message}: player_suspended / login_required / guest_disabled).
  // Shown verbatim instead of the generic "Connection timed out" screen.
  const [deepLinkRefusal, setDeepLinkRefusal] = useState(null);
  const [deepLinkSignInError, setDeepLinkSignInError] = useState(null);
  // 2026-07-06 audit P2 — a #bridge_id_token in the URL at mount means we
  // arrived via cross-site SSO and the bridge consumer (below) is about to
  // exchange it + socket-auth. Show a spinner instead of a LoginScreen flash
  // until that resolves. Cleared by the bridge IIFE on completion (ok/fail) and
  // as a safety net when isLoggedIn flips true.
  const [bridgePending, setBridgePending] = useState(() => {
    try { return new URLSearchParams((window.location.hash || '').replace(/^#/, '')).has('bridge_id_token'); }
    catch { return false; }
  });
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

  // 2026-07-06 audit P2 — clear the bridge-handoff spinner on login success,
  // and cap it at 26s (just past the bridge socket-auth 25s timeout) so a
  // failed/stalled handoff falls through to LoginScreen instead of hanging.
  useEffect(() => {
    if (!bridgePending) return undefined;
    if (isLoggedIn) { setBridgePending(false); return undefined; }
    const t = setTimeout(() => setBridgePending(false), 26000);
    return () => clearTimeout(t);
  }, [bridgePending, isLoggedIn]);

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

  // 2026-05-12 — CLAUDE.md Pattern B self-heal port from player-web.
  // Refresh `userRoles`, `isVip`, `vipLevel`, `vipExpiration` from
  // GET /users/:id/me on mount and on every tab-resume, merging into
  // useGameStore. This auto-heals stale-session fields underneath the
  // user without requiring sign-out + back-in (e.g. admin grants the
  // user `dealer`, or extends VIP — that change must reach this tab).
  //
  // Storage note: poker-3d uses a zustand store (useGameStore), NOT a
  // localStorage `pokerSession` blob like player-web. So the merge
  // target is `mergeServerUserFields` on the store; there is no
  // localStorage rewrite step here.
  //
  // The log tags `[dealer-auto-heal]` and `[vip-auto-heal]` are the
  // canonical-features anchors for this feature — Terser preserves
  // string literals, so the deploy guard greps the built bundle for
  // these exact tags.
  useEffect(() => {
    const userId = useGameStore.getState().userId;
    if (!isLoggedIn || !userId) return;

    // Async import to avoid pulling sessionLifecycle into the App
    // bundle's eager chunk; it's a tiny module but the dynamic import
    // matches the rest of the App.jsx lazy-load pattern.
    let cancelled = false;
    let removeOnResume = null;

    const refreshUserRolesFromMe = async () => {
      try {
        // /users/:id/me is fetched unauthenticated (Pattern A contract:
        // the public-safe shape always contains `roles`, `isVip`,
        // `vipLevel`, `vipExpiration` for this exact use case). The
        // auth-server's extraTokenClaims uses the same path; we are a
        // peer caller.
        const resp = await fetch(
          `${API_BASE}/users/${encodeURIComponent(userId)}/me`,
          { method: 'GET', credentials: 'omit' },
        );
        if (cancelled || !resp.ok) return;
        const body = await resp.json().catch(() => null);
        const user = body?.data || body;
        if (!user) return;

        const patch = {};
        if (Array.isArray(user.roles)) patch.userRoles = user.roles;
        if (typeof user.isVip === 'boolean') patch.isVip = user.isVip;
        if (typeof user.vipLevel === 'number') patch.vipLevel = user.vipLevel;
        const vipExp = user.vipExpiration ?? user.vipLevelExpiration ?? null;
        if (vipExp !== null) patch.vipExpiration = vipExp;
        if (!Object.keys(patch).length) return;

        const before = useGameStore.getState();
        useGameStore.getState().mergeServerUserFields(patch);
        const after = useGameStore.getState();

        // Log tags only when the value actually changed — keeps the
        // console quiet on no-op refreshes while still surfacing real
        // self-heal events for incident triage.
        if (patch.userRoles && before.userRoles !== after.userRoles) {
          try { console.debug('[dealer-auto-heal] userRoles merged from /me'); } catch {}
        }
        if (patch.isVip !== undefined && before.isVip !== after.isVip) {
          try { console.debug('[vip-auto-heal] isVip merged from /me'); } catch {}
        }
      } catch {
        // Swallow — reactive 401 paths (api fetches, socket reconnect)
        // catch real auth failures. This refresh is best-effort.
      }
    };

    // Self-heal a drifted push subscription (browser has a sub the server
    // lost). Fire-and-forget on mount + resume; only when push is supported and
    // already permitted, so it never prompts. 'resynced' needs no user action.
    const healPushSubscription = () => {
      try {
        if (isPushSupported() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          checkSubscriptionHealth(userId).catch(() => {});
        }
      } catch { /* best-effort */ }
    };

    // Local nudge when a daily bonus is claimable and the tab is backgrounded.
    // Reads the existing client daily-claim state (progress.lastLoginClaimDate)
    // — no new server field. notify.dailyBonus self-guards on permission.
    const notifyDailyBonusIfClaimable = () => {
      try {
        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return;
        const progress = useProgressStore.getState().progress;
        const today = new Date().toISOString().slice(0, 10);
        if (progress && progress.lastLoginClaimDate !== today) {
          notify.dailyBonus();
        }
      } catch { /* best-effort */ }
    };

    // Fire once on mount.
    refreshUserRolesFromMe();
    healPushSubscription();

    // Re-fire on every tab-resume. sessionLifecycle.onResume returns an
    // unsubscriber.
    import('./services/sessionLifecycle.js').then((mod) => {
      if (cancelled) return;
      if (typeof mod.onResume === 'function') {
        removeOnResume = mod.onResume(() => {
          refreshUserRolesFromMe();
          healPushSubscription();
          notifyDailyBonusIfClaimable();
        });
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      try { if (typeof removeOnResume === 'function') removeOnResume(); } catch {}
    };
  }, [isLoggedIn]);

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

  // 2026-10-09 — guest carry-over (contract R2). After any successful sign-in
  // (and on reconnect), if this device still holds a retired guest account's
  // token, ask the server what it holds and offer ONE "Bring over your guest
  // progress?" prompt. services/guestCarryOver.js decides whether to show
  // anything (it never claims without the player's tap). Signing out hides it.
  const carryUserId = useGameStore((s) => s.userId);
  useEffect(() => {
    if (!isLoggedIn) { resetGuestCarryOver(); return; }
    if (connStatus !== 'connected') return;
    maybeOfferGuestCarryOver().catch(() => {});
  }, [isLoggedIn, carryUserId, connStatus]);

  // Connect to server on mount and wire up event listeners
  useEffect(() => {
    const socket = connectToServer();
    const emoteTimeouts = new Set();
    const quickGameTimeouts = new Set();
    const tournamentTimeouts = new Set();

    // SINGLE 'connect' handler — previously we registered two separate
    // listeners for this event (one setting connected state, one doing
    // oauthLogin + syncTableState). Having two listeners means both
    // fire on every reconnect, so oauthLogin ran twice per reconnect.
    // Merged 2026-04-22 per audit finding #15.
    //
    // Capture handler refs so the effect cleanup below can call
    // `socket.off('connect', handleConnect)` with the specific fn. Calling
    // `socket.off('connect')` with no second arg tears down EVERY listener
    // for that event, including the service-level status + pending-action
    // flush handlers registered inside socketService.js.
    const handleConnect = () => {
      useTableStore.getState().setConnected(true);

      // Re-authenticate on every socket connect (initial + reconnect). Railway
      // restarts, brief network drops, and phone-locks all produce a new socket
      // id on the server, so the authSessions entry for the old id is gone —
      // we have to redo the handshake or any in-game action we emit next will
      // be rejected as unauthenticated. Uses the stored OAuth access token.
      //
      // Use tokenStorage so both localStorage (keep-signed-in) and
      // sessionStorage (tab-only) variants are checked on reconnect.
      // 2026-10-09 — a ticket session may hold only its resume token
      // (services/sessionResume.js; bound to this tab's user); reauthSocket
      // presents it.
      const st = useGameStore.getState();
      if (!getAuthToken() && !readResumeRecordForUser(st.userId)) return;
      if (!st.isLoggedIn) return;
      // 2026-10-07 review fix — this used to be a fire-and-forget
      // `socket.emit('oauthLogin', { accessToken: token })`: no refresh first
      // (access tokens live 15 min, so a phone asleep longer reconnected with
      // an expired one) and nobody listened for the answer, so a rejected
      // token left the socket signed out for the rest of the page's life —
      // and, with guest play off, every play attempt refused login_required.
      // reauthSocket refreshes first when the token is expired / near expiry,
      // sends oauthLogin requestId-scoped, waits for loginResult, and retries
      // once with a forced refresh if the server rejects the token itself.
      const reauth = reauthSocket(socket, { reason: 'connect' });

      // PWA audit #2 + #11: after (re)connecting, if the user was
      // previously on a table, explicitly request a fresh game-state
      // sync. The server's reservedSeats restore path kicks in from
      // the oauthLogin handler, but this extra emit guarantees the
      // client has the current hand + seat occupancy + turn state,
      // protecting against the "resume to a stale table view" bug.
      // 2026-10-07 — sent once the re-auth above has ANSWERED (it was a fixed
      // 350ms "so oauthLogin completes first", which no longer holds now that
      // an expired token is refreshed before oauthLogin is sent). The server
      // answers syncTableState from the socket's seat session, which only the
      // oauthLogin seat restore creates — sent earlier, it gets a spectator
      // view. A superseded re-auth means a newer connection is doing its own.
      const ts = useTableStore.getState();
      if (ts.gameState?.tableId || ts.currentTableId) {
        const tableId = ts.gameState?.tableId || ts.currentTableId;
        reauth.then((r) => {
          if (r?.reason === 'superseded' || !socket.connected) return;
          try { socket.emit('syncTableState', { tableId }); } catch { /* best-effort resync */ }
        });
      }
    };
    const handleDisconnect = () => useTableStore.getState().setConnected(false);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    // Handle both full state and delta patches from the server
    socket.on('gameState', (data) => {
      const ts = useTableStore.getState();
      let state;
      if (data && typeof data === 'object' && 'full' in data) {
        // New delta-aware protocol
        if (data.full) {
          // Full state replacement
          state = data.state;
        } else {
          // Partial delta merge contract:
          //   - delta[key] = <value>  → set prev[key] to <value>
          //   - delta[key] = null     → CLEAR prev[key] (set to null). Use
          //                             null explicitly; JSON.stringify drops
          //                             `undefined` on the wire, so the server
          //                             can't clear a field any other way.
          //   - key absent from delta → prev[key] unchanged (standard spread)
          //
          // The raw `{...prev, ...data.delta}` spread is already mostly
          // correct (null overwrites to null, undefined to undefined). This
          // block hardens one edge case: if a downstream consumer treats
          // `null` as "missing" but we want "explicitly cleared", the
          // contract above is now documented and enforced below.
          // 2026-04-22 audit fix: key `prev` on the delta's tableId. The old
          // code read the currently-displayed gameState regardless of target,
          // so a delta for table B would merge against table A's state when
          // the player had A selected — corrupting B's cached state in the
          // activeTables map. Fall back to the top-level gameState only when
          // the delta carries no tableId (legacy single-table path).
          const deltaTableId = data.delta?.tableId;
          const prev = deltaTableId
            ? (ts.activeTables.get(deltaTableId)?.gameState ?? null)
            : ts.gameState;
          state = prev ? { ...prev, ...data.delta } : { ...data.delta };
          // Clear stale per-hand state whenever the hand changes, regardless of
          // whether the delta itself includes fresh values (they'll arrive in a
          // subsequent message). Prevents old cards / a stale handResult leaking
          // into a new hand.
          // 2026-07-06 FIX: this guarded on `handId`, but the server never sends
          // handId — it sends `handNumber`. So this whole block was DEAD CODE:
          // `handResult` never cleared and lingered into every subsequent hand,
          // which (via `&& !gameState.handResult`) permanently hid the
          // between-turns pre-action pills after the first showdown, and left
          // stale winner banners/cards. Compare `handNumber` so it actually runs.
          if (data.delta?.handNumber != null && data.delta.handNumber !== prev?.handNumber) {
            if (!data.delta.yourCards) state.yourCards = [];
            if (!data.delta.selectedDiscards) state.selectedDiscards = [];
            if (!data.delta.handResult) state.handResult = null;
          }
        }
      } else {
        // Legacy full-state format (backwards compatibility)
        state = data;
      }

      // 2026-07-07 gap-fill [5] — multi-table routing. A snapshot for a table
      // that is NOT the one currently on screen must ONLY refresh that table's
      // activeTables cache; it must never clobber the displayed table's
      // gameState / seat / spectator chrome. Before gap [5] only the primary
      // table broadcast, so this was latent; now every background multi-table
      // pane broadcasts a full snapshot each tick (server broadcastGameState),
      // which would otherwise flicker the on-screen table to the wrong data and
      // point the action bar at the wrong seat. currentTableId is null for a
      // normal single-table player, so this guard is a no-op for them.
      const stId = state?.tableId;
      if (stId && ts.currentTableId && stId !== ts.currentTableId) {
        ts.updateActiveTable(stId, state);
        return;
      }

      ts.setGameState(state);
      ts.setMySeat(state?.yourSeat ?? -1);

      // Handle spectator mode.
      // 2026-04-22 audit fix: unconditionally mirror the server flag so
      // transitions OFF (sit down, claim a seat) actually flip the local
      // UI back to player mode. Previously this only latched true, which
      // left the UI stuck in spectator chrome after the server already
      // considered the socket a seated player.
      ts.setIsSpectating(!!state?.isSpectator);

      // Handle training data from server
      if (state?.trainingData) {
        ts.setTrainingData(state.trainingData);
      } else if (state !== null) {
        ts.setTrainingData(null);
      }

      // Update multi-table state if applicable
      if (state?.tableId) {
        ts.updateActiveTable(state.tableId, state);
      }
    });

    socket.on('tableList', (tables) => useTableStore.getState().setTables(tables));

    // 2026-10-07 — a play refusal (suspended / no account) can answer ANY play
    // path, including ones with no spinner of their own (club-challenge
    // auto-join, joinAdditionalTable, career start, rebuy, tournament register).
    // Those used to reach only this console.error, so the player saw nothing.
    // Route them to the shared PlayRefusalNotice; everything else logs as before.
    socket.on('error', (err) => {
      if (reportPlayRefusal(err)) return;
      console.error('Server error:', err);
    });
    // joinByInviteCode answers on 'joinError' rather than 'error'.
    const handleJoinErrorRefusal = (err) => { reportPlayRefusal(err); };
    socket.on('joinError', handleJoinErrorRefusal);

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
      // 2026-06-10 audit (Pattern B self-heal for the wallet): keep the
      // lobby wallet (useGameStore.chips) live. It was stamped once at
      // oauthLogin from userData.chips and never refreshed, so any post-
      // login balance change — daily reward, buy-in refund, stand-up
      // cash-out, admin grant — didn't show until the user signed out and
      // back in. The lobby reads useGameStore.chips first (see Lobby.jsx
      // chipCount precedence), so syncing it here fixes every reader.
      //
      // progress.chips on this payload is the server's authoritative
      // in-memory balance: poker-server only emits playerProgress AFTER
      // hydrateFromDB (index.ts hydrateAndPushProgress / sendProgressToPlayer
      // → getClientProgress.chips), so it's always the real DB value, not
      // the client-side 5000 default the original Lobby precedence guarded
      // against. We only sync when it's a finite number so a malformed
      // partial can't zero the wallet. NOTE: master-API /users/:id/me does
      // NOT return chips — poker-server's socket is the only live wallet
      // source for .online, which is why this lives here and not in
      // App.jsx's refreshUserRolesFromMe.
      if (progress && Number.isFinite(progress.chips)) {
        try { useGameStore.getState().setChips(progress.chips); } catch {}
      }
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
      // Hydrate tableStore.handHistories from the DB-backed list so the
      // "🃏 Last Hand" rail button is available IMMEDIATELY after login
      // instead of waiting for the user to finish another hand.
      // Server returns newest-first; tableStore keys newest as last
      // element, so reverse + slice to the last 20 (matches
      // addHandHistory's cap). Filter malformed records (no players
      // array) so old pre-migration rows don't crash the replay viewer.
      const hh = Array.isArray(payload?.handHistory) ? payload.handHistory : [];
      const usable = hh.filter((h) => h && Array.isArray(h.players) && h.players.length > 0);
      if (usable.length > 0) {
        const oldestFirst = usable.slice().reverse().slice(-20);
        useTableStore.setState({ handHistories: oldestFirst });
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

    // Batch 5 (2026-07-01): admin broadcast / maintenance / kick / table-close.
    // These make the AdminDashboard actions visible to players.
    socket.on('serverAnnouncement', (data) => {
      if (data?.message) useProgressStore.getState().addNotification({ type: 'mission', message: String(data.message).slice(0, 280) });
    });
    socket.on('maintenanceMode', (data) => {
      if (data?.enabled) useProgressStore.getState().addNotification({ type: 'mission', message: 'Server maintenance in progress — play may be briefly interrupted.' });
    });
    socket.on('tableClosedByAdmin', () => {
      useProgressStore.getState().addNotification({ type: 'mission', message: 'This table was closed by an administrator.' });
    });
    socket.on('kickedByAdmin', (data) => {
      // The server disconnects this socket right after; just surface why.
      useProgressStore.getState().addNotification({ type: 'mission', message: data?.reason || 'You were removed by an administrator.' });
    });
    // Batch 5c: staking payout — a player you backed cashed in a tournament.
    socket.on('stakingPayout', (data) => {
      useProgressStore.getState().addNotification({
        type: 'mission',
        message: `Staking payout${data?.sellerName ? ` from ${data.sellerName}` : ''}!`,
        reward: { chips: data?.amount || 0, xp: 0, stars: 0 },
      });
    });

    // 2026-07-05 completeness fix — surface server events that were EMITTED but
    // had no client listener, so they fired into the void: tournament bounty,
    // table rebalance/break, friend + table invites, and shop purchase feedback.
    socket.on('bountyAwarded', (data) => {
      useProgressStore.getState().addNotification({
        type: 'mission',
        message: `Bounty collected${data?.eliminated ? ` — knocked out ${data.eliminated}` : ''}!`,
        reward: { chips: data?.amount || 0, xp: 0, stars: 0 },
      });
    });
    socket.on('friendRequestReceived', (data) => {
      useProgressStore.getState().addNotification({ type: 'mission', message: `${data?.from || 'Someone'} sent you a friend request.` });
    });
    socket.on('tableInvite', (data) => {
      // Carry the inviter's tableId so the toast can render an actionable "Join"
      // button (handled in AchievementPopup). Falls back to a plain toast when
      // no tableId is present (older senders that didn't include one).
      useProgressStore.getState().addNotification({
        type: 'mission',
        message: `${data?.from || 'A friend'} invited you to their table.`,
        inviteTableId: data?.tableId || null,
      });
    });
    socket.on('tableBroken', () => {
      useProgressStore.getState().addNotification({ type: 'mission', message: 'Your tournament table is combining with another.' });
    });
    socket.on('playerMoved', (data) => {
      const toTable = data?.toTable || data?.tableId;
      if (toTable) { try { useTableStore.getState().switchActiveTable(toTable); } catch { /* new table state arrives via broadcast */ } }
      useProgressStore.getState().addNotification({
        type: 'mission',
        message: `You've been moved to a new table${data?.toSeat != null ? `, seat ${Number(data.toSeat) + 1}` : ''}.`,
      });
    });
    socket.on('purchaseResult', (data) => {
      if (data?.success) {
        useProgressStore.getState().addNotification({ type: 'mission', message: data?.mysteryReward ? `Mystery box: ${data.mysteryReward}!` : 'Purchase complete.' });
      } else if (data?.error) {
        useProgressStore.getState().addNotification({ type: 'mission', message: `Purchase failed: ${data.error}` });
      }
    });

    // Club challenge accepted — the server spawned a heads-up table (stakes =
    // buy-in) and sent this to BOTH participants. Auto-join it here (global, so a
    // participant with the Clubs panel closed still joins). Read live store state.
    socket.on('clubChallengeAccepted', (payload) => {
      if (!payload?.tableId) return;
      const gs = useGameStore.getState();
      try {
        useTableStore.getState().joinTable(payload.tableId, gs.playerName, -1, payload.stakes, gs.avatar);
      } catch { /* ignore */ }
      useProgressStore.getState().addNotification({ type: 'mission', message: 'Club challenge starting — joining your heads-up table!' });
    });

    // All-in insurance (cashout) feedback. Server computes + settles; these are
    // just player-facing confirmations of the guaranteed lock-in and the result.
    socket.on('insuranceAccepted', (data) => {
      useProgressStore.getState().addNotification({
        type: 'mission',
        message: `Insurance locked in — ${(data?.cashout || 0).toLocaleString()} chips guaranteed (${data?.equityPct || 0}% equity).`,
      });
    });
    socket.on('insuranceSettled', (data) => {
      const d = Number(data?.delta) || 0;
      useProgressStore.getState().addNotification({
        type: 'mission',
        message: d > 0
          ? `Insurance paid out — protected ${d.toLocaleString()} chips after the bad beat.`
          : `Insurance settled — you kept your locked-in ${(data?.cashout || 0).toLocaleString()} chips.`,
      });
    });

    // Career Mode completion — the server now detects a stage win/loss (nothing
    // used to), so persist career progress to localStorage (survives sessions;
    // was sessionStorage-read-only, never written). CareerMode reads this back.
    socket.on('careerGameComplete', (data) => {
      try {
        const KEY = 'pokerCareerProgress';
        const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
        const vk = `venue_${data?.venue}`;
        const entry = cur[vk] || { stagesCompleted: 0, stars: [0, 0, 0] };
        if (data?.won && data?.stage != null) {
          entry.stagesCompleted = Math.max(entry.stagesCompleted || 0, data.stage + 1);
          if (!Array.isArray(entry.stars)) entry.stars = [0, 0, 0];
          entry.stars[data.stage] = Math.max(entry.stars[data.stage] || 0, data.stars || 0);
        }
        cur[vk] = entry;
        localStorage.setItem(KEY, JSON.stringify(cur));
      } catch { /* ignore */ }
      // Show the same result overlay quick games use, and return to the lobby —
      // the career table is torn down server-side shortly after.
      setQuickGameResult({
        type: 'career',
        message: data?.won ? '⭐ Career stage cleared!' : 'Career stage failed — try again.',
      });
      const t = setTimeout(() => { quickGameTimeouts.delete(t); setQuickGameResult(null); }, 5000);
      quickGameTimeouts.add(t);
      useGameStore.getState().setScreen?.('lobby');
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

    // Table reactions (clap/laugh/cry/shock from EmoteWheel). The server
    // rebroadcasts these with { seatIndex, reactionId, playerName }. Normalize
    // reactionId -> emoteId so it reuses the same addEmote render + auto-expire
    // machinery as 'emote' above (EMOTE_MAP already contains the reaction ids).
    socket.on('tableReaction', (data) => {
      const store = useTableStore.getState();
      const timestamp = Date.now();
      store.addEmote({ seatIndex: data.seatIndex, emoteId: data.reactionId, playerName: data.playerName, isReaction: true, timestamp });
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
      // `socket.off(event)` without a second arg removes ALL listeners for
      // that event (socket.io v4 semantics). For 'connect' / 'disconnect'
      // we MUST pass the specific handler ref, because socketService.js
      // registers its own status + pending-action-flush listeners on those
      // events — a bare `socket.off('connect')` would silently kill them
      // and break the connection banner + action queue after this effect
      // re-ran. For game-event listeners below, bare off() is fine since
      // only this effect registers those.
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('gameState');
      socket.off('tableList');
      socket.off('error');
      // Specific handler ref: CreateTableModal / Lobby register their own
      // 'joinError' listeners, which a bare off('joinError') would remove.
      socket.off('joinError', handleJoinErrorRefusal);
      socket.off('handStarted');
      socket.off('chatMessage');
      socket.off('trainingToggled');
      socket.off('sitOutToggled');
      socket.off('spinReveal');
      socket.off('quickGameOver');
      socket.off('quickGameStarted');
      socket.off('careerGameStarted');
      socket.off('careerGameComplete');
      socket.off('clubChallengeAccepted');
      socket.off('insuranceAccepted');
      socket.off('insuranceSettled');
      socket.off('bountyAwarded');
      socket.off('friendRequestReceived');
      socket.off('tableInvite');
      socket.off('tableBroken');
      socket.off('playerMoved');
      socket.off('purchaseResult');
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
      socket.off('tableReaction');
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
    // ...or if that callback already signed this tab in (it re-runs this
    // effect by resetting isOAuthCallback — see handleAuthCallbackExit).
    if (skipBootAutoLoginRef.current) return;

    let cancelled = false;
    let cancelBridgeLogin = null;
    let cancelResumeLogin = null;
    let cancelRefreshLogin = null;
    let cancelLegacyLogin = null;
    let localAutoLoginStarted = false;
    const socket = getSocket();
    if (!socket) return;

    // 2026-08-17 — the wholesale credential wipe that used to run on ANY
    // socket-auth failure is GONE from the login paths. Two narrower rules
    // replace it:
    //   • the refresh path deletes tokens only on a NON-transient token-endpoint
    //     rejection (the catch below), never on a network blip;
    //   • the legacy path deletes ONLY the legacy token, and only when
    //     socketAuth.isCredentialDead says the server actually rejected that
    //     token (tryLegacyAutoLogin below).
    // A socket-auth failure on its own is not evidence any credential is dead.

    // 2026-08-17 — SEQUENCE the boot auth flows instead of racing them.
    //
    // A bridged arrival used to start the bridge exchange AND (synchronously,
    // milliseconds earlier) the local refresh / stale-token auto-login, all on
    // the same socket. That is what produced two `oauthLogin`/`tokenLogin`
    // emits inside the same tick — visible in the auth-server log as two
    // introspections 5ms apart, one of a dead token and one of the fresh
    // bridge token. When a #bridge_id_token is present the bridge is the
    // authoritative credential, so the local paths now WAIT and only run if the
    // bridge doesn't produce a session. requestId scoping (socketAuth.js) is
    // the belt; this is the braces.
    const hasBridgeHandoff = (() => {
      try { return new URLSearchParams((window.location.hash || '').replace(/^#/, '')).has('bridge_id_token'); }
      catch { return false; }
    })();

    // 2026-05-07 — Bridge-token boot consumer. If we arrived via a link
    // from another American Pub Poker site, the URL fragment contains
    // bridge_id_token=<jwt>. Exchange it for our own tokens, then run the
    // normal socket-side oauthLogin flow. If no bridge token, this is a
    // no-op (consumeBridgeIfPresent returns reason='no-bridge').
    (async () => {
      try {
        // 2026-08-17 P1 — RACE the exchange against a deadline.
        //
        // Sequencing the boot flows made startLocalAutoLogin() reachable ONLY
        // from inside this IIFE, behind this await. bridge.js now aborts its
        // own fetch, but this second deadline is deliberate belt-and-braces:
        // if the promise never settles for ANY reason (a browser that ignores
        // the abort signal, a suspended tab resuming mid-fetch), the
        // refresh-token and legacy paths would never run and the user would
        // reach LoginScreen having attempted NOTHING — while holding a valid
        // 180-day refresh token. Pre-sequencing, the parallel refresh path
        // would simply have signed them in.
        //
        // NOTE — an earlier revision of this comment also claimed the race
        // covered "a dynamic-import stall". It never did (the import was
        // awaited before the race was built) and it no longer needs to: the
        // bridge module is now a STATIC import at the top of this file. See
        // that import for the measurement that forced the change.
        //
        // +1500ms over the fetch's own budget so the inner abort normally wins
        // and we get its specific reason; this only fires if that fails.
        const TIMEOUT = Symbol('bridge-exchange-timeout');
        let raceTimer = null;
        const result = await Promise.race([
          consumeBridgeIfPresent(),
          new Promise((resolve) => {
            raceTimer = setTimeout(() => resolve(TIMEOUT), (BRIDGE_EXCHANGE_TIMEOUT_MS || 20000) + 1500);
          }),
        ]).finally(() => { if (raceTimer) clearTimeout(raceTimer); });
        if (cancelled) return;
        if (result === TIMEOUT) {
          try { logAuthEvent('login_failed', { reason: 'bridge_exchange_timeout' }); } catch {}
          setBridgePending(false);
          startLocalAutoLogin();
          return;
        }
        // 2026-07-06 audit P2 — token exchange resolved (ok or not). If it
        // failed (no bridge / exchange error), drop the spinner NOW so the user
        // falls straight to LoginScreen instead of waiting. On success we keep
        // the spinner until oauthLogin flips isLoggedIn (handleResult below), so
        // the lobby only appears once the socket is actually authenticated.
        if (!result?.ok) {
          // bridge.js's own AbortController deadline normally wins the race
          // above, so log its timeout under the same reason — otherwise the
          // deadline firing would be invisible on the Auth Health dashboard.
          if (result?.reason === 'timeout') {
            try { logAuthEvent('login_failed', { reason: 'bridge_exchange_timeout', via: 'abort' }); } catch {}
          }
          setBridgePending(false);
          startLocalAutoLogin();
          return;
        }
        // Tokens are now persisted. Drive the same socket-side oauthLogin
        // flow the refresh path uses (extracted as runOauthLoginViaSocket).
        const tokens = result.tokens;
        if (!tokens?.access_token) { setBridgePending(false); startLocalAutoLogin(); return; }
        // 2026-08-17 OUTAGE FIX. Three things changed here, all forced by live
        // evidence that this branch was firing on results that weren't ours and
        // then destroying valid credentials:
        //
        //  (a) runSocketLogin tags the emit with a requestId and ignores any
        //      loginResult carrying someone else's — the stale-token
        //      `tokenLogin` this app fires CONCURRENTLY on the same socket
        //      (tryLegacyAutoLogin, below) can no longer be mistaken for the
        //      bridge's own answer. See services/socketAuth.js.
        //  (b) a socket-auth failure NO LONGER calls clearStoredTokens(). The
        //      auth-server minted these tokens seconds ago; they are valid for
        //      the master API and for a retry. poker-server declining to seat
        //      the socket is not evidence the credential is dead, and wiping it
        //      is what forced a full re-authentication (and, for one user, a
        //      global sign-out that killed their americanpub.poker session too).
        //  (c) we resolve the spinner IMMEDIATELY and say what happened,
        //      instead of leaving bridgePending true and burning the blanket
        //      26s watchdog before showing a bare LoginScreen.
        //
        //  (d) 2026-08-17 P1 — and it now RECOVERS. Setting bridgePending=false
        //      plus a notice was still "we hold valid credentials and refuse to
        //      use them": a user with a live 180-day refresh token who hit any
        //      bridge hiccup was dropped on the login screen with those tokens
        //      retained and unused. Every non-definitive failure now falls
        //      through to startLocalAutoLogin(), which is exactly what would
        //      have signed them in before the flows were sequenced.
        //
        // DEFINITIVE vs RECOVERABLE, and why the list is this short:
        //   Definitive = "this credential is dead, retrying with a DIFFERENT
        //   stored credential is pointless AND the user must act". Only the
        //   token endpoint's `invalid_grant` / `token_revoked` prove that, and
        //   they arrive on the refresh path (authService's
        //   RefreshTokenRevokedError), never on a socket loginResult. See
        //   services/socketAuth.js:isCredentialDead — the single definition
        //   both call sites share.
        //   `identity_conflict` is added here as definitive for a different
        //   reason: it is a deliberate server-side REFUSAL (the local row
        //   belongs to another master account), so retrying with any other
        //   credential this browser holds cannot help and would only produce a
        //   second confusing failure. The user needs support, not a retry.
        // Everything else — maintenance, user_upsert_failed, a Railway blip, an
        // unlabelled fault, a timeout — is recoverable: try the local paths.
        const finishBridge = (noticeKey, detail, { recover = true } = {}) => {
          try { logAuthEvent('login_failed', detail); } catch {}
          setBridgePending(false);
          try {
            useGameStore.setState({ sessionExpiredNotice: noticeKey });
          } catch { /* notice is best-effort */ }
          // Deferred a tick so the notice/state above lands first and a
          // synchronous re-entry can't race setBridgePending.
          if (recover) setTimeout(() => { if (!cancelled) startLocalAutoLogin(); }, 0);
        };
        cancelBridgeLogin = runSocketLogin({
          socket,
          event: 'oauthLogin',
          payload: { accessToken: tokens.access_token },
          label: 'bridge',
          // 25s covers worst-case Railway cold start (websocket upgrade can
          // take 5–8s on a cold edge POP) + introspection + /me.
          timeoutMs: 25000,
          isCancelled: () => cancelled,
          onResult: (r) => {
            if (r?.success && r.userData) {
              try { logAuthEvent('login_success', { via: 'bridge' }); } catch {}
              // 2026-10-09 (R1 / D1) — the tab is now in this OIDC session,
              // which re-authenticates with its own refresh flow: a ticket
              // session's resume record must not resume over it next boot.
              clearResumeRecord();
              setTabSession('oidc', r.userData.id);
              useGameStore.getState().oauthLogin(tokens, r.userData);
              return;
            }
            // Carry the server's own reason through to telemetry. Discarding
            // it is why this outage was undiagnosable for weeks: the row said
            // "bridge_socket_auth_failed" and nothing else, while the server
            // knew exactly which branch it took.
            const definitive = isDefinitiveLoginFailure(r);
            finishBridge(
              definitive
                // 2026-10-07 — a play refusal (player_suspended) carries the
                // owner's own sentence: show it verbatim, not the
                // identity_conflict text.
                ? (playRefusalText(r) || 'This account could not be matched securely. Please contact support.')
                : 'We could not connect you to the game server. Please try signing in again.',
              {
                reason: 'bridge_socket_auth_failed',
                code: String(r?.code || 'unlabelled').slice(0, 64),
                error: String(r?.error || '').slice(0, 200),
              },
              { recover: !definitive }
            );
          },
          onTimeout: () => {
            finishBridge(
              'The game server did not respond. Please try signing in again.',
              { reason: 'bridge_socket_timeout' }
            );
          },
        });
      } catch {
        // Silent failure — fall through to the normal boot path.
        setBridgePending(false);
        startLocalAutoLogin();
      }
    })();

    // The local (non-bridge) boot paths: refresh-token first, legacy token
    // second. Runs immediately on a normal load; on a bridged arrival it is
    // deferred until the bridge handoff resolves without a session.
    function startLocalAutoLogin() {
      if (cancelled || localAutoLoginStarted) return;
      localAutoLoginStarted = true;

      // Attempt OAuth refresh token flow — check localStorage first
      // (keep-signed-in) then sessionStorage fallback.
      const oauthRefresh = (() => {
        try { return localStorage.getItem('poker_oauth_refresh') || sessionStorage.getItem('poker_oauth_refresh'); }
        catch { return null; }
      })();

      // 2026-10-09 (contract R1) — resumable ticket session. A player who came
      // in through the player app's "Play Online" ticket holds no refresh
      // token; the ticket itself was burned on first use, so a reload (iOS
      // PWA resume is often one) used to land them on the login screen. The
      // resume token poker-server issued with that login signs them back in.
      // Only ticket sessions have one (D1). It goes FIRST — the device's
      // latest sign-in was that ticket session (any OIDC / legacy sign-in
      // since then clears the record) — but only when no fresh deep-link
      // ticket is being presented right now (that ticket is the authoritative
      // credential, like the bridge). A non-definitive failure falls through
      // to the refresh-token / legacy paths exactly as before.
      const resumeRec = deepLinkContext ? null : readResumeRecordForBoot();
      if (resumeRec) {
        tryResumeAutoLogin(resumeRec, () => runRefreshOrLegacy(oauthRefresh));
        return;
      }
      runRefreshOrLegacy(oauthRefresh);
    }

    // 2026-10-09 — resumeSession at boot (see startLocalAutoLogin). Answers
    // on loginResult in authWithTicket's success shape, with a fresh token.
    function tryResumeAutoLogin(rec, fallback) {
      let fellBack = false;
      const fallBack = () => {
        if (fellBack || cancelled) return;
        fellBack = true;
        fallback();
      };
      cancelResumeLogin = runSocketLogin({
        socket,
        event: RESUME_EVENT,
        payload: { resumeToken: rec.token },
        label: 'boot-resume',
        timeoutMs: 15000,
        // Never blind re-send (the server may treat the token as single-use);
        // a timeout falls back to the other boot paths instead of waiting.
        reemitOnReconnect: false,
        armWatchdogOnEmit: true,
        keepListeningAfterTimeout: false,
        isCancelled: () => cancelled,
        onResult: (r) => {
          if (r?.success && r.userData) {
            saveTicketResume(r, { keepIfMissing: true, expectUserId: rec.userId });
            setTabSession('ticket', r.userData.id);
            useGameStore.getState().login(r.userData, getAuthToken() || null);
            return;
          }
          if (r?.code === RESUME_INVALID) clearResumeRecord();
          try {
            logAuthEvent('login_failed', {
              reason: 'boot_resume_failed',
              code: String(r?.code || 'unlabelled').slice(0, 64),
              error: String(r?.error || '').slice(0, 200),
            });
          } catch { /* telemetry is best-effort */ }
          if (isDefinitiveLoginFailure(r)) {
            const notice = playRefusalText(r) || 'This account could not be matched securely. Please contact support.';
            try { useGameStore.setState({ sessionExpiredNotice: notice }); } catch { /* notice is best-effort */ }
            return;
          }
          fallBack();
        },
        onTimeout: () => {
          try { logAuthEvent('login_failed', { reason: 'boot_resume_timeout' }); } catch { /* telemetry is best-effort */ }
          fallBack();
        },
      });
    }

    // The refresh-token path, then the legacy token (both unchanged; split
    // out of startLocalAutoLogin 2026-10-09 so the resume path can fall
    // through to them).
    function runRefreshOrLegacy(oauthRefresh) {
      if (cancelled) return;
      if (!oauthRefresh) {
        // 2026-05-07 — iframe-based silent SSO retired (broken in modern Chrome
        // CHIPS semantics). Cross-site SSO now flows through LoginScreen + a
        // top-level redirect to /authorize when the user clicks "Sign In". If
        // the auth-server SSO cookie is alive, the redirect auto-bounces back
        // with a code; otherwise the password form shows.
        tryLegacyAutoLogin();
        return;
      }

      refreshAccessToken(oauthRefresh)
        .then((rawTokens) => {
          if (cancelled) return;
          // 2026-07-06 audit P1 — refreshAccessToken can resolve to a peer-tab
          // object that (pre-fix) carried no refresh_token/id_token when another
          // tab won the cross-tab refresh race. Guard against writing undefined
          // over the persisted credential: only overwrite refresh/id when the
          // resolved value is truthy, and merge the existing value into the
          // object handed to oauthLogin (mirrors authScheduler's `|| existing`).
          // Belt-and-suspenders to the source fix in _readPeerRefreshedTokens.
          const existingId = (() => {
            try { return localStorage.getItem('poker_oauth_id_token') || sessionStorage.getItem('poker_oauth_id_token') || ''; }
            catch { return ''; }
          })();
          const tokens = {
            access_token: rawTokens.access_token,
            refresh_token: rawTokens.refresh_token || oauthRefresh,
            id_token: rawTokens.id_token || existingId,
            expires_in: rawTokens.expires_in,
          };
          // Use tokenStorage so the access token respects "Keep me signed in".
          setAuthToken(tokens.access_token);
          // 2026-08-17 LOGIN-4 — these three used to be raw setItem on the
          // keep-signed-in store, which WROTE one store without SWEEPING the
          // other. The read path (getOAuthItem / App.jsx:1184) prefers
          // localStorage, so a session-only login left the PREVIOUS user's
          // persistent refresh token in place and the next boot on a shared
          // venue laptop signed in as them. setOAuthItem writes one store and
          // removes the key from the other, so exactly one copy can exist.
          if (rawTokens.refresh_token) setOAuthItem('poker_oauth_refresh', rawTokens.refresh_token);
          if (rawTokens.id_token) setOAuthItem('poker_oauth_id_token', rawTokens.id_token);
          if (rawTokens.expires_in != null) {
            setOAuthItem('poker_token_expiry', String(Date.now() + Number(rawTokens.expires_in) * 1000));
          }

          // 2026-08-17 — requestId-scoped (see services/socketAuth.js): this
          // flow can run at the same instant as the bridge handoff and the
          // legacy tokenLogin on the SAME socket, and previously accepted
          // whichever loginResult landed first regardless of owner.
          //
          // The failure branch no longer calls clearStoredTokens(). The
          // refresh we JUST completed proves the credential is alive; a socket
          // rejection from poker-server does not disprove it. The old code
          // deleted a working session on any server-side hiccup.
          cancelRefreshLogin = runSocketLogin({
            socket,
            event: 'oauthLogin',
            payload: { accessToken: tokens.access_token },
            label: 'boot-refresh',
            // 25s watchdog: worst-case Railway cold start (websocket upgrade
            // 5–8s on a cold edge POP) plus introspect + /me.
            timeoutMs: 25000,
            isCancelled: () => cancelled,
            onResult: (result) => {
              if (result?.success && result.userData) {
                // 2026-10-09 (R1 / D1) — the tab is now in this OIDC session:
                // a ticket session's resume record must not resume over it.
                clearResumeRecord();
                setTabSession('oidc', result.userData.id);
                useGameStore.getState().oauthLogin(tokens, result.userData);
                return;
              }
              try {
                logAuthEvent('login_failed', {
                  reason: 'boot_refresh_socket_auth_failed',
                  code: String(result?.code || 'unlabelled').slice(0, 64),
                  error: String(result?.error || '').slice(0, 200),
                });
              } catch {}
              // 2026-10-07 — if the server refused this sign-in as a play
              // refusal, say so on the login screen (verbatim) instead of
              // leaving the player there with no explanation.
              const refusalNotice = playRefusalText(result);
              if (refusalNotice) {
                try { useGameStore.setState({ sessionExpiredNotice: refusalNotice }); } catch { /* notice is best-effort */ }
              }
            },
            onTimeout: () => {
              try { logAuthEvent('login_failed', { reason: 'boot_refresh_socket_timeout' }); } catch {}
            },
          });
        })
        .catch((err) => {
          if (cancelled) return;
          // PWA audit #3: iOS Safari / PWA Storage Access API evicts
          // localStorage after ~7 days of no app interaction. When the
          // user comes back, the refresh token we saved is gone AND the
          // call fails silently. Previously this path tried a legacy
          // auto-login which also has no valid token — so the UI got
          // stuck on "Signing in…" forever.
          //
          // 2026-08-17 LOGIN-6 — but this catch used to take NO argument and
          // wipe the session for ANY rejection, including
          // RefreshTokenTransientError (a 12s fetch timeout on bar wifi, a DNS
          // blip, being offline). Twelve seconds of bad signal permanently
          // destroyed a 180-day "keep me signed in" session that was never
          // revoked. Only a DEFINITIVE invalid_grant justifies deleting it.
          const transient = err?.name === 'RefreshTokenTransientError'
            || err?.transient === true
            || /network|timeout|abort|failed to fetch/i.test(String(err?.message || ''));
          if (transient) {
            try { logAuthEvent('refresh_transient', { reason: 'boot_refresh', keptSession: true }); } catch {}
            // Leave every token in place and fall through to the legacy path,
            // which will simply do nothing if there is no legacy token. The
            // next boot (or authScheduler's retry) picks the session back up.
            tryLegacyAutoLogin();
            return;
          }
          for (const k of ['poker_oauth_refresh','poker_oauth_id_token','poker_token_expiry','poker_auth_token']) {
            try { localStorage.removeItem(k);   } catch {}
            try { sessionStorage.removeItem(k); } catch {}
          }
          // 2026-10-09 (R1) — the session was revoked (signed out elsewhere,
          // admin-revoked): a resume record must not sign this device back in.
          try { clearResumeRecord(); } catch { /* never block the wipe */ }
          tryLegacyAutoLogin();
        });
    }

    // Legacy token auto-login (existing HS256 JWT).
    // tokenStorage.getAuthToken reads localStorage (persistent) first,
    // then sessionStorage fallback — so "Keep me signed in" actually
    // works across browser restarts.
    function tryLegacyAutoLogin() {
      const savedToken = getAuthToken();
      if (!savedToken) return;

      // 2026-08-17 — THIS is the flow that broke the bridge handoff.
      //
      // On a returning player's phone a stale `poker_auth_token` is almost
      // always present, so this fires on EVERY boot — including the boot that
      // is simultaneously consuming a #bridge_id_token. The server answers a
      // dead token with `loginResult{success:false}` in ~15ms while the bridge's
      // own oauthLogin is still doing introspection + DB work, and (pre-fix)
      // every `loginResult` listener on the socket received it. The bridge
      // treated this rejection as its own and wiped its freshly-minted tokens.
      //
      // Two changes: requestId scoping so this result reaches only this flow,
      // and a failure path that clears ONLY the legacy token it just proved
      // dead — never the OAuth credentials, which it knows nothing about.
      //
      // 2026-08-17 P3 — "proved dead" is now enforced, not assumed. This is the
      // ONE remaining place in the boot path that discards a credential, so it
      // is where isCredentialDead belongs (it previously existed, tested codes
      // the server never sends, and was called from nowhere). A blanket drop
      // here threw the token away on `maintenance`, `rate_limited`,
      // `user_upsert_failed` (a Railway Postgres blip) and `handler_exception`
      // — none of which the server even evaluated the token for.
      // 2026-10-09 — a legacy token is usually a retired "Play as Guest"
      // credential: the only key to that guest's chips + progress. Set it
      // aside before discarding it (tokenStorage.stashGuestCredential keeps
      // ONLY a GuestNNNN token — a pre-OIDC account's legacy token is simply
      // dropped) so the American Pub Poker account the player signs in with
      // can be offered the one-time carry-over. poker-server verifies it then:
      // an EXPIRED but correctly signed guest token is still accepted for the
      // carry-over (contract R2 — expiry is waived there, never for login).
      const dropLegacyTokenOnly = () => {
        try { stashGuestCredential(savedToken); } catch { /* never block the drop */ }
        try { clearAuthToken(); } catch { /* ignore */ }
      };

      cancelLegacyLogin = runSocketLogin({
        socket,
        event: 'tokenLogin',
        payload: { token: savedToken },
        label: 'legacy',
        // 10s — legacy token auto-login only needs the server to look up a
        // local JWT + hit the DB, no Master API calls. 5s was too aggressive
        // under Railway cold start (3–4s before the socket emit is accepted).
        timeoutMs: 10000,
        // 2026-10-06 — the 10s starts at the EMIT, as it did in HEAD (the
        // timer lived inside doLogin). Armed at call time it was spent while a
        // cold socket was still connecting, and the timeout's cleanup removed
        // the pending connect-emit, so the legacy login was never sent.
        armWatchdogOnEmit: true,
        isCancelled: () => cancelled,
        onResult: (result) => {
          if (result?.success && result.userData) {
            // Re-persist the refreshed token using the user's stored
            // keep-signed-in preference. Preserves localStorage placement.
            setAuthToken(result.token);
            // 2026-10-09 (R1 / D1) — the tab is now in this legacy session
            // (never resumable): drop any ticket session's resume record.
            clearResumeRecord();
            setTabSession('legacy', result.userData.id);
            useGameStore.getState().login(result.userData, result.token);
            return;
          }
          if (isCredentialDead(result)) dropLegacyTokenOnly();
          // 2026-10-07 — guest play is OFF. A legacy token here is most often a
          // pre-2026-10-07 "Play as Guest" credential; if the server refuses it
          // as one (guest_disabled) it can never be used again, so drop it.
          // Either way, show the server's text on the login screen, whose only
          // button is the American Pub Poker sign-in.
          const refusalCode = playRefusalCode(result);
          if (refusalCode) {
            if (refusalCode === GUEST_DISABLED) dropLegacyTokenOnly();
            try { useGameStore.setState({ sessionExpiredNotice: playRefusalText(result) }); } catch { /* notice is best-effort */ }
          }
        },
        // A watchdog expiry proves nothing about the token — the server may
        // never have answered (Railway cold start, socket churn). Keep it; the
        // next boot re-tries. Dropping on timeout cost returning players their
        // legacy session over a single cold start.
        onTimeout: () => {},
      });
    }

    // On a bridged arrival the local paths are deferred — the bridge IIFE
    // above calls startLocalAutoLogin() only if the handoff fails to produce a
    // session, so the two never race on the same socket.
    if (!hasBridgeHandoff) startLocalAutoLogin();

    return () => {
      cancelled = true;
      if (cancelBridgeLogin) cancelBridgeLogin();
      if (cancelResumeLogin) cancelResumeLogin();
      if (cancelRefreshLogin) cancelRefreshLogin();
      if (cancelLegacyLogin) cancelLegacyLogin();
    };
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

  // Cross-tab logout propagation — if another tab clears the auth token
  // or refresh token (or writes the explicit logout marker), drop the
  // session here too. Lifecycle stays tied to having an active OAuth
  // session (keyed on oauthTokenExpiry), matching the old combined effect.
  //
  // 2026-07-06 P2 auth fix — the steady-state OAuth refresh timer that used
  // to live in this effect is GONE. It duplicated services/authScheduler.js
  // (both proactively refreshed 5 min before expiry) with a DIVERGENT
  // failure policy: this one force-logged-out after a single 30s retry, so
  // a ~60s network blip at the refresh boundary logged a seated player out
  // mid-hand despite a perfectly valid session — and which scheduler fired
  // first was a race. authScheduler.js (started at module load in main.jsx)
  // is now the ONLY proactive refresher: transient failures retry forever
  // and never log out; a genuinely revoked refresh token dispatches
  // 'poker:session-expired' (handled in main.jsx → single gameStore.logout
  // teardown incl. socket disconnect + login-screen notice).
  // NOTE: the BOOT-time refresh + socket oauthLogin path (auto-login effect
  // above, refreshAccessToken → oauthLogin emit) is intentionally unchanged
  // — only the steady-state re-scheduler + its force-logout were removed.
  // Everything the removed timer wrote (poker_auth_token via setAuthToken,
  // poker_oauth_refresh, poker_token_expiry, store authToken via setAuth)
  // is also written by authScheduler + authService.refreshAccessToken.
  useEffect(() => {
    const expiry = useGameStore.getState().oauthTokenExpiry;
    if (!expiry) return;

    const stopCrossTab = startAuthCrossTabListener(() => {
      try {
        const s = useGameStore.getState();
        // 2026-07-02 Finding #4 — peer-tab logout: clear LOCAL state only. The
        // tab that initiated the logout already redirected to /session/end and
        // performed the global logout, so this peer must NOT redirect too
        // (skipRedirect), else every open tab bounces through /session/end.
        if (typeof s.logout === 'function' && s.isLoggedIn) s.logout({ skipRedirect: true });
      } catch (err) {
        console.error('[App] cross-tab logout handler threw:', err);
      }
    });

    return stopCrossTab;
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
  // 2026-08-17 P1 — the Retry button (in the timed-out deep-link screen) needs
  // to restart the SAME flow. It used to get away with a bare
  // `socket.emit('authWithTicket')` because the old raw `loginResult` listener
  // stayed registered forever; runSocketLogin correctly tears its listener down
  // when the flow resolves, so Retry now re-runs the whole flow through here.
  const deepLinkRetryRef = useRef(null);
  useEffect(() => {
    if (!deepLinkContext) return;
    const socket = getSocket();
    if (!socket) return;

    let cancelled = false;
    let cancelFlow = null;
    let flowSocket = null;
    // True once a timeout notice was shown for the current attempt, so a late
    // success can be recorded as such (the timeout already logged a failure).
    let timeoutReported = false;

    // 2026-08-17 P1 — routed through runSocketLogin. This was the LAST
    // unconverted `loginResult` producer/consumer pair, and it broke in BOTH
    // directions on a returning player's phone, where the boot flows run on the
    // same socket milliseconds apart:
    //   • inbound — a stale legacy token's ~15ms rejection was consumed here as
    //     the ticket's answer, so the user was told their link had failed while
    //     the ticket auth was still in flight;
    //   • outbound — this flow's un-attributed result was ACCEPTED by the
    //     back-compat rule in socketAuth.js and acted on by the legacy/bridge
    //     flows.
    // Because that back-compat rule accepts un-echoed frames by design, an
    // unconverted emitter is a PERMANENT hole, not a transitional one — which
    // is why poker-server's authWithTicket now echoes requestId and carries a
    // `code` on every branch.
    const startDeepLinkAuth = () => {
      if (cancelled) return;
      if (cancelFlow) { cancelFlow(); cancelFlow = null; }
      didEmitDeepLinkRef.current = true;
      timeoutReported = false;
      const isWaitlist = deepLinkContext.source === 'waitlist';
      // Use the CURRENT socket instance: socketService.forceReconnect() can
      // replace it after socket.io's reconnect loop gives up, and a flow bound
      // to the dead instance could never emit.
      flowSocket = getSocket() || socket;
      cancelFlow = runSocketLogin({
        socket: flowSocket,
        // auth-only tickets can fire before isLoggedIn (that's the point);
        // waitlist tickets also include auth, so the same rule applies.
        event: isWaitlist ? 'joinWithWaitlistContext' : 'authWithTicket',
        payload: isWaitlist
          ? {
              token: deepLinkContext.token,
              context: {
                source: 'waitlist',
                gameId: deepLinkContext.gameId,
                position: deepLinkContext.position,
                venue: deepLinkContext.venue,
                startTime: deepLinkContext.startTime,
              },
            }
          : { token: deepLinkContext.token },
        label: isWaitlist ? 'waitlist' : 'ticket',
        // Fail-safe: if loginResult never comes back within 15s OF THE EMIT,
        // surface a retry affordance so the user isn't staring at a
        // forever-spinner.
        timeoutMs: 15000,
        // ONE-SHOT credential. Both server handlers call markTicketUsed(), so a
        // reconnect re-emit is answered `ticket_replayed` — it would convert a
        // recoverable socket blip into a permanent "request a new link".
        reemitOnReconnect: false,
        // 2026-10-06 review fixes (explicit here; they are also the one-shot
        // defaults in socketAuth.js):
        //  - the 15s starts when the ticket is actually EMITTED. Armed at call
        //    time, a slow first connect used up the budget and the timeout's
        //    cleanup dropped the pending emit, so the ticket was never sent.
        //  - the timeout is a NOTICE, not a teardown. The server burns the
        //    ticket on receipt, so the ORIGINAL request is the only one that
        //    can still succeed; we keep listening for its requestId and accept
        //    a late success underneath the Retry screen.
        armWatchdogOnEmit: true,
        keepListeningAfterTimeout: true,
        // Socket still not connected after 20s (socket.io's own per-attempt
        // connect timeout): show the Retry screen, but keep the emit pending
        // so the ticket still goes out the moment the socket connects.
        connectStallMs: 20000,
        isCancelled: () => cancelled,
        onResult: (result) => {
          if (result?.success && result.userData) {
            try {
              if (result.token) setAuthToken(result.token);
              sessionStorage.setItem('poker_keep_signed_in', '1');
            } catch {}
            if (timeoutReported) {
              // The timeout already wrote a login_failed row for this attempt;
              // record that it actually succeeded so the dashboard can net it out.
              try {
                logAuthEvent('login_success', {
                  via: isWaitlist ? 'waitlist_ticket' : 'ticket',
                  late: 'ticket_late_success',
                });
              } catch {}
            }
            setDeepLinkTimedOut(false);
            setDeepLinkRefusal(null);
            // 2026-10-09 (contract R1) — the ticket is one-shot; poker-server
            // now also returns a 12h resumeToken so a socket reconnect (and a
            // reload) can re-authenticate this session silently instead of
            // telling the player to sign in. See services/sessionResume.js.
            // The tab is marked a TICKET session only when a record was
            // actually stored for this user; a result without one (a waitlist
            // link riding this tab's own OIDC sign-in, an admin row) keeps the
            // tab's same-user OIDC marker or takes the pre-R1 re-auth path —
            // never another account's (markTicketSignIn). A tab that is
            // already the same user's OIDC session stays 'oidc' (T6).
            const resumeStored = saveTicketResume(result);
            markTicketSignIn(result.userData.id, resumeStored);
            useGameStore.getState().login(result.userData, result.token);
            return;
          }
          // Surface the actual server reason (ticket_replayed / ticket_invalid /
          // ticket_verify_failed …) so the spinner stops and the user gets a
          // sensible "Sign in manually" path instead of an infinite retry loop.
          console.error('[deep-link] ticket auth failed:', result?.code || 'unlabelled', result?.error);
          try {
            logAuthEvent('login_failed', {
              reason: isWaitlist ? 'waitlist_ticket_auth_failed' : 'deeplink_ticket_auth_failed',
              code: String(result?.code || 'unlabelled').slice(0, 64),
              error: String(result?.error || '').slice(0, 200),
            });
          } catch {}
          // 2026-10-07 — a play refusal is a definite answer, not a timeout:
          // show the server's text verbatim (and, for login_required /
          // guest_disabled, the normal sign-in action) instead of
          // "Connection timed out".
          const refusalCode = playRefusalCode(result);
          if (refusalCode) {
            setDeepLinkRefusal({ code: refusalCode, message: playRefusalText(result) });
            setDeepLinkTimedOut(false);
            return;
          }
          setDeepLinkTimedOut(true);
        },
        onTimeout: (info) => {
          const phase = info?.phase === 'connect' ? 'connect' : 'result';
          console.warn(
            phase === 'connect'
              ? '[deep-link] socket not connected yet — ticket still queued, will send on connect'
              : '[deep-link] loginResult not received yet — still listening for the original request'
          );
          // One row per attempt: re-armed notices after a Retry are not new failures.
          if (!timeoutReported) {
            timeoutReported = true;
            try {
              logAuthEvent('login_failed', {
                reason: isWaitlist ? 'waitlist_ticket_timeout' : 'deeplink_ticket_timeout',
                phase,
                keptListening: true,
              });
            } catch {}
          }
          setDeepLinkTimedOut(true);
        },
      });
    };

    // Retry (timed-out screen). NEVER re-emit a ticket that is already on the
    // wire and may still be answered — the server burned it on receipt, so a
    // second emit can only come back `ticket_replayed`, and it would race the
    // original's success. runSocketLogin.retry() keeps waiting on the SAME
    // request ('waiting') unless that request can no longer succeed
    // ('restart': it settled, or its connection dropped after the emit so the
    // answer went to a dead socket). Only then is a fresh attempt started.
    const retryDeepLinkAuth = () => {
      if (cancelled) return;
      const live = getSocket();
      const sameSocket = !live || live === flowSocket;
      const outcome = (cancelFlow && typeof cancelFlow.retry === 'function' && sameSocket)
        ? cancelFlow.retry()
        : 'restart';
      if (outcome === 'waiting') return;
      startDeepLinkAuth();
    };

    deepLinkRetryRef.current = retryDeepLinkAuth;
    if (!didEmitDeepLinkRef.current) startDeepLinkAuth();

    return () => {
      cancelled = true;
      if (cancelFlow) cancelFlow();
      deepLinkRetryRef.current = null;
    };
    // 2026-05-05 — was `[deepLinkContext, connStatus]`. The connStatus
    // dep caused this effect to re-run on every socket reconnect, and
    // the cleanup briefly removed the loginResult listener between runs.
    // If the server's loginResult arrived during that gap (very common
    // because authWithTicket completes within ms of `connect`, which is
    // exactly when connStatus flips to 'connected' and triggers the
    // re-run), the event was emitted to a listener that had already set
    // `cancelled = true`, then handed off to a new listener that had
    // never fired authWithTicket. Result: spinner stuck forever, no
    // timeout (because the cleanup also clears the timer between runs).
    // Mount-only deps keep the listener alive across reconnects;
    // runSocketLogin's own 'connect' registration handles the timing of
    // the initial emit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkContext]);

  const handleSpinComplete = () => {
    setShowSpinReveal(false);
  };

  // OAuth2 callback — intercept before any other screen
  if (isOAuthCallback) {
    return <AuthCallback onExit={handleAuthCallbackExit} />;
  }

  // OBS browser-source overlay (?overlay=<tableId>) — a clean, transparent,
  // login-free broadcast graphic of the live table. Intercept before auth.
  if (overlayConfig) {
    return (
      <Suspense fallback={null}>
        <StreamOverlayView tableId={overlayConfig.tableId} delaySec={overlayConfig.delaySec} theme={overlayConfig.theme} />
      </Suspense>
    );
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
    // 2026-07-06 audit P2 — cross-site SSO bridge handoff in progress. The
    // bridge consumer is exchanging #bridge_id_token + authenticating the
    // socket; show a spinner (not LoginScreen) until it resolves, mirroring the
    // deep-link ticket path so there is no login flash.
    if (bridgePending && !isLoggedIn) {
      return (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'linear-gradient(135deg,#0a0a1a,#1a1a3e 60%,#0d0d2b)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#e0e0e0', fontFamily: 'system-ui',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 40, height: 40, margin: '0 auto 16px',
              border: '3px solid rgba(255,210,74,0.3)', borderTopColor: '#ffd24a',
              borderRadius: '50%', animation: 'dl-spin 0.8s linear infinite',
            }} />
            <h2 style={{ color: '#fcd34d', margin: 0, fontSize: 22 }}>Signing you in…</h2>
            <p style={{ opacity: 0.7, marginTop: 12, fontSize: 14 }}>
              Connecting your American Pub Poker session.
            </p>
          </div>
          <style>{`@keyframes dl-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      );
    }
    // Deep-link from marketing/player app: we have a signed ticket in the URL
    // and are actively authenticating via authWithTicket. Show a spinner
    // instead of the login screen — making users "sign in again" here is
    // exactly the bug we're avoiding.
    if (deepLinkContext) {
      // Only consulted when a refusal offers Sign In (see the button below).
      const deepLinkInApp = deepLinkRefusal ? detectInAppBrowser() : { inApp: false, app: null };
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
            {deepLinkRefusal ? (
              // 2026-10-07 — play refusal (suspended / no account): the
              // server's text verbatim, blue + gold. Sign-in is offered only
              // when an account is what's missing.
              <div className="deeplink-refusal" role="alert">
                <h2 style={{ color: '#ffd24a', margin: 0, fontSize: 19, lineHeight: 1.4 }}>
                  {deepLinkRefusal.message}
                </h2>
                {deepLinkSignInError && (
                  <p style={{ color: '#cfe0ff', marginTop: 10, fontSize: 13, lineHeight: 1.4 }}>
                    {deepLinkSignInError}
                  </p>
                )}
                {/* 2026-10-07 — same in-app-browser guard as LoginScreen's
                    Sign In: OAuth can't keep a session inside FB/IG/TikTok
                    webviews, so say how to open the page in a real browser
                    and disable the button instead of a redirect that fails. */}
                {refusalNeedsSignIn(deepLinkRefusal.code) && deepLinkInApp.inApp && (
                  <p className="deeplink-inapp-notice" style={{ color: '#cfe0ff', marginTop: 10, fontSize: 13, lineHeight: 1.4 }}>
                    You're inside the {deepLinkInApp.app} app. Tap the <strong>•••</strong> menu and choose <strong>Open in Safari</strong> or <strong>Open in Chrome</strong> — sign-in won't keep your session in the in-app browser.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
                  {refusalNeedsSignIn(deepLinkRefusal.code) && (
                    <button
                      onClick={() => {
                        if (deepLinkInApp.inApp) return;
                        setDeepLinkSignInError(null);
                        startAccountSignIn().catch((e) => {
                          setDeepLinkSignInError(String(e?.message || e || 'Sign-in failed'));
                        });
                      }}
                      disabled={deepLinkInApp.inApp}
                      title={deepLinkInApp.inApp ? 'Open this page in your full browser to sign in' : undefined}
                      style={{
                        padding: '10px 18px', borderRadius: 8, border: 'none',
                        cursor: deepLinkInApp.inApp ? 'default' : 'pointer',
                        opacity: deepLinkInApp.inApp ? 0.6 : 1,
                        background: 'linear-gradient(135deg,#ffd24a,#e6b422)', color: '#0a1628', fontWeight: 700,
                      }}
                    >
                      Sign In with American Pub Poker
                    </button>
                  )}
                  {/* 2026-10-09 (contract R3) — no account yet: create one.
                      Same in-app-browser guard as Sign In. */}
                  {refusalNeedsSignIn(deepLinkRefusal.code) && (
                    <CreateAccountLink inApp={deepLinkInApp.inApp} style={{ borderRadius: 8, padding: '10px 18px' }} />
                  )}
                  <button
                    onClick={() => {
                      // Drop the deep-link context and fall through to the
                      // normal boot (stored session → lobby, else login screen).
                      window.location.replace('/');
                    }}
                    style={{
                      padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
                      background: 'transparent', color: '#cfe0ff',
                      border: '1px solid rgba(120,160,255,0.45)',
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : deepLinkTimedOut ? (
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
                      setDeepLinkTimedOut(false);
                      // 2026-08-17 — route Retry through the real flow instead
                      // of firing a bare `authWithTicket` emit (which had nobody
                      // listening once runSocketLogin tore its listener down).
                      // 2026-10-06 — and never re-send a ticket that is already
                      // on the wire: retryDeepLinkAuth keeps waiting on the
                      // ORIGINAL request (fresh 15s, late success accepted) and
                      // only starts a new attempt when that request can no
                      // longer be answered (settled, or its socket dropped).
                      const socket = getSocket();
                      if (socket && !socket.connected) socket.connect();
                      if (deepLinkRetryRef.current) deepLinkRetryRef.current();
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
        <PlayRefusalNotice />
        <AchievementPopup />
        <LevelUpPopup />
        <KeyboardShortcuts />
        <Tutorial />
      </Suspense>
    );
  }

  if (displayedScreen === 'table') {
    return (
      // 2026-07-05 mobile audit fix: 100dvh (not 100vh) so the game screen — and
      // critically the bottom action bar — is laid out against the VISIBLE viewport
      // on mobile browsers, instead of the URL-bar-inflated 100vh that pushed the
      // fold/call/raise bar below the fold.
      <div className={`screen-transition ${transitionClass}`} style={{ position: 'relative', width: '100vw', height: '100dvh' }}>
        <MultiTableTabs />
        {/* 2026-05-04 unified-push phase 3 — bottom-right banner inviting
            online-poker players to set up tournament alerts in the league
            player app (americanpub.poker). .online has no push of its own
            by design; the player app is the canonical surface. */}
        <PlayerAppPushBanner />
        <Suspense fallback={<ChunkLoader />}><GameScene /></Suspense>
        {/* 2026-04-22 audit fixes: the boundary moved up to the root wrapper
            (see bottom of file). GameHUD no longer needs its own inner
            boundary — the root one catches any render error in the whole
            subtree and shows FriendlyErrorFallback. */}
        <Suspense fallback={null}><GameHUD /></Suspense>
        {/* 2026-10-07 — server play refusals (rebuy, career start, extra
            table, club challenge) shown verbatim; see services/playRefusal. */}
        <PlayRefusalNotice />
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
              background: 'linear-gradient(135deg, #081434, #0c1a44)',
              border: '2px solid #ffd24a',
              borderRadius: '20px',
              padding: '40px 50px',
              textAlign: 'center',
              color: '#ffffff',
              animation: 'spin-overlay-in 0.3s ease-out',
            }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ffd24a', marginBottom: '12px' }}>
                Game Over
              </div>
              <div style={{ fontSize: '1.1rem', marginBottom: '8px' }}>
                {quickGameResult.message}
              </div>
              {quickGameResult.multiplier && (
                <div style={{ fontSize: '0.9rem', color: '#ffd24a' }}>
                  Multiplier: {quickGameResult.multiplier}x
                </div>
              )}
              <button
                onClick={() => setQuickGameResult(null)}
                style={{
                  marginTop: '20px',
                  padding: '8px 24px',
                  border: '1px solid #ffd24a',
                  borderRadius: '8px',
                  background: 'transparent',
                  color: '#ffd24a',
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
      {/* 2026-10-07 — server play refusals (suspended / no account) from any
          lobby path, shown verbatim with the sign-in action when needed. */}
      <PlayRefusalNotice />
      {/* 2026-10-09 — one-time guest progress carry-over offer (after an
          account sign-in on a device that still holds a guest session).
          LOBBY ONLY: never drawn over a live table (the table / career
          screens don't render it; the multi-table overlay hides it). An
          offer that arrives while seated waits here for the lobby. */}
      <GuestCarryOverPrompt />
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

// Root-level wrapping (2026-04-22 audit fixes). The ErrorBoundary sits
// OUTSIDE App so that any crash in any screen (lobby, login, table,
// avatar, replay viewer) renders the FriendlyErrorFallback rather than
// a white screen. Kept as a default export so main.jsx does not need
// to change.
export default function RootApp() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
