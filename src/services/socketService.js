import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
let socket = null;

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

  socket.on('connect', () => console.log('Connected to server:', socket.id));
  socket.on('disconnect', (reason) => console.log('Disconnected:', reason));
  socket.on('connect_error', (err) => console.log('Connection error:', err.message));

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
