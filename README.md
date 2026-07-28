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

Image repositories live next to `tray-hub`. The scheduled discovery scans every
public, non-archived, non-fork repository in `catime-labs`. A repository is
included automatically when its root contains all three parts of the author
folder structure:

1. A root `README.md` for author links (it may be empty).
2. Exactly one root avatar named `a.gif`, `a.webp`, `a.png`, `a.jpg`, or
   `a.jpeg`.
3. At least one supported animation image other than that avatar.

No catalog edit, GitHub topic, or marker file is required when adding an author.

```text
workspace/
├── tray-hub/
├── eirna/
│   ├── 1.gif
│   ├── 2.webp
│   ├── 3.ani
│   ├── a.webp
│   └── README.md
└── another-collection/
    ├── README.md
    ├── a.png
    └── nested/1.webp
```

The scheduled GitHub discovery records each matching repository URL and its
actual default branch before cloning it. Repositories that do not match the
three-part structure are ignored, even if they contain screenshots or icons.

Image repositories may contain `.gif`, `.webp`, `.png`, `.jpg`, `.jpeg`, and
Windows animated cursor `.ani` files. `npm run stage` recursively scans those
repositories, regenerates `data/collections.json`, and writes the web-ready
assets to the ignored `public/assets` staging folder. Image filenames,
extensions, and subdirectories are preserved, and numeric filenames are sorted
naturally. ANI sources are the only exception: browsers cannot display them
directly, so each ANI file is published under the same basename with `.gif`.

Each image repository owns its author information. Put one root-level avatar
named `a.gif`, `a.webp`, `a.png`, `a.jpg`, or `a.jpeg` beside the animations.
The `a.*` file is validated and published as the author avatar, and is never
included in the animation list. Replacing, renaming, or removing it is picked
up automatically on the next asset sync.

Put author profile links in the repository's root `README.md`, with one plain
URL on each line. No heading or other fixed structure is required. Bilibili,
Pixiv, and X/Twitter links are labelled automatically; other sites use their
hostname. Markdown links can still provide a custom label when needed:

```markdown
https://space.bilibili.com/1195508399
https://www.pixiv.net/users/123
https://x.com/example
[Portfolio](https://example.com/artist)
```

Bulleted versions of those lines are also accepted. Links embedded in prose or
images are ignored, so the rest of the README can be written normally.

Existing GIF files are passed through Gifsicle WASM with `-O3`, which performs
lossless GIF structure optimization without a platform-specific binary
installer. WebP, PNG, and JPEG files are copied byte-for-byte to preserve their
original encoding and avoid unnecessary build CPU usage. ANI sources are
converted with Sharp and then receive the same lossless GIF optimization; the
ANI-to-GIF conversion itself can require palette quantization because GIF
supports at most 256 colours per frame.

Converted outputs are cached under `.cache/tray-assets` using a source hash.
Unchanged files are copied from this cache, and passthrough formats are written
atomically so an interrupted build cannot leave a reusable partial file. Source
size is checked before the file is read into memory. Conversion defaults to two
parallel jobs, with one Sharp worker per job, to keep CPU and memory usage
bounded. The following optional environment variables tune the safety limits:

- `TRAY_CONVERT_CONCURRENCY` (default `2`)
- `TRAY_MAX_SOURCE_MB` (default `64`)
- `TRAY_MAX_FRAMES` (default `1000`)
- `TRAY_MAX_FRAME_PIXELS` (default `4194304`)
- `TRAY_MAX_TOTAL_PIXELS` (default `48000000`)

## Cloudflare deployment

The `Deploy tray hub` GitHub Action deploys the Worker and static assets on
every `main` push. Add these two repository secrets once:

- `CLOUDFLARE_API_TOKEN` with Workers deploy permissions.
- `CLOUDFLARE_ACCOUNT_ID` set to the Cloudflare account that owns `tray.cati.me`.

The deploy command is `npx wrangler deploy`; `wrangler.jsonc` runs the asset
build automatically before every deployment. That build checks out the public
image repositories recorded in the catalog next to `tray-hub`, and generates
all web-ready outputs in Cloudflare Static Assets.

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

The `Sync tray assets` workflow runs every 30 minutes. It checks matching public
repositories in `catime-labs`, validates their GIF, WebP, PNG, JPEG, and ANI
sources, and compares `data/assets-lock.json`, which stores a versioned SHA-256
fingerprint for every output. Repository tree checks and clones use bounded
parallelism. The scheduled check skips conversion to avoid spending CPU every
30 minutes. When a file is added, removed, renamed, or changed, the workflow
commits the updated catalog and lock file back to `tray-hub`. That Git push then
lets Cloudflare's Git integration perform the one required conversion and
deployment.

The asset sync Action uses the automatically supplied `GITHUB_TOKEN` to inspect
public repositories. Creating a public repository with `README.md`, `a.*`, and
at least one animation is enough to register it without editing `tray-hub`;
the resulting catalog commit then starts the deployment Action.

The workflow can also be started manually or through a
`tray-assets-updated` repository dispatch event. Scheduled checks require no
secret for public GitHub repositories.
