// 2026-06-19 fix: the mobile entry (index-mobile.html → /pokerroom-mobile/) used
// to be a bare `createRoot().render(<App/>)` that skipped ALL of main.jsx's
// pre-mount bootstrap — bridge cross-site SSO, cold-start silent SSO, service-
// worker registration, session-lifecycle reconnect, the OIDC refresh scheduler,
// cross-tab logout, and error reporting. So anyone landing on /pokerroom-mobile/
// got no auto-login and no PWA. main.jsx already imports the mobile CSS
// (mobile.css + mobile-overrides.css) and renders the same responsive <App/>, so
// the mobile build just delegates to it — identical, correct behavior.
import './main.jsx'
