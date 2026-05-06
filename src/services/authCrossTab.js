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
    // Ignore events from other storage areas or keys we don't care about.
    // `event.storageArea` is localStorage for localStorage writes; some
    // browsers omit it, so don't bail purely on that check.
    if (!event || !TOKEN_KEYS.includes(event.key)) return;

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
