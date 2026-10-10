/**
 * .online auth-events logger. Same pattern as the player-app version,
 * origin='online'.
 */

import { API_BASE } from '../config';
import { getAuthToken, getOAuthItem, bearerForThisTab } from './tokenStorage';
const ORIGIN = 'online';

export function logAuthEvent(eventType, detail, opts = {}) {
  if (typeof fetch === 'undefined') return;
  let token = null;
  try {
    // 2026-07-06 P2 auth fix — this used to read localStorage
    // 'oauth_access_token', a key the poker-3d namespace NEVER writes
    // (that's the player-app's key namespace), so the primary lookup always
    // missed; and the bare localStorage 'poker_auth_token' fallback missed
    // session-only (keep-signed-in OFF) logins whose token lives in
    // sessionStorage. Use the app's canonical accessors instead:
    // getAuthToken() reads poker_auth_token from both stores (the primary
    // bearer, kept in sync with the refreshed OAuth ACCESS token by
    // authService/tokenStorage), with poker_oauth_access as fallback.
    // Both are ACCESS tokens — /auth-events/log expects the same bearer
    // the rest of the API receives (NOT the id_token).
    // 2026-10-10 (F5) — through bearerForThisTab: a "Play Online" ticket tab
    // never sends another account's sign-in stored on this browser (the row
    // then goes out unattributed); every other tab is unchanged (first
    // non-empty of the two, as before).
    token = [getAuthToken(), getOAuthItem('poker_oauth_access')]
      .map((t) => bearerForThisTab(t))
      .find(Boolean) || null;
  } catch {}
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = JSON.stringify({
    eventType, origin: ORIGIN, detail: detail || undefined,
    ...(opts.userId ? { userId: opts.userId } : {}),
  });
  try {
    fetch(`${API_BASE}/auth-events/log`, {
      method: 'POST', headers, body, keepalive: true,
    }).catch(() => {});
  } catch {}
}
