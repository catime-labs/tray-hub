# tray-hub

Cloudflare Worker registry and static asset service for Catime tray animations.

## Author Information

### eirna

- Avatar: eirna.webp
- [Bilibili](https://space.bilibili.com/1195508399)

## API

- `GET /sections.json` returns the website-compatible collection manifest.
- `GET /v1/collections` is an alias for the manifest.
- `GET /assets/:collection/:file` serves a GIF directly from Cloudflare Static
  Assets.
- `GET /v1/assets/:collection/:file` redirects legacy URLs to the static asset.
- `GET /health` returns the service status.

Only files listed in `data/collections.json` are staged and served. Production
requests never fetch images from GitHub. During deployment, supported source
files from the checked-out image repositories are converted to GIF, optimized,
and uploaded to Cloudflare Static Assets.

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
that contains at least one `.gif`, `.webp`, or `.ani` file is discovered
automatically:

```text
workspace/
├── tray-hub/
├── eirna/
│   ├── 1.gif
│   ├── 2.webp
│   └── 3.ani
└── another-collection/
    └── nested/1.webp
```

Image repositories may contain `.gif`, `.webp`, `.png`, `.jpg`, `.jpeg`, and
Windows animated cursor `.ani` files. `npm run stage` recursively scans those
repositories, regenerates `data/collections.json`, and writes the web-ready
assets to the ignored `public/assets` staging folder. Image filenames,
extensions, and subdirectories are preserved, and numeric filenames are sorted
naturally. ANI sources are the only exception: browsers cannot display them
directly, so each ANI file is published under the same basename with `.gif`.

Existing GIF files are passed through Gifsicle WASM with `-O3`, which performs
lossless GIF structure optimization without a platform-specific binary
installer. WebP, PNG, and JPEG files are copied byte-for-byte to preserve their
original encoding and avoid unnecessary build CPU usage. ANI sources are
converted with Sharp and then receive the same lossless GIF optimization; the
ANI-to-GIF conversion itself can require palette quantization because GIF
supports at most 256 colours per frame.

Converted outputs are cached under `.cache/tray-assets` using a source hash.
Unchanged files are copied from this cache. Conversion defaults to two parallel
jobs, with one Sharp worker per job, to keep CPU and memory usage bounded. The
following optional environment variables tune the safety limits:

- `TRAY_CONVERT_CONCURRENCY` (default `2`)
- `TRAY_MAX_SOURCE_MB` (default `64`)
- `TRAY_MAX_FRAMES` (default `1000`)
- `TRAY_MAX_FRAME_PIXELS` (default `4194304`)
- `TRAY_MAX_TOTAL_PIXELS` (default `12000000`)

Author links and avatars are maintained centrally in the `Author Information`
section at the top of this README. Each `###` heading must match an image
repository name. Avatar source files live in the root `avatars/` directory.
Avatar filenames are unrestricted; use any filename and image extension, then
write only that filename after `Avatar:`. Image repositories only need to
maintain their GIF, WebP, PNG, JPEG, and ANI source files.

## Cloudflare deployment

Connect the public `tray-hub` repository to Cloudflare Workers Builds. The
deploy command can remain `npx wrangler deploy`; `wrangler.jsonc` runs the
asset build automatically before every deployment. That build checks out the
public image repositories recorded in the catalog next to `tray-hub`, and
generates all web-ready outputs in Cloudflare Static Assets.

For a manual deployment from a local sibling-repository workspace, run:

```bash
npm run deploy
```

Bind the Worker to the custom domain `tray.cati.me`, then point the Catime
website at `https://tray.cati.me/sections.json`.

The deploy command stages every registered asset and uploads it together with the
Worker. No custom GitHub token is required for public image repositories, and
the deployed Worker never fetches images from GitHub at runtime.

Updating or adding a sibling image repository is picked up automatically the
next time `npm run deploy` is run. The automatic workflow described below also
detects those changes and updates `tray-hub`, which triggers the connected
Cloudflare Workers build.

## Automatic asset checks

The `Sync tray assets` workflow runs every 30 minutes. It discovers all public
repositories in `catime-labs` that contain GIF, WebP, PNG, JPEG, or ANI files, validates
their sources, and compares `data/assets-lock.json`, which stores a versioned
SHA-256 fingerprint for every output. The scheduled check skips conversion to
avoid spending CPU every 30 minutes. When a file is added, removed, renamed, or
changed, the workflow commits the updated catalog and lock file back to
`tray-hub`. That Git push then lets Cloudflare's Git integration perform the
one required conversion and deployment.

The Action does not call Cloudflare and requires no Cloudflare API token.
`GITHUB_TOKEN` is supplied automatically by GitHub. New public GIF, WebP, PNG, JPEG, or ANI
repositories are discovered without editing `tray-hub`.

The workflow can also be started manually or through a
`tray-assets-updated` repository dispatch event. Scheduled checks require no
secret for public GitHub repositories.
