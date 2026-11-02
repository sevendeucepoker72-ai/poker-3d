// standings — chip leaders, rank arrows, BB counts, ties, paging on the
// program clock, the seats / bubble line (lead spec C3, 2026-11-02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  leaderRows, rankMove, pageAt, pageCount, pageRows, playersLine, avgLine, prizeLine, bubbleLine,
  seatsLine, eventTitle, howItWorksCards, startTimeOf, LEADER_PAGE_MS, DEFAULT_HOW_TO_ENTER,
} from '../../src/broadcast/model/standings.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../../src/broadcast/dev/fixtures/${name}.json`, import.meta.url), 'utf8'));

test('rank arrows: up, down, same, new', () => {
  assert.equal(rankMove(3, 4), 'up');
  assert.equal(rankMove(4, 3), 'down');
  assert.equal(rankMove(2, 2), 'same');
  assert.equal(rankMove(5, null), 'new');
});

test('leader rows from the midgame fixture: names, chips, BB, arrows', () => {
  const p = fixture('midgame').snapshot.program;
  const rows = leaderRows(p.standings, 400);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].name, 'Mike R.');
  assert.equal(rows[0].chipsText, '61,200');
  assert.equal(rows[0].bbText, '153 BB');
  assert.equal(rows[2].name, 'Player', 'an opted-out player stays Player');
  assert.equal(rows[2].move, 'up');
  assert.equal(rows[3].move, 'down');
  assert.ok(rows.every((r) => !('playerId' in r)));
});

test('BB: the row bb first, else chips / the level big blind; one decimal under 10', () => {
  const rows = leaderRows({ leaders: [{ pid: 'b-1', name: 'A', chips: 3300, rank: 1 }, { pid: 'b-2', name: 'B', chips: 1000, bb: 2.5, rank: 2 }] }, 400);
  assert.equal(rows[0].bbText, '8.3 BB');
  assert.equal(rows[1].bbText, '2.5 BB');
  assert.equal(leaderRows({ leaders: [{ pid: 'b', name: 'C', chips: 10 }] }, null)[0].bbText, '');
});

test('ties: equal chips share the first rank, shown as T2', () => {
  const rows = leaderRows({ leaders: [
    { pid: 'a', name: 'A', chips: 900, rank: 1 },
    { pid: 'b', name: 'B', chips: 500, rank: 2 },
    { pid: 'c', name: 'C', chips: 500, rank: 3 },
    { pid: 'd', name: 'D', chips: 100, rank: 4 },
  ] });
  assert.deepEqual(rows.map((r) => r.rankLabel), ['1', 'T2', 'T2', '4']);
});

test('paging is a function of the program clock (both layouts show the same page)', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ pid: `p${i}` }));
  assert.equal(pageCount(rows, 5), 2);
  assert.equal(pageAt(0, 2), 0);
  assert.equal(pageAt(LEADER_PAGE_MS, 2), 1);
  assert.equal(pageAt(2 * LEADER_PAGE_MS + 5, 2), 0);
  assert.equal(pageAt(NaN, 2), 0);
  assert.deepEqual(pageRows(rows, 1, 5).map((r) => r.pid), ['p5', 'p6', 'p7', 'p8', 'p9']);
});

test('players, average, seats and bubble lines', () => {
  const p = fixture('midgame').snapshot.program;
  assert.equal(playersLine(p.standings), '23 of 47 left');
  assert.equal(avgLine(p.standings), 'Avg 20,435 · 51 BB');
  assert.equal(prizeLine(p.event), 'Top 3 win a championship seat');
  assert.equal(bubbleLine(p.event, p.standings), '19 to the bubble');
  assert.equal(seatsLine(p.event, p.standings), 'Top 3 win a championship seat · 19 to the bubble');
  const hfh = fixture('hfh').snapshot.program;
  assert.equal(bubbleLine(hfh.event, hfh.standings), 'On the bubble');
  assert.equal(bubbleLine({ prizes: { kind: 'seats', paidPlaces: 3, bubblePlace: 4 } }, { playersLeft: 3 }), 'Everyone left wins a seat');
});

test('a seat package: Top 10 win 15 championship seats; the winner-only and chip cases', () => {
  const pkg = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1 };
  assert.equal(prizeLine({ prizes: { kind: 'seats', seatsForTop: 10, seatPackage: pkg } }), 'Top 10 win 15 championship seats');
  assert.equal(prizeLine({ prizes: { kind: 'seats', seatsForTop: 1 } }), 'The winner earns a championship seat');
  assert.equal(prizeLine({ prizes: { kind: 'chips', paidPlaces: 3 } }), 'Top 3 win chips');
  assert.equal(prizeLine({}), '');
});

test('title, start time and the starting-soon cards (true statements only)', () => {
  const p = fixture('starting').snapshot.program;
  assert.equal(eventTitle(p), 'Weekly Qualifier');
  assert.equal(eventTitle({ event: { name: 'X', title: 'Producer title' } }), 'Producer title');
  assert.equal(eventTitle(null), 'American Pub Poker');
  assert.equal(startTimeOf(p), p.event.dealsAt);
  const cards = howItWorksCards(p);
  const text = JSON.stringify(cards);
  assert.match(text, /Top 3 win a championship seat/);
  assert.match(text, /1st, 2nd and 3rd win 1 seat each/);
  assert.match(text, /Play money only/);
  assert.match(text, /21\+ to enter/);
  assert.doesNotMatch(text, /\$|cash prize|real money/i);
});

test('fix round 2026-11-02: "How to enter" says a top-5 finish gets you in (the established qualifier wording), never "Play free at"', () => {
  const WORDING = 'Top 5 in any game gets you in · Free to play at americanpubpoker.online';
  assert.equal(DEFAULT_HOW_TO_ENTER, WORDING);
  // The dev fixtures carry what poker-server sends (howToEnter: null), so the default shows.
  const p = fixture('starting').snapshot.program;
  assert.equal(p.event.howToEnter, null);
  const how = howItWorksCards(p).find((c) => c.head === 'How to enter');
  assert.equal(how.body, WORDING);
  for (const c of howItWorksCards(p)) assert.doesNotMatch(`${c.head} ${c.body}`, /Play free at/);
  // A producer-set howToEnter still wins (unchanged), clipped to 120.
  const custom = howItWorksCards({ event: { howToEnter: '  Sign up at the bar  ' } }).find((c) => c.head === 'How to enter');
  assert.equal(custom.body, 'Sign up at the bar');
  // The other cards are kept.
  assert.deepEqual(howItWorksCards({ event: {} }).map((c) => c.head), ['Free to play', 'How to enter', '21+ to enter.']);
});

test('fix round 2026-11-02: the starting-soon 21+ card is approved rules line (2) word for word, with no paraphrased body', () => {
  for (const p of [fixture('starting').snapshot.program, { event: {} }, null]) {
    const age = howItWorksCards(p).filter((c) => /\b21\b/.test(`${c.head} ${c.body}`));
    assert.deepEqual(age, [{ head: '21+ to enter.', body: '' }]);
  }
  for (const c of howItWorksCards(fixture('starting').snapshot.program)) {
    assert.doesNotMatch(`${c.head} ${c.body}`, /21 or older|must be 21|Players must/i);
  }
});
