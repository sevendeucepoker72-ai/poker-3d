/**
 * tableCosmetics — how the TABLE draws the shop's cosmetics
 * (.online R2, 2026-10-11 — contracts C7 / C8).
 *
 * The server (poker-server src/economy/catalog.ts SHOP_PRICES) is the
 * authority for what exists, who owns it and what is equipped; it sends
 *   - per seat:    seats[i].cosmetics = { frame, title, cardBack, badge, vip }
 *                  (the seated account's EQUIPPED items, all null / false for
 *                  an empty, AI or account-less seat — or absent: older server)
 *   - per player:  gameState.myTheme = the viewer's equipped table theme | null
 * Every id the shop sells for a type the table draws maps to a look here (the
 * CSS lives in TableCosmetics.css): 10 felt themes, 10 card backs, 9 nameplate
 * frames (+ the VIP gold frame), 15 titles, the season badges. Brand: sapphire
 * + gold, never red — "Classic" (id classic_red), the free default back, is drawn as the
 * house's classic back.
 *
 * Pure data + pure functions (no React, no store): an id that is not a known
 * catalog id — a pre-R2 grant (career_*), a typo, anything not text — draws
 * the default look, never a broken one.
 */

const ID_RE = /^[a-z0-9_]{1,40}$/;

/** `v` when it is a plausible catalog id (lower-case, digits, underscore), else null. */
export function cleanCosmeticId(v) {
  return typeof v === 'string' && ID_RE.test(v) ? v : null;
}

// ── Table themes (felt surface) ──────────────────────────────────────────────
// Spotlit radial felts (bright high, deep falloff to the rim) like the house
// felts; the rail stays the universal brushed gold.
export const FELT_THEMES = {
  classic_blue: {
    name: 'Classic Blue',
    felt: 'radial-gradient(ellipse at 50% 30%, #235a95 0%, #164277 40%, #0d2c53 68%, #08203e 100%)',
  },
  green_felt: {
    name: 'Green Felt',
    felt: 'radial-gradient(ellipse at 50% 30%, #3a9a68 0%, #1f6544 42%, #124430 68%, #0a3020 100%)',
  },
  midnight_purple: {
    name: 'Midnight Purple',
    felt: 'radial-gradient(ellipse at 50% 30%, #5a46a8 0%, #3a2b7a 40%, #221852 68%, #120c30 100%)',
  },
  ocean_breeze: {
    name: 'Ocean Breeze',
    felt: 'radial-gradient(ellipse at 50% 30%, #2f9db0 0%, #1b7187 40%, #104a5c 68%, #08303e 100%)',
  },
  casino_royale: {
    name: 'Casino Royale',
    felt: 'radial-gradient(ellipse at 50% 32%, rgba(255, 210, 74, 0.16) 0%, transparent 46%), radial-gradient(ellipse at 50% 30%, #2f8a5c 0%, #1a5e3d 42%, #0f3d28 70%, #07261a 100%)',
  },
  neon_vegas: {
    name: 'Neon Vegas',
    felt: 'radial-gradient(ellipse at 50% 50%, transparent 58%, rgba(56, 189, 248, 0.22) 74%, transparent 86%), radial-gradient(ellipse at 50% 30%, #1d3f94 0%, #0f2258 42%, #071236 70%, #030a1f 100%)',
  },
  carbon_black: {
    name: 'Carbon Black',
    felt: 'repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.025) 0 2px, transparent 2px 6px), radial-gradient(ellipse at 50% 30%, #3b414d 0%, #23272f 42%, #13161b 70%, #08090c 100%)',
  },
  royal_gold: {
    name: 'Royal Gold',
    felt: 'radial-gradient(ellipse at 50% 34%, rgba(255, 210, 74, 0.22) 0%, transparent 52%), radial-gradient(ellipse at 50% 30%, #2d4f9e 0%, #173070 42%, #0b1d4a 70%, #060f2b 100%)',
  },
  cherry_wood: {
    name: 'Cherry Wood',
    felt: 'radial-gradient(ellipse at 50% 30%, #7a5634 0%, #553a22 42%, #362515 70%, #1d140b 100%)',
  },
  cosmic_nebula: {
    name: 'Cosmic Nebula',
    felt: 'radial-gradient(circle at 30% 40%, rgba(139, 92, 246, 0.35) 0%, transparent 38%), radial-gradient(circle at 72% 62%, rgba(56, 189, 248, 0.28) 0%, transparent 42%), radial-gradient(circle at 55% 25%, rgba(255, 210, 74, 0.12) 0%, transparent 30%), radial-gradient(ellipse at 50% 30%, #2a2f7a 0%, #161a4d 45%, #0b0d2b 75%, #05061a 100%)',
  },
};

/** The equipped theme's felt (`myTheme`), or null (none / unknown: the player's own felt pick). */
export function feltForTheme(id) {
  const t = cleanCosmeticId(id);
  return t && FELT_THEMES[t] ? FELT_THEMES[t] : null;
}

// ── Card backs ───────────────────────────────────────────────────────────────
export const CARD_BACKS = {
  classic_red: 'Classic',          // the free default: the house's classic back (no red)
  royal_blue: 'Royal Blue',
  silver_foil: 'Silver Foil',
  gold_premium: 'Gold Premium',
  neon_green: 'Neon Green',
  holographic: 'Holographic',
  dragon: 'Dragon',
  phoenix: 'Phoenix',
  diamond_pattern: 'Diamond',
  mythic: 'Mythic',
};

/** The class that draws a card back (`cb-<id>`), '' for the house back. */
export function cardBackClass(id) {
  const b = cleanCosmeticId(id);
  if (!b || !CARD_BACKS[b] || b === 'classic_red') return '';
  return `cb-${b}`;
}

// ── Nameplate frames ─────────────────────────────────────────────────────────
export const FRAMES = {
  bronze: 'Bronze', silver: 'Silver', gold: 'Gold', diamond: 'Diamond', flame: 'Flame',
  ice: 'Ice', platinum: 'Platinum', crown: 'Crown', mythic: 'Mythic',
};

// ── Titles (under the name) ──────────────────────────────────────────────────
export const TITLES = {
  nitwit: 'Nitwit',
  calling_station: 'Calling Station',
  grinder: 'Grinder',
  river_rat: 'River Rat',
  chip_leader: 'Chip Leader',
  degenerate: 'Degenerate',
  the_shark: 'The Shark',
  bad_beat_survivor: 'Bad Beat Survivor',
  final_table: 'Final Table',
  bluff_master: 'Bluff Master',
  all_in_legend: 'All-In Legend',
  phantom: 'Phantom',
  tournament_champ: 'Tournament Champ',
  royal: 'Royal',
  godmode: 'God Mode',
};
/** Titles drawn in gold (the top tier); the rest in the light sapphire. */
const GOLD_TITLES = new Set(['tournament_champ', 'royal', 'godmode', 'all_in_legend']);

// ── Season badges (C9: never sold, granted to the month's top 3) ─────────────
export const SEASON_BADGES = {
  season_gold: { icon: '🥇', name: 'Season Champion' },
  season_silver: { icon: '🥈', name: 'Season Runner-up' },
  season_bronze: { icon: '🥉', name: 'Season Third' },
};

/**
 * What to draw at a seat from its `cosmetics` (C7 / C8). Every field has a
 * neutral value, so a seat without cosmetics (older server, AI, empty) draws
 * exactly as before.
 *   frameClass  'np-frame np-frame--<id>' ('np-frame--vip' = the VIP gold frame) | ''
 *   title       display text | null;  titleClass 'np-title' (+ ' np-title--gold')
 *   badge       { icon, name } | null
 *   vip         boolean (the VIP badge)
 *   cardBack    'cb-<id>' | ''
 */
export function seatLook(cosmetics) {
  const c = cosmetics && typeof cosmetics === 'object' && !Array.isArray(cosmetics) ? cosmetics : null;
  const vip = !!(c && c.vip === true);
  const frameId = c ? cleanCosmeticId(c.frame) : null;
  const frame = frameId && FRAMES[frameId] ? frameId : (vip ? 'vip' : null);
  const titleId = c ? cleanCosmeticId(c.title) : null;
  const title = titleId && TITLES[titleId] ? TITLES[titleId] : null;
  const badgeId = c ? cleanCosmeticId(c.badge) : null;
  return {
    frameClass: frame ? `np-frame np-frame--${frame}` : '',
    title,
    titleClass: title ? `np-title${GOLD_TITLES.has(titleId) ? ' np-title--gold' : ''}` : '',
    badge: badgeId && SEASON_BADGES[badgeId] ? SEASON_BADGES[badgeId] : null,
    vip,
    cardBack: c ? cardBackClass(c.cardBack) : '',
  };
}
