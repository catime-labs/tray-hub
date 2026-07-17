# tray-hub

Cloudflare Worker registry and static asset service for Catime tray animations.

## API

- `GET /sections.json` returns the website-compatible collection manifest.
- `GET /v1/collections` is an alias for the manifest.
- `GET /assets/:collection/:file` serves a GIF directly from Cloudflare Static
  Assets.
- `GET /v1/assets/:collection/:file` redirects legacy URLs to the static asset.
- `GET /health` returns the service status.

Only files listed in `data/collections.json` are staged and served. Production
requests never fetch images from GitHub, and deployment copies image bytes only
from the checked-out sibling repositories.

Manifest and asset routes are public and send permissive CORS headers so they
can be used by the production website, local development, and other clients.

## Local development

```bash
npm install
npm test
npm run dev
```

## Image repository discovery

Image repositories live next to `tray-hub`. Every immediate sibling directory
that contains at least one `.gif` file is discovered automatically:

```text
workspace/
├── tray-hub/
├── eirna/
│   ├── 1.gif
│   └── 2.gif
└── another-collection/
    └── 1.gif
```

`npm run stage` recursively scans those repositories, regenerates
`data/collections.json`, and copies their GIF files into the ignored
`public/assets` staging folder. Numeric filenames are sorted naturally. No
GitHub request is made.

Metadata is optional. A repository can include `tray.json` when its display
name or author differs from the repository name:

```json
{
  "title": "Collection title",
  "author": "Artist name",
  "authorBio": "Optional introduction",
  "authorAvatar": "https://example.com/avatar.webp"
}
```

## Cloudflare deployment

Connect the public `tray-hub` repository to Cloudflare Workers Builds. The
deploy command can remain `npx wrangler deploy`; `wrangler.jsonc` runs the
asset build automatically before every deployment. That build checks out the
public image repositories recorded in the catalog next to `tray-hub`, and
copies all GIF files into Cloudflare Static Assets.

For a manual deployment from a local sibling-repository workspace, run:

```bash
npm run deploy
```

Bind the Worker to the custom domain `tray.cati.me`, then point the Catime
website at `https://tray.cati.me/sections.json`.

The deploy command stages every registered GIF and uploads it together with the
Worker. No custom GitHub token is required for public image repositories, and
the deployed Worker never fetches images from GitHub at runtime.

Updating or adding a sibling image repository is picked up automatically the
next time `npm run deploy` is run. The automatic workflow described below also
detects those changes and updates `tray-hub`, which triggers the connected
Cloudflare Workers build.

## Automatic asset checks

The `Sync tray assets` workflow runs every 30 minutes. It discovers all public
repositories in `catime-labs` that contain GIF files, stages them, and compares
`data/assets-lock.json`, which stores a SHA-256 hash for every image. When a
file is added, removed, renamed, or changed, the workflow commits the updated
catalog and lock file back to `tray-hub`. That Git push then lets Cloudflare's
Git integration perform the deployment.

The Action does not call Cloudflare and requires no Cloudflare API token.
`GITHUB_TOKEN` is supplied automatically by GitHub. New public GIF repositories
are discovered without editing `tray-hub`.

The workflow can also be started manually or through a
`tray-assets-updated` repository dispatch event. Scheduled checks require no
secret for public GitHub repositories.
