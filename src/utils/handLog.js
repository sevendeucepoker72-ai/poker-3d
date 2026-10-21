/**
 * The player's OWN view of hand-history records (2026-10-11, .online R2 —
 * APPUI-15 / APPUI-51 / APPUI-52).
 *
 * A hand-history record (poker-server HandHistoryRecord) lists every seat; it
 * does not say which one was the player's. The lobby widgets matched on
 * `h.yourSeat` / `h.tableName` (never sent) so every hand read "Folded", and
 * the analytics summed EVERY player's chip delta (always ~0) and counted every
 * winner as the player's win. A record's own seat is now known three ways, in
 * this order:
 *   1. `yourSeat` — stamped by this client when the live `handHistory` event
 *      arrived while it was seated at that table (App.jsx);
 *   2. the DB row's hand id `<tableId>-<handNumber>-<seatIndex>-<ms>` — the
 *      server stores one row per recipient seat (durableState.handHistory);
 *   3. exactly ONE player row named like the player (seat names are the
 *      account display name, R1 contract #3).
 * No own row → the record is not the player's hand and is left out.
 */

const isInt = (n) => Number.isInteger(n);

/** The seat index of the hand-history DB id, or -1. */
export function seatFromHandId(handId) {
  if (typeof handId !== 'string') return -1;
  const parts = handId.split('-');
  if (parts.length < 4) return -1;
  const ts = parts[parts.length - 1];
  const seat = parts[parts.length - 2];
  const hand = parts[parts.length - 3];
  if (!/^\d+$/.test(ts) || !/^\d{1,2}$/.test(seat) || !/^\d+$/.test(hand)) return -1;
  return Number(seat);
}

/** The player's seat in a record (see the header), or -1. */
export function ownSeatOfRecord(rec, myName) {
  if (!rec || typeof rec !== 'object') return -1;
  const players = Array.isArray(rec.players) ? rec.players : [];
  const has = (seat) => players.some((p) => p && p.seatIndex === seat);
  if (isInt(rec.yourSeat) && rec.yourSeat >= 0 && has(rec.yourSeat)) return rec.yourSeat;
  const fromId = seatFromHandId(rec.handId);
  if (fromId >= 0 && has(fromId)) return fromId;
  const name = typeof myName === 'string' ? myName.trim().toLowerCase() : '';
  if (name) {
    const named = players.filter((p) => p && typeof p.name === 'string' && p.name.trim().toLowerCase() === name);
    if (named.length === 1 && isInt(named[0].seatIndex)) return named[0].seatIndex;
  }
  return -1;
}

/**
 * Gameplay audit G177 / G179 (2026-10-21) — a record row of a seat that was
 * never dealt into the hand. poker-server lists EVERY occupied seat: a seat
 * sitting out starts the hand folded with no cards, and a player who sits down
 * mid-hand (or waits out the dead zone) is folded too — none of them posts,
 * acts or holds cards. Every real fold is logged ('folded' / 'folded (left
 * table)'), so "folded, no cards, not one logged action" means not dealt in.
 * A record with neither `actions` nor an `actionLog` cannot tell (false).
 */
export function rowNotDealtIn(rec, row) {
  if (!row || typeof row !== 'object' || row.folded !== true) return false;
  if (Array.isArray(row.holeCards) && row.holeCards.length > 0) return false;
  const seat = row.seatIndex;
  if (rec && isInt(rec.viewerSeat) && rec.viewerSeat === seat
    && Array.isArray(rec.viewerHoleCards) && rec.viewerHoleCards.length > 0) return false;
  const own = Array.isArray(row.actions) ? row.actions.length : null;
  const log = rec && Array.isArray(rec.actionLog) && rec.actionLog.length > 0
    ? rec.actionLog.filter((a) => a && a.seatIndex === seat).length
    : null;
  if (own === null && log === null) return false;
  return (own || 0) === 0 && (log || 0) === 0;
}

/**
 * G177 / G179 — the row of a player who sat down while the hand was running:
 * not dealt in and no starting stack (the server records startChips 0 and his
 * buy-in as endChips). It is not his hand and not a player of it.
 */
export function rowIsMidHandJoiner(rec, row) {
  return rowNotDealtIn(rec, row) && row.startChips === 0;
}

/**
 * Gameplay audit G180 (2026-10-21) — the variant to stamp on a live record
 * that does not carry one (an older poker-server): the `variant` of the live
 * state of the SAME table (the one on screen or a multi-table entry), else
 * null. A record that names its table only; stored rows are never guessed.
 */
export function recordVariantFromTable(rec, gameState, activeTables) {
  if (!rec || typeof rec !== 'object') return null;
  if (typeof rec.variant === 'string' && rec.variant) return null;
  if (rec.tableId == null || rec.tableId === '') return null;
  const tid = String(rec.tableId);
  let gs = gameState && gameState.tableId != null && String(gameState.tableId) === tid ? gameState : null;
  if (!gs && activeTables && typeof activeTables.forEach === 'function') {
    activeTables.forEach((e, id) => { if (!gs && String(id) === tid && e && e.gameState) gs = e.gameState; });
  }
  return gs && typeof gs.variant === 'string' && gs.variant ? gs.variant : null;
}

/** Total chips in the hand's pots (the record's `pots`), else the winners' total. */
export function potTotal(rec) {
  if (rec && Array.isArray(rec.pots) && rec.pots.length > 0) {
    return rec.pots.reduce((s, p) => s + (Number(p && p.amount) || 0), 0);
  }
  if (rec && Array.isArray(rec.winners)) return rec.winners.reduce((s, w) => s + (Number(w && w.chipsWon) || 0), 0);
  return 0;
}

/**
 * The player's result in one record, or null when the record has no own row:
 * { seat, won, chipsWon, net, insuranceDelta, folded, handName, pot, holeCards }.
 *
 * Gameplay audit G177 (2026-10-21) — the hand he sat down during is not his
 * (null: no hand, no +buy-in "win"); a folded seat that won nothing cannot end
 * a hand above its start (a folded stack only falls), so any rise there is a
 * top-up from his wallet, not a result (net capped at 0).
 * G165 — `insuranceDelta` (poker-server, when it sends it: what the insurance
 * settlement changed his stack by after the pot — + paid to him, - collected)
 * is part of the hand's result; `endChips` stays the post-pot stack.
 */
export function ownHandResult(rec, myName) {
  const seat = ownSeatOfRecord(rec, myName);
  if (seat < 0) return null;
  const row = rec.players.find((p) => p && p.seatIndex === seat);
  if (!row) return null;
  if (rowIsMidHandJoiner(rec, row)) return null;
  const wins = (Array.isArray(rec.winners) ? rec.winners : []).filter((w) => w && w.seatIndex === seat);
  const chipsWon = wins.reduce((s, w) => s + (Number(w.chipsWon) || 0), 0);
  const insuranceDelta = Number.isFinite(row.insuranceDelta) ? row.insuranceDelta : null;
  let net = (typeof row.endChips === 'number' && typeof row.startChips === 'number') ? row.endChips - row.startChips : null;
  if (net !== null && net > 0 && row.folded === true && wins.length === 0) net = 0;
  if (net !== null && insuranceDelta !== null) net += insuranceDelta;
  return {
    seat,
    won: wins.length > 0,
    chipsWon,
    net,
    insuranceDelta,
    folded: !!row.folded,
    handName: (wins.find((w) => w.handName)?.handName) || row.handName || null,
    pot: potTotal(rec),
    holeCards: Array.isArray(row.holeCards) ? row.holeCards : null,
  };
}

/** Summary of the player's own hands (records with an own row only). */
export function summarizeOwnHands(records, myName) {
  const out = { hands: 0, wins: 0, net: 0, netKnown: 0, totalWon: 0, biggestWin: 0, bestHandName: null, series: [] };
  let cumulative = 0;
  for (const rec of Array.isArray(records) ? records : []) {
    const r = ownHandResult(rec, myName);
    if (!r) continue;
    out.hands += 1;
    if (r.won) {
      out.wins += 1;
      out.totalWon += r.chipsWon;
      if (r.chipsWon > out.biggestWin) { out.biggestWin = r.chipsWon; out.bestHandName = r.handName; }
    }
    if (typeof r.net === 'number') {
      out.net += r.net;
      out.netKnown += 1;
      cumulative += r.net;
      out.series.push({ n: out.hands, net: r.net, cumulative, label: rec.handNumber != null ? `Hand #${rec.handNumber}` : `Hand ${out.hands}` });
    }
  }
  out.winRate = out.hands > 0 ? Math.round((out.wins / out.hands) * 1000) / 10 : 0;
  out.avgPotWon = out.wins > 0 ? Math.round(out.totalWon / out.wins) : 0;
  return out;
}

// ── Street-aware replay steps (APPUI-52) ──────────────────────────────────────

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const BOARD_SIZE = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** 'PreFlop' / 'Flop' / … (the server's GamePhase) → 'preflop' / 'flop' / …; others → null. */
export function normalizeStreet(street) {
  if (street == null || street === '') return 'preflop'; // blinds carry no street
  const s = String(street).toLowerCase().replace(/[^a-z]/g, '');
  return STREETS.includes(s) ? s : null;
}

function amountIn(re, text) {
  const m = re.exec(text);
  return m ? Number(m[1]) || 0 : null;
}

/**
 * Replay steps from a record's chronological `actionLog`
 * ({ seatIndex, playerName, action: 'posted SB 50' | 'folded' | 'checked' |
 * 'called 100' | 'raised to 300' | 'went all-in for 900' | 'uncalled bet (200)
 * returned', street?: 'PreFlop' | 'Flop' | … }), with the board dealt street by
 * street and the pot as it grew. Returns [] for an unusable record.
 */
export function buildReplaySteps(history) {
  if (!history || typeof history !== 'object') return [];
  // G179 — a mid-hand joiner was no player of this hand (left out); a seat
  // sitting out is listed but folded from the start (never "contested").
  const rows = (Array.isArray(history.players) ? history.players : [])
    .filter((p) => p && isInt(p.seatIndex) && !rowIsMidHandJoiner(history, p));
  const players = rows
    .map((p) => ({ seatIndex: p.seatIndex, name: String(p.name ?? `Seat ${p.seatIndex + 1}`), holeCards: Array.isArray(p.holeCards) ? p.holeCards : null, folded: false }));
  const board = Array.isArray(history.communityCards) ? history.communityCards : [];
  const nameOf = (seat, fallback) => players.find((p) => p.seatIndex === seat)?.name || (fallback ? String(fallback) : `Seat ${Number(seat) + 1}`);
  const folded = new Set(rows.filter((p) => rowNotDealtIn(history, p)).map((p) => p.seatIndex));
  const snapshot = () => players.map((p) => ({ ...p, folded: folded.has(p.seatIndex) }));
  const steps = [];
  let street = 'preflop';
  let pot = 0;
  let streetIn = new Map(); // seat -> chips in on this street
  const boardFor = (s) => board.slice(0, BOARD_SIZE[s] ?? 0);

  steps.push({ type: 'start', street, community: [], pot: 0, players: snapshot(), label: 'Hand start' });

  const dealTo = (next) => {
    const from = STREETS.indexOf(street);
    const to = STREETS.indexOf(next);
    for (let i = from + 1; i <= to; i++) {
      const s = STREETS[i];
      if ((BOARD_SIZE[s] ?? 0) > board.length) break;
      street = s;
      streetIn = new Map();
      steps.push({ type: 'deal', street: s, community: boardFor(s), pot, players: snapshot(), label: s.charAt(0).toUpperCase() + s.slice(1) });
    }
    street = next;
  };

  for (const a of Array.isArray(history.actionLog) ? history.actionLog : []) {
    if (!a || typeof a !== 'object' || typeof a.action !== 'string') continue;
    const s = normalizeStreet(a.street);
    if (s && STREETS.indexOf(s) > STREETS.indexOf(street)) dealTo(s);
    const text = a.action;
    const seat = isInt(a.seatIndex) ? a.seatIndex : -1;
    const had = streetIn.get(seat) || 0;
    let n;
    if ((n = amountIn(/^posted (?:SB|BB|small blind|big blind|dead blind) (\d+)/i, text)) != null) {
      pot += n; streetIn.set(seat, had + n);
    } else if ((n = amountIn(/^called (\d+)/i, text)) != null) {
      pot += n; streetIn.set(seat, had + n);
    } else if ((n = amountIn(/^(?:raised to|went all-in for) (\d+)/i, text)) != null) {
      const delta = Math.max(0, n - had);
      pot += delta; streetIn.set(seat, Math.max(had, n));
    } else if ((n = amountIn(/^uncalled bet \((\d+)\) returned/i, text)) != null) {
      pot = Math.max(0, pot - n);
    } else if (/^fold/i.test(text)) {
      folded.add(seat);
    }
    steps.push({
      type: 'action', street, community: boardFor(street), pot, players: snapshot(),
      label: `${nameOf(seat, a.playerName)}: ${text}`, activeSeat: seat,
    });
  }

  // An all-in runout deals the rest of the board after the last action.
  if (board.length > BOARD_SIZE[street]) {
    const target = board.length >= 5 ? 'river' : board.length >= 4 ? 'turn' : 'flop';
    if (STREETS.indexOf(target) > STREETS.indexOf(street)) dealTo(target);
  }

  const finalPot = potTotal(history) || pot;
  const contested = players.filter((p) => !folded.has(p.seatIndex)).length;
  steps.push({
    type: 'showdown', street, community: board, pot: finalPot,
    players: players.map((p) => ({ ...p, folded: folded.has(p.seatIndex), revealed: !folded.has(p.seatIndex) && !!p.holeCards })),
    label: contested > 1 ? 'Showdown' : 'Result',
  });
  return steps;
}

// ── PokerStars-style text export (read back by the Hand History Importer) ────

const RANK_CHARS = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_CHARS = ['h', 'd', 'c', 's'];
const SUIT_NAME_CHARS = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' };
export function cardText(c) {
  if (!c || typeof c !== 'object') return '';
  const r = RANK_CHARS[c.rank] || (isInt(c.rank) && c.rank >= 2 && c.rank <= 9 ? String(c.rank) : '');
  const s = typeof c.suit === 'number' ? SUIT_CHARS[c.suit] : SUIT_NAME_CHARS[c.suit];
  return r && s ? `${r}${s}` : '';
}
const cardsText = (cards) => (Array.isArray(cards) ? cards.map(cardText).filter(Boolean).join(' ') : '');

function pad2(n) { return String(n).padStart(2, '0'); }
function stamp(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * One record as PokerStars-style hand-history text, from the player's own seat
 * ("Dealt to <name>"). Amounts are play-money chips. Null when the record has
 * no own row.
 */
export function recordToPokerStarsText(rec, myName) {
  const seat = ownSeatOfRecord(rec, myName);
  if (seat < 0) return null;
  // G177 — the hand he sat down during is not his; a mid-hand joiner is no
  // seat of it ("(0 in chips)").
  const players = rec.players.filter((p) => p && isInt(p.seatIndex) && !rowIsMidHandJoiner(rec, p));
  const me = players.find((p) => p.seatIndex === seat);
  if (!me) return null;
  const nameOf = (s) => players.find((p) => p.seatIndex === s)?.name || `Seat ${s + 1}`;
  const log = Array.isArray(rec.actionLog) ? rec.actionLog : [];
  const sb = amountIn(/^posted (?:SB|small blind) (\d+)/i, (log.find((a) => /^posted (SB|small blind)/i.test(a?.action || '')) || {}).action || '') || 0;
  const bb = amountIn(/^posted (?:BB|big blind) (\d+)/i, (log.find((a) => /^posted (BB|big blind)/i.test(a?.action || '')) || {}).action || '') || 0;
  const when = Number(new Date(rec.timestamp || rec.receivedAt || Date.now()).getTime());
  const lines = [];
  lines.push(`PokerStars Hand #${rec.handNumber ?? 0}: Hold'em No Limit (${sb}/${bb}) - ${stamp(when)}`);
  lines.push(`Table '${String(rec.tableName || 'American Pub Poker').replace(/'/g, '')}' ${Math.max(2, players.length)}-max`);
  for (const p of players) lines.push(`Seat ${p.seatIndex + 1}: ${p.name} (${Number(p.startChips) || 0} in chips)`);
  const board = Array.isArray(rec.communityCards) ? rec.communityCards : [];
  let street = 'preflop';
  let streetBet = 0;
  const streetIn = new Map();
  const header = (s) => {
    if (s === 'flop') lines.push(`*** FLOP *** [${cardsText(board.slice(0, 3))}]`);
    if (s === 'turn') lines.push(`*** TURN *** [${cardsText(board.slice(0, 3))}] [${cardsText(board.slice(3, 4))}]`);
    if (s === 'river') lines.push(`*** RIVER *** [${cardsText(board.slice(0, 4))}] [${cardsText(board.slice(4, 5))}]`);
  };
  let holeShown = false;
  const showHole = () => {
    if (holeShown) return;
    holeShown = true;
    lines.push('*** HOLE CARDS ***');
    const hc = cardsText(me && me.holeCards);
    if (hc) lines.push(`Dealt to ${me.name} [${hc}]`);
  };
  for (const a of log) {
    if (!a || typeof a.action !== 'string') continue;
    const s = normalizeStreet(a.street);
    const text = a.action;
    const isBlind = /^posted/i.test(text);
    if (!isBlind) showHole();
    if (s && STREETS.indexOf(s) > STREETS.indexOf(street)) {
      for (let i = STREETS.indexOf(street) + 1; i <= STREETS.indexOf(s); i++) header(STREETS[i]);
      street = s; streetBet = 0; streetIn.clear();
    }
    const who = nameOf(a.seatIndex);
    const had = streetIn.get(a.seatIndex) || 0;
    let n;
    if ((n = amountIn(/^posted (?:SB|small blind) (\d+)/i, text)) != null) { lines.push(`${who}: posts small blind ${n}`); streetIn.set(a.seatIndex, had + n); streetBet = Math.max(streetBet, had + n); }
    else if ((n = amountIn(/^posted (?:BB|big blind) (\d+)/i, text)) != null) { lines.push(`${who}: posts big blind ${n}`); streetIn.set(a.seatIndex, had + n); streetBet = Math.max(streetBet, had + n); }
    else if ((n = amountIn(/^posted dead blind (\d+)/i, text)) != null) { lines.push(`${who}: posts the ante ${n}`); }
    else if (/^fold/i.test(text)) lines.push(`${who}: folds`);
    else if (/^checked/i.test(text)) lines.push(`${who}: checks`);
    else if ((n = amountIn(/^called (\d+)/i, text)) != null) { lines.push(`${who}: calls ${n}`); streetIn.set(a.seatIndex, had + n); }
    else if ((n = amountIn(/^(?:raised to|went all-in for) (\d+)/i, text)) != null) {
      if (streetBet === 0) lines.push(`${who}: bets ${n - had}`);
      else lines.push(`${who}: raises ${Math.max(0, n - streetBet)} to ${n}`);
      streetIn.set(a.seatIndex, Math.max(had, n));
      streetBet = Math.max(streetBet, n);
    } else if ((n = amountIn(/^uncalled bet \((\d+)\) returned/i, text)) != null) lines.push(`Uncalled bet (${n}) returned to ${who}`);
  }
  showHole();
  for (let i = STREETS.indexOf(street) + 1; i < STREETS.length; i++) {
    if ((BOARD_SIZE[STREETS[i]] || 0) <= board.length) header(STREETS[i]);
  }
  lines.push('*** SUMMARY ***');
  lines.push(`Total pot ${potTotal(rec)}`);
  if (board.length) lines.push(`Board [${cardsText(board)}]`);
  for (const w of Array.isArray(rec.winners) ? rec.winners : []) {
    if (!w || !isInt(w.seatIndex)) continue;
    lines.push(`Seat ${w.seatIndex + 1}: ${nameOf(w.seatIndex)} won (${Number(w.chipsWon) || 0})${w.handName ? ` with ${w.handName}` : ''}`);
  }
  return lines.join('\n');
}
