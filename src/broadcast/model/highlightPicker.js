/**
 * Highlight picker for the cards-up recap (lead spec C7 / P6, 2026-11-02).
 * AFTER the event only: the producer's Recap tab asks poker-server for the
 * event's hands (`bc:producer:recapHands {tournamentId}`, refused with
 * 'event_not_finished' while it runs) and this ranks them:
 *   seat-winning hand > bubble hand > final-table elimination > all-in
 *   showdown (by pot) > cooler > biggest pots.
 * It reads the server's `tags` first and falls back to its own reading of the
 * hand record (poker-server HandHistoryRecord: players[].startChips /
 * endChips / folded / holeCards / actions, winners[].chipsWon, pots[].amount).
 *
 * Pure and deterministic (ties broken by table, then hand number): the same
 * hands always give the same reel. It never decides whether a card may be
 * shown — the recap data only exists after the event.
 */
import { isObj } from './contract.js';

export const HIGHLIGHT_MAX = 8;

/** Server tag -> base score. Unknown tags score nothing. */
export const TAG_SCORES = Object.freeze({
  seat_won: 1000,
  champion: 950,
  bubble: 900,
  final_table_bust: 700,
  elimination: 500,
  all_in_showdown: 400,
  cooler: 350,
  double_up: 300,
  big_pot: 200,
});

const TAG_LABELS = Object.freeze({
  seat_won: 'Seat won',
  champion: 'Winning hand',
  bubble: 'Bubble hand',
  final_table_bust: 'Final table knockout',
  elimination: 'Knockout',
  all_in_showdown: 'All-in showdown',
  cooler: 'Cooler',
  double_up: 'Double up',
  big_pot: 'Big pot',
});

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** The hand's total pot from the record (pots, else what the winners took). */
export function recordPot(record) {
  if (!isObj(record)) return 0;
  const pots = Array.isArray(record.pots) ? record.pots.filter(isObj) : [];
  const fromPots = pots.reduce((s, p) => s + Math.max(0, num(p.amount)), 0);
  if (fromPots > 0) return fromPots;
  const winners = Array.isArray(record.winners) ? record.winners.filter(isObj) : [];
  return winners.reduce((s, w) => s + Math.max(0, num(w.chipsWon)), 0);
}

function players(record) {
  return isObj(record) && Array.isArray(record.players) ? record.players.filter(isObj) : [];
}

/** Tags read from the record itself (used when the server sent none). */
export function inferredTags(record) {
  const ps = players(record);
  const tags = new Set();
  const allIn = ps.some((p) => Array.isArray(p.actions) && p.actions.some((a) => /all-?in/i.test(String(a))));
  const shown = ps.filter((p) => p.folded !== true && Array.isArray(p.holeCards) && p.holeCards.length > 0);
  if (allIn && shown.length >= 2) tags.add('all_in_showdown');
  const busted = ps.filter((p) => num(p.startChips) > 0 && num(p.endChips) === 0);
  if (busted.length > 0) tags.add('elimination');
  const doubled = ps.some((p) => num(p.startChips) > 0 && num(p.endChips) >= 2 * num(p.startChips) && allIn);
  if (doubled) tags.add('double_up');
  // A cooler: two players went to showdown with made hands the server named.
  const named = shown.filter((p) => typeof p.handName === 'string' && /(full house|four of a kind|straight flush|flush|straight)/i.test(p.handName));
  if (named.length >= 2) tags.add('cooler');
  return [...tags];
}

/**
 * Rank the event's hands: [{hand, score, tags, label, pot}] best first, at most `max`.
 * `hands` = recapHands' `hands` [{handId, tableNo, handNumber, level, record, tags}].
 */
export function pickHighlights(hands, { max = HIGHLIGHT_MAX } = {}) {
  const list = Array.isArray(hands) ? hands.filter((h) => isObj(h) && isObj(h.record)) : [];
  const pots = list.map((h) => recordPot(h.record));
  const maxPot = pots.reduce((m, p) => Math.max(m, p), 0);
  const scored = list.map((hand, i) => {
    const sent = Array.isArray(hand.tags) ? hand.tags.filter((t) => typeof t === 'string' && TAG_SCORES[t] !== undefined) : [];
    const tags = sent.length ? sent : inferredTags(hand.record);
    const pot = pots[i];
    let score = tags.reduce((m, t) => Math.max(m, TAG_SCORES[t] || 0), 0);
    // Pot size breaks ties within a class (0..100), and is the whole score of an untagged hand.
    score += maxPot > 0 ? Math.round((pot / maxPot) * 100) : 0;
    if (!tags.length && maxPot > 0 && pot >= maxPot * 0.6) tags.push('big_pot');
    const best = tags.slice().sort((a, b) => (TAG_SCORES[b] || 0) - (TAG_SCORES[a] || 0))[0];
    return { hand, score, tags, label: best ? TAG_LABELS[best] : 'Hand', pot };
  });
  scored.sort((a, b) => (b.score - a.score)
    || (num(a.hand.tableNo) - num(b.hand.tableNo))
    || (num(a.hand.handNumber) - num(b.hand.handNumber)));
  return scored.slice(0, Math.max(0, max));
}
