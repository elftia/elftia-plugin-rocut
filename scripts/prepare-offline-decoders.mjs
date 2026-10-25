import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { normalizeDeliveryBytes } from './selected-delivery-bytes.mjs';
import { inspectOfflineDecoderInputs, assertOrdinaryPath, assertDisjointDecoderPaths } from './offline-decoder-inputs.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Offline, pinned archive projection. No PATH lookup, download or subprocess execution. */
export async function prepareOfflineDecoders(target, repoRoot = repo, offlineDecoderInputs) {
  const input = await inspectOfflineDecoderInputs(repoRoot, offlineDecoderInputs);
  const { provenance, metadata, archives } = input;
  const provenanceBytes = metadata['provenance.json'];
  assertDisjointDecoderPaths(target, input.identity.archiveDirectory);
  assertDisjointDecoderPaths(target, path.join(repoRoot, 'build-inputs/offline-decoders'));
  await assertOrdinaryPath(path.dirname(target));
  const archive = new AdmZip(archives.get(provenance.archive.file));
  const entries = archive.getEntries();
  const projected = [];
  for (const name of provenance.runtimeFiles) {
    assert(/^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..', 'flat runtime member required');
    const entryName = `${provenance.archiveRoot}/${name === 'LICENSE.txt' ? name : `bin/${name}`}`;
    const matches = entries.filter(entry => entry.entryName === entryName);
    assert.equal(matches.length, 1, 'exact pinned decoder archive member required');
    const entry = matches[0];
    assert(!entry.isDirectory && ((entry.header.attr >>> 16) & 0xf000) !== 0xa000, 'ordinary archive member required');
    projected.push([name, entry.getData()]);
  }
  await mkdir(target);
  await assertOrdinaryPath(target);
  const outputIdentity = await lstat(target, { bigint: true });
  async function checkOutput() {
    await assertOrdinaryPath(target);
    const current = await lstat(target, { bigint: true });
    assert.equal(current.dev, outputIdentity.dev, 'decoder output changed');
    assert.equal(current.ino, outputIdentity.ino, 'decoder output changed');
  }
  const pins = [];
  async function emit(name, bytes) {
    await checkOutput();
    if (!/\.(?:exe|dll|tar\.gz)$/.test(name)) bytes = normalizeDeliveryBytes(bytes);
    await writeFile(path.join(target, name), bytes, { flag: 'wx' });
    pins.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
  }
  for (const [name, bytes] of projected) await emit(name, bytes);
  for (const source of provenance.sources) await emit(source.file, archives.get(source.file));
  for (const name of ['NOTICE.txt', 'build-configuration.txt']) await emit(name, metadata[name]);
  await emit('provenance.json', provenanceBytes);
  pins.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const ledger = Buffer.from(JSON.stringify({ version: 1, platform: 'win32-x64', files: pins }, null, 2) + '\n');
  await checkOutput();
  await writeFile(path.join(target, 'decoder-manifest.json'), ledger, { flag: 'wx' });
  return { target, inputIdentity: input.identity, manifestSha256: digest(ledger), fileCount: pins.length + 1, expandedBytes: pins.reduce((n, p) => n + p.bytes, ledger.length) };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  console.log(JSON.stringify(await prepareOfflineDecoders(process.argv[2], repo, process.argv.includes('--offline-decoder-inputs') ? process.argv[process.argv.indexOf('--offline-decoder-inputs') + 1] ?? '' : undefined)));
