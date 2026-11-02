/**
 * Deploy freeze while a broadcast is on air (lead spec C9 + R5, 2026-11-01).
 * Used by deploy-online.mjs (plain Node, never bundled). The FTP upload is not
 * atomic: an OBS source that reloads mid-upload can get new HTML naming chunks
 * that are not on the server yet, so .online never deploys while on air.
 *
 * Two sources, ON AIR if EITHER says so:
 *   - poker-server  GET /api/broadcast/on-air  -> {onAir, channels:[...]}
 *   - master API    GET /broadcast/status      -> {live, ...}
 * Each with a 5 s timeout. Unreachable / an error / an unreadable answer FAILS
 * closed (owner default N11). A 404 means the route is not deployed on that
 * service, so nothing can be on air from it: the master API's route ships with
 * P4 (spec), and poker-server's ships with P2 — until then a 404 counts as
 * NOT on air (2026-11-02, CLA: otherwise every .online deploy would need the
 * override until poker-server ships the route).
 *
 * Override: --allow-during-broadcast AND a non-empty BROADCAST_OVERRIDE_REASON.
 *
 * The GET is node:http(s) with no keep-alive agent, NOT the global fetch():
 * on Windows Node 24 a process.exit() after fetch() aborts on a libuv
 * assertion (undici's pooled socket still closing) with exit code 127, which
 * would fail every ship.sh run (probed 2026-11-02).
 */
import http from 'node:http';
import https from 'node:https';

export const ON_AIR_TIMEOUT_MS = 5000;
const MAX_BODY = 256 * 1024;
export const ON_AIR_FAIL_TEXT = 'a broadcast is on air';
export const MASTER_STATUS_URL = 'https://poker-prod-api-azeg4kcklq-uc.a.run.app/poker-api/broadcast/status';

export function serverOnAirUrl(serverUrl) {
  return `${String(serverUrl).replace(/\/+$/, '')}/api/broadcast/on-air`;
}

/**
 * A one-shot GET (no keep-alive) shaped like the bits of a fetch Response we
 * read: {status, ok, json()}. Rejects with an AbortError on `signal`.
 */
export function nodeGet(url, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(e); return; }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: 'GET',
      agent: false,
      headers: { accept: 'application/json', 'cache-control': 'no-store', connection: 'close' },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy(new Error('answer too large'));
      });
      res.on('end', () => resolve({
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        json: async () => JSON.parse(body),
      }));
      res.on('error', reject);
    });
    const onAbort = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      req.destroy(err);
    };
    if (signal) {
      if (signal.aborted) { onAbort(); } else { signal.addEventListener('abort', onAbort, { once: true }); }
    }
    req.on('error', reject);
    req.on('close', () => { if (signal) signal.removeEventListener('abort', onAbort); });
    req.end();
  });
}

/**
 * GET one status URL. Resolves (never rejects) to
 *   {source, url, state: 'on_air'|'off_air'|'not_deployed'|'unreachable', detail}
 * `read(json)` returns true / false for on air, or null when the body is unreadable.
 */
export async function checkOne({ source, url, read, fetchImpl = nodeGet, timeoutMs = ON_AIR_TIMEOUT_MS }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal });
    if (res.status === 404) return { source, url, state: 'not_deployed', detail: 'HTTP 404 (route not deployed: counted as not on air)' };
    if (!res.ok) return { source, url, state: 'unreachable', detail: `HTTP ${res.status}` };
    let body;
    try { body = await res.json(); } catch { return { source, url, state: 'unreachable', detail: 'answer is not JSON' }; }
    const onAir = read(body);
    if (onAir === null) return { source, url, state: 'unreachable', detail: 'answer has no on-air field' };
    return { source, url, state: onAir ? 'on_air' : 'off_air', detail: onAir ? describeOnAir(source, body) : 'not on air' };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || ctrl.signal.aborted);
    return { source, url, state: 'unreachable', detail: aborted ? `no answer within ${timeoutMs / 1000}s` : String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/** poker-server body -> on air? (`onAir`, or any channel on air). */
export function readServerOnAir(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.onAir === 'boolean') {
    return body.onAir || (Array.isArray(body.channels) && body.channels.some((c) => c && c.onAir === true));
  }
  return null;
}

/** master API body -> on air? (`live`). */
export function readMasterLive(body) {
  if (!body || typeof body !== 'object') return null;
  return typeof body.live === 'boolean' ? body.live : null;
}

function describeOnAir(source, body) {
  if (source === 'poker-server' && Array.isArray(body.channels)) {
    const live = body.channels.filter((c) => c && c.onAir === true)
      .map((c) => `${c.channel}${c.eventKey ? ` (${c.eventKey})` : ''}${c.source ? ` via ${c.source}` : ''}`);
    if (live.length) return `on air: ${live.join(', ')}`;
  }
  if (source === 'master-api' && body.kind) return `live: ${body.kind}${body.startedAt ? ` since ${body.startedAt}` : ''}`;
  return 'on air';
}

/** Both checks, in parallel. */
export async function checkOnAir({ serverUrl, masterUrl = MASTER_STATUS_URL, fetchImpl, timeoutMs } = {}) {
  return Promise.all([
    checkOne({ source: 'poker-server', url: serverOnAirUrl(serverUrl), read: readServerOnAir, fetchImpl, timeoutMs }),
    checkOne({ source: 'master-api', url: masterUrl, read: readMasterLive, fetchImpl, timeoutMs }),
  ]);
}

/**
 * Review 2026-11-02 — what deploy-online.mjs does with a verdict.
 *   A real deploy: a blocked verdict (on air / unreadable, no override) FAILS
 *   (exitCode 1): the upload never starts.
 *   --check-only: nothing is uploaded, so the freeze cannot be at stake. The
 *   status is printed and a blocked verdict is a WARNING ("a real deploy would
 *   be refused now"); the run's result is the build guards' (the canonical
 *   pass is P3's ship gate). Before, check-only reported FAIL for a good build
 *   whenever a stream was on air or a status URL was unreachable (offline,
 *   Railway down), and spec C9 says "--check-only prints the status".
 * Returns {exitCode: 1|null, level: 'ok'|'warn'|'fail', messages: string[]}.
 */
export function preflightOutcome(verdict, { checkOnly = false } = {}) {
  const v = verdict && typeof verdict === 'object' ? verdict : { ok: false, onAir: false, unreachable: true };
  const what = v.onAir
    ? `${ON_AIR_FAIL_TEXT} — no .online deploys during a stream.`
    : 'the broadcast on-air status could not be read — refusing to deploy (fail closed).';
  if (v.ok) {
    if (v.overridden) {
      return { exitCode: null, level: 'warn', messages: [`[deploy-online] WARN: deploying ${v.onAir ? 'while on air' : 'without a readable on-air status'} — override reason: ${v.reason}`] };
    }
    return { exitCode: null, level: 'ok', messages: ['[deploy-online] no broadcast on air.'] };
  }
  if (checkOnly) {
    return {
      exitCode: null,
      level: 'warn',
      messages: [
        `[deploy-online] WARN (--check-only): ${v.onAir ? `${ON_AIR_FAIL_TEXT}.` : 'the broadcast on-air status could not be read.'}`,
        '  A real deploy would be refused now. Nothing is uploaded by --check-only, so the build guards decide this run.',
      ],
    };
  }
  return {
    exitCode: 1,
    level: 'fail',
    messages: [
      `[deploy-online] FAIL: ${what}`,
      '  Wait for the stream to end, or (only with a real reason) re-run with',
      '  --allow-during-broadcast and BROADCAST_OVERRIDE_REASON="<why>".',
    ],
  };
}

/**
 * The verdict: {ok, onAir, blocked, overridden, lines}. Blocked when either
 * source is on air or unreachable, unless both override parts are given.
 */
export function decideDeploy(results, { allowFlag = false, overrideReason = '' } = {}) {
  const onAir = results.some((r) => r.state === 'on_air');
  const unreachable = results.some((r) => r.state === 'unreachable');
  const blocked = onAir || unreachable;
  const reason = typeof overrideReason === 'string' ? overrideReason.trim() : '';
  const overridden = blocked && allowFlag && reason.length > 0;
  const lines = results.map((r) => `  ${r.source}: ${r.state.replace('_', ' ')} — ${r.detail} [${r.url}]`);
  return { ok: !blocked || overridden, onAir, unreachable, blocked, overridden, reason, lines };
}
