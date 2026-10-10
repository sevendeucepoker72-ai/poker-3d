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
 * an import cycle: this module imports nothing. It also owns the tab-scoped
 * sign-in marker (S3, below) for the same reason.
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

// ── Tab-scoped sign-in (2026-10-10, S3) ─────────────────────────────────────
// A bridged "Play Online" / cross-site link (#bridge_id_token) for account A,
// opened on a browser that already holds ANOTHER (or an unprovable) account's
// stored .online sign-in, signs THIS TAB in as A WITHOUT touching that stored
// sign-in: A's tokens live only in this tab's sessionStorage, and this marker
// (also sessionStorage — it survives a reload of this tab, dies with the tab)
// tells tokenStorage to read and write only those tab copies, authScheduler /
// authService to refresh only A's own grant, crossTabSignOut to follow only
// A's own sign-out, and gameStore's Sign Out to leave the browser's other
// sign-in alone. Set only by services/bridge.js; removed with the tab's own
// credentials (Sign Out, a revoked refresh, an explicit sign-in / another
// account's ticket replacing the tab's session — tokenStorage.endTabScopedSignIn).
export const TAB_SCOPED_SIGN_IN_KEY = 'poker_tab_scoped_signin';

function sessionStore() {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

/** `{ masterUserId, since }` when THIS tab runs on a tab-scoped sign-in, else null. */
export function getTabScopedSignIn() {
  const store = sessionStore();
  if (!store) return null;
  let raw = null;
  try { raw = store.getItem(TAB_SCOPED_SIGN_IN_KEY); } catch { raw = null; }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.scope !== 'tab') return null;
    return { masterUserId: idString(parsed.masterUserId), since: Number(parsed.since) || 0 };
  } catch {
    return null;
  }
}

/** Mark THIS tab's sign-in as tab-scoped (account `masterUserId`; null = not readable). */
export function setTabScopedSignIn(masterUserId) {
  const store = sessionStore();
  if (!store) return false;
  try {
    store.setItem(TAB_SCOPED_SIGN_IN_KEY, JSON.stringify({ scope: 'tab', masterUserId: idString(masterUserId), since: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/** Forget the tab-scoped marker (the caller removes the tab's own token copies). */
export function clearTabScopedSignIn() {
  const store = sessionStore();
  if (!store) return;
  try { store.removeItem(TAB_SCOPED_SIGN_IN_KEY); } catch { /* ignore */ }
}
