import { io } from 'socket.io-client';
import { getAuthToken } from './tokenStorage';

// In dev mode, fall back to localhost. In production, VITE_SERVER_URL is REQUIRED —
// silently connecting to localhost on a deployed client would be a hard-to-debug bug.
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : null);

if (!SERVER_URL) {
  console.error('[socketService] VITE_SERVER_URL is not configured for production build');
}

// Module-level socket reference. Document/window listeners (visibilitychange,
// online, pageshow) are attached ONCE at module load (see bottom of file) and
// read through this ref, so they don't stack every time connectToServer()
// creates a fresh socket on reconnect.
let _socket = null;
// Back-compat alias so existing code paths that reference `socket` below keep
// working. Kept in sync in connectToServer / disconnectFromServer.
let socket = null;

// Pending-action queue. A single slot: only one turn-action can be pending
// at a time (you can't act twice on the same turn). If the socket drops
// right as the user taps, we hold the action here and flush it on the
// next 'connect' event. The server dedupes by nonce so a retry after a
// successful-but-unack'd action is a no-op. Stale actions expire after
// QUEUE_TTL_MS so a 30s disconnect doesn't replay a fold from two hands ago.
const QUEUE_TTL_MS = 10_000;
let _pendingAction = null; // { type, amount, nonce, queuedAt }

function makeNonce() {
  // Prefer crypto.randomUUID — globally unique, CSPRNG-backed. The server
  // still only needs locally-unique-per-table:seat, but UUIDs cost the same
  // and eliminate any Math.random() birthday-collision worries. Fall back to
  // a timestamp+random hex string on the rare runtime (old Safari, jsdom)
  // that lacks randomUUID.
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  // Fallback: 16 hex chars + timestamp.
  return Math.random().toString(16).slice(2, 10) + Date.now().toString(16);
}

function flushPendingAction() {
  if (!_pendingAction || !socket?.connected) return;
  if (Date.now() - _pendingAction.queuedAt > QUEUE_TTL_MS) {
    console.warn('[socketService] Dropping stale queued action:', _pendingAction.type);
    _pendingAction = null;
    return;
  }
  const p = _pendingAction;
  _pendingAction = null;
  socket.emit('action', { type: p.type, amount: p.amount, nonce: p.nonce });
}

/**
 * Emit a player action with automatic queue-on-disconnect + nonce dedup.
 * If the socket is connected, emit immediately. If not, stash as the single
 * pending action (overwriting any prior queued one — only the user's latest
 * intent is valid) and flush on the next 'connect' event.
 */
export const emitPlayerAction = (type, amount) => {
  const payload = { type, amount, nonce: makeNonce(), queuedAt: Date.now() };
  if (socket?.connected) {
    socket.emit('action', { type, amount, nonce: payload.nonce });
    return { sent: true, nonce: payload.nonce };
  }
  _pendingAction = payload;
  return { sent: false, queued: true, nonce: payload.nonce };
};

export const hasPendingAction = () => !!_pendingAction;

// Connection status — subscribers get notified on change
let _connectionStatus = 'disconnected'; // 'connected' | 'disconnected' | 'error'
let _connectionError = '';
const _statusSubscribers = new Set();

function setStatus(status, error = '') {
  _connectionStatus = status;
  _connectionError = error;
  _statusSubscribers.forEach((fn) => fn(status, error));
}

export const subscribeConnectionStatus = (fn) => {
  _statusSubscribers.add(fn);
  fn(_connectionStatus, _connectionError); // immediate call with current state
  return () => _statusSubscribers.delete(fn);
};

export const getConnectionStatus = () => ({ status: _connectionStatus, error: _connectionError });

export const connectToServer = () => {
  if (socket?.connected) return socket;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    _socket = null;
  }

  // Attach auth on the handshake so the server sees the access token on
  // the very first connect packet instead of relying on a post-connect
  // `oauthLogin` emit (which still runs for backward compat — either
  // path is accepted server-side). This shrinks the unauthenticated
  // window to zero and lets the server-side session bind as part of
  // the handshake.
  const token = (() => {
    try { return getAuthToken(); } catch { return null; }
  })();

  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    // PWA audit #1: iOS backgrounds socket.io for ≥30s during swipe-up /
    // take a call / notification lockscreen. Bump attempts to 20 and
    // extend initial delay so the exponential backoff doesn't exhaust
    // inside a normal backgrounding window. With randomizationFactor the
    // retries spread nicely 1s → 2s → 4s → … up to 20s max.
    reconnectionAttempts: 20,
    reconnectionDelay: 800,
    reconnectionDelayMax: 20_000,
    randomizationFactor: 0.5,
    // 20s connect timeout. Railway free-tier servers cold-start in 3–8s,
    // and on flaky mobile networks the TLS + websocket upgrade handshake
    // can take another few seconds on top. 10s was causing the socket to
    // abort mid-handshake, making every login feel like a timeout.
    timeout: 20_000,
    auth: token ? { token } : undefined,
  });
  _socket = socket;

  socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    setStatus('connected');
    flushPendingAction();
  });
  socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    // `io server disconnect` means the server explicitly closed the socket
    // (kick, auth rejection, server shutdown). socket.io will NOT auto-
    // reconnect in that case — we have to kick it ourselves after a short
    // delay, otherwise the client sits disconnected forever. Surface a
    // distinct status so the banner / UI can reflect the server-forced
    // close if desired; we still attempt a reconnect so casual drops
    // (hand-off between Railway revisions) recover transparently.
    if (reason === 'io server disconnect') {
      setStatus('disconnected', 'Disconnected by server');
      setTimeout(() => {
        try { if (_socket && !_socket.connected) _socket.connect(); } catch { /* ignore */ }
      }, 1500);
      return;
    }
    setStatus('disconnected');
  });
  socket.on('connect_error', (err) => { console.log('Connection error:', err.message); setStatus('error', err.message); });
  socket.on('reconnect', () => { setStatus('connected'); flushPendingAction(); });
  socket.on('reconnecting', () => setStatus('disconnected'));

  // 2026-05-05 Phase 3 — re-attach the LATEST auth token before each
  // reconnect attempt. socket.io persists the auth payload from the
  // initial connect across reconnects, so if the access token was
  // refreshed (or cleared, or replaced by a different user logging in
  // on another tab) while we were disconnected, the stale token would
  // be sent on reconnect and the server would reject the handshake.
  // Reading from storage on every reconnect_attempt picks up whatever
  // the current value is.
  if (socket.io && typeof socket.io.on === 'function') {
    socket.io.on('reconnect_attempt', () => {
      try {
        const latestToken = getAuthToken();
        if (latestToken) {
          socket.auth = { ...(socket.auth || {}), token: latestToken };
        } else if (socket.auth) {
          // Token was cleared (logout while disconnected). Drop the
          // stale auth payload so the server gets a clean handshake
          // instead of one with a known-invalid token.
          delete socket.auth.token;
        }
      } catch { /* ignore */ }
    });
  }

  // Terminal reconnect state — fires after `reconnectionAttempts` exhausts.
  // socket.io stops retrying on its own; the user needs an explicit tap to
  // resume. Surface `failed` status so the banner stays up with a CTA, and
  // `forceReconnect()` below is the sanctioned path to kick it back to life.
  // Listen on `socket.io` (the Manager) — the engine-level event isn't
  // re-emitted on the Socket instance.
  if (socket.io && typeof socket.io.on === 'function') {
    socket.io.on('reconnect_failed', () => {
      console.warn('[socketService] reconnect attempts exhausted');
      setStatus('failed', 'Connection lost — tap to reconnect');
    });
  }

  return socket;
};

/**
 * Trigger a manual reconnect. Called from the app-resume handler and from
 * the "tap to reconnect" banner CTA after the `failed` terminal state. If
 * the underlying socket.io reconnect loop has exhausted, we recreate a
 * fresh socket via connectToServer() — calling .connect() on a socket
 * whose manager is in the failed state is a no-op otherwise.
 */
export const forceReconnect = () => {
  if (_socket && _socket.connected) return;
  if (_connectionStatus === 'failed') {
    // Terminal: the manager won't retry on its own. Build a new socket.
    try { _socket?.disconnect(); } catch { /* ignore */ }
    socket = null;
    _socket = null;
    connectToServer();
    return;
  }
  if (!_socket) {
    connectToServer();
    return;
  }
  try {
    _socket.connect();
  } catch { /* ignore */ }
};

export const getSocket = () => socket;

export const disconnectFromServer = () => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    _socket = null;
  }
};

// -----------------------------------------------------------------------
// Attach-once document/window listeners.
//
// PWA audit #1: explicit visibility-change / online / pageshow kick so an
// iOS PWA resumed from background re-establishes the socket immediately
// instead of waiting for socket.io's reconnect loop to tick.
//
// IMPORTANT: these must attach exactly ONCE at module load, NOT inside
// connectToServer(). Previously the listeners were added every time
// connectToServer() ran, stacking a new handler on every reconnect /
// remount cycle. That leaked listeners across every background-resume,
// and each leaked listener would call .connect() on a socket that no
// longer existed. The handlers below reference the current socket via
// the module-level `_socket` ref that connectToServer keeps in sync.
// -----------------------------------------------------------------------
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (!_socket) return;
    if (!_socket.connected) {
      // Dropped while backgrounded (mobile / OS suspend) — kick the reconnect
      // now instead of waiting out socket.io's backoff. Fresh full state then
      // arrives via the server's reconnect path.
      try { _socket.connect(); } catch { /* ignore */ }
    } else {
      // 2026-06-12 — Still connected, but the render loop was frozen while the
      // tab was hidden, so the table can look a few frames stale. Pull a fresh
      // full snapshot so we snap to the live hand instead of catching up
      // frame-by-frame. (Server handler: socket.on('requestState').)
      try { _socket.emit('requestState'); } catch { /* ignore */ }
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  // Also on explicit online/pageshow for iOS Safari quirks (BFCache resume,
  // network-up after airplane mode, etc.).
  window.addEventListener('online', onVisible);
  window.addEventListener('pageshow', onVisible);
}
