// Production hosts compiled into every build as the FALLBACK when the matching
// VITE_* variable is not set (2026-10-11, .online fix round 1 — OPS-8).
//
// .env.production (VITE_SERVER_URL) is gitignored, so a build from a fresh
// clone used to ship SERVER_URL = null: io(null) connects to the page's own
// origin, the SPA fallback answers /socket.io with HTML, and every player sits
// on "Connecting..." while every deploy guard still passed (the host is also in
// index.html's CSP, which the canonical-features grep reads).
//
// This module has NO imports and no import.meta on purpose: deploy-online.mjs
// (plain Node) imports the SAME constant and refuses to upload a build whose JS
// chunks do not contain this host. Moving the game server = change it HERE,
// plus .env.production and the connect-src of the CSP (index.html meta and the
// docroot .htaccess header).
export const PRODUCTION_SERVER_URL = 'https://poker-server-production-60c0.up.railway.app';
