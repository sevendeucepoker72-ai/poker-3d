/**
 * .online session lifecycle handler.
 *
 * Mirror of the player-app's sessionLifecycle.js, adapted for the .online
 * poker-3d frontend. (2026-07-06 comment fix: this header used to describe
 * the PRE-OIDC world — "HMAC bridge tokens, no refresh logic here, Phase 2
 * will migrate to native OIDC". Phase 2 #5 shipped 2026-05-05: .online is
 * native OIDC with refresh tokens, and this module HAS had a token-refresh
 * step since then — see item 1 below and the isTokenExpiringSoon import.)
 *
 * What runs on tab resume:
 *
 *   1. Near-expiry OIDC token refresh: if the access token expires within
 *      5 minutes, refresh it via authScheduler.refreshNow() BEFORE anything
 *      else fires a stale-token API call (returning to a tab after >55 min
 *      used to 401 on the first request). Best-effort — failures fall
 *      through to reactive 401 handling.
 *
 *   2. Force a socket reconnect if the socket is disconnected. iOS Safari
 *      aggressively suspends sockets after >30s in background and they
 *      don't always re-establish on their own — without this, the player
 *      comes back to a dead game.
 *
 *   3. Fire `poker3d:tab-resumed` so other modules (game state subscribers,
 *      tournament listeners) can revalidate their long-lived state.
 *
 *   4. Handle the bfcache (back-forward cache) edge case via `pageshow`
 *      — visibilitychange does NOT fire when iOS restores a page from
 *      bfcache, but pageshow does with persisted=true.
 *
 * Division of labor: authScheduler.js owns PROACTIVE refresh (timer 5 min
 * before expiry, hidden-tab deferral, cross-tab resync); this module only
 * covers the resume-with-near-expired-token case, and both funnel through
 * authService.refreshAccessToken's in-tab + cross-tab single-flight locks.
 */

import { forceReconnect, getSocket } from './socketService';
import { isTokenExpiringSoon, refreshNow } from './authScheduler';

let _started = false;
let _onResumeCallbacks = [];
let _lastResumeAt = 0;
const RESUME_DEBOUNCE_MS = 2_000;

async function _onResume(reason) {
  if (!_started) return;
  const now = Date.now();
  if (now - _lastResumeAt < RESUME_DEBOUNCE_MS) return;
  _lastResumeAt = now;

  // 2026-05-05 Phase 2 #5 — refresh OIDC access token if it's near-expired.
  // Without this, returning to a tab after >55min sends a stale token on
  // the next API call which 401s. Best-effort: failures fall through to
  // reactive 401 handling.
  if (isTokenExpiringSoon(5 * 60_000)) {
    try { await refreshNow(); } catch {}
  }

  // Reconnect socket if it dropped while we were backgrounded.
  try {
    const sock = getSocket && getSocket();
    if (!sock || !sock.connected) {
      forceReconnect();
    }
  } catch {
    // forceReconnect / getSocket may not be available on early boot —
    // worst case the next API call kicks reconnect anyway.
  }

  try {
    window.dispatchEvent(new CustomEvent('poker3d:tab-resumed', { detail: { reason } }));
  } catch {}
  for (const cb of _onResumeCallbacks) {
    try { cb({ reason }); } catch {}
  }
}

function _onVisibilityChange() {
  if (document.visibilityState === 'visible') _onResume('visibilitychange').catch(() => {});
}
function _onWindowFocus() { _onResume('focus').catch(() => {}); }
function _onPageShow(e) { if (e.persisted) _onResume('pageshow-bfcache').catch(() => {}); }

export function start() {
  if (_started) return;
  _started = true;
  try { document.addEventListener('visibilitychange', _onVisibilityChange); } catch {}
  try { window.addEventListener('focus', _onWindowFocus); } catch {}
  try { window.addEventListener('pageshow', _onPageShow); } catch {}
}

export function stop() {
  _started = false;
  _onResumeCallbacks = [];
  try { document.removeEventListener('visibilitychange', _onVisibilityChange); } catch {}
  try { window.removeEventListener('focus', _onWindowFocus); } catch {}
  try { window.removeEventListener('pageshow', _onPageShow); } catch {}
}

export function onResume(cb) {
  if (typeof cb !== 'function') return () => {};
  _onResumeCallbacks.push(cb);
  return () => {
    _onResumeCallbacks = _onResumeCallbacks.filter((c) => c !== cb);
  };
}
