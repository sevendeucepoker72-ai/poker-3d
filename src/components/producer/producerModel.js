/**
 * The broadcast producer panel's pure rules (lead spec C6 + §3 producer
 * events, 2026-11-02). No React, no socket: ProducerPanel and node:test.
 *
 * - The panel's own credential: a PRODUCER token minted on the signed-in main
 *   socket (`broadcastIssueToken` {ev:'ch:*', scopes:['producer'], label:
 *   'Producer panel', ttlHours:2}; was 12 until review 2026-11-02), kept in memory only, then used as the
 *   /broadcast handshake key. No OIDC on /broadcast (spec R3).
 * - OBS source URLs: the key only ever in the `#k=` FRAGMENT (never the query
 *   string, which reaches server logs and Referer). Public output needs no key.
 * - Hole cards: the producer never receives live hole cards (`live` is
 *   public-feed data) and its live view draws no cards at all. The delayed
 *   feed's floor and default is 5 minutes (owner 2026-11-02); the hole-card
 *   policy ships 'off' (the server answers 'holecards_off' until the owner
 *   turns it on after a security review).
 */
import { DEFAULT_HOW_TO_ENTER } from '../../broadcast/model/standings.js';
import { LEGAL_LINE } from '../../broadcast/model/contract.js';

/**
 * Review 2026-11-02 — the panel key lives 2 hours (it was 12) and is renewed
 * while the panel is open; Close, unmount and leaving the page revoke it
 * (ProducerPanel). A live 'ch:*' key bars its admin from entering any qualifier
 * (poker-server staffHoldsKeyFor), so a panel opened once "to look" used to
 * lock that admin out of every qualifier for 12 hours, and every open left
 * another 12-hour bearer producer credential behind.
 */
export const PANEL_TOKEN_TTL_HOURS = 2;
/** Renew this long before the key runs out (measured on the server's own nbf..exp). */
export const PANEL_TOKEN_RENEW_BEFORE_MS = 10 * 60 * 1000;
export const PANEL_TOKEN_MIN_RENEW_MS = 60 * 1000;
/** A failed renewal is tried again after this long (the current key keeps working). */
export const PANEL_TOKEN_RENEW_RETRY_MS = 2 * 60 * 1000;

export const PRODUCER_TOKEN_REQUEST = Object.freeze({
  ev: 'ch:*',
  scopes: Object.freeze(['producer']),
  label: 'Producer panel',
  ttlHours: PANEL_TOKEN_TTL_HOURS,
});

export const CHANNELS = Object.freeze(['main', 'weekly', 'monthly', 'sitgo']);
export const CHANNEL_LABELS = Object.freeze({ main: 'Main', weekly: 'Weekly', monthly: 'Monthly', sitgo: 'Sit & Go' });

/** Owner 2026-11-02: hole cards only on a delayed feed; 5 minutes is the minimum AND the default. */
export const MIN_DELAY_MIN = 5;
export const DEFAULT_DELAY_MIN = MIN_DELAY_MIN;
export const MAX_DELAY_MIN = 240;
export const KEY_MAX_TTL_HOURS = 12;

/**
 * Review 2026-11-02 — what the feed delay actually covers. poker-server stores
 * setFeed's delay for the channel's DELAYED sessions only (a source opened
 * with a delayed key from Keys: delayedFeed.channelDelayMs); the public
 * broadcast URL with no key is always live. The old hint said "Everything on
 * air (clock, ticker, results) follows it", which told a producer the public
 * Facebook output was delayed when its bust ticker and results were going out
 * live.
 */
export const FEED_DELAY_HINT = `The delay is at least ${MIN_DELAY_MIN} minutes. It applies only to OBS sources opened with a delayed key (Keys); their clock, ticker and results follow it. The public URL (no key) always stays live.`;
export const FEATURE_LOCK_OPTIONS = Object.freeze([0, 5, 15, 30, 60, 120, 240]);

/** The player app's own origin serves broadcast.html (the same deploy). */
export const BROADCAST_PAGE_PATH = '/broadcast.html';
/** poker-admin (the Broadcasts page runs scheduling, Facebook and the worker; spec R12). */
export const ADMIN_URL = 'https://admin.americanpub.poker/';

export const SCENE_BUTTONS = Object.freeze([
  { id: 'starting', label: 'Starting soon' },
  { id: 'table', label: 'Table' },
  { id: 'hfh', label: 'Hand-for-hand' },
  { id: 'break', label: 'Break' },
  { id: 'finalIntro', label: 'Final table intro' },
  { id: 'results', label: 'Results' },
  { id: 'room', label: 'All tables' },
  { id: 'recap', label: 'Replays' },
  { id: 'slate', label: 'Slate' },
]);

/** The scenes in which a producer 'reload' of the OBS sources is honoured (the page enforces it too). */
export const RELOAD_SCENES = Object.freeze(['slate', 'break']);

export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Delay minutes as the panel sends them: a whole number, at least 5, at most 240; junk = 5. */
export function clampDelayMin(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_DELAY_MIN;
  return Math.min(MAX_DELAY_MIN, Math.max(MIN_DELAY_MIN, n));
}

/** Key lifetime in hours as sent: 1..12; junk = 12. */
export function clampTtlHours(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return KEY_MAX_TTL_HOURS;
  return Math.min(KEY_MAX_TTL_HOURS, Math.max(1, n));
}

/**
 * `broadcastTokenIssued` / a mintKey ack -> {ok:true, token, jti, scopes, nbf, exp}
 * | {ok:false, code}. A reply without a token string is a refusal.
 */
export function tokenReply(res) {
  if (!isObj(res)) return { ok: false, code: 'no_answer' };
  if (res.ok === true && typeof res.token === 'string' && res.token.length >= 16) {
    return {
      ok: true,
      token: res.token,
      jti: typeof res.jti === 'string' ? res.jti : null,
      scopes: Array.isArray(res.scopes) ? res.scopes.filter((s) => typeof s === 'string') : [],
      nbf: Number.isFinite(res.nbf) ? res.nbf : null,
      exp: Number.isFinite(res.exp) ? res.exp : null,
    };
  }
  return { ok: false, code: typeof res.code === 'string' && res.code ? res.code : 'refused' };
}

/** A producer ack -> {ok:true, ...} | {ok:false, code}. A bare array (listKeys) is {ok:true, list}. */
export function ackReply(res) {
  if (Array.isArray(res)) return { ok: true, list: res };
  if (!isObj(res)) return { ok: false, code: 'no_answer' };
  if (res.ok === true) return res;
  return { ...res, ok: false, code: typeof res.code === 'string' && res.code ? res.code : 'refused' };
}

const REFUSAL_TEXT = {
  not_admin: 'Staff only. Sign in with an admin account.',
  login_required: 'Sign in first.',
  not_connected: 'Not connected to the game server yet.',
  no_answer: 'The game server did not answer. Try again.',
  not_producer: 'This panel key is not a producer key. Close and reopen the panel.',
  producer_is_entrant: 'You are registered in this event. Staff who play an event cannot produce it.',
  issuer_is_entrant: 'You are registered in this event, so you cannot create keys for it.',
  issuer_not_allowlisted: 'Only an allowlisted issuer (the owner) can turn on hole cards or make hole-card keys.',
  holecards_off: 'Hole cards are off on the server. The owner turns them on after the security review.',
  delay_below_minimum: `The delay must be at least ${MIN_DELAY_MIN} minutes.`,
  event_not_found: 'That event was not found (or nothing is bound to this channel yet).',
  table_not_in_event: 'That table is not part of this event.',
  scene_not_allowed: 'That scene is not available right now.',
  event_not_finished: 'Replays are available after the event ends.',
  not_captured: 'That event was not recorded for replays.',
  secret_unset: 'Broadcast keys are not set up on the server (BROADCAST_TOKEN_SECRET).',
  bad_token: 'The panel key was refused. Getting a new one.',
  expired: 'The panel key expired. Getting a new one.',
  not_yet_valid: 'The panel key is not valid yet. Getting a new one.',
  panel_key_revoked: 'This panel\'s key was revoked (Keys). Press Try again to get a new one.',
  renew_failed: 'The panel key could not be renewed yet. It keeps working; trying again in 2 minutes.',
  revoked: 'The panel key was revoked. Getting a new one.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  too_many_connections: 'Too many broadcast connections from this network.',
  banned: 'This network is blocked from the broadcast feed.',
  feed_off: 'The broadcast feed is switched off on the server.',
  channel_unknown: 'Unknown channel.',
  wrong_event: 'That key is for a different event.',
  version_unsupported: 'The server speaks a newer broadcast version. Reload this page.',
};

/** A refusal code in plain words (blue / amber notes in the panel, never red). */
export function refusalText(code) {
  if (typeof code === 'string' && REFUSAL_TEXT[code]) return REFUSAL_TEXT[code];
  return code ? `Refused (${String(code).slice(0, 40)}).` : 'Refused.';
}

/** Codes that mean "this panel token is refused" (the panel socket stops). */
export const TOKEN_REFUSALS = Object.freeze(['bad_token', 'expired', 'not_yet_valid', 'revoked', 'not_producer']);

/**
 * Review 2026-11-02 — what the panel does when its key is refused:
 *   'stop'   — someone REVOKED this panel's key (KeyManager on any producer
 *              panel): a revoke during the session (bc:authExpired 'revoked'),
 *              or a call answered not_producer (the key stopped being valid
 *              under a live session). The panel does NOT mint a new key behind
 *              that producer's back (a panel left open on a shared PC would
 *              come straight back); it waits for "Try again".
 *   'remint' — anything else (expired, a handshake refusal: after a server
 *              restart an unloaded key registry answers 'revoked' to every key).
 * `via` is 'handshake' | 'session' | 'call' (producerSocket tokenRefused).
 */
export function panelTokenRefusalAction(code, via) {
  if (code === 'revoked' && via === 'session') return 'stop';
  if (code === 'not_producer' && via === 'call') return 'stop';
  return 'remint';
}

/**
 * A refused panel key that is dead on the server (nothing left to revoke):
 * expired, or revoked under a live session. A HANDSHAKE 'revoked' is not
 * proof (a restarting server refuses every key it has not loaded yet), so that
 * key is still revoked later, once the server knows it.
 */
export function panelKeyIsDead(code, via) {
  return code === 'expired' || (via === 'session' && code === 'revoked') || (via === 'call' && code === 'not_producer');
}

/**
 * How long after receiving the panel key to renew it: its lifetime (server
 * exp - nbf, so the browser's clock does not matter) minus
 * PANEL_TOKEN_RENEW_BEFORE_MS, at least PANEL_TOKEN_MIN_RENEW_MS.
 */
export function panelRenewDelayMs(reply) {
  const nbf = isObj(reply) ? keyTimeMs(reply.nbf) : null;
  const exp = isObj(reply) ? keyTimeMs(reply.exp) : null;
  const life = nbf !== null && exp !== null && exp > nbf ? exp - nbf : PANEL_TOKEN_TTL_HOURS * 3600000;
  return Math.max(PANEL_TOKEN_MIN_RENEW_MS, life - PANEL_TOKEN_RENEW_BEFORE_MS);
}

/** URL params for an event key: 'q:<id>' -> {q}, 't:<id>' -> {t}, 'ch:<channel>' -> {ch}; else null. */
export function eventKeyParams(ev) {
  if (typeof ev !== 'string') return null;
  const m = /^(q|t|ch):([A-Za-z0-9_-]{1,64})$/.exec(ev);
  if (!m) return null;
  if (m[1] === 'ch') return CHANNELS.includes(m[2]) ? { ch: m[2] } : null;
  return { [m[1]]: m[2] };
}

/**
 * The OBS browser-source URL. `target` is a channel ('weekly') or an event
 * key ('q:<id>', 't:<id>', 'ch:<channel>'). The key goes ONLY in the
 * fragment; null when the target is not one a page can subscribe to.
 */
export function sourceUrl({ origin, target, layout = '16x9', role = 'output', key = null, tally = false, bg = 'opaque' }) {
  const base = typeof origin === 'string' && /^https?:\/\//.test(origin) ? origin.replace(/\/+$/, '') : '';
  const params = CHANNELS.includes(target) ? { ch: target } : eventKeyParams(target);
  if (!base || !params) return null;
  const q = new URLSearchParams(params);
  q.set('layout', layout === '9x16' ? '9x16' : '16x9');
  if (bg === 'transparent') q.set('bg', 'transparent');
  if (role === 'output') q.set('role', 'output');
  q.set('tally', tally ? '1' : '0');
  const frag = typeof key === 'string' && key ? `#k=${encodeURIComponent(key)}` : '';
  return `${base}${BROADCAST_PAGE_PATH}?${q.toString()}${frag}`;
}

/** What to set in OBS for a layout (lead spec W7: 30 fps, keyframe 2 s). */
export function obsSetupText(layout = '16x9') {
  const size = layout === '9x16' ? '1080 x 1920' : '1920 x 1080';
  return [
    `OBS: add a Browser source, size ${size}, and paste the URL.`,
    'Leave "Shutdown source when not visible" unticked, and "Refresh browser when scene becomes active" unticked.',
    'Output: 30 fps, keyframe interval 2 s.',
    'The key in the URL is shown once. Anyone with the URL gets that feed until the key expires or is revoked.',
  ].join('\n');
}

/**
 * The event key a DELAYED key is bound to (spec: only q: / t: for the
 * 'delayed' scope): the program's qualifier, else its tournament; null otherwise.
 */
export function delayedKeyEvent(program) {
  const ev = isObj(program) && isObj(program.event) ? program.event : null;
  if (!ev) return null;
  if (typeof ev.qualifierId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(ev.qualifierId)) return `q:${ev.qualifierId}`;
  if (typeof ev.tournamentId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(ev.tournamentId)) return `t:${ev.tournamentId}`;
  return null;
}

/** The program of a `bc:producer:state` (its Snapshot's program), or null. */
export function programOf(state) {
  const snap = isObj(state) && isObj(state.program) ? state.program : null;
  return snap && isObj(snap.program) ? snap.program : null;
}

/** The live tiles: public table summaries sorted by table number. */
export function liveTiles(live, featuredTableId = null) {
  const tables = isObj(live) && Array.isArray(live.tables) ? live.tables.filter((t) => isObj(t) && typeof t.tableId === 'string') : [];
  return tables
    .slice()
    .sort((a, b) => (Number.isInteger(a.tableNo) ? a.tableNo : 999) - (Number.isInteger(b.tableNo) ? b.tableNo : 999))
    .map((t) => ({
      tableId: t.tableId,
      label: Number.isInteger(t.tableNo) ? `Table ${t.tableNo}` : String(t.tableName || 'Table').slice(0, 28),
      players: Number.isInteger(t.players) ? t.players : null,
      handNumber: Number.isInteger(t.handNumber) ? t.handNumber : null,
      pot: Number.isFinite(t.pot) ? t.pot : 0,
      allIn: t.allIn === true,
      biggestStack: Number.isFinite(t.biggestStack) ? t.biggestStack : 0,
      chipLeaderHere: t.chipLeaderHere === true,
      featured: featuredTableId !== null && t.tableId === featuredTableId,
    }));
}

/**
 * 'On air: hand #212 · live: hand #215 (3 behind)' — what the viewers see vs
 * the live table, for the featured table; '' when unknown.
 */
export function onAirVsLive(state) {
  const snap = isObj(state) && isObj(state.program) ? state.program : null;
  const onAirTable = snap && isObj(snap.table) ? snap.table : null;
  const live = isObj(state) && isObj(state.live) ? state.live : null;
  const liveTable = live && isObj(live.featuredLive) ? live.featuredLive : null;
  const a = onAirTable && Number.isInteger(onAirTable.handNumber) ? onAirTable.handNumber : null;
  const b = liveTable && Number.isInteger(liveTable.handNumber) ? liveTable.handNumber : null;
  if (a === null && b === null) return '';
  const parts = [];
  if (a !== null) parts.push(`On air: hand #${a}`);
  if (b !== null) parts.push(`live: hand #${b}`);
  let text = parts.join(' · ');
  if (a !== null && b !== null && onAirTable.tableId === liveTable.tableId && b > a) text += ` (${b - a} behind)`;
  return text;
}

/** The lower-third presets (lead spec C6). Plain text; the producer can edit before showing. */
export function lowerThirdPresets(program) {
  const ev = isObj(program) && isObj(program.event) ? program.event : {};
  // Fix round 2026-11-02: the established qualifier wording (top 5), shared with the starting-soon card.
  const how = typeof ev.howToEnter === 'string' && ev.howToEnter.trim() ? ev.howToEnter.trim() : DEFAULT_HOW_TO_ENTER;
  const legal = isObj(program) && isObj(program.legal) && typeof program.legal.line === 'string' ? program.legal.line : '';
  return [
    { key: 'host', kind: 'host', title: 'Your host', sub: '' },
    { key: 'enter', kind: 'info', title: 'How to enter', sub: how },
    // Fix round 2026-11-02: the page's own legal line (contract.js), ending "21+ to enter." - one constant.
    { key: 'legal', kind: 'legal', title: legal || LEGAL_LINE, sub: '' },
    { key: 'meta', kind: 'legal', title: 'This stream is not sponsored, endorsed or run by Meta.', sub: '' },
    { key: 'venue', kind: 'venue', title: 'Thanks to our venues', sub: 'American Pub Poker league' },
    { key: 'player', kind: 'player', title: '', sub: 'Player spotlight' },
  ];
}

/** The program clock now: the program's time plus what passed since that state arrived (NaN when unknown). */
export function programClockNow(program, stateAt, now = Date.now()) {
  return isObj(program) && Number.isFinite(program.programNow) && Number.isFinite(stateAt)
    ? program.programNow + (now - stateAt) : NaN;
}

/**
 * Review 2026-11-02 — the players a 'player' (spotlight) lower third may name.
 * Only names the SERVER already put on the program (First L., or "Player" for
 * a player who opted out: poker-server entrantName), from the chip leaders,
 * the final table and the featured table, one row per pid. A spotlight is
 * never typed: a typed name could be a full name, or a name the player asked
 * us to hide.
 */
export function spotlightEntrants(program, table = null) {
  const out = [];
  const seen = new Set();
  const add = (row) => {
    if (!isObj(row) || typeof row.pid !== 'string' || !row.pid || seen.has(row.pid)) return;
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, 40) : '';
    if (!name) return;
    seen.add(row.pid);
    out.push({ pid: row.pid, name, chips: Number.isFinite(row.chips) ? row.chips : null });
  };
  const p = isObj(program) ? program : {};
  if (isObj(p.standings) && Array.isArray(p.standings.leaders)) p.standings.leaders.forEach(add);
  if (isObj(p.finalTable) && Array.isArray(p.finalTable.seats)) p.finalTable.seats.forEach(add);
  if (isObj(table) && Array.isArray(table.seats)) table.seats.forEach(add);
  return out;
}

/**
 * A lower-third item to send (`until` on the program clock; null = until hidden).
 * kind 'player': the title is the picked entrant's server name (`pid` among
 * `entrants`, spotlightEntrants); a typed title is ignored, and no match = null.
 */
export function lowerThirdItem({ id, kind, title, sub, durationSec, programNow, pid = null, entrants = [] }) {
  let t = typeof title === 'string' ? title.trim().slice(0, 80) : '';
  if (kind === 'player') {
    const e = Array.isArray(entrants) ? entrants.find((x) => isObj(x) && x.pid === pid) : null;
    t = e && typeof e.name === 'string' ? e.name.trim().slice(0, 80) : '';
  }
  if (!t) return null;
  const s = typeof sub === 'string' ? sub.trim().slice(0, 120) : '';
  const dur = Math.round(Number(durationSec));
  const until = Number.isFinite(dur) && dur > 0 && Number.isFinite(programNow) ? programNow + dur * 1000 : null;
  const item = { id: String(id), kind: ['host', 'info', 'player', 'legal', 'venue'].includes(kind) ? kind : 'info', title: t, until };
  if (s) item.sub = s;
  if (until !== null) item.durationMs = dur * 1000;
  return item;
}

/**
 * The go-live checklist. Auto items come from the producer state; the rest
 * are the producer's own ticks (`manual` {id: bool}).
 */
export function goLiveChecklist({ program, channel, stateAgeMs, manual = {} }) {
  const sub = isObj(channel) && isObj(channel.subscribers) ? channel.subscribers : {};
  const outputs = isObj(channel) && Number.isFinite(channel.outputs) ? channel.outputs : 0;
  const ev = isObj(program) && isObj(program.event) ? program.event : null;
  const legal = isObj(program) && isObj(program.legal) && typeof program.legal.line === 'string' && /21\+/.test(program.legal.line);
  const items = [
    { id: 'event', label: 'An event is bound to this channel', ok: !!ev && ev.status !== 'cancelled', auto: true },
    { id: 'feed', label: 'Producer feed is live (state under 6 s old)', ok: Number.isFinite(stateAgeMs) && stateAgeMs < 6000, auto: true },
    { id: 'legal', label: 'Legal line on air (play money only, 21+)', ok: !!legal, auto: true },
    { id: 'sources', label: 'OBS sources connected (16:9 or 9:16)', ok: (Number(sub['16x9']) || 0) + (Number(sub['9x16']) || 0) > 0 || outputs > 0, auto: true },
    { id: 'names', label: 'Names show as First L. (or Player)', ok: manual.names === true, auto: false },
    { id: 'voice', label: 'Voice chat is off at qualifier tables', ok: manual.voice === true, auto: false },
    { id: 'freeze', label: 'No deploys planned while on air', ok: manual.freeze === true, auto: false },
    { id: 'rehearsal', label: 'Rehearsal recorded and checked', ok: manual.rehearsal === true, auto: false },
  ];
  return { items, ready: items.every((i) => i.ok) };
}

/** '4m ago' / '12s ago' / 'just now'. */
export function agoText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 2000) return 'just now';
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  return `${Math.round(ms / 3600000)}h ago`;
}

/** A key time (JWT seconds, or ms) as epoch ms; null when not a time. */
export function keyTimeMs(v) {
  if (!Number.isFinite(v) || v <= 0) return null;
  return v < 1e12 ? v * 1000 : v;
}

/** A key row from listKeys, as shown (never a token string). */
export function keyRow(k) {
  if (!isObj(k) || typeof k.jti !== 'string') return null;
  return {
    jti: k.jti,
    label: typeof k.label === 'string' ? k.label.slice(0, 60) : '',
    scopes: Array.isArray(k.scopes) ? k.scopes.filter((s) => typeof s === 'string') : [],
    nbf: Number.isFinite(k.nbf) ? k.nbf : null,
    exp: Number.isFinite(k.exp) ? k.exp : null,
    revoked: k.revoked === true || Number.isFinite(k.revoked),
    connected: Number.isFinite(k.connected) ? k.connected : (k.connected === true ? 1 : 0),
  };
}

/** The key rows of a listKeys answer ({ok, keys} or a bare array -> {ok, list}). */
export function keyRowsOf(res) {
  if (!isObj(res) || res.ok !== true) return [];
  const list = Array.isArray(res.keys) ? res.keys : (Array.isArray(res.list) ? res.list : []);
  return list.map(keyRow).filter(Boolean);
}
