# Offline Windows media decoders

`provenance.json` pins the unmodified BtbN FFmpeg LGPL shared release and the exact
FFmpeg/build-recipe source revisions. The original ZIP and both source archives are
fixed binary build inputs; a clean checkout may not contain them. Supply the three
files from a verified artifact store or local archive directory. No decoder download
is performed during installation. The largest archive is 80,994,607 bytes.

`scripts/prepare-offline-decoders.mjs` verifies those input hashes, then projects
the two executables, all seven upstream DLLs, the upstream LGPL license, sources,
recorded build configuration and redistribution notice into a fresh output. It
does not execute the decoder or use PATH, environment configuration or the network.
The source archives accompany the installed decoder; the binary ZIP remains a build input.
All delivered text is canonicalized to LF before inventory and ledger hashing,
matching the Host packaging contract. Executables, DLLs and source archives keep
their original binary bytes. LF and CRLF input metadata must produce the same ledger.

The production build automatically performs this projection alongside the Windows
toolchain. The ledger SHA-256 is pinned in `main/index.cjs`, itself protected by the
plugin manifest checksum and official package inventory. On activation, asynchronous
streaming verification checks the full closure and ordinary canonical paths before
registering the Tool Host. Each activation verifies bytes anew; no mtime cache or
process-wide environment mutation is used. Missing, altered, added or redirected
files prevent registration. Updating these build inputs requires reviewing the
source/notice/configuration, refreshing the pinned ledger digest, and updating the
main checksum before building a new plugin version.

When archives are outside this directory, append
`--offline-decoder-inputs <absolute-archive-directory>` to the existing
`npm run build:production -- ...` command. The same flag is supported by the
selected-input `build-dist.mjs` route and by
`node scripts/prepare-offline-decoders.mjs <absolute-fresh-output> ...`.
Only the archive bytes come from that directory: `provenance.json`, `NOTICE.txt`
and `build-configuration.txt` always come from this producer checkout. Names,
sizes and SHA-256 must match; links, redirected ancestors and overlapping outputs
are rejected. Explicit invalid input fails before production vendoring/toolchain
work. Omitting the flag retains this directory as the default archive source.

Selected provenance records the verified local input location and archive hashes;
the location is not a portable release source. Preserve the artifact-store identity
alongside the final build manifest so another clean checkout can obtain the same bytes.

Run `node --test tests/offline-decoders.test.mjs` for deterministic offline projection
and archive-drift checks. Set `ROCUT_OFFLINE_DECODER_INPUTS` to the same absolute
archive directory when running that real-archive test; an explicitly supplied missing
input fails. Without supplied archives, that case reports a skip. The mandatory
synthetic input/path checks are in `tests/offline-decoder-inputs.test.mjs`.
`npx vitest run tests/main-extension.test.ts` additionally
checks registration, tampering, missing files, manifest rewriting, junctions and a
real MP3 roundtrip with PATH empty. The LGPL variant provides software H.264 through
libopenh264 and AAC, without requiring libx264; full native export qualification is
performed by the Host's representative Electron harness.

This reproduces package bytes from archived upstream build inputs. It does not
claim a fresh toolchain compilation reproduces the upstream binary ZIP byte for byte.
License and source details are in `NOTICE.txt`, `provenance.json` and the archives.
