// The REAL scenes, graphics and producer views rendered to HTML from the
// recorded fixtures (lead spec C3 / C4 / C5 / C6, 2026-11-02), through Vite's
// SSR loader (poker-3d's own devDependencies; configFile false; the cache in a
// temp dir that is removed after). Checks: every scene at 16:9 and 9:16, the
// lock-token classes, the legal line, NO face-up hole card on a public feed
// outside a contested showdown, NONE on a delayed feed while the hand is still
// live (owner HARD RULE), the delay bug reads the configured minutes, results
// held until the program clock reaches the finish, the producer views draw no
// cards even when a payload carries some.
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
const CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-bc-render-'));
const server = await createServer({
  configFile: false,
  root: ROOT,
  cacheDir: CACHE,
  plugins: [react()],
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null, preTransformRequests: false },
  // SSR only: no client dependency pre-bundling (it writes ~18 MB to the cache
  // in the background, after close; the disk is nearly full).
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
});
after(async () => {
  await server.close();
  fs.rmSync(CACHE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const load = async (p) => (await server.ssrLoadModule(p));
const { default: SceneSwitcher } = await load('/src/broadcast/ui/scenes/SceneSwitcher.jsx');
const { default: BroadcastTable } = await load('/src/broadcast/ui/table/BroadcastTable.jsx');
const { default: LiveMultiview } = await load('/src/components/producer/LiveMultiview.jsx');
const { default: KeyManager } = await load('/src/components/producer/KeyManager.jsx');
const { default: FeedControl } = await load('/src/components/producer/FeedControl.jsx');
const { default: SceneBoard } = await load('/src/components/producer/SceneBoard.jsx');
const { default: GoLiveChecklist } = await load('/src/components/producer/GoLiveChecklist.jsx');
const { resetDropLog } = await load('/src/broadcast/model/holeCardGate.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src/broadcast/dev/fixtures', `${name}.json`), 'utf8'));
const quiet = () => {};
const FACE_UP = /class="card2d card2d--deal/g;
const faceUp = (html) => (html.match(FACE_UP) || []).length;

function scene(name, { layout = '16x9', stale = false, programNow, serverNow, events = [] } = {}) {
  const snap = fixture(name).snapshot;
  const p = snap.program;
  const feed = snap.feed;
  const props = {
    layout, motion: 'full', program: p, table: snap.table, tables: snap.tables || [], events,
    feed, delayMs: feed.mode === 'delayed' ? feed.delayMs : 0, onAir: true, stale,
    feedHealth: stale ? 'stale' : 'ok', now: 0,
    serverNow: Number.isFinite(serverNow) ? serverNow : snap.serverNow,
    programNow: Number.isFinite(programNow) ? programNow : p.programNow,
    TableView: BroadcastTable, onSceneShown: quiet,
  };
  resetDropLog();
  const warn = console.warn;
  console.warn = quiet; // the gate's drop log is expected in the leak cases
  try {
    return renderToStaticMarkup(React.createElement(SceneSwitcher, props));
  } finally {
    console.warn = warn;
  }
}

const EXPECT = {
  starting: ['bc-scene-starting', 'Weekly Qualifier', 'registered'],
  midgame: ['bc-scene-table', 'bc-tournament-bar', 'bc-chip-leaders', 'bc-bust-ticker', 'Level 4 of 6', 'Top 3 win a championship seat'],
  break: ['bc-scene-break', 'Break', 'Top 10'],
  hfh: ['bc-scene-hfh', 'HAND-FOR-HAND', 'Round 2', 'Tables still playing: 2'],
  finalTable: ['bc-scene-final-intro'],
  results: ['bc-scene-results', 'Champion', 'Mike R.', 'Wins 1 seat'],
};

test('every scene renders at 16:9 and 9:16 with its lock classes and the legal line', () => {
  for (const [name, tokens] of Object.entries(EXPECT)) {
    for (const layout of ['16x9', '9x16']) {
      const html = scene(name, { layout });
      for (const t of tokens) assert.ok(html.includes(t), `${name} ${layout}: ${t}`);
      assert.ok(html.includes('bc-legal-line'), `${name} ${layout}: legal line`);
      assert.ok(html.includes('Free to play · Play money only · No purchase necessary · 21+ to enter.'), `${name} ${layout}: legal text`);
      assert.doesNotMatch(html, /playerId|masterUserId|"userId"/);
    }
  }
});

test('a stale feed is the slate, even over results', () => {
  for (const name of ['midgame', 'results']) {
    const html = scene(name, { stale: true });
    assert.ok(html.includes('bc-scene-slate'));
    assert.ok(html.includes('We&#x27;ll be right back') || html.includes("We'll be right back"));
    assert.ok(!html.includes('bc-scene-results'));
  }
});

test('PUBLIC feed, live hand: the only face-up cards are the board; no hole cam', () => {
  const snap = fixture('midgame').snapshot;
  const html = scene('midgame');
  assert.equal(faceUp(html), snap.table.board.length);
  assert.ok(!html.includes('bc-hole-cam'));
  assert.ok(!html.includes('bc-delay-bug'), 'no delay bug on a public feed');
});

test('PUBLIC feed: a frame that leaks live cards (preflop, every seat) draws none face up', () => {
  const snap = fixture('midgame').snapshot;
  const leak = structuredClone(snap);
  leak.table.phase = 'PreFlop';
  leak.table.board = [];
  leak.table.seats = leak.table.seats.map((s) => ({ ...s, holeCards: [{ rank: 14, suit: 0 }, { rank: 13, suit: 1 }] }));
  const props = {
    layout: '16x9', motion: 'full', program: leak.program, table: leak.table, tables: [], events: [], feed: leak.feed,
    delayMs: 0, onAir: true, stale: false, feedHealth: 'ok', now: 0, serverNow: snap.serverNow, programNow: snap.program.programNow,
    TableView: BroadcastTable, onSceneShown: quiet,
  };
  const warn = console.warn;
  const logs = [];
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    resetDropLog();
    const html = renderToStaticMarkup(React.createElement(SceneSwitcher, props));
    assert.equal(faceUp(html), 0);
  } finally { console.warn = warn; }
  assert.ok(logs.some((l) => l.includes('[broadcast] dropped live hole cards')));
});

test('PUBLIC feed, contested showdown: only the shown, unmucked, unfolded seats are face up', () => {
  const html = scene('showdown-public');
  // board 5 + seats 2 and 5 (2 cards each) on the plates + the same 2 seats in the hole cam.
  assert.equal(faceUp(html), 5 + 4 + 4);
  assert.ok(html.includes('bc-hole-cam'));
});

test('DELAYED feed: a hand that is still live shows card BACKS only (owner HARD RULE)', () => {
  const snap = fixture('showdown-delayed').snapshot;
  const ended = snap.table.liveHandEndedAt;
  const html = scene('showdown-delayed', { serverNow: ended - 60_000 });
  assert.equal(faceUp(html), snap.table.board.length, 'only the board is face up');
  assert.ok(html.includes('card2d--back'));
  assert.ok(html.includes('Cards after the hand'));
  assert.ok(html.includes('Delayed broadcast · 5 min'), 'the delay bug reads the configured 5 minutes');
});

test('DELAYED feed: once the hand ended live AND the delay passed, the dealt-in seats are face up', () => {
  const snap = fixture('showdown-delayed').snapshot;
  const html = scene('showdown-delayed', { serverNow: snap.serverNow });
  assert.ok(faceUp(html) > snap.table.board.length);
});

test('results stay off air until the program clock reaches the finish', () => {
  const p = fixture('results').snapshot.program;
  const finish = p.ticker.find((t) => t.kind === 'finished').t;
  const early = scene('results', { programNow: finish - 30_000 });
  assert.ok(!early.includes('bc-scene-results'));
  assert.ok(!early.includes('Champion'));
  const onTime = scene('results', { programNow: finish });
  assert.ok(onTime.includes('bc-scene-results'));
});

test('9:16 table scene: one leader at a time, the same scene as 16:9', () => {
  const tall = scene('midgame', { layout: '9x16' });
  const wide = scene('midgame', { layout: '16x9' });
  assert.equal((tall.match(/class="bc-leader"/g) || []).length, 1);
  assert.equal((wide.match(/class="bc-leader"/g) || []).length, 5);
  assert.match(tall, /data-scene="table"/);
  assert.match(wide, /data-scene="table"/);
});

test('the recap scene has the REPLAY bug and draws no cards, whatever scene.params carries', () => {
  const snap = fixture('midgame').snapshot;
  const program = { ...snap.program, scene: { id: 'recap', auto: false, since: 0, params: { title: 'Top hands', cards: [{ rank: 14, suit: 0 }] } } };
  const html = renderToStaticMarkup(React.createElement(SceneSwitcher, {
    layout: '16x9', motion: 'full', program, table: snap.table, tables: [], events: [], feed: snap.feed, delayMs: 0,
    onAir: true, stale: false, feedHealth: 'ok', now: 0, serverNow: snap.serverNow, programNow: snap.program.programNow,
    TableView: BroadcastTable, onSceneShown: quiet,
  }));
  assert.ok(html.includes('bc-scene-recap'));
  assert.ok(html.includes('bc-replay-bug'));
  assert.ok(html.includes('Top hands'));
  assert.ok(!html.includes('card2d'));
});

test('producer live view: summaries only, never a card, even if a payload carries one', () => {
  const state = {
    live: {
      tables: [{ tableId: 't1', tableNo: 1, players: 8, handNumber: 5, pot: 100, allIn: true, biggestStack: 61200, chipLeaderHere: true }],
      featuredLive: {
        tableId: 't1', tableNo: 1, handNumber: 5, phase: 'Flop', pot: 100, board: [{ rank: 2, suit: 0 }],
        seats: [{ seatIndex: 0, name: 'A', holeCards: [{ rank: 14, suit: 0 }, { rank: 13, suit: 0 }] }],
      },
    },
  };
  const html = renderToStaticMarkup(React.createElement(LiveMultiview, { state, program: { featured: { tableId: 't1', mode: 'auto' } }, channel: 'main', call: async () => ({ ok: true }) }));
  assert.ok(html.includes('bc-producer-live'));
  assert.ok(html.includes('Table 1'));
  assert.ok(!html.includes('card2d'));
  assert.doesNotMatch(html, /\bA[♠-♧]|♠|♥|♦|♣/);
});

test('producer keys: public URLs with no key; the delay defaults to 5 minutes; scenes and checklist render', () => {
  const origin = 'https://americanpubpoker.online';
  const keys = renderToStaticMarkup(React.createElement(KeyManager, { program: null, channel: 'weekly', call: async () => ({ ok: true }), origin, connected: false }));
  assert.ok(keys.includes('https://americanpubpoker.online/broadcast.html?ch=weekly&amp;layout=16x9&amp;role=output&amp;tally=0'));
  assert.ok(!keys.includes('#k='), 'no key shown before one is minted');
  assert.ok(keys.includes('Shutdown source when not visible'));
  const feed = renderToStaticMarkup(React.createElement(FeedControl, { state: null, program: null, channel: 'main', call: async () => ({ ok: true }) }));
  assert.match(feed, /type="number" min="5" max="240"[^>]*value="5"/);
  assert.ok(feed.includes('never while that hand is still being played'));
  const board = renderToStaticMarkup(React.createElement(SceneBoard, { program: { scene: { id: 'table', auto: true } }, channel: 'main', call: async () => ({ ok: true }) }));
  assert.match(board, /disabled=""[^>]*title="Only from the slate or the break scene"|title="Only from the slate or the break scene"[^>]*disabled=""/);
  const list = renderToStaticMarkup(React.createElement(GoLiveChecklist, { program: null, channelRow: null, stateAgeMs: null }));
  assert.ok(list.includes('Not ready'));
});
