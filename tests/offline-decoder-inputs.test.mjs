import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, lstat, symlink, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { ownedTemp } from './owned-temp.mjs';
import { prepareOfflineDecoders } from '../scripts/prepare-offline-decoders.mjs';
import { inspectOfflineDecoderInputs } from '../scripts/offline-decoder-inputs.mjs';
import { buildProductionCandidate } from '../scripts/build-production-candidate.mjs';
import { buildDist } from '../scripts/build-dist.mjs';

async function fixture() {
  const root = await ownedTemp('rocut-decoder-input-port-');
  const repo = path.join(root, 'repo'), inputs = path.join(root, 'archives');
  const metadata = path.join(repo, 'build-inputs/offline-decoders');
  await mkdir(metadata, { recursive: true }); await mkdir(inputs);
  const zip = new AdmZip(); zip.addFile('decoder/bin/ffmpeg.exe', Buffer.from('fixture-not-executable'));
  const archive = zip.toBuffer(), source = Buffer.from('fixture-source');
  const pin = (file, bytes) => ({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  await writeFile(path.join(inputs, 'decoder.zip'), archive);
  await writeFile(path.join(inputs, 'source.tar.gz'), source);
  await writeFile(path.join(metadata, 'provenance.json'), JSON.stringify({ archive: pin('decoder.zip', archive), sources: [pin('source.tar.gz', source)], runtimeFiles: ['ffmpeg.exe'], archiveRoot: 'decoder' }));
  await writeFile(path.join(metadata, 'NOTICE.txt'), 'producer notice');
  await writeFile(path.join(metadata, 'build-configuration.txt'), 'producer configuration');
  return { root, repo, inputs, metadata };
}

test('external archives use only producer pins/notices, retaining local input identity', async () => {
  const f = await fixture();
  await writeFile(path.join(f.inputs, 'provenance.json'), '{}');
  await writeFile(path.join(f.inputs, 'NOTICE.txt'), 'untrusted external notice');
  const out = await prepareOfflineDecoders(path.join(f.root, 'output'), f.repo, f.inputs);
  assert.equal(await readFile(path.join(out.target, 'NOTICE.txt'), 'utf8'), 'producer notice');
  assert.equal(out.inputIdentity.archiveDirectory, f.inputs);
  assert.match(out.inputIdentity.scope, /not-portable/);
  assert.equal(out.inputIdentity.files.length, 2);
  for (const file of out.inputIdentity.files) await copyFile(path.join(f.inputs, file.file), path.join(f.metadata, file.file));
  const compatible = await prepareOfflineDecoders(path.join(f.root, 'default-output'), f.repo);
  assert.equal(compatible.manifestSha256, out.manifestSha256);
});

test('production validates missing default archives and toolchain inputs before vendoring or installing', async () => {
  const f = await fixture();
  for (const name of ['upstream', 'surface', 'wasm']) await mkdir(path.join(f.root, name));
  const options = {
    outputRoot: path.join(f.root, 'production-output'), rocutRoot: path.join(f.root, 'upstream'),
    surfaceDirectory: path.join(f.root, 'surface'), wasmPackageDirectory: path.join(f.root, 'wasm'),
  };
  let invoked = 0;
  const ports = { repoRoot: f.repo, vendor() { invoked++; throw new Error('must not vendor'); }, toolchain() { invoked++; throw new Error('must not install'); } };
  await assert.rejects(buildProductionCandidate(options, ports), { code: 'ENOENT' });
  await assert.rejects(lstat(options.outputRoot), { code: 'ENOENT' });
  assert.equal(invoked, 0);
  // Once archives are present, absent portable toolchain metadata must fail just as early.
  for (const file of ['decoder.zip', 'source.tar.gz']) await copyFile(path.join(f.inputs, file), path.join(f.metadata, file));
  await assert.rejects(buildProductionCandidate(options, ports), { code: 'ENOENT' });
  await assert.rejects(lstat(options.outputRoot), { code: 'ENOENT' });
  assert.equal(invoked, 0);
});

test('missing archive, hash drift and relative input fail without creating output', async () => {
  const f = await fixture();
  const missing = path.join(f.root, 'missing'); await mkdir(missing);
  for (const input of [missing, 'relative']) {
    const output = path.join(f.root, `out-${path.basename(input)}`);
    await assert.rejects(prepareOfflineDecoders(output, f.repo, input));
    await assert.rejects(lstat(output), { code: 'ENOENT' });
  }
  const bytes = await readFile(path.join(f.inputs, 'source.tar.gz')); bytes[0] ^= 1;
  await writeFile(path.join(f.inputs, 'source.tar.gz'), bytes);
  const output = path.join(f.root, 'drift-output');
  await assert.rejects(prepareOfflineDecoders(output, f.repo, f.inputs), /hash drift/);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

test('overlapping output and redirected input/output ancestors are rejected before writes', async () => {
  const f = await fixture();
  await assert.rejects(prepareOfflineDecoders(path.join(f.inputs, 'output'), f.repo, f.inputs), /disjoint/);
  const alias = path.join(f.root, 'alias');
  await symlink(f.inputs, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectOfflineDecoderInputs(f.repo, alias), /redirected/);
  await assert.rejects(prepareOfflineDecoders(path.join(alias, 'out'), f.repo, f.inputs), /redirected/);
  await assert.rejects(lstat(path.join(f.inputs, 'out')), { code: 'ENOENT' });
});

test('production explicit inputs are validated before vendor or output creation; dist rejects unused port', async () => {
  const root = await ownedTemp('rocut-decoder-preflight-');
  const outputRoot = path.join(root, 'output'); let invoked = false;
  await assert.rejects(buildProductionCandidate({ outputRoot, rocutRoot: root, surfaceDirectory: root, wasmPackageDirectory: root, offlineDecoderInputs: root }, { vendor() { invoked = true; } }));
  assert.equal(invoked, false);
  await assert.rejects(lstat(outputRoot), { code: 'ENOENT' });
  await assert.rejects(buildDist({ offlineDecoderInputs: root }), /require explicit selected/);
});

test('production rejects a junction output ancestor before vendor or input-tree writes', async () => {
  const root = await ownedTemp('rocut-production-output-alias-');
  const inputs = path.join(root, 'inputs'); await mkdir(inputs);
  const alias = path.join(root, 'alias');
  await symlink(inputs, alias, process.platform === 'win32' ? 'junction' : 'dir');
  let invoked = false;
  await assert.rejects(buildProductionCandidate({
    outputRoot: path.join(alias, 'new-build'), rocutRoot: root,
    surfaceDirectory: root, wasmPackageDirectory: root,
    offlineDecoderInputs: inputs,
  }, { vendor() { invoked = true; } }), /redirected/);
  assert.equal(invoked, false);
  await assert.rejects(lstat(path.join(inputs, 'new-build')), { code: 'ENOENT' });
});
