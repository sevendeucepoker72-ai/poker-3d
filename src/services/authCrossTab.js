/**
 * authCrossTab — cross-tab logout propagation.
 *
 * When one tab logs the user out (or the auth token / refresh token is
 * cleared for any reason — including the "Keep me signed in" wipe that
 * happens on explicit logout), other open tabs should drop their
 * in-memory session too. Otherwise tab B keeps operating under a stale
 * authed state until its own refresh cycle discovers the revocation.
 *
 * Backed by the browser `storage` event: it fires in OTHER tabs of the
 * same origin whenever localStorage is mutated. It does NOT fire in the
 * tab that made the change — that's exactly what we want here.
 *
 * Context: see the 2026-04-22 comment in authService.js about the cross-
 * tab storage scoping mismatch. The OAuth verifier/state story was
 * resolved by using localStorage for the PKCE handoff; this listener
 * closes the complementary problem on the logout side.
 */

const TOKEN_KEYS = ['poker_auth_token', 'poker_oauth_refresh'];
// 2026-07-02 OAuth audit (Finding #6) — explicit cross-tab logout marker. The
// TOKEN_KEYS storage-event path only fires for LOCALSTORAGE clears; a
// keep-signed-in-OFF (session-only) logout removes sessionStorage keys, which
// emit NO cross-tab `storage` event. On browsers without BroadcastChannel
// (Safari <15.4) the peer tab would then keep a stale authed UI until its own
// next 401. gameStore.logout() now ALWAYS writes a fresh timestamp to this
// localStorage key (no token material), guaranteeing a storage event fires.
const LOGOUT_MARKER_KEY = 'poker_logout_broadcast';

/**
 * Subscribe to cross-tab auth-token clears.
 *
 * @param {() => void} onRemoteLogout — invoked when another tab clears or
 *   nulls one of the auth-token keys. Called at most once per clear event.
 * @returns {() => void} unsubscribe — removes the storage listener.
 */
export function startAuthCrossTabListener(onRemoteLogout) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  if (typeof onRemoteLogout !== 'function') {
    return () => {};
  }

  const handler = (event) => {
    if (!event) return;

    // 2026-07-02 Finding #6 — explicit logout marker. Any new timestamp means
    // "the other tab logged out"; this fires even for session-only logins whose
    // token keys live in sessionStorage (which emit no cross-tab storage event).
    if (event.key === LOGOUT_MARKER_KEY) {
      if (event.newValue) {
        try {
          onRemoteLogout();
        } catch (err) {
          console.error('[authCrossTab] onRemoteLogout threw:', err);
        }
      }
      return;
    }

    // Ignore events from other storage areas or keys we don't care about.
    // `event.storageArea` is localStorage for localStorage writes; some
    // browsers omit it, so don't bail purely on that check.
    if (!TOKEN_KEYS.includes(event.key)) return;

    // A remote logout nulls the key (removeItem → newValue === null) or
    // overwrites it with an empty string. Either pattern means "the other
    // tab no longer considers us authed" — propagate.
    if (event.newValue === null || event.newValue === '') {
      try {
        onRemoteLogout();
      } catch (err) {
        // Never let a consumer error break the listener; log and move on.
        console.error('[authCrossTab] onRemoteLogout threw:', err);
      }
    }
  };

  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
