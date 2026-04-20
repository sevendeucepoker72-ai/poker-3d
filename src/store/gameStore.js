import { create } from 'zustand';
import { getSocket } from '../services/socketService';

const AVATAR_STORAGE_KEY = 'poker_avatar';

// Debounced persistence sweep: sync avatar customization to server (400ms quiet).
let _avatarSyncTimer = null;
function scheduleAvatarSync(avatar) {
  if (_avatarSyncTimer) clearTimeout(_avatarSyncTimer);
  _avatarSyncTimer = setTimeout(() => {
    _avatarSyncTimer = null;
    const socket = getSocket();
    if (socket && socket.connected) socket.emit('updateAvatar', avatar);
  }, 400);
}

function loadSavedAvatar(defaults) {
  try {
    const raw = sessionStorage.getItem(AVATAR_STORAGE_KEY);
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

  // OAuth2 token state
  oauthAccessToken: null,
  oauthRefreshToken: null,
  oauthIdToken: null,
  oauthTokenExpiry: null,

  login: (userData, token) => set({
    isLoggedIn: true,
    userId: userData.id,
    authToken: token,
    playerName: userData.displayName || userData.username,
    phone: userData.phone || '',
    needsUsername: userData.needsUsername || false,
    chips: userData.chips,
    screen: userData.needsUsername ? 'chooseUsername' : 'lobby',
  }),

  // OAuth2 SSO login
  oauthLogin: (tokens, userData) => set({
    isLoggedIn: true,
    userId: userData.id,
    authToken: tokens.access_token,
    oauthAccessToken: tokens.access_token,
    oauthRefreshToken: tokens.refresh_token,
    oauthIdToken: tokens.id_token || null,
    oauthTokenExpiry: Date.now() + (tokens.expires_in * 1000),
    playerName: userData.displayName || userData.username,
    phone: userData.phone || '',
    needsUsername: userData.needsUsername || false,
    chips: userData.chips,
    screen: userData.needsUsername ? 'chooseUsername' : 'lobby',
  }),

  logout: () => {
    const idToken = get().oauthIdToken;
    // Auth tokens — explicit logout wipes BOTH stores (localStorage +
    // sessionStorage) so "Keep me signed in" state from a prior tab
    // can't resurrect the session on the next page load.
    for (const k of ['poker_auth_token','poker_keep_signed_in','poker_oauth_refresh','poker_oauth_id_token','poker_token_expiry']) {
      try { localStorage.removeItem(k); } catch {}
      try { sessionStorage.removeItem(k); } catch {}
    }
    // Identity / player profile — previously leaked across account switches
    // (next user would temporarily see the previous user's username, avatar,
    // and cached stats until the server response overwrote them).
    sessionStorage.removeItem('poker_username');
    sessionStorage.removeItem('poker_avatar');
    sessionStorage.removeItem('poker_player_stats');
    sessionStorage.removeItem('poker_remember_phone');
    // Cached progression state — stars, streak, battle pass, etc.
    sessionStorage.removeItem('app_poker_login_rewards');
    sessionStorage.removeItem('app_bp_premium');
    // Ephemeral UI caches
    sessionStorage.removeItem('poker_hand_history');
    set({
      isLoggedIn: false,
      userId: null,
      authToken: null,
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthIdToken: null,
      oauthTokenExpiry: null,
      playerName: '',
      chips: 10000,
      screen: 'login',
    });
    // SSO logout: redirect to auth server to clear session cookie
    if (idToken) {
      import('../services/authService').then(({ startLogout }) => startLogout(idToken));
    }
  },

  setAuth: (userId, token) => set({ userId, authToken: token }),

  // Player
  playerName: '',
  setPlayerName: (name) => set({ playerName: name }),
  chips: 10000,
  setChips: (chips) => set({ chips }),

  // Avatar config — loaded from sessionStorage if available
  avatar: loadSavedAvatar(DEFAULT_AVATAR),
  updateAvatar: (key, value) =>
    set((state) => {
      // Validate color-valued fields — reject anything that isn't a standard
      // 3/6/8-digit hex. Arbitrary strings could CSS-inject downstream.
      const COLOR_KEYS = new Set(['skinTone', 'hairColor', 'eyeColor', 'shirtColor', 'accessoryColor', 'lipColor', 'blushColor']);
      if (COLOR_KEYS.has(key) && typeof value === 'string' && !/^#([0-9A-F]{3}|[0-9A-F]{6}|[0-9A-F]{8})$/i.test(value)) {
        return state; // silently drop invalid color
      }
      const next = { ...state.avatar, [key]: value };
      sessionStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(next));
      scheduleAvatarSync(next);
      return { avatar: next };
    }),
  updateFaceShape: (key, value) =>
    set((state) => {
      const next = {
        ...state.avatar,
        faceShape: { ...state.avatar.faceShape, [key]: value },
      };
      sessionStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(next));
      scheduleAvatarSync(next);
      return { avatar: next };
    }),
  resetAvatar: () => {
    sessionStorage.removeItem(AVATAR_STORAGE_KEY);
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
