// tickerFormat — the bust ticker's lines (lead spec C3 + §3 TickerEvent,
// 2026-11-02): ordinals, seat words, de-duplication by id, the cap at 30, and
// nothing stamped after the program clock (no spoiler on a delayed feed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tickerItem, mergeTicker, latestTickerItems, ordinal, seatsWord, TICKER_KINDS, TICKER_SHOW_MAX,
} from '../../src/broadcast/model/tickerFormat.js';

const T = 1_794_165_000_000;

test('ordinals and seat words', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 112].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '112th']);
  assert.equal(ordinal(0), '');
  assert.equal(seatsWord(1), '1 seat');
  assert.equal(seatsWord(3), '3 seats');
  assert.equal(seatsWord(0), '');
});

test('a bust: place, name, who busted him', () => {
  const it = tickerItem({ id: 'a', t: T, kind: 'bust', name: 'Rob S.', place: 14, of: 47, byName: 'Sarah K.', tableNo: 1 });
  assert.equal(it.label, 'OUT');
  assert.equal(it.text, '14th · Rob S. · busted by Sarah K.');
  assert.equal(it.tone, 'slate');
});

test('a seat-winning bust is SEAT WON with the seat count (gold)', () => {
  const it = tickerItem({ id: 'b', t: T, kind: 'bust', name: 'Ana P.', place: 3, seatsWon: 1 });
  assert.equal(it.label, 'SEAT WON');
  assert.equal(it.text, '3rd · Ana P. (1 seat)');
  assert.equal(it.tone, 'gold');
  const tied = tickerItem({ id: 'c', t: T, kind: 'bust', name: 'Ana P.', place: 2, seatsWon: 2, tied: true });
  assert.equal(tied.text, '2nd · Ana P. (tied) (2 seats)');
});

test('a Sit & Go prize is chips (play money), never a currency', () => {
  const it = tickerItem({ id: 'd', t: T, kind: 'bust', name: 'Kim L.', place: 2, amount: 1500 });
  assert.equal(it.text, '2nd · Kim L. · 1,500 chips');
  assert.doesNotMatch(it.text, /\$|USD|dollar/i);
});

test('every kind has a line; an unknown kind or junk is dropped', () => {
  for (const kind of TICKER_KINDS) {
    const it = tickerItem({ id: kind, t: T, kind, name: 'A. B.', level: 3, tableNo: 2, amount: 5000, place: 9 });
    assert.ok(it && it.text && it.label, kind);
  }
  assert.equal(tickerItem({ id: 'x', kind: 'mystery' }), null);
  assert.equal(tickerItem(null), null);
  assert.equal(tickerItem('bust'), null);
});

test('a missing name never shows an id: the line says Player', () => {
  const it = tickerItem({ id: 'e', t: T, kind: 'bust', place: 9, pid: 'b-0123456789abcdef', playerId: 'secret-id' });
  assert.equal(it.text, '9th · Player');
  assert.doesNotMatch(JSON.stringify(it), /secret-id|b-0123456789abcdef/);
});

test('merge: program copy wins, event frames after it, de-duplicated by id, oldest first', () => {
  const program = [{ id: '1', t: T, kind: 'levelUp', level: 4 }, { id: '2', t: T + 10, kind: 'bust', name: 'A. B.', place: 9 }];
  const events = [{ id: '2', t: T + 10, kind: 'bust', name: 'CHANGED', place: 9 }, { id: '3', t: T + 20, kind: 'doubleUp', name: 'C. D.' }];
  const merged = mergeTicker(program, events, T + 100);
  assert.deepEqual(merged.map((e) => e.id), ['1', '2', '3']);
  assert.equal(merged[1].name, 'A. B.');
  const latest = latestTickerItems(merged, 2);
  assert.deepEqual(latest.map((i) => i.id), ['3', '2'], 'newest first');
});

test('merge: an item stamped after the program clock is held back (5 s grace)', () => {
  const program = [{ id: '1', t: T, kind: 'levelUp', level: 4 }];
  const events = [{ id: 'late', t: T + 60_000, kind: 'bust', name: 'Spoiler', place: 2 }];
  assert.deepEqual(mergeTicker(program, events, T + 1000).map((e) => e.id), ['1']);
  assert.deepEqual(mergeTicker(program, events, T + 56_000).map((e) => e.id), ['1', 'late'], 'within grace');
  assert.deepEqual(mergeTicker(program, events, NaN).map((e) => e.id), ['1', 'late'], 'no clock: show');
});

test('merge: capped at 30, keeping the newest', () => {
  const list = Array.from({ length: 80 }, (_, i) => ({ id: `k${i}`, t: T + i, kind: 'levelUp', level: i + 1 }));
  const merged = mergeTicker(list, [], T + 1000);
  assert.equal(merged.length, TICKER_SHOW_MAX);
  assert.equal(merged[0].id, 'k50');
  assert.equal(merged[29].id, 'k79');
});
