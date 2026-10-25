import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { normalizeDeliveryBytes } from './selected-delivery-bytes.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Offline, pinned archive projection. No PATH lookup, download or subprocess execution. */
export async function prepareOfflineDecoders(target, repoRoot = repo) {
  const inputs = path.join(repoRoot, 'build-inputs/offline-decoders');
  const provenanceBytes = await readFile(path.join(inputs, 'provenance.json'));
  const provenance = JSON.parse(provenanceBytes);
  for (const pin of [provenance.archive, ...provenance.sources]) {
    assert(/^[A-Za-z0-9._-]+$/.test(pin.file), 'flat archive name required');
    const source = path.join(inputs, pin.file), state = await lstat(source);
    assert(state.isFile() && !state.isSymbolicLink(), 'ordinary committed archive required');
    const bytes = await readFile(source);
    assert.equal(bytes.length, pin.bytes, 'decoder input size drift');
    assert.equal(digest(bytes), pin.sha256, 'decoder input hash drift');
  }
  assert(path.isAbsolute(target), 'absolute fresh decoder output required');
  await mkdir(target);
  assert.equal((await realpath(target)).toLowerCase(), path.resolve(target).toLowerCase(), 'redirected output rejected');
  const archive = new AdmZip(await readFile(path.join(inputs, provenance.archive.file)));
  const entries = archive.getEntries();
  const pins = [];
  async function emit(name, bytes) {
    if (!/\.(?:exe|dll|tar\.gz)$/.test(name)) bytes = normalizeDeliveryBytes(bytes);
    await writeFile(path.join(target, name), bytes, { flag: 'wx' });
    pins.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
  }
  for (const name of provenance.runtimeFiles) {
    const entryName = `${provenance.archiveRoot}/${name === 'LICENSE.txt' ? name : `bin/${name}`}`;
    const matches = entries.filter(entry => entry.entryName === entryName);
    assert.equal(matches.length, 1, 'exact pinned decoder archive member required');
    const entry = matches[0];
    assert(!entry.isDirectory && ((entry.header.attr >>> 16) & 0xf000) !== 0xa000, 'ordinary archive member required');
    await emit(name, entry.getData());
  }
  for (const source of provenance.sources) await emit(source.file, await readFile(path.join(inputs, source.file)));
  for (const name of ['NOTICE.txt', 'build-configuration.txt']) await emit(name, await readFile(path.join(inputs, name)));
  await emit('provenance.json', provenanceBytes);
  pins.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const ledger = Buffer.from(JSON.stringify({ version: 1, platform: 'win32-x64', files: pins }, null, 2) + '\n');
  await writeFile(path.join(target, 'decoder-manifest.json'), ledger, { flag: 'wx' });
  return { target, manifestSha256: digest(ledger), fileCount: pins.length + 1, expandedBytes: pins.reduce((n, p) => n + p.bytes, ledger.length) };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  console.log(JSON.stringify(await prepareOfflineDecoders(path.resolve(process.argv[2]))));
