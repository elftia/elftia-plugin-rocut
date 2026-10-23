# Reproducible production build inputs

These are source/build inputs, not an installed plugin snapshot. No step reads
`C:/tmps`, an Elftia profile, or the old selected candidate.

`toolchain/three-assets/elftia-three-assets-0.1.1.tgz` was produced with the
package's normal TypeScript build and `npm pack --ignore-scripts`, from only
tracked `packages/three-assets` files at Director commit
`920b1e8a823e8f232f6e4a0fa112b66b3868ccaa`. That commit was **not advertised by
Director's remote** when checked: remote main/HEAD was
`8bc5636aa889ca7e0a36a07cda41d091354e7382`. The archive therefore carries all
selected source bytes itself, with per-file hashes, MIT grant, codec notices and
compiled outputs. A fresh clone obtains the source archive from this repository;
it does not need that local Director checkout or an unpublished remote commit.
`three-assets/provenance.json` records the source, compiler lock and archive SRI.
The package MIT grant does not relicense Director as a whole. Draco/Basis notices
and their Apache-2.0 terms remain inside the archive.

To independently rebuild the same archive, copy `three-assets-build/package.json`
and `package-lock.json` into a fresh compiler directory, run `npm ci --ignore-scripts`
there, then run:

```
node scripts/three-assets-source.mjs --dependencies <absolute-compiler-directory> --output-root <fresh-absolute-directory>
```

This reads source from the committed archive, compiles using the fixed TypeScript
5.9.2 dependency closure and companion tsconfig, runs normal npm pack, and requires
the resulting archive SHA-256 to match. It never builds in Director or modifies
the supplied dependency directory.

For a fresh win32-x64 production toolchain:

```
node scripts/prepare-production-toolchain.mjs --output-root <fresh-absolute-directory>
```

The script copies the two source locks and sibling archive into that fresh tree,
runs isolated `npm ci --ignore-scripts` against exact registry URLs/SRI, composes
the complete HyperFrames/Remotion/Three package closure, checks the pinned compiler
reachability evidence, and applies the existing reviewed compiler consumer
profile. Supplemental legal notices are committed copies fetched from their
recorded upstream URLs and verified by SHA-256. No runtime download is added.

The resulting `<output>/toolchain` is a normal validated input to
`scripts/build-dist.mjs --runtime-dir <new-pack-output> --surface-dir <new-pack-output>/surface --pack-manifest <new-pack-manifest> --license-file <new-vendor-output>/LICENSE --toolchain-dir <output>/toolchain --platform-target win32-x64 --output-root <fresh-candidate-root>`.
First obtain the exact Rocut commit in `upstream.json`, prepare its declared WASM
and relative-base editor surface prerequisites, and run the normal vendor step
with fresh `--output-root`. Use the newly generated runtime/manifest/surface,
never the previous machine's selected artifacts. This is an explicit win32-x64
candidate recipe, not a cross-platform release claim.

The complete normal pipeline is also available as one command:

```
node scripts/build-production-candidate.mjs --rocut <absolute-checkout-at-upstream-pin> --surface-dir <absolute-prepared-surface> --wasm-package-dir <absolute-matching-wasm-package> --output-root <fresh-absolute-directory>
```

It runs the existing pin-checked vendor packer, prepares the portable toolchain,
and uses only that new pack's runtime, surface, manifest and LICENSE for the
candidate. An already prepared `--toolchain-dir <absolute-validated-closure>` may
be supplied to reuse the same verified source closure without another install.
The candidate output root must be outside both the producer and Rocut source
trees, as required by the vendor path guard.
The output records pin, runtime manifest, toolchain closure and build-input
digests. An upstream tracked modification still fails closed; commit upstream
and deliberately update `upstream.json` before running it.

After qualification, promote the exact candidate through the existing guarded
atomic publisher and normal plugin-kit commands:

```
npm run promote:production -- --candidate <absolute-qualified-dist-rocut> --build-facts <absolute-production-candidate.json> --report <new-absolute-report.json>
npm run verify:production -- --candidate <same-qualified-dist-rocut> --build-facts <same-production-candidate.json>
```

Promotion validates every inventory entry, manifest/schema/version, current
upstream pin, selected runtime provenance and full toolchain closure. It copies
only the verified inventory into producer `dist/rocut`, verifies exact parity,
then runs normal `elftia-plugin stamp`, `verify`, and `release`. Stamp must leave
the already qualified bytes unchanged; otherwise release stops and requires
requalification. The report records hashes before and after stamping. Atomic
commit/cleanup failures preserve the safe publisher's explicit recovery state;
post-commit packaging failures do not roll back an already committed dist.

`verify:production` compares dist against the explicit qualified build inventory.
It does not claim the older default `vendor/` comparison of `verify:dist` passed.
The selected win32-x64 scope remains unchanged. No Host vendor tree is written.
