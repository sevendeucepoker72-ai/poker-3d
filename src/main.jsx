import { createRoot } from 'react-dom/client'
import './index.css'
import './themes.css'
import './mobile.css'
// mobile-overrides.css carries the PWA mobile-specific rules (modal
// positioning fixes, kill backdrop-filter for paint perf, etc.). It
// was previously only imported from main-mobile.jsx (a separate
// mobile-only entry point), so those overrides never reached the
// actual PWA on americanpubpoker.online — latest example was the
// 767px blur-kill rule that "shipped" but never ran in production.
import './mobile-overrides.css'
import App from './App.jsx'

// Register the service worker early so push-enrollment UI doesn't race on
// `navigator.serviceWorker.ready`.
//
// PWA audit #4: show a "new version available" toast when a new SW
// finishes installing in the background. The new SW waits (we removed
// self.skipWaiting from sw.js to keep it from auto-activating), and we
// message it to SKIP_WAITING when the user taps the toast. Without this
// pattern, installed PWAs stay on stale JS chunks across deploys.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Watch for an updated SW reaching "installed" while an old one
      // still controls the page.
      const showUpdateToast = () => {
        // Deferred import — this runs once in the app lifetime and we
        // don't want to ship the toast helper with main.jsx bundle.
        const html = `
          <div id="sw-update-toast" style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;
               background:linear-gradient(180deg,#1F2937,#0B0F19);color:#E5E7EB;
               border:1px solid rgba(34,211,238,0.6);border-radius:12px;
               padding:14px 20px;box-shadow:0 10px 28px rgba(0,0,0,0.6),0 0 20px rgba(34,211,238,0.3);
               font-family:system-ui,-apple-system,sans-serif;font-size:0.92rem;font-weight:600;
               display:flex;gap:12px;align-items:center;cursor:pointer;max-width:calc(100vw - 32px);
               animation:swToastSlide 0.25s ease-out">
            <span>🔄 New version available</span>
            <span style="padding:4px 10px;background:rgba(34,211,238,0.2);border:1px solid rgba(34,211,238,0.5);border-radius:6px;font-size:0.8rem">Reload</span>
          </div>
          <style>@keyframes swToastSlide { from { transform: translate(-50%, 40px); opacity:0 } to { transform: translate(-50%, 0); opacity:1 } }</style>
        `;
        const host = document.createElement('div');
        host.innerHTML = html;
        document.body.appendChild(host);
        host.addEventListener('click', () => {
          const waiting = reg.waiting;
          if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
          // Reload once the new SW takes control.
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
          });
        });
      };
      if (reg.waiting) showUpdateToast();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          // "installed" + existing controller = fresh update waiting
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });
    }).catch((err) => {
      console.warn('[sw] registration failed:', err);
    });
  });
}

createRoot(document.getElementById('root')).render(<App />)
