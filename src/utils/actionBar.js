/**
 * The table action bar's rules (gameplay audit 2026-10-21, cluster C1): what
 * the bar may offer, the amounts it shows, and when a per-turn guard resets.
 *
 * Pure module (no React, no store, no socket): GameHUD, MultiTableView and the
 * offline probes use it. Every server key read here is OPTIONAL — a state
 * without it (an older poker-server) gets exactly the behaviour the bar had
 * before these rules.
 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * All-In-or-Fold table (F107): the server accepts 'fold' and 'allIn', and
 * (since the 2026-10-21 server, below) a 'check' when nothing is owed.
 */
export function isAllInOrFoldTable(gs) {
  return !!gs && gs.tableKind === 'aof';
}

/**
 * May he CHECK at this All-In-or-Fold table when nothing is owed (F107
 * fix-up)? poker-server 742e006 (gameplay F49, `allInOrFoldAllows`) takes a
 * check there when his call is 0; the server before it refuses every check at
 * AOF ("Only fold or all-in allowed at this table"). There is no flag of its
 * own: that server ships in the same 2026-10-21 gameplay release as S2
 * (5554e99), which sends `bettingStructure` in EVERY state frame and which
 * the older server never sends — so its presence is the gate, and without it
 * the bar stays Fold + All-In only (today's behaviour). A refusal anyway is
 * the existing action-error toast.
 */
export function aofAllowsCheck(gs) {
  return isAllInOrFoldTable(gs) && typeof gs.bettingStructure === 'string' && gs.bettingStructure.length > 0;
}

/**
 * Raise limits for the hero (F12 / F41 / F107).
 *  - `canRaise` (server, per seat): false when the betting was not reopened to
 *    him (a short all-in), the fixed-limit cap is reached, or his stack only
 *    covers a call. Absent = true (older server).
 *  - `maxRaise` (server): the largest legal raise-TO total (pot limit / fixed
 *    limit), null for no limit. The bar never offers more than that or his
 *    stack (chips + this street's bet).
 *  - `isMyTurn` (F12 fix-up): the server computes `canRaise` on EVERY frame,
 *    whether or not it is his turn, and it is false for a folded seat, at
 *    Showdown, during a held runout, etc. It only decides the bar on his own
 *    turn: off-turn (isMyTurn === false) the bar keeps its stack-based shape
 *    (All-In button, inline raise group — disabled as before), never 'hidden'
 *    / 'call'. Omitted = applied (callers that only render on his turn).
 * → { stackMax, serverMax, maxRaise, raiseControlsOk, capBelowStack,
 *     allInIsCallOnly, isAof, aofFreeCheck, capVerb }
 *  aofFreeCheck — an All-In-or-Fold table whose server takes a check
 *    (aofAllowsCheck) and nothing to call: Check is offered there.
 */
export function raiseLimits({ myChips, myCurrentBet, minRaiseTotal, callAmount, gameState, isMyTurn } = {}) {
  const chips = num(myChips);
  const stackMax = chips + num(myCurrentBet);
  const sm = gameState ? gameState.maxRaise : undefined;
  const serverMax = (typeof sm === 'number' && Number.isFinite(sm) && sm > 0) ? sm : null;
  const maxRaise = serverMax != null ? Math.min(stackMax, serverMax) : stackMax;
  const isAof = isAllInOrFoldTable(gameState);
  const onTurn = isMyTurn !== false;
  const serverSaysNoRaise = onTurn && !!gameState && gameState.canRaise === false;
  const raiseControlsOk = !serverSaysNoRaise && !isAof && maxRaise > 0 && num(minRaiseTotal) <= maxRaise;
  const capBelowStack = serverMax != null && serverMax < stackMax;
  const allInIsCallOnly = serverSaysNoRaise && chips > num(callAmount);
  const aofFreeCheck = isAof && aofAllowsCheck(gameState) && num(callAmount) === 0;
  const capVerb = gameState && gameState.bettingStructure === 'pot-limit' ? 'Pot' : 'Max';
  return { stackMax, serverMax, maxRaise, raiseControlsOk, capBelowStack, allInIsCallOnly, isAof, aofFreeCheck, capVerb };
}

/**
 * What the All-In button is (F12 / F41 / F107):
 *  'hidden' — the server would turn the shove into a call (betting not
 *             reopened) or a check; the Call / Check button covers it;
 *  'call'   — the same, at an All-In-or-Fold table facing a bet, where the
 *             Call button is not offered: the button is his way to call (it
 *             sends 'allIn', which the server answers as a call);
 *  'max'    — pot / fixed limit caps the bet below his stack: it raises to the
 *             cap (the server clamps an 'allIn' to the same number);
 *  'allin'  — a real all-in.
 * Off-turn raiseLimits never sets allInIsCallOnly, so it is 'max' / 'allin'.
 */
export function allInButtonMode(limits) {
  if (!limits) return 'allin';
  if (limits.allInIsCallOnly) return (limits.isAof && !limits.aofFreeCheck) ? 'call' : 'hidden';
  if (limits.capBelowStack) return 'max';
  return 'allin';
}

/**
 * The allIn hotkey's line when the All-In button is hidden (F12): the server
 * would only call (or check) — the betting was not reopened, or the fixed
 * limit cap is reached — so it says what he can do, not why.
 */
export function allInHiddenText(callAmount) {
  return num(callAmount) > 0 ? 'You can only call or fold here.' : 'You can only check or fold here.';
}

/** Raise amount shown / sent: never 0, never outside [min, max] (F130 / F131). */
export function shownRaiseAmount(raiseAmount, minRaiseTotal, maxRaise) {
  const min = num(minRaiseTotal);
  const base = (typeof raiseAmount === 'number' && raiseAmount > 0) ? raiseAmount : min;
  const max = num(maxRaise);
  if (max > 0 && max >= min) return Math.max(min, Math.min(base, max));
  return base;
}

/** The bet button's verb: an opening bet is a Bet, never a "Raise" (F133). */
export function betVerb(currentBetToMatch) {
  return num(currentBetToMatch) === 0 ? 'Bet' : 'Raise';
}

/**
 * The Call button's real numbers (F126). A call bigger than his stack commits
 * only the stack (the server routes it to an all-in), and the part of the
 * bets he cannot match is not his to win: prior streets' money is fully
 * winnable (he matched every earlier bet), this street's bets only up to his
 * own cap (stack + this street's bet).
 * → { effectiveCall, callIsAllIn, effectivePot, potOdds, breakEvenPct, potOddsDisplay }
 */
export function callView({ callAmount, myChips, myCurrentBet, pot, seats, yourSeat } = {}) {
  const call = Math.max(0, num(callAmount));
  const chips = Math.max(0, num(myChips));
  const callIsAllIn = call > 0 && chips > 0 && call >= chips;
  const effectiveCall = callIsAllIn ? chips : call;
  let effectivePot = Math.max(0, num(pot));
  if (callIsAllIn && Array.isArray(seats)) {
    const heroCap = num(myCurrentBet) + chips;
    let streetBets = 0;
    let winnable = 0;
    seats.forEach((p, i) => {
      const b = Math.max(0, num(p && p.currentBet));
      streetBets += b;
      winnable += i === yourSeat ? b : Math.min(b, heroCap);
    });
    effectivePot = Math.max(0, effectivePot - streetBets) + winnable;
  }
  const potOdds = effectiveCall > 0 ? effectivePot / effectiveCall : 0;
  const breakEvenPct = effectiveCall > 0 ? Math.round(100 * effectiveCall / (effectivePot + effectiveCall)) : 0;
  const potOddsDisplay = effectiveCall > 0
    ? (Math.abs(potOdds - Math.round(potOdds)) < 0.05 ? `${Math.round(potOdds)}:1` : `${potOdds.toFixed(1)}:1`)
    : null;
  return { effectiveCall, callIsAllIn, effectivePot, potOdds, breakEvenPct, potOddsDisplay };
}

/**
 * A queued "Call Any" when the turn opens (F132): nothing to call is a CHECK
 * (a 'call' there is refused by the server); at an All-In-or-Fold table Call
 * Any is not offered (a call is refused there) → null (dropped).
 */
export function queuedCallAnyAction(callAmount, { isAof = false } = {}) {
  if (isAof) return null;
  return num(callAmount) === 0 ? 'check' : 'call';
}

/**
 * One line of the live action strip (GameHUD, Upgrade 6) for a seat whose
 * `lastAction` changed: the server enum ('Fold' / 'Check' / 'Call' / 'Raise' /
 * 'All-In') plus its bet before (`prevBet`) and now (`curBet`). Sit & Go
 * fix-all F2 (owner 2026-10-23): the first bet of a street (`streetOpen` - no
 * seat had a bet in the previous snapshot of the SAME street) is 'Name bet 40';
 * the enum stays 'Raise' on the server, so the client tells them apart. Every
 * other line is the strip's text as before. '' for nothing to show.
 */
export function stripActionEntry({ name, action, prevBet = 0, curBet = 0, streetOpen = false } = {}) {
  if (typeof action !== 'string' || !action) return '';
  const who = name || 'Player';
  const act = action.toLowerCase();
  const prev = num(prevBet);
  const cur = num(curBet);
  const delta = cur - prev;
  let entry;
  if (act.includes('fold')) entry = `${who} folded`;
  else if (act.includes('check')) entry = `${who} checked`;
  else if (act.includes('call')) entry = `${who} called ${cur > 0 ? cur.toLocaleString() : ''}`;
  else if (act.includes('raise') || act.includes('bet')) {
    if (streetOpen && cur > 0) entry = `${who} bet ${cur.toLocaleString()}`;
    else if (cur > 0 && delta > 0 && prev > 0) entry = `${who} raised to ${cur.toLocaleString()} (+${delta.toLocaleString()})`;
    else if (cur > 0) entry = `${who} raised to ${cur.toLocaleString()}`;
    else entry = `${who} raised`;
  } else if (act.includes('all-in') || act.includes('allin')) entry = `${who} went all-in`;
  else entry = `${who} ${action}`;
  return entry.trim();
}

/** A strip line that is an opening bet ('Name bet 40') - styled `action-hist-bet`. */
export function isStripBetEntry(text) {
  return typeof text === 'string' && / bet [\d,]+$/.test(text);
}

/**
 * Pre-actions offered at this table (F107). At All-In-or-Fold: Fold, plus
 * Check/Fold and Check when its server takes a free check (aofAllowsCheck —
 * each checks only when nothing is owed, else folds / waits); never Call Any
 * (a call is refused there). A queued key not in this list is dropped when
 * the turn opens.
 */
export function preActionKeysFor(gs) {
  if (!isAllInOrFoldTable(gs)) return ['fold', 'checkFold', 'callAny', 'checkOnly'];
  return aofAllowsCheck(gs) ? ['fold', 'checkFold', 'checkOnly'] : ['fold'];
}

/**
 * One server decision point for the hero (F130 / F131): his turn in this
 * hand, on this street (betting round), at this table. Two decisions in a row
 * (the big blind checks his option and is first on the flop) give two keys
 * although "is it my turn" never went false. Within one street the turn can
 * only come back to him after another seat acted (a frame where it was not
 * his turn), so the street is enough — and a mid-turn re-arm of the server's
 * turn clock can never reset a turn in progress. null when it is not his turn.
 */
export function turnDecisionKey({ isMyTurn, tableId, handNumber, phase } = {}) {
  if (!isMyTurn) return null;
  return `${tableId ?? ''}|${handNumber ?? ''}|${phase ?? ''}`;
}

/**
 * Draw rounds (F134 / G169 / G172).
 *  canDrawNow — the hero may still draw this round: dealt in, not folded /
 *               eliminated, not in the server's `drawsCompleted`. An ALL-IN
 *               seat draws too (F134 fix-up): all-in ends his betting, not his
 *               drawing — poker-server 8cbe8f8 (F27) waits for his draw every
 *               round and takes it; the older server stands him pat by putting
 *               his seat in `drawsCompleted` when the round starts, which hides
 *               the bar here the same way;
 *  drawClockKnown — the server sends the round's own clock (`drawStartedAt`);
 *  isMyDraw — he owes a draw and the clock is the draw clock.
 */
export function drawTurnInfo(gs, { yourSeat, yourCardsLen, myPlayer } = {}) {
  const hasDrawPhase = !!(gs && gs.hasDrawPhase);
  const isDrawPhase = !!(gs && gs.isDrawPhase);
  const done = gs && Array.isArray(gs.drawsCompleted) ? gs.drawsCompleted : [];
  const seated = Number.isInteger(yourSeat) && yourSeat >= 0 && !!myPlayer;
  const owes = seated && num(yourCardsLen) > 0 && !myPlayer.folded && !myPlayer.eliminated && !done.includes(yourSeat);
  const canDrawNow = hasDrawPhase && isDrawPhase && owes;
  const drawClockKnown = isDrawPhase && typeof gs.drawStartedAt === 'number' && gs.drawStartedAt > 0;
  const isMyDraw = drawClockKnown && owes;
  return { canDrawNow, drawClockKnown, isMyDraw };
}

/**
 * The selected discards belong to ONE draw round of one hand at one table
 * (G172): any change of this key clears them. Frames inside the round (other
 * players' draws) keep the key, so a selection in progress survives them.
 */
export function drawSelectionKey(gs) {
  if (!gs || typeof gs !== 'object') return '';
  return `${gs.tableId ?? ''}|${gs.handNumber ?? gs.handId ?? ''}|${gs.drawPhase ?? ''}|${gs.isDrawPhase ? 1 : 0}`;
}

/**
 * Hold'em pre-flop tier for the card glow / Call meta row (G173): only for a
 * two-card hand before the board — never Stud / Razz (two down cards of seven),
 * Draw / Badugi (lowball, five or four cards), Omaha (four to six) or
 * Pineapple before its discard (three).
 */
export function preflopTierOf(yourCards, communityCards, { isStudGame = false, hasDrawPhase = false } = {}) {
  if (isStudGame || hasDrawPhase) return null;
  if (!Array.isArray(yourCards) || yourCards.length !== 2) return null;
  if (Array.isArray(communityCards) && communityCards.length > 0) return null;
  const [c1, c2] = yourCards;
  if (!c1 || !c2) return null;
  const r1 = Math.max(c1.rank, c2.rank);
  const r2 = Math.min(c1.rank, c2.rank);
  const suited = c1.suit === c2.suit;
  const isPair = r1 === r2;
  // Premium: AA, KK, QQ, JJ, AKs, AKo
  if ((isPair && r1 >= 11) || (r1 === 14 && r2 === 13)) return 'premium';
  // Strong: TT-88, AQ, AJ, KQ suited
  if ((isPair && r1 >= 8) || (r1 === 14 && r2 >= 10) || (r1 === 13 && r2 === 12 && suited)) return 'strong';
  // Playable: 77-55, suited aces, broadway
  if ((isPair && r1 >= 5) || (r1 === 14 && suited) || (r1 >= 11 && r2 >= 10)) return 'playable';
  return 'marginal';
}

export const LEAVE_MID_TURN_TEXT = 'Leave the table mid-turn? Your hand will be auto-folded.';
export const LEAVE_FORFEIT_TEXT = 'Leave mid-hand? You\'ll forfeit any chips already in the pot.';
export const LEAVE_ALL_IN_KEPT_TEXT = 'You are all-in: you stay in this hand and anything you win goes to your balance when it ends. Leave the table?';

/**
 * The confirm shown before leaving a seat mid-hand, or null (F148). At a ring
 * table (`rebuyAllowed === true`: cash / private / club, the tables where the
 * server keeps an all-in leaver's hand and credits his result) an all-in seat
 * is not forfeiting anything. Elsewhere (quick tables fold the leaver's hand;
 * an older server that does not say) the forfeit text stays.
 */
export function leaveConfirmText({ inLiveHand, isMyTurn, seat, rebuyAllowed } = {}) {
  if (!inLiveHand) return null;
  if (isMyTurn) return LEAVE_MID_TURN_TEXT;
  const inPot = num(seat && seat.currentBet) > 0 || !(seat && seat.folded);
  if (!inPot) return null;
  if (seat && seat.allIn === true && !seat.folded && rebuyAllowed === true) return LEAVE_ALL_IN_KEPT_TEXT;
  return LEAVE_FORFEIT_TEXT;
}

/** Toast when 'Show Hand' is tapped while the hand is still being played (F21). */
export const SHOW_AT_HAND_END_TEXT = 'Your hand will be shown when this hand ends.';

const HAND_OVER_PHASES = new Set(['HandComplete', 'Showdown']);
/** The hand's betting is over: a folded hand may be shown now (F21). */
export function handIsOver(phase) {
  return HAND_OVER_PHASES.has(phase);
}

/**
 * A `muckedHandRevealed` frame (F21): 'ignore' (another table), 'hold' (the
 * hand it belongs to is still being played — an older server relaying an
 * older client's mid-hand show; shown when that hand ends) or 'show'.
 */
export function revealDecision(reveal, { shownTableId, handNumber, phase } = {}) {
  if (!reveal || typeof reveal !== 'object') return 'ignore';
  if (reveal.tableId != null && shownTableId != null && String(reveal.tableId) !== String(shownTableId)) return 'ignore';
  if (reveal.handNumber != null && handNumber != null && reveal.handNumber === handNumber && !handIsOver(phase)) return 'hold';
  return 'show';
}

/** A `pineappleDiscardAck` saying the pick came too late, for the table on screen (F34). */
export function pineappleAckRefused(ack, shownTableId) {
  if (!ack || typeof ack !== 'object' || ack.success !== false) return false;
  return ack.tableId == null || shownTableId == null || String(ack.tableId) === String(shownTableId);
}
