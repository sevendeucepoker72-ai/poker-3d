// sceneMachine — the pure scene choice (lead spec R2 + C4, 2026-11-02):
// table-driven per fixture state; a stale feed overrides everything; a
// producer pin beats auto; results never before programNow reaches the
// finish; the final-table intro once per event; 16:9 and 9:16 agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  chooseScene, autoScene, resultsVisible, finishTimeOf, finalIntroWindow, finalIntroCard, pinnedIntroCard,
  finalIntroDuration, FINAL_INTRO_LEAD_MS, FINAL_INTRO_PER_SEAT_MS,
} from '../../src/broadcast/model/sceneMachine.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../../src/broadcast/dev/fixtures/${name}.json`, import.meta.url), 'utf8'));
const prog = (name) => fixture(name).snapshot.program;
const at = (p, plus = 0) => p.programNow + plus;

test('table-driven: each recorded state gives its scene', () => {
  const cases = [
    ['starting', 'starting'],
    ['midgame', 'table'],
    ['break', 'break'],
    ['hfh', 'hfh'],
    ['finalTable', 'finalIntro'],
    ['results', 'results'],
    ['showdown-public', 'table'],
    ['showdown-delayed', 'table'],
  ];
  for (const [name, scene] of cases) {
    const p = prog(name);
    assert.equal(chooseScene({ program: p, programNow: at(p) }).id, scene, name);
  }
});

test('a stale feed shows the slate, whatever the program says (pinned or not)', () => {
  for (const name of ['midgame', 'results', 'finalTable', 'starting']) {
    const p = prog(name);
    assert.equal(chooseScene({ program: p, programNow: at(p), stale: true }).id, 'slate', name);
    const pinned = { ...p, scene: { id: 'table', auto: false, since: 0 } };
    assert.equal(chooseScene({ program: pinned, programNow: at(p), stale: true }).id, 'slate', `${name} pinned`);
  }
  assert.equal(chooseScene({ program: null, programNow: 1 }).id, 'slate');
});

test('a producer pin beats auto (any scene)', () => {
  const p = prog('midgame');
  for (const id of ['starting', 'break', 'room', 'slate', 'recap', 'hfh']) {
    const pinned = { ...p, scene: { id, auto: false, since: p.programNow } };
    const c = chooseScene({ program: pinned, programNow: at(p) });
    assert.equal(c.id, id);
    assert.equal(c.pinned, true);
  }
  const junk = { ...p, scene: { id: 'evil', auto: false, since: 0 } };
  assert.equal(chooseScene({ program: junk, programNow: at(p) }).id, 'slate');
});

test('results are never shown before programNow reaches the finish (auto or pinned)', () => {
  const p = prog('results');
  const finish = finishTimeOf(p);
  assert.equal(finish, p.ticker.find((t) => t.kind === 'finished').t);
  assert.equal(resultsVisible(p, finish - 1), false);
  assert.equal(resultsVisible(p, finish), true);
  assert.equal(resultsVisible(p, NaN), false, 'no clock: fail closed');
  assert.notEqual(chooseScene({ program: p, programNow: finish - 5000 }).id, 'results');
  // A producer pins Results while the delayed program is still behind the finish.
  const pinned = { ...p, scene: { id: 'results', auto: false, since: 0 } };
  const early = chooseScene({ program: pinned, programNow: finish - 5000 });
  assert.notEqual(early.id, 'results');
  assert.equal(early.reason, 'results_pending');
  assert.equal(chooseScene({ program: pinned, programNow: finish + 1 }).id, 'results');
});

test('results need rows and a finished event', () => {
  const p = prog('results');
  assert.equal(resultsVisible({ ...p, results: [] }, at(p, 10_000)), false);
  assert.equal(resultsVisible({ ...p, results: null }, at(p, 10_000)), false);
  assert.equal(resultsVisible({ ...p, event: { ...p.event, status: 'running' } }, at(p, 10_000)), false);
  // Without a 'finished' ticker item the frame's own programNow is the finish.
  const noTicker = { ...p, ticker: [] };
  assert.equal(resultsVisible(noTicker, p.programNow - 1), false);
  assert.equal(resultsVisible(noTicker, p.programNow), true);
});

test('final-table intro: once per event, from the first finalTable ticker item', () => {
  const p = prog('finalTable');
  const w = finalIntroWindow(p);
  const first = p.ticker.find((t) => t.kind === 'finalTable').t;
  assert.equal(w.start, first);
  assert.equal(w.end - w.start, finalIntroDuration(9));
  assert.equal(finalIntroDuration(9), FINAL_INTRO_LEAD_MS + 9 * FINAL_INTRO_PER_SEAT_MS);
  assert.equal(chooseScene({ program: p, programNow: w.start + 1 }).id, 'finalIntro');
  assert.equal(chooseScene({ program: p, programNow: w.end }).id, 'table', 'after the window: the table');
  // The final table re-featured later (featured.since moves): the intro does NOT replay.
  const refeatured = { ...p, featured: { ...p.featured, since: w.end + 600_000 } };
  assert.equal(chooseScene({ program: refeatured, programNow: w.end + 600_001 }).id, 'table');
  // A source loaded after the window never sees it.
  assert.equal(finalIntroCard(p, w.end + 1), null);
});

test('final-table intro cards: lead-in, then 4 s per seat, same card for both layouts', () => {
  const p = prog('finalTable');
  const w = finalIntroWindow(p);
  assert.equal(finalIntroCard(p, w.start + 100).leadIn, true);
  const c0 = finalIntroCard(p, w.start + FINAL_INTRO_LEAD_MS);
  assert.equal(c0.index, 0);
  assert.equal(c0.seat.name, 'Mike R.');
  const c3 = finalIntroCard(p, w.start + FINAL_INTRO_LEAD_MS + 3 * FINAL_INTRO_PER_SEAT_MS + 10);
  assert.equal(c3.index, 3);
  // Pure: the same inputs give the same card (the 16:9 and 9:16 pages agree).
  assert.deepEqual(finalIntroCard(p, w.start + 9000), finalIntroCard(structuredClone(p), w.start + 9000));
});

test('a pinned intro loops from scene.since; without a final table the pin falls back to the table', () => {
  const p = prog('finalTable');
  const since = p.programNow;
  const pinned = { ...p, scene: { id: 'finalIntro', auto: false, since } };
  const lap = FINAL_INTRO_LEAD_MS + 9 * FINAL_INTRO_PER_SEAT_MS;
  assert.equal(pinnedIntroCard(pinned, since + FINAL_INTRO_LEAD_MS + 9 * FINAL_INTRO_PER_SEAT_MS + 1).index, 0, 'loops');
  assert.ok(lap > 0);
  const noFt = { ...prog('midgame'), scene: { id: 'finalIntro', auto: false, since } };
  assert.equal(chooseScene({ program: noFt, programNow: since + 1 }).id, 'table');
});

test('auto: prestart clock = starting; cancelled = slate; hand-for-hand = hfh; break wins over hfh', () => {
  const mid = prog('midgame');
  const prestart = { ...mid, clock: { ...mid.clock, paused: true, pauseReason: 'prestart' } };
  assert.equal(autoScene(prestart, at(mid)).id, 'starting');
  assert.equal(autoScene({ ...mid, event: { ...mid.event, status: 'cancelled' } }, at(mid)).id, 'slate');
  const hfh = prog('hfh');
  assert.equal(autoScene(hfh, at(hfh)).id, 'hfh');
  const brk = { ...hfh, clock: { ...hfh.clock, paused: true, pauseReason: 'break' } };
  assert.equal(autoScene(brk, at(hfh)).id, 'break');
});

test('the server suggestion is ignored while auto (the page decides from the data)', () => {
  const mid = prog('midgame');
  const wrong = { ...mid, scene: { id: 'results', auto: true, since: 0 } };
  assert.equal(chooseScene({ program: wrong, programNow: at(mid) }).id, 'table');
});
