/**
 * sessionResume — the resumable game-server session (2026-10-09, contract R1).
 *
 * WHY. A player who arrives through the player app's "Play Online" button is
 * signed in by a ONE-SHOT ticket (authWithTicket / joinWithWaitlistContext):
 * poker-server burns the ticket on receipt, and the tab holds no OIDC refresh
 * token. Every socket reconnect (phone unlock, PWA resume, Railway blip) is a
 * NEW server-side socket with no session, and nothing on this device could
 * sign it back in — so the next play attempt was refused `login_required` and
 * the player was told to sign in.
 *
 * poker-server includes, on a successful ticket / waitlist login ONLY (D1 —
 * never on oauthLogin / tokenLogin: an OIDC session re-authenticates with its
 * own refresh flow; never for an admin row):
 *   loginResult.resumeToken      HMAC-signed (server JWT_SECRET), claims
 *                                localUserId, masterUserId, token_version,
 *                                orig_iat (the ORIGINAL ticket login, carried
 *                                unchanged through every resume),
 *                                exp = min(now + 12h, orig_iat + 24h) (S4: a
 *                                token never outlives the chain's absolute
 *                                cap; a chain at its cap gets no token),
 *                                kind:'online_resume'
 *   loginResult.resumeExpiresAt  ISO timestamp (= exp)
 * and answers socket `resumeSession {resumeToken, requestId?}` with a
 * `loginResult` shaped like authWithTicket's success (with a fresh
 * resumeToken), or `{success:false, code:'resume_invalid'}` — expired, more
 * than 24h after orig_iat (absolute cap), bad signature, token_version bumped
 * (sign-out / ban / admin — that is how a resume token is revoked), user
 * banned, master link changed.
 *
 * This module only stores and reads that credential, plus which kind of
 * session THIS TAB is in. It is presented by services/socketReauth.js (every
 * reconnect + the login_required silent recovery), App.jsx's boot path, and
 * multiTableManager's extra-table sockets.
 *
 * Storage: ONE record under `poker_online_resume`, in localStorage when "keep
 * me signed in" is on (the default), else sessionStorage — the same rule as
 * every other credential in tokenStorage.js, so a session-only shared device
 * forgets it with the tab. The record is BOUND to the local user id it was
 * issued for (`userId`, from the token's localUserId claim): a signed-in tab
 * only ever presents a record for its own user (readResumeRecordForUser), so
 * a record another tab wrote for a different account can never switch this
 * tab's socket to that account. Cleared on sign-out (gameStore.logout), on
 * resume_invalid, on a refresh-token revocation wipe / session-expired
 * teardown / peer-tab sign-out, and when an OIDC or legacy sign-in replaces
 * the session. The player's own Sign Out also revokes it on the server
 * first — socket 'revokeSignInTokens' with an acknowledgement, which bumps the
 * row's users.token_version — so a copied record stops working on every
 * device.
 */
import { isKeepSignedIn, decodeJwtPayload } from './tokenStorage';

export const RESUME_STORAGE_KEY = 'poker_online_resume';
export const RESUME_INVALID = 'resume_invalid';
export const RESUME_EVENT = 'resumeSession';

// The only kind of sign-in that carries a resume token (D1).
const VIA_TICKET = 'ticket';

// Treat a record as expired this long before its real expiry (clock skew +
// the round-trip the resume itself takes).
const EXPIRY_SKEW_MS = 60_000;
// Upper bound when the server sent no usable expiry (R1 says 12h).
const MAX_LIFETIME_MS = 12 * 60 * 60_000;
// D1 absolute cap: a resume is refused once now - orig_iat > 24h. Mirrored
// here so the client stops presenting a record the server would refuse.
const ABSOLUTE_CAP_MS = 24 * 60 * 60_000;

function stores() {
  const win = typeof window !== 'undefined' ? window : null;
  return { local: win ? win.localStorage : null, session: win ? win.sessionStorage : null };
}
function safeGet(store, key) { try { return store?.getItem?.(key) ?? null; } catch { return null; } }
function safeSet(store, key, val) { try { store?.setItem?.(key, val); return true; } catch { return false; } }
function safeRemove(store, key) { try { store?.removeItem?.(key); } catch { /* ignore */ } }

function idString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** Forget the stored resume credential (sign-out, resume_invalid, session change). */
export function clearResumeRecord() {
  const { local, session } = stores();
  safeRemove(local, RESUME_STORAGE_KEY);
  safeRemove(session, RESUME_STORAGE_KEY);
}

// ── Which kind of session THIS TAB is in ────────────────────────────────────
// In memory only (per tab, per page load). Set by every successful sign-in
// path: 'ticket' (deep-link ticket / waitlist login that stored a resume
// record — see markTicketSignIn for one that did not — or a resume of one),
// 'oidc' (bridge / callback / refresh-token login), 'legacy' (tokenLogin).
// socketReauth uses it so a TICKET tab re-authenticates only with its own
// resume record — never by falling through to OIDC credentials the device
// may hold for some other account.
let _tabSession = null; // { kind, userId }

export function setTabSession(kind, userId) {
  const id = idString(userId);
  _tabSession = kind && id ? { kind: String(kind), userId: id } : null;
}

export function resetTabSession() {
  _tabSession = null;
}

/** This tab's session marker — `{ kind, userId }` (a copy) — or null. */
export function getTabSession() {
  return _tabSession ? { kind: _tabSession.kind, userId: _tabSession.userId } : null;
}

/**
 * A deep-link ticket / waitlist sign-in for `userId` succeeded. Mark the tab
 * by what a reconnect can actually sign it back in with (2026-10-09 review
 * fix — the tab used to be marked 'ticket' even when no record was stored,
 * and then every reconnect stayed signed out):
 *   - this tab is already an OIDC session for the SAME user → keep 'oidc',
 *     WHETHER OR NOT a record was stored (T6): its refresh flow signs the same
 *     account back in for as long as the OIDC session lives, while a resume
 *     record dies within 24h — demoting the tab to 'ticket' would leave every
 *     reconnect after that signed out despite a valid OIDC session. (Typical
 *     cases: a waitlist link that rode this tab's own oauthLogin — no resume
 *     token — or the boot race in which oauthLogin answered before the Play
 *     Online ticket did — a resume token.) A record just stored for that user
 *     is dropped again: an 'oidc' tab never presents it, and on the next boot
 *     it would be resumed BEFORE the refresh token (App.jsx
 *     startLocalAutoLogin) and turn the reloaded tab into a 24h ticket
 *     session — the same outcome as the opposite race order, where the
 *     oauthLogin answering last clears the record;
 *   - otherwise, a resume record was stored for this user (`recordStored`, the
 *     return value of saveTicketResume)                 → 'ticket';
 *   - no record, and this tab's current session is a DIFFERENT user's → mark
 *     'ticket' anyway: a ticket tab presents only its own record and so stays
 *     signed out on a reconnect, instead of re-authenticating with the other
 *     account's credentials (never switch the socket's account);
 *   - no record and no session on this tab yet (an admin row, a server
 *     without R1)                                        → 'legacy': the
 *     pre-R1 re-auth path, exactly as before resume tokens existed.
 * Returns the kind now set.
 */
export function markTicketSignIn(userId, recordStored) {
  const id = idString(userId);
  if (!id) return null;
  const cur = _tabSession;
  if (cur && cur.userId === id && cur.kind === 'oidc') {
    if (recordStored) clearResumeRecord();
    return 'oidc';
  }
  if (recordStored) {
    setTabSession(VIA_TICKET, id);
    return VIA_TICKET;
  }
  if (cur && cur.userId !== id) {
    setTabSession(VIA_TICKET, id);
    return VIA_TICKET;
  }
  setTabSession('legacy', id);
  return 'legacy';
}

/** True when this tab's current sign-in is a ticket session for `userId`. */
export function isTicketSessionTab(userId) {
  const id = idString(userId);
  return !!(_tabSession && id && _tabSession.kind === VIA_TICKET && _tabSession.userId === id);
}

/**
 * Store the resume token a SUCCESSFUL ticket / waitlist / resume loginResult
 * carried, bound to the local user it was issued for.
 *   result         the loginResult frame
 *   keepIfMissing  true for a resumeSession answer: an answer without a fresh
 *                  token keeps the record it was resumed from
 *   expectUserId   the user the caller resumed / is signed in as; a token for
 *                  any other user is never stored
 * A failed result is ignored here (callers handle resume_invalid).
 *
 * Returns true only when, after the call, a usable record bound to the
 * result's user is stored (a fresh one, or — keepIfMissing — the one it was
 * resumed from). Callers mark the tab a TICKET session only then: a ticket tab
 * re-authenticates with its record and nothing else, so marking a tab that
 * has no record would leave every reconnect signed out (2026-10-09 review fix).
 */
export function saveTicketResume(result, { keepIfMissing = false, expectUserId = null } = {}) {
  if (!result || result.success !== true) return false;
  const dataUser = idString(result.userData && result.userData.id);
  const keptForUser = () => !!(keepIfMissing && dataUser && readResumeRecordForUser(dataUser));
  // D1 — never for an admin row (the server does not issue one; belt-and-braces).
  if (result.userData && result.userData.isAdmin) {
    clearResumeRecord();
    return false;
  }
  const token = typeof result.resumeToken === 'string' && result.resumeToken ? result.resumeToken : null;
  if (!token) {
    if (!keepIfMissing) clearResumeRecord();
    return keptForUser();
  }
  const claims = decodeJwtPayload(token);
  const claimUser = idString(claims && claims.localUserId);
  // Bind to the user the token names; refuse anything inconsistent.
  if (claimUser && dataUser && claimUser !== dataUser) return keptForUser();
  const userId = claimUser || dataUser;
  if (!userId) return keptForUser();
  const expected = idString(expectUserId);
  if (expected && expected !== userId) return keptForUser();

  const now = Date.now();
  let expiresAt = Date.parse(result.resumeExpiresAt);
  if (!Number.isFinite(expiresAt) && claims && Number.isFinite(Number(claims.exp))) {
    expiresAt = Number(claims.exp) * 1000;
  }
  if (!Number.isFinite(expiresAt)) expiresAt = now + MAX_LIFETIME_MS;
  expiresAt = Math.min(expiresAt, now + MAX_LIFETIME_MS);
  const origIat = claims ? Number(claims.orig_iat) : NaN;
  if (Number.isFinite(origIat) && origIat > 0) {
    expiresAt = Math.min(expiresAt, origIat * 1000 + ABSOLUTE_CAP_MS);
  }
  if (expiresAt - EXPIRY_SKEW_MS <= now) {
    if (!keepIfMissing) clearResumeRecord();
    return keptForUser();
  }

  const record = { token, expiresAt, via: VIA_TICKET, userId, savedAt: now };
  // Only when the claims are readable: an account (master) session or not.
  if (claims && Object.prototype.hasOwnProperty.call(claims, 'masterUserId')) {
    record.account = !!claims.masterUserId;
  }
  const { local, session } = stores();
  const keep = isKeepSignedIn();
  const stored = safeSet(keep ? local : session, RESUME_STORAGE_KEY, JSON.stringify(record));
  safeRemove(keep ? session : local, RESUME_STORAGE_KEY);
  // Read back through the same rules a reconnect uses (account:false records
  // are never presented), so "stored" means "a reconnect can use it".
  return stored && !!readResumeRecordForUser(userId);
}

/**
 * The stored resume record if it is still usable — `{ token, expiresAt, via,
 * userId, account? }` — else null. An expired, unreadable, unbound or
 * non-ticket record is removed (nothing else is ever presented).
 */
function readResumeRecord() {
  const { local, session } = stores();
  const raw = safeGet(local, RESUME_STORAGE_KEY) || safeGet(session, RESUME_STORAGE_KEY);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    if (!rec || typeof rec.token !== 'string' || !rec.token) throw new Error('bad record');
    if (rec.via !== VIA_TICKET) throw new Error('not a ticket session');
    if (!idString(rec.userId)) throw new Error('unbound');
    if (!(Number(rec.expiresAt) - EXPIRY_SKEW_MS > Date.now())) throw new Error('expired');
    if (rec.account === false) throw new Error('not an account session');
    return rec;
  } catch {
    clearResumeRecord();
    return null;
  }
}

/**
 * For a SIGNED-IN tab: the stored record only when it was issued for
 * `userId` (this tab's user). Never another account's record.
 */
export function readResumeRecordForUser(userId) {
  const id = idString(userId);
  if (!id) return null;
  const rec = readResumeRecord();
  if (!rec || idString(rec.userId) !== id) return null;
  return rec;
}

/**
 * For the BOOT path only (the tab is not signed in yet, so there is no user to
 * bind against): the device's stored ticket-session record, if any. Its
 * answer is then stored with expectUserId = rec.userId.
 */
export function readResumeRecordForBoot() {
  return readResumeRecord();
}
