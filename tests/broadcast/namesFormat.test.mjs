// Names on air (owner 2026-11-02: First name + last initial, opt-out 'Player';
// the server applies it, the page renders only `name`) and the table texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { broadcastName, monogram, monogramHue } from '../../src/broadcast/model/broadcastNames.js';
import { formatChips, bbText, levelText, actionLine, winnerLines, potRows, turnFraction } from '../../src/broadcast/model/tableFormat.js';
import { isRedHue } from '../../src/utils/noRedHue.js';

test('only the server `name` field is rendered; never playerName; a missing name is Seat N', () => {
  assert.equal(broadcastName({ name: 'Mike R.', playerName: 'Michael Robertson' }, 0), 'Mike R.');
  assert.equal(broadcastName({ playerName: 'Michael Robertson' }, 2), 'Seat 3');
  assert.equal(broadcastName({ name: '   ' }, 0), 'Seat 1');
  assert.equal(broadcastName({ name: 'Player' }, 4), 'Player');
  assert.equal(broadcastName(null, null), 'Player');
  assert.equal(broadcastName({ name: `A${String.fromCharCode(0x202e)}B${String.fromCharCode(0)}C${String.fromCharCode(0x200b)}` }, 0), 'ABC', 'bidi / control / zero-width characters stripped');
  assert.ok(broadcastName({ name: 'x'.repeat(80) }, 0).length <= 24);
});

test('monograms and their hues (never red)', () => {
  assert.equal(monogram('Mike R.'), 'MR');
  assert.equal(monogram('Player'), 'P');
  assert.equal(monogram('Seat 3'), '3');
  assert.equal(monogram(''), '?');
  for (let i = 0; i < 2000; i += 1) assert.equal(isRedHue(monogramHue(`b-${i.toString(16)}`)), false);
});

test('chips, big blinds and the level line', () => {
  assert.equal(formatChips(12400), '12,400');
  assert.equal(formatChips(1250000), '1.25M');
  assert.equal(formatChips(12_000_000), '12M');
  assert.equal(formatChips(NaN), '0');
  assert.equal(bbText(9800, 400), '25 BB');
  assert.equal(bbText(3000, 400), '7.5 BB');
  assert.equal(bbText(100, 0), '');
  assert.equal(levelText({ sb: 200, bb: 400, ante: 50 }), 'Blinds 200/400 · ante 50');
  assert.equal(levelText({ sb: 50, bb: 100, ante: 0 }), 'Blinds 50/100');
});

test('action strip and winner lines use the on-air names', () => {
  const frame = { seats: [{ seatIndex: 2, name: 'Sarah K.' }], lastAction: { seatIndex: 2, text: 'raises to', amount: 2400 }, handResult: null };
  assert.equal(actionLine(frame), 'Sarah K. raises to 2,400');
  assert.equal(actionLine({ ...frame, lastAction: { seatIndex: 2, text: 'raises to 2,400', amount: 2400 } }), 'Sarah K. raises to 2,400');
  assert.equal(actionLine({ ...frame, lastAction: { seatIndex: 7, text: 'checks' } }), 'Seat 8 checks');
  const won = { seats: [{ seatIndex: 2, name: 'Sarah K.' }], handResult: { winners: [{ seatIndex: 2, name: 'Sarah K.', amount: 12400, handName: 'a Full House' }], showdownSeats: [], muckedSeats: [] } };
  assert.deepEqual(winnerLines(won), ['Sarah K. wins 12,400 with a Full House']);
});

test('pots and the turn clock', () => {
  assert.deepEqual(potRows({ pot: 900 }), [{ label: 'Pot', amount: 900 }]);
  assert.deepEqual(potRows({ pot: 1500, pots: [{ amount: 900, eligibleSeats: [1, 2, 3] }, { amount: 600, eligibleSeats: [1, 2] }] }).map((r) => r.label), ['Main', 'Side 1']);
  assert.deepEqual(potRows({ pot: 0 }), []);
  const many = potRows({ pot: 100, pots: [{ amount: 50 }, { amount: 20 }, { amount: 15 }, { amount: 10 }, { amount: 5 }] });
  assert.deepEqual(many, [{ label: 'Main', amount: 50 }, { label: 'Side 1', amount: 20 }, { label: 'Sides 2-4', amount: 30 }]);
  assert.equal(turnFraction({ turnStartedAt: 1000, turnTimeout: 20000 }, 11000), 0.5);
  assert.equal(turnFraction({ turnStartedAt: null, turnTimeout: 20000 }, 11000), null);
});
