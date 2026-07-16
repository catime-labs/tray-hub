# tray-hub

Cloudflare Worker registry and asset gateway for Catime tray animations.

## API

- `GET /sections.json` returns the website-compatible collection manifest.
- `GET /v1/collections` is an alias for the manifest.
- `GET /v1/assets/:collection/:file` serves a registered GIF through Cloudflare.
- `GET /health` returns the service status.

Only files listed in `data/collections.json` can be fetched through the asset
gateway. Responses include CORS and cache headers.

## Local development

```bash
npm install
npm test
npm run dev
```

## Add a collection

Add its metadata to `data/collections.json`, then run:

```bash
npm run sync
```

The sync script reads the repository tree through the GitHub API and records
all GIF paths. Numeric filenames are sorted naturally.

## Cloudflare deployment

Deployment is manual. After reviewing the catalog and tests, run:

```bash
npm run deploy
```

For private image repositories, upload a fine-grained GitHub token with
read-only Contents permission before the first deployment:

```bash
npx wrangler secret put GITHUB_TOKEN
```

Bind the Worker to the custom domain `tray.cati.me`, then point the Catime
website at `https://tray.cati.me/sections.json`.

The `Sync catalog` workflow only checks registered image repositories hourly,
commits catalog changes, and runs tests. It never deploys to Cloudflare. Add
`CATALOG_GITHUB_TOKEN` as a GitHub Actions repository secret when any registered
image repository is private.

The Worker `GITHUB_TOKEN` secret can be omitted when every registered image
repository is public.

For private repositories, the token must be authorized for the `catime-labs`
organization. GitHub returns `404` for private repositories when the token is
missing or lacks access.
