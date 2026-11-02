/**
 * Broadcast wire contract v1 — the client's mirror of the lead spec §3
 * (stream/contract.md, 2026-11-01) for the .online tournament broadcast page
 * (broadcast.html). poker-server owns the canonical copy
 * (src/broadcast/contract.ts). Pure module: no React, no socket, no
 * import.meta, so the node:test files under tests/broadcast/ load it as is.
 *
 * 2026-11-02 (owner: "5-minute delayed feed") — the hole-card delay floor and
 * default is 5 minutes, not the spec's 15 (configurable upward on the server).
 * 2026-11-02 (owner HARD RULE) — a hand's hole cards are never released while
 * that hand is still being played live: BroadcastTableFrame carries
 * `liveHandEndedAt` (server ms when THIS frame's hand ended live; null while it
 * is still live). It is one of the two fields this mirror adds to §3; the delayed
 * HoleCam shows faces only when it is set and in the past (model/holeCardGate.js).
 * 2026-11-02 (P5-C2b) — and the frame must MARK the hand's cards as released:
 * `holeCardsReleasedAt` (server ms when the delay buffer released THIS frame's
 * hand's hole cards to this delayed session; null / missing = not released).
 * The server sets it only on a delayed frame that carries hole cards, never
 * before max(liveHandEndedAt, t + delayMs); the page shows card backs for any
 * frame without it. A public frame never carries it.
 *
 * @typedef {{rank:number, suit:0|1|2|3}} Card
 * @typedef {'main'|'weekly'|'monthly'|'sitgo'} ChannelId
 * @typedef {{mode:'public'|'delayed', delayMs:number, holeCards:boolean, policy:'off'|'after_event'|'delayed'}} Feed
 * @typedef {{seatIndex:number, pid:string, name:string, chips:number, bet:number, folded:boolean,
 *   allIn:boolean, sittingOut:boolean, eliminated:boolean, hasCards:boolean, holeCards:Card[]|null,
 *   mucked?:boolean, handName?:string|null}} BroadcastSeat
 * @typedef {{winners:{seatIndex:number, name:string, amount:number, handName?:string}[],
 *   showdownSeats:number[], muckedSeats:number[]}} HandResult
 * @typedef {{t:number, tableId:string, tableNo:number|null, tableName:string, maxSeats:number,
 *   featured:boolean, handNumber:number, phase:string, handLevel:{sb:number, bb:number, ante:number},
 *   dealerSeat:number, smallBlindSeat:number, bigBlindSeat:number, activeSeat:number,
 *   turnStartedAt:number|null, turnTimeout:number|null, pot:number,
 *   pots?:{amount:number, eligibleSeats:number[]}[], board:Card[],
 *   lastAction?:{seatIndex:number, text:string, amount?:number}, seats:BroadcastSeat[],
 *   handResult:HandResult|null, liveHandEndedAt?:number|null,
 *   holeCardsReleasedAt?:number|null}} BroadcastTableFrame
 */

export const CONTRACT_VERSION = 1;

export const CHANNELS = Object.freeze(['main', 'weekly', 'monthly', 'sitgo']);

export const SCENE_IDS = Object.freeze([
  'starting', 'table', 'break', 'hfh', 'finalIntro', 'results', 'slate', 'recap', 'room',
]);

export const FEED_MODES = Object.freeze(['public', 'delayed']);
export const HOLECARD_POLICIES = Object.freeze(['off', 'after_event', 'delayed']);

// Handshake refusals (`connect_error` err.data.code). 'registry_loading' is
// the retryable answer a poker-server gives while its key registry is still
// loading after a restart (review 2026-11-02; an older server says 'revoked').
// 'starting' is the same answer from the first build of that fix (fix round
// 2026-11-02: kept for compatibility; poker-server now sends 'registry_loading').
export const HANDSHAKE_REFUSALS = Object.freeze([
  'bad_token', 'expired', 'not_yet_valid', 'revoked', 'registry_loading', 'starting', 'secret_unset',
  'rate_limited', 'too_many_connections', 'banned', 'feed_off',
]);

// A refused KEY the page gives up on AT ONCE: it drops the key and reconnects
// keyless (the public feed needs none, and shows strictly less).
export const KEY_REFUSALS = Object.freeze(['bad_token', 'expired']);

// Review 2026-11-02 — a refusal that says "this key, but not right now": the
// page KEEPS the key and retries it. 'not_yet_valid' = a key minted with a
// notBefore for a scheduled show (retried until its nbf); 'registry_loading' =
// the server restarted and has not loaded its key registry yet; 'starting' =
// the same, from a server built before it was renamed (fix round 2026-11-02).
// Both keep the key and retry it with backoff (retryDelayFor: 5 s, 10 s, 15 s, 20 s ...).
export const KEY_RETRY_REFUSALS = Object.freeze(['not_yet_valid', 'registry_loading', 'starting']);

// 'revoked' at the HANDSHAKE: poker-server refuses an UNKNOWN jti as 'revoked',
// so for the first seconds after a restart (httpServer.listen runs before the
// key registry has loaded) every valid key is refused as 'revoked'. The page
// keeps the key through KEY_REVOKED_GRACE_MS of back-to-back 'revoked'
// handshakes, then drops it. A revoke DURING a session (bc:authExpired) drops
// the key at once: the server had loaded that key to accept the session.
export const KEY_REVOKED = 'revoked';
export const KEY_REVOKED_GRACE_MS = 90000;

// `bc:subscribe` ack refusals.
export const SUBSCRIBE_REFUSALS = Object.freeze([
  'channel_unknown', 'event_not_found', 'not_broadcastable', 'rate_limited', 'wrong_event',
  'entrant', 'holecards_off', 'too_many_sessions', 'version_unsupported',
]);

/**
 * ProgramState.legal.line as §3 fixes it; shown when the program has none.
 * Fix round 2026-11-02: it ends in approved rules line (2) "21+ to enter."
 * word for word (was a bare "21+"). The producer's legal lower third imports
 * this same constant (producerModel.js lowerThirdPresets).
 */
export const LEGAL_LINE = 'Free to play · Play money only · No purchase necessary · 21+ to enter.';

/** The heartbeat cadence the server keeps (R9). */
export const HEARTBEAT_MS = 2000;

/** A plain-object check every payload reader starts with. */
export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Major version of a payload: a number, else null (unknown = unsupported). */
export function payloadVersion(msg) {
  return isObj(msg) && Number.isInteger(msg.v) ? msg.v : null;
}

/** True when the page can read this payload (v:1; a missing v on a frame is read as 1). */
export function versionSupported(msg, { required = true } = {}) {
  const v = payloadVersion(msg);
  if (v === null) return !required;
  return v === CONTRACT_VERSION;
}
