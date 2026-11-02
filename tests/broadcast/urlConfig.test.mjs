// Broadcast page URL config (lead spec C1 / R3): defaults, bad values, the key
// from the fragment (or the worker's injected global) only, never the query.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBroadcastConfig, stripKeyFromHref, keyFromHash, cleanKey, subscribePayload,
} from '../../src/broadcast/model/urlConfig.js';

const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6ImJjYXN0K2p3dCJ9.eyJqdGkiOiJhYmMifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

test('defaults: channel main, 16:9, opaque, viewer, follow program, no key', () => {
  const c = parseBroadcastConfig('', '');
  assert.equal(c.channel, 'main');
  assert.equal(c.event, null);
  assert.equal(c.layout, '16x9');
  assert.equal(c.bg, 'opaque');
  assert.equal(c.motion, 'full');
  assert.equal(c.deck, 2);
  assert.equal(c.tally, false);
  assert.equal(c.role, 'viewer');
  assert.equal(c.follow, 'program');
  assert.equal(c.key, null);
});

test('the worker URL parses as the spec writes it (R6)', () => {
  const c = parseBroadcastConfig('?ch=weekly&layout=16x9&bg=opaque&tally=0&role=output', '');
  assert.equal(c.channel, 'weekly');
  assert.equal(c.role, 'output');
  assert.equal(c.tally, false);
  const v = parseBroadcastConfig('?ch=monthly&layout=9x16&bg=transparent&tally=1&motion=reduced&deck=4', '');
  assert.equal(v.layout, '9x16');
  assert.equal(v.bg, 'transparent');
  assert.equal(v.tally, true);
  assert.equal(v.motion, 'reduced');
  assert.equal(v.deck, 4);
});

test('bad values fall back to defaults', () => {
  const c = parseBroadcastConfig('?ch=cash&layout=4x3&bg=red&role=producer&motion=wild&deck=9&table=../../x', '');
  assert.equal(c.channel, 'main');
  assert.equal(c.layout, '16x9');
  assert.equal(c.bg, 'opaque');
  assert.equal(c.role, 'viewer');
  assert.equal(c.motion, 'full');
  assert.equal(c.deck, 2);
  assert.equal(c.follow, 'program');
});

test('?q= / ?t= give an event key instead of a channel; junk ids are refused', () => {
  assert.equal(parseBroadcastConfig('?q=abc-123', '').event, 'q:abc-123');
  assert.equal(parseBroadcastConfig('?q=abc-123', '').channel, null);
  assert.equal(parseBroadcastConfig('?t=tq_9', '').event, 't:tq_9');
  assert.equal(parseBroadcastConfig('?q=<script>', '').event, null);
  assert.equal(parseBroadcastConfig('?table=tbl-2', '').follow.tableId, 'tbl-2');
});

test('the key comes from the #k= fragment, never from the query string', () => {
  assert.equal(parseBroadcastConfig('', `#k=${KEY}`).key, KEY);
  assert.equal(parseBroadcastConfig('', `#k=${KEY}`).keySource, 'fragment');
  const q = parseBroadcastConfig(`?k=${KEY}`, '');
  assert.equal(q.key, null);
  assert.equal(q.keyInQuery, true);
  assert.equal(keyFromHash(`#foo=1&k=${KEY}`), KEY);
  assert.equal(keyFromHash('#k=not a token'), null);
  assert.equal(cleanKey('short.a.b'), null);
});

test('window.__APK_BROADCAST_KEY (stream worker) wins over the fragment', () => {
  const other = `${KEY}x`;
  const c = parseBroadcastConfig('', `#k=${other}`, KEY);
  assert.equal(c.key, KEY);
  assert.equal(c.keySource, 'injected');
  assert.equal(parseBroadcastConfig('', `#k=${KEY}`, 'garbage').key, KEY);
});

test('stripKeyFromHref drops the fragment and any ?k=, keeps the rest', () => {
  assert.equal(stripKeyFromHref(`https://americanpubpoker.online/broadcast.html?ch=main&layout=9x16#k=${KEY}`), '/broadcast.html?ch=main&layout=9x16');
  assert.equal(stripKeyFromHref(`https://americanpubpoker.online/broadcast.html?ch=main&k=${KEY}`), '/broadcast.html?ch=main');
  assert.equal(stripKeyFromHref('https://americanpubpoker.online/broadcast.html?ch=main'), null);
  assert.equal(stripKeyFromHref('not a url'), null);
});

test('bc:subscribe payload (spec §3): v:1, channel or event, layout, role, follow, lastSeq', () => {
  const c = parseBroadcastConfig('?ch=weekly&role=output&layout=9x16', '');
  assert.deepEqual(subscribePayload(c), { v: 1, layout: '9x16', role: 'output', follow: 'program', channel: 'weekly' });
  assert.equal(subscribePayload(c, 41).lastSeq, 41);
  assert.equal('lastSeq' in subscribePayload(c, null), false);
  const e = parseBroadcastConfig('?q=wq1', '');
  assert.equal(subscribePayload(e).event, 'q:wq1');
  assert.equal('channel' in subscribePayload(e), false);
  assert.equal(JSON.stringify(subscribePayload(parseBroadcastConfig('', `#k=${KEY}`))).includes(KEY), false, 'the key never rides the subscribe payload');
});
