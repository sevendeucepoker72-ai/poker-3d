import { create } from 'zustand';
import { getSocket, emitPlayerAction } from '../services/socketService';
import { notePlayAttempt } from '../services/playAttempt';
import { markTableLeft, isTableLeft } from '../services/leftTables';
// R1 (AUTH-6, contract #3) — every frame the table renders passes through these
// setters; a non-string name (number / object / array) is made safe here once,
// so no seat, winner or showdown row can crash the table for its viewers.
import { sanitizeTableState, sanitizeHandHistory, sanitizeNamedEvent, viewerHoleCardsOf } from '../utils/tablePayload';
import { drawSelectionKey } from '../utils/actionBar';
import { tableScope, sittingOutHereOf } from '../utils/tableFlows';
import { recordVariantFromTable } from '../utils/handLog';

// 2026-10-07 — every gated play emit records how to replay itself, so a
// login_required refusal that lands on a signed-out socket (reconnect race) can
// be re-authenticated silently and retried ONCE (services/playRefusal.js).
// No-op inside a screen's runPlayFlow, which records its whole flow instead.
function emitPlay(socket, event, payload) {
  notePlayAttempt(() => {
    const s = getSocket();
    if (s?.connected) s.emit(event, payload);
  });
  socket.emit(event, payload);
}

// GameHUD remembers a Sit Out across a reload in this tab's sessionStorage and
// replays it when a seat first shows. Round 7 (Z12): an explicit Return to a
// tournament seat forgets it — the server restores the seat NOT sitting out,
// and he came back to play.
export const SIT_OUT_PREF_KEY = 'app_poker_sittingOut';
export function forgetSitOutPreference() {
  try { sessionStorage.setItem(SIT_OUT_PREF_KEY, '0'); } catch { /* ignore */ }
}

// ── R2 (TABLEUI-14, 2026-10-11) — the multi-table map holds only real tables ──
// `activeTables` used to collect EVERY table whose frame was ever shown (a
// watched table, a table the player was moved from, an extra table whose seat
// ended): they stayed as "phantom" tabs, and a tap on one (or a stale
// `currentTableId`) froze the view on a table that sends nothing — the next
// join then rendered blank and the lobby said "Server didn't respond".
// Now: an entry is kept only while this socket holds a LIVE seat there, or it
// is the table on screen (its state is the delta merge base); `currentTableId`
// is set only while 2+ seats are live (single-table mode otherwise, where every
// frame is the table on screen).

// R2 (TABLEUI-10) — the training panel is open or minimized (remembered for
// this tab; minimized by default on a phone, where it used to cover Back,
// Sit Out, Options and the board). The top bar's Training badge toggles it.
const TRAINING_PANEL_KEY = 'app_poker_trainingDock';
function readTrainingPanelOpen() {
  try {
    const v = sessionStorage.getItem(TRAINING_PANEL_KEY);
    if (v === 'open') return true;
    if (v === 'collapsed') return false;
  } catch { /* ignore */ }
  try { return !(window.matchMedia && window.matchMedia('(max-width: 600px), (max-height: 500px)').matches); } catch { return true; }
}

/** A table state where this socket holds a live seat (not watching). */
export function isLiveSeatState(gs) {
  return !!gs && typeof gs === 'object' && !gs.isSpectator && Number(gs.yourSeat) >= 0;
}

/** Ids of the activeTables entries where this socket holds a live seat. */
export function liveTableIds(activeTables) {
  const out = [];
  if (!activeTables || typeof activeTables.forEach !== 'function') return out;
  activeTables.forEach((entry, id) => { if (isLiveSeatState(entry && entry.gameState)) out.push(id); });
  return out;
}

/**
 * The settled multi-table state for `s` (store state), or null when nothing
 * changes: { updates, dropped:[[id, entry]] }. Kept: the table on screen (its
 * state is the delta merge base) and live seats — in single-table mode only
 * EXTRA tables (joinAdditionalTable) besides the shown one, since every other
 * cached table there is a table the socket already left (a watched table, a
 * table it was moved from, the previous quick table).
 */
function settleTables(s) {
  const { activeTables, currentTableId, gameState } = s;
  if (!activeTables || typeof activeTables.forEach !== 'function') return null;
  const shownId = gameState && gameState.tableId != null ? String(gameState.tableId) : null;
  const next = new Map();
  const dropped = [];
  activeTables.forEach((entry, id) => {
    const live = isLiveSeatState(entry && entry.gameState);
    const keep = (shownId !== null && String(id) === shownId)
      || (live && (!!(entry && entry.extra) || currentTableId != null));
    if (keep) next.set(id, entry);
    else dropped.push([id, entry]);
  });
  const live = liveTableIds(next);
  const updates = {};
  let cur = currentTableId;
  if (live.length >= 2) {
    if (!cur || !live.includes(cur)) cur = live[0];
  } else if (live.length === 1 && shownId !== null && String(live[0]) !== shownId && cur !== null) {
    // The only live seat is not the table on screen (the shown one ended):
    // show the live one; the dead one goes at the next settle.
    cur = live[0];
  } else if (live.length === 1 && next.get(live[0]) && next.get(live[0]).extra) {
    // R2 review (K1-2) — the only live seat left is an EXTRA seat (the main
    // quick game ended, or the main seat was stood up after the sit-out
    // limit): keep addressing it by id. With currentTableId null every action
    // went out without a tableId, the server resolved the gone main session
    // ("Not at a table") and the hands there timed out.
    cur = live[0];
  } else {
    cur = null;
  }
  if (cur !== currentTableId) {
    updates.currentTableId = cur;
    if (cur && (!shownId || String(cur) !== shownId)) {
      const entry = next.get(cur);
      updates.gameState = (entry && entry.gameState) || null;
      updates.mySeat = entry && entry.gameState && entry.gameState.yourSeat != null ? entry.gameState.yourSeat : -1;
    }
  }
  if (dropped.length) updates.activeTables = next;
  if (!Object.keys(updates).length) return null;
  return { updates, dropped };
}

// Gameplay audit F150 (2026-10-21) — what belongs to ONE table session and
// must not carry into the next table once the shown table closes with no
// other seat to show (closeTable / the career stage end): its chat, emotes,
// training toggle + panel data, a draw selection and rabbit cards. Never the
// quick-game / career result (an app-level overlay shown over the lobby) nor
// handHistories (a cross-table log hydrated at sign-in for "Last Hand").
export function perTableSessionReset() {
  return {
    chatMessages: [], emotes: [], trainingEnabled: false, trainingData: null,
    selectedDiscards: [], rabbitCards: null,
  };
}

export const useTableStore = create((set, get) => ({
  // Game state from server
  gameState: null,
  setGameState: (state) => {
    set({ gameState: sanitizeTableState(state) });
    // R2 (TABLEUI-14) — the table that was on screen before may now be stale.
    get().settleActiveTables();
  },

  // Connection
  connected: false,
  setConnected: (val) => set({ connected: val }),

  // Table list from server
  tables: [],
  setTables: (tables) => set({ tables }),

  // Player's seat index at current table
  mySeat: -1,
  setMySeat: (seat) => set({ mySeat: seat }),

  // Chat messages (ring-buffered at 100 entries in memory — UI just slices
  // when rendering). We used to inject a fake "— older messages not shown —"
  // system row whenever the cap tripped, but that rendered as a real chat
  // bubble and confused users who thought someone said "older messages not
  // shown". Instead, we just cap silently; GameHUD renders a subtle "older
  // messages hidden" badge ABOVE the scroll area when it detects a cap hit.
  chatMessages: [],
  addChatMessage: (rawMsg) => set((state) => {
    const msg = sanitizeNamedEvent(rawMsg);
    // Dedup — primary key is clientMessageId (server echoes it back so we
    // can match round-trip). Fallback: if the incoming msg has no
    // clientMessageId (server-originated system messages, or older client
    // code), dedup on (playerName, message, same-second timestamp bucket)
    // so an identical message within 1000ms is still caught. Prevents
    // double bubbles on flaky connectivity or when both sender-local
    // echo and server-broadcast arrive.
    if (msg?.clientMessageId) {
      const dup = state.chatMessages.some(m => m.clientMessageId === msg.clientMessageId);
      if (dup) return state;
    } else if (msg?.message && msg?.playerName) {
      const incomingTs = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
      const dup = state.chatMessages.some(m => {
        if (!m.message || !m.playerName) return false;
        if (m.playerName !== msg.playerName) return false;
        if (m.message !== msg.message) return false;
        const mTs = typeof m.timestamp === 'number' ? m.timestamp : 0;
        return Math.abs(mTs - incomingTs) < 1000;
      });
      if (dup) return state;
    }
    const updated = [...state.chatMessages, msg];
    return { chatMessages: updated.length > 100 ? updated.slice(-100) : updated };
  }),

  // Draw game: selected cards to discard
  selectedDiscards: [],
  setSelectedDiscards: (indices) => set({ selectedDiscards: indices }),
  toggleDiscard: (index) => set((state) => {
    const current = state.selectedDiscards;
    if (current.includes(index)) {
      return { selectedDiscards: current.filter((i) => i !== index) };
    }
    return { selectedDiscards: [...current, index] };
  }),

  // Send draw action to server. (tableId: the table on screen in multi-table
  // mode — the value sendAction sends; null in single-table mode → the main
  // seat. An older server ignores it.)
  sendDraw: (discardIndices) => {
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('playerDraw', { discardIndices, tableId: get().currentTableId || undefined });
    } else {
      console.warn('[sendDraw] Socket not connected');
    }
    set({ selectedDiscards: [] });
  },

  // Actions - send to server. Uses emitPlayerAction which (a) attaches a
  // nonce so the server can dedupe replays, and (b) queues the action if
  // the socket is mid-reconnect instead of silently dropping it. The
  // pending-action slot is single — if the user taps twice during a
  // disconnect the latest intent wins, same as if they had been connected.
  sendAction: (type, amount) => {
    // Echo the decision-point version we're acting on (2026-07-05). The store's
    // gameState is the merged authoritative snapshot from the server (delta
    // merges preserve stateVersion across idle ticks), so this is exactly the
    // version the user is looking at. The server rejects the action if the table
    // has since advanced past it and re-pushes fresh state. undefined pre-rollout.
    const stateVersion = get().gameState?.stateVersion;
    // 2026-07-07 gap-fill [5]: pass the active table id so multi-table actions
    // route to the table the user is looking at. currentTableId is null for
    // single-table players → the server falls back to the primary session
    // (unchanged behavior). In multi-table mode it tracks the focused pane, and
    // the store's gameState is swapped to match it, so this stays consistent
    // with the stateVersion above.
    const tableId = get().currentTableId || undefined;
    const result = emitPlayerAction(type, amount, stateVersion, tableId);
    if (!result.sent && !result.queued) {
      console.warn('[sendAction] Action dropped');
    } else if (result.queued) {
      console.log('[sendAction] Queued during disconnect:', type);
    }
  },

  // `expectedVariant` is optional but strongly recommended — it tells the
  // server which variant the user thought they were joining. If the server's
  // current variant doesn't match (table got converted, rebalanced, etc.)
  // the join is rejected with a clear error instead of silently seating the
  // player at a different game type. Fixes the "I clicked Hold'em, ended
  // up at a Draw table" class of bug.
  joinTable: (tableId, playerName, seatIndex, buyIn, avatar, expectedVariant) => {
    const socket = getSocket();
    if (socket?.connected) {
      console.log('[joinTable] Joining:', tableId, playerName, 'expected:', expectedVariant);
      emitPlay(socket, 'joinTable', { tableId, playerName, seatIndex, buyIn, avatar, expectedVariant });
    } else {
      console.warn('[joinTable] Socket not connected');
    }
  },

  quickPlay: (playerName, avatar) => {
    const socket = getSocket();
    if (socket?.connected) {
      console.log('[quickPlay] Emitting with name:', playerName);
      emitPlay(socket, 'quickPlay', { playerName, avatar });
    } else {
      console.warn('[quickPlay] Socket not connected!');
    }
  },

  quickHeadsUp: (playerName, avatar) => {
    const socket = getSocket();
    if (socket?.connected) emitPlay(socket, 'quickHeadsUp', { playerName, avatar });
    else console.warn('[quickHeadsUp] Socket not connected');
  },

  quickSpinGo: (playerName, avatar) => {
    const socket = getSocket();
    if (socket?.connected) emitPlay(socket, 'quickSpinGo', { playerName, avatar });
    else console.warn('[quickSpinGo] Socket not connected');
  },

  quickAllInOrFold: (playerName, avatar) => {
    const socket = getSocket();
    if (socket?.connected) emitPlay(socket, 'quickAllInOrFold', { playerName, avatar });
    else console.warn('[quickAllInOrFold] Socket not connected');
  },

  // Gameplay audit F50 (2026-10-21) — Auto Deal / Deal now ask the server to
  // deal; a fixed server runs its full hand-boundary step for it (bot stack
  // cap, bomb pot, seat moves). Always an object payload (the server's socket
  // guard refuses a payload-taking handler's missing one); tableId = the table
  // on screen in multi-table mode, else the main seat (an older server
  // ignores it).
  startHand: () => {
    const socket = getSocket();
    if (socket?.connected) {
      console.log('[startHand] Requesting new hand');
      socket.emit('startHand', { tableId: get().currentTableId || undefined });
    } else {
      console.warn('[startHand] Socket not connected!');
    }
  },

  // Idempotency for chat: GameHUD may invoke sendChat more than once on a
  // flaky network (button retry, hotkey repeat). We suppress duplicate emits
  // within a 1500ms window per-text, AND generate a clientMessageId that the
  // server can echo back so `addChatMessage` can dedupe on receipt.
  _recentChatSends: new Map(), // text → timestamp
  sendChat: (message) => {
    const socket = getSocket();
    if (!socket?.connected) return;
    const key = String(message || '').trim();
    if (!key) return;
    const now = Date.now();
    const recent = get()._recentChatSends;
    const last = recent.get(key);
    if (last && now - last < 1500) return; // suppress double-click / key repeat
    recent.set(key, now);
    // Garbage-collect entries older than 5s so the map doesn't grow unbounded.
    for (const [k, t] of recent) {
      if (now - t > 5000) recent.delete(k);
    }
    const clientMessageId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `c_${now}_${Math.random().toString(36).slice(2, 10)}`;
    // Gameplay audit F156 (2026-10-21) — multi-table: the table on screen
    // (an older server ignores it and posts to the main table, as before).
    socket.emit('chatMessage', { message: key, clientMessageId, tableId: tableScope(get().currentTableId) });
  },

  leaveTable: () => {
    const socket = getSocket();
    // S2 round 2 (V3) — the seat this socket is leaving (single-table mode:
    // currentTableId is null and the displayed gameState is the primary
    // seat 'leaveTable' ends server-side). Read BEFORE the state is cleared.
    const before = get();
    const shown = before.gameState;
    const leftTableId = !before.currentTableId && shown && shown.tableId != null ? String(shown.tableId) : null;
    const heldSeat = !!leftTableId && (Number(shown.yourSeat) >= 0 || before.mySeat >= 0);
    if (socket) socket.emit('leaveTable');
    // R2 (TABLEUI-14) — 'leaveTable' ends the MAIN seat only; an EXTRA table
    // (joinAdditionalTable) left behind would keep its seat with no UI and be
    // auto-folded every hand. Back to Lobby leaves them too (cash tables only —
    // the server credits each stack), and their late frames are ignored.
    if (before.activeTables && typeof before.activeTables.forEach === 'function') {
      before.activeTables.forEach((entry, id) => {
        if (!entry || !entry.extra) return;
        try { if (socket) socket.emit('leaveAdditionalTable', { tableId: id }); } catch { /* ignore */ }
        markTableLeft(id, entry.gameState);
      });
    }
    set({
      // Review (round 7): a Sit Out never carries over to the NEXT seat — every
      // new server session starts not sitting out (a stale flag showed the
      // tournament sit-out note at a seat the server has him playing).
      sittingOut: false,
      gameState: null, mySeat: -1, chatMessages: [], handHistories: [],
      trainingEnabled: false, trainingData: null, spinMultiplier: null,
      quickGameResult: null, isSpectating: false, emotes: [],
      selectedDiscards: [],
    });
    // Clear from multi-table
    const { activeTables, currentTableId } = get();
    if (activeTables && currentTableId) {
      // R2 — every table this socket was at is left above (main + extras);
      // the main seat's late frames are ignored like the single-table path.
      activeTables.forEach((entry, id) => {
        if (entry && !entry.extra && isLiveSeatState(entry.gameState)) markTableLeft(id, entry.gameState);
      });
      set({ activeTables: new Map(), currentTableId: null });
    } else if (heldSeat) {
      // Single table: its activeTables entry goes too (it was the merge base
      // a late delta used to bring the stale seat back), and late frames for
      // it are ignored until the socket is at it again (services/leftTables).
      const cached = activeTables && activeTables.get(leftTableId);
      markTableLeft(leftTableId, (cached && cached.gameState) || shown);
      if (activeTables && activeTables.has(leftTableId)) {
        const newTables = new Map(activeTables);
        newTables.delete(leftTableId);
        set({ activeTables: newTables });
      }
    }
  },

  // S2 round 2 — the server ended this socket's session at `tableId` without
  // the client leaving it on screen ('tournamentSeatKept' after a server-side
  // leave: joinTable / quickPlay / spectate from the lobby, Android back;
  // round 6: 'tournamentSeatTakenOver', another connection of the account
  // took the seat). Its activeTables entry is dropped and, if it is the
  // table the store shows, the store forgets it.
  // Round 3 (W2): ONLY a table this socket was SEATED at (and left). A table
  // it WATCHES as a spectator (a rebalance moved the absent seat INTO the
  // table he is watching) or one it never showed is left alone — never
  // blanked. Returns true when it forgot the table.
  // Round 6: its frames are NOT ignored from here on (only its merge base is
  // kept): the server sent this AFTER it ended the session, so no stale
  // frame follows it — and a Watch / Watch Live the server answers right
  // after (Android back, then Watch on his own table) must be shown.
  forgetTableSession: (tableId) => {
    const id = tableId != null ? String(tableId) : null;
    if (!id) return false;
    const { activeTables, currentTableId, gameState, isSpectating, mySeat } = get();
    const cached = activeTables && activeTables.get(id);
    const shown = gameState && String(gameState.tableId) === id ? gameState : null;
    const seatedIn = (gs, seatHint) => !!gs && !gs.isSpectator
      && (Number(gs.yourSeat) >= 0 || Number(seatHint) >= 0);
    // (A mark this socket's own leaveTable set — it was seated there — counts:
    // the announcement ends its ignore window; the merge base stays.)
    const seatedHere = (shown && !isSpectating && seatedIn(shown, mySeat))
      || (!!cached && seatedIn(cached.gameState, -1))
      || isTableLeft(id);
    if (!seatedHere) return false;
    markTableLeft(id, (cached && cached.gameState) || shown, { ignore: false });
    // Review (round 7): the seat he was sitting out at is gone from this tab.
    const updates = { sittingOut: false };
    if (activeTables && activeTables.has(id)) {
      const newTables = new Map(activeTables);
      newTables.delete(id);
      updates.activeTables = newTables;
      if (currentTableId === id) {
        const nextId = newTables.size > 0 ? newTables.keys().next().value : null;
        updates.currentTableId = nextId;
        if (nextId) {
          const next = newTables.get(nextId);
          updates.gameState = (next && next.gameState) || null;
          updates.mySeat = next && next.gameState && next.gameState.yourSeat != null ? next.gameState.yourSeat : -1;
        }
      }
    }
    if (shown && !('gameState' in updates)) { updates.gameState = null; updates.mySeat = -1; updates.isSpectating = false; }
    if (Object.keys(updates).length) set(updates);
    get().settleActiveTables();
    return true;
  },

  requestTableList: () => {
    const socket = getSocket();
    if (socket) socket.emit('getTableList');
  },

  // Sit out
  sittingOut: false,
  // Gameplay audit F87 / F156 (2026-10-21) — Sit Out says what it WANTS
  // (`sittingOut`) for the table on screen (`tableId` in multi-table mode): a
  // newer server sets that value on that seat (a repeat is answered
  // 'unchanged'). It used to be a bare toggle of the MAIN seat, so a tap at an
  // extra table sat the main one out (folding a live hand there), and a
  // remembered Sit Out replayed over a seat already sitting out sat him IN.
  // An older server ignores the payload and toggles the main seat (today).
  setSitOut: (want) => {
    const socket = getSocket();
    if (socket) socket.emit('sitOut', { sittingOut: !!want, tableId: tableScope(get().currentTableId) });
  },
  toggleSitOut: () => {
    const s = get();
    s.setSitOut(!sittingOutHereOf(s));
  },
  setSittingOut: (val) => set({ sittingOut: val }),

  // Training mode
  trainingEnabled: false,
  trainingData: null,
  toggleTraining: () => {
    const socket = getSocket();
    // F156 — the table on screen in multi-table mode (else the main seat).
    if (socket) socket.emit('toggleTraining', { tableId: tableScope(get().currentTableId) });
  },
  setTrainingEnabled: (enabled) => set({ trainingEnabled: enabled }),
  setTrainingData: (data) => set({ trainingData: data }),
  trainingPanelOpen: readTrainingPanelOpen(),
  setTrainingPanelOpen: (open) => {
    set({ trainingPanelOpen: !!open });
    try { sessionStorage.setItem(TRAINING_PANEL_KEY, open ? 'open' : 'collapsed'); } catch { /* ignore */ }
  },

  // Hand history (last 20 hands)
  handHistories: [],
  addHandHistory: (history) => set((state) => {
    let rec = sanitizeHandHistory(history);
    // R2 (APPUI-16) — the record masks every hand that was not shown, the
    // viewer's OWN included (a fold, an uncontested pot): keep his cards — he
    // saw them — for his replay. Only from his live seat in that same hand.
    // R3 (contract H1) — the server's own viewerSeat / viewerHoleCards come
    // first (validated); the live seat of that same hand only for an older
    // server (and only when the record is the table on screen).
    try {
      const gs = state.gameState;
      const liveSeat = gs && !gs.isSpectator && Number(gs.yourSeat) >= 0 ? Number(gs.yourSeat) : null;
      const seat = rec && Number.isInteger(rec.viewerSeat) && rec.viewerSeat >= 0 ? rec.viewerSeat : liveSeat;
      const live = gs && (rec?.tableId == null || String(gs.tableId) === String(rec.tableId)) ? gs : null;
      const mine = seat !== null && rec ? viewerHoleCardsOf(rec, seat, live) : null;
      if (mine) rec = { ...rec, viewerSeat: seat, viewerHoleCards: mine };
      else if (rec && rec.viewerHoleCards !== undefined) rec = { ...rec, viewerHoleCards: undefined };
    } catch { /* best-effort */ }
    // Gameplay audit G180 (2026-10-21) — the replay rates hands by the record's
    // variant (Omaha: exactly two hole cards); a server that does not send it
    // gets the variant of that same table's live state (never a guess).
    try {
      const variant = recordVariantFromTable(rec, state.gameState, state.activeTables);
      if (variant) rec = { ...rec, variant };
    } catch { /* best-effort */ }
    return { handHistories: [...state.handHistories, rec].slice(-20) };
  }),

  // Provably fair
  deckCommitment: null,
  deckRevelation: null,
  setDeckCommitment: (c) => set({ deckCommitment: c, deckRevelation: null }),
  setDeckRevelation: (r) => set({ deckRevelation: r }),

  // Tournament bracket
  activeTournament: null,
  setActiveTournament: (t) => set({ activeTournament: t }),

  // Staking
  stakingOffers: [],
  setStakingOffers: (offers) => set({ stakingOffers: offers }),

  // Quick-play
  spinMultiplier: null,
  setSpinMultiplier: (m) => set({ spinMultiplier: m }),
  quickGameResult: null,
  setQuickGameResult: (r) => set({ quickGameResult: r }),

  // Career mode
  startCareerGame: (venue, stage) => {
    const socket = getSocket();
    if (socket) emitPlay(socket, 'startCareerGame', { venue, stage });
  },

  // ========== Rabbit Hunt ==========
  rabbitCards: null,
  setRabbitCards: (cards) => set({ rabbitCards: cards }),
  clearRabbitCards: () => set({ rabbitCards: null }),

  requestRabbitHunt: () => {
    const socket = getSocket();
    // F156 — the table on screen in multi-table mode (else the main seat).
    if (socket?.connected) socket.emit('rabbitHunt', { tableId: tableScope(get().currentTableId) });
  },

  // ========== Emote System ==========
  emotes: [], // { seatIndex, emoteId, playerName, timestamp }
  addEmote: (emote) => set((state) => ({
    emotes: [...state.emotes, { ...sanitizeNamedEvent(emote), timestamp: emote.timestamp ?? Date.now() }].slice(-50),
  })),
  removeEmote: (timestamp) => set((state) => ({
    emotes: state.emotes.filter((e) => e.timestamp !== timestamp),
  })),

  // ========== Spectator Mode ==========
  isSpectating: false,
  setIsSpectating: (val) => set({ isSpectating: val }),

  spectateTable: (tableId) => {
    const socket = getSocket();
    if (socket) socket.emit('spectate', { tableId });
  },

  stopSpectating: () => {
    const socket = getSocket();
    if (socket) socket.emit('stopSpectating');
    set({ isSpectating: false, gameState: null });
    // R2 (TABLEUI-14) — the watched table's cache entry goes (no phantom tab,
    // no stale currentTableId pointing at it).
    get().settleActiveTables();
  },

  // ========== Multi-Table Support ==========
  activeTables: new Map(), // tableId -> { gameState, extra? }  (extra = joinAdditionalTable seat)
  currentTableId: null,

  // R2 (TABLEUI-14) — drop stale entries + keep currentTableId honest (see
  // settleTables above). A dropped EXTRA seat is left on the server (its room
  // would otherwise keep streaming frames) and its late frames are ignored;
  // any other dropped table keeps only its delta merge base.
  settleActiveTables: () => {
    // A settle can move the view off a dead table, which the next pass then
    // drops: run until stable (at most a few passes).
    for (let pass = 0; pass < 3; pass++) {
      const res = settleTables(get());
      if (!res) return;
      set(res.updates);
      for (const [id, entry] of res.dropped) {
        const gs = entry && entry.gameState;
        if (entry && entry.extra) {
          try { const s = getSocket(); if (s && s.connected) s.emit('leaveAdditionalTable', { tableId: id }); } catch { /* ignore */ }
          markTableLeft(id, gs);
        } else {
          markTableLeft(id, gs, { ignore: false });
        }
      }
    }
  },

  // R2 (TABLEUI-14) — the socket's seat at `tableId` is gone (playerMoved's
  // fromTable): its entry is dropped (no phantom tab for the old table) and,
  // with `ignore`, a late frame of it never flashes the old table back.
  // R2 (S1) — the server CLOSED a table (`tableClosed`: a private table nobody
  // plays at, a quick game that ended, a finished tournament's table). All
  // this tab held of it goes — the shown table, a cached / extra entry, a
  // watched table — and its late frames are ignored. Another live seat (multi
  // table) takes the screen. → { shown } — was the closed table on screen.
  closeTable: (tableId) => {
    const id = tableId != null ? String(tableId) : null;
    if (!id) return { shown: false };
    const { activeTables, currentTableId, gameState } = get();
    let key = null;
    if (activeTables && typeof activeTables.forEach === 'function') activeTables.forEach((_e, k) => { if (String(k) === id) key = k; });
    const cached = key !== null ? activeTables.get(key) : null;
    const shown = !!gameState && String(gameState.tableId) === id;
    if (!shown && !cached) return { shown: false };
    markTableLeft(key !== null ? key : id, (cached && cached.gameState) || (shown ? gameState : null), { ignore: true });
    const updates = {};
    let rest = activeTables;
    if (key !== null) {
      rest = new Map(activeTables);
      rest.delete(key);
      updates.activeTables = rest;
      if (currentTableId != null && String(currentTableId) === id) updates.currentTableId = null;
    }
    if (shown) {
      let nextId = null;
      if (rest && typeof rest.forEach === 'function') rest.forEach((e, k) => { if (nextId === null && e && isLiveSeatState(e.gameState)) nextId = k; });
      const next = nextId !== null ? rest.get(nextId) : null;
      Object.assign(updates, next
        ? { gameState: next.gameState, mySeat: next.gameState?.yourSeat ?? -1, isSpectating: false, sittingOut: false }
        : { gameState: null, mySeat: -1, isSpectating: false, sittingOut: false, ...perTableSessionReset() });
    }
    set(updates);
    get().settleActiveTables();
    return { shown };
  },

  // Gameplay audit F87 / F156 (2026-10-21) — shallow-merge `patch` into the
  // cached state of `tableId` (multi-table) and into the shown state when it
  // is that table (e.g. a sitOutToggled for one table of several).
  patchTableState: (tableId, patch) => {
    const id = tableId != null ? String(tableId) : null;
    if (!id || !patch || typeof patch !== 'object') return;
    const { activeTables, gameState } = get();
    const updates = {};
    let key = null;
    if (activeTables && typeof activeTables.forEach === 'function') activeTables.forEach((_e, k) => { if (String(k) === id) key = k; });
    if (key !== null) {
      const entry = activeTables.get(key);
      if (entry && entry.gameState) {
        const next = new Map(activeTables);
        next.set(key, { ...entry, gameState: { ...entry.gameState, ...patch } });
        updates.activeTables = next;
      }
    }
    if (gameState && String(gameState.tableId) === id) updates.gameState = { ...gameState, ...patch };
    if (Object.keys(updates).length) set(updates);
  },

  dropActiveTable: (tableId, { ignore = false } = {}) => {
    const id = tableId != null ? String(tableId) : null;
    const { activeTables } = get();
    if (!id || !activeTables) return;
    let key = null;
    activeTables.forEach((_e, k) => { if (String(k) === id) key = k; });
    if (key === null) return;
    const entry = activeTables.get(key);
    const next = new Map(activeTables);
    next.delete(key);
    markTableLeft(key, entry && entry.gameState, { ignore: !!ignore });
    const updates = { activeTables: next };
    if (get().currentTableId === key) updates.currentTableId = null;
    set(updates);
    get().settleActiveTables();
  },

  switchActiveTable: (tableId) => {
    const { activeTables } = get();
    const tableData = activeTables.get(tableId);
    if (tableData) {
      set({
        currentTableId: tableId,
        gameState: tableData.gameState,
        mySeat: tableData.gameState?.yourSeat ?? -1,
      });
    }
    const socket = getSocket();
    if (socket) socket.emit('switchTable', { tableId });
  },

  updateActiveTable: (tableId, rawGameState, { extra } = {}) => {
    const gameState = sanitizeTableState(rawGameState);
    const { activeTables, currentTableId } = get();
    const newTables = new Map(activeTables);
    const prevEntry = activeTables.get(tableId);
    // R2 — an EXTRA seat (joinAdditionalTable) stays marked as one.
    newTables.set(tableId, { gameState, extra: extra === true || !!(prevEntry && prevEntry.extra) });
    const updates = { activeTables: newTables };
    // If this is the current displayed table, also update the main gameState
    if (tableId === currentTableId) {
      updates.gameState = gameState;
      updates.mySeat = gameState?.yourSeat ?? -1;
    }
    set(updates);
    get().settleActiveTables();
  },

  joinAdditionalTable: (tableId, playerName, buyIn) => {
    const socket = getSocket();
    if (socket) emitPlay(socket, 'joinAdditionalTable', { tableId, playerName, buyIn });
  },

  leaveAdditionalTable: (tableId) => {
    const socket = getSocket();
    if (socket) socket.emit('leaveAdditionalTable', { tableId });
    const { activeTables, currentTableId } = get();
    const newTables = new Map(activeTables);
    markTableLeft(tableId, activeTables.get(tableId)?.gameState);
    newTables.delete(tableId);
    const updates = { activeTables: newTables };
    if (tableId === currentTableId) {
      const nextId = newTables.size > 0 ? newTables.keys().next().value : null;
      updates.currentTableId = nextId;
      if (nextId) {
        const nextData = newTables.get(nextId);
        updates.gameState = nextData?.gameState || null;
        updates.mySeat = nextData?.gameState?.yourSeat ?? -1;
      } else {
        updates.gameState = null;
        updates.mySeat = -1;
      }
    }
    set(updates);
    get().settleActiveTables();
  },
}));

// Gameplay audit G172 (2026-10-21) — the selected discards belong to ONE draw
// round of one hand at one table. They used to be cleared only by a draw or a
// leave, so a selection the draw clock stood pat stayed raised through the
// betting and was pre-armed at the next round / the next hand ("Discard &
// Draw 2" for cards he never picked). Every path that changes the shown state
// (a frame, a table switch, a settle) lands here; frames inside the round
// (other players' draws) keep the key, so a selection in progress survives.
useTableStore.subscribe((state, prev) => {
  if (!prev || state.gameState === prev.gameState) return;
  if (!state.selectedDiscards || state.selectedDiscards.length === 0) return;
  if (drawSelectionKey(state.gameState) !== drawSelectionKey(prev.gameState)) {
    useTableStore.setState({ selectedDiscards: [] });
  }
});
