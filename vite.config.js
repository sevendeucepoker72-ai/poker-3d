import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const rootFile = (name) => fileURLToPath(new URL(name, import.meta.url))

// APP Precision: the skin's art in public/cinematic/ keeps fixed names, and
// the host serves .webp / .png as immutable for a year, so a changed picture
// would never reach a phone that already has the old one. Every reference
// gets ?v=<first 8 hex of the file's md5>: CSS url('/cinematic/...') is
// rewritten here, JS goes through cinematicAsset() and
// 'virtual:app-art-versions'. A switch-off build gets an empty map.
const APP_ART = 'virtual:app-art-versions'
function appArtVersions() {
  const dir = rootFile('./public/cinematic')
  const out = {}
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[relative(dir, p).split('\\').join('/')] = createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 8)
    }
  }
  try { walk(dir) } catch { /* no art folder */ }
  return out
}
function appArtCacheBust() {
  let on = false
  let build = false
  let versions = {}
  return {
    name: 'app-art-cache-bust',
    enforce: 'pre',
    configResolved(c) {
      on = c.env.VITE_APP_CINEMATIC === '1'
      build = c.command === 'build'
      versions = appArtVersions()
    },
    resolveId(id) { return id === APP_ART ? `\0${APP_ART}` : null },
    load(id) {
      if (id !== `\0${APP_ART}`) return null
      return `export default ${JSON.stringify(on || !build ? versions : {})}`
    },
    transform(code, id) {
      if (!id.split('?')[0].endsWith('.css') || !code.includes('/cinematic/')) return null
      return code.replace(/url\((['"]?)\/cinematic\/([^'")?#]+)\1\)/g, (m, q, p) => (versions[p] ? `url(${q}/cinematic/${p}?v=${versions[p]}${q})` : m))
    },
  }
}

// APP Precision (final repair 1): the table skin's CSS is linked only in a
// switch-on build (VITE_APP_CINEMATIC=1). Components import
// 'virtual:app-precision-styles/<part>'; a switch-off build resolves it to an
// empty module, so its pages load exactly the live CSS. There the skin's CSS
// is still built, as one file no page links (assets/app-precision-skin-*.css),
// so canonical-features.txt finds its tokens in every build.
const APP_STYLES = 'virtual:app-precision-styles/'
const APP_STYLE_PARTS = ['hud', 'table', 'chrome']
function appPrecisionStyles() {
  let on = false
  let build = false
  return {
    name: 'app-precision-styles',
    enforce: 'pre',
    configResolved(c) {
      on = c.env.VITE_APP_CINEMATIC === '1'
      build = c.command === 'build'
    },
    buildStart() {
      if (on || !build) return
      this.emitFile({ type: 'chunk', id: rootFile('./src/components/scene/appPrecisionStyles.all.js'), name: 'app-precision-skin' })
    },
    resolveId(id) {
      if (!id.startsWith(APP_STYLES)) return null
      const part = id.slice(APP_STYLES.length)
      if (!APP_STYLE_PARTS.includes(part)) return null
      return on ? rootFile(`./src/components/scene/appPrecisionStyles.${part}.js`) : `\0${id}`
    },
    load(id) {
      if (id.startsWith(`\0${APP_STYLES}`)) return 'export {}'
      // (APP Precision final check) a switch-off build also leaves out the
      // skin's two runtime helpers. Every call to them is behind
      // cinematicEnabled or is a no-op cleanup, so they become same-named
      // no-ops, and the off build's index.html preloads exactly live's JS.
      if (!on && build) {
        const m = /[\\/]src[\\/]components[\\/]scene[\\/](appPlacement|appHudFlags)\.js$/.exec(id.split('?')[0])
        if (m) return APP_JS_STUBS[m[1]]
      }
      return null
    },
  }
}
const APP_JS_STUBS = {
  appPlacement: [
    'export function measureAppSeats() { return null }',
    'export const sameAppMeas = () => true',
    'export function appInputsDirty() { return false }',
    'export function appInputsClean() {}',
    'export function appInputsReset() {}',
    'export function invalidateAppPlacement() {}',
    'export function placeAppFloaters() {}',
    'export function setAppLayoutPing() {}',
    'export function appLayoutPing() {}',
  ].join('\n'),
  appHudFlags: [
    'export function syncAppHudFlags() { return false }',
    'export function releaseAppHudFlags() {}',
    'export function syncAppTableFlags() {}',
  ].join('\n'),
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [appPrecisionStyles(), appArtCacheBust(), react()],
  base: '/',
  resolve: {
    dedupe: ['react', 'react-dom', 'zustand'],
  },
  build: {
    // 2026-05-07 device-audit P1 — pin browser targets so Vite/esbuild
    // transpiles modern syntax (optional chaining, nullish coalescing,
    // class fields, async/await chains) for users on iOS 13/14 + older
    // Chromium. Default 'modules' target = esnext-ish, which left
    // pre-Safari 14 / Chrome 87 users with a parse error white screen.
    // safari14 = iOS 14+; chrome87 = late 2020+; firefox78 = ESR baseline;
    // edge88 matches Chromium baseline.
    target: ['es2019', 'safari14', 'chrome87', 'firefox78', 'edge88'],
    rollupOptions: {
      // 2026-11-02 (lead spec C1) — a second HTML entry: broadcast.html, the
      // tournament broadcast page OBS / the stream worker loads. It shares the
      // vendor chunks below and a few pure utility chunks with the app; it
      // never loads the app's sign-in, service worker or update toast
      // (src/broadcast/main.jsx; tests/broadcast/buildEntry.test.mjs). The main entry keeps
      // the key `index`, so its built names (assets/index-*.js) do not change.
      input: {
        index: rootFile('./index.html'),
        broadcast: rootFile('./broadcast.html'),
      },
      output: {
        // rolldown (Vite 8) requires manualChunks as a function
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('@react-three')) {
            return 'vendor-three';
          }
          if (id.includes('node_modules/socket.io-client') || id.includes('node_modules/engine.io-client')) {
            return 'vendor-socket';
          }
          if (id.includes('node_modules/zustand')) {
            return 'vendor-store';
          }
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor-react';
          }
          // R2 (2026-10-11, APPUI-32) — NO manual groups for app code. The
          // 'game-overlays' / 'lobby-features' groups made rolldown pull the
          // modules those components share with the app shell (stores,
          // services, utils — ~90 exports) into the two groups, and the entry
          // imported them STATICALLY while the preload filter below hid them:
          // the sign-in screen waited for index.js, then fetched ~95KB gz of
          // those two chunks serially. The React.lazy() imports split the app
          // code on their own; a shared module lands in a chunk the entry
          // preloads.
          // The groups also linked those overlays' CSS in <head>, BEFORE the
          // lazy Lobby.css, whose `.lobby > * { position: relative; z-index: 1 }`
          // then beat `.staking-overlay` / `.social-bracket-overlay` /
          // `.tb-overlay` / `.td-overlay { position: fixed }`: Staking, Social
          // Bracket, Live Bracket and the TD wizard opened at the BOTTOM of the
          // lobby, off-screen (top ~705px on a 640-667px phone). As lazy
          // chunks of Lobby their CSS always lands after Lobby's. Keep lobby
          // overlays out of manual groups (or portal them to <body>).
        },
      },
    },
    chunkSizeWarningLimit: 800,
    // Fix modulepreload leak: Vite defaults to preloading EVERY transitive dep of
    // the entry chunk, which drags heavy lazy-loaded chunks (game-overlays,
    // lobby-features, vendor-three) into the initial HTML as <link rel="modulepreload">.
    // Those should load only when their route/component is opened. Here we filter
    // heavy side-chunks out of the initial preload list so the browser doesn't
    // fetch them until the dynamic import that actually needs them fires.
    // Ref: https://vite.dev/config/build-options.html#build-modulepreload
    modulePreload: {
      resolveDependencies: (_filename, deps /* , { hostId, hostType } */) => {
        // Only vendor-three (the 3D scene / avatar customizer) is heavy AND
        // reached through a dynamic import only. Never filter a chunk the
        // entry imports statically: that is a serial waterfall, not a saving.
        const HEAVY_LAZY_CHUNKS = [
          'vendor-three',
        ];
        return deps.filter((dep) => {
          // Keep small vendor chunks and app chunks preloaded for fast initial paint.
          // Drop only the heavy chunks that are truly demand-loaded.
          return !HEAVY_LAZY_CHUNKS.some((chunk) => dep.includes(chunk));
        });
      },
    },
  },
})
