// P1-C8 (owner 2026-11-02: stream the qualifiers) — the REAL Go Live panel
// (StreamOverlay.jsx) and the REAL overlay graphic (StreamOverlayView.jsx)
// rendered to static HTML through Vite's SSR loader (poker-3d's own
// devDependencies; configFile false; the cache in a temp dir that is removed
// after). Owner answer (b), 2026-11-02: at a QUALIFIER table the June overlay
// is hidden for EVERYONE (seated AND watching): the panel shows the official
// stream note in place of the OBS URL and the graphic is a neutral slate with
// no names, seats, stacks or cards. Every other table is unchanged.
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

// A minimal browser surface for module-level code (no DOM rendering needed).
globalThis.window = globalThis.window || { location: { origin: 'https://americanpubpoker.online', search: '', hash: '' }, addEventListener() {}, removeEventListener() {} };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-sov-render-'));
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

const { default: StreamOverlay } = await server.ssrLoadModule('/src/components/ui/StreamOverlay.jsx');
const { default: StreamOverlayView } = await server.ssrLoadModule('/src/components/ui/StreamOverlayView.jsx');

const OFFICIAL = 'Qualifier tables are shown on the official American Pub Poker stream.';
const OFFICIAL_RE = /Qualifier tables are shown on the official American Pub Poker stream\./;

// A table mid-showdown: names, stacks, bets, board and shown cards, so a
// render that leaks any of them is caught.
const SEATS = [
  { seatIndex: 0, playerName: 'Alice Smith', chipCount: 4321, currentBet: 200, holeCards: [{ display: 'A♠' }, { display: 'K♥' }] },
  { seatIndex: 1, playerName: 'Bobby Jones', chipCount: 1500, allIn: true, holeCards: [{ display: 'Q♦' }, { display: 'Q♣' }] },
];
const BUSY = {
  seats: SEATS,
  communityCards: [{ display: '2♣' }, { display: '7♦' }, { display: 'J♠' }],
  pot: 2400,
  smallBlind: 50,
  bigBlind: 100,
  handNumber: 17,
  phase: 'Showdown',
  activeSeatIndex: 0,
  dealerButtonSeat: 1,
  handResult: { winners: [{ seatIndex: 0, playerName: 'Alice Smith', handName: 'Pair of Aces' }] },
};
const cash = { tableId: 'cash-1', tableName: 'Cash 1', tableKind: 'cash', isTournament: false, tournamentId: null, ...BUSY };
const sitGo = { tableId: 'sng-1', tableName: 'Sit & Go 9', tableKind: 'tournament', isTournament: true, tournamentId: 't-sng', isQualifier: false, qualifierId: null, ...BUSY };
// poker-server's spectator state at a qualifier table (isQualifier + qualifierId, index.ts getGameStateForPlayer).
const qual = { tableId: 'q-1', tableName: 'Qualifier Table 1', isTournament: true, tournamentId: 't1', isQualifier: true, qualifierId: 'wq-1', voiceChatAllowed: false, ...BUSY };
// An older server's qualifier: only the "Qualifier Table N" name says so (the same helpToolsOffAt evidence).
const qualByName = { tableId: 'q-2', tableName: 'Qualifier Table 2', isTournament: true, tournamentId: 't2', ...BUSY };

function render(props) {
  return renderToStaticMarkup(React.createElement(StreamOverlay, { visible: true, onClose() {}, ...props }));
}
function renderView(props) {
  return renderToStaticMarkup(React.createElement(StreamOverlayView, props));
}

function assertNoTableData(html, label) {
  for (const leak of ['Alice', 'Bobby', 'Smith', 'Jones', '4.3k', '1500', 'sov-seat', 'sov-board', 'sov-card-panel', 'sov-winner', 'POT', 'Pair of Aces', 'A♠', 'Q♦', 'ALL-IN']) {
    assert.ok(!html.includes(leak), `${label}: no "${leak}"`);
  }
}

test('cash table: the Go Live panel shows the OBS URL and the live preview (feature kept)', () => {
  const html = render({ gameState: cash });
  assert.match(html, /OBS Browser-Source URL/);
  assert.match(html, /\?overlay=cash-1&amp;delay=30&amp;theme=sapphire/);
  assert.doesNotMatch(html, OFFICIAL_RE);
  assert.match(html, /Holds only this overlay graphic back 30s/);
  assert.doesNotMatch(html, /snipe/);
  assert.match(html, /unticked/);
  assert.match(html, /Alice Smith/, 'the preview still draws the table');
  assert.match(html, /sov-card-panel/);
});

test('Sit & Go (a tournament that is not a qualifier): URL and preview unchanged, even for a seated player', () => {
  for (const ownQualifierSeat of [false, undefined]) {
    const html = render({ gameState: sitGo, ownQualifierSeat });
    assert.match(html, /\?overlay=sng-1&amp;delay=30/);
    assert.doesNotMatch(html, OFFICIAL_RE);
    assert.match(html, /Bobby Jones/);
  }
});

test('owner answer (b): qualifier table, SPECTATOR: no overlay URL, the official-stream note, a slate preview', () => {
  const html = render({ gameState: qual, ownQualifierSeat: false });
  assert.match(html, OFFICIAL_RE);
  assert.doesNotMatch(html, /OBS Browser-Source URL/);
  assert.doesNotMatch(html, /\?overlay=/);
  assert.doesNotMatch(html, /Streaming your own qualifier seat/, 'the seated-only note is replaced');
  assert.match(html, /stream-qualifier-official-note/);
  assert.match(html, /Live Preview/, 'the panel itself (and its preview box) stays');
  assert.match(html, /sov-qualifier-slate/, 'the preview is the slate');
  assertNoTableData(html, 'spectator panel');
});

test('owner answer (b): qualifier table, SEATED player: the same note, no URL', () => {
  const html = render({ gameState: qual, ownQualifierSeat: true });
  assert.match(html, OFFICIAL_RE);
  assert.doesNotMatch(html, /\?overlay=/);
  assert.doesNotMatch(html, /OBS Browser-Source URL/);
  assertNoTableData(html, 'seated panel');
});

test('owner answer (b): a qualifier known only by its "Qualifier Table N" name is hidden too', () => {
  const html = render({ gameState: qualByName });
  assert.match(html, OFFICIAL_RE);
  assert.doesNotMatch(html, /\?overlay=/);
  assertNoTableData(html, 'name-only qualifier');
});

test('the note is the plain sentence, in gold (never red)', () => {
  const html = render({ gameState: qual });
  const note = html.match(/<div class="stream-delay-note stream-qualifier-official-note"[^>]*>([^<]*)<\/div>/);
  assert.ok(note, 'the note renders');
  assert.equal(note[1], OFFICIAL);
  assert.match(note[0], /color:#ffd24a/);
  assert.doesNotMatch(note[0], /#(?:f00|ff0000|e53935|dc2626|ef4444)\b|\bred\b/i);
});

test('StreamOverlayView (the ?overlay= graphic): a qualifier table is the neutral slate, other tables draw as before', () => {
  for (const [gs, label] of [[qual, 'server flag'], [qualByName, 'table name']]) {
    const html = renderView({ previewState: gs });
    assert.match(html, OFFICIAL_RE, label);
    assert.match(html, /class="sov-waiting sov-qualifier-slate"/);
    assert.doesNotMatch(html, /Qualifier Table/, `${label}: not even the table name`);
    assertNoTableData(html, `overlay ${label}`);
  }
  const html = renderView({ previewState: cash });
  assert.match(html, /sov-card-panel/);
  assert.match(html, /Alice Smith/);
  assert.match(html, /4\.3k/);
  assert.match(html, /Pair of Aces/);
  assert.doesNotMatch(html, OFFICIAL_RE);
  // Spectate mode before the first frame: still "Waiting for table…" (no socket in SSR).
  assert.match(renderView({ tableId: 'q-1', delaySec: 30 }), /Waiting for table/);
});

test('hidden panel renders nothing', () => {
  assert.equal(renderToStaticMarkup(React.createElement(StreamOverlay, { visible: false, gameState: cash, onClose() {} })), '');
});
