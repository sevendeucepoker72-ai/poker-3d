import { create } from 'zustand';

let notificationIdCounter = 0;

// ─── 500-level XP system ────────────────────────────────────────────────────
const MAX_LEVEL = 500;

/** XP required to go from `level` to `level + 1`. */
export function xpRequiredForLevel(level) {
  if (level <= 0) return 100;
  if (level >= MAX_LEVEL) return Infinity;
  // Smooth curve: starts easy (100 XP), ramps to ~25 000 XP at level 500
  // Formula: 100 + 40·L + 0.08·L²  (L = current level)
  return Math.round(100 + 40 * level + 0.08 * level * level);
}

/** Total XP needed from 0 to reach `level`. */
export function totalXpForLevel(level) {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpRequiredForLevel(l);
  return total;
}

/** Given a cumulative XP amount, return { level, xpIntoLevel, xpToNextLevel }. */
export function levelFromTotalXp(totalXp) {
  let level = 1;
  let remaining = totalXp;
  while (level < MAX_LEVEL) {
    const req = xpRequiredForLevel(level);
    if (remaining < req) break;
    remaining -= req;
    level++;
  }
  return {
    level,
    xp: remaining,                          // XP into current level
    xpToNextLevel: xpRequiredForLevel(level), // XP needed for next level
    totalXp,
  };
}

/** Tier brackets for 500 levels. */
export function getLevelTier(level) {
  if (level >= 400) return { name: 'Legendary',  color: '#FF4500', glow: '#FF6347' };
  if (level >= 300) return { name: 'Master',     color: '#E040FB', glow: '#CE93D8' };
  if (level >= 200) return { name: 'Platinum',   color: '#00E5FF', glow: '#00B8D4' };
  if (level >= 100) return { name: 'Diamond',    color: '#B9F2FF', glow: '#00E5FF' };
  if (level >= 50)  return { name: 'Gold',       color: '#FFD700', glow: '#FFA500' };
  if (level >= 20)  return { name: 'Silver',     color: '#C0C0C0', glow: '#A0A0C0' };
  return                   { name: 'Bronze',     color: '#CD7F32', glow: '#A0522D' };
}

// ─── Leak Detection ──────────────────────────────────────────────────────────
export function detectLeaks(progress) {
  if (!progress || (progress.handsPlayed || 0) < 20) return []; // need enough data
  const leaks = [];
  const vpip = progress.vpip || 0;
  const pfr = progress.pfr || 0;
  if (vpip > 40) leaks.push({ type: 'warning', stat: 'VPIP', value: vpip, tip: `Your VPIP is ${vpip}% — you're playing too many hands. Tighten up to top 25% (VPIP ~22-28%).` });
  else if (vpip < 12 && progress.handsPlayed > 50) leaks.push({ type: 'info', stat: 'VPIP', value: vpip, tip: `Your VPIP is ${vpip}% — you're playing too tight. Open up with more suited connectors and broadway hands.` });
  if (pfr < 8 && progress.handsPlayed > 50) leaks.push({ type: 'warning', stat: 'PFR', value: pfr, tip: `Your PFR is ${pfr}% — you're not raising enough preflop. Raise more instead of limping.` });
  if (vpip > 0 && pfr > 0 && (vpip - pfr) > 15) leaks.push({ type: 'warning', stat: 'VPIP-PFR Gap', value: vpip - pfr, tip: `Gap of ${vpip - pfr}% between VPIP and PFR — you're calling too much preflop. Raise or fold, don't limp.` });
  const winRate = progress.winRate || 0;
  if (winRate < 5 && progress.handsPlayed > 100) leaks.push({ type: 'warning', stat: 'Win Rate', value: winRate, tip: `Win rate of ${winRate}% is very low. Focus on position, hand selection, and bet sizing.` });
  // Position leaks
  const ps = progress.positionStats || {};
  if (ps['UTG'] && ps['UTG'].played > 10) {
    const utgWinPct = Math.round((ps['UTG'].won / ps['UTG'].played) * 100);
    if (utgWinPct < 3) leaks.push({ type: 'info', stat: 'UTG Play', value: utgWinPct, tip: 'You rarely win from UTG. Play tighter in early position — only premium hands.' });
  }
  return leaks;
}

// ─── localStorage persistence ───────────────────────────────────────────────
const STORAGE_KEY = 'poker_player_progress';

function loadSavedProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt data */ }
  return null;
}

function saveProgress(progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    // Also sync stats for AdvancedAnalytics leaks tab
    localStorage.setItem('poker_player_stats', JSON.stringify({
      vpip: progress.vpip || 0,
      pfr: progress.pfr || 0,
      handsPlayed: progress.handsPlayed || 0,
      winRate: progress.winRate || 0,
      aggressionFactor: progress.pfr > 0 ? ((progress.vpip || 0) / (progress.pfr || 1)).toFixed(1) : 0,
      bestStreak: progress.bestStreak || 0,
      biggestPot: progress.biggestPot || 0,
    }));
  } catch { /* storage full — ignore */ }
}

// ─── Achievements ────────────────────────────────────────────────────────────
export const ACHIEVEMENTS = [
  { id: 'first_hand',      name: 'Beginner',         desc: 'Play your first hand',           check: p => p.handsPlayed >= 1 },
  { id: 'first_win',       name: 'First Blood',      desc: 'Win your first hand',            check: p => p.handsWon >= 1 },
  { id: 'hands_10',        name: 'Getting Started',   desc: 'Play 10 hands',                 check: p => p.handsPlayed >= 10 },
  { id: 'hands_50',        name: 'Regular',           desc: 'Play 50 hands',                 check: p => p.handsPlayed >= 50 },
  { id: 'hands_100',       name: 'Veteran',           desc: 'Play 100 hands',                check: p => p.handsPlayed >= 100 },
  { id: 'hands_500',       name: 'Grinder',           desc: 'Play 500 hands',                check: p => p.handsPlayed >= 500 },
  { id: 'hands_1000',      name: 'Marathon',          desc: 'Play 1,000 hands',              check: p => p.handsPlayed >= 1000 },
  { id: 'wins_10',         name: 'Winner',            desc: 'Win 10 hands',                  check: p => p.handsWon >= 10 },
  { id: 'wins_50',         name: 'Shark',             desc: 'Win 50 hands',                  check: p => p.handsWon >= 50 },
  { id: 'wins_100',        name: 'Predator',          desc: 'Win 100 hands',                 check: p => p.handsWon >= 100 },
  { id: 'streak_3',        name: 'Hot Streak',        desc: 'Win 3 hands in a row',          check: p => p.bestStreak >= 3 },
  { id: 'streak_5',        name: 'On Fire',           desc: 'Win 5 hands in a row',          check: p => p.bestStreak >= 5 },
  { id: 'streak_10',       name: 'Unstoppable',       desc: 'Win 10 hands in a row',         check: p => p.bestStreak >= 10 },
  { id: 'big_pot_1k',      name: 'Big Pot',           desc: 'Win a pot over 1,000',          check: p => p.biggestPot >= 1000 },
  { id: 'big_pot_10k',     name: 'High Roller',       desc: 'Win a pot over 10,000',         check: p => p.biggestPot >= 10000 },
  { id: 'big_pot_50k',     name: 'Whale',             desc: 'Win a pot over 50,000',         check: p => p.biggestPot >= 50000 },
  { id: 'level_10',        name: 'Rising Star',       desc: 'Reach level 10',                check: p => p.level >= 10 },
  { id: 'level_50',        name: 'Seasoned Pro',      desc: 'Reach level 50',                check: p => p.level >= 50 },
  { id: 'level_100',       name: 'Elite',             desc: 'Reach level 100',               check: p => p.level >= 100 },
  { id: 'full_house',      name: 'Full House!',       desc: 'Win with a Full House',         check: p => ['Full House','Four of a Kind','Straight Flush','Royal Flush'].includes(p.bestHand) },
  { id: 'quads',           name: 'Quad Damage',       desc: 'Win with Four of a Kind',       check: p => ['Four of a Kind','Straight Flush','Royal Flush'].includes(p.bestHand) },
  { id: 'straight_flush',  name: 'Monster Hand',      desc: 'Win with a Straight Flush',     check: p => ['Straight Flush','Royal Flush'].includes(p.bestHand) },
  { id: 'royal_flush',     name: 'Royal Flush!',      desc: 'Win with a Royal Flush',        check: p => p.bestHand === 'Royal Flush' },
  { id: 'chips_10k',       name: 'Bankroll Builder',  desc: 'Accumulate 10,000 chips',       check: p => p.chips >= 10000 },
  { id: 'chips_100k',      name: 'Chip Leader',       desc: 'Accumulate 100,000 chips',      check: p => p.chips >= 100000 },
];

// ─── Daily Missions ──────────────────────────────────────────────────────────
const MISSION_TEMPLATES = [
  { id: 'win_hands',   text: 'Win {n} hands',     targets: [3, 5, 7],    field: 'missionsWinCount',   xp: 100 },
  { id: 'play_hands',  text: 'Play {n} hands',    targets: [10, 15, 20], field: 'missionsPlayCount',  xp: 75 },
  { id: 'raise_times', text: 'Raise {n} times',   targets: [5, 8, 12],   field: 'missionsRaiseCount', xp: 50 },
  { id: 'win_streak',  text: 'Win {n} in a row',  targets: [2, 3],       field: 'currentStreak',      xp: 150 },
  { id: 'big_pot',     text: 'Win a pot over {n}', targets: [500, 1000], field: 'sessionBiggestPot',  xp: 80 },
];

function generateDailyMissions(seed) {
  const rng = (s) => { s = (s * 1664525 + 1013904223) & 0xffffffff; return Math.abs(s); };
  let s = seed;
  const picked = [];
  const pool = [...MISSION_TEMPLATES];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    s = rng(s);
    const idx = s % pool.length;
    const tmpl = pool.splice(idx, 1)[0];
    s = rng(s);
    const target = tmpl.targets[s % tmpl.targets.length];
    picked.push({ ...tmpl, target, text: tmpl.text.replace('{n}', target), progress: 0, claimed: false });
  }
  return picked;
}

function getDailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Build a default progress object for a brand-new player. */
function defaultProgress() {
  const info = levelFromTotalXp(0);
  return {
    playerName: localStorage.getItem('poker_username') || 'Player',
    level: 1,
    xp: 0,
    xpToNextLevel: xpRequiredForLevel(1),
    totalXp: 0,
    chips: 5000,
    stars: 0,
    handsPlayed: 0,
    totalHandsPlayed: 0,
    handsWon: 0,
    winRate: 0,
    handsToday: 0,
    handsTodayDate: new Date().toDateString(),
    currentStreak: 0,
    bestStreak: 0,
    bestHand: '',
    biggestPot: 0,
    netChips: 0,
    startingChips: 5000,
    wins: 0,
    losses: 0,
    elo: 500,
    vpip: 0,
    pfr: 0,
    vpipHands: 0,
    pfrHands: 0,
    vipTier: 'Bronze',
    vipXp: 0,
    // Position stats: { BTN: {played,won}, SB: {played,won}, ... }
    positionStats: {},
    // Street-level actions: { preflop: {bets,raises,calls,folds}, flop: {...}, ... }
    streetActions: { preflop: {bets:0,raises:0,calls:0,folds:0,checks:0}, flop: {bets:0,raises:0,calls:0,folds:0,checks:0}, turn: {bets:0,raises:0,calls:0,folds:0,checks:0}, river: {bets:0,raises:0,calls:0,folds:0,checks:0} },
    // Session history: [{ date, duration, hands, netChips, startChips, endChips }]
    sessionHistory: [],
    // Daily chip snapshots for 7-day sparkline: [{ date, chips }]
    dailyChipHistory: [],
    // ELO history for trend sparkline: [{ date, elo }]
    eloHistory: [],
    // Hand history: last 100 hands [{ handId, cards, community, result, potSize, position, actions }]
    handHistory: [],
    // Starting hand win rates: { 'AKs': {played,won}, 'AA': {played,won}, ... }
    handTypeStats: {},
    // Unlocked achievement IDs
    unlockedAchievements: [],
    // Daily missions
    dailyMissions: generateDailyMissions(getDailySeed()),
    dailyMissionsSeed: getDailySeed(),
    // Mission counters (reset daily)
    missionsWinCount: 0,
    missionsPlayCount: 0,
    missionsRaiseCount: 0,
    sessionBiggestPot: 0,
  };
}

// ─── Store ──────────────────────────────────────────────────────────────────
export const useProgressStore = create((set, get) => ({
  // Player progress — hydrate from localStorage on first load
  progress: loadSavedProgress() || defaultProgress(),

  setProgress: (incoming) => {
    const prev = get().progress || defaultProgress();
    // Merge incoming server data with local data (local wins for persistence)
    const merged = { ...prev, ...incoming };
    // Re-derive level info from totalXp to stay consistent
    if (merged.totalXp != null) {
      const info = levelFromTotalXp(merged.totalXp);
      merged.level = info.level;
      merged.xp = info.xp;
      merged.xpToNextLevel = info.xpToNextLevel;
    }
    saveProgress(merged);
    set({ progress: merged });
  },

  /**
   * Award XP and persist. Handles level-ups automatically.
   * Returns { levelsGained, newLevel } so callers can show popups.
   */
  awardXP: (amount) => {
    const prev = get().progress || defaultProgress();
    const oldLevel = prev.level;
    const newTotalXp = (prev.totalXp || 0) + amount;
    const info = levelFromTotalXp(newTotalXp);

    const updated = {
      ...prev,
      totalXp: newTotalXp,
      level: info.level,
      xp: info.xp,
      xpToNextLevel: info.xpToNextLevel,
    };
    saveProgress(updated);
    set({ progress: updated });

    const levelsGained = info.level - oldLevel;
    if (levelsGained > 0) {
      // Trigger level-up popup
      set({
        levelUpData: {
          newLevel: info.level,
          bonusChips: levelsGained * 200,
          bonusStars: levelsGained >= 2 ? levelsGained * 5 : 0,
        },
      });
      // Award bonus chips for leveling up
      const withBonus = { ...updated, chips: (updated.chips || 0) + levelsGained * 200 };
      saveProgress(withBonus);
      set({ progress: withBonus });
    }

    return { levelsGained, newLevel: info.level };
  },

  /** Record a completed hand — awards XP and updates all stats. */
  recordHand: ({ won, potSize, handName, chipsAfter, voluntaryPut, preflopRaise, position, holeCards, communityCards, actions, handId }) => {
    const prev = get().progress || defaultProgress();
    const xpEarned = won ? 50 + Math.floor(potSize / 100) : 15;

    // Reset handsToday if the date changed
    const today = new Date().toDateString();
    const todayCount = prev.handsTodayDate === today ? (prev.handsToday || 0) : 0;

    const newStreak = won ? (prev.currentStreak || 0) + 1 : 0;
    const newBestStreak = Math.max(prev.bestStreak || 0, newStreak);

    // Track best hand (rank order: High Card < Pair < ... < Royal Flush)
    const HAND_RANKS = ['High Card','Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush'];
    let newBestHand = prev.bestHand || '';
    if (handName && HAND_RANKS.indexOf(handName) > HAND_RANKS.indexOf(newBestHand)) {
      newBestHand = handName;
    }

    // ELO update (simple: +10 for win, -8 for loss, scaled by pot)
    const eloChange = won ? 10 + Math.floor(potSize / 500) : -(8 + Math.floor(potSize / 1000));
    const newElo = Math.max(0, (prev.elo || 500) + eloChange);

    // VPIP/PFR tracking
    const newVpipHands = (prev.vpipHands || 0) + (voluntaryPut ? 1 : 0);
    const newPfrHands = (prev.pfrHands || 0) + (preflopRaise ? 1 : 0);
    const totalHands = (prev.handsPlayed || 0) + 1;

    // Net chips
    const chipsDelta = chipsAfter != null ? chipsAfter - (prev.chips || 0) : 0;

    const updated = {
      ...prev,
      handsPlayed: totalHands,
      totalHandsPlayed: totalHands,
      handsWon: (prev.handsWon || 0) + (won ? 1 : 0),
      wins: (prev.wins || 0) + (won ? 1 : 0),
      losses: (prev.losses || 0) + (won ? 0 : 1),
      handsToday: todayCount + 1,
      handsTodayDate: today,
      currentStreak: newStreak,
      bestStreak: newBestStreak,
      bestHand: newBestHand,
      biggestPot: Math.max(prev.biggestPot || 0, potSize || 0),
      netChips: (prev.netChips || 0) + chipsDelta,
      elo: newElo,
      vpipHands: newVpipHands,
      pfrHands: newPfrHands,
      vpip: totalHands > 0 ? Math.round((newVpipHands / totalHands) * 100) : 0,
      pfr: totalHands > 0 ? Math.round((newPfrHands / totalHands) * 100) : 0,
    };
    if (updated.handsPlayed > 0) {
      updated.winRate = Math.round((updated.handsWon / updated.handsPlayed) * 100);
    }

    // Position stats
    if (position) {
      const ps = { ...(prev.positionStats || {}) };
      if (!ps[position]) ps[position] = { played: 0, won: 0 };
      ps[position] = { played: ps[position].played + 1, won: ps[position].won + (won ? 1 : 0) };
      updated.positionStats = ps;
    }

    // Street-level actions
    if (actions && Array.isArray(actions)) {
      const sa = JSON.parse(JSON.stringify(prev.streetActions || defaultProgress().streetActions));
      for (const a of actions) {
        const street = (a.phase || a.street || 'preflop').toLowerCase();
        const type = (a.action || a.type || '').toLowerCase();
        if (sa[street] && ['bet','raise','call','fold','check'].includes(type)) {
          sa[street][type + 's'] = (sa[street][type + 's'] || 0) + 1;
        }
      }
      updated.streetActions = sa;
    }

    // Hand history (last 100)
    const hh = [...(prev.handHistory || [])];
    hh.push({ handId: handId || Date.now(), cards: holeCards || [], community: communityCards || [], result: won ? 'won' : 'lost', potSize: potSize || 0, position: position || '', handName: handName || '', timestamp: Date.now() });
    if (hh.length > 100) hh.splice(0, hh.length - 100);
    updated.handHistory = hh;

    // Starting hand type stats (e.g. 'AKs', 'QQ')
    if (holeCards && holeCards.length >= 2) {
      const RANK_LABELS = {2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'T',11:'J',12:'Q',13:'K',14:'A'};
      const r1 = RANK_LABELS[holeCards[0]?.rank] || '?';
      const r2 = RANK_LABELS[holeCards[1]?.rank] || '?';
      const suited = holeCards[0]?.suit === holeCards[1]?.suit;
      const hi = r1 > r2 ? r1 : r2;
      const lo = r1 > r2 ? r2 : r1;
      const handKey = hi === lo ? `${hi}${lo}` : `${hi}${lo}${suited ? 's' : 'o'}`;
      const hts = { ...(prev.handTypeStats || {}) };
      if (!hts[handKey]) hts[handKey] = { played: 0, won: 0 };
      hts[handKey] = { played: hts[handKey].played + 1, won: hts[handKey].won + (won ? 1 : 0) };
      updated.handTypeStats = hts;
    }

    // Daily chip snapshot (one per day for 7-day sparkline)
    const dch = [...(prev.dailyChipHistory || [])];
    const todayStr = new Date().toISOString().slice(0, 10);
    const lastSnap = dch[dch.length - 1];
    if (!lastSnap || lastSnap.date !== todayStr) {
      dch.push({ date: todayStr, chips: chipsAfter ?? prev.chips ?? 0 });
    } else {
      lastSnap.chips = chipsAfter ?? prev.chips ?? 0;
    }
    if (dch.length > 30) dch.splice(0, dch.length - 30);
    updated.dailyChipHistory = dch;

    // ELO history
    const eh = [...(prev.eloHistory || [])];
    if (!eh.length || eh[eh.length - 1].date !== todayStr) {
      eh.push({ date: todayStr, elo: updated.elo });
    } else {
      eh[eh.length - 1].elo = updated.elo;
    }
    if (eh.length > 30) eh.splice(0, eh.length - 30);
    updated.eloHistory = eh;

    // Daily missions progress
    const seed = getDailySeed();
    if (prev.dailyMissionsSeed !== seed) {
      updated.dailyMissions = generateDailyMissions(seed);
      updated.dailyMissionsSeed = seed;
      updated.missionsWinCount = 0;
      updated.missionsPlayCount = 0;
      updated.missionsRaiseCount = 0;
      updated.sessionBiggestPot = 0;
    }
    updated.missionsPlayCount = (updated.missionsPlayCount || 0) + 1;
    if (won) updated.missionsWinCount = (updated.missionsWinCount || 0) + 1;
    updated.sessionBiggestPot = Math.max(updated.sessionBiggestPot || 0, potSize || 0);
    // Update mission progress
    const missions = [...(updated.dailyMissions || [])];
    for (const m of missions) {
      if (m.claimed) continue;
      const val = updated[m.field] ?? 0;
      m.progress = Math.min(val, m.target);
    }
    updated.dailyMissions = missions;

    // Check achievements
    const unlocked = [...(prev.unlockedAchievements || [])];
    const newlyUnlocked = [];
    for (const ach of ACHIEVEMENTS) {
      if (!unlocked.includes(ach.id) && ach.check(updated)) {
        unlocked.push(ach.id);
        newlyUnlocked.push(ach);
      }
    }
    updated.unlockedAchievements = unlocked;

    saveProgress(updated);
    set({ progress: updated });

    // Show achievement popups
    for (const ach of newlyUnlocked) {
      get().addNotification({ type: 'achievement', message: `${ach.name} - ${ach.desc}`, reward: { xp: 100, chips: 1000 } });
    }

    // Now award XP (which also saves)
    const achievementBonus = newlyUnlocked.length * 100;
    get().awardXP(xpEarned + achievementBonus);
  },

  /** Claim a daily mission reward. */
  claimMission: (missionId) => {
    const prev = get().progress || defaultProgress();
    const missions = [...(prev.dailyMissions || [])];
    const m = missions.find(mi => mi.id === missionId);
    if (!m || m.claimed || m.progress < m.target) return;
    m.claimed = true;
    const updated = { ...prev, dailyMissions: missions };
    saveProgress(updated);
    set({ progress: updated });
    get().awardXP(m.xp);
  },

  /** Save a session to history. */
  saveSession: ({ duration, hands, netChips, startChips, endChips }) => {
    const prev = get().progress || defaultProgress();
    const sh = [...(prev.sessionHistory || [])];
    sh.push({ date: new Date().toISOString(), duration, hands, netChips, startChips, endChips });
    if (sh.length > 50) sh.splice(0, sh.length - 50);
    const updated = { ...prev, sessionHistory: sh };
    saveProgress(updated);
    set({ progress: updated });
  },

  /** Update chip balance and persist. */
  updateChips: (newChips) => {
    const prev = get().progress || defaultProgress();
    const updated = { ...prev, chips: newChips };
    saveProgress(updated);
    set({ progress: updated });
  },

  // Notification queue for popups
  notifications: [],
  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        { ...notification, id: ++notificationIdCounter },
      ],
    })),
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  // Level up overlay
  levelUpData: null,
  setLevelUpData: (data) => set({ levelUpData: data }),
  clearLevelUp: () => set({ levelUpData: null }),

  // Missions panel expanded
  missionsExpanded: false,
  setMissionsExpanded: (val) => set({ missionsExpanded: val }),
  toggleMissions: () =>
    set((state) => ({ missionsExpanded: !state.missionsExpanded })),
}));
