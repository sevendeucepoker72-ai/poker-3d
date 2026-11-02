/**
 * broadcast.html entry (lead spec C1 + R3 + R6, 2026-11-02). Deliberately tiny:
 * read the URL config and the key, take the key out of the address bar, start
 * the broadcast runtime, expose the stream worker's health contract, render.
 * No sign-in, no service worker registration, no update toast, no player-app
 * stylesheet.
 *
 * The key comes from the `#k=` fragment (OBS) or window.__APK_BROADCAST_KEY
 * (the stream worker injects it before the page loads); the page then removes
 * the fragment with history.replaceState and forgets the global.
 */
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { SERVER_URL } from '../config.js';
import { parseBroadcastConfig, stripKeyFromHref } from './model/urlConfig.js';
import { createBroadcastRuntime, BROADCAST_PAGE_VERSION } from './net/broadcastRuntime.js';
import BroadcastApp from './BroadcastApp.jsx';
import './broadcast.css';

function readConfigOnce() {
  let injected = null;
  try { injected = window.__APK_BROADCAST_KEY || null; } catch { injected = null; }
  const config = parseBroadcastConfig(window.location.search, window.location.hash, injected);
  try { delete window.__APK_BROADCAST_KEY; } catch { /* non-configurable: leave it */ }
  const clean = stripKeyFromHref(window.location.href);
  if (clean) {
    try { window.history.replaceState(null, '', clean); } catch { /* ignore */ }
  }
  return config;
}

// A producer 'reload' (only honoured in the slate or the break): a key that
// came in the fragment is put back first so the reload keeps it; an injected
// key is injected again by the worker on the new document.
function reloadKeepingKey(config) {
  return () => {
    if (config.key && config.keySource === 'fragment') {
      try {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#k=${encodeURIComponent(config.key)}`);
      } catch { /* ignore */ }
    }
    window.location.reload();
  };
}

function boot(config, ioImpl) {
  if (config.deck === 4) document.documentElement.classList.add('pref-four-color-deck');
  const runtime = createBroadcastRuntime({ io: ioImpl, serverUrl: SERVER_URL, config, reload: reloadKeepingKey(config) });
  window.__apkBroadcast = Object.freeze({
    version: BROADCAST_PAGE_VERSION,
    health: () => runtime.health(),
  });
  runtime.start();
  createRoot(document.getElementById('bc-root')).render(<BroadcastApp runtime={runtime} config={config} />);
}

const config = readConfigOnce();
if (import.meta.env.DEV && config.fixture) {
  // DEV only (never in a production build): replay recorded frames from
  // src/broadcast/dev/fixtures through a fake socket — the whole real path runs.
  import('./dev/fixtureIo.js').then(
    (m) => boot(config, m.fixtureIo(config.fixture)),
    () => boot(config, io),
  );
} else {
  boot(config, io);
}
