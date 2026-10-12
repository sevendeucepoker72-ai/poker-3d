/**
 * The .online economy catalog on the CLIENT (2026-10-11, .online R2 — C7 / C8
 * / ECON-6 / ECON-7 / APPUI-5 / APPUI-6 / APPUI-37 / APPUI-38).
 *
 * ONE place for what the shop sells, what each item DOES, how it looks, and
 * how every server reward is written for the player. Ids and prices mirror
 * poker-server's catalog (src/economy/catalog.ts SHOP_PRICES) — the server is
 * the authority for prices and ownership; a `shopCatalog` answer from the
 * server (when it sends one) overrides the prices here.
 *
 * What is SOLD (C7: "every purchasable cosmetic id the shop sells must map to
 * a rendered style"): table themes (your felt), card backs, nameplate frames,
 * titles (rendered at the table from the seat's equipped cosmetics), emotes
 * (unlocked in the table emote wheel) and profile backgrounds (rendered on
 * your profile). The other cosmetic kinds the server knows — celebrations,
 * sound packs, chip skins, card fronts, dealer voices — are drawn nowhere, so
 * they are not sold any more; ones a player already owns (bundles, mystery
 * boxes) still show in "Your collection", labelled as collectibles.
 *
 * Visual parameters (felt / rail / colours / icons) are plain data so the
 * table (K1) can render the same ids from the same table.
 */

// ── Item types ────────────────────────────────────────────────────────────────

export const TYPE_LABELS = {
  theme: 'Table theme',
  card_back: 'Card back',
  frame: 'Nameplate frame',
  title: 'Title',
  emote: 'Emote',
  profile_bg: 'Profile background',
  celebration: 'Win celebration',
  sound_pack: 'Sound pack',
  chip_skin: 'Chip skin',
  card_front: 'Card front',
  dealer_voice: 'Dealer voice',
  badge: 'Season badge',
};

/** What an item of each SOLD type does — shown on every shop card. */
export const TYPE_EFFECTS = {
  theme: 'Changes the felt and rail you see at every table.',
  card_back: 'The back of your cards — everyone at your table sees it.',
  frame: 'A frame around your nameplate that everyone at the table sees.',
  title: 'Shown under your name on your nameplate at the table.',
  emote: 'Adds this emote to your emote wheel at the table.',
  profile_bg: 'The banner behind your name on your profile.',
};

/** Types the shop sells (a rendered style exists for every id). */
export const SOLD_TYPES = ['theme', 'card_back', 'frame', 'title', 'emote', 'profile_bg'];

/** One equipped item per type; emotes are not equipped (every owned emote is usable). */
export const EQUIPPABLE_TYPES = new Set(['theme', 'card_back', 'frame', 'title', 'profile_bg', 'celebration', 'sound_pack', 'chip_skin', 'card_front', 'dealer_voice', 'badge']);

/** The free default of a type (owned by everyone) — "Unequip" puts this back on. */
export const FREE_DEFAULTS = {
  theme: 'classic_blue',
  card_back: 'classic_red',
  profile_bg: 'default',
};

/** Legacy item-type aliases the server granted before R2. */
const TYPE_ALIASES = { avatar_frame: 'frame', cardback: 'card_back', table_theme: 'theme' };
export function normalizeItemType(t) {
  const s = String(t ?? '').trim();
  return TYPE_ALIASES[s] || s;
}

// ── Sellable cosmetics ────────────────────────────────────────────────────────

// R3 (K2-4) — a preview swatch shows what the TABLE draws (tableCosmetics): Cherry
// Wood is a brown felt, not maroon.
export const THEMES = [
  { id: 'classic_blue',    name: 'Classic Blue',    felt: '#2874a6', rail: '#8B5E3C', price: 0 },
  { id: 'green_felt',      name: 'Green Felt',      felt: '#1a5c2a', rail: '#8B6914', price: 0 },
  { id: 'midnight_purple', name: 'Midnight Purple', felt: '#4a1d6e', rail: '#C0C0C0', price: 300 },
  { id: 'ocean_breeze',    name: 'Ocean Breeze',    felt: '#1a7a7a', rail: '#F5F5F5', price: 400 },
  { id: 'casino_royale',   name: 'Casino Royale',   felt: '#1a5c2a', rail: '#B8860B', price: 500 },
  { id: 'neon_vegas',      name: 'Neon Vegas',      felt: '#050c20', rail: '#0c1a44', price: 600, glow: true },
  { id: 'carbon_black',    name: 'Carbon Black',    felt: '#18181b', rail: '#3f3f46', price: 700 },
  { id: 'royal_gold',      name: 'Royal Gold',      felt: '#0a1a3a', rail: '#DAA520', price: 800 },
  { id: 'cherry_wood',     name: 'Cherry Wood',     felt: '#553a22', rail: '#7c2d12', price: 900 },
  { id: 'cosmic_nebula',   name: 'Cosmic Nebula',   felt: '#312e81', rail: '#a78bfa', price: 1500 },
];

// R3 (K2-4) — no red. classic_red (id kept: the server's default + every owned row)
// is the house sapphire back the table draws, so its swatch is that blue and its
// display name 'Classic'; Dragon's swatch is the jade the table draws.
export const CARD_BACKS = [
  { id: 'classic_red',     name: 'Classic',      color: '#1A237E', price: 0 },
  { id: 'royal_blue',      name: 'Royal Blue',   color: '#2563EB', price: 0 },
  { id: 'silver_foil',     name: 'Silver Foil',  color: '#C0C0C0', price: 400 },
  { id: 'gold_premium',    name: 'Gold Premium', color: '#D97706', price: 500 },
  { id: 'neon_green',      name: 'Neon Green',   color: '#16A34A', price: 500 },
  { id: 'holographic',     name: 'Holographic',  color: '#A78BFA', price: 800 },
  { id: 'dragon',          name: 'Dragon',       color: '#1F6F5C', price: 1200 },
  { id: 'phoenix',         name: 'Phoenix',      color: '#F59E0B', price: 1500 },
  { id: 'diamond_pattern', name: 'Diamond',      color: '#B9F2FF', price: 2000 },
  { id: 'mythic',          name: 'Mythic',       color: '#6D28D9', price: 5000 },
];

export const FRAMES = [
  { id: 'bronze',   name: 'Bronze',   color: '#CD7F32', icon: '◯', price: 500 },
  { id: 'silver',   name: 'Silver',   color: '#C0C0C0', icon: '◯', price: 1000 },
  { id: 'gold',     name: 'Gold',     color: '#FFD700', icon: '◯', price: 2000 },
  { id: 'diamond',  name: 'Diamond',  color: '#B9F2FF', icon: '◆', price: 5000 },
  { id: 'flame',    name: 'Flame',    color: '#F59E0B', icon: '🔥', price: 6000 },
  { id: 'ice',      name: 'Ice',      color: '#60A5FA', icon: '❄', price: 6000 },
  { id: 'platinum', name: 'Platinum', color: '#E5E7EB', icon: '◆', price: 8000 },
  { id: 'crown',    name: 'Crown',    color: '#FFD700', icon: '👑', price: 10000 },
  { id: 'mythic',   name: 'Mythic',   color: '#A78BFA', icon: '★', price: 15000 },
];

export const TITLES = [
  { id: 'nitwit',            name: 'Nitwit',            desc: 'For the tightest of the tight',   price: 300,  color: '#A3A3A3' },
  { id: 'calling_station',   name: 'Calling Station',   desc: 'Wear your call stats with pride', price: 400,  color: '#94A3B8' },
  { id: 'grinder',           name: 'Grinder',           desc: 'Earn it one hand at a time',      price: 500,  color: '#64748B' },
  { id: 'river_rat',         name: 'River Rat',         desc: 'Miracle on the river specialist', price: 600,  color: '#84CC16' },
  { id: 'chip_leader',       name: 'Chip Leader',       desc: 'Stack the whole table',           price: 700,  color: '#22C55E' },
  { id: 'degenerate',        name: 'Degenerate',        desc: 'No fold button here',             price: 700,  color: '#A78BFA' },
  { id: 'the_shark',         name: 'The Shark',         desc: 'Dangerous waters',                price: 800,  color: '#3b82f6' },
  { id: 'bad_beat_survivor', name: 'Bad Beat Survivor', desc: 'Ran bad, kept playing',           price: 800,  color: '#F59E0B' },
  { id: 'final_table',       name: 'Final Table',       desc: 'Tournament endgame',              price: 1000, color: '#3B82F6' },
  { id: 'bluff_master',      name: 'Bluff Master',      desc: 'Show cards, they fold',           price: 1200, color: '#EC4899' },
  { id: 'all_in_legend',     name: 'All-In Legend',     desc: 'Every hand, all-in',              price: 1500, color: '#F59E0B' },
  { id: 'phantom',           name: 'Phantom',           desc: 'Disappearing act',                price: 1500, color: '#8B5CF6' },
  { id: 'tournament_champ',  name: 'Tournament Champ',  desc: 'Proven winner',                   price: 2000, color: '#10B981' },
  { id: 'royal',             name: 'Royal',             desc: 'King of the felt',                price: 3000, color: '#FFD700' },
  { id: 'godmode',           name: 'God Mode',          desc: 'The apex predator',               price: 8000, color: '#FFD24A' },
];

// R2 review (K2-3) — 'fire' and 'dead' are FREE for every account (the emote
// wheel's free set), so they are not sold: the server refused every purchase.
export const EMOTES = [
  { id: 'nice_hand',   name: 'Nice Hand',   icon: '👍', price: 150 },
  { id: 'good_game',   name: 'Good Game',   icon: '🤝', price: 150 },
  { id: 'well_played', name: 'Well Played', icon: '🎯', price: 150 },
  { id: 'thumbs_up',   name: 'Thumbs Up',   icon: '👍', price: 150 },
  { id: 'clap',        name: 'Clap',        icon: '👏', price: 200 },
  { id: 'love',        name: 'Love',        icon: '💙', price: 250 },
  { id: 'big_brain',   name: 'Big Brain',   icon: '🧠', price: 200 },
  { id: 'money',       name: 'Money',       icon: '💰', price: 200 },
  { id: 'tears',       name: 'Tears',       icon: '😭', price: 250 },
  { id: 'rocket',      name: 'Rocket',      icon: '🚀', price: 300 },
  { id: 'crown',       name: 'Crown',       icon: '👑', price: 400 },
  { id: 'sunglasses',  name: 'Cool',        icon: '😎', price: 200 },
  { id: 'laughing',    name: 'Laughing',    icon: '😂', price: 200 },
  { id: 'surprised',   name: 'Surprised',   icon: '😲', price: 200 },
  { id: 'think',       name: 'Thinking',    icon: '🤔', price: 300 },
  { id: 'poker_face',  name: 'Poker Face',  icon: '😐', price: 400 },
  { id: 'mic_drop',    name: 'Mic Drop',    icon: '🎤', price: 500 },
  { id: 'trophy',      name: 'Trophy',      icon: '🏆', price: 600 },
];

/** C8 — emotes only an active VIP pass unlocks (never sold). */
export const VIP_EMOTES = [
  { id: 'vip_crown',     name: 'VIP Crown',     icon: '👑' },
  { id: 'vip_diamond',   name: 'VIP Diamond',   icon: '💎' },
  { id: 'vip_champagne', name: 'VIP Champagne', icon: '🍾' },
];

export const PROFILE_BGS = [
  { id: 'default',        name: 'Default',        bg: 'linear-gradient(135deg, #1e293b, #0f172a)', price: 0 },
  { id: 'sunset',         name: 'Sunset',         bg: 'linear-gradient(135deg, #FB923C, #F59E0B)', price: 200 },
  { id: 'city_lights',    name: 'City Lights',    bg: 'linear-gradient(135deg, #1E3A8A, #312E81)', price: 350 },
  { id: 'deep_space',     name: 'Deep Space',     bg: 'linear-gradient(135deg, #030712, #4C1D95)', price: 500 },
  { id: 'aurora',         name: 'Aurora',         bg: 'linear-gradient(135deg, #14B8A6, #8B5CF6)', price: 700 },
  { id: 'volcano',        name: 'Volcano',        bg: 'linear-gradient(135deg, #92400E, #F59E0B)', price: 900 },
  { id: 'underwater',     name: 'Underwater',     bg: 'linear-gradient(135deg, #0E7490, #1E3A8A)', price: 1100 },
  { id: 'cherry_blossom', name: 'Cherry Blossom', bg: 'linear-gradient(135deg, #F472B6, #FBCFE8)', price: 1400 },
  { id: 'diamond_rain',   name: 'Diamond Rain',   bg: 'linear-gradient(135deg, #B9F2FF, #60A5FA)', price: 2500 },
];

// ── Collectibles (owned through bundles / boxes; drawn nowhere, never sold) ──

export const COLLECTIBLES = {
  celebration: [
    { id: 'confetti', name: 'Confetti', icon: '🎉' }, { id: 'chip_rain', name: 'Chip Rain', icon: '🪙' },
    { id: 'fireworks', name: 'Fireworks', icon: '🎆' }, { id: 'lightning', name: 'Lightning', icon: '⚡' },
    { id: 'golden_shower', name: 'Golden Rain', icon: '💫' }, { id: 'dragon_breath', name: 'Dragon Breath', icon: '🐉' },
    { id: 'cosmic_burst', name: 'Cosmic Burst', icon: '🌌' }, { id: 'supernova', name: 'Supernova', icon: '💥' },
  ],
  sound_pack: [
    { id: 'silent_mode', name: 'Silent Mode', icon: '🔇' }, { id: 'classic_casino', name: 'Classic Casino', icon: '🎵' },
    { id: 'vegas_casino', name: 'Vegas Casino', icon: '🎰' }, { id: 'old_school', name: 'Old School', icon: '🎼' },
    { id: 'cyberpunk', name: 'Cyberpunk', icon: '🎧' }, { id: 'fantasy', name: 'Fantasy', icon: '🎻' },
  ],
  chip_skin: [
    { id: 'classic', name: 'Classic', icon: '🪙' }, { id: 'crimson', name: 'Crimson', icon: '🪙' },
    { id: 'cobalt', name: 'Cobalt', icon: '🪙' }, { id: 'emerald', name: 'Emerald', icon: '🪙' },
    { id: 'amethyst', name: 'Amethyst', icon: '🪙' }, { id: 'gold_rimmed', name: 'Gold Rimmed', icon: '🪙' },
    { id: 'neon', name: 'Neon', icon: '🪙' }, { id: 'holographic', name: 'Holographic', icon: '🪙' },
    { id: 'mythic', name: 'Mythic', icon: '🪙' },
  ],
  card_front: [
    { id: 'standard', name: 'Standard', icon: '🂱' }, { id: 'minimal', name: 'Minimal', icon: '♠' },
    { id: 'retro', name: 'Retro', icon: '🃞' }, { id: 'modern', name: 'Modern', icon: '🂡' },
    { id: 'futuristic', name: 'Futuristic', icon: '🂻' }, { id: 'luxury', name: 'Luxury', icon: '👑' },
    { id: 'hanafuda', name: 'Hanafuda', icon: '🎴' }, { id: 'artistic', name: 'Artistic', icon: '🖼' },
  ],
  dealer_voice: [
    { id: 'standard', name: 'Standard', icon: '🎙' }, { id: 'vegas_vet', name: 'Vegas Veteran', icon: '🎰' },
    { id: 'british_butler', name: 'British Butler', icon: '🎩' }, { id: 'pirate', name: 'Pirate', icon: '🏴‍☠️' },
    { id: 'robot', name: 'Robot', icon: '🤖' }, { id: 'sportscaster', name: 'Sportscaster', icon: '📢' },
    { id: 'celebrity', name: 'Celebrity', icon: '⭐' }, { id: 'mythic_sage', name: 'Mythic Sage', icon: '🧙' },
  ],
};

/** C9 — season badges (type 'badge'): never sold, granted by the monthly season award. */
export const SEASON_BADGES = [
  { id: 'season_gold',   name: 'Season Champion', place: 1, color: '#FFD700', icon: '🥇' },
  { id: 'season_silver', name: 'Season Runner-up', place: 2, color: '#C0C0C0', icon: '🥈' },
  { id: 'season_bronze', name: 'Season Third',     place: 3, color: '#CD7F32', icon: '🥉' },
];

const ITEMS_BY_TYPE = {
  theme: THEMES,
  card_back: CARD_BACKS,
  frame: FRAMES,
  title: TITLES,
  emote: [...EMOTES, ...VIP_EMOTES],
  profile_bg: PROFILE_BGS,
  badge: SEASON_BADGES,
  ...COLLECTIBLES,
};

/** The catalog entry of (type, id), or null. */
export function catalogItem(type, id) {
  const list = ITEMS_BY_TYPE[normalizeItemType(type)];
  if (!list) return null;
  return list.find((x) => x.id === id) || null;
}

function humanize(id) {
  return String(id || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || 'Item';
}

/** The player-facing name of (type, id) — catalog name, else the id made readable. */
export function itemName(type, id) {
  return catalogItem(type, id)?.name || humanize(id);
}

/** "Silver Nameplate frame" style label: "<name> <type label>" (type label lower-cased). */
export function itemLabel(type, id) {
  const t = normalizeItemType(type);
  const tl = TYPE_LABELS[t];
  return tl ? `${itemName(t, id)} ${tl.toLowerCase()}` : itemName(t, id);
}

/** Is (type, id) something the shop SELLS (and so the table can draw)? */
export function isSoldItem(type, id) {
  const t = normalizeItemType(type);
  return SOLD_TYPES.includes(t) && !!catalogItem(t, id) && !VIP_EMOTES.some((e) => e.id === id);
}

// ── Non-cosmetic shop products ────────────────────────────────────────────────

export const CHIP_PACKS = [
  { id: 'refill',  name: 'Refill Stack',  chips: 10000,    price: 50 },
  { id: 'small',   name: 'Small Stack',   chips: 25000,    price: 100 },
  { id: 'medium',  name: 'Medium Stack',  chips: 100000,   price: 300 },
  { id: 'big',     name: 'Big Stack',     chips: 250000,   price: 600 },
  { id: 'pro',     name: 'Pro Stack',     chips: 750000,   price: 1500 },
  { id: 'whale',   name: 'Whale Stack',   chips: 2000000,  price: 3000 },
  { id: 'kingpin', name: 'Kingpin Stack', chips: 5000000,  price: 6000 },
  { id: 'emperor', name: 'Emperor Stack', chips: 15000000, price: 12000 },
];

export const MYSTERY_BOXES = [
  { id: 'basic',     name: 'Basic Mystery Box',     icon: '📦', price: 500,  desc: '50%: 5,000-25,000 chips · 30%: 50-150 stars · 20%: an emote' },
  { id: 'premium',   name: 'Premium Mystery Box',   icon: '🎁', price: 2000, desc: '50%: 25,000-150,000 chips · 30%: 200-600 stars · 20%: a frame, title or card back' },
  { id: 'legendary', name: 'Legendary Mystery Box', icon: '✨', price: 8000, desc: '50%: 150,000-1,000,000 chips · 30%: 800-2,500 stars · 20%: a top-tier frame, title or card back' },
];

/**
 * Boosters. The server multiplies XP EARNED (xp_*) or CHIP REWARD GRANTS (chip_*):
 * daily rewards, spins, scratch cards, missions, achievements and level-ups —
 * never pot winnings. Buying a booster of a kind that is still running adds
 * its time to it.
 */
export const BOOSTERS = [
  { id: 'xp_2x_15m',    kind: 'xp',   mult: 2,   minutes: 15,   name: '2× XP — 15 min', price: 200 },
  { id: 'xp_2x_1h',     kind: 'xp',   mult: 2,   minutes: 60,   name: '2× XP — 1 hour', price: 600 },
  { id: 'xp_2x_1d',     kind: 'xp',   mult: 2,   minutes: 1440, name: '2× XP — 1 day',  price: 2500 },
  { id: 'chip_1p5x_1h', kind: 'chip', mult: 1.5, minutes: 60,   name: '1.5× chip rewards — 1 hour', price: 400 },
  { id: 'chip_1p5x_1d', kind: 'chip', mult: 1.5, minutes: 1440, name: '1.5× chip rewards — 1 day',  price: 2000 },
];

const CHIP_BOOSTED_LABELS = {
  level_up: 'level-ups', achievement: 'achievements', mission: 'missions',
  daily_login: 'daily rewards', daily_spin: 'daily spins', scratch_card: 'scratch cards',
  daily_bonus: 'daily bonus',
};
/** The reward grants a chip booster multiplies (server catalog; overridable by `shopCatalog.chipBoostedRewards`). */
export const DEFAULT_CHIP_BOOSTED_REWARDS = ['daily_login', 'daily_spin', 'scratch_card', 'mission', 'achievement', 'level_up'];

function durationText(minutes) {
  if (minutes >= 1440 && minutes % 1440 === 0) return minutes === 1440 ? '24 hours' : `${minutes / 1440} days`;
  if (minutes >= 60 && minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** What a booster does, in one sentence that matches the server's effect. */
export function boosterEffectText(b, chipBoosted = DEFAULT_CHIP_BOOSTED_REWARDS) {
  if (!b) return '';
  const pct = Math.round((b.mult - 1) * 100);
  if (b.kind === 'xp') {
    return `${b.mult}× the XP you earn for ${durationText(b.minutes)}.`;
  }
  const list = (Array.isArray(chipBoosted) ? chipBoosted : DEFAULT_CHIP_BOOSTED_REWARDS)
    .map((k) => CHIP_BOOSTED_LABELS[k] || humanize(k).toLowerCase());
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : (list[0] || 'rewards');
  return `+${pct}% chips from ${joined} for ${durationText(b.minutes)}. Pot winnings are not boosted.`;
}

export const VIP_PASSES = [
  { id: 'daily',    name: 'Daily VIP',    days: 1,     price: 300 },
  { id: 'weekly',   name: 'Weekly VIP',   days: 7,     price: 1500 },
  { id: 'monthly',  name: 'Monthly VIP',  days: 30,    price: 5000 },
  { id: 'lifetime', name: 'Lifetime VIP', days: 36500, price: 50000 },
];

/**
 * C8 — the VIP pass perks, EXACTLY what an active pass grants (VIPPanel lists
 * these and nothing else). `id` matches the server's `vip.perks` ids.
 */
export const VIP_PASS_PERKS = [
  { id: 'vip_badge',      icon: '💎', text: 'VIP badge at every table' },
  { id: 'gold_frame',     icon: '🟨', text: 'Gold VIP nameplate frame at every table' },
  { id: 'login_bonus_50', icon: '🎁', text: '+50% daily login reward (chips and stars)' },
  { id: 'monthly_chips',  icon: '🪙', text: 'Monthly VIP chip bonus — claim once each month' },
  { id: 'vip_emotes',     icon: '👑', text: 'Exclusive VIP emotes in your emote wheel' },
];

/** The XP-rate tiers (by cumulative season XP) — apply to every player, pass or not. */
export const VIP_XP_TIERS = [
  { name: 'Bronze',   minXp: 0,     rate: 1,   color: '#CD7F32' },
  { name: 'Silver',   minXp: 1000,  rate: 1.5, color: '#C0C0C0' },
  { name: 'Gold',     minXp: 5000,  rate: 2,   color: '#FFD700' },
  { name: 'Platinum', minXp: 20000, rate: 3,   color: '#B388FF' },
];
/** The XP-rate tier for a cumulative season XP total. */
export function vipXpTierFor(totalXp) {
  const xp = Number(totalXp) || 0;
  let tier = VIP_XP_TIERS[0];
  for (const t of VIP_XP_TIERS) if (xp >= t.minXp) tier = t;
  return tier;
}

// R3 (E1) — exactly poker-server's BUNDLE_CONTENTS: only kinds the table draws (no celebration /
// sound pack / chip skin / card front / dealer voice / profile background — those rendered nowhere).
export const BUNDLES = [
  { id: 'starter',       name: 'Starter Bundle',    icon: '🎁', price: 800,   contents: [['card_back', 'silver_foil'], ['emote', 'nice_hand'], ['frame', 'bronze']] },
  { id: 'collector',     name: 'Collector Bundle',  icon: '📦', price: 2500,  contents: [['card_back', 'gold_premium'], ['theme', 'casino_royale'], ['frame', 'silver'], ['emote', 'crown'], ['title', 'bad_beat_survivor']] },
  { id: 'tournament',    name: 'Tournament Bundle', icon: '🏆', price: 4000,  contents: [['title', 'tournament_champ'], ['theme', 'royal_gold'], ['frame', 'gold'], ['card_back', 'holographic'], ['title', 'final_table'], ['emote', 'trophy']] },
  { id: 'whale_bundle',  name: 'Whale Bundle',      icon: '🐋', price: 10000, contents: [['theme', 'cosmic_nebula'], ['card_back', 'diamond_pattern'], ['frame', 'diamond'], ['title', 'tournament_champ'], ['emote', 'mic_drop'], ['title', 'royal'], ['theme', 'cherry_wood'], ['frame', 'gold']] },
  { id: 'mythic_bundle', name: 'Mythic Bundle',     icon: '✨', price: 25000, contents: [['card_back', 'mythic'], ['frame', 'mythic'], ['title', 'godmode'], ['frame', 'flame'], ['frame', 'diamond'], ['title', 'royal'], ['card_back', 'diamond_pattern'], ['title', 'tournament_champ'], ['theme', 'cosmic_nebula']] },
];

/** A bundle's contents as words; collectibles (drawn nowhere) are marked. */
export function bundleContentsText(contents) {
  return (contents || []).map(([t, id]) => {
    const name = itemName(t, id);
    const tl = (TYPE_LABELS[normalizeItemType(t)] || 'item').toLowerCase();
    return isSoldItem(t, id) ? `${name} ${tl}` : `${name} ${tl} (collectible)`;
  }).join(', ');
}

// ── Server price overrides (an optional `shopCatalog` answer) ────────────────

/** The price list the server sent (`shopCatalog.prices`), or null — the server is the authority. */
let serverPrices = null;
let serverChipBoosted = null;
export function setServerShopCatalog(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.prices && typeof payload.prices === 'object') serverPrices = payload.prices;
  if (Array.isArray(payload.chipBoostedRewards)) serverChipBoosted = payload.chipBoostedRewards.slice();
}
/** The star price of (type, id): the server's when it sent one, else the catalog's. */
export function priceOf(type, id, fallback) {
  const p = serverPrices && serverPrices[type] ? serverPrices[type][id] : undefined;
  if (Number.isInteger(p) && p >= 0) return p;
  return fallback;
}
export function chipBoostedRewards() {
  return serverChipBoosted || DEFAULT_CHIP_BOOSTED_REWARDS;
}

// ── Rewards → words (mystery box, scratch card, Battle Pass, missions) ────────

const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

/**
 * One server reward as words. Accepts every shape the server sends:
 *   { kind:'chips'|'stars'|'xp', amount }   (mystery box, Battle Pass, R2 scratch)
 *   { kind:'item', itemType, itemId }
 *   { chips?, stars?, xp?, item?:{type,id} } (scratch card / missions / daily)
 *   { kind:'stars', amount, reason:'duplicate_refund', itemType, itemId }
 *     (an item he already owned, paid in stars — never shown as the item)
 * A stated kind wins over item fields. Never "0 item" / "[object Object]":
 * an empty reward is "nothing".
 */
const VALUE_KINDS = ['chips', 'stars', 'xp'];
function isItemReward(reward, kind) {
  if (kind === 'item') return true;
  if (VALUE_KINDS.includes(kind)) return false;
  return !!(reward.itemId || (reward.item && typeof reward.item === 'object'));
}
export function formatReward(reward) {
  if (reward == null) return 'nothing';
  if (typeof reward === 'string') return reward;
  if (typeof reward !== 'object') return 'nothing';
  const kind = reward.kind || reward.type;
  if (isItemReward(reward, kind)) {
    const t = reward.itemType || reward.item?.type || reward.item?.itemType;
    const id = reward.itemId || reward.item?.id || reward.item?.itemId;
    if (id) return `the ${itemLabel(t, id)}`;
  }
  if (kind === 'chips') return `${fmtInt(reward.amount)} chips`;
  if (kind === 'stars' && reward.reason === 'duplicate_refund') {
    const what = reward.itemId ? `the ${itemLabel(reward.itemType, reward.itemId)}` : 'that item';
    return `${fmtInt(reward.amount)} stars (you already owned ${what})`;
  }
  if (kind === 'stars') return `${fmtInt(reward.amount)} stars`;
  if (kind === 'xp') return `${fmtInt(reward.amount)} XP`;
  const parts = [];
  if (Number(reward.chips) > 0) parts.push(`${fmtInt(reward.chips)} chips`);
  if (Number(reward.stars) > 0) parts.push(`${fmtInt(reward.stars)} stars`);
  if (Number(reward.xp) > 0) parts.push(`${fmtInt(reward.xp)} XP`);
  if (parts.length) return parts.join(' + ');
  if (Number(reward.amount) > 0) return `${fmtInt(reward.amount)} chips`;
  return 'nothing';
}

/** The kind of a reward for an icon: 'chips' | 'stars' | 'item' | 'xp' | 'none'. */
export function rewardKind(reward) {
  if (!reward || typeof reward !== 'object') return 'none';
  const k = reward.kind || reward.type;
  if (isItemReward(reward, k)) return 'item';
  if (VALUE_KINDS.includes(k)) return k;
  if (Number(reward.stars) > 0 && !(Number(reward.chips) > 0)) return 'stars';
  if (Number(reward.chips) > 0) return 'chips';
  if (Number(reward.xp) > 0) return 'xp';
  return 'none';
}

// ── Shop answers → words ──────────────────────────────────────────────────────

const PURCHASE_ERROR_TEXT = {
  'not enough stars': 'Not enough stars for that.',
  not_enough_stars: 'Not enough stars for that.',
  'already owned': 'You already own that.',
  already_owned: 'You already own that.',
  'unknown item': 'That item is not sold any more.',
  unknown_item: 'That item is not sold any more.',
  'unknown bundle': 'That bundle is not sold any more.',
  'unknown booster': 'That booster is not sold any more.',
  'unknown vip pass': 'That VIP pass is not sold any more.',
  'not authenticated': 'Sign in to use the shop.',
  not_authenticated: 'Sign in to use the shop.',
  'server error': 'Something went wrong — try again.',
  server_error: 'Something went wrong — try again.',
  not_hydrated: 'Your account is still loading — try again in a moment.',
  progress_loading: 'Your account is still loading — try again in a moment.',
  rate_limited: 'Too many tries — wait a moment and try again.',
  login_required: 'Sign in to use the shop.',
  vip_required: 'That needs an active VIP pass.',
  no_cards_available: 'No scratch cards to reveal yet — you earn one every 20 hands.',
  not_owned: 'You do not own that yet.',
  not_equippable: 'That item cannot be equipped.',
  already_claimed: 'Already claimed.',
};

/**
 * A server error as a player sentence. Accepts a code / sentence string or the
 * whole answer ({ code, error, message } — poker-server R2 sends a stable
 * `code` plus an `error` sentence): a known code / sentence is mapped, a
 * sentence written for players is kept, a bare unknown code is not shown.
 */
export function shopErrorText(err, fallback = 'That did not work — try again.') {
  if (!err) return fallback;
  const parts = typeof err === 'object' ? [err.code, err.error, err.message] : [err];
  for (const raw of parts) {
    const key = String(raw || '').trim().toLowerCase();
    if (key && PURCHASE_ERROR_TEXT[key]) return PURCHASE_ERROR_TEXT[key];
  }
  const sentences = typeof err === 'object' ? [err.message, err.error] : [err];
  for (const msg of sentences) {
    if (typeof msg === 'string' && /\s/.test(msg.trim()) && msg.length <= 160) return msg.trim();
  }
  return fallback;
}

/** `purchaseResult` → the toast text (null when there is nothing to say). */
export function purchaseResultText(data, nowMs = Date.now()) {
  if (!data || typeof data !== 'object') return null;
  if (!data.success) return data.error || data.code ? `Purchase failed: ${shopErrorText(data)}` : null;
  const type = data.itemType;
  if (type === 'chip_pack') {
    const payout = Number(data.payout) || CHIP_PACKS.find((p) => p.id === data.itemId)?.chips || 0;
    return payout > 0 ? `+${fmtInt(payout)} chips added to your balance.` : 'Chip pack added to your balance.';
  }
  if (type === 'mystery_box' || data.mysteryReward) {
    const r = data.mysteryReward;
    if (r && r.reason === 'duplicate_refund') return `Mystery box: you already owned the item it rolled, so you got ${fmtInt(r.amount)} stars back.`;
    return `Mystery box: you won ${formatReward(r)}!`;
  }
  if (type === 'booster' || data.booster) {
    const b = data.booster || {};
    const def = BOOSTERS.find((x) => x.id === data.itemId);
    const until = Number(b.expiresAt) > nowMs ? new Date(Number(b.expiresAt)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    return `${def ? def.name : 'Booster'} is on${until ? ` until ${until}` : ''}.`;
  }
  if (type === 'vip_pass' || data.vipExpiresAt) {
    const until = Number(data.vipExpiresAt) > nowMs ? new Date(Number(data.vipExpiresAt)).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    return `VIP is active${until ? ` until ${until}` : ''}. Your VIP perks are on.`;
  }
  if (type === 'bundle' || Array.isArray(data.bundleGranted)) {
    const got = Array.isArray(data.bundleGranted) ? data.bundleGranted.length : 0;
    const dup = Number(data.bundleDuplicates) || 0;
    return `Bundle unlocked: ${got} new item${got === 1 ? '' : 's'}${dup > 0 ? ` (${dup} you already owned were refunded in stars)` : ''}.`;
  }
  if (type && data.itemId) return `${itemName(type, data.itemId)} is yours — equip it in the Shop.`;
  return 'Purchase complete.';
}

// ── Daily spin (APPUI-37) ─────────────────────────────────────────────────────

/**
 * The daily spin's REAL prize table (poker-server claimDailySpinServer /
 * SPIN_WHEEL_SEGMENTS, in the server's order): the wheel draws exactly these,
 * sized by their odds. The server's `spinWheelConfig` answer (getSpinWheel)
 * replaces it.
 */
export const DEFAULT_SPIN_SEGMENTS = [
  { id: 'stars_100',   label: '100 Stars',    chips: 0,     stars: 100, weight: 5 },
  { id: 'stars_25',    label: '25 Stars',     chips: 0,     stars: 25,  weight: 20 },
  { id: 'chips_2500',  label: '2,500 Chips',  chips: 2500,  stars: 0,   weight: 50 },
  { id: 'chips_10000', label: '10,000 Chips', chips: 10000, stars: 0,   weight: 25 },
];

/** Normalise a server segment list; null when unusable. */
export function normalizeSpinSegments(list) {
  if (!Array.isArray(list) || list.length < 2 || list.length > 16) return null;
  const out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') return null;
    const chips = Math.max(0, Math.round(Number(s.chips) || 0));
    const stars = Math.max(0, Math.round(Number(s.stars) || 0));
    const weight = Number(s.weight) > 0 ? Number(s.weight) : 1;
    const id = String(s.id || `${chips}c${stars}s`);
    const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 24) : formatReward({ chips, stars });
    out.push({ id, label, chips, stars, weight });
  }
  return out;
}

/** The segment a server spin result landed on: by `segmentId`, else by its chips/stars. */
export function segmentForSpinResult(segments, res) {
  const list = Array.isArray(segments) ? segments : DEFAULT_SPIN_SEGMENTS;
  if (res && res.segmentId != null) {
    const byId = list.findIndex((s) => s.id === String(res.segmentId));
    if (byId >= 0) return byId;
  }
  const r = (res && res.reward) || {};
  const chips = Math.round(Number(r.chips) || 0);
  const stars = Math.round(Number(r.stars) || 0);
  const exact = list.findIndex((s) => s.chips === chips && s.stars === stars);
  if (exact >= 0) return exact;
  return -1;
}

// ── Battle Pass (APPUI-6 / ECON-16) ───────────────────────────────────────────

export const BATTLE_PASS_TOTAL_TIERS = 50;
export const BATTLE_PASS_XP_PER_TIER = 500;
export const BATTLE_PASS_PREMIUM_COST = 950;
export const BATTLE_PASS_SEASON_NAME = 'Season 1: The River';

/**
 * Premium milestone cosmetics — REAL catalog items (the server grants exactly
 * these; every one renders at the table). The other tiers mirror the server's
 * bpReward table; a `battlePassInfo` answer (getBattlePass) replaces this
 * table with the server's own tiers.
 */
export const BATTLE_PASS_PREMIUM_MILESTONES = {
  10: ['card_back', 'dragon'],
  20: ['emote', 'trophy'],
  30: ['theme', 'neon_vegas'],
  40: ['frame', 'diamond'],
  50: ['title', 'royal'],
};

/** The reward of (tier, track), as the server grants it. */
export function battlePassReward(tier, track) {
  if (track === 'free') {
    if (tier % 10 === 0) return { kind: 'chips', amount: tier * 200 };
    if (tier % 5 === 0) return { kind: 'chips', amount: 500 };
    return { kind: 'xp', amount: 100 };
  }
  const m = BATTLE_PASS_PREMIUM_MILESTONES[tier];
  if (m) return { kind: 'item', itemType: m[0], itemId: m[1] };
  if (tier % 3 === 0) return { kind: 'chips', amount: 1000 };
  return { kind: 'stars', amount: 10 };
}

// ── Season (C9) ───────────────────────────────────────────────────────────────

export const SEASON_REWARDS = [
  { place: 1, chips: 50000, badge: 'season_gold' },
  { place: 2, chips: 25000, badge: 'season_silver' },
  { place: 3, chips: 10000, badge: 'season_bronze' },
];
