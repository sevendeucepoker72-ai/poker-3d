// Shared hand-replay links: ?replay=<payload> (2026-10-11, .online fix round 1 — APPUI-23).
//
// The payload is btoa(encodeURIComponent(JSON.stringify(handHistory))), built
// by "Share Hand" (HandReplayViewer / ShareReplay). Anyone can craft a link, so
// it is UNTRUSTED input: before App renders HandReplayViewer it is decoded
// defensively and normalized into exactly the shape the viewer renders —
// strings for every rendered text, finite numbers, arrays of valid cards,
// bounded sizes. Anything that does not yield at least one player is rejected
// (App then ignores the link and boots normally) instead of crashing the
// viewer on every load — the old parser returned whatever JSON.parse gave.
// Pure module (no DOM, no React) so it can be exercised in plain Node.

export const REPLAY_PARAM_MAX_CHARS = 100_000;
const MAX_PLAYERS = 10;
const MAX_HOLE_CARDS = 7;      // stud = 7; Hold'em 2, Omaha 4-6, Pineapple 3
const MAX_BOARD_CARDS = 5;
const MAX_ACTIONS_PER_PLAYER = 80;
const MAX_ACTION_LOG = 300;
const MAX_POTS = 10;
const MAX_TEXT = 60;
const MAX_CHIPS = 1e12;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function cleanText(v, max = MAX_TEXT) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return '';
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function cleanChips(v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_CHIPS, Math.min(MAX_CHIPS, Math.round(n)));
}

function cleanInt(v, min, max) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/** A card the viewer can draw and evaluate: { rank: 2..14, suit: 0..3 }. */
function cleanCard(c) {
  if (!isPlainObject(c)) return null;
  const rank = cleanInt(c.rank, 2, 14);
  const suit = cleanInt(c.suit, 0, 3);
  if (rank === null || suit === null) return null;
  return { rank, suit };
}

function cleanCards(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list.slice(0, max)) {
    const card = cleanCard(c);
    if (card) out.push(card);
  }
  return out;
}

/** Keep only primitive fields (an actionLog entry is never rendered as an object). */
function cleanFlatEntry(e) {
  if (!isPlainObject(e)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(e)) {
    if (n >= 12) break;
    const key = cleanText(k, 30);
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (typeof v === 'number' && Number.isFinite(v)) { out[key] = v; n++; }
    else if (typeof v === 'boolean') { out[key] = v; n++; }
    else if (typeof v === 'string') { out[key] = cleanText(v); n++; }
  }
  return out;
}

/**
 * Normalize an untrusted hand-history object into the HandReplayViewer shape.
 * Returns null when it is not a usable replay (no valid player).
 */
export function sanitizeReplayHistory(raw) {
  if (!isPlainObject(raw) || !Array.isArray(raw.players)) return null;

  const players = [];
  const seats = new Set();
  raw.players.slice(0, MAX_PLAYERS * 2).forEach((p, idx) => {
    if (players.length >= MAX_PLAYERS || !isPlainObject(p)) return;
    let seatIndex = cleanInt(p.seatIndex, 0, 9);
    if (seatIndex === null) seatIndex = idx;
    if (seatIndex > 9 || seats.has(seatIndex)) return; // the viewer keys rows by seat
    seats.add(seatIndex);
    const holeCards = cleanCards(p.holeCards, MAX_HOLE_CARDS);
    const actions = Array.isArray(p.actions)
      ? p.actions.slice(0, MAX_ACTIONS_PER_PLAYER).filter((a) => typeof a === 'string').map((a) => cleanText(a, 40))
      : [];
    const handName = cleanText(p.handName, 40);
    players.push({
      seatIndex,
      name: cleanText(p.name, 40) || `Seat ${seatIndex + 1}`,
      holeCards: holeCards.length > 0 ? holeCards : null,
      startChips: cleanChips(p.startChips),
      endChips: cleanChips(p.endChips),
      actions,
      folded: p.folded === true,
      handName: handName || null,
    });
  });
  if (players.length === 0) return null;

  const winners = Array.isArray(raw.winners)
    ? raw.winners.slice(0, MAX_PLAYERS).filter(isPlainObject).map((w) => {
        const seatIndex = cleanInt(w.seatIndex, 0, 9);
        const handName = cleanText(w.handName, 40);
        return {
          seatIndex: seatIndex === null ? -1 : seatIndex,
          name: cleanText(w.name, 40) || (seatIndex === null ? 'Player' : `Seat ${seatIndex + 1}`),
          chipsWon: Math.max(0, cleanChips(w.chipsWon)),
          handName: handName || '',
        };
      })
    : [];

  const pots = Array.isArray(raw.pots)
    ? raw.pots.slice(0, MAX_POTS).filter(isPlainObject).map((p) => ({
        amount: Math.max(0, cleanChips(p.amount)),
        winners: Array.isArray(p.winners)
          ? p.winners.slice(0, MAX_PLAYERS).map((s) => cleanInt(s, 0, 9)).filter((s) => s !== null)
          : [],
      }))
    : [];

  const handNumber = cleanInt(raw.handNumber, 0, Number.MAX_SAFE_INTEGER);
  const variant = typeof raw.variant === 'string' && /^[a-z0-9-]{1,30}$/i.test(raw.variant)
    ? raw.variant.toLowerCase()
    : 'texas-holdem';

  const history = {
    handNumber: handNumber === null ? 0 : handNumber,
    variant,
    communityCards: cleanCards(raw.communityCards, MAX_BOARD_CARDS),
    players,
    winners,
    pots,
  };
  if (Array.isArray(raw.actionLog)) {
    history.actionLog = raw.actionLog.slice(0, MAX_ACTION_LOG).map(cleanFlatEntry).filter(Boolean);
  }
  return history;
}

/**
 * Decode the ?replay= parameter value (already URL-decoded by URLSearchParams)
 * and sanitize it. Returns the normalized history, or null for anything that
 * is not a valid replay.
 */
export function parseSharedReplayParam(param) {
  if (typeof param !== 'string' || param.length === 0 || param.length > REPLAY_PARAM_MAX_CHARS) return null;
  try {
    // URLSearchParams turns a literal '+' of the base64 text into a space; base64
    // itself never contains spaces, so map them back before decoding.
    const b64 = param.replace(/ /g, '+');
    const json = decodeURIComponent(atob(b64));
    return sanitizeReplayHistory(JSON.parse(json));
  } catch {
    return null;
  }
}
