import { io } from 'socket.io-client';

// In dev mode, fall back to localhost. In production, VITE_SERVER_URL is REQUIRED —
// silently connecting to localhost on a deployed client would be a hard-to-debug bug.
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : null);

if (!SERVER_URL) {
  console.error('[socketService] VITE_SERVER_URL is not configured for production build');
}
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
  // 16 hex chars — enough entropy per-session; server compares against the
  // last nonce per table:seat, so we just need locally-unique per action.
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
  }

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
  });

  socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    setStatus('connected');
    flushPendingAction();
  });
  socket.on('disconnect', (reason) => { console.log('Disconnected:', reason); setStatus('disconnected'); });
  socket.on('connect_error', (err) => { console.log('Connection error:', err.message); setStatus('error', err.message); });
  socket.on('reconnect', () => { setStatus('connected'); flushPendingAction(); });
  socket.on('reconnecting', () => setStatus('disconnected'));

  // PWA audit #1: explicit visibility-change kick so an iOS PWA resumed
  // from background re-establishes the socket immediately instead of
  // waiting for socket.io's reconnect loop to tick. Also fires on tab
  // re-focus desktop-side — harmless when already connected.
  if (typeof document !== 'undefined' && !socket._visListenerAttached) {
    socket._visListenerAttached = true;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && socket && !socket.connected) {
        try { socket.connect(); } catch { /* ignore */ }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    // Also on explicit online/pageshow for iOS Safari quirks.
    window.addEventListener('online', onVisible);
    window.addEventListener('pageshow', onVisible);
  }

  return socket;
};

/**
 * Trigger a manual reconnect. Called from the app-resume handler to
 * force an immediate reconnect attempt outside socket.io's backoff
 * schedule. Safe to call unconditionally; no-op if already connected.
 */
export const forceReconnect = () => {
  if (!socket) return;
  if (socket.connected) return;
  try {
    socket.connect();
  } catch { /* ignore */ }
};

export const getSocket = () => socket;

export const disconnectFromServer = () => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
};
