/**
 * Sit & Go fix-all F7 / F19 / F12 (owner 2026-10-23: "Fix all") — what a
 * player is told about HIS OWN finish in a chip tournament, and the payout
 * table. Pure (no React, no store): App.jsx, GameHUD, TournamentLobby and
 * TournamentBracket call it; the node probes load it.
 *
 * The audit's 2nd and 3rd place (Wesley Smith 270, Andy K. 180) were paid but
 * never shown their prize: the Game Over line names only the winner. Now every
 * finisher gets "You finished 2nd - +270 chips" from the SERVER's numbers:
 *   - `tournamentFinished.myResult {place, prize, tied?}` (poker-server F7,
 *     per socket), else his own `results[]` row by account id (an older
 *     server; F19 keeps `userId` on the receiving socket's own row only);
 *   - `eliminatedToSpectator` / the direct `playerEliminated` `prize`
 *     (present only when the place is paid and final);
 *   - the lobby item's `payouts [{place, amount}]` (+ `payoutField`,
 *     `payoutsProjected` while the field can still change).
 * A qualifier's frames are untouched: its Game Over line stays the qualifier
 * one, with no own line added. Nothing here computes a prize.
 */
import { ordinal, tournamentCompleteMessage, qualifierFinishFrame } from './qualifierList.js';

function posInt(v) {
  const n = Number(v);
  return v !== null && v !== '' && typeof v !== 'boolean' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
function chips(v) {
  const n = Number(v);
  return v !== null && v !== '' && typeof v !== 'boolean' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * His own result in a `tournamentFinished` frame: { place, prize, tied } or
 * null (a spectator, no own row). `prize` is null when the frame does not say.
 */
export function ownFinishResult(data, myUserId) {
  if (!data || typeof data !== 'object') return null;
  const mr = data.myResult && typeof data.myResult === 'object' ? data.myResult : null;
  if (mr && posInt(mr.place)) return { place: posInt(mr.place), prize: chips(mr.prize), tied: mr.tied === true };
  const rows = Array.isArray(data.results) ? data.results.filter((r) => r && typeof r === 'object') : [];
  const mine = myUserId != null ? rows.find((r) => r.userId != null && String(r.userId) === String(myUserId)) : null;
  if (!mine) return null;
  const place = posInt(mine.place) || posInt(mine.position);
  if (!place) return null;
  return { place, prize: chips(mine.prize ?? mine.payout), tied: mine.tied === true };
}

/** "You finished 2nd - +270 chips" / "You finished 6th" ('' without a place). */
export function ownFinishLine(r) {
  const place = r && posInt(r.place);
  if (!place) return '';
  const prize = chips(r.prize);
  return `You finished ${ordinal(place)}${r.tied === true ? ' (tied)' : ''}${prize > 0 ? ` - +${fmt(prize)} chips` : ''}`;
}

/**
 * The Game Over overlay for a finished tournament: { message, ownLine }.
 * `message` is exactly tournamentCompleteMessage's line (the qualifier line at
 * a qualifier); `ownLine` is his own place + prize, '' at a qualifier or for a
 * spectator.
 */
export function finishOverlay(data, myUserId) {
  const message = tournamentCompleteMessage(data, myUserId);
  if (qualifierFinishFrame(data, myUserId)) return { message, ownLine: '' };
  return { message, ownLine: ownFinishLine(ownFinishResult(data, myUserId)) };
}

/** The bust banner's line when his place is paid: "You finished 2nd - +270 chips", else null. */
export function bustBannerPrizeLine(elim) {
  if (!elim || typeof elim !== 'object') return null;
  const prize = chips(elim.prize);
  if (!(prize > 0) || !posInt(elim.position)) return null;
  return ownFinishLine({ place: elim.position, prize });
}

/** " Prize: 270 chips." for a toast, '' without a prize. */
export function prizeSuffix(prize) {
  const p = chips(prize);
  return p > 0 ? ` Prize: ${fmt(p)} chips.` : '';
}

/** The lobby item's payout table: [{ place, amount, label }] by place ([] when not sent). */
export function payoutRows(item) {
  const list = item && Array.isArray(item.payouts) ? item.payouts : [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const place = posInt(p.place);
    const amount = chips(p.amount);
    if (!place || !(amount > 0)) continue;
    out.push({ place, amount, label: ordinal(place) });
  }
  return out.sort((a, b) => a.place - b.place);
}

/** "1st 450 · 2nd 270 · 3rd 180" ('' when there is no table). */
export function payoutTableText(item) {
  return payoutRows(item).map((r) => `${r.label} ${fmt(r.amount)}`).join(' · ');
}

/** "If 9 play" while the server says the amounts are projected for that field, else ''. */
export function payoutsNote(item) {
  if (!item || item.payoutsProjected !== true) return '';
  const field = posInt(item.payoutField);
  return field ? `If ${field} play` : '';
}
