// The REAL BroadcastTable / HoleCam rendered to HTML (lead spec P5-C2b,
// 2026-11-02), through Vite's SSR loader like scenesRender.test.mjs (no new
// dependency; the cache in a temp dir that is removed after). Checks: the
// delayed hole cam shows faces + the same win % at 16:9 and 9:16 only for a
// released hand; a hand that is still live is card backs with no %; the
// public feed never prints a %; nine rows switch to the compact strip.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-bc-holecam-'));
const server = await createServer({
  configFile: false,
  root: ROOT,
  cacheDir: CACHE,
  plugins: [react()],
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null, preTransformRequests: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
after(async () => {
  await server.close();
  fs.rmSync(CACHE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const { default: BroadcastTable } = await server.ssrLoadModule('/src/broadcast/ui/table/BroadcastTable.jsx');
const { resetDropLog } = await server.ssrLoadModule('/src/broadcast/model/holeCardGate.js');
const { resetEquityCache } = await server.ssrLoadModule('/src/broadcast/model/equity.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src/broadcast/dev/fixtures', `${name}.json`), 'utf8'));
const FACE_UP = /class="card2d card2d--deal/g;
const faceUp = (html) => (html.match(FACE_UP) || []).length;
const equities = (html) => [...html.matchAll(/class="bc-hole-cam__equity">([^<]*)</g)].map((m) => m[1]);

function render(table, feed, layout, serverNow) {
  resetDropLog();
  resetEquityCache();
  const warn = console.warn;
  console.warn = () => {};
  try {
    return renderToStaticMarkup(React.createElement(BroadcastTable, { table, feed, layout, serverNow, programNow: serverNow }));
  } finally { console.warn = warn; }
}

test('delayed + released turn: faces and the SAME win % at 16:9 and 9:16 (10% / 80% / 10%)', () => {
  const snap = fixture('showdown-delayed').snapshot;
  const wide = render(snap.table, snap.feed, '16x9', snap.serverNow);
  const tall = render(snap.table, snap.feed, '9x16', snap.serverNow);
  assert.deepEqual(equities(wide), ['10%', '80%', '10%']);
  assert.deepEqual(equities(tall), equities(wide), 'the two sources agree');
  assert.match(wide, /data-equity="turn"/);
  assert.ok(faceUp(wide) > snap.table.board.length);
});

test('delayed, hand still live (before its live end): card backs, "Cards after the hand", no %', () => {
  const snap = fixture('showdown-delayed').snapshot;
  const html = render(snap.table, snap.feed, '16x9', snap.table.liveHandEndedAt - 60_000);
  assert.equal(faceUp(html), snap.table.board.length, 'only the board is face up');
  assert.ok(html.includes('card2d--back'));
  assert.ok(html.includes('Cards after the hand'));
  assert.deepEqual(equities(html), []);
});

test('delayed, no release mark on the frame: card backs and no % (fail closed)', () => {
  const snap = fixture('showdown-delayed').snapshot;
  const table = { ...snap.table, holeCardsReleasedAt: null };
  const html = render(table, snap.feed, '16x9', snap.serverNow);
  assert.equal(faceUp(html), snap.table.board.length);
  assert.deepEqual(equities(html), []);
});

test('the next hand (live, nine dealt in): nine rows of backs in the compact strip, no %', () => {
  const fx = fixture('showdown-delayed');
  const table = fx.frames[0].msg.table;
  const html = render(table, fx.snapshot.feed, '16x9', fx.snapshot.serverNow + 6000);
  assert.match(html, /bc-hole-cam--compact/);
  assert.match(html, /data-rows="9"/);
  assert.equal(faceUp(html), 0);
  assert.deepEqual(equities(html), []);
});

test('public feed: never a win %, even with a frame that carries delayed-looking fields', () => {
  for (const name of ['showdown-public', 'midgame', 'finalTable', 'fullring']) {
    const snap = fixture(name).snapshot;
    if (!snap.table) continue;
    const forged = { ...snap.table, liveHandEndedAt: snap.serverNow - 600_000, holeCardsReleasedAt: snap.serverNow - 1000 };
    for (const layout of ['16x9', '9x16']) {
      assert.deepEqual(equities(render(forged, snap.feed, layout, snap.serverNow)), [], `${name} ${layout}`);
    }
  }
});
