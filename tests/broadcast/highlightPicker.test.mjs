// highlightPicker — ranks the event's hands for the cards-up recap (lead spec
// C7 / P6, 2026-11-02): server tags first, own reading of the record as the
// fallback, deterministic order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickHighlights, inferredTags, recordPot } from '../../src/broadcast/model/highlightPicker.js';

const card = (rank, suit) => ({ rank, suit });
function record({ pot = 1000, allIn = false, bust = false, shown = 2, hands = [null, null], doubled = false } = {}) {
  const players = [0, 1, 2].map((i) => ({
    seatIndex: i,
    name: `P${i}`,
    holeCards: i < shown ? [card(14, i), card(13, i)] : null,
    startChips: 1000,
    endChips: i === 1 && bust ? 0 : (i === 0 && doubled ? 2100 : 1000),
    actions: allIn && i < 2 ? ['went all-in for 1000'] : ['called 100'],
    folded: i >= shown,
    handName: hands[i] || null,
  }));
  return { handNumber: 1, players, winners: [{ seatIndex: 0, name: 'P0', chipsWon: pot, handName: 'Pair' }], pots: [{ amount: pot, winners: [0] }] };
}
const hand = (n, rec, tags) => ({ handId: `h${n}`, tableNo: 1, handNumber: n, level: 3, record: rec, ...(tags ? { tags } : {}) });

test('pot comes from the pots, else what the winners took', () => {
  assert.equal(recordPot(record({ pot: 4200 })), 4200);
  assert.equal(recordPot({ winners: [{ chipsWon: 300 }, { chipsWon: 200 }] }), 500);
  assert.equal(recordPot(null), 0);
});

test('own reading: all-in showdown, knockout, double up, cooler', () => {
  const tags = inferredTags(record({ allIn: true, bust: true, doubled: true, hands: ['Full House', 'Flush'] }));
  assert.ok(tags.includes('all_in_showdown'));
  assert.ok(tags.includes('elimination'));
  assert.ok(tags.includes('double_up'));
  assert.ok(tags.includes('cooler'));
  assert.deepEqual(inferredTags(record({ shown: 0 })), []);
});

test('ranking: seat won > bubble > final-table knockout > all-in showdown > biggest pot', () => {
  const hands = [
    hand(1, record({ pot: 99999 })),
    hand(2, record({ pot: 500, allIn: true })),
    hand(3, record({ pot: 800 }), ['final_table_bust']),
    hand(4, record({ pot: 100 }), ['bubble']),
    hand(5, record({ pot: 100 }), ['seat_won']),
  ];
  const picked = pickHighlights(hands);
  assert.deepEqual(picked.map((p) => p.hand.handNumber), [5, 4, 3, 2, 1]);
  assert.equal(picked[0].label, 'Seat won');
  assert.equal(picked[4].label, 'Big pot');
});

test('deterministic: ties by table then hand number; max respected; junk ignored', () => {
  const hands = [hand(9, record({ pot: 100 })), hand(3, record({ pot: 100 })), null, { record: null }];
  const a = pickHighlights(hands);
  const b = pickHighlights(structuredClone(hands));
  assert.deepEqual(a.map((p) => p.hand.handNumber), [3, 9]);
  assert.deepEqual(a.map((p) => p.hand.handNumber), b.map((p) => p.hand.handNumber));
  assert.equal(pickHighlights(hands, { max: 1 }).length, 1);
  assert.deepEqual(pickHighlights(null), []);
});
