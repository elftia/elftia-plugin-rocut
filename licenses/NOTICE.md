# Third-party notices — vendored rocut runtime

This inventory covers the bytes this plugin actually ships under `vendor/`, not
the upstream repository. It was assembled at upstream commit
`d71624b2aa470ff91f012b4e18cca61445fb563f` from three measured closures:

- **`vendor/run/`** — esbuild's own input list for the CLI bundle
  (`metafile.inputs`, 271 inputs);
- **`vendor/surface/`** — the surface build's emitted module graph
  (`vendor/surface/module-graph.json`, 3848 modules), plus the transcription
  worker bundle;
- **`vendor/run/opencut_wasm_bg.wasm`** — the `wasm32-unknown-unknown`
  Cargo graph of `rust/wasm` (`cargo metadata --filter-platform`, 108 crates
  including build dependencies).

`vendor/PROVENANCE.md` pins the exact commit and the SHA-256 of every shipped
file.

---

## 1. Main body — rocut / OpenCut

MIT. The licence text ships verbatim as `vendor/LICENSE`
(`Copyright 2025-2026 OpenCut`). It covers the first-party TypeScript in
`vendor/run/` and `vendor/surface/`, and the first-party Rust crates compiled
into `opencut_wasm_bg.wasm` (`bridge`, `compositor`, `effects`, `gpu`, `masks`,
`time`, `opencut-wasm`).

rocut is a fork of OpenCut, maintained at <https://github.com/DumoeDss/rocut>.

## 2. Trademark — OpenCut brand marks are NOT redistributed

Upstream's own SBOM records `apps/web/public/logos/opencut/**` as
"Upstream OpenCut brand marks. **Trademark, not covered by the MIT code
grant.**"

This plugin has no authorization to redistribute them, so all eight brand-mark
files were removed from `vendor/surface/`. The one path the editor header
resolves as `branding.logoUrl` — `logos/opencut/svg/logo.svg` — carries a
neutral placeholder authored for this repository
(`licenses/branding-placeholder.svg`, MIT with the rest of this repository).
`vendor/surface/asset-manifest.json` was regenerated so the surface's own
inventory matches the shipped bytes; both the removals and the substitution are
recorded with before/after digests in `vendor/PROVENANCE.md`.

`dist-layout.mjs` carries the eight upstream digests as a content-addressed
denylist, so the build fails closed if a brand mark is ever reintroduced under
any path.

## 3. Copyleft components — read this before redistributing

Two dependencies in the surface bundle are not permissively licensed. They are
bundled (statically linked) into `vendor/surface/assets/*.js`.

### 3.1 `soundtouchjs` 0.3.0 — LGPL-2.1

Time-stretch and pitch-shift for audio playback
(<https://github.com/cutterbl/SoundTouchJS>).

- The library is **unmodified** upstream 0.3.0.
- Full licence text: <https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>;
  the copy shipped with the package is at
  `node_modules/soundtouchjs/LICENSE` in a checkout.
- **Relinking information** (LGPL-2.1 §6): the complete corresponding source of
  the work it is combined with is the rocut repository at the commit pinned in
  `vendor/PROVENANCE.md`, and the build command that produced these bytes is
  recorded there too, so a recipient can substitute a modified `soundtouchjs`
  and rebuild `vendor/surface/` themselves.
- **Written offer**: the source of `soundtouchjs` 0.3.0 is available from the
  npm registry (`npm pack soundtouchjs@0.3.0`) and from the project's
  repository.

### 3.2 `mediabunny` 1.41.0 — MPL-2.0

MP4/WebM/MKV muxing and demuxing, and codec configuration for import and export
(<https://github.com/Vanilagy/mediabunny>).

- The library is **unmodified** upstream 1.41.0.
- MPL-2.0 is file-level copyleft: the source of the MPL-covered files must
  remain available. It is available unmodified from the npm registry
  (`npm pack mediabunny@1.41.0`) and from the project's repository.
- Full licence text: <https://mozilla.org/MPL/2.0/>.

## 4. Runtime bundle — `vendor/run/`

The CLI bundle's third-party npm closure is two packages; everything else in it
is first-party rocut workspace source.

| Package | Version | Licence |
| --- | --- | --- |
| `culori` | 4.0.2 | MIT |
| `opencut-wasm` | 0.2.10 | MIT (first-party, built from `rust/`) |

`opencut-wasm` is linked through its declared `./sync` entry, which instantiates
`vendor/run/opencut_wasm_bg.wasm` from disk rather than importing it as an ES
module. Same package, same 38 exports, same binary — only the entry differs.

## 5. Editor surface — `vendor/surface/`

### 5.1 Apache-2.0

| Package | Version |
| --- | --- |
| `@huggingface/transformers` | 3.8.1 |
| `class-variance-authority` | 0.7.1 |

Neither package ships a `NOTICE` file, so Apache-2.0 §4(d) adds no further
attribution beyond the licence text at <https://www.apache.org/licenses/LICENSE-2.0>.

### 5.2 ISC

`@ungap/structured-clone` 1.3.0, `lucide-react` 0.562.0.

### 5.3 BSD-2-Clause

`entities` 6.0.1.

### 5.4 0BSD

`tslib` 2.8.1.

### 5.5 MIT

`@floating-ui/core` 1.7.5, `@floating-ui/dom` 1.7.6, `@floating-ui/react-dom`
2.1.8, `@floating-ui/utils` 0.2.11, `@hugeicons/core-free-icons` 3.3.0,
`@hugeicons/react` 1.1.6, `@radix-ui/number` 1.1.1, `@radix-ui/primitive` 1.1.3,
`@radix-ui/react-accessible-icon` 1.1.7, `@radix-ui/react-accordion` 1.2.12,
`@radix-ui/react-alert-dialog` 1.1.15, `@radix-ui/react-arrow` 1.1.7,
`@radix-ui/react-aspect-ratio` 1.1.7, `@radix-ui/react-avatar` 1.1.10,
`@radix-ui/react-checkbox` 1.3.3, `@radix-ui/react-collapsible` 1.1.12,
`@radix-ui/react-collection` 1.1.7, `@radix-ui/react-compose-refs` 1.1.2,
`@radix-ui/react-context` 1.1.2, `@radix-ui/react-context-menu` 2.2.16,
`@radix-ui/react-dialog` 1.1.15, `@radix-ui/react-direction` 1.1.1,
`@radix-ui/react-dismissable-layer` 1.1.11, `@radix-ui/react-dropdown-menu`
2.1.16, `@radix-ui/react-focus-guards` 1.1.3, `@radix-ui/react-focus-scope`
1.1.7, `@radix-ui/react-form` 0.1.8, `@radix-ui/react-hover-card` 1.1.15,
`@radix-ui/react-id` 1.1.1, `@radix-ui/react-label` 2.1.7, `@radix-ui/react-menu`
2.1.16, `@radix-ui/react-menubar` 1.1.16, `@radix-ui/react-navigation-menu`
1.2.14, `@radix-ui/react-one-time-password-field` 0.1.8,
`@radix-ui/react-password-toggle-field` 0.1.3, `@radix-ui/react-popover` 1.1.15,
`@radix-ui/react-popper` 1.2.8, `@radix-ui/react-portal` 1.1.9,
`@radix-ui/react-presence` 1.1.5, `@radix-ui/react-primitive` 2.1.4,
`@radix-ui/react-progress` 1.1.7, `@radix-ui/react-radio-group` 1.3.8,
`@radix-ui/react-roving-focus` 1.1.11, `@radix-ui/react-scroll-area` 1.2.10,
`@radix-ui/react-select` 2.2.6, `@radix-ui/react-separator` 1.1.8,
`@radix-ui/react-slider` 1.3.6, `@radix-ui/react-slot` 1.2.4,
`@radix-ui/react-switch` 1.2.6, `@radix-ui/react-tabs` 1.1.13,
`@radix-ui/react-toast` 1.2.15, `@radix-ui/react-toggle` 1.1.10,
`@radix-ui/react-toggle-group` 1.1.11, `@radix-ui/react-toolbar` 1.1.11,
`@radix-ui/react-tooltip` 1.2.8, `@radix-ui/react-use-callback-ref` 1.1.1,
`@radix-ui/react-use-controllable-state` 1.2.2, `@radix-ui/react-use-effect-event`
0.0.2, `@radix-ui/react-use-escape-keydown` 1.1.1,
`@radix-ui/react-use-is-hydrated` 0.1.0, `@radix-ui/react-use-layout-effect`
1.1.1, `@radix-ui/react-use-previous` 1.1.1, `@radix-ui/react-use-size` 1.1.1,
`@radix-ui/react-visually-hidden` 1.2.3, `aria-hidden` 1.2.6, `bail` 2.0.2,
`clsx` 2.1.1, `comma-separated-tokens` 2.0.3, `culori` 4.0.2, `date-fns` 3.6.0,
`decode-named-character-reference` 1.3.0, `dequal` 2.0.3, `detect-node-es` 1.1.0,
`devlop` 1.1.0, `estree-util-is-identifier-name` 3.0.0, `eventemitter3` 5.0.4,
`extend` 3.0.2, `get-nonce` 1.0.1, `hast-util-from-html` 2.0.3,
`hast-util-from-parse5` 8.0.3, `hast-util-parse-selector` 4.0.0,
`hast-util-to-jsx-runtime` 2.3.6, `hast-util-whitespace` 3.0.0, `hastscript`
9.0.1, `html-url-attributes` 3.0.1, `inline-style-parser` 0.2.7, `is-plain-obj`
4.1.0, `mdast-util-from-markdown` 2.0.3, `mdast-util-to-hast` 13.2.1,
`mdast-util-to-string` 4.0.0, `micromark` 4.0.2, `micromark-core-commonmark`
2.0.3, `micromark-factory-destination` 2.0.1, `micromark-factory-label` 2.0.1,
`micromark-factory-space` 2.0.1, `micromark-factory-title` 2.0.1,
`micromark-factory-whitespace` 2.0.1, `micromark-util-character` 2.1.1,
`micromark-util-chunked` 2.0.1, `micromark-util-classify-character` 2.0.1,
`micromark-util-combine-extensions` 2.0.1,
`micromark-util-decode-numeric-character-reference` 2.0.2,
`micromark-util-decode-string` 2.0.1, `micromark-util-encode` 2.0.1,
`micromark-util-html-tag-name` 2.0.1, `micromark-util-normalize-identifier`
2.0.1, `micromark-util-resolve-all` 2.0.1, `micromark-util-sanitize-uri` 2.0.1,
`micromark-util-subtokenize` 2.1.0, `next-themes` 0.4.6, `onnxruntime-common`
1.21.0, `onnxruntime-web` 1.22.0-dev.20250409-89f8206ba4, `opencut-wasm` 0.2.10,
`parse5` 7.3.0, `property-information` 7.1.0, `radix-ui` 1.4.3, `react` 18.3.1,
`react-day-picker` 8.10.1, `react-dom` 18.3.1, `react-hook-form` 7.74.0,
`react-icons` 5.6.0, `react-markdown` 10.1.0, `react-remove-scroll` 2.7.2,
`react-remove-scroll-bar` 2.3.8, `react-resizable-panels` 2.1.9,
`react-style-singleton` 2.2.3, `react-window` 2.2.7, `rehype-parse` 9.0.1,
`remark-parse` 11.0.0, `remark-rehype` 11.1.2, `scheduler` 0.23.2, `sonner`
1.7.4, `space-separated-tokens` 2.0.2, `style-to-js` 1.1.21, `style-to-object`
1.0.14, `tailwind-merge` 3.5.0, `trim-lines` 3.0.1, `trough` 2.2.0, `unified`
11.0.5, `unist-util-is` 6.0.1, `unist-util-position` 5.0.0,
`unist-util-stringify-position` 4.0.0, `unist-util-visit` 5.1.0,
`unist-util-visit-parents` 6.0.2, `use-callback-ref` 1.3.3,
`use-deep-compare-effect` 1.8.1, `use-sidecar` 1.1.3, `use-sync-external-store`
1.6.0, `vfile` 6.0.3, `vfile-location` 5.0.3, `vfile-message` 4.0.3,
`web-namespaces` 2.0.1, `zustand` 5.0.12.

### 5.6 ONNX Runtime Web sidecar

`vendor/surface/assets/ort-wasm-simd-threaded.jsep-*.wasm` (~21.6 MB) is the
ONNX Runtime Web binary that `@huggingface/transformers` loads for in-browser
transcription. ONNX Runtime is MIT (Microsoft); the npm packages
`onnxruntime-web` and `onnxruntime-common` above carry it. It is emitted into
the surface but is **not** referenced by the entry chunk — it loads only when
the transcription worker is constructed.

## 6. WebAssembly core — `vendor/run/opencut_wasm_bg.wasm`

Built from `rust/` with the pinned toolchain (rustc 1.88.0, wasm-pack 0.13.1).
All 108 crates in the `wasm32-unknown-unknown` graph are permissively licensed;
there is no copyleft crate in this binary.

| Licence | Crates |
| --- | ---: |
| MIT OR Apache-2.0 (and equivalent spellings) | 80 |
| MIT | 7 |
| Apache-2.0 | 2 |
| Apache-2.0 OR BSL-1.0 | 1 |
| BSD-2-Clause OR Apache-2.0 OR MIT | 2 |
| MIT OR Apache-2.0 OR Zlib | 2 |
| Zlib OR Apache-2.0 OR MIT | 2 |
| Zlib | 2 |
| Unlicense OR MIT | 2 |
| CC0-1.0 | 1 |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 1 |
| first-party rocut crates, covered by `vendor/LICENSE` | 6 |

The largest third-party components are `wgpu` 29.0.1 and `naga` 29.0.1
(MIT OR Apache-2.0), `wasm-bindgen` 0.2.116 and `web-sys`/`js-sys` 0.3.93
(MIT OR Apache-2.0), and `serde` 1.0.228 (MIT OR Apache-2.0).
`unicode-ident` 1.0.24 additionally carries Unicode-3.0 for its Unicode data
tables.

The binary is built with `--remap-path-prefix` so it discloses no build-machine
paths or usernames; upstream's `check-wasm-paths` gate asserts this.

## 7. Assets — `vendor/surface/`

| Asset | Provenance | Licence position |
| --- | --- | --- |
| `fonts/font-atlas.json` + `fonts/font-chunk-*.avif` | Rendered name-preview sprites for 1920 Google Fonts families, generated by upstream from Google Fonts metadata | Derived from the Google Fonts corpus, distributed under SIL OFL 1.1 or Apache-2.0 per family. `font-atlas.json` names every family. |
| `flags/*.svg` (271 files) | Country and region flag SVGs inherited from the upstream repository | Ships under the upstream MIT licence; flag designs are not themselves copyrightable in most jurisdictions. |
| `effects/preview.jpg` | Upstream-authored effect preview still | MIT with the upstream repository. |
| `favicon.ico` | Upstream host chrome | MIT with the upstream repository. |
| `logos/opencut/svg/logo.svg` | **Placeholder authored for this repository** | MIT with this repository. See §2. |
| `workers/c4-worker-fixture.js`, `surface-evidence.html`, `assets/surface-evidence-*.js`, `module-graph.json` | Upstream verification fixtures emitted by the surface build | MIT with the upstream repository. Shipped verbatim so `vendor/surface/` stays byte-faithful to upstream's own asset allowlist. |

### 7.1 Offline motion-text fonts — `vendor/surface/motion-text/fonts/`

The motion-text renderer ships **19 digest-pinned TTF files** plus one OFL 1.1
notice each, for 38 files and 117,539,061 bytes under
`motion-text/fonts/`. They are the offline glyph closure the Rust font catalog
resolves by stable role ID; the renderer verifies each file's SHA-256 and its
missing-glyph set before drawing, and export fails closed on a missing glyph.

**motion-text/fonts are distributed under OFL-1.1.** Every font is an
unmodified upstream Google Fonts release, and the exact per-family licence text
ships beside the bytes as `motion-text/fonts/licenses/<family>-OFL.txt`. The
set is pinned to Google Fonts repository revision
`23e54b51ddffbc7713c583748e3bd86f62b1fa4a`; the M PLUS Rounded 1c notice is
additionally pinned to `coz-m/MPLUS_FONTS@eb604901d6f04b6f7f2a84b0378c58df84a9dba6`.

| Family | Shipped as | Role(s) |
| --- | --- | --- |
| Noto Sans JP | `noto-sans-jp-variable.ttf` | gothic_black, gothic_bold, gothic_light, gothic_med |
| Noto Serif JP | `noto-serif-jp-variable.ttf` | mincho, mincho_black, mincho_bold, mincho_light |
| Noto Sans SC | `noto-sans-sc-variable.ttf` | gothic_bold_zh_hans (the `gothic_bold` role's zh-Hans variant) |
| Dela Gothic One | `dela-gothic-one-regular.ttf` | dela |
| Zen Kaku Gothic New | `zen-kaku-gothic-new-black.ttf` | zenkaku |
| Zen Old Mincho | `zen-old-mincho-black.ttf` | mincho_black |
| Kaisei Tokumin | `kaisei-tokumin-extrabold.ttf` | tokumin |
| M PLUS Rounded 1c | `m-plus-rounded-1c-extrabold.ttf` | round |
| Mochiy Pop One | `mochiy-pop-one-regular.ttf` | pop |
| DotGothic16 | `dot-gothic-16-regular.ttf` | dot |
| Yuji Syuku | `yuji-syuku-regular.ttf` | brush |
| IBM Plex Mono | `ibm-plex-mono-medium.ttf` | mono |
| Reggae One | `reggae-one-regular.ttf` | reggae |
| Rampart One | `rampart-one-regular.ttf` | rampart |
| Potta One | `potta-one-regular.ttf` | potta |
| Kiwi Maru | `kiwi-maru-medium.ttf` | kiwi |
| Klee One | `klee-one-semibold.ttf` | klee |
| Shippori Mincho B1 | `shippori-mincho-b1-extrabold.ttf` | shippori |
| IBM Plex Sans JP | `ibm-plex-sans-jp-medium.ttf` | sansui |

This set is **not** a claim of general CJK coverage: 22 roles declare Japanese
and English, `mono` declares English only, and only the `gothic_bold_zh_hans`
variant declares Chinese. `zh-Hant` and `ko` have no offline glyph closure and
are rejected by the missing-glyph gate rather than served by a system fallback.
`vendor/PROVENANCE.md` carries the SHA-256 of every shipped font and licence
file; the authoritative role-to-asset mapping is upstream's
`rust/crates/motion-text/resources/jizura-font-catalog.json`.

## 8. Build tooling — not shipped

`esbuild`, `vite`, `bun`, `wasm-pack`, `turbo`, `typescript` and
`@elftia/plugin-kit` (MIT, from the npm registry) are build inputs only. None of
them appear under `vendor/` or in `dist/rocut/`.
