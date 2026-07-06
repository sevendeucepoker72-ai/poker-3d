/**
 * .online proactive refresh scheduler — the ONLY proactive refresher.
 *
 * Mirror of apps/web/src/services/authScheduler.js for the poker-3d frontend.
 * Reads tokens from poker-3d's authService + tokenStorage helpers.
 *
 * 2026-07-06 P2 auth fix — App.jsx used to run a SECOND, overlapping refresh
 * timer with a divergent failure policy (force-logout after one 30s retry);
 * that timer is gone. This module's policy is authoritative: transient
 * failures retry indefinitely and never log out; a revoked refresh token
 * dispatches 'poker:session-expired' (single teardown in main.jsx). Also
 * ported from player-web: document.hidden deferral + visibilitychange
 * catch-up + cross-tab storage-event resync.
 *
 * .online stores OAuth tokens in the gameStore (Zustand) and mirrors them
 * to localStorage via persistence — the canonical fields are:
 *   - poker_oauth_refresh   (refresh token)
 *   - poker_token_expiry    (expiresAt epoch ms)
 *   - poker_oauth_id_token  (id_token)
 *
 * On every refresh success we update both the store and these legacy
 * keys so the ecosystem stays consistent.
 */

import { refreshAccessToken, RefreshTokenRevokedError, REFRESH_DONE_KEY } from './authService';
import { useGameStore } from '../store/gameStore';
import { setOAuthItem, getOAuthItem } from './tokenStorage';

const REFRESH_LEAD_MS = 5 * 60 * 1000;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 30 * 60 * 1000;

let _timerId = null;
let _started = false;
let _refreshing = false;
// 2026-07-06 P2 auth fix (ported from apps/web/src/services/authScheduler.js)
// — set when a scheduled refresh was deferred because the tab was hidden;
// _onVisibilityChange fires the deferred refresh the moment we're visible.
let _pendingRefreshOnVisible = false;

function _readExpiresAt() {
  // Prefer the in-memory store value (most recent post-login), fall back
  // to the persisted localStorage copy that survives reload.
  try {
    const fromStore = useGameStore.getState().oauthTokenExpiry;
    if (typeof fromStore === 'number' && fromStore > 0) return fromStore;
  } catch {}
  try {
    const raw = getOAuthItem('poker_token_expiry');
    if (raw) return parseInt(raw, 10) || 0;
  } catch {}
  return 0;
}
function _readRefreshToken() {
  try {
    const fromStore = useGameStore.getState().oauthRefreshToken;
    if (fromStore) return fromStore;
  } catch {}
  try {
    return getOAuthItem('poker_oauth_refresh') || null;
  } catch { return null; }
}

function _computeDelay() {
  const expiresAt = _readExpiresAt();
  if (!expiresAt) return MAX_DELAY_MS;
  const fireAt = expiresAt - REFRESH_LEAD_MS;
  const delay = fireAt - Date.now();
  if (delay < MIN_DELAY_MS) return MIN_DELAY_MS;
  if (delay > MAX_DELAY_MS) return MAX_DELAY_MS;
  return delay;
}

async function _doRefresh() {
  if (!_started || _refreshing) return;

  // 2026-07-06 (ported from player-web authScheduler) — Android Chrome /
  // iOS Safari suspend background-tab network: a fetch started while hidden
  // hangs until the AbortController timeout fires, producing a FALSE
  // 'network' (transient) failure and pointless retry churn. Defer instead;
  // _onVisibilityChange calls us the moment the tab is foregrounded.
  if (typeof document !== 'undefined' && document.hidden) {
    _pendingRefreshOnVisible = true;
    return;
  }
  _pendingRefreshOnVisible = false;

  const refreshToken = _readRefreshToken();
  if (!refreshToken) return;
  _refreshing = true;
  try {
    const tokens = await refreshAccessToken(refreshToken);
    // Update store + persistence so the rest of the app reads fresh values.
    try {
      const expiresAt = Date.now() + (Number(tokens.expires_in) || 3600) * 1000;
      useGameStore.setState({
        oauthAccessToken: tokens.access_token,
        oauthRefreshToken: tokens.refresh_token || refreshToken,
        oauthIdToken: tokens.id_token || useGameStore.getState().oauthIdToken,
        oauthTokenExpiry: expiresAt,
        authToken: tokens.access_token,
      });
      // F1: refresh + id_token honor keep-signed-in (setOAuthItem); expiry is a
      // short-lived cross-tab-coordination value and stays in localStorage.
      try { localStorage.setItem('poker_token_expiry', String(expiresAt)); } catch {}
      try {
        if (tokens.refresh_token) setOAuthItem('poker_oauth_refresh', tokens.refresh_token);
      } catch {}
      try {
        if (tokens.id_token) setOAuthItem('poker_oauth_id_token', tokens.id_token);
      } catch {}
    } catch {}
    _scheduleNext();
  } catch (e) {
    if (e instanceof RefreshTokenRevokedError || e?.name === 'RefreshTokenRevokedError') {
      _started = false;
      // 2026-07-06 P2 auth fix — dispatch ONLY. The single teardown lives in
      // main.jsx's 'poker:session-expired' listener, which calls
      // gameStore.logout({ skipRedirect: true }) (now including the socket
      // disconnect) and sets the login-screen "session ended" notice. The
      // inline store.logout() that used to follow this dispatch was a second,
      // divergent teardown path — it double-fired logout for the same expiry
      // and predated the socket-disconnect + visible-notice flow.
      try {
        window.dispatchEvent(new CustomEvent('poker:session-expired', {
          detail: { reason: 'refresh-revoked-by-scheduler' },
        }));
      } catch {}
      return;
    }
    // Transient — retry sooner, with jitter so multiple tabs (or a fleet of
    // clients behind the same flaky network) don't retry in lockstep.
    // NEVER logs out: only an explicit RefreshTokenRevokedError above ends
    // the session (2026-07-06 — the old App.jsx twin scheduler force-logged-
    // out after one 30s retry, kicking seated players on a ~60s blip).
    if (_started) {
      const jitter = Math.floor(Math.random() * 10_000);
      _timerId = setTimeout(_doRefresh, 20_000 + jitter);
    }
  } finally {
    _refreshing = false;
  }
}

function _scheduleNext() {
  if (!_started) return;
  if (_timerId) { clearTimeout(_timerId); _timerId = null; }
  _timerId = setTimeout(_doRefresh, _computeDelay());
}

// 2026-07-06 (ported from player-web authScheduler) — run a deferred refresh
// as soon as the tab is foregrounded, or refresh immediately if the token
// slid into the near-expiry window while we were hidden (browsers throttle
// background setTimeout, so the timer may not have fired on time).
function _onVisibilityChange() {
  if (!_started || (typeof document !== 'undefined' && document.hidden)) return;
  const expiresAt = _readExpiresAt();
  const nearExpiry = expiresAt && Date.now() > (expiresAt - REFRESH_LEAD_MS);
  if (_pendingRefreshOnVisible || nearExpiry) {
    _pendingRefreshOnVisible = false;
    if (_timerId) { clearTimeout(_timerId); _timerId = null; }
    _doRefresh();
  }
}

// 2026-07-06 (ported from player-web authScheduler) — cross-tab resync.
// Another tab completed a refresh → it wrote a fresh poker_token_expiry and
// stamped the completion marker → reschedule OUR timer to the new expiry so
// all tabs share one refresh per cycle (the cross-tab lock in authService
// already guarantees only one tab performs it). Another tab logging out
// removes poker_oauth_access (always-localStorage) → stop scheduling here;
// the app-level session teardown is authCrossTab's job, this only kills the
// timer.
function _onStorageEvent(e) {
  if (!_started || !e) return;
  if (e.key === 'poker_token_expiry' || e.key === REFRESH_DONE_KEY) {
    _scheduleNext();
  }
  if (e.key === 'poker_oauth_access' && e.newValue == null) {
    stop();
  }
}

export function start() {
  if (_started) return;
  _started = true;
  try { window.addEventListener('storage', _onStorageEvent); } catch {}
  try { document.addEventListener('visibilitychange', _onVisibilityChange); } catch {}
  _scheduleNext();
}

export function stop() {
  _started = false;
  _pendingRefreshOnVisible = false;
  if (_timerId) { clearTimeout(_timerId); _timerId = null; }
  try { window.removeEventListener('storage', _onStorageEvent); } catch {}
  try { document.removeEventListener('visibilitychange', _onVisibilityChange); } catch {}
}

export async function refreshNow() {
  const refreshToken = _readRefreshToken();
  if (!refreshToken) return null;
  return await refreshAccessToken(refreshToken);
}

export function isTokenExpiringSoon(thresholdMs = 60_000) {
  const expiresAt = _readExpiresAt();
  if (!expiresAt) return false;
  return Date.now() > (expiresAt - thresholdMs);
}
