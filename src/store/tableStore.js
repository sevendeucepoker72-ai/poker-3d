import { create } from 'zustand';
import { getSocket, emitPlayerAction } from '../services/socketService';
import { notePlayAttempt } from '../services/playAttempt';
import { markTableLeft, isTableLeft } from '../services/leftTables';

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

export const useTableStore = create((set, get) => ({
  // Game state from server
  gameState: null,
  setGameState: (state) => set({ gameState: state }),

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
  addChatMessage: (msg) => set((state) => {
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

  // Send draw action to server
  sendDraw: (discardIndices) => {
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('playerDraw', { discardIndices });
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

  startHand: () => {
    const socket = getSocket();
    if (socket?.connected) {
      console.log('[startHand] Requesting new hand');
      socket.emit('startHand');
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
    socket.emit('chatMessage', { message: key, clientMessageId });
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
      const newTables = new Map(activeTables);
      newTables.delete(currentTableId);
      set({ activeTables: newTables, currentTableId: newTables.size > 0 ? newTables.keys().next().value : null });
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
    return true;
  },

  requestTableList: () => {
    const socket = getSocket();
    if (socket) socket.emit('getTableList');
  },

  // Sit out
  sittingOut: false,
  toggleSitOut: () => {
    const socket = getSocket();
    if (socket) socket.emit('sitOut');
  },
  setSittingOut: (val) => set({ sittingOut: val }),

  // Training mode
  trainingEnabled: false,
  trainingData: null,
  toggleTraining: () => {
    const socket = getSocket();
    if (socket) socket.emit('toggleTraining');
  },
  setTrainingEnabled: (enabled) => set({ trainingEnabled: enabled }),
  setTrainingData: (data) => set({ trainingData: data }),

  // Hand history (last 20 hands)
  handHistories: [],
  addHandHistory: (history) => set((state) => ({
    handHistories: [...state.handHistories, history].slice(-20),
  })),

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
    if (socket?.connected) socket.emit('rabbitHunt');
  },

  // ========== Emote System ==========
  emotes: [], // { seatIndex, emoteId, playerName, timestamp }
  addEmote: (emote) => set((state) => ({
    emotes: [...state.emotes, { ...emote, timestamp: emote.timestamp ?? Date.now() }].slice(-50),
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
  },

  // ========== Multi-Table Support ==========
  activeTables: new Map(), // tableId -> { gameState, mySeat }
  currentTableId: null,

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

  updateActiveTable: (tableId, gameState) => {
    const { activeTables, currentTableId } = get();
    const newTables = new Map(activeTables);
    newTables.set(tableId, { gameState });
    const updates = { activeTables: newTables };
    // If this is the current displayed table, also update the main gameState
    if (tableId === currentTableId) {
      updates.gameState = gameState;
      updates.mySeat = gameState?.yourSeat ?? -1;
    }
    set(updates);
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
  },
}));
