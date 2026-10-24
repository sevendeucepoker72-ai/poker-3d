import { create } from 'zustand';
import { useTableStore } from './tableStore';
import { denverDateKey, dateKeyOf, toEpochMs, addDaysToDateKey } from '../utils/denverTime';
import { normalizeItemType, vipXpTierFor } from '../utils/economyCatalog';
import { ownHandResult, mergeHandRecordStamps } from '../utils/handLog';

// 2026-10-11 (R2, APPUI-48) — notification ids are unique ACROSS page loads:
// NotificationCenter keeps the list (and its read ids) in sessionStorage, and a
// counter that restarted at 1 on every load re-used ids already in that list,
// so the new notifications were dropped as "already stored".
const notificationIdPrefix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let notificationIdCounter = 0;
let loggedSpectatorSkip = false;

// ─── Win rate (2026-10-11, .online fix round 1 — APPUI-9) ──────────────────
/**
 * Win % from the SERVER's lifetime counters (playerProgress: handsWon /
 * totalHandsPlayed — the same ratio the server's detailed stats use). The old
 * lobby value divided the server's lifetime handsWon by this browser's local
 * handsPlayed count, so it showed impossible numbers (300%+). Integer 0..100.
 * The server never has more wins than hands; a copy that does (cached by an
 * older build, which overwrote totalHandsPlayed with its local count) reads 0
 * until the server's next playerProgress replaces it.
 * R2 (C5) — a server `winRate` (0-100, one decimal) is used as is.
 */
export function serverWinRate(progress) {
  const sent = progress && progress.winRateFromServer === true ? Number(progress.winRate) : NaN;
  if (Number.isFinite(sent) && sent >= 0 && sent <= 100) return sent;
  const total = Number(progress && progress.totalHandsPlayed);
  const won = Number(progress && progress.handsWon);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(won) || won <= 0 || won > total) return 0;
  return Math.round((won / total) * 100);
}

// ─── C5: the server's playerProgress is the source of truth ─────────────────
// 2026-10-11 (.online R2 — C5). Every lobby action that changes chips / stars /
// XP / level / inventory / claims answers with a `playerProgress` built from
// the DB. The helpers below turn that payload (and the older server's field
// names, so an old server still works) into the canonical client fields every
// screen reads. Nothing on the client computes these values any more.

const asInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

/** One server mission → { id, templateId, description, progress, target, reward{chips,xp,stars}, completed, claimed }. */
export function normalizeMission(m) {
  if (!m || typeof m !== 'object' || m.id == null) return null;
  const target = Math.max(1, asInt(m.target) || 1);
  const progress = Math.max(0, Math.min(target, asInt(m.progress) || 0));
  const r = m.reward && typeof m.reward === 'object' ? m.reward : {};
  return {
    id: String(m.id),
    templateId: String(m.templateId ?? m.type ?? ''),
    description: String(m.description ?? m.text ?? 'Mission'),
    progress,
    target,
    reward: { chips: Math.max(0, asInt(r.chips) || 0), xp: Math.max(0, asInt(r.xp) || 0), stars: Math.max(0, asInt(r.stars) || 0) },
    completed: m.completed === true || progress >= target,
    claimed: m.claimed === true,
  };
}

/** The mission list a payload carries (C5 `missions`, else the older `dailyMissions`), or null when it carries none. */
export function missionsFromPayload(p) {
  const list = Array.isArray(p?.missions) ? p.missions : (Array.isArray(p?.dailyMissions) ? p.dailyMissions : null);
  if (!list) return null;
  return list.map(normalizeMission).filter(Boolean);
}

/**
 * C8 `vip` → { tier, expiresAt (ms|null), perks[], active, monthlyClaimed,
 * monthKey, monthlyBonus, xpRate, loginMultiplier } (an older server sends
 * only vipExpiresAt; the monthly fields are then unknown: false / null / 0).
 */
export function normalizeVip(p, nowMs = Date.now()) {
  const v = p && typeof p.vip === 'object' && p.vip ? p.vip : null;
  const expiresAt = toEpochMs(v ? v.expiresAt : p?.vipExpiresAt);
  const active = expiresAt != null && expiresAt > nowMs;
  const perks = v && Array.isArray(v.perks) ? v.perks.map(String) : [];
  const tier = v && typeof v.tier === 'string' && v.tier ? v.tier : vipXpTierFor(p?.totalXp).name;
  const num = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);
  return {
    tier,
    expiresAt,
    perks,
    active,
    monthlyClaimed: v ? v.monthlyClaimed === true : false,
    monthKey: v && typeof v.monthKey === 'string' ? v.monthKey : null,
    monthlyBonus: v ? num(v.monthlyBonus) : 0,
    xpRate: v ? num(v.xpRate) : 0,
    loginMultiplier: v ? num(v.loginMultiplier) : 0,
  };
}

/** Is the VIP pass active NOW (its expiry checked at render time, not at receipt)? */
export function vipPassActive(progress, nowMs = Date.now()) {
  const exp = progress?.vip?.expiresAt;
  return typeof exp === 'number' && exp > nowMs;
}

/** activeBoosters: C5 array [{type, multiplier, expiresAt}] or the older object {chip:{mult,expiresAt}} → array. */
export function normalizeBoosters(raw) {
  const out = [];
  const push = (type, mult, exp) => {
    const expiresAt = toEpochMs(exp);
    const multiplier = Number(mult);
    if (!type || !expiresAt || !(multiplier > 0)) return;
    out.push({ type: String(type), multiplier, expiresAt });
  };
  if (Array.isArray(raw)) for (const b of raw) push(b?.type ?? b?.kind, b?.multiplier ?? b?.mult, b?.expiresAt);
  else if (raw && typeof raw === 'object') for (const [k, b] of Object.entries(raw)) push(k, b?.multiplier ?? b?.mult, b?.expiresAt);
  return out;
}

/** The boosters still running at `nowMs`. */
export function activeBoostersAt(progress, nowMs = Date.now()) {
  return (Array.isArray(progress?.boosters) ? progress.boosters : []).filter((b) => b.expiresAt > nowMs);
}

/**
 * C7 `equipped` → { theme, cardBack, frame, title, profileBg, badge, emotes[] }
 * (older server: equippedTableTheme / equippedCardBack). A slot the payload
 * does not name is undefined (unknown), not null (nothing equipped).
 */
export function normalizeEquipped(p, prev) {
  const e = p && typeof p.equipped === 'object' && p.equipped ? p.equipped : null;
  if (e) {
    const slot = (k) => (Object.prototype.hasOwnProperty.call(e, k) ? (e[k] ?? null) : undefined);
    return {
      theme: e.theme ?? null,
      cardBack: e.cardBack ?? null,
      frame: e.frame ?? null,
      title: e.title ?? null,
      profileBg: slot('profileBg'),
      badge: slot('badge'),
      emotes: Array.isArray(e.emotes) ? e.emotes.map(String) : [],
    };
  }
  if (p && (p.equippedTableTheme !== undefined || p.equippedCardBack !== undefined)) {
    const base = prev || { theme: null, cardBack: null, frame: null, title: null, emotes: [] };
    const fix = (v) => (v && v !== 'default' ? v : null);
    return { ...base, theme: fix(p.equippedTableTheme), cardBack: fix(p.equippedCardBack) };
  }
  return null;
}

/** C5 `owned` → ['type:id', …]; a bare id is kept as is (resolved by isItemOwned). */
export function normalizeOwned(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.map((x) => (typeof x === 'string' ? x : (x && x.itemType && x.itemId ? `${normalizeItemType(x.itemType)}:${x.itemId}` : null))).filter(Boolean);
}

/** DB inventory rows → { ownedBy: {type: Set<id>}, equippedBy: {type: id} } (legacy type aliases folded). */
export function indexInventory(rows) {
  const ownedBy = {};
  const equippedBy = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const t = normalizeItemType(row.item_type || row.itemType);
    const id = row.item_id || row.itemId;
    if (!t || !id) continue;
    if (!ownedBy[t]) ownedBy[t] = new Set();
    ownedBy[t].add(id);
    if (row.equipped) equippedBy[t] = id;
  }
  return { ownedBy, equippedBy };
}

/**
 * Does the player own (type, id)? The DB inventory rows (durableState /
 * inventoryUpdated) first, then the C5 `owned` keys ('type:id', or a bare id
 * no other type uses). Free defaults (price 0) are owned by everyone — the
 * caller passes `free`.
 */
export function isItemOwned(progress, type, id, { free = false } = {}) {
  if (free) return true;
  const t = normalizeItemType(type);
  if (progress?.ownedBy?.[t]?.has?.(id)) return true;
  const owned = Array.isArray(progress?.ownedKeys) ? progress.ownedKeys : [];
  if (owned.includes(`${t}:${id}`)) return true;
  return owned.includes(id) && !owned.some((k) => k.endsWith(`:${id}`) && !k.startsWith(`${t}:`));
}

/** The id the player has equipped for `type`, from C5 `equipped` (theme/card_back/frame/title/profile_bg/badge) else the inventory rows. */
export function equippedIdFor(progress, type) {
  const t = normalizeItemType(type);
  const e = progress?.equipped;
  const key = { theme: 'theme', card_back: 'cardBack', frame: 'frame', title: 'title', profile_bg: 'profileBg', badge: 'badge' }[t];
  if (e && key && e[key] !== undefined) return e[key] || null;
  return progress?.equippedBy?.[t] || null;
}

/**
 * Is today's daily login reward claimable? The server's Denver date of the
 * last claim (C5 lastLoginClaimDate) vs today's Denver date — never the
 * browser's local date. Unknown (not hydrated yet) → false (no banner).
 */
export function dailyLoginClaimable(progress, nowMs = Date.now()) {
  if (!progress || progress.hydrated !== true) return false;
  const last = dateKeyOf(progress.lastLoginClaimDate);
  return last !== denverDateKey(nowMs);
}

// ─── R2 (APPUI-15) — the lobby hand log ─────────────────────────────────────
const HAND_LOG_MAX = 100;
function freshSession() {
  return { startedAt: Date.now(), hands: 0, wins: 0, net: 0 };
}
/** `<tableId>:<handNumber>` of a record (live: stamped tableId; stored: from its hand id), or null. */
export function handKey(rec) {
  if (!rec || rec.handNumber == null) return null;
  if (rec.tableId != null && rec.tableId !== '') return `${rec.tableId}:${rec.handNumber}`;
  if (typeof rec.handId === 'string') {
    const parts = rec.handId.split('-');
    if (parts.length >= 4) return `${parts.slice(0, -3).join('-')}:${parts[parts.length - 3]}`;
  }
  return null;
}

/** The streak day (1..7) the NEXT claim pays: continues after a claim yesterday (Denver), else restarts at 1. */
export function nextLoginRewardDay(progress, nowMs = Date.now()) {
  const streak = Math.max(0, asInt(progress?.loginStreak) || 0);
  const last = dateKeyOf(progress?.lastLoginClaimDate);
  const today = denverDateKey(nowMs);
  if (last === today) return ((Math.max(1, streak) - 1) % 7) + 1; // already claimed: today's day
  if (last && last === addDaysToDateKey(today, -1)) return (streak % 7) + 1;
  return 1;
}

// ─── 1000-level XP system ───────────────────────────────────────────────────
const MAX_LEVEL = 1000;

/** XP required to go from `level` to `level + 1`.
 *  Unified curve — MUST match poker-server/src/progression/ProgressionManager.ts
 *  (xpRequiredForLevel()) exactly or server↔client levels desync.
 *  Formula: 100 + 35·L + 0.05·L²  (L = current level)
 *  - L1→2 :       135 XP
 *  - L10→11:      455 XP
 *  - L100→101:  4,100 XP
 *  - L500→501: 30,100 XP
 *  - L1000→cap:     Infinity
 *  Total XP to reach L1000 ≈ 13.5 million. */
export function xpRequiredForLevel(level) {
  if (level <= 0) return 100;
  if (level >= MAX_LEVEL) return Infinity;
  return Math.round(100 + 35 * level + 0.05 * level * level);
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

/** Tier brackets for 1000 levels.
 *  Mythic (900+) / Legendary (700+) / Master (500+) / Platinum (300+)
 *  / Diamond (150+) / Gold (75+) / Silver (25+) / Bronze (default) */
export function getLevelTier(level) {
  // R3 (APPUI-P3-7) — no red: Mythic is sapphire + gold, Legendary amber (were red / orange-red).
  if (level >= 900) return { name: 'Mythic',     color: '#3B82F6', glow: '#FFD24A' };
  if (level >= 700) return { name: 'Legendary',  color: '#F59E0B', glow: '#FCD34D' };
  if (level >= 500) return { name: 'Master',     color: '#E040FB', glow: '#CE93D8' };
  if (level >= 300) return { name: 'Platinum',   color: '#00E5FF', glow: '#00B8D4' };
  if (level >= 150) return { name: 'Diamond',    color: '#B9F2FF', glow: '#00E5FF' };
  if (level >= 75)  return { name: 'Gold',       color: '#FFD700', glow: '#FFA500' };
  if (level >= 25)  return { name: 'Silver',     color: '#C0C0C0', glow: '#A0A0C0' };
  return                   { name: 'Bronze',     color: '#CD7F32', glow: '#A0522D' };
}

/** Milestone stars bonus at given level (one-time on reaching).
 *  Every 10 / 25 / 50 / 100 / 250 / 500 / 1000 gives escalating bonus.
 *  Non-milestone levels get the base `level * 5` star reward only. */
export function milestoneStarsBonus(level) {
  if (level === 1000) return 10000;
  if (level === 500)  return 5000;
  if (level === 250)  return 2000;
  if (level === 100)  return 500;
  if (level % 100 === 0) return 300;
  if (level % 50 === 0)  return 100;
  if (level % 25 === 0)  return 40;
  if (level % 10 === 0)  return 15;
  return 0;
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

// ─── sessionStorage persistence ───────────────────────────────────────────────
const STORAGE_KEY = 'poker_player_progress';

function loadSavedProgress() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // 2026-10-11 (APPUI-9) — a copy saved by an older build can hold the
      // impossible local win rate; always re-derive it from the server counters.
      if (saved && typeof saved === 'object') saved.winRate = serverWinRate(saved);
      return saved;
    }
  } catch { /* ignore corrupt data */ }
  return null;
}

function saveProgress(progress) {
  // 2026-04-22 audit — fresh-init clobber gate. Never persist an
  // un-hydrated (default-init) progress object to sessionStorage: on
  // the next page load it would be read back as if it were real data
  // and race the server's `playerProgress` event. See
  // `setProgress` comment above and CLAUDE.md "User data MUST persist".
  if (!progress || progress.hydrated !== true) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    // Also sync stats for AdvancedAnalytics leaks tab
    // Compute aggression factor from street action counts: (bets+raises) / calls
    const sa = progress.streetActions || {};
    let totalBets = 0, totalRaises = 0, totalCalls = 0;
    for (const street of ['preflop','flop','turn','river']) {
      const s = sa[street] || {};
      totalBets += s.bets || 0;
      totalRaises += s.raises || 0;
      totalCalls += s.calls || 0;
    }
    const aggressionFactor = totalCalls > 0
      ? +((totalBets + totalRaises) / totalCalls).toFixed(1)
      : (totalBets + totalRaises > 0 ? 999 : 0);

    const handsWon = progress.handsWon || 0;
    const blindHands = progress.blindHands || 0;
    const blindFolded = progress.blindFolded || 0;

    sessionStorage.setItem('poker_player_stats', JSON.stringify({
      vpip: progress.vpip || 0,
      pfr: progress.pfr || 0,
      handsPlayed: progress.handsPlayed || 0,
      winRate: progress.winRate || 0,
      aggressionFactor,
      bestStreak: progress.bestStreak || 0,
      biggestPot: progress.biggestPot || 0,
      bluffPct: handsWon > 0 ? Math.round(((progress.bluffWins || 0) / handsWon) * 100) : null,
      foldToSteal: blindHands >= 10 ? Math.round((blindFolded / blindHands) * 100) : null,
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
// 2026-10-11 (R2, C6) — missions are the SERVER's (per account, per Denver
// day; playerProgress.missions). The client no longer generates any: its old
// local templates showed made-up missions that could never be claimed.

/** Build a default progress object for a brand-new player.
 *
 * 2026-04-22 audit — fresh-init clobber risk:
 * `hydrated: false` until the server's `playerProgress` event arrives.
 * All write paths (saveProgress, persistenceService._doSync) MUST gate
 * on `hydrated === true` — otherwise a slow-connect race lets these
 * default values (chips=5000, level=1, stars=0) stomp the real DB row
 * via `saveProgress` before the server hydrate completes.
 * See CLAUDE.md "User data MUST persist — no exceptions" — this is the
 * same bug class as the persistStars / ensureHydrated history there.
 */
function defaultProgress() {
  const info = levelFromTotalXp(0);
  return {
    hydrated: false,
    playerName: sessionStorage.getItem('poker_username') || 'Player',
    level: 1,
    xp: 0,
    xpToNextLevel: xpRequiredForLevel(1),
    totalXp: 0,
    chips: 50000, // pre-hydrate placeholder (gated by `hydrated`); matches server DEFAULT_CHIPS
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
    startingChips: 50000,
    wins: 0,
    losses: 0,
    elo: 500,
    vpip: 0,
    pfr: 0,
    vpipHands: 0,
    pfrHands: 0,
    bluffWins: 0,
    blindFolded: 0,
    blindHands: 0,
    lastHandAt: 0,
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
    // R2 (C6) — the server's daily missions; null until a payload carries them.
    missions: null,
    dailyMissionsDate: null,
    // R2 (C5/C8) — server economy state, normalised by setProgress.
    vip: { tier: 'Bronze', expiresAt: null, perks: [], active: false },
    boosters: [],
    equipped: null,
    ownedKeys: [],
    battlePassPremium: false,
    // ─── Persistence-sweep durable fields (hydrated from server via durableState event) ───
    // Inventory: array of { item_type, item_id, equipped, acquired_at }
    inventory: [],
    // Fast lookups derived from inventory (kept in sync by setDurableState)
    ownedBy: {},      // { card_back: Set<id>, emote: Set<id>, ... }
    equippedBy: {},   // { card_back: id, frame: id, ... }
    // Claimed battle pass tiers for current season
    battlePassClaimed: [],
    // Server-durable Career Mode progress: [{ venue, stage, stars }]
    careerProgress: [],
    // Avatar customization (skinTone, hairStyle, ...) — synced to server
    customization: {},
    // UI preferences — synced to server
    preferences: {},
    // Banked scratch cards
    scratchCardsAvailable: 0,
    // Daily login streak + last claim date
    loginStreak: 0,
    lastLoginClaimDate: null,
  };
}

// ─── Store ──────────────────────────────────────────────────────────────────
export const useProgressStore = create((set, get) => ({
  // Player progress — hydrate from sessionStorage on first load
  progress: loadSavedProgress() || defaultProgress(),

  setProgress: (incoming) => {
    const prev = get().progress || defaultProgress();
    // NOTE (2026-04-22 audit): `{...prev, ...incoming}` is INTENTIONAL.
    // If the server stops sending a field on a partial update, we keep
    // the previous value rather than wiping it. Do NOT "fix" this into
    // `{...incoming}` — that would erase any field the server omits on
    // an incremental update (e.g. a delta that only sends `xp`/`chips`
    // would blow away positionStats, handHistory, inventory, etc.).
    // See CLAUDE.md "User data MUST persist" — this is the same class
    // of regression as the persistStars fresh-init clobber.
    const merged = { ...prev, ...incoming };

    // 2026-04-22 audit — fresh-init clobber gate:
    // Mark progress as server-hydrated the first time we see a payload
    // that looks like a real server hydrate (has a userId). Until this
    // flag flips true, saveProgress() + persistenceService._doSync()
    // refuse to write — preventing the in-memory `defaultProgress()`
    // (chips=5000, level=1, stars=0) from stomping the DB on a slow
    // connect race. Matches the server-side `hydrated` gate pattern in
    // progressionManager.ts referenced in CLAUDE.md.
    if (incoming && (incoming.userId != null || incoming.id != null)) {
      merged.hydrated = true;
    }

    // CRITICAL FIX: the server is authoritative for level/xp (it's
    // guarded by the `hydrated` flag + SQL GREATEST()). Previously this
    // path re-derived level from a stale `totalXp` in the sessionStorage
    // cache — overwriting the real server level with whatever the
    // client's XP curve computed (e.g. server level=9 got stomped to
    // level=5 by stale totalXp). Root cause of "level keeps resetting
    // every login".
    //
    // 2026-10-11 (R2, C5) — every value the server sends is ADOPTED as is:
    // level, xp, xpToNextLevel and totalXp (cumulative season XP — the Battle
    // Pass and the VIP XP tier read it). Only a value the server did NOT send
    // is derived (an older payload without totalXp / xpToNextLevel).
    if (incoming.level != null) {
      merged.level = incoming.level;
      merged.xp = incoming.xp != null ? incoming.xp : (merged.xp || 0);
      merged.totalXp = Number.isFinite(Number(incoming.totalXp))
        ? Number(incoming.totalXp)
        : totalXpForLevel(incoming.level) + (merged.xp || 0);
      merged.xpToNextLevel = Number.isFinite(Number(incoming.xpToNextLevel)) && Number(incoming.xpToNextLevel) > 0
        ? Number(incoming.xpToNextLevel)
        : xpRequiredForLevel(incoming.level);
    } else if (incoming.totalXp == null && merged.totalXp != null && prev.hydrated !== true) {
      const info = levelFromTotalXp(merged.totalXp);
      merged.level = info.level;
      merged.xp = info.xp;
      merged.xpToNextLevel = info.xpToNextLevel;
    }

    // R2 (C5) — the server's economy fields, normalised for every screen.
    const missions = missionsFromPayload(incoming);
    if (missions) merged.missions = missions;
    if (incoming.dailyMissionsDate !== undefined) merged.dailyMissionsDate = dateKeyOf(incoming.dailyMissionsDate);
    if (incoming.vip !== undefined || incoming.vipExpiresAt !== undefined) {
      merged.vip = normalizeVip({ vip: incoming.vip, vipExpiresAt: incoming.vipExpiresAt, totalXp: merged.totalXp });
    }
    if (incoming.activeBoosters !== undefined) merged.boosters = normalizeBoosters(incoming.activeBoosters);
    const equipped = normalizeEquipped(incoming, prev.equipped);
    if (equipped) merged.equipped = equipped;
    const owned = normalizeOwned(incoming.owned);
    if (owned) merged.ownedKeys = owned;
    if (typeof incoming.battlePassPremium === 'boolean') merged.battlePassPremium = incoming.battlePassPremium;
    if (incoming.lastLoginClaimDate !== undefined) merged.lastLoginClaimDate = dateKeyOf(incoming.lastLoginClaimDate);
    if (incoming.loginStreak === undefined && Number.isFinite(Number(incoming.dailyLoginStreak))) merged.loginStreak = Number(incoming.dailyLoginStreak);

    // 2026-10-11 (APPUI-9) — derived from the server's counters only; R2 (C5)
    // a winRate the server sends (0-100, one decimal) is used as is.
    const sentWinRate = incoming.winRate != null && incoming.winRate !== '' ? Number(incoming.winRate) : NaN;
    if (Number.isFinite(sentWinRate) && sentWinRate >= 0 && sentWinRate <= 100) {
      merged.winRate = Math.round(sentWinRate * 10) / 10;
      merged.winRateFromServer = true;
    } else if (incoming.handsWon !== undefined || incoming.totalHandsPlayed !== undefined || prev.winRateFromServer !== true) {
      // New counters without a rate (an older payload): derive from them.
      merged.winRateFromServer = false;
      merged.winRate = serverWinRate(merged);
    } else {
      // A partial payload that carries neither keeps the server's rate.
      merged.winRate = prev.winRate;
      merged.winRateFromServer = true;
    }

    saveProgress(merged);
    set({ progress: merged });
  },

  /**
   * R2 — the account this progress belongs to (gameStore.userId). A different
   * account (sign-out + another sign-in in the same tab) starts with empty
   * local logs: the previous player's recent hands / session counters are
   * never shown to the next one.
   */
  accountId: null,
  noteAccount: (userId) => {
    const id = userId == null ? null : String(userId);
    if (get().accountId === id) return;
    set({ accountId: id, handLog: [], session: freshSession(), tournamentResults: [], tournamentTableIds: [] });
  },

  // ─── Sit & Go fix-all C2 — his tournament results, IN MEMORY only ─────────
  // Tournament chips are not his bankroll: the graph / analytics leave
  // tournament hands out and plot each tournament's prize - entry fee instead.
  // Fed from the server's frames (App: tournamentFinished myResult, the direct
  // / sign-in elimination notice, tournamentFinishedForEntrant; GameHUD:
  // eliminatedToSpectator) and durableState.tournamentResults when a server
  // sends it. Never written to storage (no entitlement lives in the browser).
  tournamentResults: [],
  // Table ids known to be tournament tables (live states, results' tableIds):
  // a stored hand row of one of them is a tournament hand.
  tournamentTableIds: [],
  noteTournamentResult: (r) => {
    if (!r || typeof r !== 'object' || r.tournamentId == null || r.tournamentId === '') return;
    const id = String(r.tournamentId);
    const list = get().tournamentResults;
    const i = list.findIndex((x) => String(x.tournamentId) === id);
    const known = (a, b) => (b !== undefined && b !== null ? b : a);
    const next = i < 0
      ? [...list, { tournamentId: id, name: r.name ?? null, place: r.place ?? null, prize: r.prize ?? null, entryFee: r.entryFee ?? null, finishedAt: r.finishedAt ?? null, tableIds: Array.isArray(r.tableIds) ? r.tableIds.map(String) : [] }]
      : list.map((x, j) => (j !== i ? x : {
        ...x,
        name: known(x.name, r.name),
        place: known(x.place, r.place),
        prize: known(x.prize, r.prize),
        entryFee: known(x.entryFee, r.entryFee),
        finishedAt: x.finishedAt ?? r.finishedAt ?? null,
        tableIds: [...new Set([...(x.tableIds || []), ...(Array.isArray(r.tableIds) ? r.tableIds.map(String) : [])])],
      }));
    const ids = new Set(get().tournamentTableIds);
    for (const t of Array.isArray(r.tableIds) ? r.tableIds : []) ids.add(String(t));
    set({ tournamentResults: next.slice(-200), tournamentTableIds: [...ids].slice(-500) });
  },
  hydrateTournamentResults: (list) => {
    if (!Array.isArray(list)) return;
    for (const r of list) get().noteTournamentResult(r);
  },
  noteTournamentTable: (tableId) => {
    if (tableId == null || tableId === '') return;
    const id = String(tableId);
    if (get().tournamentTableIds.includes(id)) return;
    set({ tournamentTableIds: [...get().tournamentTableIds, id].slice(-500) });
  },

  // ─── R2 (APPUI-15) — the lobby's own hand log + "This Session" counters ───
  // Kept here (not in the table store, which clears its list when he leaves a
  // table) so Recent Hands, the session card, the bankroll graph and the
  // exports keep his hands after he stands up. Hydrated from the server's
  // per-user hand history (durableState.handHistory, newest first) and
  // appended by every live `handHistory` event (stamped with his seat).
  handLog: [],
  session: freshSession(),

  /** A live hand record (App.jsx stamps `yourSeat` / `tableId` / `tableName` / `receivedAt`). */
  noteHandRecord: (rec, myName) => {
    if (!rec || typeof rec !== 'object' || !Array.isArray(rec.players)) return;
    const key = handKey(rec);
    const log = get().handLog;
    if (key && log.some((h) => handKey(h) === key)) return;
    const next = [...log, rec].slice(-HAND_LOG_MAX);
    const own = ownHandResult(rec, myName, { tournamentTableIds: get().tournamentTableIds });
    const s = get().session;
    set({
      handLog: next,
      // C2 — "This Session" net is wallet chips: a tournament hand adds 0.
      session: own
        ? { ...s, hands: s.hands + 1, wins: s.wins + (own.won ? 1 : 0), net: s.net + (typeof own.walletNet === 'number' ? own.walletNet : 0) }
        : s,
    });
  },

  /** The server's stored hands (newest first) — merged under the live ones; never counted as this session. */
  hydrateHandLog: (records) => {
    if (!Array.isArray(records)) return;
    const usable = records.filter((h) => h && Array.isArray(h.players) && h.players.length > 0);
    const oldestFirst = usable.slice().reverse();
    const seen = new Map(); // key -> index in merged
    const merged = [];
    for (const h of [...oldestFirst, ...get().handLog]) {
      const k = handKey(h);
      // C2 — the stored copy is kept, plus the live copy's stamps it lacks
      // (tableKind / tournamentId / yourSeat ...): a tournament hand stays one.
      if (k && seen.has(k)) { const i = seen.get(k); merged[i] = mergeHandRecordStamps(merged[i], h); continue; }
      if (k) seen.set(k, merged.length);
      merged.push(h);
    }
    set({ handLog: merged.slice(-HAND_LOG_MAX) });
  },

  /**
   * Merge a server-sourced `durableState` payload (inventory, battle pass
   * claims, customization, preferences, stars, scratch balance, login streak).
   * Server is the source of truth for these fields.
   */
  setDurableState: (payload) => {
    const prev = get().progress || defaultProgress();
    // R2 — a payload without an inventory array keeps the inventory we have
    // (it used to wipe ownership to "nothing owned" until the next refresh).
    const hasInventory = Array.isArray(payload?.inventory);
    const inventory = hasInventory ? payload.inventory : (prev.inventory || []);
    const { ownedBy, equippedBy } = hasInventory ? indexInventory(inventory) : { ownedBy: prev.ownedBy || {}, equippedBy: prev.equippedBy || {} };
    const merged = {
      ...prev,
      inventory,
      ownedBy,
      equippedBy,
      battlePassClaimed: Array.isArray(payload?.battlePassClaims) ? payload.battlePassClaims : (prev.battlePassClaimed || []),
      // 2026-07-07 gap-fill — server-durable career progress (cross-device).
      // Keep-prev guard so a partial payload can't wipe it.
      careerProgress: Array.isArray(payload?.careerProgress) ? payload.careerProgress : (prev.careerProgress || []),
      customization: payload?.customization || prev.customization || {},
      preferences: payload?.preferences || prev.preferences || {},
      // 2026-06-19: keep-prev guards (matching `stars`) so a PARTIAL durableState
      // payload that omits these fields can't silently reset a real balance/streak
      // to 0/null. Only overwrite when the server actually sent the field.
      stars: typeof payload?.stars === 'number' ? payload.stars : prev.stars,
      scratchCardsAvailable: typeof payload?.scratchCardsAvailable === 'number' ? payload.scratchCardsAvailable : (prev.scratchCardsAvailable ?? 0),
      loginStreak: typeof payload?.loginStreak === 'number' ? payload.loginStreak : (prev.loginStreak ?? 0),
      lastLoginClaimDate: payload?.lastLoginClaimDate !== undefined ? dateKeyOf(payload.lastLoginClaimDate) : (prev.lastLoginClaimDate ?? null),
    };
    saveProgress(merged);
    set({ progress: merged });
  },

  /** Called when server emits `inventoryUpdated` after a buy/equip. */
  setInventory: (inventory) => {
    const prev = get().progress || defaultProgress();
    const rows = Array.isArray(inventory) ? inventory : [];
    const { ownedBy, equippedBy } = indexInventory(rows);
    const merged = { ...prev, inventory: rows, ownedBy, equippedBy };
    saveProgress(merged);
    set({ progress: merged });
  },

  // 2026-10-11 (R2, C5) — the local `awardXP` (a client-side XP / level model)
  // is gone: level, xp and totalXp are only ever the server's (playerProgress).

  /**
   * Record a completed hand in the LOCAL stats (VPIP/PFR, positions, hand
   * types, recent hands, today's count, …).
   *
   * 2026-10-11 (.online fix round 1 — APPUI-9):
   * - Only a hand this player was SEATED in counts: never a spectated hand
   *   (yourSeat >= 0 && !isSpectator — taken from the caller when it passes
   *   them, else from the table store). Every HandComplete a spectator watched
   *   used to be recorded as a lost hand.
   * - Server-owned fields are NOT written here: totalHandsPlayed, handsWon,
   *   currentStreak, bestStreak, biggestPot, elo, eloHistory, dailyMissions and
   *   level / xp / totalXp all arrive in the server's `playerProgress` after the
   *   hand (setProgress). Writing them here made the lobby Win % impossible,
   *   overwrote the lifetime hand count with this browser's count, replaced the
   *   server's ELO with a made-up one, zeroed the server's mission progress, and
   *   double-counted XP whenever playerProgress arrived first.
   */
  recordHand: ({ won, potSize, handName, chipsAfter, voluntaryPut, preflopRaise, position, holeCards, communityCards, actions, handId, raiseCount, yourSeat, isSpectator }) => {
    let seat = yourSeat;
    let spectating = isSpectator;
    if (typeof seat !== 'number' || typeof spectating !== 'boolean') {
      try {
        const ts = useTableStore.getState();
        const gs = ts.gameState;
        if (typeof seat !== 'number') seat = gs && gs.yourSeat != null ? gs.yourSeat : ts.mySeat;
        if (typeof spectating !== 'boolean') spectating = !!ts.isSpectating || !!(gs && gs.isSpectator);
      } catch {
        seat = -1;
      }
    }
    if (!(Number.isInteger(seat) && seat >= 0) || spectating) {
      if (!loggedSpectatorSkip) {
        loggedSpectatorSkip = true;
        try { console.warn('[progress] recordHand skipped: not seated in this hand (spectating); further skips are silent'); } catch { /* ignore */ }
      }
      return;
    }

    const prev = get().progress || defaultProgress();

    // Reset handsToday if the date changed
    const today = new Date().toDateString();
    const todayCount = prev.handsTodayDate === today ? (prev.handsToday || 0) : 0;

    // Track best hand (rank order: High Card < Pair < ... < Royal Flush)
    // Update regardless of win/loss — the hand was held at showdown
    const HAND_RANKS = ['High Card','Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush'];
    let newBestHand = prev.bestHand || '';
    if (handName && HAND_RANKS.indexOf(handName) > HAND_RANKS.indexOf(newBestHand)) {
      newBestHand = handName;
    }

    // VPIP/PFR tracking
    const newVpipHands = (prev.vpipHands || 0) + (voluntaryPut ? 1 : 0);
    const newPfrHands = (prev.pfrHands || 0) + (preflopRaise ? 1 : 0);
    const totalHands = (prev.handsPlayed || 0) + 1;

    // Blind defense tracking (fold to steal)
    const isBlind = position === 'SB' || position === 'BB';
    const newBlindHands = (prev.blindHands || 0) + (isBlind ? 1 : 0);
    const newBlindFolded = (prev.blindFolded || 0) + (isBlind && !voluntaryPut ? 1 : 0);

    // Bluff win tracking (won with High Card = opponent(s) folded or hero had best high card)
    const newBluffWins = (prev.bluffWins || 0) + (won && handName === 'High Card' ? 1 : 0);

    // Net chips
    const chipsDelta = chipsAfter != null ? chipsAfter - (prev.chips || 0) : 0;

    // Local counters only (see the header). handsPlayed = hands recorded in
    // this browser (the VPIP/PFR denominator); wins/losses likewise.
    const updated = {
      ...prev,
      handsPlayed: totalHands,
      wins: (prev.wins || 0) + (won ? 1 : 0),
      losses: (prev.losses || 0) + (won ? 0 : 1),
      handsToday: todayCount + 1,
      handsTodayDate: today,
      bestHand: newBestHand,
      netChips: (prev.netChips || 0) + chipsDelta,
      vpipHands: newVpipHands,
      pfrHands: newPfrHands,
      vpip: totalHands > 0 ? Math.round((newVpipHands / totalHands) * 100) : 0,
      pfr: totalHands > 0 ? Math.round((newPfrHands / totalHands) * 100) : 0,
      bluffWins: newBluffWins,
      blindHands: newBlindHands,
      blindFolded: newBlindFolded,
      lastHandAt: Date.now(),
    };
    updated.winRate = serverWinRate(updated);

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
      // 2026-07-05 audit P3 fix: order by NUMERIC rank, not by the label string.
      // The old `r1 > r2` compared labels lexically by char code ('A'=65 < 'K'=75 <
      // 'T'=84...), so AK was keyed 'KAo', KQ 'QKo', etc. — splitting/mislabeling the
      // starting-hand analytics vs. the canonical high-card-first key the UI expects.
      const n1 = holeCards[0]?.rank || 0;
      const n2 = holeCards[1]?.rank || 0;
      const hi = RANK_LABELS[Math.max(n1, n2)] || '?';
      const lo = RANK_LABELS[Math.min(n1, n2)] || '?';
      const suited = holeCards[0]?.suit === holeCards[1]?.suit;
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

    // (2026-10-11, APPUI-9: no ELO / ELO-history writes here — the server
    // sends elo + eloHistory in playerProgress.)

    // (2026-10-11, R2 C6: no local mission counters either — the missions and
    // their progress are the server's, counted from hands he was dealt into.)
    void raiseCount;

    // 2026-05-19 audit — REMOVED client-side achievement check.
    //
    // Empirical bug observed in Chrome play test: "First Blood — Win your
    // first hand" achievement notification fires TWICE (one toast from
    // the client-side ACHIEVEMENTS loop here, one from the server's
    // `achievementUnlocked` socket event). Same root cause as the
    // duplicate level-up popup (see awardXP comment above): the client
    // and server were BOTH evaluating the same achievement criteria off
    // overlapping state.
    //
    // The server's progressionManager checkAchievements() is the
    // authoritative source for achievement unlocks. It pushes
    // `achievementUnlocked` events that App.jsx's socket listener
    // converts to notifications. Removing the duplicate client-side path
    // here also incidentally fixes BUG 10 (the "Warmup — Play 5 hands"
    // achievement firing after only 3 played hands), because the client
    // was counting BOTH its own recordHand calls AND the server's
    // achievementUnlocked events, effectively double-counting toward
    // the "play N hands today" criteria.
    //
    // The local stats above (handsPlayed, vpip, pfr, position stats,
    // hand history, etc.) ARE still tracked client-side for the
    // post-hand analytics + advanced stats panels — only the
    // notifications + chip rewards moved to server-only.
    saveProgress(updated);
    set({ progress: updated });

    // 2026-10-11 (APPUI-9) — no local XP award any more: level / xp / totalXp
    // are the server's and arrive in playerProgress right after the hand (the
    // local guess was added ON TOP of the server's value whenever that event
    // came first).
  },

  // (2026-10-11, R2 C6: the local `claimMission` — which marked a mission
  // claimed and awarded XP on the client — is gone. MissionsPanel sends
  // `claimMission { missionId }`; the server answers `missionClaimed` and a
  // fresh playerProgress.)

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

  /**
   * _internalSetChipsFromServer — reflect the server-authoritative chip
   * balance into the client store.
   *
   * ⚠️ 2026-04-22 audit — chip-mutation boundary:
   * This is a CLIENT-SIDE MIRROR ONLY. It does NOT write to the DB.
   * The server is the sole authority for `users.chips` (see CLAUDE.md
   * "Chip mutations flow through server-authoritative paths ONLY" —
   * addChipsToUser / deductChips / pot-distribution are the only
   * legitimate server write paths). This setter exists so the UI
   * (HUD, lobby chip counter) stays in sync with what the server just
   * told us the balance is.
   *
   * ONLY the `playerProgress` socket event handler in App.jsx is a
   * legitimate caller. Any other caller is a symptom of a UI shortcut
   * that is about to drift from the server — fix the shortcut, don't
   * call this.
   */
  _internalSetChipsFromServer: (newChips) => {
    const prev = get().progress || defaultProgress();
    const updated = { ...prev, chips: newChips };
    saveProgress(updated);
    set({ progress: updated });
  },

  /** @deprecated — renamed to `_internalSetChipsFromServer` (2026-04-22
   *  audit). Kept as a thin wrapper so existing callers don't break
   *  while the audit-wave lands. New code: DO NOT call — see the
   *  comment on `_internalSetChipsFromServer` above. */
  updateChips: (newChips) => {
    if (typeof console !== 'undefined' && console.warn) {
      // Intentionally loud — surfaces any non-`playerProgress` caller
      // during the deprecation window.
      console.warn('[progressStore] updateChips() is deprecated; only the playerProgress socket handler should update chip state. Use _internalSetChipsFromServer if you are that handler.');
    }
    const prev = get().progress || defaultProgress();
    const updated = { ...prev, chips: newChips };
    saveProgress(updated);
    set({ progress: updated });
  },

  // Notification queue for popups (capped at 50 to prevent unbounded growth)
  notifications: [],
  addNotification: (notification) =>
    set((state) => {
      const next = [
        ...state.notifications,
        { ...notification, id: `${notificationIdPrefix}-${++notificationIdCounter}`, timestamp: Date.now() },
      ];
      return { notifications: next.length > 50 ? next.slice(-50) : next };
    }),
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
