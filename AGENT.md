# Poker-3D — AGENT.md

> Per-app rules for `americanpubpoker.online` (the online poker game).
>
> Standalone GitHub repo: `sevendeucepoker72-ai/poker-3d`. Not part of
> the mono-repo.

## Identity

- **Purpose:** Online poker game — weekly/monthly qualifiers, cash games, championship-qualifier rounds with AI opponents
- **Live URL:** https://americanpubpoker.online
- **Source:** `C:/Users/josh2/Downloads/developer setup/poker-3d/` (single canonical tree)
- **Stack:** Vite + React (SPA), Socket.io client
- **Backend:** Connects to `poker-server` on Railway via Socket.io
- **Hosting:** Bluehost (cPanel account `urfhuxmy`, Starter Hosting plan — same cPanel as americanpubpoker.com)

## Files an agent must read before editing

1. This file
2. `CLAUDE.md` (workspace root)
3. `SITES.md` §2 (.online section — has the docroot incident history)
4. `poker-3d/canonical-features.txt`
5. `CONTRACTS.md` if touching the poker-server REST/socket contract

## Build + deploy

```
./ship.sh poker-3d
```

Wraps `poker-3d/deploy-online.mjs`.

## Hard rules (earned)

| # | Rule | Earned |
|---|---|---|
| 1 | **Real docroot is `/home1/urfhuxmy/public_html/website_09b37f15/`.** Apache serves from there. The `/americanpubpoker.online/` directory at FTP root is a **stale trap** Apache does NOT read. Deploys must land in the real docroot. | 2026-04-17 (site 500'd everywhere) |
| 2 | **Use `onlinedeploy@urf.hux.mybluehost.me` FTP user.** Scoped/chrooted to `/public_html/website_09b37f15/` so plain `uploadFromDir` lands directly. `appmain2/appmain3` users CANNOT reach this docroot. | 2026-04-17 |
| 3 | **NEVER `clearWorkingDir()`.** Better to let orphan old-hash assets accumulate than wipe-then-upload (which leaves the docroot empty if the upload has any hiccup). Cause of the 2026-04-17 500-everywhere incident. | 2026-04-17 |
| 4 | **`base: '/'` in `vite.config.js`.** Do NOT change to `/pokerroom/` or anything else. `.htaccess` `RewriteBase /` requires apex base. | 2026-04-17 evening (RewriteBase wrong on recovery) |
| 5 | **Bridge-token cross-site SSO uses `urn:apk:bridge` grant.** Renaming breaks SSO across all 4 sites. | 2026-05-07 |
| 6 | **Phase 2 #5 native-OIDC migration:** the `.online` site uses OIDC tokens, not just bridge tokens. Phone is auth-server-side. When the mono-repo mirror existed, this migration only landed in `poker-3d/` standalone and the mono-repo mirror shipped stale — site silently regressed to bridge-token-only mode on iOS PWA. The mirror is now deleted; only the standalone path exists. | 2026-05-06 |
| 7 | **`tableStore.sendAction` routes through `emitPlayerAction`** (in `services/socketService.js`). Nonce + reconnect-queue. Do NOT introduce a direct `socket.emit('action', ...)` — bypasses both. | Convention |
| 8 | **Player action nonces are deduped server-side** at `poker-server/src/index.ts:~5700`. Replays return "Duplicate action" — client treats as success (idempotent retry). | Convention |
| 9 | **Provably-fair deck commitments are user-visible.** `poker-server` exposes `/api/fairness/:tableId/:handNumber` for verification. Don't break the commitment buffer in `ensureTableProgressListener`. | 2026-04-22 |
| 10 | **Every `useGameStore` field the API can change has a self-heal merge on mount + tab-resume (CLAUDE.md Pattern B).** Template: `refreshUserRolesFromMe` in `App.jsx`, which fetches `/users/:id/me` and merges roles/VIP via `mergeServerUserFields`. When you add a new server-controlled field to `useGameStore`, ship the merge in the same commit. Never stamp a server-controlled field once at `oauthLogin` and forget. | 2026-05-12 |
| 11 | **One account per tab on a shared browser.** The Play-Online resume record (`poker_online_resume`, `services/sessionResume.js`) lives in THIS tab's sessionStorage only — never localStorage, whatever keep-signed-in says. At boot it is skipped (and forgotten) while the browser holds a stored OIDC sign-in that is not provably the same account (`readResumeRecordForBoot`). A `'ticket'` tab (`services/tabSession.js`, carries the master id from the resume token) never sends, refreshes or keeps another account's stored OIDC tokens: every HTTP bearer goes through `getHttpBearer` / `bearerForThisTab`, `authScheduler` skips, `clearOtherAccountOidcFromTicketTab` drops them from the store (the device copy is never touched — U5). A new HTTP call that sends a bearer MUST get it from `getHttpBearer()` or pass it through `bearerForThisTab()` — a raw `getAuthToken()` in a ticket tab can be another account's token. | 2026-10-10 (F5: the next person on a browser was resumed into the previous player's game; socket A + HTTP B) |
| 12 | **A deep-link ticket never races the browser's stored sign-in, and a ticket tab neither follows nor causes another account's sign-out.** While a Play Online / waitlist ticket is unanswered, `startLocalAutoLogin` (resume / refresh / legacy, also the bridge fallback) is DEFERRED by `services/deepLinkBootGate.js`; it runs only when the ticket FAILS (every server answer is final - the ticket is burned on receipt), never after a success, never on its own after a play refusal (the refusal screen stays; Continue reloads), and a timeout is not an answer. A stored-credential boot success that arrives while the tab is already a DIFFERENT user is dropped and the tab re-signs its socket in with its own session (`storedSignInWouldSwitchUser` + `reauthSocket`). Cross-tab sign-outs go through `services/crossTabSignOut.js:shouldApplyRemoteSignOut`: a `ticket` tab follows only one naming its OWN account (BroadcastChannel `logout` userId, the `poker_logout_broadcast` marker now `{at, userId}`); a ticket tab's own Sign Out on a browser whose stored sign-in is another (or an unprovable) account's leaves those keys alone, writes no marker, skips `/session/end` (the auth-server ends the SSO cookie's account) and broadcasts `ticket-tab-sign-out` instead of `logout`. Never add a boot sign-in path that bypasses `startLocalAutoLogin`, a peer-tab teardown that skips `shouldApplyRemoteSignOut`, or a device-wide wipe / `startLogout` in `tearDownSession` outside the `leaveDeviceSignIn` check. | 2026-10-10 (P4/P7: a Play Online link on a shared browser could end as the stored account - socket, seat and buy-in included; another account's sign-out logged a ticket tab out, and a ticket tab's Sign Out signed the stored account out everywhere) |
| 13 | **A Play Online tab and the browser's OTHER sign-in leave each other alone, end to end.** (a) Q4: once the deep link is consumed (`deepLinkConsumed` in App.jsx: the ticket signed the tab in, the server answered it with a final failure, or the tab got signed in any other way) the deep-link screen is never rendered again on that page load, so a Sign Out that leaves the browser's sign-in alone lands on LoginScreen - never a reload (a reload boots the other account). An ANSWERED failure shows its real text on LoginScreen (`deepLinkFailureText`), never "Connection timed out" (that screen is for no answer). A play refusal keeps its own screen. (b) Q5: `authScheduler` holds every refresh while this page load's ticket is unanswered and the tab has no session (`deepLinkBootGate.deepLinkTicketPending`, noted by main.jsx BEFORE `authScheduler.start()`); it re-checks after every refresh settles - a revoked refresh in a tab that has become another account's ticket tab dispatches NO `poker:session-expired` and only drops that dead sign-in from the browser (only while the browser still holds the refused refresh token); and main.jsx's session-expired listener never tears down a ticket tab whose stored sign-in is not provably its own (`ticketTabOutlivesDeviceSignIn`). (c) The deep-link ticket is written to THIS tab's sessionStorage, not the device-wide `poker_auth_token`, when the browser holds another (or an unprovable) account's sign-in (`tokenStorage.deviceHoldsOtherOidcSignIn`); a leave-alone Sign Out still removes the tab's own credentials (`dropThisTabsOwnCredentials`). (d) A ticket tab's Sign Out first runs a sign-in census over BroadcastChannel (`crossTabSignOut.requestSignInCensus`, 250ms, alongside the revoke ack; every tab answers via `installSignInCensusResponder` in main.jsx): another account signed in in another tab ("keep me signed in" OFF - invisible in storage) counts as another account's sign-in. A tab whose sign-in lives only in its own sessionStorage follows only its own account's sign-out and never a localStorage key removal (`signInLivesInThisTabOnly`). (e) A ticket tab whose resume chain ended (no record / `resume_invalid`) falls back to the browser's stored sign-in ONLY when it is provably the same account (`socketReauth.ticketTabOwnsDeviceSignIn`) and then becomes an `oidc` tab. (f) A stored sign-in of another account that was dropped is fenced (`fenceDroppedSignIn`): this tab's re-auth never presents those credentials, and if no own credential works the socket is cycled - never left bound to the other account. | 2026-10-10 (review of P4/P7: endless "Signing you in..." after Sign Out; another account's dead refresh token signed a new Play Online tab out; same-account tab lost reconnects at the 24h resume cap; the ticket stayed in poker_auth_token; a keep-signed-in-OFF account was signed out by a ticket tab's Sign Out; a socket could stay bound to a dropped account) |

## Surface area

### Pages / routes

Table view (lobby + game), tournament view, profile, leaderboards, hand history, fairness verifier, `/auth/callback`.

### API consumers (see CONTRACTS.md)

- `poker-prod-api` for user/profile/auth via Bearer + bridge tokens
- `auth-server` OIDC + `urn:apk:bridge` grant
- `poker-server` (Railway) via Socket.io for game state + `/api/fairness/*` REST

## Deploy pre-flight (built into deploy-online.mjs)

1. canonical-features.txt grep against built bundle (every commit's locked
   feature tokens MUST be present)
2. NO `clearWorkingDir` call — only `uploadFromDir`
3. FTPS via `onlinedeploy` user (chrooted)
4. Land in `/public_html/website_09b37f15/`

## Rollback

Same pattern as marketing — Bluehost FTP doesn't versionize. Roll back
via prior git SHA:

```
git checkout <prior-sha>
npm run build
./ship.sh poker-3d
git checkout main
```

## Common workflows

### Locking a new feature

Append a minification-safe token (CSS class, log tag, visible UI string)
to `canonical-features.txt` in the SAME commit that ships the feature.
deploy-online.mjs greps for it. Function/variable names get mangled by
Terser to single letters — never lock those.

### Touching the game loop / table state

1. Reproduce the bad state in `poker-server/tests/PokerTable.test.ts`
2. Fix in `poker-server/src/PokerTable.ts`
3. Add the regression guard test
4. CI on `poker-server` repo runs lint + tests + build on push/PR

## Gotchas

- **`tests/e2e/` is in the mono-repo**, not this repo. E2E tests for
  poker-3d live there alongside admin/player tests.
- **Hand-state Redis snapshots** (in poker-server) rehydrate in-progress
  hands across redeploys. Without `REDIS_URL` set on Railway,
  in-progress hands are LOST on every redeploy.
- **iOS PWA cold launch:** `window.location.search` arrives empty on
  home-screen launches. `authService.getCallbackParams` has a 5-source
  fallback chain. Don't simplify it without testing iOS PWA.
- **In-app webviews** (FB, IG, TikTok) strip third-party cookies and
  break OAuth. `detectInAppBrowser` surfaces an "Open in Safari" CTA.
