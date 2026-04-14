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
  // If socket exists and is connected, reuse it
  if (socket?.connected) return socket;

  // If socket exists but disconnected, destroy it and make a new one
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 10000,
  });

  socket.on('connect', () => { console.log('Connected to server:', socket.id); setStatus('connected'); });
  socket.on('disconnect', (reason) => { console.log('Disconnected:', reason); setStatus('disconnected'); });
  socket.on('connect_error', (err) => { console.log('Connection error:', err.message); setStatus('error', err.message); });
  socket.on('reconnect', () => setStatus('connected'));
  socket.on('reconnecting', () => setStatus('disconnected'));

  return socket;
};

export const getSocket = () => socket;

export const disconnectFromServer = () => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
};
