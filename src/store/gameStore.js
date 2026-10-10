import { create } from 'zustand';
import { getSocket, disconnect as disconnectSocket } from '../services/socketService';
import { clearAllProgressionStorage, resetSyncState } from '../services/persistenceService';
import {
  getAuthToken, isGuestLegacyToken, stashGuestCredential, clearStashedGuestCredentialOnSignOut,
  oidcSubject, getStoredOidcAccount, getOAuthItem, getDeviceOAuthItem,
  isTabScopedSignIn, tabScopedMasterUserId, dropThisTabsOwnSignIn, endTabScopedSignIn,
} from '../services/tokenStorage';
import { resetTournamentSeat } from './tournamentSeatStore';
import { clearResumeRecord, resetTabSession, getTabSession } from '../services/sessionResume';
import {
  TICKET_TAB_SIGN_OUT_EVENT, LOGOUT_MARKER_KEY, logoutMarkerValue,
  requestSignInCensus, censusFindsOtherAccount,
} from '../services/crossTabSignOut';

const AVATAR_STORAGE_KEY = 'poker_avatar';

// 2026-10-09 (D1, review fix) — the explicit Sign Out tells poker-server FIRST
// and waits for its acknowledgement, at most this long, before the socket
// cycles. Without the wait the frame and the transport close arrive together:
// socket.io dispatches the event a tick after the packet, so the close usually
// won and the server never revoked anything.
export const LOGOUT_ACK_TIMEOUT_MS = 2000;
// 2026-10-09 (T2, rollback safety) — the sign-out revocation event. NOT the
// socket 'logout' event: poker-server up to 5ea0f80 (live until the S1 server
// ships, and again after any Railway rollback past it) handles 'logout' by
// deleting the socket's auth session BEFORE the disconnect, and that
// disconnect then stands a seated player up WITHOUT crediting his stack. A
// server that does not know 'revokeSignInTokens' simply ignores it (no ack →
// the sign-out proceeds after LOGOUT_ACK_TIMEOUT_MS, exactly like the live
// client, which never emits anything), so no deploy or rollback order can
// lose chips. This client must never emit 'logout' — enforced on every socket
// by socketService.guardNeverEmittedEvents (U7, lock token in the manifest).
export const REVOKE_SIGN_IN_TOKENS_EVENT = 'revokeSignInTokens';
// The explicit Sign Out waiting on that acknowledgement (a double tap joins it).
let _serverSignOut = null;

/**
 * Socket `revokeSignInTokens` WITH an acknowledgement and no payload
 * (CONTRACTS.md C5): poker-server bumps this account's users.token_version —
 * revoking its "Play Online" resume token and legacy tokens everywhere — and
 * answers `{ success, revoked? | code? }`. It never touches the server-side
 * session or the seat; the 'disconnect' that follows does that through its
 * normal reserve / cash-out path. Resolves (never rejects) with 'confirmed' |
 * 'refused' | 'timeout' | 'disconnected' | 'emit_failed'; the sign-out goes
 * ahead whatever the outcome.
 */
function requestServerSignOut(sock) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try { sock.off('disconnect', onDisconnect); } catch { /* ignore */ }
      resolve(outcome);
    };
    function onDisconnect() { finish('disconnected'); }
    try { sock.on('disconnect', onDisconnect); } catch { /* ignore */ }
    timer = setTimeout(() => finish('timeout'), LOGOUT_ACK_TIMEOUT_MS);
    try {
      sock.emit(REVOKE_SIGN_IN_TOKENS_EVENT, (ack) => finish(ack && ack.success === true ? 'confirmed' : 'refused'));
    } catch {
      finish('emit_failed');
    }
  }).then((outcome) => {
    // Log tag locked in canonical-features.txt (kept from the first S2 build).
    try { console.warn('[sign-out] game server logout ack:', outcome, `(${REVOKE_SIGN_IN_TOKENS_EVENT})`); } catch { /* ignore */ }
    return outcome;
  });
}

// Debounced persistence sweep: sync avatar customization to server (400ms quiet).
// The `photo` data URL is STRIPPED before emit — a table-wide seat photo must go
// through the MODERATED master-API pipeline (AvatarCustomizer → POST
// /avatars/upload → Cloud Vision SafeSearch → admin approval), never the
// unmoderated socket path. Approved photos render at the seat via avatarService
// (GET /avatars/display/:id). Fail-closed: unmoderated photo never broadcasts.
// GAP: needs server — poker-server's updateAvatar handler should also strip any
// `photo` field from persistCustomization so an out-of-date client can't inject
// an unmoderated image; stripping here closes the current client's path.
let _avatarSyncTimer = null;
function scheduleAvatarSync(avatar) {
  if (_avatarSyncTimer) clearTimeout(_avatarSyncTimer);
  _avatarSyncTimer = setTimeout(() => {
    _avatarSyncTimer = null;
    const socket = getSocket();
    if (socket && socket.connected) {
      const { photo: _strippedPhoto, ...avatarNoPhoto } = avatar || {};
      socket.emit('updateAvatar', avatarNoPhoto);
    }
  }, 400);
}

function loadSavedAvatar(defaults) {
  try {
    const raw = sessionStorage.getItem(AVATAR_STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    // Merge with defaults so any new fields are included
    return { ...defaults, ...parsed, faceShape: { ...defaults.faceShape, ...(parsed.faceShape || {}) } };
  } catch {
    return { ...defaults };
  }
}

const DEFAULT_AVATAR = {
  bodyType: 'male',
  skinTone: '#C68642',
  hairStyle: 'short',
  hairColor: '#2C1B0E',
  eyeColor: '#4A90D9',
  topStyle: 'tshirt',
  topColor: '#0c1a44',
  bottomStyle: 'jeans',
  bottomColor: '#2D3A4A',
  accessory: 'none',
  faceShape: {
    jawWidth: 0.5,
    noseLength: 0.5,
    cheekHeight: 0.5,
    browHeight: 0.5,
    lipFullness: 0.5,
    eyeSize: 0.5,
  },
};

export const SEAT_COUNT = 9;

/**
 * F5 (2026-10-10) — a "Play Online" TICKET tab never carries ANOTHER
 * account's OIDC session in its store. On a shared browser the boot's
 * refresh-token sign-in (account B) can answer before the Play Online ticket
 * (account A) does; the ticket then signs the tab in as A, and `login` leaves
 * B's OIDC tokens in the store (and authScheduler kept writing B's refreshed
 * tokens into it). Called right after a ticket / resume sign-in: when this
 * tab is a ticket session and the store's OIDC tokens are not provably its
 * own account's, they are dropped from the STORE only — the device's stored
 * sign-in is left alone (B's other tabs keep working; U5). Returns true when
 * something was dropped.
 */
export function clearOtherAccountOidcFromTicketTab() {
  let tab = null;
  try { tab = getTabSession(); } catch { tab = null; }
  if (!tab || tab.kind !== 'ticket') return false;
  const st = useGameStore.getState();
  if (!(st.oauthAccessToken || st.oauthRefreshToken || st.oauthIdToken || st.oauthTokenExpiry)) return false;
  const held = oidcSubject(st.oauthIdToken) || oidcSubject(st.oauthAccessToken);
  if (tab.masterUserId && held === tab.masterUserId) return false;
  useGameStore.setState({
    oauthAccessToken: null,
    oauthRefreshToken: null,
    oauthIdToken: null,
    oauthTokenExpiry: null,
  });
  try { console.warn('[session-resume] Play Online tab dropped another account\'s sign-in from its session state'); } catch { /* ignore */ }
  return true;
}

/**
 * P7 (2026-10-10) — true when THIS tab is a "Play Online" TICKET tab and the
 * browser's stored OIDC sign-in (any of its keys) belongs to ANOTHER account,
 * or to one that cannot be proven to be this tab's (resume-token master id vs
 * the stored tokens' OIDC `sub`). That sign-in is not this tab's to end: on a
 * shared browser it is the other player's. Decided before anything is
 * cleared. False for every non-ticket tab, for a ticket tab on a browser with
 * no stored OIDC sign-in, and for one whose stored sign-in is its own account
 * (that Sign Out still signs the account out everywhere, as before).
 *
 * 2026-10-10 — also true when the Sign Out's sign-in census (`census`,
 * crossTabSignOut.requestSignInCensus) found ANOTHER account signed in on
 * this browser's sign-in in another open tab: with "keep me signed in" off
 * that sign-in lives only in its own tab's sessionStorage, invisible here,
 * and /session/end (or a 'logout' it follows) would sign it out.
 */
function ticketTabLeavesDeviceSignIn(census, myUserId) {
  // S3 (2026-10-10) — a TAB-SCOPED sign-in (a bridged link kept to this tab
  // because the browser holds another account's sign-in) never ran on the
  // browser's stored sign-in: its Sign Out leaves that alone — re-checked at
  // every Sign Out (round 2): if the browser's stored sign-in has since
  // become THIS tab's own account (the other one signed out, this one signed
  // in normally elsewhere), it is a full Sign Out like any other (stored keys,
  // marker, 'logout', /session/end) — the same rule as a ticket tab's.
  if (isTabScopedSignIn()) {
    try {
      const mine = tabScopedMasterUserId();
      const dev = getStoredOidcAccount();
      if (mine && dev.masterUserId === mine) {
        try { console.warn('[sign-out] tab-scoped sign-in: the browser\'s stored sign-in is now this same account — full sign-out'); } catch { /* ignore */ }
        return false;
      }
    } catch { /* cannot tell: leave it alone */ }
    return true;
  }
  let tab = null;
  try { tab = getTabSession(); } catch { tab = null; }
  if (!tab || tab.kind !== 'ticket') return false;
  try {
    const dev = getStoredOidcAccount();
    const holdsOidc = dev.signedIn || !!dev.masterUserId
      || !!getDeviceOAuthItem('poker_oauth_id_token') || !!getDeviceOAuthItem('poker_oauth_access');
    if (!holdsOidc) {
      if (censusFindsOtherAccount(census, myUserId)) {
        try { console.warn('[sign-out] another account is signed in on this browser in another tab (keep me signed in off) — left alone'); } catch { /* ignore */ }
        return true;
      }
      return false;
    }
    return !(tab.masterUserId && dev.masterUserId === tab.masterUserId);
  } catch {
    // Cannot tell whose it is: it is not provably this tab's — leave it.
    return true;
  }
}

// 2026-10-10 — the "remove only THIS tab's own credentials" rule used by a
// Sign Out that leaves the browser's other sign-in alone moved to
// tokenStorage.dropThisTabsOwnSignIn (main.jsx's cross-tab follower uses it
// too). Since this round it also matches the tab's own Play Online ticket by
// its shape after a reload (the store's authToken is then null) and removes a
// tab-scoped sign-in's copies (S3).

/**
 * The local sign-out teardown — tokens, profile caches, store state, the
 * socket cycle and (unless `skipRedirect`) the global-logout redirect. Called
 * by gameStore.logout: at once for the silent teardowns (skipRedirect), and
 * for the explicit Sign Out only AFTER poker-server acknowledged the socket
 * 'revokeSignInTokens' (or LOGOUT_ACK_TIMEOUT_MS passed).
 *
 * P7 (2026-10-10) — a "Play Online" TICKET tab on a browser whose stored
 * sign-in is ANOTHER (or an unprovable) account's ends only ITS OWN session:
 * the browser's stored keys are left alone, no logout marker is written, the
 * peer tabs hear TICKET_TAB_SIGN_OUT_EVENT (followed only by tabs of this same
 * account) instead of 'logout', and there is no /session/end redirect — the
 * auth-server resolves that logout from its SSO cookie, which on such a
 * browser is the other account's, and would sign THAT account out
 * everywhere. The tab's own server-side credentials are still revoked first
 * (the explicit Sign Out's 'revokeSignInTokens'), its resume record and tab
 * marker are forgotten, its store is cleared and its socket cycled (seat →
 * the server's reserve / cash-out path), exactly as before.
 */
function tearDownSession(set, get, skipRedirect, census = null) {
  const idToken = get().oauthIdToken;
  const previousUserId = get().userId;
  const ownCredential = get().authToken;
  let ownMasterUserId = null;
  try { ownMasterUserId = getTabSession()?.masterUserId || tabScopedMasterUserId() || null; } catch { ownMasterUserId = null; }
  // S3 — decided (and the tab's own refresh token read) BEFORE anything is
  // cleared: a tab-scoped sign-in's Sign Out revokes its own grant below.
  const tabScoped = isTabScopedSignIn();
  let ownRefreshToken = null;
  if (tabScoped) { try { ownRefreshToken = get().oauthRefreshToken || getOAuthItem('poker_oauth_refresh') || null; } catch { ownRefreshToken = null; } }
  const leaveDeviceSignIn = ticketTabLeavesDeviceSignIn(census, previousUserId);
  // 2026-05-05 Phase 3 — broadcast logout to other same-origin tabs
  // BEFORE clearing local state, so peer tabs tear down their UI
  // synchronously (no race window where they could read stale state).
  try {
    // Lazy require to avoid hoisting cycles with auth modules.
    const mod = require('../services/authBroadcast');
    if (mod && typeof mod.broadcastAuth === 'function') {
      mod.broadcastAuth({
        type: leaveDeviceSignIn ? TICKET_TAB_SIGN_OUT_EVENT : 'logout',
        userId: previousUserId,
      });
    }
  } catch {}
  // 2026-10-09 — guest carry-over (services/guestCarryOver.js). Decided
  // BEFORE the wipe below, while the keep-signed-in flag still says where the
  // player keeps credentials:
  //  - signing out of a legacy GUEST session (guest play is retired): its
  //    token is the only key to that guest's chips + progress, and the guest
  //    can never sign back into it (random password). Set it aside so the
  //    American Pub Poker account they sign in with next can be offered the
  //    carry-over (one tap, server-verified, once).
  //  - the player's own Sign Out of an ACCOUNT (OIDC, ticket, or a pre-OIDC
  //    phone/password account's legacy token — same token shape as a guest's,
  //    told apart by its non-GuestNNNN username claim): forget a set-aside
  //    guest token that is unbound or bound to THIS account, so the next
  //    person to sign in on this device is never offered it. A token bound to
  //    ANOTHER account (that account's "Not now") is kept for it (T7 / U6:
  //    tokenStorage.clearStashedGuestCredentialOnSignOut) — it is never
  //    offered to anyone else, and only that account's own Sign Out forgets it.
  //  - a SILENT teardown (skipRedirect: session expired, peer-tab sign-out)
  //    keeps it: the player may have put the offer off with "Not now", which
  //    promises it comes back on the next sign-in (2026-10-09 review fix) —
  //    and only to the account that put it off (T7: tokenStorage
  //    deferGuestCredentialFor / guestCarryOver), never to whoever is next.
  try {
    const current = getAuthToken();
    if (isGuestLegacyToken(current)) stashGuestCredential(current);
    else if (!skipRedirect) clearStashedGuestCredentialOnSignOut(previousUserId);
  } catch { /* never block logout */ }
  // Auth tokens — explicit logout wipes BOTH stores (localStorage +
  // sessionStorage) so "Keep me signed in" state from a prior tab
  // can't resurrect the session on the next page load.
  // 2026-10-09 — includes the resumable game-server session
  // (services/sessionResume.js, `poker_online_resume`; since F5 2026-10-10
  // this tab's sessionStorage copy, plus any device-wide one an older bundle
  // left).
  // P7 — not from a ticket tab whose browser sign-in is another account's:
  // those keys are that account's sign-in (and removing poker_auth_token /
  // poker_oauth_refresh from localStorage would also fire the storage events
  // that sign its tabs out).
  if (leaveDeviceSignIn) {
    // ...but this tab's OWN credentials still go (its Play Online ticket, its
    // tab-scoped copies) — tokenStorage.dropThisTabsOwnSignIn.
    const removed = dropThisTabsOwnSignIn({
      ownCredentials: [ownCredential, get().oauthAccessToken, get().oauthRefreshToken],
      ownMasterUserId,
    });
    try { console.warn('[sign-out] Play Online tab signed out; this browser\'s other sign-in was left alone', { removedOwn: removed }); } catch { /* ignore */ }
    // S3 — the explicit Sign Out of a tab-scoped sign-in ends its own grant at
    // the auth-server (no /session/end follows: that would end the SSO
    // cookie's account — on this browser, the other one).
    if (tabScoped && !skipRedirect && ownRefreshToken) {
      import('../services/authService').then(({ revokeTabScopedRefreshToken }) => revokeTabScopedRefreshToken(ownRefreshToken)).catch(() => {});
    }
  } else {
    for (const k of ['poker_auth_token','poker_keep_signed_in','poker_oauth_access','poker_oauth_refresh','poker_oauth_id_token','poker_token_expiry']) {
      try { localStorage.removeItem(k); } catch {}
      try { sessionStorage.removeItem(k); } catch {}
    }
    // Round 2 — a tab-scoped tab whose stored sign-in became its own account
    // (ticketTabLeavesDeviceSignIn re-check): the full sign-out also ends the
    // tab-scoped marker.
    if (tabScoped) { try { endTabScopedSignIn('sign_out_full'); } catch { /* ignore */ } }
  }
  try { clearResumeRecord(); resetTabSession(); } catch { /* never block logout */ }
  // 2026-07-02 OAuth audit (Finding #6) — always emit a cross-tab logout
  // marker via localStorage, even for session-only logins (whose token keys
  // live in sessionStorage and fire no cross-tab `storage` event). Peer tabs
  // on browsers without BroadcastChannel rely on this. No token material.
  // 2026-10-10 (P7) — the marker names the account that signed out (a
  // "Play Online" ticket tab follows only its own account's), and is not
  // written for a ticket tab's sign-out that left the browser's sign-in alone
  // (every tab that reads the marker would sign that other account out).
  if (!leaveDeviceSignIn) {
    try { localStorage.setItem(LOGOUT_MARKER_KEY, logoutMarkerValue(previousUserId)); } catch {}
  }
  // Identity / player profile — previously leaked across account switches
  // (next user would temporarily see the previous user's username, avatar,
  // and cached stats until the server response overwrote them).
  sessionStorage.removeItem('poker_username');
  sessionStorage.removeItem('poker_avatar');
  sessionStorage.removeItem('poker_player_stats');
  sessionStorage.removeItem('poker_remember_phone');
  // Cached progression state — stars, streak, battle pass, etc.
  // `app_bp_premium` is in CLIENT_KEYS (cleared by the helper below);
  // `app_poker_login_rewards` is not server-synced, clear it here.
  sessionStorage.removeItem('app_poker_login_rewards');
  // Ephemeral UI caches
  sessionStorage.removeItem('poker_hand_history');
  // 2026-04-22 audit — shared-device progression leak.
  // Wipe every progression-cache key (career, missions, BP, notes,
  // settings, bet sizes, autoRebuy, runItTwice, autoDeal, sfxVol) +
  // the cached progressStore snapshot. Single source of truth for
  // the key list lives in persistenceService.js (CLIENT_KEYS +
  // EXTRA_PROGRESSION_KEYS) so we don't drift.
  clearAllProgressionStorage();
  // Zero the sync dedupe hash so the next account's first flush isn't
  // silently skipped because its clientData happens to hash identically.
  resetSyncState();
  set({
    isLoggedIn: false,
    userId: null,
    authToken: null,
    oauthAccessToken: null,
    oauthRefreshToken: null,
    oauthIdToken: null,
    oauthTokenExpiry: null,
    playerName: '',
    chips: 50000, // placeholder on logout; real balance comes from server on next login (matches server DEFAULT_CHIPS)
    screen: 'login',
    // Pattern B fields — reset so logout doesn't leak roles/VIP into
    // the next user's session on the same tab.
    userRoles: [],
    isVip: false,
    vipLevel: null,
    vipExpiration: null,
    signingOut: false,
    // 2026-10-10 — this sign-out left the browser's OTHER sign-in alone: a
    // later revoked refresh of THAT sign-in (main.jsx 'poker:session-expired')
    // is not this signed-out player's session ending, so no "Your session
    // ended" notice is shown for it. Cleared by the next sign-in.
    deviceSignInLeftAlone: !!leaveDeviceSignIn,
  });
  // S2 (2026-10-10) — the signed-out account's tournament seat memory (lobby
  // "Return to tournament") never carries over to whoever signs in next.
  try { resetTournamentSeat(); } catch { /* never block logout */ }
  // 2026-07-06 P2 auth fix — kill the authenticated SOCKET session too.
  // Pre-fix, logout wiped tokens and flipped screen→'login' but never
  // touched the socket: the server-side authSession (keyed by socket.id)
  // stayed live, so after a revoked-refresh teardown the seat + session
  // kept running invisibly, and a DIFFERENT user logging in on the same
  // tab reused that socket (shared-device account-takeover adjacent).
  // socketService.disconnect() cycles the connection: the server's
  // 'disconnect' handler runs its existing reserved-seat flow (seat held
  // ~10 min, at-table stack cashed out additively on expiry — verified it
  // never writes wallet chips, poker-server index.ts ~10386), and the
  // fresh reconnect handshakes unauthenticated (token storage already
  // cleared above). Called AFTER the local state teardown so no further
  // emits ride the dying socket.
  // 2026-10-09 (D1 / T2) — on the explicit Sign Out the socket
  // 'revokeSignInTokens' was already sent AND acknowledged (or timed out)
  // before this teardown ran (gameStore.logout / requestServerSignOut);
  // nothing is emitted here. That event only revokes tokens and leaves the
  // session to this disconnect, so the seat still goes through the reserve /
  // cash-out path above. (The socket 'logout' event is never sent — see
  // REVOKE_SIGN_IN_TOKENS_EVENT.)
  try { disconnectSocket(); } catch { /* never block logout */ }
  // SSO logout: redirect to /session/end to clear the SSO cookie AND perform
  // GLOBAL logout (destroy all grants + stamp force_logout_at). 2026-07-02
  // Finding #4 — this now fires even when oauthIdToken is null (legacy JWT,
  // deep-link ticket / waitlist login, or an oauthLogin response lacking
  // id_token): /session/end resolves the account from the SSO cookie, so
  // global logout works with id_token_hint only as an optimization
  // (authService.js:654 guards it). PRE-FIX the `if (idToken)` gate left the
  // user's other devices/sites logged in for those sessions. Suppressed only
  // for the silent teardown paths via skipRedirect.
  // 2026-10-10 (P7) — and for a ticket tab that left the browser's other
  // sign-in alone: /session/end would end the SSO cookie's account, which on
  // that browser is the OTHER account (see ticketTabLeavesDeviceSignIn).
  if (!skipRedirect && !leaveDeviceSignIn) {
    import('../services/authService').then(({ startLogout }) => startLogout(idToken || undefined));
  }
}

export const useGameStore = create((set, get) => ({
  // App state
  screen: 'login', // 'login' | 'lobby' | 'customizer' | 'table' | 'career'
  setScreen: (screen) => set({ screen }),

  // Auth state
  isLoggedIn: false,
  userId: null,
  authToken: null,

  // 2026-07-06 P2 auth fix — set by the 'poker:session-expired' teardown
  // (main.jsx listener) so the login screen can show a clear "session ended"
  // notice instead of silently yanking the user. Cleared on the next
  // successful login/oauthLogin.
  sessionExpiredNotice: null,
  // 2026-10-10 — set by a sign-out that left the browser's other sign-in
  // alone (tearDownSession); cleared on the next login / oauthLogin.
  deviceSignInLeftAlone: false,

  // OAuth2 token state
  oauthAccessToken: null,
  oauthRefreshToken: null,
  oauthIdToken: null,
  oauthTokenExpiry: null,

  // 2026-05-12 — CLAUDE.md Pattern B self-heal fields.
  // These are populated/merged from GET /users/:id/me on mount and on
  // tab-resume by refreshUserRolesFromMe in App.jsx. They must be
  // settable underneath us: an admin granting/revoking a role or
  // extending VIP must reach this store without the user signing out
  // and back in. NEVER stamp these once at handleLogin and forget.
  userRoles: [],
  isVip: false,
  vipLevel: null,
  vipExpiration: null,
  // Bulk-merge action used by refreshUserRolesFromMe. Accepts a partial
  // object; only the fields present are written. Array equality is
  // checked for userRoles so an unchanged-roles refresh is a no-op
  // (avoids churning subscribers).
  mergeServerUserFields: (patch) =>
    set((state) => {
      if (!patch || typeof patch !== 'object') return state;
      const next = {};
      if (Array.isArray(patch.userRoles)) {
        const prev = state.userRoles || [];
        const same = prev.length === patch.userRoles.length
          && prev.every((r, i) => r === patch.userRoles[i]);
        if (!same) next.userRoles = patch.userRoles;
      }
      if (typeof patch.isVip === 'boolean' && patch.isVip !== state.isVip) {
        next.isVip = patch.isVip;
      }
      if (typeof patch.vipLevel === 'number' && patch.vipLevel !== state.vipLevel) {
        next.vipLevel = patch.vipLevel;
      }
      if (patch.vipExpiration !== undefined && patch.vipExpiration !== state.vipExpiration) {
        next.vipExpiration = patch.vipExpiration;
      }
      return Object.keys(next).length ? next : state;
    }),

  login: (userData, token) => {
    // Invalidate the cached progress blob so the UI can't render a stale
    // level from a prior session before the server's `playerProgress`
    // event arrives. The cache reappears with fresh values on first
    // setProgress call triggered by the server. Fixes "level 5 everytime
    // I relogin" symptom where cached sessionStorage level overrode the
    // authoritative DB level for a visible window.
    try { sessionStorage.removeItem('poker_player_progress'); } catch {}
    set({
      isLoggedIn: true,
      userId: userData.id,
      authToken: token,
      sessionExpiredNotice: null,
      deviceSignInLeftAlone: false,
      playerName: userData.displayName || userData.username,
      phone: userData.phone || '',
      needsUsername: userData.needsUsername || false,
      chips: userData.chips,
      // 2026-05-19 audit — store isAdmin so the lobby can hide
      // admin-only UI (e.g. "Restore Missing Balance" button) from
      // non-admin users. Server enforcement still rejects non-admin
      // calls regardless; this is UX cleanup, not a security gate.
      isAdmin: !!userData.isAdmin,
      screen: userData.needsUsername ? 'chooseUsername' : 'lobby',
    });
  },

  // OAuth2 SSO login
  oauthLogin: (tokens, userData) => {
    // Same cache-invalidation as login — see comment there.
    try { sessionStorage.removeItem('poker_player_progress'); } catch {}
    set({
      isLoggedIn: true,
      userId: userData.id,
      authToken: tokens.access_token,
      sessionExpiredNotice: null,
      deviceSignInLeftAlone: false,
      oauthAccessToken: tokens.access_token,
      oauthRefreshToken: tokens.refresh_token,
      oauthIdToken: tokens.id_token || null,
      oauthTokenExpiry: Date.now() + (tokens.expires_in * 1000),
      playerName: userData.displayName || userData.username,
      phone: userData.phone || '',
      needsUsername: userData.needsUsername || false,
      chips: userData.chips,
      // 2026-05-19 audit — see comment in `login` above. Mirror the
      // isAdmin flag from the server's loginResult userData so admin-
      // only UI can hide itself for guest + regular players.
      isAdmin: !!userData.isAdmin,
      screen: userData.needsUsername ? 'chooseUsername' : 'lobby',
    });
    // 2026-05-05 Phase 3 — broadcast login to other same-origin tabs
    // (e.g. user has .online open in two tabs and logs in on tab A;
    //  tab B should pick up the session without a refresh).
    try {
      const mod = require('../services/authBroadcast');
      if (mod && typeof mod.broadcastAuth === 'function') {
        mod.broadcastAuth({ type: 'login', userId: userData.id });
      }
    } catch {}
  },

  logout: (opts) => {
    // 2026-07-02 OAuth audit (Finding #4) — `opts.skipRedirect` is passed by the
    // silent teardown paths (background scheduler refresh-revoke, cross-tab peer
    // logout, foreground refresh-fail) that must clear LOCAL state WITHOUT
    // redirecting to /session/end. User-initiated Sign Out passes nothing → it
    // always redirects → GLOBAL logout. A React onClick passes a click Event
    // object here (it has no `.skipRedirect`), so the button still redirects.
    // Returns a promise that settles when the sign-out has been carried out.
    const skipRedirect = !!(opts && opts.skipRedirect === true);
    // 2026-10-09 (D1, review fix; T2) — ONLY the player's own Sign Out (the
    // one non-skipRedirect caller: Lobby's Logout button) tells poker-server,
    // via socket 'revokeSignInTokens' WITH an acknowledgement, to bump this
    // account's users.token_version — revoking its "Play Online" resume token
    // and legacy tokens on every device. The silent teardowns never send it: a
    // session that expired or ended in another tab is not the player asking
    // to sign out everywhere. Not for a retired GUEST session either: bumping
    // that row would void the guest token set aside for the one-time
    // carry-over. The teardown — and with it the socket cycle — runs only once
    // the server answered (or LOGOUT_ACK_TIMEOUT_MS passed): emitted in the
    // same tick as the disconnect, the frame was usually dropped (the
    // transport close won). Never the socket 'logout' event: an old server
    // ends the session on it before the disconnect's seat reserve / cash-out
    // runs (REVOKE_SIGN_IN_TOKENS_EVENT).
    if (!skipRedirect) {
      if (_serverSignOut) return _serverSignOut; // double tap: one sign-out
      let signingOutOfGuest = false;
      try { signingOutOfGuest = isGuestLegacyToken(getAuthToken()); } catch { /* treat as account */ }
      let sock = null;
      try { sock = getSocket(); } catch { /* no socket: nothing to tell */ }
      // 2026-10-10 — a "Play Online" TICKET tab first asks the browser's
      // other open tabs who is signed in there (a "keep me signed in" OFF
      // sign-in of another account is invisible in the stored keys); the
      // answer decides, with the stored keys, whether this Sign Out leaves
      // the browser's sign-in alone (tearDownSession). Runs alongside the
      // server acknowledgement wait, so it adds at most
      // SIGN_IN_CENSUS_WAIT_MS when there is nothing to wait for.
      let census = null;
      try {
        const tab = getTabSession();
        if (tab && tab.kind === 'ticket' && get().isLoggedIn) census = requestSignInCensus();
      } catch { census = null; }
      const finish = (pending, c) => {
        if (_serverSignOut === pending) _serverSignOut = null;
        try {
          tearDownSession(set, get, false, c || null);
        } catch (e) {
          try { set({ signingOut: false }); } catch { /* ignore */ }
          try { console.error('[sign-out] teardown failed:', e); } catch { /* ignore */ }
        }
      };
      if (!signingOutOfGuest && get().isLoggedIn && sock && sock.connected) {
        set({ signingOut: true });
        const pending = Promise.all([requestServerSignOut(sock), census]).then(([, c]) => finish(pending, c));
        _serverSignOut = pending;
        return pending;
      }
      if (census) {
        set({ signingOut: true });
        const pending = census.then((c) => finish(pending, c));
        _serverSignOut = pending;
        return pending;
      }
    }
    tearDownSession(set, get, skipRedirect);
    return Promise.resolve();
  },

  // True while the explicit Sign Out waits for poker-server's
  // 'revokeSignInTokens' acknowledgement (at most LOGOUT_ACK_TIMEOUT_MS).
  // Lobby shows "Signing out…".
  signingOut: false,

  setAuth: (userId, token) => set({ userId, authToken: token }),

  // Player
  playerName: '',
  setPlayerName: (name) => set({ playerName: name }),
  chips: 50000, // pre-login placeholder; real balance arrives from server on login (matches server DEFAULT_CHIPS)
  setChips: (chips) => set({ chips }),

  // Avatar config — loaded from sessionStorage if available
  avatar: loadSavedAvatar(DEFAULT_AVATAR),
  updateAvatar: (key, value) =>
    set((state) => {
      // Validate color-valued fields — reject anything that isn't a standard
      // 3/6/8-digit hex. Arbitrary strings could CSS-inject downstream.
      const COLOR_KEYS = new Set(['skinTone', 'hairColor', 'eyeColor', 'shirtColor', 'accessoryColor', 'lipColor', 'blushColor']);
      if (COLOR_KEYS.has(key) && typeof value === 'string' && !/^#([0-9A-F]{3}|[0-9A-F]{6}|[0-9A-F]{8})$/i.test(value)) {
        return state; // silently drop invalid color
      }
      const next = { ...state.avatar, [key]: value };
      sessionStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(next));
      scheduleAvatarSync(next);
      return { avatar: next };
    }),
  updateFaceShape: (key, value) =>
    set((state) => {
      const next = {
        ...state.avatar,
        faceShape: { ...state.avatar.faceShape, [key]: value },
      };
      sessionStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(next));
      scheduleAvatarSync(next);
      return { avatar: next };
    }),
  resetAvatar: () => {
    sessionStorage.removeItem(AVATAR_STORAGE_KEY);
    set({ avatar: { ...DEFAULT_AVATAR } });
  },

  // Table state
  tableId: null,
  setTableId: (id) => set({ tableId: id }),
  seats: Array(SEAT_COUNT).fill(null),
  setSeat: (index, player) =>
    set((state) => {
      const seats = [...state.seats];
      seats[index] = player;
      return { seats };
    }),
  communityCards: [],
  setCommunityCards: (cards) => set({ communityCards: cards }),
  pot: 0,
  setPot: (pot) => set({ pot }),

  // Player hand
  hand: [],
  setHand: (hand) => set({ hand }),

  // Dealer state
  dealer: {
    buttonSeatIndex: 0,
  },
  setDealerButton: (index) =>
    set((state) => ({
      dealer: { ...state.dealer, buttonSeatIndex: index },
    })),

  // Animation phase tracking
  // idle | dealing | dealt | flop | flopRevealed | turn | turnRevealed | river | riverRevealed | showdown | gathering
  animationPhase: 'idle',
  setAnimationPhase: (phase) => set({ animationPhase: phase }),
  animationComplete: false,
  setAnimationComplete: (val) => set({ animationComplete: val }),

  // Cards dealt to each seat
  seatCards: {}, // { [seatIndex]: [card1, card2] }
  setSeatCards: (seatIndex, cards) =>
    set((state) => ({
      seatCards: { ...state.seatCards, [seatIndex]: cards },
    })),
  clearSeatCards: () => set({ seatCards: {} }),

  // Chip bets per seat for current round
  seatBets: {}, // { [seatIndex]: amount }
  setSeatBet: (seatIndex, amount) =>
    set((state) => ({
      seatBets: { ...state.seatBets, [seatIndex]: amount },
    })),
  clearSeatBets: () => set({ seatBets: {} }),

  // Current deck for the round
  deck: [],
  setDeck: (deck) => set({ deck }),

  // Start a new round
  startRound: () => {
    set({
      animationPhase: 'dealing',
      animationComplete: false,
      communityCards: [],
      seatCards: {},
      seatBets: {},
      pot: 0,
      hand: [],
    });
  },
}));
