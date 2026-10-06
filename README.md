# elftia-plugin-rocut

The rocut skill plugin for Elftia. Drives the rocut agent-first video editor
(T3 topology: local backend + Web Pane) through its CLI.

Status: **0.5.0 — native motion text and JIZURA presets**. The plugin ships the built rocut runtime,
its WebAssembly core and the prebuilt editor surface, and runs on Elftia's
managed Node 20+. No rocut checkout, no bun, no global install, and no
experimental Node flags. Capabilities: `host ensure`/`host start` →
authenticated editorUrl → WebPane, `target list`, `read`/`apply` transaction
batches with revision and idempotency semantics, draft verbs
(begin/stage/approve/reject/discard), `verify <tick>` composed-frame digests,
and automatic in-place migration of older-schema project directories. The
0.4.2 surface opens directly in the editor without the old multi-step welcome
onboarding.

## 0.5.0 changes and verification status

- Export-oracle repair (runtime still `aff5ec05`): the preserved `live-9hcQKK` MP4 passes all five original frame checks with native `VideoDecoder` and independently decoded numerical PNG samples. Default PNG image conversion had reapplied the retained video cICP/gAMA metadata and changed the mask; only the specialized decoded-export sampler now disables that conversion. General preview sampling, render/encoder code, original evidence and all thresholds are unchanged. Browser BT.709 regression passes 5/5 (including blank/shifted/recolored refusals), pixel/reference Node tests 10/10, probe loader/preflight tests 6/6. The loader now ignores an empty trailing-comma binding, without dropping actual named-export checks.
- Consumer `scripts/probe-owned-export-color.mjs` requires explicit `ELFTIA_EXPORT_EVIDENCE` and `ELFTIA_EXPORT_VIDEO` inside the owned E2E root, plus the usual `ELFTIA_WORKTREE`, `ROCUT_WORKTREE` and `ELFTIA_CLI_DEBUG_PORT`. It restricts this diagnostic to the 240-frame 1080p fixture, checks the original source-media SHA, and closes native decoder frames. `export-color-jU7xz7` passes five-frame dual-decode comparisons, blank frame zero and original stereo gain (0.9990460620 ratio), with `acceptanceEligible: false`: it supplements, never rewrites, the failed uninterrupted run.
- Fresh current-runtime aggregate **`installed-workflow-lIBMrh` passes 40/40**: continuous `live-HJlWxk` 35/35 followed by actual historical-plugin `installed-legacy-nMmxX5` 5/5, both with zero page errors. Full/range audiovisual exports, Agent review/conflict, multilingual/resource recovery and actual 0.4.0 refusal/upgrade/editing pass. Complete current-plugin inventories match before/after restoration, the modern project remains unchanged during the historical run and its pane is reopened. This closes this runtime's functional aggregate, not the remaining presentation/seek/resource/security/online-model acceptance. Runtime/artifact pin stays unchanged; no repack, version bump or Elftia-main commit.
- Current runtime pin **`aff5ec05`** removes one redundant private publication copy for summary-only UI commits and automation. Default public result ownership stays isolated; 46 related source tests / 372 assertions pass. Fresh ordinary installed F04 `live-W2hpOT` passes **7/7**, zero captured errors, 30 persisted edits with exact visible pictures: **268.93ms p95 / 327.89ms max**, below the unchanged 300ms p95 gate. This is one changed-candidate observation, not long-run stability. The previous runtime's failed 397.52ms measurement is retained upstream. Deterministic double-pack, 52 producer tests, vendor/dist verification and independent 356-file backup/install parity pass.
- Current local installable artifact: `release/local-aff5ec05/rocut.epkg` (**86,156,649 bytes / 356 files**), SHA-256 `7e2433da8e379ba0a5b90224c495a75d967e0d3a4befdb0c7835a6760d64123c`. No version bump, public release/tag or full editor sign-off. Canonical acceptance, broader performance/resource closure, dependency advisories and online-provider/model success remain open.
- Prior aggregate `installed-workflow-WQzeP7` remains a preserved **failed** report at child `live-9hcQKK` after 12 checks: all 20 move/trim/split/reopen preview comparisons match, but independent export frame 78 has geometry overlap 0.15337 (<0.7), with color error 0.04061 (<=0.1). Its PNG color-conversion cause is independently reproduced and corrected above, without threshold changes or rewriting this evidence. Historical installation did not start in that failed run; the separate 40-check aggregate above supplies current-runtime acceptance for this workflow.
- The old scratch mutation profiler poisoned retained fetch wrappers during cleanup, causing close to fail before any save request. Exception inspection established the diagnostic cause; restoring its deleted dependencies let the normal save return HTTP 200 and the protected close succeed. No guard bypass or project overwrite. Use consumer `scripts/profile-owned-mutation.mjs` (CDP-only observation, no fetch replacement) with explicit `ELFTIA_PROFILE_PROJECT` under the owned E2E root, plus the usual host/session/port/checkout settings. Optional `ROCUT_PROFILE_CPU=1` writes a private raw profile containing authenticated URLs; never commit or print it. `scripts/diagnose-owned-close.mjs` provides sanitized close diagnostics; `ROCUT_DIAGNOSE_EXCEPTIONS=1` observes caught errors and `ROCUT_RESTORE_LEGACY_PROFILE_FETCH=1` explicitly repairs only the known old probe's missing globals. Do not reuse the old scratch profiler.
- Replacement diagnostic smoke `mutation-profile-tEfrte` completes 30 owned edits; afterward the ordinary save returns HTTP 200 and close-ready `ok: true` removes the iframe with no alert. Its measurements remain ineligible for acceptance. Syntax checks, six existing probe preflight/loader tests and strict UTF-8 checks pass; no real user project or old scratch file was changed.
- Previous runtime `4b3a0dc6` additionally passes **35/35** uninterrupted actual-Elftia workflow checks in `live-8cDfwt`, zero captured errors, including exact preview/history/reopen, independent full/range audiovisual export, Agent conflict/review, multilingual layers and resource recovery. The prior `live-NIaExB` failure is retained: random `flipCards` legitimately showed non-cyan backs. The oracle retains exact cyan positions and now also compares every non-red foreground position/RGBA; seven pixel/export regressions pass without changing export or latency thresholds. `scripts/probe-owned-continuity.mjs` replays an exact owned plan; it additionally requires `ELFTIA_CONTINUITY_SOURCE_MEDIA` and the original `ELFTIA_CONTINUITY_SOURCE_SHA256`. The original failed fixture's targeted evidence and audio-reference driver correction are detailed upstream; no renderer/seed change was used to obtain a pass.
- Previous local artifact: `release/local-4b3a0dc6/rocut.epkg` (86,156,580 bytes, 356 files), SHA-256 `0bf1071093ef0910ddf609a83e0863f196c47a88909b404e2c7a1387ac222084`. Its original bytes are retained.
- Previous runtime **`4b3a0dc6`** adds Captions cancellation with immediate Worker release, stale-operation isolation and awaited durable insertion. Actual installed Elftia `installed-caption-cancel-dfgizl` passes **5/5**, zero captured errors: cancel, fresh-Worker retry, panel-exit release, file chooser cancellation/import/Undo/Redo, and HTTP save failure/retry/reload. Twelve model requests were intercepted before network; no inference-quality or successful model execution claim. Source controller/service tests pass 11 tests / 72 assertions; component browser checks pass 6/6. Deterministic double-pack, 52 producer tests, vendor/dist verification and independent 356-file backup/install parity pass. The previous owned project and viewport were restored. No version bump or Elftia-main commit.
- Reproduce with `scripts/probe-installed-caption-cancel.mjs` through the Elftia tsx loader, with `ELFTIA_WORKTREE`, `ROCUT_WORKTREE`, `ELFTIA_TEST_SESSION`, `ELFTIA_CLI_DEBUG_PORT`, `ELFTIA_INSTALLED_ROCUT` and `ELFTIA_REUSE_TEST_PROJECT` explicitly set to the owned test environment. `scripts/install-owned-candidate.mjs` uses the same environment to independently back up and verify the installed tree before requesting installation of this producer's `dist/rocut` through the host API. Installation requires explicit user authorization; neither script operates on ordinary user projects.
- Previous runtime `ab3d0155` resource observation `installed-gpu-memory-2vkTWV` passes **720 exact-picture seeks** over 24 shuffled cycles on the owned 600-cue/eight-minute project, confirms iframe destruction/reopen and restores the prior project/viewport. Native whole-process GPU counters drop after each close; DOM counts remain fixed. It remains diagnostic, not a zero-leak or full acceptance claim. The immediate transcription-cancellation repair (6 service tests; 18 related tests) is now included in `4b3a0dc6` as documented above. An isolated Transformers 4.3.0 lock-only audit has 0 advisories, but no dependency upgrade or model/API acceptance has occurred.
- Host-specific probes now belong to this consumer's `scripts/`, not portable Rocut. Fresh current-runtime `ab3d0155` continuous `live-FXmevH` passes **35/35** actual-Elftia checks, zero captured errors, through the relocated entry. Assertions and gates are unchanged. Six Node preflight/loader tests and the existing 52 producer tests pass. This supersedes the older statement below that continuous workflow was not rerun for Sounds; it does not refresh latency, historical-upgrade, online-provider or comprehensive GPU/resource acceptance. Rocut's unchanged local boundary gate still fails on untracked scratch probes; their authorized archive/removal was rejected by the execution layer and not bypassed. No runtime repack, version bump or installation was needed for test relocation.
- Previous runtime `ab3d0155` fixes native audition ownership, actual Save/Add/Clear events, durable media-backed sound insertion, authenticated namespace clearing and failure recovery. Actual Elftia `installed-sound-insertion-JCv6vz` passes **7/7**: Saved audition/release, exact attachment bytes and decoded duration, Undo/Redo, provider-disconnected reopen/playback, independently decoded menu export, injected clear failure with Reload recovery, and real clear preserving imported audio. Zero page errors; the prior dedicated project is restored. Expanded component regression passes 11/11; isolated async-store suite passes 17 tests / 98 assertions; CLI/Vite typecheck, build, 52 producer tests, deterministic packaging and 356-file installed parity pass. Earlier installed failures remain documented upstream. This is a generated local fixture, not live online-provider/search acceptance.
- Reproduce with consumer-owned `scripts/probe-installed-sound-insertion.mjs` through the Elftia `node_modules/tsx/dist/cli.mjs` loader. Required environment: `ELFTIA_WORKTREE`, `ROCUT_WORKTREE` (shared neutral test helpers), `ELFTIA_TEST_SESSION`, `ELFTIA_CLI_DEBUG_PORT`, `ELFTIA_REUSE_TEST_PROJECT` (owned project to restore). It creates a separate E2E project and changes browser download behavior only for its test, restoring afterward; no real user project, external account or provider credential is used.
- Previous runtime `9199bd8c` fixes Sounds query/filter isolation, first-page and pagination parameter parity, duplicate page requests and late responses. It exposes actionable failures and Retry without adding editor chrome. Local-response real-component regression passes 7/7; request/parser/isolated-store suites pass 10 tests, Vite typecheck/build and scoped lint pass. Producer 52 tests, deterministic double-pack, vendor/dist and independently backed-up 356-file installed parity pass. Actual Elftia `installed-sounds-EVuapX` passes 4/4 unconfigured-host panel checks with no captured errors, no sound-search network requests and unchanged dedicated project bytes. This does not configure or prove an online provider. Run the consumer-owned `scripts/probe-installed-sounds.mjs` with explicit owned session, project and host settings through the Elftia tsx loader.
- Previous runtime `b9142fd5` transfers private post-save publication records through the persistence cache and subscription-owned adapter path. Public reads, default adoption and individual subscribers remain isolated; save failures publish nothing. Related persistence/transaction suites pass 49 tests, Vite typecheck/build and scoped lint pass. Producer 52 tests, deterministic double-pack, vendor/dist and independently backed-up 356-file installation parity pass. Fresh ordinary installed `live-d7hFtm` passes **7/7** with exact pictures and durable values for 30 cue edits: **261.18ms p95 / 388.18ms max**, below the unchanged 300ms p95 gate. This is one passing changed-candidate observation, not a long-run stability claim.
- Same-previous-runtime continuous `live-0k46GF` passes **35/35**, zero captured errors: exact preview/history/reopen, independent audiovisual full/selected-range exports, Agent conflict/review, same-project multilingual layers and resource recovery. These latency/workflow checks were not rerun for the Sounds-only candidate. Full canonical acceptance, broader GPU/resource release, package-boundary/security disposition and online Sounds configuration remain open; full completion is not claimed. No Elftia-main commit, Steam change or version bump.
- Previous runtime `9d5e0cd1` aggregate `installed-workflow-8ctWyE` freshly passes **40/40** actual-Elftia checks: the 35-check continuous workflow followed by real historical 0.4.0 installation, actionable refusal, upgrade/reopen and recovered editing. It verifies independent backup, exact current-plugin restoration and unchanged modern-project bytes during the historical run. This closes that baseline's previously pending historical-plugin functional aggregate section, not performance or the full plan. Separately, all four freshly packed public-SDK consumer examples pass in an isolated installation; captured dependency advisories and the repository's host-probe boundary violations remain open.
- Previous runtime `9d5e0cd1` transfers the evaluator's isolated document into commit projection; default projection and adapter/public-read isolation remain defensive. Keyed/unkeyed allocation regressions fail before and pass after; related engine/draft suites pass 56 tests, Vite typecheck/build pass. Producer 52 tests, deterministic packaging and independently backed-up 356-file installed parity pass. Ordinary actual-Elftia `live-qsZRqi` preserves all 30 edited pictures and saved values with zero captured errors, but **330.23ms p95 / 360.65ms max fails the unchanged 300ms gate**. Removing one copy is proven, not a stable end-to-end speedup.
- Same-previous-runtime `live-N1vWek` passes **35/35** continuous actual-Elftia checks with zero captured errors, including exact preview/history/reopen, audiovisual exports, guarded Agent review, same-project multilingual layers and resource recovery. The later 40-check aggregate above supersedes its pending historical-plugin section; the failed timing observation remains recorded.
- Previous runtime `1734b578` adds explicit creation language selection and the digest-pinned offline Noto Sans KR asset (20 font files / 20 OFL notices total). Actual installed Elftia F02 passes 5/5: Japanese, Korean, English and mixed-script text, real keyboard selection, 41 exact reload/seek pictures and independently decoded 1080p H.264 export samples. The incompatible-font warning/refusal/correction workflow passes 6/6. Expanded F03 passes 6/6: three simultaneous seeds/fonts/languages, independent Hide/Undo, exact remount/project-switch pictures, controlled external-request denial with local fonts, and independently decoded three-layer 1080p H.264 export. Producer 52 tests, deterministic packaging and independently backed-up 356-file installed parity pass. That runtime's F04 **301.90ms p95 also fails 300ms**. Historical-plugin aggregate, broader resource release and other documented remaining coverage stay open.
- Prior runtime `ea453687` removes one redundant whole-document copy after durable save by transferring an already-private engine candidate. Adapter/public-read isolation and failed-save recovery remain protected (31 engine tests / 340 assertions). Producer 52 tests, deterministic packaging and independently backed-up 354-file installed parity pass. Fresh ordinary actual-Elftia F04 passes 7/7 checks, including 30 persisted edits with exact pictures: **291.27ms p95 / 348.59ms max**, below the unchanged 300ms p95 gate. This is one passing observation, not a stable causal speedup claim. Same-runtime continuous workflow `live-efXchQ` passes **35/35**, zero errors, including exact preview/history/reopen, actual audiovisual exports, guarded Agent review, Chinese/English overlays and resource recovery. This older aggregate does not prove the current runtime's complete matrix; full completion is not claimed.
- Prior runtime `ef88c21d` exposes motion-text resource warnings below the preview, with bounded scrollable details and missing Unicode code points. Native disclosure Enter/Space no longer trigger editor shortcuts. Real installed Elftia passes the Korean missing-glyph warning/refusal/correction/export workflow, keyboard/wheel interactions and light/dark contrast checks (6/6, zero errors); recovery output is independently decoded as 1080p H.264, 90 frames / 3 seconds. Built-in Korean font coverage and the complete F02/F03 matrix remain open. Prior baseline `d420f336` passed two ordinary 300ms F04 edit gates and a 35-check continuous workflow. The older checkpoint statements below are historical; authoritative current results are in upstream `docs/elftia-integration-repair.md`.
- Prior `ef88c21d` ordinary F04 validates all 30 saved edits and exact visible pictures, but **302.46ms p95 / 355.15ms max fails the unchanged 300ms gate**. This failed measurement remains recorded alongside the newer candidate's observation.

- Runtime `c4f5e7e5` adds Rust glyph-coverage checking without rehashing already validated font bytes, and removes two redundant private-snapshot copies. Actual installed F04 single-cue edits persist and update the expected picture with p95 **408.30ms**, improved from the prior candidate's 562.14ms but still above the unchanged **300ms budget**. Producer 52 tests, reproducible runtime packaging, vendor/dist gates and independent 354-file installed parity pass. This remains a development checkpoint, not complete editor/performance acceptance.

- The embedded Tool Host pane fills its viewport with the editor only: no demo banner, outer frame, project-title header, outer Export button, or theme toggle. The internal asset-rail footer menu provides **Export project** and **Keyboard shortcuts** without restoring a second header. Export settings scroll inside short panes; cancelling or closing an export can be retried, and closing dialogs restores keyboard focus to the menu. The standalone demo keeps its own chrome.
- Installed checkpoint (2026-10-05): real Elftia UI downloads a full three-second H.264 MP4 with video, Chinese motion text and audible AAC, and a 1.5-second VP9 WebM cue range with audio disabled. Independent decoding verifies output content. This is bounded UI acceptance, not complete codec/project/performance coverage; see the upstream `docs/elftia-integration-repair.md`.
- Runtime f93ce325 restores the paused preview after export success, failure or cancellation. Actual installed-Elftia screenshots confirm the current playhead is repainted without seeking; the underlying project is unchanged. Source lifecycle regression, Vite typecheck/build, 52 producer tests and deterministic/vendor/dist checks pass. The real Creator Studio entry and same-project Agent continuation are exercised, but the uninterrupted combined export pixel gate remains unresolved; see upstream repair notes for the retained failures.

- Native motion-text sequences, cue editing, locks, variations, audio timing and JIZURA project import.
- 889 drawable presets and 19 bundled offline font assets, including Simplified Chinese coverage.
- Public `motion-text catalog|list|create|mutate|vary` commands with revision conflicts and stable IDs.
- Media bodies survive HTTP-host project reload; CLI exports include audio unless `--no-audio` is set.
- The 0.4.4 development candidate produced full and selected-range 1080p exports. This is historical smoke evidence, not acceptance of the 0.5.0 artifact. Comprehensive performance acceptance and remaining combined-workflow branches remain open; G8/G9 must not be marked complete from the smoke runner.

The plugin version is independent of the SDK package versions and the existing tool-host capability ABI.

## Install and open the Pane

Use an Elftia build with Host API **1.51 or newer**. Install `dist/rocut/` from
the plugin manager (or install the packaged release), enable the plugin, then
toggle it once or restart Elftia after replacing an older `kind: agent` build.

On Elftia Host API 1.61 or newer, open **Creator Studio**, create a project by choosing its working folder, or resume a project card. This explicit action binds the available installed rocut skills to Creator Studio without changing other agents or granting global access. Select the **rocut** workspace Tab beside Canvas and Director Studio. It opens the latest project or creates `rocut/new_project/` on first use; switching Tabs preserves the live editor and daemon. Tool buttons no longer occupy the chat header.

Other agents can use workspace tool Tabs after binding `rocut-studio` to the agent (or globally) in plugin settings. **Files → Tool Hosts → rocut video editor** remains available to create, list, or open a specific project, independent of skill audience binding. It requires a session working directory. Installing the plugin alone never grants skill access.

The Pane and daemon lifecycle belong to Elftia. The plugin's main half only
registers the descriptor; it still contributes the original `rocut-studio`
skill for agent-driven edits.

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
npm run release       # dist/rocut/ -> release/<version>/rocut.epkg + rocut.json
```

`npm run build` fails closed with the exact `npm run vendor -- --rocut <path>`
command when `vendor/` is missing or incomplete — you will never get a bare
ENOENT from inside a copy loop.

`npm test` is safe in a fresh clone: all 47 producer/source tests run without a
generated `vendor/` tree. When `vendor/PROVENANCE.md` exists, five additional
integration assertions automatically verify the real artifact mapping,
trademark closure, build preflight and provenance, for 52 tests total. Set
`ROCUT_TEST_REAL_VENDOR=0` only to reproduce the clean-clone test mode while a
local vendor tree exists; `npm run verify` still requires and verifies the real
vendor/build outputs.

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

## Real-host test ownership

Current-source SDK packed-manifest closure passes for all four freshly packed
artifacts (0 failures / 0 refusals). This does not resolve previously captured
consumer dependency security advisories or the source's local scratch boundary
failure.

Elftia-specific interaction, workflow, Agent, layout, migration and GPU/lifecycle
drivers live in this repository's `scripts/`. Their host-neutral helpers remain
in the Rocut checkout. Set `ROCUT_WORKTREE` explicitly: the loader validates the
checkout, refuses traversal and never infers a private sibling from the current
directory. It reuses that checkout's existing Playwright dependency without
installing anything into Elftia. These drivers are development tools, not shipped
plugin runtime or part of `npm test`'s fresh-clone contract.

Run the migration preflight tests from this repository:

```powershell
$env:ROCUT_WORKTREE='<absolute Rocut source checkout>'
node --test scripts/__tests__/probe-elftia-preflight.test.mjs scripts/__tests__/rocut-probe-source.test.mjs
```

Run continuous installed acceptance from an Elftia checkout with its existing
dependencies and an explicitly owned E2E session. It edits that dedicated project:

```powershell
$env:ELFTIA_WORKTREE='<absolute Elftia worktree>'
$env:ROCUT_WORKTREE='<absolute Rocut source checkout>'
$env:ELFTIA_TEST_SESSION='<owned E2E session id>'
$env:ELFTIA_CLI_DEBUG_PORT='9361'
$env:ELFTIA_INSTALLED_ROCUT='<exact installed plugin root>'
node node_modules/tsx/dist/cli.mjs '../elftia-plugin-rocut/scripts/probe-elftia-interactions.mjs' --linked-workflow-only
```

Use the actual plugin-repository path if it is not an adjacent checkout. Preserve
earlier failed evidence and distinguish functional workflow from latency and
resource-lifetime gates; one passing workflow is not full feature acceptance.

## Layout

| Path                           | What it is                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `elftia-plugin.json`           | authoring manifest (the shipped one is `dist/rocut/elftia-plugin.json`)                                  |
| `main/index.cjs`               | registers the bundled rocut daemon as an Elftia Tool Host                                                |
| `upstream.json`                | the committed pin: which rocut commit `vendor/` is built from                                            |
| `skills/rocut-studio/SKILL.md` | the operating manual (session flow, batch discipline, verification, host-lifetime honesty, hard rules)   |
| `licenses/`                    | authored licence inputs: `NOTICE.md` (copied into `vendor/`) and `branding-placeholder.svg`              |
| `scripts/`                     | the producer (`vendor-rocut`, `build-dist`, `verify-*`, `dist-layout`, `atomic-tree-swap`, `provenance`) |
| `tests/`                       | vitest coverage for the whitelist, the trademark gate, and the fail-closed paths                         |
| `vendor/`                      | **gitignored** — the vendored runtime: `run/`, `surface/`, `LICENSE`, `NOTICE.md`, `PROVENANCE.md`       |
| `dist/rocut/`                  | **gitignored** — the only installable tree, produced by `npm run build`                                  |
| `release/<version>/`           | **gitignored** — `rocut.epkg` + `rocut.json` sidecar, produced by `npm run release`                      |

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
