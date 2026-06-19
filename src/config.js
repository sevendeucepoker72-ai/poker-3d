// 2026-06-19 Phase 5: single source of truth for backend hosts. Previously each
// URL was a copy-pasted `import.meta.env.X || 'fallback'` across 4-8 files, with
// two of them (avatarService, main.jsx) hardcoded with NO env override — so a
// dev/staging build silently hit prod. These constants resolve the same values
// the call sites used; import from here instead of re-deriving.

// Socket.io server (poker-server / Railway). Null in a prod build with no env
// set, so a misconfigured deploy fails loud instead of hitting localhost.
export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : null);

// Master REST API (americanpub.poker, Cloud Run). Accept both historical env
// var names so existing deploy configs keep working.
export const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_MASTER_API_URL ||
  'https://poker-prod-api-azeg4kcklq-uc.a.run.app/poker-api';

// The companion player app (a different product) — deep-link target only.
export const PLAYER_APP = 'https://americanpub.poker';

// NOTE: the auth-server URL + OAuth client id + API_RESOURCE indicator are
// deliberately NOT centralized here. They live in authService.js / bridge.js /
// main.jsx, where API_RESOURCE is intentionally hardcoded to exactly match the
// auth-server's config (an env-overridable value there would throw OAuth
// `invalid_target` and 401-storm refreshes — see authService.js comment).
