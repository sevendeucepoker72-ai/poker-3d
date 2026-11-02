// deploy-online.mjs on-air pre-flight (lead spec C9 / R5): against a local
// stub HTTP server answering on air, off air, 404 (route not deployed) and
// unreachable / slow / malformed. ON AIR if either source says so; unreachable
// fails closed; override needs BOTH the flag and a reason.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  checkOne, checkOnAir, decideDeploy, readServerOnAir, readMasterLive, serverOnAirUrl, ON_AIR_FAIL_TEXT, MASTER_STATUS_URL, preflightOutcome,
} from '../../src/broadcast/net/onAirPreflight.js';

let server;
let base;
const routes = {
  '/on/api/broadcast/on-air': [200, { onAir: true, channels: [{ channel: 'weekly', onAir: true, since: 1, eventKey: 'q:x', source: 'output' }] }],
  '/chan/api/broadcast/on-air': [200, { onAir: false, channels: [{ channel: 'main', onAir: true, since: 1, eventKey: 'next:weekly', source: 'producer' }] }],
  '/off/api/broadcast/on-air': [200, { onAir: false, channels: [] }],
  '/master-live': [200, { live: true, kind: 'weekly', startedAt: '2026-11-08T18:00:00Z' }],
  '/master-idle': [200, { live: false, next: null }],
  '/bad/api/broadcast/on-air': [200, '<html>not json</html>'],
  '/weird/api/broadcast/on-air': [200, { hello: 1 }],
  '/err/api/broadcast/on-air': [503, { error: 'down' }],
};

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/slow')) { setTimeout(() => { res.end('{}'); }, 1500); return; }
    const r = routes[req.url];
    if (!r) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not found"}'); return; }
    res.writeHead(r[0], { 'content-type': 'application/json' });
    res.end(typeof r[1] === 'string' ? r[1] : JSON.stringify(r[1]));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('the endpoints are the spec ones', () => {
  assert.equal(serverOnAirUrl('https://poker-server-production-60c0.up.railway.app/'), 'https://poker-server-production-60c0.up.railway.app/api/broadcast/on-air');
  assert.equal(MASTER_STATUS_URL, 'https://poker-prod-api-azeg4kcklq-uc.a.run.app/poker-api/broadcast/status');
  assert.equal(ON_AIR_FAIL_TEXT, 'a broadcast is on air');
});

test('readers: onAir / any channel on air / live; anything else is unreadable', () => {
  assert.equal(readServerOnAir({ onAir: true }), true);
  assert.equal(readServerOnAir({ onAir: false, channels: [{ onAir: true }] }), true);
  assert.equal(readServerOnAir({ onAir: false, channels: [] }), false);
  assert.equal(readServerOnAir({}), null);
  assert.equal(readMasterLive({ live: false }), false);
  assert.equal(readMasterLive({ live: 'yes' }), null);
});

test('poker-server on air -> blocked', async () => {
  const results = await checkOnAir({ serverUrl: `${base}/on`, masterUrl: `${base}/master-idle`, timeoutMs: 1000 });
  assert.deepEqual(results.map((r) => r.state), ['on_air', 'off_air']);
  const v = decideDeploy(results);
  assert.equal(v.ok, false);
  assert.equal(v.onAir, true);
});

test('a channel on air with onAir false at the top is still on air', async () => {
  const v = decideDeploy(await checkOnAir({ serverUrl: `${base}/chan`, masterUrl: `${base}/master-idle`, timeoutMs: 1000 }));
  assert.equal(v.onAir, true);
  assert.equal(v.ok, false);
});

test('master API live -> blocked even when poker-server is off air', async () => {
  const v = decideDeploy(await checkOnAir({ serverUrl: `${base}/off`, masterUrl: `${base}/master-live`, timeoutMs: 1000 }));
  assert.equal(v.ok, false);
  assert.equal(v.onAir, true);
});

test('both off air -> ok', async () => {
  const v = decideDeploy(await checkOnAir({ serverUrl: `${base}/off`, masterUrl: `${base}/master-idle`, timeoutMs: 1000 }));
  assert.equal(v.ok, true);
  assert.equal(v.blocked, false);
});

test('a 404 (route not deployed yet) counts as NOT on air, for both sources', async () => {
  const results = await checkOnAir({ serverUrl: `${base}/nothing-here`, masterUrl: `${base}/no-status-route`, timeoutMs: 1000 });
  assert.deepEqual(results.map((r) => r.state), ['not_deployed', 'not_deployed']);
  assert.equal(decideDeploy(results).ok, true);
});

test('unreachable, slow, 5xx, non-JSON or a body with no on-air field FAILS closed', async () => {
  const cases = [
    { serverUrl: 'http://127.0.0.1:1', masterUrl: `${base}/master-idle` },
    { serverUrl: `${base}/slow`, masterUrl: `${base}/master-idle` },
    { serverUrl: `${base}/err`, masterUrl: `${base}/master-idle` },
    { serverUrl: `${base}/bad`, masterUrl: `${base}/master-idle` },
    { serverUrl: `${base}/weird`, masterUrl: `${base}/master-idle` },
  ];
  for (const c of cases) {
    const results = await checkOnAir({ ...c, timeoutMs: 500 });
    const v = decideDeploy(results);
    assert.equal(results[0].state, 'unreachable', JSON.stringify(results[0]));
    assert.equal(v.ok, false);
    assert.equal(v.onAir, false);
    assert.equal(v.unreachable, true);
  }
});

test('override needs BOTH --allow-during-broadcast and a non-empty BROADCAST_OVERRIDE_REASON', async () => {
  const results = await checkOnAir({ serverUrl: `${base}/on`, masterUrl: `${base}/master-idle`, timeoutMs: 1000 });
  assert.equal(decideDeploy(results, { allowFlag: true }).ok, false);
  assert.equal(decideDeploy(results, { allowFlag: true, overrideReason: '   ' }).ok, false);
  assert.equal(decideDeploy(results, { overrideReason: 'hotfix' }).ok, false);
  const v = decideDeploy(results, { allowFlag: true, overrideReason: 'P0 hotfix for the lobby' });
  assert.equal(v.ok, true);
  assert.equal(v.overridden, true);
});

test('a process that checks and then exits does so cleanly (exit code 0)', async () => {
  // Regression: Windows Node 24 aborted with a libuv assertion (exit 127) when
  // process.exit() followed a global fetch(); ship.sh would read that as a failed deploy.
  const { spawn } = await import('node:child_process');
  const modUrl = new URL('../../src/broadcast/net/onAirPreflight.js', import.meta.url).href;
  const code = `const m = await import(${JSON.stringify(modUrl)});
    const r = await m.checkOnAir({ serverUrl: ${JSON.stringify(`${base}/off`)}, masterUrl: ${JSON.stringify(`${base}/master-idle`)}, timeoutMs: 2000 });
    console.log(r.map((x) => x.state).join(','));
    process.exit(0);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(out.trim(), 'off_air,off_air');
  assert.equal(exitCode, 0);
});

test('deploy-online.mjs runs the pre-flight before --check-only exits and before any upload', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../deploy-online.mjs', import.meta.url), 'utf8');
  const preflight = src.indexOf('await checkOnAir(');
  assert.ok(preflight > 0);
  assert.ok(preflight < src.indexOf('if (CHECK_ONLY) {'), 'before the --check-only exit');
  assert.ok(preflight < src.indexOf('uploadFromDir('), 'before the upload');
  assert.ok(src.includes("'--allow-during-broadcast'") && src.includes('BROADCAST_OVERRIDE_REASON'));
});

test('review 2026-11-02: --check-only WARNS on air / unreadable (exit decided by the build guards); a real deploy FAILS', async () => {
  const onAir = decideDeploy(await checkOnAir({ serverUrl: `${base}/on`, masterUrl: `${base}/master-idle`, timeoutMs: 1000 }));
  const down = decideDeploy(await checkOnAir({ serverUrl: 'http://127.0.0.1:1', masterUrl: 'http://127.0.0.1:1', timeoutMs: 500 }));
  const clear = decideDeploy(await checkOnAir({ serverUrl: `${base}/off`, masterUrl: `${base}/master-idle`, timeoutMs: 1000 }));
  for (const v of [onAir, down]) {
    const real = preflightOutcome(v, { checkOnly: false });
    assert.equal(real.exitCode, 1, 'a real deploy is refused (fail closed)');
    assert.equal(real.level, 'fail');
    const check = preflightOutcome(v, { checkOnly: true });
    assert.equal(check.exitCode, null, '--check-only does not fail on the on-air status');
    assert.equal(check.level, 'warn');
    assert.match(check.messages.join('\n'), /A real deploy would be refused now/);
  }
  assert.match(preflightOutcome(onAir, { checkOnly: true }).messages[0], /a broadcast is on air/);
  assert.match(preflightOutcome(down, { checkOnly: true }).messages[0], /could not be read/);
  assert.deepEqual(preflightOutcome(clear, { checkOnly: false }), { exitCode: null, level: 'ok', messages: ['[deploy-online] no broadcast on air.'] });
  const over = preflightOutcome(decideDeploy([{ source: 'poker-server', url: 'x', state: 'on_air', detail: '' }], { allowFlag: true, overrideReason: 'P0 hotfix' }));
  assert.equal(over.exitCode, null);
  assert.match(over.messages[0], /override reason: P0 hotfix/);
  assert.equal(preflightOutcome(null).exitCode, 1, 'junk verdict = refused');
});

test('review 2026-11-02: deploy-online.mjs uses preflightOutcome with CHECK_ONLY; the offline / other-host flags need --check-only', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../deploy-online.mjs', import.meta.url), 'utf8');
  assert.match(src, /preflightOutcome\(verdict, \{ checkOnly: CHECK_ONLY \}\)/);
  assert.match(src, /if \(outcome\.exitCode !== null\) process\.exit\(outcome\.exitCode\)/);
  assert.match(src, /if \(!CHECK_ONLY && \(SKIP_ON_AIR \|\| onAirServer !== null \|\| onAirMaster !== null\)\)/);
  // The pre-flight block itself never exits on a blocked verdict any more except through the outcome.
  const block = src.slice(src.indexOf('await checkOnAir('), src.indexOf('if (CHECK_ONLY) {'));
  assert.equal((block.match(/process\.exit\(/g) || []).length, 1);
});

test('checkOne never throws, whatever fetch does', async () => {
  const r = await checkOne({ source: 'x', url: 'http://x', read: () => true, fetchImpl: () => { throw new Error('boom'); } });
  assert.equal(r.state, 'unreachable');
});
