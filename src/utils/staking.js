/**
 * Staking helpers (R2 contract C4, 2026-10-11 — APPUI-22 / TOURNEY-8).
 * Pure module: StakingMarketplace and the offline harness use it.
 */

/** The stakeable-tournament list from `myStakeableTournaments` ([{tournamentId,name,startsAt}] or {tournaments}). */
export function normalizeStakeableTournaments(payload) {
  const list = Array.isArray(payload) ? payload : (Array.isArray(payload?.tournaments) ? payload.tournaments : []);
  const out = [];
  for (const t of list) {
    const id = t && t.tournamentId != null ? String(t.tournamentId) : '';
    if (!id || out.some((x) => x.tournamentId === id)) continue;
    const startsAt = t.startsAt != null ? (typeof t.startsAt === 'number' ? t.startsAt : Date.parse(String(t.startsAt))) : null;
    out.push({ tournamentId: id, name: t.name ? String(t.name).slice(0, 60) : 'Tournament', startsAt: Number.isFinite(startsAt) ? startsAt : null });
  }
  return out;
}

/**
 * Is this offer the signed-in account's own? By ACCOUNT only — a server
 * `isMine` flag, the seller's user id, or an offer id this tab created —
 * never by display name (two players can share one; the Buy button used to be
 * hidden on another seller's offer whose name matched).
 */
export function isOwnStakeOffer(offer, { userId = null, myOfferIds = null } = {}) {
  if (!offer) return false;
  if (offer.isMine === true || offer.mine === true) return true;
  if (offer.isMine === false || offer.mine === false) return false;
  const seller = offer.sellerUserId ?? offer.sellerId;
  if (seller !== null && seller !== undefined && userId !== null && userId !== undefined && String(seller) === String(userId)) return true;
  return !!(myOfferIds && offer.id !== null && offer.id !== undefined && myOfferIds.has(String(offer.id)));
}

/** createStake payload: C4 names + the pre-C4 names (an older server reads those). */
export function createStakePayload({ tournamentId, percent, pricePerPercent }) {
  const p = Number(percent);
  const price = Number(pricePerPercent);
  return { tournamentId: String(tournamentId), percent: p, pricePerPercent: price, totalPct: p, pricePerPct: price };
}
