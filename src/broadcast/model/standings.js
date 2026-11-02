/**
 * Standings on air (lead spec C3 + §3 ProgramState.standings / event.prizes,
 * 2026-11-02): the chip leaders (top 10, paged), rank arrows, big blinds,
 * players left, the average stack and the seats / bubble line.
 *
 * Rank arrows: gold up, blue down, never red. The page of leaders shown is a
 * function of the PROGRAM clock (pageAt), so the 16:9 and 9:16 sources show
 * the same page at the same moment.
 *
 * Pure: the graphics and node:test. Names are the server's `name` only.
 */
import { isObj } from './contract.js';
import { broadcastName } from './broadcastNames.js';
import { formatChips, bbText } from './tableFormat.js';
import { seatPackageWords } from '../../content/qualifierRules.js';

export const LEADERS_MAX = 10;
export const LEADER_PAGE_MS = 8000;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function posInt(v) {
  return Number.isInteger(v) && v > 0 ? v : null;
}

/** 'up' | 'down' | 'same' | 'new' for a leader row (prevRank null = new on the board). */
export function rankMove(rank, prevRank) {
  if (!posInt(rank)) return 'same';
  if (!posInt(prevRank)) return 'new';
  if (prevRank > rank) return 'up';
  if (prevRank < rank) return 'down';
  return 'same';
}

/**
 * The leader rows as drawn: [{pid, name, chips, chipsText, bbText, tableNo,
 * rank, rankLabel, move, moveBy}]. Rows with equal chips share the first
 * row's rank and read 'T2'. `bigBlind` (the level in play) is the fallback
 * for a row without its own `bb`.
 */
export function leaderRows(standings, bigBlind = null) {
  const list = isObj(standings) && Array.isArray(standings.leaders) ? standings.leaders.filter(isObj) : [];
  const rows = list.slice(0, LEADERS_MAX).map((l, i) => {
    const chips = num(l.chips) ?? 0;
    const rank = posInt(l.rank) || i + 1;
    let bb = '';
    if (num(l.bb) !== null && l.bb > 0) bb = `${l.bb < 10 ? (Math.round(l.bb * 10) / 10).toString() : Math.round(l.bb).toLocaleString('en-US')} BB`;
    else if (num(bigBlind) !== null && bigBlind > 0) bb = bbText(chips, bigBlind);
    const prev = posInt(l.prevRank);
    return {
      pid: typeof l.pid === 'string' ? l.pid : `row-${i}`,
      name: broadcastName(l),
      chips,
      chipsText: formatChips(chips),
      bbText: bb,
      tableNo: posInt(l.tableNo),
      rank,
      rankLabel: String(rank),
      move: rankMove(rank, prev),
      moveBy: prev ? Math.abs(prev - rank) : 0,
    };
  });
  // Ties: equal chips share the rank of the first row of the group.
  for (let i = 0; i < rows.length; i += 1) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].chips === rows[i].chips) j += 1;
    if (j > i) {
      for (let k = i; k <= j; k += 1) {
        rows[k].rank = rows[i].rank;
        rows[k].rankLabel = `T${rows[i].rank}`;
      }
    }
    i = j;
  }
  return rows;
}

/** How many pages `rows` make at `pageSize`. */
export function pageCount(rows, pageSize) {
  const n = Array.isArray(rows) ? rows.length : 0;
  return n === 0 ? 0 : Math.ceil(n / Math.max(1, pageSize));
}

/** The page index shown at program time `programNow` (deterministic across sources). */
export function pageAt(programNow, pages, intervalMs = LEADER_PAGE_MS) {
  if (!(pages > 1) || !Number.isFinite(programNow)) return 0;
  return Math.floor(programNow / intervalMs) % pages;
}

/** The rows of page `page`. */
export function pageRows(rows, page, pageSize) {
  const size = Math.max(1, pageSize);
  return (Array.isArray(rows) ? rows : []).slice(page * size, page * size + size);
}

/** The event's on-air title: the producer's override, else the server name. */
export function eventTitle(program) {
  const ev = isObj(program) && isObj(program.event) ? program.event : null;
  const t = ev && typeof ev.title === 'string' && ev.title.trim() ? ev.title.trim() : (ev && typeof ev.name === 'string' ? ev.name.trim() : '');
  return (t || 'American Pub Poker').slice(0, 60);
}

/** '23 of 47 left' / '23 left' / ''. */
export function playersLine(standings) {
  if (!isObj(standings)) return '';
  const left = Number.isInteger(standings.playersLeft) && standings.playersLeft >= 0 ? standings.playersLeft : null;
  if (left === null) return '';
  const entries = posInt(standings.entries);
  return entries ? `${left.toLocaleString('en-US')} of ${entries.toLocaleString('en-US')} left` : `${left.toLocaleString('en-US')} left`;
}

/** 'Avg 20,435 · 51 BB' / 'Avg 20,435' / ''. */
export function avgLine(standings) {
  if (!isObj(standings) || !(num(standings.avgStack) > 0)) return '';
  const bb = num(standings.avgStackBb);
  return `Avg ${formatChips(standings.avgStack)}${bb && bb > 0 ? ` · ${bb < 10 ? Math.round(bb * 10) / 10 : Math.round(bb)} BB` : ''}`;
}

function packageTotal(pkg) {
  if (!isObj(pkg)) return null;
  let total = 0;
  for (const [k, v] of Object.entries(pkg)) {
    const place = Number(k);
    if (!Number.isInteger(place) || place <= 0 || !(Number.isInteger(v) && v > 0)) continue;
    total += v;
  }
  return total > 0 ? total : null;
}

/**
 * The prize half of the bar: 'Top 3 win a championship seat', 'Top 10 win 15
 * championship seats', 'The winner earns a championship seat', 'Top 3 win
 * chips', or '' when the program says nothing.
 */
export function prizeLine(event) {
  const p = isObj(event) && isObj(event.prizes) ? event.prizes : null;
  if (!p) return '';
  if (p.kind === 'seats') {
    const top = posInt(p.seatsForTop) || posInt(p.paidPlaces);
    if (!top) return '';
    const total = packageTotal(p.seatPackage) || top;
    if (top === 1 && total === 1) return 'The winner earns a championship seat';
    if (total === top) return `Top ${top} win a championship seat`;
    return `Top ${top} win ${total} championship seats`;
  }
  const paid = posInt(p.paidPlaces);
  return paid ? `Top ${paid} win chips` : '';
}

/**
 * The bubble half: 'On the bubble' (the server says so), '19 to the bubble'
 * (eliminations until the next one out just misses), 'Everyone left wins a
 * seat' / 'Everyone left wins chips' once the field is inside the prize
 * places, or ''.
 */
export function bubbleLine(event, standings) {
  const p = isObj(event) && isObj(event.prizes) ? event.prizes : null;
  if (!p) return '';
  if (p.onBubble === true) return 'On the bubble';
  const left = isObj(standings) && Number.isInteger(standings.playersLeft) ? standings.playersLeft : null;
  const paid = posInt(p.paidPlaces) || posInt(p.seatsForTop);
  if (left !== null && paid && left > 0 && left <= paid) {
    return p.kind === 'seats' ? 'Everyone left wins a seat' : 'Everyone left wins chips';
  }
  const bubble = posInt(p.bubblePlace);
  if (left !== null && bubble && left > bubble) {
    const n = left - bubble;
    return `${n.toLocaleString('en-US')} to the bubble`;
  }
  return '';
}

/** The whole seats line: 'Top 3 win a championship seat · 19 to the bubble'. */
export function seatsLine(event, standings) {
  return [prizeLine(event), bubbleLine(event, standings)].filter(Boolean).join(' · ');
}

/** When the cards are dealt: the event's dealsAt, else the clock's, else the scheduled start (program ms), or null. */
export function startTimeOf(program) {
  const ev = isObj(program) && isObj(program.event) ? program.event : {};
  const clock = isObj(program) && isObj(program.clock) ? program.clock : {};
  if (Number.isFinite(ev.dealsAt) && ev.dealsAt > 0) return ev.dealsAt;
  if (Number.isFinite(clock.dealsAt) && clock.dealsAt > 0) return clock.dealsAt;
  return Number.isFinite(ev.scheduledAt) && ev.scheduledAt > 0 ? ev.scheduledAt : null;
}

// Fix round 2026-11-02: a qualifier is entered by a top-5 finish in a live
// game, so "Play free at ..." misled a bar audience. This is the established,
// owner-approved qualifier wording (marketing WeeklyQualifierStrip: "Top 5 in
// any game gets you in." / "Free to play."). The producer's "How to enter"
// lower third uses this same constant.
export const DEFAULT_HOW_TO_ENTER = 'Top 5 in any game gets you in · Free to play at americanpubpoker.online';

/**
 * The starting-soon scene's rotating cards, each a true statement from the
 * program: the prize line with the seat package in words, free to play (play
 * money only), how to enter, and the owner's approved rules line (2),
 * "21+ to enter." word for word, with no body (fix round 2026-11-02: the
 * card had the line without its period plus a reworded body; never
 * paraphrase it).
 */
export function howItWorksCards(program) {
  const ev = isObj(program) && isObj(program.event) ? program.event : {};
  const prizes = isObj(ev.prizes) ? ev.prizes : {};
  const cards = [];
  const prize = prizeLine(ev);
  const words = prizes.kind === 'seats' ? seatPackageWords(prizes.seatPackage) : '';
  if (prize) cards.push({ head: prize, body: words || '' });
  cards.push({ head: 'Free to play', body: 'Play money only. No purchase necessary.' });
  const how = typeof ev.howToEnter === 'string' && ev.howToEnter.trim() ? ev.howToEnter.trim().slice(0, 120) : DEFAULT_HOW_TO_ENTER;
  cards.push({ head: 'How to enter', body: how });
  cards.push({ head: '21+ to enter.', body: '' });
  return cards;
}
