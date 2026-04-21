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

  socket.on('connect', () => { console.log('Connected to server:', socket.id); setStatus('connected'); });
  socket.on('disconnect', (reason) => { console.log('Disconnected:', reason); setStatus('disconnected'); });
  socket.on('connect_error', (err) => { console.log('Connection error:', err.message); setStatus('error', err.message); });
  socket.on('reconnect', () => setStatus('connected'));
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
