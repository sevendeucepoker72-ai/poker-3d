import { io } from 'socket.io-client';
import { getAuthToken } from './tokenStorage';
import { SERVER_URL } from '../config';

// 2026-06-18 — Phase 3f: REAL multi-tabling. poker-server is one-seat-per-
// socket (playerSessions keyed by socket.id) and its `spectate` handler kicks
// you out of your seat, so true multi-PLAY requires one independent socket.io
// connection per extra table. This module owns that secondary-connection pool;
// slot 0 in MultiTableView stays the app's PRIMARY socket/store untouched.
//
// Each secondary socket: connect → oauthLogin{skipSeatRecovery:true} (so it
// can't yank the primary's seat via the userId-keyed recovery) → joinTable
// {seatIndex:-1} (server auto-seats) → stream its own gameState delta. Actions
// emit on that specific socket; the server dedupes by nonce (tableId:seatIndex).
// The per-IP cap is 5 connections; 1 primary + up to 3 here stays under it.

export const MAX_SECONDARY_TABLES = 3;

let _counter = 0;
let _slots = []; // [{ id, socket, tableId, tableName, status, gameState, mySeat, error }]
const _listeners = new Set();

function makeNonce() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* ignore */ }
  return Math.random().toString(16).slice(2, 10) + Date.now().toString(16);
}

function snapshot() {
  return _slots.map((s) => ({
    id: s.id,
    tableId: s.tableId,
    tableName: s.tableName,
    status: s.status,         // connecting | authing | joining | playing | error | disconnected
    gameState: s.gameState,
    mySeat: s.mySeat,
    error: s.error || null,
  }));
}
function notify() {
  const snap = snapshot();
  _listeners.forEach((fn) => { try { fn(snap); } catch { /* ignore */ } });
}

export function subscribeMultiTables(fn) {
  _listeners.add(fn);
  fn(snapshot());
  return () => _listeners.delete(fn);
}

export function getMultiTables() { return snapshot(); }
export function multiTableCount() { return _slots.length; }
export function isMultiJoined(tableId) { return _slots.some((s) => s.tableId === tableId); }

// gameState delta protocol — same contract as App.jsx, scoped to one table.
function applyGameState(slot, data) {
  if (data && typeof data === 'object' && 'full' in data) {
    if (data.full) {
      slot.gameState = data.state;
    } else {
      const prev = slot.gameState;
      const next = prev ? { ...prev, ...data.delta } : { ...data.delta };
      // 2026-07-06: server sends handNumber, not handId — the old handId check
      // was dead code, so stale handResult lingered across hands (same bug fixed
      // in App.jsx). Compare handNumber so per-hand state actually resets.
      if (data.delta?.handNumber != null && data.delta.handNumber !== prev?.handNumber) {
        if (!data.delta.yourCards) next.yourCards = [];
        if (!data.delta.handResult) next.handResult = null;
      }
      slot.gameState = next;
    }
  } else {
    slot.gameState = data;
  }
  slot.mySeat = slot.gameState?.yourSeat ?? -1;
  if (slot.gameState?.tableName) slot.tableName = slot.gameState.tableName;
}

export function joinMultiTable(tableId, { playerName, buyIn, avatar, expectedVariant } = {}) {
  if (!SERVER_URL || !tableId) return { ok: false, error: 'No server' };
  if (_slots.length >= MAX_SECONDARY_TABLES) return { ok: false, error: 'Max tables reached' };
  if (_slots.some((s) => s.tableId === tableId)) return { ok: false, error: 'Already at this table' };
  const token = getAuthToken();
  if (!token) return { ok: false, error: 'Not signed in' };

  const socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 800,
    reconnectionDelayMax: 20_000,
    randomizationFactor: 0.5,
    timeout: 20_000,
    auth: { token },
  });

  const slot = {
    id: ++_counter, socket, tableId, tableName: '', status: 'connecting',
    gameState: null, mySeat: -1, error: null, joined: false,
  };
  _slots.push(slot);

  const doAuthAndJoin = () => {
    slot.status = 'authing';
    notify();
    socket.emit('oauthLogin', { accessToken: getAuthToken(), skipSeatRecovery: true });
  };

  socket.on('connect', doAuthAndJoin);
  socket.on('loginResult', (res) => {
    if (res?.success) {
      if (!slot.joined) {
        slot.joined = true;
        slot.status = 'joining';
        socket.emit('joinTable', { tableId, playerName: playerName || 'Player', seatIndex: -1, buyIn: buyIn || 0, avatar, expectedVariant });
      }
    } else {
      slot.status = 'error';
      slot.error = res?.error || 'Auth failed';
    }
    notify();
  });
  socket.on('gameState', (data) => {
    applyGameState(slot, data);
    if (slot.status !== 'playing') slot.status = 'playing';
    notify();
  });
  socket.on('error', (e) => {
    // Surface join/seat errors without killing an already-playing table.
    if (slot.status !== 'playing') { slot.status = 'error'; slot.error = e?.message || 'Error'; }
    notify();
  });
  socket.on('disconnect', () => {
    if (slot.status !== 'error') slot.status = 'disconnected';
    notify();
  });

  notify();
  return { ok: true, slotId: slot.id };
}

export function leaveMultiTable(slotId) {
  const i = _slots.findIndex((s) => s.id === slotId);
  if (i < 0) return;
  const slot = _slots[i];
  try { if (slot.socket?.connected) slot.socket.emit('leaveTable'); } catch { /* ignore */ }
  try { slot.socket.removeAllListeners(); slot.socket.disconnect(); } catch { /* ignore */ }
  _slots.splice(i, 1);
  notify();
}

export function sendMultiTableAction(slotId, type, amount) {
  const slot = _slots.find((s) => s.id === slotId);
  if (!slot?.socket?.connected) return false;
  // 2026-07-06 audit P2 — echo the secondary table's own stateVersion, matching
  // the sanctioned primary path (socketService.emitPlayerAction). Without it the
  // server can't reject a click that the table advanced past (timeout-fold / new
  // hand) while the secondary socket lagged, so a stale multi-table action could
  // land on the wrong decision point. stateVersion is read from THIS slot's
  // gameState (the per-table delta stream), never the primary's.
  //
  // No reconnect-queue here (unlike the primary): a secondary socket that drops
  // re-runs oauthLogin{skipSeatRecovery} → joinTable{seatIndex:-1}, i.e. the
  // server RE-SEATS it, so replaying a pre-disconnect action against a possibly-
  // different seat/hand is unsafe. Returning false lets MultiTableView reflect
  // the drop; the user re-acts on fresh state.
  slot.socket.emit('action', { type, amount, nonce: makeNonce(), stateVersion: slot.gameState?.stateVersion });
  return true;
}

// Tear down every secondary connection (call when the multi-table view closes
// if the user wants to free the seats; MultiTableView decides the policy).
export function disconnectAllMultiTables() {
  _slots.forEach((slot) => {
    try { if (slot.socket?.connected) slot.socket.emit('leaveTable'); } catch { /* ignore */ }
    try { slot.socket.removeAllListeners(); slot.socket.disconnect(); } catch { /* ignore */ }
  });
  _slots = [];
  notify();
}
