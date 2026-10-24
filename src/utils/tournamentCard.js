/**
 * Sit & Go fix-all F8 + F21 (owner 2026-10-23: "Fix all", "5-minute levels")
 * — the tournament lobby card's lines that say how an on-demand event starts,
 * when it cancels, and its structure. Pure (no React): TournamentLobby calls
 * it, the node probes load it. Every number comes from the server's lobby item
 * (`tournamentList`), never hard-coded:
 *   minPlayers / maxPlayers       — the start rule ("Starts when 9/9");
 *   stallCancelMs                 — the cancel rule (30 min after the first
 *                                   entry if not full; absent on an older
 *                                   server: no cancel line);
 *   stallCancelAt                 — the earliest remaining registrant's entry
 *                                   + that time (the server restarts the clock
 *                                   when the first registrant leaves);
 *   startingChips, levelSeconds   — the structure (poker-server F21; also
 *   (blindStructure[].durationSec)  read: levelDurationSec / levelDurationMs /
 *                                   levelMinutes / structure.{...}).
 * The audit: a Sit & Go at 8 of 9 was cancelled 30 minutes after its first
 * sign-up while the card only said "Players: 8/9".
 */
import { formatDenverTime } from './qualifierList.js';

function posInt(v) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * "Starts when 9/9 · cancels 30 min after the first entry if not full" for an
 * on-demand event still registering; null for a scheduled event (it shows its
 * own start time), a running one, or an item without min / max.
 */
export function startRuleText(item) {
  if (!item || typeof item !== 'object' || item.status !== 'registering' || item.nextStartTime) return null;
  const max = posInt(item.maxPlayers);
  const min = posInt(item.minPlayers);
  if (!max || !min) return null;
  const full = min >= max;
  const start = full ? `Starts when ${max}/${max}` : `Starts at ${min}/${max}`;
  const ms = posInt(item.stallCancelMs);
  if (!ms) return start;
  const mins = Math.max(1, Math.round(ms / 60000));
  const cancel = full
    ? `cancels ${mins} min after the first entry if not full`
    : `cancels ${mins} min after the first entry if fewer than ${min} have entered`;
  return `${start} · ${cancel}`;
}

/**
 * "Not full by 9:27 PM MT: cancelled, every entry refunded" while someone is
 * registered and the server names the time; else null.
 */
export function stallDeadlineText(item) {
  if (!item || typeof item !== 'object' || item.status !== 'registering' || item.nextStartTime) return null;
  if (!(Number(item.registeredPlayers) > 0)) return null;
  const at = posInt(item.stallCancelAt);
  if (!at) return null;
  const t = formatDenverTime(at);
  return t ? `Not full by ${t}: cancelled, every entry refunded` : null;
}

function levelSecondsOf(item) {
  const nested = item.structure && typeof item.structure === 'object' ? item.structure : {};
  const direct = posInt(item.levelSeconds) || posInt(item.levelDurationSec) || posInt(nested.levelSeconds) || posInt(nested.levelDurationSec);
  if (direct) return direct;
  const ms = posInt(item.levelDurationMs) || posInt(nested.levelDurationMs);
  if (ms) return Math.round(ms / 1000);
  const min = posInt(item.levelMinutes) || posInt(nested.levelMinutes);
  if (min) return min * 60;
  // F21 — every level the same length in the server's blindStructure.
  const levels = Array.isArray(item.blindStructure) ? item.blindStructure : [];
  const secs = levels.map((l) => posInt(l && (l.durationSec ?? l.duration))).filter(Boolean);
  if (secs.length && secs.length === levels.length && secs.every((s) => s === secs[0])) return secs[0];
  return null;
}

/** "Starting chips 1,500 · 5-min levels" (each part only when known); null when nothing is. */
export function structureText(item) {
  if (!item || typeof item !== 'object') return null;
  const nested = item.structure && typeof item.structure === 'object' ? item.structure : {};
  const chips = posInt(item.startingChips) || posInt(item.startingStack) || posInt(nested.startingChips);
  const secs = levelSecondsOf(item);
  const parts = [];
  if (chips) parts.push(`Starting chips ${fmt(chips)}`);
  if (secs) parts.push(secs % 60 === 0 ? `${secs / 60}-min levels` : `${secs}-sec levels`);
  return parts.length ? parts.join(' · ') : null;
}
