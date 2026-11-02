// The delay bug (lead spec P5-C2b, 2026-11-02): 'Delayed broadcast · N min'
// on every delayed feed, nothing on the public feed; N reads the configured
// delay (heartbeat first, then the feed) and falls back to the owner's
// 5-minute default, so a delayed stream is never on air without its bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delayBugMinutes, delayBugText, DELAY_BUG_TEXT, DEFAULT_DELAY_MIN } from '../../src/broadcast/model/delayBug.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIN = 60_000;
const DELAYED = { mode: 'delayed', delayMs: 5 * MIN, holeCards: true, policy: 'delayed' };
const PUBLIC = { mode: 'public', delayMs: 0, holeCards: false, policy: 'off' };

test('public / unknown feed: no bug', () => {
  for (const feed of [PUBLIC, null, undefined, 'delayed', { ...DELAYED, mode: 'live' }]) {
    assert.equal(delayBugMinutes(feed, 5 * MIN), null);
    assert.equal(delayBugText(feed, 5 * MIN), null);
  }
});

test('delayed: the owner default reads "Delayed broadcast · 5 min"', () => {
  assert.equal(DELAY_BUG_TEXT, 'Delayed broadcast');
  assert.equal(DEFAULT_DELAY_MIN, 5);
  assert.equal(delayBugText(DELAYED, 5 * MIN), 'Delayed broadcast · 5 min');
  assert.equal(delayBugText(DELAYED, undefined), 'Delayed broadcast · 5 min', 'feed delay when there is no heartbeat value');
});

test('delayed: a longer configured delay is read, never a fixed number', () => {
  assert.equal(delayBugMinutes({ ...DELAYED, delayMs: 30 * MIN }, 30 * MIN), 30);
  assert.equal(delayBugMinutes(DELAYED, 12 * MIN), 12, 'the heartbeat delay wins over the feed');
  assert.equal(delayBugMinutes({ ...DELAYED, delayMs: 10 * MIN }, Number.NaN), 10);
  assert.equal(delayBugMinutes(DELAYED, 7.4 * MIN), 7);
});

test('delayed with a missing or junk delay: still shown, at the 5-minute default', () => {
  for (const feed of [{ ...DELAYED, delayMs: 0 }, { ...DELAYED, delayMs: Number.NaN }, { mode: 'delayed' }]) {
    assert.equal(delayBugText(feed, 0), 'Delayed broadcast · 5 min');
    assert.equal(delayBugText(feed, -5), 'Delayed broadcast · 5 min');
  }
});

test('DelayBug.jsx draws the model text and keeps its lock-token class', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/broadcast/ui/graphics/DelayBug.jsx'), 'utf8');
  assert.match(src, /delayBugMinutes/);
  assert.match(src, /className="bc-delay-bug"/);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /\b15\b|\b30\b|\b45\b/, 'no hard-coded minute count');
});
