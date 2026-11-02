// public/sw.js must never handle /broadcast* (lead spec C1, fix for sw.js
// navigation caching): a /broadcast.html navigation is not answered by the
// worker and never written into the cached '/' app shell. The app's own
// navigations keep their network-first + cache '/' behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
const ORIGIN = 'https://americanpubpoker.online';

function loadWorker() {
  const handlers = {};
  const puts = [];
  const infos = [];
  const cache = {
    put: async (key) => { puts.push(typeof key === 'string' ? key : key.url); },
    match: async () => undefined,
    addAll: async () => {},
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (ev, fn) => { handlers[ev] = fn; },
    registration: {},
    clients: { claim: async () => {} },
    skipWaiting: () => {},
  };
  const ctx = vm.createContext({
    self,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => undefined },
    fetch: async () => ({ ok: true, clone() { return this; } }),
    clients: self.clients,
    URL,
    Response: { error: () => ({ error: true }) },
    console: { info: (...a) => infos.push(a.join(' ')), log: () => {}, warn: () => {}, error: () => {} },
    atob,
  });
  vm.runInContext(SRC, ctx, { filename: 'sw.js' });
  return { handlers, puts, infos };
}

async function dispatch(w, url, { mode = 'navigate', method = 'GET' } = {}) {
  let responded = null;
  w.handlers.fetch({
    request: { url: `${ORIGIN}${url}`, method, mode },
    respondWith: (p) => { responded = p; },
  });
  if (responded) await responded;
  return responded !== null;
}

test('a /broadcast.html navigation is not intercepted and never cached as /', async () => {
  const w = loadWorker();
  assert.equal(await dispatch(w, '/broadcast.html?ch=weekly&layout=16x9&role=output'), false);
  assert.deepEqual(w.puts, []);
  assert.ok(w.infos.some((l) => l.includes('broadcast-page-not-cached')));
});

test('any /broadcast* request is left to the browser', async () => {
  const w = loadWorker();
  assert.equal(await dispatch(w, '/broadcast.html', { mode: 'no-cors' }), false);
  assert.equal(await dispatch(w, '/broadcast', { mode: 'navigate' }), false);
  assert.deepEqual(w.puts, []);
});

test('regression: the app navigation still goes network-first and refreshes the cached /', async () => {
  const w = loadWorker();
  assert.equal(await dispatch(w, '/'), true);
  assert.deepEqual(w.puts, ['/']);
  assert.equal(await dispatch(w, '/assets/index-abc123.js', { mode: 'no-cors' }), true, 'hashed assets still cached');
});
