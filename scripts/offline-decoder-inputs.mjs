import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

// Check every ancestor, including junctions which can redirect an otherwise ordinary leaf.
export async function assertOrdinaryPath(value, kind = 'directory') {
  assert(typeof value === 'string' && path.isAbsolute(value), 'explicit absolute decoder path required');
  const resolved = path.resolve(value), root = path.parse(resolved).root;
  assert(resolved !== root, 'decoder path must not be a filesystem root');
  let current = root;
  for (const part of path.relative(root, resolved).split(path.sep)) {
    current = path.join(current, part);
    const state = await lstat(current);
    assert(!state.isSymbolicLink(), 'redirected decoder path rejected');
    assert(current === resolved && kind === 'file' ? state.isFile() : state.isDirectory(), 'ordinary decoder path required');
    assert(samePath(path.resolve(await realpath(current)), current), 'redirected decoder path rejected');
  }
  return resolved;
}

export function assertDisjointDecoderPaths(output, inputs) {
  assert(typeof output === 'string' && path.isAbsolute(output), 'absolute fresh decoder output required');
  const a = path.resolve(output), b = path.resolve(inputs);
  const contains = (x, y) => { const relative = path.relative(x, y); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
  assert(!contains(a, b) && !contains(b, a), 'decoder output must be disjoint from inputs');
}

async function readOrdinaryFile(file) {
  await assertOrdinaryPath(file, 'file');
  const before = await lstat(file, { bigint: true });
  const bytes = await readFile(file);
  const after = await lstat(file, { bigint: true });
  await assertOrdinaryPath(file, 'file');
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key], 'decoder input changed while reading');
  return bytes;
}

/** External directories supply archives only; all pins and notices remain producer-owned. */
export async function inspectOfflineDecoderInputs(repoRoot, archiveDirectory) {
  const metadataRoot = await assertOrdinaryPath(path.join(repoRoot, 'build-inputs/offline-decoders'));
  const archiveRoot = await assertOrdinaryPath(archiveDirectory ?? metadataRoot);
  const metadata = {};
  for (const name of ['provenance.json', 'NOTICE.txt', 'build-configuration.txt']) metadata[name] = await readOrdinaryFile(path.join(metadataRoot, name));
  const provenance = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadata['provenance.json']));
  const archives = new Map(), files = [];
  for (const pin of [provenance.archive, ...provenance.sources]) {
    assert(/^[A-Za-z0-9._-]+$/.test(pin.file) && pin.file !== '.' && pin.file !== '..', 'flat archive name required');
    assert(Number.isSafeInteger(pin.bytes) && pin.bytes > 0 && /^[a-f0-9]{64}$/.test(pin.sha256), 'invalid decoder input pin');
    assert(!archives.has(pin.file), 'duplicate decoder input pin');
    const bytes = await readOrdinaryFile(path.join(archiveRoot, pin.file));
    assert.equal(bytes.length, pin.bytes, 'decoder input size drift');
    assert.equal(digest(bytes), pin.sha256, 'decoder input hash drift');
    archives.set(pin.file, bytes);
    files.push({ file: pin.file, bytes: bytes.length, sha256: digest(bytes) });
  }
  return { provenance, metadata, archives, identity: { scope: 'local-verified-input-location-not-portable-release-source', archiveDirectory: archiveRoot, provenanceSha256: digest(metadata['provenance.json']), files } };
}
