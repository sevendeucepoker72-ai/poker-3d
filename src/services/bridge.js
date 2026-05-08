/**
 * Cross-site SSO bridge — .online (poker-3d) consumer/producer.
 *
 * Note: poker-3d uses different localStorage keys than the other SPAs:
 *   - poker_oauth_refresh        (refresh token)
 *   - poker_oauth_id_token       (id_token)
 *   - poker_token_expiry         (epoch ms expiry)
 *   - poker_auth_token           (access token, via tokenStorage helper)
 * The persistence path here writes those keys via the same tokenStorage
 * helper the AuthCallback uses, so existing boot logic in App.jsx picks up
 * the bridged session naturally.
 */

import { setAuthToken, isKeepSignedIn } from './tokenStorage';

const AUTH_SERVER = import.meta.env.VITE_AUTH_SERVER_URL || 'https://auth.americanpubpoker.online';
const CLIENT_ID = 'poker-3d';
const BRIDGE_HASH_KEY = 'bridge_id_token';

export function withBridge(targetUrl) {
  try {
    const idToken = localStorage.getItem('poker_oauth_id_token')
      || sessionStorage.getItem('poker_oauth_id_token');
    if (!idToken || typeof idToken !== 'string') return targetUrl;
    const url = new URL(targetUrl, typeof window !== 'undefined' ? window.location.href : 'https://americanpubpoker.online');
    const existingHash = url.hash.replace(/^#/, '');
    const existingParams = new URLSearchParams(existingHash);
    existingParams.set(BRIDGE_HASH_KEY, idToken);
    url.hash = existingParams.toString();
    return url.toString();
  } catch { return targetUrl; }
}

export function readBridgeFromHash() {
  try {
    const hash = (window.location.hash || '').replace(/^#/, '');
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    return params.get(BRIDGE_HASH_KEY) || null;
  } catch { return null; }
}

export function clearBridgeFromHash() {
  try {
    const hash = (window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (!params.has(BRIDGE_HASH_KEY)) return;
    params.delete(BRIDGE_HASH_KEY);
    const remaining = params.toString();
    const newUrl = window.location.pathname + window.location.search +
      (remaining ? '#' + remaining : '');
    window.history.replaceState({}, '', newUrl);
  } catch {}
}

export async function consumeBridgeIfPresent() {
  const subjectToken = readBridgeFromHash();
  if (!subjectToken) return { ok: false, reason: 'no-bridge' };
  clearBridgeFromHash();

  let response;
  try {
    response = await fetch(`${AUTH_SERVER}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:apk:bridge',
        subject_token: subjectToken,
        client_id: CLIENT_ID,
      }),
    });
  } catch (err) {
    return { ok: false, reason: 'network', detail: err && err.message };
  }
  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch {}
    return { ok: false, reason: 'token-exchange-failed', status: response.status, detail };
  }
  const tokens = await response.json();
  // poker-3d's storage convention: tokenStorage for the access token, plus
  // keep / session keys for the rest matching what AuthCallback writes.
  try {
    if (tokens.access_token) setAuthToken(tokens.access_token);
    const keep = isKeepSignedIn();
    const store = keep ? localStorage : sessionStorage;
    if (tokens.refresh_token) store.setItem('poker_oauth_refresh', tokens.refresh_token);
    if (tokens.id_token) store.setItem('poker_oauth_id_token', tokens.id_token);
    if (tokens.expires_in) {
      store.setItem('poker_token_expiry', String(Date.now() + tokens.expires_in * 1000));
    }
  } catch {}
  return { ok: true, tokens };
}
