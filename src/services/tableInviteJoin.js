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
import { useTableStore, liveTableIds } from '../store/tableStore';
import { useGameStore } from '../store/gameStore';
import { useProgressStore } from '../store/progressStore';
import {
  inviteJoinRequest, inviteJoinErrorText, seatSigOf, INVITE_JOIN_NO_ANSWER_TEXT,
} from '../utils/tableInvite';
import { useTournamentSeatStore } from '../store/tournamentSeatStore';
import { leaveForJoinConfirmText, tablesLeftByMainJoin } from '../utils/tableFlows';
import { followJoinToTable } from './joinFollow';

/**
 * Gameplay audit F145 / F141 (2026-10-21) — a join from a toast makes the
 * server LEAVE every seat this socket holds (a Spin & Go entry is forfeited,
 * a live cash hand folded, a tournament seat kept absent), like Back to
 * Lobby — which asks first. Ask the same here; true = go ahead (nothing at
 * stake, or he confirmed).
 */
export function confirmLeaveForJoin(targetTableId) {
  let text = null;
  try {
    const seat = useTournamentSeatStore.getState().seat;
    text = leaveForJoinConfirmText(useTableStore.getState(), targetTableId, { tournamentTableId: seat ? seat.tableId : null });
  } catch { text = null; }
  if (!text) return true;
  try { console.warn('[join-from-toast] seated elsewhere: asking before the join leaves that seat'); } catch { /* ignore */ }
  return typeof window !== 'undefined' && typeof window.confirm === 'function' ? !!window.confirm(text) : false;
}

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
  // R3 review (CLIENT-3) — multi-table: a frame for a table other than the one
  // on screen only lands in activeTables (App.jsx), so "seated" is ALSO a NEW
  // live entry there; the screen then switches to it.
  const fromLive = new Set(liveTableIds(useTableStore.getState().activeTables).map(String));
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
    if (sig && sig !== fromSig) {
      finish();
      try { useGameStore.getState().setScreen('table'); } catch { /* ignore */ }
      return;
    }
    const fresh = liveTableIds(state.activeTables).map(String).filter((id) => !fromLive.has(id));
    if (!fresh.length) return;
    const want = req.tableId != null ? String(req.tableId) : null;
    const key = want && fresh.includes(want) ? want : fresh[0];
    finish();
    try {
      const ts = useTableStore.getState();
      if (ts.currentTableId != null && String(ts.currentTableId) !== key) ts.switchActiveTable(key);
    } catch { /* ignore */ }
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
export function acceptTableInvite(n, { confirmed = false } = {}) {
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
  // F145 — leaving a live seat for the invite is confirmed first (once: the
  // play-refusal replay below does not ask again).
  if (!confirmed && !confirmLeaveForJoin(req.tableId)) return false;
  runPlayFlow(() => acceptTableInvite(n, { confirmed: true }), () => watchAndJoin(socket, req));
  return true;
}

/**
 * Gameplay audit F141 (2026-10-21) — the "Join challenge" button of a club
 * challenge notice (a socket that was seated elsewhere / a background tab is
 * not auto-joined any more): confirm leaving the current seat(s), then join
 * the heads-up table and open it once the seat is confirmed (APPUI-53).
 * `n` = the notification (challengeTableId, challengeStakes).
 */
export function acceptClubChallengeNotice(n) {
  const tableId = n && n.challengeTableId != null ? String(n.challengeTableId) : null;
  if (!tableId) return false;
  const socket = getSocket();
  if (!socket || !socket.connected) {
    try { useProgressStore.getState().addNotification({ type: 'mission', message: 'Club challenge: not connected to the game server. Try again in a moment.' }); } catch { /* ignore */ }
    return false;
  }
  try {
    const ts = useTableStore.getState();
    const gs = ts.gameState;
    if (seatSigOf(gs) && String(gs.tableId) === tableId) { useGameStore.getState().setScreen?.('table'); return true; }
    // C3 fix-up (F141) — already seated there as a background multi-table
    // entry: show it.
    if (ts.currentTableId != null && liveTableIds(ts.activeTables).some((id) => String(id) === tableId)) {
      let key = tableId;
      ts.activeTables.forEach((_e, k) => { if (String(k) === tableId) key = k; });
      ts.switchActiveTable(key);
      useGameStore.getState().setScreen?.('table');
      return true;
    }
  } catch { /* fall through to the join */ }
  if (!confirmLeaveForJoin(tableId)) return false;
  let me = {};
  try { me = useGameStore.getState(); } catch { /* ignore */ }
  // C3 fix-up (F141) — multi-table: the join from the main seat ends every
  // other seat of this socket server-side (handlePlayerLeave: the main seat
  // and every extra seat). followJoinToTable switches to the new table when
  // its seat lands in activeTables; then those dead tables are forgotten (no
  // frozen tab that answers every tap 'Not at a table').
  let leftByJoin = [];
  try { leftByJoin = tablesLeftByMainJoin(useTableStore.getState(), tableId); } catch { leftByJoin = []; }
  followJoinToTable({
    tableId,
    onFailed: (message) => { try { useProgressStore.getState().addNotification({ type: 'mission', message: `Club challenge: ${message}` }); } catch { /* ignore */ } },
    onJoined: () => {
      for (const id of leftByJoin) {
        try { useTableStore.getState().forgetTableSession(id); } catch { /* best-effort */ }
      }
    },
  });
  useTableStore.getState().joinTable(tableId, me.playerName, -1, n.challengeStakes, me.avatar);
  return true;
}
