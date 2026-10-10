/**
 * guestCarryOver — bring a retired guest account's chips + progress over to the
 * player's American Pub Poker account, ONCE, on the player's tap
 * (2026-10-09, owner "Fix all of it", contract R2).
 *
 * Guest play is off (2026-10-07). A former guest (a local .online account with
 * no master link — GuestNNNN, possibly renamed) must sign in with an account
 * to keep playing. The guest's only key is the legacy token the old guest flow
 * left in poker_auth_token; tokenStorage.setAuthToken sets it aside
 * (`poker_guest_claim`) when an account sign-in replaces it.
 *
 * Flow, after any successful account sign-in while such a token is set aside:
 *   1. peekGuestProgress {guestToken}  (read-only) → {success, chips, level,
 *      achievements(count)}. poker-server verifies the token and that it is an
 *      unclaimed guest that is not the caller's own row.
 *   2. Show ONE blue/gold prompt, in the LOBBY only (never over a live
 *      table): "Bring over your guest progress? (N chips, level L)" — Yes /
 *      Not now, plus a smaller "Don't bring it over". Nothing is ever claimed
 *      without the Yes tap.
 *   3. Yes → claimGuestProgress {guestToken} → claimGuestProgressResult
 *      {success, chipsAdded, starsAdded, levelAfter} | {success:false, code}.
 *      The server does the carry-over (additive chips with an audit log,
 *      ratcheted xp/level, achievements union) and retires the guest row; one
 *      claim per guest row, enforced atomically server-side.
 *   4. "Not now" only hides the prompt: the token is KEPT and the offer comes
 *      back on the next page load / sign-in — of THAT account only (T7): the
 *      token is bound to the account that put it off, and no other account
 *      signing in on this device is offered it. Throwing the key away takes an
 *      explicit "Don't bring it over" AND a confirmation ("Yes, leave it
 *      behind") — the guest token is the only key to those chips, so one
 *      mis-tap must never lose them. A success or a definitive refusal
 *      (invalid_guest_token, not_a_guest, already_claimed, same_account) also
 *      forgets the token. already_claimed_by_account (this ACCOUNT already
 *      received its one carry-over) is final for this account — no offer, no
 *      retry — but KEEPS the token (T5, CONTRACTS.md C5: the server never
 *      consumes it on that refusal, and the guest may still go to a different
 *      account). A transport failure (no answer) or not_signed_in keeps it,
 *      so a "Yes" that never reached the server is not lost. Sign-out: the
 *      player's own Sign Out of an account forgets it when it is unbound or
 *      bound to THAT account (the next person on the device is never offered
 *      it) — never a token bound to another account, which stays for that
 *      account (U6); a silent teardown — session expired, peer-tab sign-out —
 *      keeps it, with its binding (gameStore.logout / tearDownSession,
 *      tokenStorage.clearStashedGuestCredentialOnSignOut).
 *
 * The server may answer either with a socket.io acknowledgement or on the
 * `<event>Result` event; the first answer wins. If peek gets no answer at all
 * (server without the handler), nothing is shown and the token is kept for a
 * later sign-in.
 */
import { create } from 'zustand';
import {
  getAuthToken, isLegacyLocalToken, getStashedGuestCredential, clearStashedGuestCredential,
  getStashedGuestDeferredBy, deferGuestCredentialFor,
} from './tokenStorage';
import { getSocket } from './socketService';
import { newRequestId } from './socketAuth';
import { awaitCurrentReauth } from './socketReauth';
import { GAME_SERVER_UNREACHABLE_TEXT } from './playRefusal';
import { useGameStore } from '../store/gameStore';

export const PEEK_EVENT = 'peekGuestProgress';
export const CLAIM_EVENT = 'claimGuestProgress';
// The server's result events (contract R2), spelled out so the shared names
// are greppable in the bundle (canonical-features.txt locks them).
export const PEEK_RESULT_EVENT = 'peekGuestProgressResult';
export const CLAIM_RESULT_EVENT = 'claimGuestProgressResult';

const PEEK_TIMEOUT_MS = 10_000;
const CLAIM_TIMEOUT_MS = 20_000;
const NOT_SIGNED_IN_RETRY_MS = 4_000;
const REAUTH_WAIT_CAP_MS = 20_000;

// Server answers that settle the question for good: forget the guest token.
const FORGET_TOKEN = new Set([
  'invalid_guest_token', 'not_a_guest', 'already_claimed', 'same_account',
]);
// already_claimed_by_account (2026-10-09, contract C5 R2): at most ONE guest
// carry-over per American Pub Poker account — THIS account already brought
// one over, so this guest can never be claimed into it. Final for this
// account (no offer, no retry), but NOT for the guest token (T5): the server
// never consumes it on this refusal, so it is KEPT — a different account
// signing in on this device may still carry it over.
export const ACCOUNT_ALREADY_CARRIED = 'already_claimed_by_account';
const DEFINITIVE = new Set([...FORGET_TOKEN, ACCOUNT_ALREADY_CARRIED]);

// invalid_guest_token never means "expired": the server accepts a correctly
// signed guest token however old (contract R2). It means the token could not
// be verified (bad signature / rotated key), no longer matches the row
// (token_version), or the guest row is banned or gone.
const DEFINITIVE_TEXT = {
  invalid_guest_token: "We couldn't verify that guest session, so its progress can't be brought over.",
  not_a_guest: "That earlier session isn't a guest account, so there's nothing to bring over.",
  already_claimed: 'That guest progress has already been brought over.',
  same_account: 'That progress is already on this account.',
  already_claimed_by_account: 'Your account has already brought over guest progress once — only one guest account can be carried over per account.',
};

/**
 * UI state for <GuestCarryOverPrompt/>.
 *   phase  'idle' (nothing shown) | 'offer' | 'confirmDecline' | 'claiming' |
 *          'done' | 'error'
 *   offer  { chips, level, achievements, stars } from peek (numbers or null)
 * (While a live-table overlay is open over the lobby the prompt waits — see
 * store/liveTableOverlayStore.js.)
 */
export const useGuestCarryStore = create((set) => ({
  phase: 'idle',
  offer: null,
  message: null,
  retryable: false,
  _set: (patch) => set(patch),
}));

function setUi(patch) {
  try { useGuestCarryStore.getState()._set(patch); } catch { /* ignore */ }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function achievementsCount(r) {
  if (!r) return null;
  if (Array.isArray(r.achievements)) return r.achievements.length;
  return num(r.achievements ?? r.achievementsCount ?? r.achievementCount);
}

/**
 * Emit `event` and resolve the first answer — the acknowledgement or a
 * `resultEvent` frame (ignoring frames that echo someone else's requestId).
 * Never rejects; transport problems resolve `{success:false, code}`.
 */
function askServer(event, payload, resultEvent, timeoutMs, label) {
  return new Promise((resolve) => {
    const socket = getSocket();
    if (!socket || !socket.connected) {
      resolve({ success: false, code: 'not_connected' });
      return;
    }
    const requestId = newRequestId(label);
    let settled = false;
    let timer = null;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { socket.off(resultEvent, onEvent); } catch { /* ignore */ }
      try { socket.off('disconnect', onDisconnect); } catch { /* ignore */ }
      resolve(r && typeof r === 'object' ? r : { success: false, code: 'empty_result' });
    };
    function onEvent(r) {
      if (r && r.requestId && r.requestId !== requestId) return;
      finish(r);
    }
    function onDisconnect() { finish({ success: false, code: 'disconnected' }); }
    socket.on(resultEvent, onEvent);
    socket.on('disconnect', onDisconnect);
    timer = setTimeout(() => finish({ success: false, code: 'timeout' }), timeoutMs);
    try {
      socket.emit(event, { ...payload, requestId }, (ack) => { if (ack !== undefined) finish(ack); });
    } catch {
      finish({ success: false, code: 'emit_failed' });
    }
  });
}

let _inFlight = false;
// `${localUserId}|${token tail}` already decided on this page — one peek per
// account per guest token per page load.
let _decidedKey = null;
// `${localUserId}|${token tail}` already logged as "bound to another account".
let _boundElsewhereLogged = null;
// The token the current offer is about (the stash could change underneath).
let _offerToken = null;

async function waitForSocketReauth() {
  let timer = null;
  try {
    await Promise.race([
      awaitCurrentReauth().catch(() => null),
      new Promise((resolve) => { timer = setTimeout(resolve, REAUTH_WAIT_CAP_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Call after any successful sign-in / reconnect. Offers the carry-over when
 * this device still holds a set-aside guest token and the tab is signed in
 * with an ACCOUNT (not the legacy guest session itself). Cheap no-op otherwise.
 */
export async function maybeOfferGuestCarryOver({ attempt = 0 } = {}) {
  const guestToken = getStashedGuestCredential();
  if (!guestToken) return;
  const st = useGameStore.getState();
  if (!st.isLoggedIn) return;
  // Signed in with the legacy token itself = still the guest session.
  if (isLegacyLocalToken(getAuthToken())) return;
  if (useGuestCarryStore.getState().phase !== 'idle') return;
  const key = `${st.userId}|${guestToken.slice(-24)}`;
  // T7 — put off with "Not now" by ANOTHER account: offered again only to
  // that account (kept untouched for it; its explicit Sign Out forgets it).
  const deferredBy = getStashedGuestDeferredBy();
  if (deferredBy && deferredBy !== String(st.userId)) {
    if (_boundElsewhereLogged !== key) {
      _boundElsewhereLogged = key;
      try { console.warn('[guest-carry] deferred by another account on this device — not offered here'); } catch { /* ignore */ }
    }
    return;
  }
  if (_inFlight || (attempt === 0 && _decidedKey === key)) return;

  _inFlight = true;
  try {
    // A reconnect re-auth may be running: peek on a signed-in socket.
    await waitForSocketReauth();
    const r = await askServer(PEEK_EVENT, { guestToken }, PEEK_RESULT_EVENT, PEEK_TIMEOUT_MS, 'gpeek');
    // Signed out / switched account / answered elsewhere while we waited.
    const now = useGameStore.getState();
    if (!now.isLoggedIn || `${now.userId}|${guestToken.slice(-24)}` !== key) return;

    if (r?.success) {
      _decidedKey = key;
      _offerToken = guestToken;
      setUi({
        phase: 'offer',
        message: null,
        retryable: false,
        offer: {
          chips: num(r.chips),
          level: num(r.level),
          achievements: achievementsCount(r),
          stars: num(r.stars),
        },
      });
      try { console.warn('[guest-carry] offering guest progress carry-over'); } catch { /* ignore */ }
      return;
    }
    const code = typeof r?.code === 'string' ? r.code : '';
    if (DEFINITIVE.has(code)) {
      _decidedKey = key;
      if (FORGET_TOKEN.has(code)) {
        clearStashedGuestCredential();
        try { console.warn('[guest-carry] nothing to offer:', code); } catch { /* ignore */ }
      } else {
        // T5 — not definitive for the token: keep it, show nothing.
        try { console.warn('[guest-carry] nothing to offer to this account — guest key kept on this device:', code); } catch { /* ignore */ }
      }
      return;
    }
    if (code === 'not_signed_in' && attempt === 0) {
      setTimeout(() => { maybeOfferGuestCarryOver({ attempt: 1 }).catch(() => {}); }, NOT_SIGNED_IN_RETRY_MS);
      return;
    }
    if (code === 'not_connected') return; // retried when the socket connects
    // No answer / unknown answer: keep the token for a later sign-in, don't
    // ask again on this page.
    _decidedKey = key;
    try { console.warn('[guest-carry] peek unanswered — kept for a later sign-in:', code || 'unlabelled'); } catch { /* ignore */ }
  } finally {
    _inFlight = false;
  }
}

/** "Yes" — claim the guest progress into the signed-in account. */
export async function acceptGuestCarryOver() {
  const ui = useGuestCarryStore.getState();
  if (ui.phase === 'claiming') return; // double tap
  const guestToken = _offerToken || getStashedGuestCredential();
  if (!guestToken) {
    setUi({ phase: 'idle', offer: null, message: null, retryable: false });
    return;
  }
  setUi({ phase: 'claiming', message: null, retryable: false });
  const r = await askServer(CLAIM_EVENT, { guestToken }, CLAIM_RESULT_EVENT, CLAIM_TIMEOUT_MS, 'gclaim');

  if (r?.success) {
    clearStashedGuestCredential();
    _offerToken = null;
    const chips = num(r.chipsAdded);
    const stars = num(r.starsAdded);
    const level = num(r.levelAfter);
    const parts = [];
    parts.push(chips != null ? `Done — ${chips.toLocaleString()} chips added to your account.` : 'Done — your guest progress is on your account.');
    if (stars != null && stars > 0) parts.push(`${stars.toLocaleString()} stars too.`);
    if (level != null) parts.push(`You're level ${level}.`);
    setUi({ phase: 'done', message: parts.join(' '), retryable: false });
    try { console.warn('[guest-carry] guest progress claimed'); } catch { /* ignore */ }
    // Ask for a fresh playerProgress push so the wallet / level shown here
    // update now (read-only request; the server owns the numbers).
    try { const s = getSocket(); if (s && s.connected) s.emit('getProgress'); } catch { /* ignore */ }
    return;
  }

  const code = typeof r?.code === 'string' ? r.code : '';
  if (DEFINITIVE.has(code)) {
    // already_claimed_by_account keeps the token (T5 / C5 — not consumed).
    if (FORGET_TOKEN.has(code)) clearStashedGuestCredential();
    _offerToken = null;
    setUi({ phase: 'error', message: DEFINITIVE_TEXT[code], retryable: false });
    try { console.warn('[guest-carry] claim refused:', code); } catch { /* ignore */ }
    return;
  }
  // No answer, signed-out socket, or a server fault: the claim may never have
  // happened, so keep the token and let the player try again.
  const serverText = typeof r?.error === 'string' && r.error.trim() ? r.error.trim().slice(0, 200) : null;
  const message = code === 'not_signed_in'
    ? 'Your sign-in has not reached the game server yet. Please try again in a moment.'
    : (['timeout', 'not_connected', 'disconnected', 'emit_failed', 'empty_result'].includes(code) || !serverText
      ? GAME_SERVER_UNREACHABLE_TEXT
      : serverText);
  setUi({ phase: 'error', message, retryable: true });
  try { console.warn('[guest-carry] claim not completed:', code || 'unlabelled'); } catch { /* ignore */ }
}

/**
 * "Not now" — hide the offer and KEEP the guest token: it is offered again on
 * the next page load / sign-in (not again on this page) — to THIS account only
 * (T7: the token is bound to the account that put it off). Also closes a
 * result ("OK"), or puts a retryable failure off ("Not now", bound the same
 * way).
 */
export function postponeGuestCarryOver() {
  const ui = useGuestCarryStore.getState();
  const deferring = ui.phase === 'offer' || (ui.phase === 'error' && ui.retryable);
  const token = _offerToken;
  setUi({ phase: 'idle', offer: null, message: null, retryable: false });
  if (deferring) {
    let bound = false;
    try { bound = deferGuestCredentialFor(useGameStore.getState().userId, token); } catch { /* keep it unbound */ }
    try { console.warn(`[guest-carry] not now — kept for next time${bound ? ' (this account only)' : ''}`); } catch { /* ignore */ }
  }
}
// Back-compat name (closing a result / retryable failure).
export const dismissGuestCarryOver = postponeGuestCarryOver;

/** "Don't bring it over" — ask for confirmation first; nothing is forgotten yet. */
export function askDeclineGuestCarryOver() {
  if (useGuestCarryStore.getState().phase !== 'offer') return;
  setUi({ phase: 'confirmDecline' });
}

/** "Go back" from the confirmation — the offer again, unchanged. */
export function cancelDeclineGuestCarryOver() {
  if (useGuestCarryStore.getState().phase !== 'confirmDecline') return;
  setUi({ phase: 'offer' });
}

/**
 * "Yes, leave it behind" — the CONFIRMED decline: forget the guest token on
 * this device for good (the guest row itself stays untouched server-side).
 */
export function confirmDeclineGuestCarryOver() {
  if (useGuestCarryStore.getState().phase !== 'confirmDecline') return;
  clearStashedGuestCredential();
  _offerToken = null;
  setUi({ phase: 'idle', offer: null, message: null, retryable: false });
  try { console.warn('[guest-carry] declined (confirmed)'); } catch { /* ignore */ }
}

/** Sign-out: hide anything showing (the stash itself is handled by logout). */
export function resetGuestCarryOver() {
  _offerToken = null;
  _decidedKey = null;
  _boundElsewhereLogged = null;
  setUi({ phase: 'idle', offer: null, message: null, retryable: false });
}
