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
