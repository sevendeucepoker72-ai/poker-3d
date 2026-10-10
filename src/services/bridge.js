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

import { setAuthToken, setOAuthItem, bearerForThisTab } from './tokenStorage';

const AUTH_SERVER = import.meta.env.VITE_AUTH_SERVER_URL || 'https://auth.americanpubpoker.online';
const CLIENT_ID = 'poker-3d';
const BRIDGE_HASH_KEY = 'bridge_id_token';

/**
 * 2026-08-17 P1 — hard timeout on the bridge token exchange.
 *
 * This fetch had NO timeout and no AbortController. That was survivable while
 * the local auto-login paths ran in parallel, and became an outage the moment
 * the boot flows were SEQUENCED: `startLocalAutoLogin()` is now reachable only
 * from inside the bridge IIFE, behind `await consumeBridgeIfPresent()`. On a
 * flaky mobile uplink the fetch never settles, the await never returns, and the
 * refresh-token + legacy paths NEVER RUN — the user lands on LoginScreen having
 * attempted nothing at all, holding a perfectly good 180-day refresh token.
 * Worse, `clearBridgeFromHash()` has already consumed the one-shot token, so a
 * reload can't retry the bridge either. Since this outage is mobile-dominated,
 * that is the common case, not the edge case.
 *
 * 20s (2026-10-06 review fix; was 8s). HEAD had NO deadline here, so an
 * exchange that took 8-20s on a slow mobile uplink still succeeded and the
 * user was signed in under the bridge spinner (capped at 26s in App.jsx). An
 * 8s abort turned exactly those slow-but-working exchanges into failures. 20s
 * keeps them working, stays inside that 26s spinner budget, and still bounds a
 * truly hung fetch so the local refresh/legacy paths get to run. App.jsx races
 * the same budget (+1.5s) as a belt-and-braces second line of defence in case
 * a browser ignores the abort.
 */
export const BRIDGE_EXCHANGE_TIMEOUT_MS = 20000;

export function withBridge(targetUrl) {
  try {
    // 2026-10-10 (F5) — through bearerForThisTab: a "Play Online" ticket tab
    // never hands the player app another account's sign-in stored on this
    // browser (the link then opens without a bridge — the player app's own
    // sign-in applies). Every other tab: unchanged.
    const idToken = bearerForThisTab(localStorage.getItem('poker_oauth_id_token')
      || sessionStorage.getItem('poker_oauth_id_token'));
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
  // AbortController + hard deadline — see BRIDGE_EXCHANGE_TIMEOUT_MS above.
  // Without this the whole boot auth sequence can hang on one stalled socket.
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => { timedOut = true; try { controller.abort(); } catch {} }, BRIDGE_EXCHANGE_TIMEOUT_MS)
    : null;
  try {
    response = await fetch(`${AUTH_SERVER}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:apk:bridge',
        subject_token: subjectToken,
        client_id: CLIENT_ID,
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err) {
    // Distinguish the deadline from a genuine network error so the caller can
    // report the right telemetry reason; both fall through to the local
    // auto-login paths.
    return timedOut
      ? { ok: false, reason: 'timeout' }
      : { ok: false, reason: 'network', detail: err && err.message };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch {}
    return { ok: false, reason: 'token-exchange-failed', status: response.status, detail };
  }
  let tokens;
  try {
    tokens = await response.json();
  } catch (err) {
    // A 200 with an unparseable body used to throw out of this function and
    // land in App.jsx's bare `catch {}` — which, post-sequencing, is another
    // way to reach LoginScreen having attempted nothing.
    return { ok: false, reason: 'bad-token-response', detail: err && err.message };
  }
  // poker-3d's storage convention: tokenStorage for the access token, plus
  // keep / session keys for the rest matching what AuthCallback writes.
  try {
    if (tokens.access_token) setAuthToken(tokens.access_token);
    // 2026-08-17 LOGIN-4 — these were raw setItem calls on the keep-signed-in
    // store, which wrote ONE store and left the other's copy in place. Because
    // the read path prefers localStorage, a bridged sign-in with keep-signed-in
    // OFF could leave the PREVIOUS user's persistent refresh token winning on
    // the next boot of a shared venue laptop. setOAuthItem writes one store and
    // sweeps the other, so exactly one copy can exist.
    if (tokens.refresh_token) setOAuthItem('poker_oauth_refresh', tokens.refresh_token);
    if (tokens.id_token) setOAuthItem('poker_oauth_id_token', tokens.id_token);
    // 2026-05-15 — explicit non-null check; falsy 0 was silently dropped.
    if (tokens.expires_in != null) {
      setOAuthItem('poker_token_expiry', String(Date.now() + tokens.expires_in * 1000));
    }
  } catch {}
  return { ok: true, tokens };
}
