/**
 * .online auth-events logger. Same pattern as the player-app version,
 * origin='online'.
 */

import { API_BASE } from '../config';
const ORIGIN = 'online';

export function logAuthEvent(eventType, detail, opts = {}) {
  if (typeof fetch === 'undefined') return;
  let token = null;
  try {
    // .online stores access_token under poker_oauth_access_token (legacy) or
    // poker_auth_token (current). Try both.
    token = localStorage.getItem('oauth_access_token') ||
            localStorage.getItem('poker_auth_token') || null;
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
