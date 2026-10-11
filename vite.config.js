import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
