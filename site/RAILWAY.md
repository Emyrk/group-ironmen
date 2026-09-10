# Railway deployment

This directory is a single deployable service. It serves the existing Group Ironmen UI, proxies existing API calls to `groupiron.men`, and stores private plugin synchronization data in SQLite.

## Service settings

- Repository: `Emyrk/group-ironmen`
- Branch: `master`
- Root directory: `/site`
- Config file: `/site/railway.json`
- Public networking: enabled
- Serverless: enabled
- Volume mount: `/data`

The service listens on Railway's `PORT` variable and exposes `GET /health`.

## Variables

Copy `.env.example` into Railway's service variables. Keep all tokens server-side and never expose them as browser variables.

- `DATABASE_PATH=/data/group-ironmen.sqlite3`
- `PRIVATE_GROUP_NAME`: the only accepted group in browser and plugin URLs
- `PRIVATE_SYNC_TOKEN`: credential used by the private UI and RuneLite synchronization clients
- `UPSTREAM_BASE_URL=https://groupiron.men`
- `UPSTREAM_GROUP_NAME`: the group name registered at groupiron.men
- `UPSTREAM_GROUP_TOKEN`: the corresponding groupiron.men token

The browser logs in with `PRIVATE_GROUP_NAME` and `PRIVATE_SYNC_TOKEN`. Existing API routes are authenticated locally, rewritten to the configured upstream group, and sent with `UPSTREAM_GROUP_TOKEN`. Bank Tags routes are handled locally and never forwarded.

## Bank tag editor

The authenticated `/group/bank-tags` page reads complete tag documents from the private bank-tag API and edits the same `name`, `iconItemId`, `itemIds`, and `layout` fields used by Bank Tags Extended. Browser saves use the document's loaded revision in `If-Match`, so a concurrent RuneLite or browser edit returns a conflict instead of being overwritten.

The page supports the RuneLite `banktags,1,...` clipboard format and the `banktaglayoutsplugin:...` format used by BankLayouts.com. Imports remain local drafts until the user explicitly saves. The private group token stays in the existing authenticated browser storage and authorization header; it is never included in an export or URL.

## Data and sleeping

SQLite data is stored on the mounted volume. Use one replica because a Railway volume can attach to only one deployment at a time. The service has no background polling or database network connection, so Railway Serverless can sleep it after RuneLite and browser requests stop.

## Updates from upstream

The fork keeps the original repository as the `upstream` Git remote:

```sh
git fetch upstream
git merge upstream/master
```

Keep private API modules under `site/server/` and new UI features in their own component directories to minimize merge conflicts.
