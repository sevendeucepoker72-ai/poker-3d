// One-shot FTP deploy for americanpubpoker.online (poker-3d).
// Uses the `onlinedeploy@urf.hux.mybluehost.me` account which is chrooted to
// /public_html/website_09b37f15/ — so the FTP root IS the .online docroot.
//
// NOTE 2026-04-22: We do NOT call clearWorkingDir() anymore, per SITES.md
// rule. Even though the onlinedeploy user can't reach outside its chroot, a
// wipe-then-upload pattern leaves the docroot empty if the upload has any
// hiccup — that's what took .online down on 2026-04-17 (500 on every path).
// Instead: uploadFromDir overwrites existing files by name. Old orphan
// hash-named assets stay until a future cleanup; letting them accumulate
// is strictly safer than risking an empty docroot on network blip.
//
// Usage: FTP_HOST=... FTP_USER=... FTP_PASS=... node deploy-online.mjs
import { Client } from 'basic-ftp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');

const host = process.env.FTP_HOST;
const user = process.env.FTP_USER;
const password = process.env.FTP_PASS;

if (!host || !user || !password) {
  console.error('Missing FTP_HOST / FTP_USER / FTP_PASS env vars');
  process.exit(1);
}

if (!fs.existsSync(DIST_DIR) || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error(`[deploy] No build at ${DIST_DIR}. Run \`npm run build\` first.`);
  process.exit(1);
}

// 2026-05-06 — Source-vs-build freshness guard. Catches the
// "build is older than source" case where someone edits a file but
// forgets to rebuild before deploying. Earned on 2026-05-06 after
// the standalone vs mono-repo poker-3d tree drift shipped a stale
// pre-Phase-2-#5 build to .online and broke Play Online sign-in.
const SRC_DIR = path.join(__dirname, 'src');
const distMtime = fs.statSync(path.join(DIST_DIR, 'index.html')).mtimeMs;
function findNewerSource(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const nested = findNewerSource(full);
      if (nested) return nested;
    } else {
      const m = fs.statSync(full).mtimeMs;
      if (m > distMtime + 5000) return full; // 5s grace for clock skew
    }
  }
  return null;
}
const newerSrc = findNewerSource(SRC_DIR);
if (newerSrc) {
  console.error(`[deploy-online] FAIL: ${newerSrc} is newer than dist/index.html`);
  console.error('  Run `npm run build` again before deploying — the build is stale.');
  process.exit(1);
}

// 2026-05-06 — Canonical features manifest grep. Aborts the deploy
// if any tokens listed in canonical-features.txt are missing from
// the built bundle. Earned on 2026-05-06 after the poker-3d split-
// tree incident where Phase 2 #5 OIDC code shipped to one tree but
// the deploy ran from a stale tree without it. The grep proves the
// expected features are actually compiled into the bundle we're
// about to push.
const MANIFEST_PATH = path.join(__dirname, 'canonical-features.txt');
if (fs.existsSync(MANIFEST_PATH)) {
  const tokens = fs.readFileSync(MANIFEST_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  // Concatenate all dist files into one search blob.
  function readAllUnder(dir) {
    let out = '';
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) out += readAllUnder(full);
      else if (/\.(js|css|html|json|webmanifest)$/.test(ent.name)) {
        try { out += fs.readFileSync(full, 'utf8'); } catch (_) {}
      }
    }
    return out;
  }
  const blob = readAllUnder(DIST_DIR);
  const missing = tokens.filter((t) => !blob.includes(t));
  if (missing.length) {
    console.error('[deploy-online] FAIL: canonical-features.txt tokens missing from build:');
    for (const m of missing) console.error(`  - ${m}`);
    console.error(`  Either restore the feature in source, or remove the line in canonical-features.txt`);
    console.error(`  in the SAME commit (the diff is the audit trail).`);
    process.exit(1);
  }
  console.log(`[deploy-online] canonical-features.txt: ${tokens.length} tokens verified in bundle.`);
} else {
  console.warn('[deploy-online] WARN: no canonical-features.txt — deploy guard disabled.');
}

// 2026-05-06 — retry-with-backoff for FTPS connect.
//
// Bluehost shared Pure-FTPd intermittently times out the TLS handshake on
// port 21 (`AUTH TLS` → server response delay or TLS thread starvation).
// Pre-fix: the script gave up on the first failure with an opaque
// "(control socket)" message. Up to 6 manual re-runs were needed during
// today's session. Three attempts at 5s/15s/45s catches every observed
// failure mode without holding the deploy hostage if Bluehost is truly
// down.
//
// Diagnostic toggles (set via env on a single run to A/B-test root cause):
//   FTP_DIAG_FORCE_TLS12=1     pin TLSv1.2 + a single ECDHE-RSA-AES256-GCM
//                              cipher (catches Node 24 strict-default issues)
//   FTP_DIAG_IMPLICIT_FTPS=1   use port 990 implicit FTPS (skips AUTH TLS)
//   FTP_VERBOSE=1              dump FTP protocol chatter to stderr
//
// Default: explicit FTPS on port 21, no TLS pin.
const ATTEMPTS = parseInt(process.env.FTP_RETRY_ATTEMPTS || '3', 10);
const BACKOFFS_MS = [5_000, 15_000, 45_000]; // index by attempt-1
const FORCE_TLS12 = process.env.FTP_DIAG_FORCE_TLS12 === '1';
const IMPLICIT_FTPS = process.env.FTP_DIAG_IMPLICIT_FTPS === '1';
const VERBOSE = process.env.FTP_VERBOSE === '1';

function buildAccessOpts() {
  const secureOptions = { rejectUnauthorized: false };
  if (FORCE_TLS12) {
    // Pin TLS 1.2 + a single cipher Bluehost's Pure-FTPd is known to support.
    // If failures stop with this set, root cause is Node v24 cipher-default
    // negotiation against Bluehost's older TLS config.
    secureOptions.minVersion = 'TLSv1.2';
    secureOptions.maxVersion = 'TLSv1.2';
    secureOptions.ciphers = 'ECDHE-RSA-AES256-GCM-SHA384';
  }
  return {
    host,
    port: IMPLICIT_FTPS ? 990 : 21,
    user,
    password,
    secure: true, // explicit FTPS unless IMPLICIT_FTPS sets port 990
    secureOptions,
  };
}

function classifyError(err) {
  const m = err && err.message ? err.message : String(err);
  if (/control socket/i.test(m)) return 'tls_handshake_timeout';
  if (/ETIMEDOUT/i.test(m)) return 'tcp_timeout';
  if (/ECONNREFUSED/i.test(m)) return 'tcp_refused';
  if (/ECONNRESET/i.test(m)) return 'tcp_reset';
  if (/EAI_AGAIN|getaddrinfo|ENOTFOUND/i.test(m)) return 'dns';
  if (/530|incorrect.*password|login.*incorrect/i.test(m)) return 'auth';
  if (/421/i.test(m)) return 'server_overload';
  return 'unknown';
}

async function attemptDeploy(attempt) {
  const client = new Client(60_000);
  client.ftp.verbose = VERBOSE;
  const start = Date.now();
  const accessOpts = buildAccessOpts();
  const flagSummary = [
    FORCE_TLS12 ? 'TLS1.2-pinned' : null,
    IMPLICIT_FTPS ? 'implicit-FTPS' : 'explicit-FTPS',
  ].filter(Boolean).join(', ');
  console.log(`[deploy-online] attempt ${attempt}/${ATTEMPTS} — connecting to ${host}:${accessOpts.port} as ${user} (${flagSummary})...`);
  try {
    await client.access(accessOpts);
    console.log(`[deploy-online] connected (${Date.now() - start}ms). pwd:`, await client.pwd());

    // onlinedeploy is chrooted to /public_html/website_09b37f15/. Upload
    // without clearing — overwrites same-name files; orphan old-hash
    // assets accumulate (safer than wipe-then-upload; see header note).
    console.log('[deploy-online] uploading fresh build (no pre-wipe)...');
    await client.uploadFromDir(DIST_DIR);

    const files = await client.list();
    console.log('[deploy-online] remote root listing:');
    for (const f of files) {
      console.log(`  ${f.isDirectory ? 'd' : '-'} ${String(f.size).padStart(10)}  ${f.name}`);
    }

    const ms = Date.now() - start;
    console.log(`[deploy-online] done in ${ms}ms`);
    return { ok: true };
  } catch (err) {
    const phase = classifyError(err);
    const ms = Date.now() - start;
    console.error(`[deploy-online] attempt ${attempt} FAILED after ${ms}ms — phase=${phase}: ${err.message}`);
    return { ok: false, phase, err };
  } finally {
    client.close();
  }
}

(async () => {
  let lastErr = null;
  for (let i = 1; i <= ATTEMPTS; i++) {
    const result = await attemptDeploy(i);
    if (result.ok) process.exit(0);
    lastErr = result.err;
    // Don't retry on permanent errors — auth failures and DNS failures
    // won't fix themselves with a wait.
    if (result.phase === 'auth' || result.phase === 'dns') {
      console.error(`[deploy-online] phase=${result.phase} is permanent; not retrying.`);
      break;
    }
    if (i < ATTEMPTS) {
      const delay = BACKOFFS_MS[i - 1] ?? BACKOFFS_MS[BACKOFFS_MS.length - 1];
      console.error(`[deploy-online] retrying in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error('[deploy-online] all attempts exhausted. Last error:', lastErr && lastErr.message);
  console.error('[deploy-online] If TLS handshake keeps timing out, try:');
  console.error('  FTP_DIAG_FORCE_TLS12=1 node deploy-online.mjs       (pin TLS 1.2 + cipher)');
  console.error('  FTP_DIAG_IMPLICIT_FTPS=1 node deploy-online.mjs     (skip AUTH TLS via port 990)');
  console.error('  FTP_VERBOSE=1 node deploy-online.mjs                (full FTP protocol log)');
  process.exit(1);
})();
