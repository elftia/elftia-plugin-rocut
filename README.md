# elftia-plugin-rocut

The rocut skill plugin for Elftia. Drives the rocut agent-first video editor
(T3 topology: local backend + Web Pane) through its CLI.

Status: **0.3.0 — self-contained**. The plugin ships the built rocut runtime,
its WebAssembly core and the prebuilt editor surface, and runs on Elftia's
managed Node 20+. No rocut checkout, no bun, no global install, and no
experimental Node flags. Capabilities: `host ensure`/`host start` →
authenticated editorUrl → WebPane, `target list`, `read`/`apply` transaction
batches with revision and idempotency semantics, draft verbs
(begin/stage/approve/reject/discard), `verify <tick>` composed-frame digests,
and automatic in-place migration of older-schema project directories.

## Two-step build

`vendor/` — the vendored rocut runtime — is a **build product and is not
committed** (~38 MB / 312 files). Building from a fresh clone therefore needs a
local rocut upstream checkout at the commit pinned in `upstream.json`.

```bash
npm install

# 1. vendor — the ONLY step that needs the rocut upstream
npm run vendor -- --rocut <path-to-rocut-checkout>
#    or: ROCUT_REPO=<path> npm run vendor
#    default when neither is given: ../../_others/rocut

# 2. build + release — these work from vendor/ alone
npm run build         # vendor/ -> dist/rocut/ (atomic swap, fails closed)
npm run verify:dist   # re-check the published tree against the artifact mapping
npm run release       # dist/rocut/ -> release/<version>/rocut.zip + rocut.json
```

`npm run build` fails closed with the exact `npm run vendor -- --rocut <path>`
command when `vendor/` is missing or incomplete — you will never get a bare
ENOENT from inside a copy loop.

### The pin

`upstream.json` is the **committed pin of record**. Because `vendor/` is
gitignored, `vendor/PROVENANCE.md` (which records the commit actually packed)
does not survive a clone — so the pin lives in its own tracked file, and
`npm run vendor` refuses an upstream checkout whose `HEAD` is not that commit.
Moving the pin is a deliberate edit to `upstream.json`.

Before vendoring, the upstream checkout needs a current wasm build and editor
surface (also listed in `upstream.json`):

```bash
node script/build-wasm.mjs && bun install --frozen-lockfile
npm run check:wasm                            # upstream's own currency gates
cd apps/vite-example && OPENCUT_PUBLIC_BASE=./ bun run build
```

Bun is upstream build tooling only. Nothing under `vendor/` needs it at run
time.

### Provenance chain

Gitignoring `vendor/` does not weaken verification. `npm run vendor` writes
`vendor/PROVENANCE.md` with the pinned commit and a per-file SHA-256 manifest;
`npm run build` and `npm run verify:dist` both verify every shipped vendor byte
against that manifest and fail closed on missing, undeclared or altered files.
The vendor step also refuses an upstream tree with modified tracked files unless
`--allow-modified-tracked` is passed, which discloses the paths, the diffstat
and per-file digests in the shipped provenance rather than hiding them.

## Layout

| Path | What it is |
| --- | --- |
| `elftia-plugin.json` | authoring manifest (the shipped one is `dist/rocut/elftia-plugin.json`) |
| `upstream.json` | the committed pin: which rocut commit `vendor/` is built from |
| `skills/rocut-studio/SKILL.md` | the operating manual (session flow, batch discipline, verification, host-lifetime honesty, hard rules) |
| `licenses/` | authored licence inputs: `NOTICE.md` (copied into `vendor/`) and `branding-placeholder.svg` |
| `scripts/` | the producer (`vendor-rocut`, `build-dist`, `verify-*`, `dist-layout`, `atomic-tree-swap`, `provenance`) |
| `tests/` | vitest coverage for the whitelist, the trademark gate, and the fail-closed paths |
| `vendor/` | **gitignored** — the vendored runtime: `run/`, `surface/`, `LICENSE`, `NOTICE.md`, `PROVENANCE.md` |
| `dist/rocut/` | **gitignored** — the only installable tree, produced by `npm run build` |
| `release/<version>/` | **gitignored** — `rocut.zip` + `rocut.json` sidecar, produced by `npm run release` |

## Licensing

`vendor/LICENSE` is upstream's MIT text; `vendor/NOTICE.md` is the third-party
inventory over the shipped bytes (authored at `licenses/NOTICE.md`).

The upstream **OpenCut brand marks are a trademark outside the MIT code grant**
and are not redistributed: all eight are removed from `vendor/surface/`, and the
one path the editor header resolves carries a neutral placeholder. The build
carries their content digests as a denylist and fails closed if one reappears
under any path.

Two bundled dependencies are copyleft — `soundtouchjs` (LGPL-2.1) and
`mediabunny` (MPL-2.0). `vendor/NOTICE.md` §3 records the compliance position.

Upstream: rocut (OpenCut-derived SDK) — <https://github.com/DumoeDss/rocut>.
