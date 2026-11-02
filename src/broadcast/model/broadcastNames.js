/**
 * Names on the broadcast (lead spec §3 "Name rule", 2026-11-01; owner
 * 2026-11-02: "First name + last initial, with a per-player opt-out to show as
 * Player"). The SERVER applies the rule (broadcastNameOf: First L., one word as
 * is, opt-out or unknown opt-out = 'Player') before anything is sent. The page
 * renders only that `name` field — never a playerName, never an account id —
 * and a seat without one is 'Seat N'. Avatars are a monogram only (uploaded
 * photos never go on air; avatar moderation is off).
 */
const MAX_NAME = 24;
// Control, zero-width and bidi-override characters never reach the screen
// (built from code points so the source holds no invisible characters).
const STRIP_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069]];
const STRIP_RE = new RegExp(
  `[${STRIP_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`,
  'g',
);

/** The on-air name of a seat / leader row, else 'Seat N' (seatIndex 0-based). */
export function broadcastName(entry, seatIndex = null) {
  const raw = entry && typeof entry.name === 'string' ? entry.name.replace(STRIP_RE, '').trim() : '';
  if (raw) return raw.length > MAX_NAME ? `${raw.slice(0, MAX_NAME - 1)}…` : raw;
  const idx = Number.isInteger(seatIndex) ? seatIndex : (entry && Number.isInteger(entry.seatIndex) ? entry.seatIndex : null);
  return idx === null ? 'Player' : `Seat ${idx + 1}`;
}

/** One or two letters for the monogram disc: 'J. S.' -> 'JS', 'Player' -> 'P'. */
export function monogram(name) {
  const words = String(name || '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (/^Seat$/i.test(words[0]) && words[1]) return words[1].slice(0, 2);
  const first = words[0][0];
  const second = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + second).toUpperCase();
}

/** A stable hue for the monogram disc, kept in the blue / gold band (never red). */
export function monogramHue(pidOrName) {
  const s = String(pidOrName || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  // 190-250 (cyan..blue) or 38-52 (gold): two brand bands, nothing near red.
  return h % 3 === 0 ? 38 + (h % 15) : 190 + (h % 61);
}
