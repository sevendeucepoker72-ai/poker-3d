// programClock — the tournament clock on the PROGRAM timeline (lead spec C3,
// 2026-11-02): a delayed feed counts down the level the viewers are watching,
// paused and break states freeze, never red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { programClock, clockTone, clockStatusWord, countdownText, blindsLabel } from '../../src/broadcast/model/programClock.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../../src/broadcast/dev/fixtures/${name}.json`, import.meta.url), 'utf8'));
const T = 1_794_165_300_000;
const running = {
  clock: {
    level: 4, levels: 6, sb: 200, bb: 400, ante: 50, next: { sb: 300, bb: 600, ante: 75 },
    levelEndsAt: T + 540_000, serverNow: T, paused: false, pauseReason: null, breakUntil: null, dealsAt: null,
    playersLeft: 23, entries: 47, avgStack: 20435, paidPlaces: 3, levelDurationMs: 900_000, levelRemainingMs: null, resumesAt: null,
  },
};

test('running level: remaining = levelEndsAt - programNow; labels', () => {
  const pc = programClock(running, T);
  assert.equal(pc.remainingMs, 540_000);
  assert.equal(pc.clockText, '9:00');
  assert.equal(pc.levelLabel, 'Level 4 of 6');
  assert.equal(pc.blindsText, '200/400 · ante 50');
  assert.equal(pc.nextText, 'Next 300/600 · ante 75');
  assert.equal(pc.paused, false);
  assert.equal(pc.tone, 'blue');
  assert.equal(clockStatusWord(pc), '');
});

test('a 5-minute delayed feed shows the level 5 minutes ago (no spoiler of the live clock)', () => {
  const liveNow = T + 600_000; // live: the level ended a minute ago
  const delayMs = 5 * 60_000;
  const programNow = liveNow - delayMs; // what the viewers watch
  const pc = programClock(running, programNow);
  assert.equal(pc.remainingMs, 240_000, 'the delayed program still has 4:00 left');
  assert.equal(pc.clockText, '4:00');
  assert.equal(programClock(running, liveNow).remainingMs, 0, 'the live clock has run out');
});

test('break: the level time is frozen, the resume countdown runs on the program clock', () => {
  const p = fixture('break').snapshot.program;
  const at = p.programNow;
  const a = programClock(p, at);
  const b = programClock(p, at + 60_000);
  assert.equal(a.paused, true);
  assert.equal(a.pauseReason, 'break');
  assert.equal(a.remainingMs, 540_000);
  assert.equal(b.remainingMs, 540_000, 'frozen while on break');
  assert.equal(a.resumesInMs, 240_000);
  assert.equal(b.resumesInMs, 180_000);
  assert.equal(clockStatusWord(a), 'BREAK');
  assert.equal(countdownText(a.resumesAt, at), '4:00');
});

test('prestart: STARTS SOON with a deal countdown', () => {
  const p = fixture('starting').snapshot.program;
  const pc = programClock(p, p.programNow);
  assert.equal(pc.pauseReason, 'prestart');
  assert.equal(clockStatusWord(pc), 'STARTS SOON');
  assert.equal(pc.dealsInMs, 600_000);
});

test('final level reads "Final level"; hand-for-hand flags pass through', () => {
  const p = fixture('hfh').snapshot.program;
  const pc = programClock(p, p.programNow);
  assert.equal(pc.atTop, true);
  assert.equal(pc.nextText, 'Final level');
  assert.equal(pc.handForHand, true);
  assert.equal(pc.handForHandRound, 2);
});

test('no clock, a malformed clock, or no programNow never throw', () => {
  assert.equal(programClock(null, T), null);
  assert.equal(programClock({ clock: null }, T), null);
  assert.equal(programClock({ clock: { bb: 0 } }, T), null);
  assert.equal(programClock({ clock: 'x' }, T), null);
  const pc = programClock(running, NaN);
  assert.equal(pc.remainingMs, null);
  assert.equal(pc.clockText, '');
});

test('tones: blue, then gold, then amber in the last minute (never red)', () => {
  assert.equal(clockTone(600_000, 900_000), 'blue');
  assert.equal(clockTone(200_000, 900_000), 'gold');
  assert.equal(clockTone(59_000, 900_000), 'amber');
  assert.equal(clockTone(null, 900_000), 'blue');
  assert.equal(blindsLabel({ sb: 1000, bb: 2000, ante: 0 }), '1,000/2,000');
});
