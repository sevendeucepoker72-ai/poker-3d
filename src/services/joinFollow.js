import { useTableStore } from '../store/tableStore';
import { useGameStore } from '../store/gameStore';
import { getSocket } from './socketService';
import { isPlayRefusal } from './playRefusal';

/**
 * Follow a join that started OUTSIDE the lobby's own join watcher (R2,
 * 2026-10-11 — APPUI-53): the club challenge auto-join (App.jsx
 * 'clubChallengeAccepted') emitted joinTable and nothing ever switched to the
 * table screen — the player stayed on the lobby / Clubs panel while his
 * heads-up match blinded him out.
 *
 * Switches to the table screen once the server confirms a FRESH seat (a seat
 * signature different from the one at the start; at `tableId` when given),
 * like Lobby.jsx's watcher. A refusal on 'error' / 'joinError' ends it (a C5
 * play refusal is shown by App's global handler; any other is handed to
 * `onFailed(message)`), and so does the timeout. Returns a cancel function.
 */
const seatSig = (gs) =>
  (gs && Number(gs.yourSeat) >= 0 && gs.seats?.[gs.yourSeat]?.playerName)
    ? `${gs.tableId ?? '?'}:${gs.yourSeat}`
    : null;

export const JOIN_FOLLOW_TIMEOUT_TEXT = "Couldn't reach the table — try again from the Clubs panel.";

/** Seat signatures of every cached multi-table entry (activeTables). */
const cachedSeatSigs = (activeTables) => {
  const out = new Set();
  if (activeTables && typeof activeTables.forEach === 'function') {
    activeTables.forEach((entry) => { const s = seatSig(entry && entry.gameState); if (s) out.add(s); });
  }
  return out;
};

/**
 * C3 fix-up (F141) — multi-table mode (`currentTableId` set): App routes a
 * frame for any table other than the one on screen into `activeTables` only,
 * so the new seat never reaches `gameState` (the view stayed on the table he
 * had just left, frozen, and the follow reported a false "Couldn't reach the
 * table"). A FRESH seat in `activeTables` (at `want` when given, like
 * tableInviteJoin's watchAndJoin) is the confirmed seat: its Map key, or null.
 * With no `want`, only a table that was not cached at the start (`fromIds`)
 * counts — a seat move at a table already held is not the join.
 */
export function freshCachedSeatKey(state, want, fromSigs, fromIds = null) {
  if (!state || state.currentTableId === null || state.currentTableId === undefined) return null;
  const at = state.activeTables;
  if (!at || typeof at.forEach !== 'function') return null;
  let key = null;
  at.forEach((entry, id) => {
    if (key !== null) return;
    const gs = entry && entry.gameState;
    if (!gs || gs.isSpectator === true) return;
    const sig = seatSig(gs);
    if (!sig || (fromSigs && fromSigs.has(sig))) return;
    if (want && String(id) !== want) return;
    if (!want && fromIds && fromIds.has(String(id))) return;
    key = id;
  });
  return key;
}

// `onJoined()` (optional, gameplay audit F140): called once the table screen
// opened for the confirmed seat.
export function followJoinToTable({ tableId = null, timeoutMs = 12000, onFailed = null, onJoined = null } = {}) {
  const want = tableId !== null && tableId !== undefined ? String(tableId) : null;
  const startState = useTableStore.getState();
  const fromSig = seatSig(startState.gameState);
  const fromSigs = cachedSeatSigs(startState.activeTables);
  if (fromSig) fromSigs.add(fromSig);
  const fromIds = new Set();
  if (startState.activeTables && typeof startState.activeTables.forEach === 'function') {
    startState.activeTables.forEach((_e, id) => fromIds.add(String(id)));
  }
  const socket = getSocket();
  let done = false;
  let unsubscribe = null;
  let timer = null;

  // `beforeShow` (ok only): runs once the watch is torn down, before the
  // table screen opens (the multi-table switch below).
  const finish = (ok, message, beforeShow = null) => {
    if (done) return;
    done = true;
    try { if (unsubscribe) unsubscribe(); } catch { /* ignore */ }
    clearTimeout(timer);
    if (socket) {
      socket.off('error', onError);
      socket.off('joinError', onError);
    }
    if (ok) {
      if (typeof beforeShow === 'function') { try { beforeShow(); } catch { /* ignore */ } }
      try { useGameStore.getState().setScreen('table'); } catch { /* ignore */ }
      if (typeof onJoined === 'function') { try { onJoined(); } catch { /* ignore */ } }
    } else if (message && typeof onFailed === 'function') {
      try { onFailed(message); } catch { /* ignore */ }
    }
  };
  const check = (state) => {
    const gs = state && state.gameState;
    const sig = seatSig(gs);
    if (sig && sig !== fromSig && (!want || String(gs.tableId) === want)) { finish(true); return; }
    // F141 fix-up — multi-table: the new seat lands in activeTables; show it.
    const key = freshCachedSeatKey(state, want, fromSigs, fromIds);
    if (key === null) return;
    finish(true, null, () => {
      const ts = useTableStore.getState();
      if (ts.currentTableId != null && String(ts.currentTableId) !== String(key)) ts.switchActiveTable(key);
      try { console.warn('[join-follow] the new seat arrived as a background table: switched to it'); } catch { /* ignore */ }
    });
  };
  function onError(err) {
    if (!err) return;
    if (isPlayRefusal(err)) { finish(false, null); return; }
    finish(false, err.message || 'Could not join the table.');
  }

  unsubscribe = useTableStore.subscribe((state) => check(state));
  if (socket) {
    socket.on('error', onError);
    socket.on('joinError', onError);
  }
  timer = setTimeout(() => finish(false, JOIN_FOLLOW_TIMEOUT_TEXT), timeoutMs);
  check(useTableStore.getState());
  return () => finish(false, null);
}
