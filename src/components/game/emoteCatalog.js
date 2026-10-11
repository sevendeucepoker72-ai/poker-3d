/**
 * The table's emote catalog (.online R2, 2026-10-11 — C7 / C8). Kept out of
 * EmoteWheel.jsx so that file exports only its component (fast refresh).
 * Ids mirror poker-server src/economy/catalog.ts: FREE_EMOTES, FREE_REACTIONS,
 * SHOP_PRICES.emote and VIP_EMOTES.
 */

// Per-player emotes (shown at the sender's seat). `emote` socket event.
// The free set (poker-server catalog FREE_EMOTES).
export const EMOTES = [
  { id: 'nice',     icon: '👍', label: 'Nice',     kind: 'emote' },
  { id: 'lol',      icon: '😂', label: 'LOL',      kind: 'emote' },
  { id: 'cool',     icon: '😎', label: 'Cool',     kind: 'emote' },
  { id: 'angry',    icon: '😡', label: 'Angry',    kind: 'emote' },
  { id: 'thinking', icon: '🤔', label: 'Thinking', kind: 'emote' },
  { id: 'dead',     icon: '💀', label: 'Dead',     kind: 'emote' },
  { id: 'fire',     icon: '🔥', label: 'Fire',     kind: 'emote' },
  { id: 'gg',       icon: '👏', label: 'GG',       kind: 'emote' },
];
// Merged from TableReactions per user request — table-wide reactions
// (float over the felt, shown to everyone). `tableReaction` event. Free.
export const REACTIONS = [
  { id: 'clap',  icon: '👏', label: 'Clap',  kind: 'reaction' },
  { id: 'laugh', icon: '😂', label: 'Laugh', kind: 'reaction' },
  { id: 'cry',   icon: '😢', label: 'Cry',   kind: 'reaction' },
  { id: 'shock', icon: '😱', label: 'Shock', kind: 'reaction' },
];
// R2 (C7) — the shop's emotes (poker-server catalog SHOP_PRICES.emote): on the
// wheel once OWNED. Every id is also drawn when another player sends it.
export const SHOP_EMOTES = [
  { id: 'nice_hand',   icon: '👍', label: 'Nice Hand' },
  { id: 'good_game',   icon: '🤝', label: 'Good Game' },
  { id: 'well_played', icon: '🎯', label: 'Well Played' },
  { id: 'thumbs_up',   icon: '👍', label: 'Thumbs Up' },
  { id: 'clap',        icon: '👏', label: 'Clap' },
  { id: 'love',        icon: '💙', label: 'Love' },
  { id: 'big_brain',   icon: '🧠', label: 'Big Brain' },
  { id: 'money',       icon: '💰', label: 'Money' },
  { id: 'fire',        icon: '🔥', label: 'Fire' },
  { id: 'tears',       icon: '😭', label: 'Tears' },
  { id: 'rocket',      icon: '🚀', label: 'Rocket' },
  { id: 'crown',       icon: '👑', label: 'Crown' },
  { id: 'sunglasses',  icon: '😎', label: 'Cool' },
  { id: 'laughing',    icon: '😂', label: 'Laughing' },
  { id: 'surprised',   icon: '😲', label: 'Surprised' },
  { id: 'dead',        icon: '💀', label: 'Dead' },
  { id: 'think',       icon: '🤔', label: 'Thinking' },
  { id: 'poker_face',  icon: '😐', label: 'Poker Face' },
  { id: 'mic_drop',    icon: '🎤', label: 'Mic Drop' },
  { id: 'trophy',      icon: '🏆', label: 'Trophy' },
].map((e) => ({ ...e, kind: 'emote' }));
// R2 (C8) — the VIP pass emotes (VIP_EMOTES): on the wheel while VIP is active.
export const VIP_EMOTES = [
  { id: 'vip_crown',     icon: '👑', label: 'VIP Crown' },
  { id: 'vip_diamond',   icon: '💎', label: 'VIP Diamond' },
  { id: 'vip_champagne', icon: '🍾', label: 'VIP Cheers' },
].map((e) => ({ ...e, kind: 'emote', vip: true }));

export const FREE_IDS = new Set(EMOTES.map((e) => e.id));

// Every id the table can DRAW (received emotes / reactions render from this):
// free, reactions, shop and VIP. Where an id is in two sets (fire, dead,
// clap) the icon is the same; the free / reaction entry wins.
export const EMOTE_MAP = Object.fromEntries(
  [...SHOP_EMOTES, ...VIP_EMOTES, ...REACTIONS, ...EMOTES].map((e) => [e.id, e]),
);

/**
 * The emote ids this player may send beyond the free set, from the server's
 * progress push (C5): `equipped.emotes` (the server's own list: free + owned +
 * VIP while active) when present; else the owned 'emote:<id>' keys + the VIP
 * emotes while the pass is active. Exported for tests.
 */
export function usableEmoteIds(progress, nowMs = Date.now()) {
  const out = new Set();
  const p = progress && typeof progress === 'object' ? progress : null;
  if (!p) return out;
  const eq = p.equipped;
  if (eq && typeof eq === 'object' && Array.isArray(eq.emotes)) {
    for (const id of eq.emotes) if (typeof id === 'string') out.add(id);
    return out;
  }
  const keys = Array.isArray(p.ownedKeys) ? p.ownedKeys : (Array.isArray(p.owned) ? p.owned : []);
  for (const k of keys) if (typeof k === 'string' && k.startsWith('emote:')) out.add(k.slice(6));
  const ownedSet = p.ownedBy && p.ownedBy.emote;
  if (ownedSet && typeof ownedSet.forEach === 'function') ownedSet.forEach((id) => { if (typeof id === 'string') out.add(id); });
  const v = p.vip && typeof p.vip === 'object' ? p.vip : null;
  const exp = v && typeof v.expiresAt === 'number' ? v.expiresAt : (typeof p.vipExpiresAt === 'number' ? p.vipExpiresAt : null);
  if ((v && v.active === true) || (exp !== null && exp > nowMs)) for (const e of VIP_EMOTES) out.add(e.id);
  return out;
}
