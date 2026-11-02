// The separate broadcast.html entry (lead spec C1 / R6): Vite builds both
// entries and keeps the vendor manualChunks; the page carries the readiness
// root and the app's CSP; it loads none of the player app (no service worker
// registration, no manifest). Card2D was moved out of PokerTable2D as-is.
// With a dist/ present, the built page is checked too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cspOf = (html) => (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];

test('vite.config.js: two HTML entries (index + broadcast) and the manualChunks are kept', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'vite.config.js')).href);
  const cfg = typeof mod.default === 'function' ? mod.default({ command: 'build', mode: 'production' }) : mod.default;
  const ro = cfg.build.rollupOptions;
  assert.ok(ro.input.index.endsWith('index.html'));
  assert.ok(ro.input.broadcast.endsWith('broadcast.html'));
  assert.equal(typeof ro.output.manualChunks, 'function');
  assert.equal(ro.output.manualChunks('/x/node_modules/socket.io-client/build/esm/index.js'), 'vendor-socket');
  assert.equal(ro.output.manualChunks('/x/node_modules/react-dom/client.js'), 'vendor-react');
  assert.equal(cfg.base, '/');
});

test('broadcast.html: readiness root, same CSP as index.html, no manifest / service worker / app entry', () => {
  const html = read('broadcast.html');
  assert.ok(html.includes('id="bc-root"'));
  assert.ok(html.includes('data-bc-ready="0"'));
  assert.equal(cspOf(html), cspOf(read('index.html')));
  assert.ok(html.includes('src="/src/broadcast/main.jsx"'));
  assert.equal(/rel="manifest"/.test(html), false);
  assert.equal(/serviceWorker/.test(html), false);
  assert.equal(html.includes('/src/main.jsx'), false);
});

test('the broadcast entry imports nothing from the player app shell', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(path.join(ROOT, 'src/broadcast')).filter((p) => /\.(js|jsx)$/.test(p) && !p.includes(`${path.sep}dev${path.sep}`));
  const banned = [/services\//, /store\//, /hooks\//, /\/App(\.jsx)?$/, /^\.\.\/main(\.jsx)?$/, /components\/(ui|game|producer)\//];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const specs = [...src.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] || m[2]);
    for (const spec of specs) {
      for (const b of banned) assert.equal(b.test(spec), false, `${path.relative(ROOT, f)} imports ${spec}`);
    }
    assert.equal(/navigator\.serviceWorker/.test(src), false, `${path.relative(ROOT, f)} touches the service worker`);
  }
  const main = read('src/broadcast/main.jsx');
  assert.ok(main.includes('import.meta.env.DEV && config.fixture'), 'the fixture replay is DEV-only');
  assert.ok(main.includes('history.replaceState'), 'the key is taken out of the address bar');
  assert.ok(main.includes('__apkBroadcast'));
});

test('Card2D moved as-is: PokerTable2D imports it back and no longer defines it', () => {
  const table = read('src/components/scene/PokerTable2D.jsx');
  const card = read('src/components/scene/Card2D.jsx');
  assert.ok(table.includes("import Card2D from './Card2D'"));
  assert.equal(/function Card2D\(/.test(table), false);
  assert.ok(/export default function Card2D\(\{ card, faceUp = true, small = false, dealDelay = 0, backClass = '' \}\)/.test(card));
  for (const cls of ['card2d card2d--back card2d--deal', 'card2d__back-pattern', 'card2d__corner card2d__corner--tl', 'card2d__center-suit', "'--card-color': color"]) {
    assert.ok(card.includes(cls), cls);
  }
});

const DIST = path.join(ROOT, 'dist');
test('dist: broadcast.html built, with its own entry chunk and none of the app entry', { skip: !fs.existsSync(path.join(DIST, 'broadcast.html')) && 'no dist/broadcast.html: run npm run build' }, () => {
  const html = fs.readFileSync(path.join(DIST, 'broadcast.html'), 'utf8');
  const index = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  assert.ok(html.includes('id="bc-root"'));
  const entry = (index.match(/src="\/assets\/(index-[^"]+\.js)"/) || [])[1];
  assert.ok(entry, 'the app entry keeps its index-*.js name');
  assert.equal(html.includes(entry), false, 'the broadcast page never loads the app entry');
  const bEntry = (html.match(/src="\/assets\/([^"]+\.js)"/) || [])[1];
  assert.ok(bEntry && bEntry.startsWith('broadcast-'), `broadcast entry chunk: ${bEntry}`);
  // Walk the broadcast entry's static imports: none may be the app entry.
  const seen = new Set();
  const queue = [bEntry];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(path.join(DIST, 'assets', f), 'utf8');
    for (const m of src.matchAll(/(?:import|from)\s*["']\.\/([^"']+\.js)["']/g)) queue.push(m[1]);
  }
  assert.equal(seen.has(entry), false);
  const blob = [...seen].map((f) => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  for (const token of ['bc:subscribe', 'bc:heartbeat', '[broadcast] dropped live hole cards', '[broadcast] resync', '__apkBroadcast', 'data-bc-ready', 'bc-hole-cam', 'bc-stage']) {
    assert.ok(blob.includes(token) || html.includes(token), `${token} in the broadcast bundle`);
  }
  assert.equal(blob.includes('serviceWorker.register'), false, 'no service worker registration on the broadcast page');
});
