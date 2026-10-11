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

export function followJoinToTable({ tableId = null, timeoutMs = 12000, onFailed = null } = {}) {
  const want = tableId !== null && tableId !== undefined ? String(tableId) : null;
  const fromSig = seatSig(useTableStore.getState().gameState);
  const socket = getSocket();
  let done = false;
  let unsubscribe = null;
  let timer = null;

  const finish = (ok, message) => {
    if (done) return;
    done = true;
    try { if (unsubscribe) unsubscribe(); } catch { /* ignore */ }
    clearTimeout(timer);
    if (socket) {
      socket.off('error', onError);
      socket.off('joinError', onError);
    }
    if (ok) {
      try { useGameStore.getState().setScreen('table'); } catch { /* ignore */ }
    } else if (message && typeof onFailed === 'function') {
      try { onFailed(message); } catch { /* ignore */ }
    }
  };
  const check = (gs) => {
    const sig = seatSig(gs);
    if (!sig || sig === fromSig) return;
    if (want && String(gs.tableId) !== want) return;
    finish(true);
  };
  function onError(err) {
    if (!err) return;
    if (isPlayRefusal(err)) { finish(false, null); return; }
    finish(false, err.message || 'Could not join the table.');
  }

  unsubscribe = useTableStore.subscribe((state) => check(state.gameState));
  if (socket) {
    socket.on('error', onError);
    socket.on('joinError', onError);
  }
  timer = setTimeout(() => finish(false, JOIN_FOLLOW_TIMEOUT_TEXT), timeoutMs);
  check(useTableStore.getState().gameState);
  return () => finish(false, null);
}
