import { create } from 'zustand';
import { getSocket } from '../services/socketService';

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
    // Dedup on clientMessageId — if the server echoes the same message twice
    // (transient connectivity, doubled emit, AT-LEAST-ONCE delivery) we drop
    // the duplicate rather than doubling bubbles in the transcript.
    if (msg?.clientMessageId) {
      const dup = state.chatMessages.some(m => m.clientMessageId === msg.clientMessageId);
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
    if (socket) socket.emit('playerDraw', { discardIndices });
    set({ selectedDiscards: [] });
  },

  // Actions - send to server (all check socket.connected)
  sendAction: (type, amount) => {
    const socket = getSocket();
    if (socket?.connected) socket.emit('action', { type, amount });
    else console.warn('[sendAction] Socket not connected');
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
      socket.emit('joinTable', { tableId, playerName, seatIndex, buyIn, avatar, expectedVariant });
    } else {
      console.warn('[joinTable] Socket not connected');
    }
  },

  quickPlay: (playerName, avatar) => {
    const socket = getSocket();
    if (socket?.connected) {
      console.log('[quickPlay] Emitting with name:', playerName);
      socket.emit('quickPlay', { playerName, avatar });
    } else {
      console.warn('[quickPlay] Socket not connected!');
    }
  },

  quickHeadsUp: (playerName, avatar) => {
    const socket = getSocket();
    if (socket?.connected) socket.emit('quickHeadsUp', { playerName, avatar });
    else console.warn('[quickHeadsUp] Socket not connected');
  },

  quickSpinGo: (playerName, avatar) => {
    const socket = getSocket();
    if (socket?.connected) socket.emit('quickSpinGo', { playerName, avatar });
    else console.warn('[quickSpinGo] Socket not connected');
  },

  quickAllInOrFold: (playerName, avatar) => {
    const socket = getSocket();
    if (socket?.connected) socket.emit('quickAllInOrFold', { playerName, avatar });
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
    if (socket) socket.emit('leaveTable');
    set({
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
    }
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
    if (socket) socket.emit('startCareerGame', { venue, stage });
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
    if (socket) socket.emit('joinAdditionalTable', { tableId, playerName, buyIn });
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
