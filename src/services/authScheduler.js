/**
 * .online proactive refresh scheduler.
 *
 * Mirror of apps/web/src/services/authScheduler.js for the poker-3d frontend.
 * Reads tokens from poker-3d's authService + tokenStorage helpers.
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

import { refreshAccessToken, RefreshTokenRevokedError } from './authService';
import { useGameStore } from '../store/gameStore';

const REFRESH_LEAD_MS = 5 * 60 * 1000;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 30 * 60 * 1000;

let _timerId = null;
let _started = false;
let _refreshing = false;

function _readExpiresAt() {
  // Prefer the in-memory store value (most recent post-login), fall back
  // to the persisted localStorage copy that survives reload.
  try {
    const fromStore = useGameStore.getState().oauthTokenExpiry;
    if (typeof fromStore === 'number' && fromStore > 0) return fromStore;
  } catch {}
  try {
    const raw = localStorage.getItem('poker_token_expiry');
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
    return localStorage.getItem('poker_oauth_refresh') || null;
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
      try { localStorage.setItem('poker_token_expiry', String(expiresAt)); } catch {}
      try {
        if (tokens.refresh_token) localStorage.setItem('poker_oauth_refresh', tokens.refresh_token);
      } catch {}
      try {
        if (tokens.id_token) localStorage.setItem('poker_oauth_id_token', tokens.id_token);
      } catch {}
    } catch {}
    _scheduleNext();
  } catch (e) {
    if (e instanceof RefreshTokenRevokedError || e?.name === 'RefreshTokenRevokedError') {
      _started = false;
      try {
        window.dispatchEvent(new CustomEvent('poker:session-expired', {
          detail: { reason: 'refresh-revoked-by-scheduler' },
        }));
      } catch {}
      // Trigger the store's logout to clear local state — but don't redirect
      // (let the foreground UI surface the expiry however it wants).
      try {
        const store = useGameStore.getState();
        if (typeof store.logout === 'function') {
          // Use logout but skip the redirect side-effect by clearing
          // oauthIdToken first.
          useGameStore.setState({ oauthIdToken: null });
          store.logout();
        }
      } catch {}
      return;
    }
    // Transient — retry sooner.
    if (_started) _timerId = setTimeout(_doRefresh, 30_000);
  } finally {
    _refreshing = false;
  }
}

function _scheduleNext() {
  if (!_started) return;
  if (_timerId) { clearTimeout(_timerId); _timerId = null; }
  _timerId = setTimeout(_doRefresh, _computeDelay());
}

export function start() {
  if (_started) return;
  _started = true;
  _scheduleNext();
}

export function stop() {
  _started = false;
  if (_timerId) { clearTimeout(_timerId); _timerId = null; }
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
