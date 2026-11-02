// Feed health (R9: amber at 6 s, slate at 15 s, back after 2 good beats) and
// the stage geometry (C1 / C5: 16:9 and 9:16, any source size, safe zones),
// plus the fixed seat ring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialFeedHealth, onBeat, evaluateFeedHealth, feedAgeMs, levelForAge, AMBER_AFTER_MS, STALE_AFTER_MS,
} from '../../src/broadcast/model/feedHealth.js';
import { fitStage, stageSize, safeZone, boxInSafeZone } from '../../src/broadcast/model/layoutFit.js';
import { seatPositions, seatCountOf } from '../../src/broadcast/model/seatLayout.js';

test('thresholds: amber after 6 s, stale after 15 s', () => {
  assert.equal(AMBER_AFTER_MS, 6000);
  assert.equal(STALE_AFTER_MS, 15000);
  assert.equal(levelForAge(5999), 'ok');
  assert.equal(levelForAge(6001), 'amber');
  assert.equal(levelForAge(15001), 'stale');
  assert.equal(levelForAge(NaN), 'stale');
});

test('a fake clock: ok -> amber -> stale, then 2 good beats to recover (hysteresis)', () => {
  let h = initialFeedHealth();
  assert.equal(h.status, 'connecting');
  assert.equal(feedAgeMs(h, 0), Infinity);
  h = onBeat(h, 0);
  assert.equal(h.status, 'ok');
  for (let t = 2000; t <= 10000; t += 2000) h = onBeat(h, t);
  assert.equal(evaluateFeedHealth(h, 15000).status, 'ok');
  h = evaluateFeedHealth(h, 16500);
  assert.equal(h.status, 'amber');
  h = evaluateFeedHealth(h, 25500);
  assert.equal(h.status, 'stale');
  h = onBeat(h, 26000);
  assert.equal(h.status, 'stale', 'one beat is not enough');
  h = onBeat(h, 28000);
  assert.equal(h.status, 'ok', 'two good beats in a row recover');
});

test('a flapping link does not recover on beats spaced past the amber threshold', () => {
  let h = onBeat(initialFeedHealth(), 0);
  h = evaluateFeedHealth(h, 7000);
  assert.equal(h.status, 'amber');
  h = onBeat(h, 7500);
  h = onBeat(h, 14000);   // 6.5 s gap: not a good beat
  assert.equal(h.status, 'amber');
  h = onBeat(h, 15000);
  assert.equal(h.status, 'ok');
});

test('stage: fixed logical canvas per layout', () => {
  assert.deepEqual(stageSize('16x9'), { w: 1920, h: 1080 });
  assert.deepEqual(stageSize('9x16'), { w: 1080, h: 1920 });
  assert.deepEqual(stageSize('bogus'), { w: 1920, h: 1080 });
});

test('stage: scale at 1280x720, 1920x1080, 1080x1920 and 540x960', () => {
  assert.equal(fitStage('16x9', 1280, 720).scale, 1280 / 1920);
  assert.equal(fitStage('16x9', 1920, 1080).scale, 1);
  assert.equal(fitStage('9x16', 1080, 1920).scale, 1);
  assert.equal(fitStage('9x16', 540, 960).scale, 0.5);
  const box = fitStage('16x9', 1080, 1920);   // a 16:9 page in a tall source: letterboxed, centred
  assert.equal(box.scale, 1080 / 1920);
  assert.equal(box.offsetX, 0);
  assert.equal(box.offsetY, Math.round((1920 - 1080 * box.scale) / 2));
  assert.equal(fitStage('16x9', 0, 0).scale, 1);
});

test('9:16 safe zones keep the top 12% and bottom 20% clear; 16:9 has none', () => {
  const z = safeZone('9x16');
  assert.equal(z.top, Math.round(1920 * 0.12));
  assert.equal(z.bottom, Math.round(1920 * 0.2));
  assert.equal(safeZone('16x9').top, 0);
  assert.equal(boxInSafeZone('9x16', { x: 0, y: 0, w: 100, h: 100 }), false);
  assert.equal(boxInSafeZone('9x16', { x: 0, y: 400, w: 1080, h: 800 }), true);
  assert.equal(boxInSafeZone('9x16', { x: 0, y: 1400, w: 100, h: 300 }), false);
});

test('seat ring: fixed angles for 2-10 seats, seat 0 at the bottom, inside the box', () => {
  for (let n = 2; n <= 10; n += 1) {
    for (const layout of ['16x9', '9x16']) {
      const p = seatPositions(n, layout);
      assert.equal(p.length, n);
      assert.equal(p[0].side, 'bottom');
      assert.ok(Math.abs(p[0].x - 50) < 0.01);
      assert.deepEqual(p.map((s) => s.seatIndex), Array.from({ length: n }, (_, i) => i));
      for (const s of p) {
        assert.ok(s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100, `${layout} ${n}: seat ${s.seatIndex} inside`);
        assert.ok(['top', 'bottom', 'left', 'right'].includes(s.side));
      }
      if (layout === '9x16') {
        // nothing in the middle band the board uses: seats are columns (or top / bottom centre)
        assert.ok(p.every((s) => s.x <= 12 || s.x >= 88 || s.x === 50), 'column seats stay out of the middle');
      }
      // fixed places: the same answer every time (a seat never moves on air)
      assert.deepEqual(seatPositions(n, layout), p);
    }
  }
  assert.equal(seatCountOf(1), 2);
  assert.equal(seatCountOf(12), 10);
  assert.equal(seatCountOf(undefined), 9);
  // 9:16 puts the side seats in a left and a right column
  const tall = seatPositions(9, '9x16');
  assert.ok(tall.some((s) => s.side === 'left') && tall.some((s) => s.side === 'right'));
});
