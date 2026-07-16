# tray-hub

Cloudflare Worker registry and static asset service for Catime tray animations.

## API

- `GET /sections.json` returns the website-compatible collection manifest.
- `GET /v1/collections` is an alias for the manifest.
- `GET /v1/assets/:collection/:file` serves a registered GIF from Cloudflare
  Static Assets.
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

Deployment is manual. After reviewing the catalog and tests, run:

```bash
npm run deploy
```

Bind the Worker to the custom domain `tray.cati.me`, then point the Catime
website at `https://tray.cati.me/sections.json`.

The deploy command stages every registered GIF and uploads it together with the
Worker. No GitHub token or runtime GitHub access is required for public image
repositories.

Updating or adding a sibling image repository is picked up automatically the
next time `npm run deploy` is run. The automatic workflow described below can
also detect and deploy those changes without a manual release.

## Automatic checks and deployment

The `Check assets and deploy` workflow runs every 30 minutes. It discovers all
public repositories in `catime-labs` that contain GIF files, stages them, and
compares `data/assets-lock.json`, which stores a SHA-256 hash for every image.
It deploys only when files were added, removed, renamed, or their contents
changed. New public GIF repositories are discovered without editing tray-hub.
The workflow also hashes Worker code and deployment configuration. A successful
release records `data/deployment-signature.txt`; failed releases do not update
that signature, so the next scheduled check retries automatically.

Configure these tray-hub repository secrets before enabling the workflow:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The workflow can also be started manually or through a
`tray-assets-updated` repository dispatch event. Scheduled checks require no
secret for public GitHub repositories.
