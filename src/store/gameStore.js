import { create } from 'zustand';

const AVATAR_STORAGE_KEY = 'poker_avatar';

function loadSavedAvatar(defaults) {
  try {
    const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    // Merge with defaults so any new fields are included
    return { ...defaults, ...parsed, faceShape: { ...defaults.faceShape, ...(parsed.faceShape || {}) } };
  } catch {
    return { ...defaults };
  }
}

const DEFAULT_AVATAR = {
  bodyType: 'male',
  skinTone: '#C68642',
  hairStyle: 'short',
  hairColor: '#2C1B0E',
  eyeColor: '#4A90D9',
  topStyle: 'tshirt',
  topColor: '#1A1A2E',
  bottomStyle: 'jeans',
  bottomColor: '#2D3A4A',
  accessory: 'none',
  faceShape: {
    jawWidth: 0.5,
    noseLength: 0.5,
    cheekHeight: 0.5,
    browHeight: 0.5,
    lipFullness: 0.5,
    eyeSize: 0.5,
  },
};

export const SEAT_COUNT = 9;

export const useGameStore = create((set, get) => ({
  // App state
  screen: 'login', // 'login' | 'lobby' | 'customizer' | 'table' | 'career'
  setScreen: (screen) => set({ screen }),

  // Auth state
  isLoggedIn: false,
  userId: null,
  authToken: null,

  login: (userData, token) => set({
    isLoggedIn: true,
    userId: userData.id,
    authToken: token,
    playerName: userData.username,
    chips: userData.chips,
    screen: 'lobby',
  }),

  logout: () => {
    localStorage.removeItem('poker_auth_token');
    localStorage.removeItem('poker_keep_signed_in');
    localStorage.removeItem('poker_username');
    sessionStorage.removeItem('poker_auth_token');
    set({
      isLoggedIn: false,
      userId: null,
      authToken: null,
      playerName: '',
      chips: 10000,
      screen: 'login',
    });
  },

  setAuth: (userId, token) => set({ userId, authToken: token }),

  // Player
  playerName: '',
  setPlayerName: (name) => set({ playerName: name }),
  chips: 10000,
  setChips: (chips) => set({ chips }),

  // Avatar config — loaded from localStorage if available
  avatar: loadSavedAvatar(DEFAULT_AVATAR),
  updateAvatar: (key, value) =>
    set((state) => {
      const next = { ...state.avatar, [key]: value };
      localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(next));
      return { avatar: next };
    }),
  updateFaceShape: (key, value) =>
    set((state) => {
      const next = {
        ...state.avatar,
        faceShape: { ...state.avatar.faceShape, [key]: value },
      };
      localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(next));
      return { avatar: next };
    }),
  resetAvatar: () => {
    localStorage.removeItem(AVATAR_STORAGE_KEY);
    set({ avatar: { ...DEFAULT_AVATAR } });
  },

  // Table state
  tableId: null,
  setTableId: (id) => set({ tableId: id }),
  seats: Array(SEAT_COUNT).fill(null),
  setSeat: (index, player) =>
    set((state) => {
      const seats = [...state.seats];
      seats[index] = player;
      return { seats };
    }),
  communityCards: [],
  setCommunityCards: (cards) => set({ communityCards: cards }),
  pot: 0,
  setPot: (pot) => set({ pot }),

  // Player hand
  hand: [],
  setHand: (hand) => set({ hand }),

  // Dealer state
  dealer: {
    buttonSeatIndex: 0,
  },
  setDealerButton: (index) =>
    set((state) => ({
      dealer: { ...state.dealer, buttonSeatIndex: index },
    })),

  // Animation phase tracking
  // idle | dealing | dealt | flop | flopRevealed | turn | turnRevealed | river | riverRevealed | showdown | gathering
  animationPhase: 'idle',
  setAnimationPhase: (phase) => set({ animationPhase: phase }),
  animationComplete: false,
  setAnimationComplete: (val) => set({ animationComplete: val }),

  // Cards dealt to each seat
  seatCards: {}, // { [seatIndex]: [card1, card2] }
  setSeatCards: (seatIndex, cards) =>
    set((state) => ({
      seatCards: { ...state.seatCards, [seatIndex]: cards },
    })),
  clearSeatCards: () => set({ seatCards: {} }),

  // Chip bets per seat for current round
  seatBets: {}, // { [seatIndex]: amount }
  setSeatBet: (seatIndex, amount) =>
    set((state) => ({
      seatBets: { ...state.seatBets, [seatIndex]: amount },
    })),
  clearSeatBets: () => set({ seatBets: {} }),

  // Current deck for the round
  deck: [],
  setDeck: (deck) => set({ deck }),

  // Start a new round
  startRound: () => {
    set({
      animationPhase: 'dealing',
      animationComplete: false,
      communityCards: [],
      seatCards: {},
      seatBets: {},
      pot: 0,
      hand: [],
    });
  },
}));
