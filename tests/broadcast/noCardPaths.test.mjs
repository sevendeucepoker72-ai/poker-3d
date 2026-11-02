// A hole-card leak on any public path is a P0 (owner 2026-11-02). The ONLY
// code allowed to look at a seat's hole cards is the table renderer behind
// holeCardGate (src/broadcast/ui/table/** + model/holeCardGate.js / holeCam.js
// / programStore's public pass). The graphics, the scenes, the scene machine,
// the program text models and the whole producer panel never read them: a
// static scan, so a later edit that does fails here first. Also the rules
// (hole cards on streams: the owner's approved line only) and the AGENT.md row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualifierRulesFor, QUALIFIER_RULES } from '../../src/content/qualifierRules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function files(rel, re = /\.(js|jsx|mjs)$/) {
  const dir = path.join(ROOT, rel);
  return fs.readdirSync(dir).filter((n) => re.test(n)).map((n) => path.join(dir, n));
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const NO_CARD_FILES = [
  ...files('src/broadcast/ui/graphics'),
  ...files('src/broadcast/ui/scenes'),
  ...files('src/components/producer'),
  ...['programClock', 'tickerFormat', 'standings', 'sceneMachine'].map((m) => path.join(ROOT, `src/broadcast/model/${m}.js`)),
];

test('graphics, scenes, program models and the producer panel never read hole cards', () => {
  assert.ok(NO_CARD_FILES.length >= 25, `scanned ${NO_CARD_FILES.length} files`);
  const hits = [];
  for (const f of NO_CARD_FILES) {
    const src = strip(fs.readFileSync(f, 'utf8'));
    // A seat's cards (seat.holeCards, s.holeCards, x['holeCards']...); the FEED's
    // holeCards flag (feed / snapFeed .holeCards: a boolean) is not a card.
    if (/\b(?!feed\b|snapFeed\b)\w+\??\.holeCards\b|\[\s*['"`]holeCards['"`]\s*\]|\.yourCards\b|\.deck\b|\.seed\b/.test(src)) {
      hits.push(path.relative(ROOT, f));
    }
  }
  assert.deepEqual(hits, []);
});

test('the producer panel and scenes never draw a card except through the gated table (Card2D only in ui/table)', () => {
  const hits = NO_CARD_FILES.filter((f) => /Card2D/.test(strip(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(ROOT, f));
  assert.deepEqual(hits, []);
});

test('the key never goes in a query string: sourceUrl writes #k= only', () => {
  const src = strip(fs.readFileSync(path.join(ROOT, 'src/components/producer/producerModel.js'), 'utf8'));
  assert.match(src, /#k=\$\{encodeURIComponent\(key\)\}/);
  assert.doesNotMatch(src, /[?&]k=/);
  assert.doesNotMatch(src, /localStorage|sessionStorage/, 'the panel token is memory only');
  for (const f of files('src/components/producer')) {
    assert.doesNotMatch(strip(fs.readFileSync(f, 'utf8')), /localStorage|sessionStorage|console\.(log|warn|error)\([^)]*token/i, path.basename(f));
  }
});

test('fix round 2026-11-02: hole cards on streams are covered by the owner-approved line only (the unapproved C8b sentence is gone)', () => {
  const weekly = { type: 'weekly', seatsForTop: 3, lateRegClosesAtBubble: true, seedsHeldUntilEnd: true };
  for (const q of [null, weekly]) {
    const text = qualifierRulesFor(q).flatMap((s) => s.rules).join('\n');
    assert.doesNotMatch(text, /delayed by at least/, 'the unapproved C8b sentence is not shown');
    assert.doesNotMatch(text, /On our live streams/);
    // The owner's approved line carries the hole-card rule, word for word, once.
    assert.equal(text.split('Hole cards are shown only on a delay or after the event.').length - 1, 1);
  }
  const text = qualifierRulesFor(null).flatMap((s) => s.rules).join('\n');
  // Any number of minutes in a rule about the stream / the delay is the server minimum (5).
  for (const line of text.split('\n').filter((l) => /stream|delay/i.test(l))) {
    for (const m of line.matchAll(/(\d+)[ -]minute/g)) assert.equal(m[1], '5', `${m[0]} in: ${line}`);
  }
  const raw = JSON.stringify(QUALIFIER_RULES);
  assert.ok(/^[\x20-\x7e]*$/.test(raw), 'plain ASCII (AGENT.md rule 20)');
});

test('AGENT.md carries the broadcast hard rule (5-minute delay, hand-complete gate, built dark)', () => {
  const md = fs.readFileSync(path.join(ROOT, 'AGENT.md'), 'utf8');
  const row = md.split('\n').find((l) => l.startsWith('| 24 |')) || '';
  assert.match(row, /never shows a live hole card/);
  assert.match(row, /5 min/);
  assert.match(row, /liveHandEndedAt/);
  assert.match(row, /ships 'off'/);
});
