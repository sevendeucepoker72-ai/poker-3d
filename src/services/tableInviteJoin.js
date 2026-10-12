/**
 * Accepting a friend's table invite — the toast's "Join Table" (contract I1,
 * .online R3 2026-10-11: K3-2 / S1-5 / CLUBS-5).
 *
 * The Join is routed by the invite's tableKind (utils/tableInvite.js
 * inviteJoinRequest: a home game through its invite code, a club table through
 * joinClubTable, a cash table through joinTable). It opens the table once the
 * new seat shows in the table store, and a refusal is SAID in a toast — it
 * used to reach only App's console.error, so a refused Join did nothing on
 * screen. A C5 play refusal (suspended / no account) goes to the shared
 * PlayRefusalNotice instead (login_required on a signed-in tab: silent socket
 * re-auth and ONE replay of this whole flow, runPlayFlow).
 */
import { getSocket } from './socketService';
import { reportPlayRefusal, runPlayFlow } from './playRefusal';
import { useTableStore } from '../store/tableStore';
import { useGameStore } from '../store/gameStore';
import { useProgressStore } from '../store/progressStore';
import {
  inviteJoinRequest, inviteJoinErrorText, seatSigOf, INVITE_JOIN_NO_ANSWER_TEXT,
} from '../utils/tableInvite';

const ACCEPT_WAIT_MS = 10_000;

// The accept in flight (one at a time: a second Join replaces the first's watch).
let _active = null;

function inviteNotice(message) {
  try {
    useProgressStore.getState().addNotification({ type: 'friend', title: 'Table Invite', message });
  } catch { /* best-effort */ }
}

function watchAndJoin(socket, req) {
  if (_active) _active.cancel();
  const fromSig = seatSigOf(useTableStore.getState().gameState);
  let done = false;
  let timer = null;
  let unsubscribe = null;
  const entry = {};
  const finish = () => {
    if (done) return false;
    done = true;
    try { socket.off(req.errorEvent, onRefused); } catch { /* ignore */ }
    if (unsubscribe) { try { unsubscribe(); } catch { /* ignore */ } unsubscribe = null; }
    if (timer) { clearTimeout(timer); timer = null; }
    if (_active === entry) _active = null;
    return true;
  };
  entry.cancel = finish;
  _active = entry;

  function onRefused(frame) {
    if (!finish()) return;
    if (reportPlayRefusal(frame)) return;
    try { console.warn('[table-invite] join refused', { via: req.event, code: frame && frame.code ? frame.code : null }); } catch { /* ignore */ }
    // On the table screen GameHUD already toasts every 'error' frame in the
    // server's words; say it once.
    let atTable = false;
    try { atTable = useGameStore.getState().screen === 'table'; } catch { /* ignore */ }
    if (atTable && req.errorEvent === 'error') return;
    inviteNotice(inviteJoinErrorText(frame));
  }

  // Seated: a NEW seat signature in the table store (the server answers a
  // successful join with this socket's full gameState).
  unsubscribe = useTableStore.subscribe((state) => {
    if (done) return;
    const sig = seatSigOf(state.gameState);
    if (!sig || sig === fromSig) return;
    finish();
    try { useGameStore.getState().setScreen('table'); } catch { /* ignore */ }
  });
  socket.on(req.errorEvent, onRefused);
  timer = setTimeout(() => {
    if (!finish()) return;
    try { console.warn('[table-invite] join got no answer', { via: req.event }); } catch { /* ignore */ }
    inviteNotice(INVITE_JOIN_NO_ANSWER_TEXT);
  }, ACCEPT_WAIT_MS);

  if (req.event === 'joinTable') {
    const p = req.payload;
    useTableStore.getState().joinTable(p.tableId, p.playerName, p.seatIndex, p.buyIn, p.avatar);
  } else {
    socket.emit(req.event, req.payload);
  }
}

/**
 * Join the table a `tableInvite` toast names (`n` = the notification, its
 * fields from tableInviteFields). Returns false when there was nothing to
 * send (no table named, or not connected — said in a toast).
 */
export function acceptTableInvite(n) {
  let me = {};
  try { me = useGameStore.getState(); } catch { /* ignore */ }
  const req = inviteJoinRequest(n, { playerName: me.playerName || '', avatar: me.avatar || null });
  if (!req) return false;
  // Already seated at that very table: just show it.
  try {
    const gs = useTableStore.getState().gameState;
    if (req.tableId !== null && seatSigOf(gs) && String(gs.tableId) === String(req.tableId)) {
      me.setScreen?.('table');
      return true;
    }
  } catch { /* fall through to the join */ }
  const socket = getSocket();
  if (!socket || !socket.connected) {
    inviteNotice('Not connected to the game server. Try again in a moment.');
    return false;
  }
  runPlayFlow(() => acceptTableInvite(n), () => watchAndJoin(socket, req));
  return true;
}
