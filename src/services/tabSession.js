/**
 * tabSession — which kind of sign-in THIS TAB is in.
 *
 * In memory only (per tab, per page load). Set by every successful sign-in
 * path: 'ticket' (a "Play Online" deep-link ticket / waitlist login that
 * stored a resume record, or a resume of one — see
 * sessionResume.markTicketSignIn), 'oidc' (bridge / callback / refresh-token
 * login), 'legacy' (tokenLogin, or the pre-R1 re-auth path).
 *
 * Split out of services/sessionResume.js on 2026-10-10 (F5) so that
 * tokenStorage.js (the HTTP bearer) and authScheduler.js can read it without
 * an import cycle: this module imports nothing.
 *
 * `masterUserId` (F5) — for a ticket tab, the master (americanpub.poker)
 * user id its session belongs to, read from the server-signed resume token
 * the login carried; null when unknown. Device-wide stored OIDC credentials
 * are used by a ticket tab ONLY when they provably name this same account
 * (tokenStorage.bearerForThisTab / authScheduler): a shared browser can hold
 * another account's OIDC sign-in, and one tab never mixes two accounts.
 */

let _tabSession = null; // { kind, userId, masterUserId }

function idString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function setTabSession(kind, userId, { masterUserId = null } = {}) {
  const id = idString(userId);
  _tabSession = kind && id
    ? { kind: String(kind), userId: id, masterUserId: idString(masterUserId) }
    : null;
}

export function resetTabSession() {
  _tabSession = null;
}

/** This tab's session marker — `{ kind, userId, masterUserId }` (a copy) — or null. */
export function getTabSession() {
  return _tabSession
    ? { kind: _tabSession.kind, userId: _tabSession.userId, masterUserId: _tabSession.masterUserId }
    : null;
}
