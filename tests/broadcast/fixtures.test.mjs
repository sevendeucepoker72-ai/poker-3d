// The broadcast fixtures (lead spec §2 hand-off + C10): every DEV fixture
// matches the §3 contract, carries no forbidden key, and — deep scan — a
// PUBLIC fixture never produces a face-up card outside a contested showdown
// once it goes through the store and holeCardGate. When poker-server's S7a
// fixtures are copied into src/broadcast/dev/fixtures/ they get the same checks.
// The fixtures never reach a production build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSnapshot, checkFrameMsg, forbiddenKeyPaths, releaseRuleProblems } from './helpers/contractShape.mjs';
import { initialProgramState, applySnapshot, applyFrame } from '../../src/broadcast/model/programStore.js';
import { gateHoleCards, isContestedShowdown, resetDropLog } from '../../src/broadcast/model/holeCardGate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'src/broadcast/dev/fixtures');
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const quiet = () => {};

test('there are fixtures for every scene the page draws', () => {
  for (const name of ['starting', 'midgame', 'break', 'hfh', 'finalTable', 'showdown-public', 'results', 'showdown-delayed']) {
    assert.ok(FILES.includes(`${name}.json`), `${name}.json`);
  }
});

for (const f of FILES) {
  test(`${f}: matches the v1 contract and carries no forbidden key`, () => {
    const fx = load(f);
    assert.deepEqual(checkSnapshot(fx.snapshot), []);
    (fx.frames || []).forEach((fr, i) => assert.deepEqual(checkFrameMsg(fr.msg, i), [], `${f} frame ${i}`));
    assert.deepEqual(forbiddenKeyPaths(fx), []);
  });
}

// Every face-up card a fixture would put on screen, after the store + the gate.
function faceUpCards(fx) {
  resetDropLog();
  const seen = [];
  let s = applySnapshot(initialProgramState(), fx.snapshot, 0);
  const look = (state, when) => {
    if (!state.table) return;
    const serverNow = Number.isFinite(when) ? when : state.serverNow;
    const g = gateHoleCards(state.table, state.feed, { serverNow, log: quiet });
    for (const [idx, d] of Object.entries(g.seats)) {
      if (d.cards) seen.push({ handNumber: state.table.handNumber, seatIndex: Number(idx), reason: d.reason, table: state.table });
    }
  };
  look(s);
  (fx.frames || []).forEach((fr, i) => {
    s = applyFrame(s, { v: 1, seq: s.seq + 1, at: 0, ...fr.msg }, i + 1);
    look(s, s.serverNow + (fr.afterMs || 0));
  });
  return seen;
}

test('deep scan: PUBLIC fixtures show cards only at a contested showdown that has ended', () => {
  for (const f of FILES) {
    const fx = load(f);
    if (fx.snapshot.feed.mode !== 'public') continue;
    for (const up of faceUpCards(fx)) {
      assert.equal(up.reason, 'showdown', `${f}: hand ${up.handNumber} seat ${up.seatIndex}`);
      assert.equal(isContestedShowdown(up.table), true);
      const seat = up.table.seats.find((x) => x.seatIndex === up.seatIndex);
      assert.equal(seat.folded, false);
      assert.notEqual(seat.mucked, true);
    }
  }
});

test('showdown-public: seats 2 and 5 shown; mucked 7 and the folded seat with leaked cards are not', () => {
  const ups = faceUpCards(load('showdown-public.json'));
  assert.deepEqual(ups.map((u) => u.seatIndex).sort(), [2, 5]);
});

test('midgame: the frame that leaks a live hole card shows nothing face up', () => {
  assert.deepEqual(faceUpCards(load('midgame.json')), []);
});

test('showdown-delayed: the ended hand shows faces after 5 min; the next hand (still live) shows none', () => {
  const ups = faceUpCards(load('showdown-delayed.json'));
  assert.ok(ups.length > 0);
  assert.ok(ups.every((u) => u.handNumber === 212 && u.reason === 'delayed'));
});

// 2026-11-02 (P5-C2b): every fixture uses the release mark the way a correct server does.
for (const f of FILES) {
  test(`${f}: the hole-card release mark follows the owner rule (never before the hand ended live + the delay)`, () => {
    const fx = load(f);
    const feed = fx.snapshot.feed;
    if (fx.snapshot.table) assert.deepEqual(releaseRuleProblems(fx.snapshot.table, feed, 'snapshot.table'), []);
    (fx.frames || []).forEach((fr, i) => {
      if (fr.msg && fr.msg.kind === 'table') assert.deepEqual(releaseRuleProblems(fr.msg.table, feed, `frames[${i}].table`), []);
    });
  });
}

test('showdown-delayed: without the server\'s release mark the ended hand shows NO faces (fail closed)', () => {
  const fx = load('showdown-delayed.json');
  const unmarked = structuredClone(fx);
  delete unmarked.snapshot.table.holeCardsReleasedAt;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(faceUpCards(unmarked), []);
  } finally { console.warn = warn; }
});

test('no fixture text reaches a production build (when dist/ exists)', { skip: !fs.existsSync(path.join(ROOT, 'dist/broadcast.html')) && 'no dist/broadcast.html: run npm run build' }, () => {
  const marker = 'FIXTURE-ONLY-bc-7f3a';
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const hits = walk(path.join(ROOT, 'dist')).filter((p) => /\.(js|html|css|json)$/.test(p) && fs.readFileSync(p, 'utf8').includes(marker));
  assert.deepEqual(hits, []);
  const fixtureIo = walk(path.join(ROOT, 'dist')).filter((p) => /\.js$/.test(p) && fs.readFileSync(p, 'utf8').includes('DEV fixture'));
  assert.deepEqual(fixtureIo, []);
});
