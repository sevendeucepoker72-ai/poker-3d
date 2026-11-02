/**
 * Broadcast page URL config (lead spec C1 + R3 + R6, 2026-11-01). Pure: the
 * caller hands in location.search / location.hash / window.__APK_BROADCAST_KEY.
 *
 *   broadcast.html?ch=main|weekly|monthly|sitgo      (default main)
 *                 | ?q=<masterQualifierId> | ?t=<tournamentId>   (an event key instead of a channel)
 *     &layout=16x9|9x16  &bg=opaque|transparent  &motion=full|reduced
 *     &deck=2|4  &tally=0|1  &role=viewer|output  &table=<tableId> (follow one table)
 *     #k=<broadcast key>
 *
 * The key is read from the FRAGMENT only (never from the query string, which
 * reaches server logs and Referer), or from window.__APK_BROADCAST_KEY (the
 * stream worker injects it with evaluateOnNewDocument). The page then removes
 * the fragment with history.replaceState (stripKeyFromHref). The key is never
 * logged. Every bad value falls back to its default.
 */
import { CHANNELS } from './contract.js';

export const LAYOUTS = Object.freeze(['16x9', '9x16']);

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// A compact JWS (bcast+jwt): base64url segments joined by dots.
const KEY_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const KEY_MIN = 16;
const KEY_MAX = 4096;

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** A broadcast key as sent, or null when it is not a well-formed token. */
export function cleanKey(raw) {
  if (typeof raw !== 'string') return null;
  const k = raw.trim();
  if (k.length < KEY_MIN || k.length > KEY_MAX) return null;
  return KEY_RE.test(k) ? k : null;
}

/** The `k` value of a `#k=...` fragment (other fragment params are ignored). */
export function keyFromHash(hash) {
  if (typeof hash !== 'string' || hash.length < 2) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return cleanKey(params.get('k'));
}

/**
 * The page config from the URL parts. `injectedKey` (window.__APK_BROADCAST_KEY)
 * wins over the fragment, so the worker never needs the key in a URL.
 */
export function parseBroadcastConfig(search = '', hash = '', injectedKey = null) {
  const q = new URLSearchParams(typeof search === 'string' ? search : '');
  const qualifierId = q.get('q');
  const tournamentId = q.get('t');
  let event = null;
  if (qualifierId && ID_RE.test(qualifierId)) event = `q:${qualifierId}`;
  else if (tournamentId && ID_RE.test(tournamentId)) event = `t:${tournamentId}`;
  const channel = event ? null : pick(q.get('ch'), CHANNELS, 'main');
  const tableId = q.get('table');
  const injected = cleanKey(injectedKey);
  const key = injected || keyFromHash(hash);
  return {
    channel,
    event,
    layout: pick(q.get('layout'), LAYOUTS, '16x9'),
    bg: pick(q.get('bg'), ['opaque', 'transparent'], 'opaque'),
    motion: pick(q.get('motion'), ['full', 'reduced'], 'full'),
    deck: q.get('deck') === '4' ? 4 : 2,
    tally: q.get('tally') === '1',
    role: q.get('role') === 'output' ? 'output' : 'viewer',
    follow: tableId && ID_RE.test(tableId) ? { tableId } : 'program',
    key,
    keySource: injected ? 'injected' : (key ? 'fragment' : null),
    // A key pasted into the query string is NOT used (it is already in a log
    // somewhere); the page still strips it from the address bar.
    keyInQuery: q.has('k'),
    // DEV-only fixture replay (src/broadcast/dev); ignored by a production build.
    fixture: (() => {
      const f = q.get('fixture');
      return f && /^[A-Za-z0-9_-]{1,40}$/.test(f) ? f : null;
    })(),
  };
}

/**
 * The address to put back with history.replaceState: the same path and query
 * with the fragment removed and any `k` query param dropped. Returns null when
 * nothing needs to change.
 */
export function stripKeyFromHref(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  const hadHash = u.hash.length > 0;
  const hadQueryKey = u.searchParams.has('k');
  if (!hadHash && !hadQueryKey) return null;
  u.hash = '';
  if (hadQueryKey) u.searchParams.delete('k');
  return u.pathname + (u.search || '');
}

/** The `bc:subscribe` payload for a config (spec §3). */
export function subscribePayload(config, lastSeq = null) {
  const out = { v: 1, layout: config.layout, role: config.role, follow: config.follow };
  if (config.event) out.event = config.event;
  else out.channel = config.channel || 'main';
  if (Number.isInteger(lastSeq) && lastSeq >= 0) out.lastSeq = lastSeq;
  return out;
}
