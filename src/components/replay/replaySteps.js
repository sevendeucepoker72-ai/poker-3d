/**
 * replaySteps — the step-by-step replay of ONE hand-history record
 * (.online R2, 2026-10-11: TABLEUI-16 / APPUI-16).
 *
 * The record (poker-server PokerTable HandHistoryRecord) carries the hand's
 * chronological, street-tagged `actionLog` [{seatIndex, playerName, action,
 * street?}] since 2026-06-19. The old viewer ignored it: it replayed each
 * player's actions in SEAT order (every action of seat 0, then seat 1, ...),
 * revealed the board after "a share" of the actions, and summed every number
 * it found ("raised to 800" added 800 even when 400 of it was already in), so
 * the order, the board timing and the pot were all wrong.
 *
 * Now: steps follow the actionLog in order; the board is revealed when the
 * street changes (Flop / Turn / River; an all-in runout before the showdown);
 * the pot and each stack are tracked per street from the action texts the
 * server writes ("posted SB 50", "called 400" = adds 400, "raised to 800" =
 * the street total becomes 800, "went all-in for 2400", "uncalled bet (300)
 * returned", "posted dead blind 100"), antes the log does not carry are
 * reconciled from the record's own chip counts, and the showdown step shows
 * the final pots exactly. Records without an actionLog (older ones) fall back
 * to interleaving each player's actions round by round.
 *
 * Pure (no React, no DOM) so it can be exercised in Node.
 */

const BOARD_STREETS = { Flop: 3, Turn: 4, River: 5 };
const STREET_LABEL = {
  PreFlop: 'Pre-Flop', Flop: 'Flop', Turn: 'Turn', River: 'River', Showdown: 'Showdown',
  ThirdStreet: '3rd Street', FourthStreet: '4th Street', FifthStreet: '5th Street',
  SixthStreet: '6th Street', SeventhStreet: '7th Street',
  Bet1: 'Betting Round 1', Bet2: 'Betting Round 2', Bet3: 'Betting Round 3', Bet4: 'Betting Round 4',
  Draw1: 'Draw 1', Draw2: 'Draw 2', Draw3: 'Draw 3',
};
const BOARD_VARIANTS = /^(texas-holdem|holdem|omaha|omaha-5|omaha-6|omaha-hi-lo|omaha-hilo|short-deck|pineapple|crazy-pineapple)$/i;

const int = (v) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const nameOf = (p) => (typeof p?.name === 'string' && p.name) || (typeof p?.playerName === 'string' && p.playerName) || 'Player';

/** One action text → what it does to the pot. */
export function parseReplayAction(text) {
  const raw = String(text ?? '').trim();
  const t = raw.toLowerCase();
  const n = (re) => { const m = t.match(re); return m ? int(m[1]) : 0; };
  if (/^posted (sb|small blind)/.test(t)) return { kind: 'blind', to: n(/([\d,]+)\s*$/), raw };
  if (/^posted (bb|big blind)/.test(t)) return { kind: 'blind', to: n(/([\d,]+)\s*$/), raw };
  if (/^posted dead blind/.test(t)) return { kind: 'dead', add: n(/([\d,]+)\s*$/), raw };
  if (/^posted ante/.test(t)) return { kind: 'dead', add: n(/([\d,]+)\s*$/), raw };
  if (/^uncalled bet/.test(t)) return { kind: 'return', sub: n(/\(([\d,]+)\)/) || n(/([\d,]+)/), raw };
  if (/^fold/.test(t)) return { kind: 'fold', raw };
  if (/^check/.test(t)) return { kind: 'check', raw };
  if (/^called\s/.test(t)) return { kind: 'call', add: n(/^called\s+([\d,]+)/), raw };
  if (/^raised to\s/.test(t)) return { kind: 'raise', to: n(/^raised to\s+([\d,]+)/), raw };
  if (/^went all-in for\s/.test(t)) return { kind: 'raise', to: n(/all-in for\s+([\d,]+)/), allIn: true, raw };
  if (/(auto-)?discard/.test(t)) return { kind: 'info', raw };
  // Older free-form strings ("Call 400", "Raise 800", "Bet 200", "All-In 9600", "SB 50", "BB 100").
  if (/^(sb|bb)\b/.test(t)) return { kind: 'blind', to: n(/([\d,]+)/), raw };
  if (/^call\b/.test(t)) return { kind: 'call', add: n(/([\d,]+)/), raw };
  if (/^(raise|bet)\b/.test(t)) return { kind: 'raise', to: n(/([\d,]+)/), raw };
  if (/^all-?in\b/.test(t)) return { kind: 'raise', to: n(/([\d,]+)/), allIn: true, raw };
  if (/^ante\b/.test(t)) return { kind: 'dead', add: n(/([\d,]+)/), raw };
  return { kind: 'info', raw };
}

function isBlindText(text) {
  return /^(posted (sb|bb|small blind|big blind|dead blind|ante)|sb\b|bb\b|ante\b)/i.test(String(text ?? '').trim());
}

/**
 * The record's actions in order: the actionLog when present, else each
 * player's `actions` interleaved round by round (blinds first).
 */
function orderedActions(history) {
  const log = Array.isArray(history.actionLog) ? history.actionLog : null;
  if (log && log.length) {
    return {
      fromLog: true,
      list: log
        .filter((a) => a && typeof a === 'object' && Number.isInteger(a.seatIndex) && typeof a.action === 'string')
        .map((a) => ({ seatIndex: a.seatIndex, text: a.action, street: typeof a.street === 'string' && a.street ? a.street : null })),
    };
  }
  const players = history.players.filter((p) => Array.isArray(p.actions));
  const blinds = [];
  const rest = players.map((p) => ({ seatIndex: p.seatIndex, list: p.actions.filter((a) => typeof a === 'string') }));
  for (const r of rest) {
    const kept = [];
    for (const a of r.list) { if (isBlindText(a)) blinds.push({ seatIndex: r.seatIndex, text: a, street: 'PreFlop' }); else kept.push(a); }
    r.list = kept;
  }
  const list = [...blinds];
  for (let round = 0; rest.some((r) => r.list.length > round); round++) {
    for (const r of rest) if (r.list[round] !== undefined) list.push({ seatIndex: r.seatIndex, text: r.list[round], street: null });
  }
  return { fromLog: false, list };
}

/** Build the replay's steps (each a full snapshot the viewer renders). */
export function buildReplaySteps(history) {
  if (!history || typeof history !== 'object' || !Array.isArray(history.players) || history.players.length === 0) return [];
  const players = history.players.filter((p) => p && Number.isInteger(p.seatIndex));
  if (!players.length) return [];
  const board = Array.isArray(history.communityCards) ? history.communityCards.filter(Boolean) : [];
  const usesBoard = board.length > 0 || BOARD_VARIANTS.test(String(history.variant || 'texas-holdem'));
  const viewerSeat = Number.isInteger(history.viewerSeat) ? history.viewerSeat : null;
  const viewerCards = Array.isArray(history.viewerHoleCards) && history.viewerHoleCards.length ? history.viewerHoleCards : null;
  const finalPot = Array.isArray(history.pots) ? history.pots.reduce((s, p) => s + Math.max(0, int(p?.amount)), 0) : 0;
  const { fromLog, list } = orderedActions(history);
  // Each action's street: the log's tag (blinds and returns carry none: they
  // belong to the street in progress); an older record without a log guesses
  // by an equal share of the non-blind actions per street (as before).
  {
    let street = 'PreFlop';
    const nonBlindTotal = list.filter((a) => !isBlindText(a.text)).length;
    const share = Math.max(1, Math.floor(nonBlindTotal / 3));
    let seen = 0;
    for (const a of list) {
      if (fromLog) { if (a.street) street = a.street; }
      else if (!isBlindText(a.text)) { street = ['PreFlop', 'Flop', 'Turn', 'River'][Math.min(3, Math.floor(seen / share))]; seen++; }
      a.st = street;
    }
  }

  // Reconcile what the log does not carry (antes): per seat, what left its
  // stack (start - end + won) minus what its logged actions put in.
  const wonBySeat = new Map();
  for (const w of (Array.isArray(history.winners) ? history.winners : [])) {
    if (w && Number.isInteger(w.seatIndex)) wonBySeat.set(w.seatIndex, (wonBySeat.get(w.seatIndex) || 0) + Math.max(0, int(w.chipsWon)));
  }
  const dryRun = (() => {
    const inv = new Map(); let street = null; const streetIn = new Map();
    for (const a of list) {
      const st = a.st;
      if (st !== street) { street = st; streetIn.clear(); }
      const p = parseReplayAction(a.text);
      const cur = streetIn.get(a.seatIndex) || 0;
      let add = 0;
      if (p.kind === 'blind' || p.kind === 'raise') add = Math.max(0, p.to - cur);
      else if (p.kind === 'call') add = Math.max(0, p.add);
      else if (p.kind === 'dead') add = Math.max(0, p.add);
      else if (p.kind === 'return') add = -Math.max(0, p.sub);
      if (p.kind !== 'dead' && p.kind !== 'return') streetIn.set(a.seatIndex, cur + add);
      inv.set(a.seatIndex, (inv.get(a.seatIndex) || 0) + add);
    }
    return inv;
  })();
  const loggedPot = [...dryRun.values()].reduce((s, v) => s + v, 0);
  const missing = finalPot - loggedPot;
  const antes = new Map();
  if (missing > 0) {
    const per = players.map((p) => {
      const out = int(p.startChips) - int(p.endChips) + (wonBySeat.get(p.seatIndex) || 0);
      return [p.seatIndex, out - (dryRun.get(p.seatIndex) || 0)];
    });
    const sum = per.reduce((s, [, v]) => s + v, 0);
    if (per.every(([, v]) => v >= 0) && Math.abs(sum - missing) <= players.length) {
      for (const [seat, v] of per) if (v > 0) antes.set(seat, v);
    }
  }
  const anteTotal = [...antes.values()].reduce((s, v) => s + v, 0);

  const states = new Map(players.map((p) => [p.seatIndex, {
    seatIndex: p.seatIndex,
    name: nameOf(p),
    holeCards: Array.isArray(p.holeCards) && p.holeCards.length ? p.holeCards : null,
    handName: typeof p.handName === 'string' ? p.handName : null,
    startChips: int(p.startChips),
    chips: int(p.startChips),
    folded: false,
    currentAction: null,
    revealed: false,
  }]));
  if (viewerSeat !== null && viewerCards && states.has(viewerSeat) && !states.get(viewerSeat).holeCards) {
    states.get(viewerSeat).holeCards = viewerCards;
  }
  const snapshot = (over = {}) => [...states.values()].map((s) => ({ ...s, ...(over[s.seatIndex] || {}) }));
  const steps = [];
  let pot = 0;
  let shownBoard = 0;
  const label = (st) => STREET_LABEL[st] || st || 'Pre-Flop';

  // Setup + antes
  steps.push({ type: 'setup', phase: 'Setup', label: `Hand #${history.handNumber ?? ''} - Dealer shuffles`, activeSeat: -1, pot: 0, communityCards: [], playerStates: snapshot() });
  if (anteTotal > 0) {
    for (const [seat, v] of antes) { const s = states.get(seat); if (s) s.chips -= v; }
    pot += anteTotal;
    steps.push({ type: 'antes', phase: 'Antes', label: 'Antes posted', activeSeat: -1, pot, communityCards: [], playerStates: snapshot() });
  } else if (missing > 0) {
    pot += missing; // unreconciled: at least the pot ends where the record says
  }

  let street = null;
  const streetIn = new Map();
  const revealBoardTo = (n, st) => {
    if (!usesBoard || n <= shownBoard || board.length < n) return;
    shownBoard = n;
    for (const s of states.values()) s.currentAction = null;
    steps.push({ type: 'community', phase: st, label: `${label(st)} revealed`, activeSeat: -1, pot, communityCards: board.slice(0, n), playerStates: snapshot() });
  };
  let dealt = false;
  const deal = () => {
    if (dealt) return; dealt = true;
    // Every KNOWN hand (shown at showdown, or the viewer's own) is face up from
    // the deal on, so each street's equity reads right; unknown ones stay ??.
    for (const x of states.values()) x.revealed = !!x.holeCards;
    steps.push({ type: 'deal', phase: 'PreFlop', label: 'Hole cards dealt', activeSeat: -1, pot, communityCards: [], playerStates: snapshot() });
  };

  for (const a of list) {
    const s = states.get(a.seatIndex);
    const blind = isBlindText(a.text);
    if (!blind) deal();
    const st = a.st;
    if (st !== street) {
      street = st;
      streetIn.clear();
      if (BOARD_STREETS[st]) revealBoardTo(BOARD_STREETS[st], st);
      else if (st !== 'PreFlop' && steps.length && steps[steps.length - 1].type !== 'street') {
        for (const x of states.values()) x.currentAction = null;
        steps.push({ type: 'street', phase: st, label: label(st), activeSeat: -1, pot, communityCards: board.slice(0, shownBoard), playerStates: snapshot() });
      }
    }
    const p = parseReplayAction(a.text);
    const cur = streetIn.get(a.seatIndex) || 0;
    let add = 0;
    if (p.kind === 'blind' || p.kind === 'raise') add = Math.max(0, p.to - cur);
    else if (p.kind === 'call') add = Math.max(0, p.add);
    else if (p.kind === 'dead') add = Math.max(0, p.add);
    else if (p.kind === 'return') add = -Math.max(0, p.sub);
    if (p.kind !== 'dead' && p.kind !== 'return') streetIn.set(a.seatIndex, cur + add);
    pot = Math.max(0, pot + add);
    if (s) {
      s.chips -= add;
      if (p.kind === 'fold') s.folded = true;
      s.currentAction = a.text;
    }
    steps.push({
      type: blind ? 'blinds' : 'action',
      phase: blind ? 'Blinds' : st,
      label: `${s ? s.name : 'Player'}: ${a.text}`,
      activeSeat: a.seatIndex,
      pot,
      communityCards: board.slice(0, shownBoard),
      playerStates: snapshot(),
    });
  }
  deal();
  // An all-in runout: the rest of the board before the showdown.
  if (usesBoard) for (const [st, n] of Object.entries(BOARD_STREETS)) revealBoardTo(n, st);

  // Showdown: the record's own end state — final pots, end stacks, shown hands.
  const shownSeats = new Set();
  for (const s of states.values()) if (s.holeCards && !s.folded) shownSeats.add(s.seatIndex);
  steps.push({
    type: 'showdown',
    phase: 'Showdown',
    label: 'Showdown',
    activeSeat: -1,
    pot: finalPot > 0 ? finalPot : pot,
    communityCards: board,
    playerStates: [...states.values()].map((s) => ({
      ...s,
      revealed: !!s.holeCards && (shownSeats.has(s.seatIndex) || s.seatIndex === viewerSeat),
      currentAction: null,
      chips: int(players.find((p) => p.seatIndex === s.seatIndex)?.endChips),
    })),
    winners: (Array.isArray(history.winners) ? history.winners : []).map((w) => ({ ...w, name: nameOf(w) })),
  });
  return steps;
}
