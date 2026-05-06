/**
 * Cross-tab auth broadcast — shared in-memory message bus for login /
 * logout / token-refresh events.
 *
 * Why this exists:
 *   - localStorage 'storage' events fire across same-origin tabs but ONLY
 *     for the writer's siblings — the writing tab itself doesn't see the
 *     event. Hard to wire foreground UI off of.
 *   - Different sites (americanpub.poker, americanpubpoker.com,
 *     americanpubpoker.online) are different origins and CANNOT share a
 *     storage or BroadcastChannel directly.
 *   - But same-origin tabs WITHIN one site can — e.g. user has player app
 *     open in two tabs. Logging out in tab A should immediately tear down
 *     tab B without waiting for the next API call to 401.
 *
 * Design:
 *   - BroadcastChannel('poker-auth') wires same-origin tabs.
 *   - Cross-site sync is a Phase 4 problem — would require a postMessage
 *     bridge from the auth server's iframe, which Safari ITP makes painful.
 *     For now, cross-site logout relies on the auth server's session
 *     cookie being killed (via /session/end) — when other sites do silent
 *     auth on next visit, they get login_required and fall through to the
 *     login UI.
 *
 * Events:
 *   { type: 'logout', userId? }
 *   { type: 'login', userId }
 *   { type: 'token-refreshed', expires_in }
 *
 * Usage:
 *   import { broadcastAuth, onAuthEvent } from './authBroadcast';
 *   onAuthEvent((evt) => { if (evt.type === 'logout') doLogout(); });
 *   broadcastAuth({ type: 'logout', userId: '123' });
 */

const CHANNEL_NAME = 'poker-auth';

let _channel = null;
let _listeners = [];

function _ensureChannel() {
  if (_channel) return _channel;
  if (typeof BroadcastChannel === 'undefined') {
    // Safari < 15.4 / older browsers. Caller falls back to localStorage
    // 'storage' events; this module just no-ops.
    return null;
  }
  try {
    _channel = new BroadcastChannel(CHANNEL_NAME);
    _channel.addEventListener('message', (e) => {
      const evt = e?.data;
      if (!evt || typeof evt !== 'object' || !evt.type) return;
      for (const cb of _listeners) {
        try { cb(evt); } catch {}
      }
    });
  } catch {
    _channel = null;
  }
  return _channel;
}

/**
 * Broadcast an auth event to other same-origin tabs. The sending tab does
 * NOT receive its own message — caller is responsible for any same-tab
 * action (cb fires only for messages from OTHER tabs).
 */
export function broadcastAuth(evt) {
  const ch = _ensureChannel();
  if (!ch) return;
  try {
    ch.postMessage({ ...evt, ts: Date.now() });
  } catch {}
}

/**
 * Subscribe to broadcast events from other same-origin tabs. Returns an
 * unsubscribe fn. Idempotent — calling start() multiple times only
 * creates one underlying channel.
 */
export function onAuthEvent(cb) {
  if (typeof cb !== 'function') return () => {};
  _ensureChannel();
  _listeners.push(cb);
  return () => {
    _listeners = _listeners.filter((c) => c !== cb);
  };
}

/**
 * Tear down the channel. Call only on app unmount — usually unnecessary
 * since the channel auto-closes when the tab unloads.
 */
export function close() {
  if (_channel) {
    try { _channel.close(); } catch {}
    _channel = null;
  }
  _listeners = [];
}
