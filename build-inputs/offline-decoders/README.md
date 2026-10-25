# Offline Windows media decoders

`provenance.json` pins the unmodified BtbN FFmpeg LGPL shared release and the exact
FFmpeg/build-recipe source revisions. The original ZIP and both source archives are
committed binary build inputs, not downloads performed during installation. No LFS
filter is configured. The largest archive is 80,994,607 bytes.

`scripts/prepare-offline-decoders.mjs` verifies those input hashes, then projects
the two executables, all seven upstream DLLs, the upstream LGPL license, sources,
recorded build configuration and redistribution notice into a fresh output. It
does not execute the decoder or use PATH, environment configuration or the network.
The source archives accompany the installed decoder; the binary ZIP stays here.
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

Run `node --test tests/offline-decoders.test.mjs` for deterministic offline projection
and archive-drift checks. `npx vitest run tests/main-extension.test.ts` additionally
checks registration, tampering, missing files, manifest rewriting, junctions and a
real MP3 roundtrip with PATH empty. The LGPL variant provides software H.264 through
libopenh264 and AAC, without requiring libx264; full native export qualification is
performed by the Host's representative Electron harness.

This reproduces package bytes from archived upstream build inputs. It does not
claim a fresh toolchain compilation reproduces the upstream binary ZIP byte for byte.
License and source details are in `NOTICE.txt`, `provenance.json` and the archives.
