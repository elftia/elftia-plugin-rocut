import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ownedTemp } from './owned-temp.mjs';
import { prepareProductionToolchain } from '../scripts/prepare-production-toolchain.mjs';

async function fixture() {
  const root = await ownedTemp('rocut-toolchain-preflight-');
  const repo = path.join(root, 'repo'), inputs = path.join(repo, 'build-inputs/toolchain');
  for (const name of ['three-assets', 'hyperframes-remotion', 'three']) await mkdir(path.join(inputs, name), { recursive: true });
  const archive = Buffer.from('synthetic source archive');
  await writeFile(path.join(inputs, 'three-assets/source.tgz'), archive);
  await writeFile(path.join(inputs, 'three-assets/provenance.json'), JSON.stringify({ archive: { file: 'source.tgz', bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64') } }));
  for (const name of ['hyperframes-remotion', 'three']) {
    const manifest = { name, version: '1.0.0', dependencies: {} };
    await writeFile(path.join(inputs, name, 'package.json'), JSON.stringify(manifest));
    await writeFile(path.join(inputs, name, 'package-lock.json'), JSON.stringify({ ...manifest, packages: { '': manifest } }));
  }
  for (const name of ['license-evidence.json', 'compiler-review.json']) await writeFile(path.join(inputs, name), '{}');
  return { root, repo, inputs, output: path.join(root, 'output') };
}

test('invalid second toolchain lock fails before output creation or either npm install', async () => {
  const { repo, inputs, output } = await fixture();
  const manifest = { name: 'three', version: '1.0.0', dependencies: {} };
  await writeFile(path.join(inputs, 'three/package-lock.json'), JSON.stringify({ ...manifest, packages: { '': manifest, 'node_modules/bad': { resolved: 'https://unapproved.example/test.tgz', integrity: 'sha512-test' } } }));
  let installs = 0;
  await assert.rejects(prepareProductionToolchain(output, { install() { installs++; } }, { repoRoot: repo }), /portable locked registry source required/);
  assert.equal(installs, 0);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

test('second toolchain manifest mismatch fails before output creation or either npm install', async () => {
  const { repo, inputs, output } = await fixture();
  await writeFile(path.join(inputs, 'three/package.json'), JSON.stringify({ name: 'three', version: '1.0.0', dependencies: { unexpected: '1.0.0' } }));
  let installs = 0;
  await assert.rejects(prepareProductionToolchain(output, { install() { installs++; } }, { repoRoot: repo }), /manifest\/root lock dependencies mismatch: three/);
  assert.equal(installs, 0);
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

test('toolchain output junction ancestor is refused before writes or npm install', async () => {
  const root = await ownedTemp('rocut-toolchain-output-junction-');
  const destination = path.join(root, 'destination'); await mkdir(destination);
  const alias = path.join(root, 'alias'); await symlink(destination, alias, process.platform === 'win32' ? 'junction' : 'dir');
  let installs = 0;
  await assert.rejects(prepareProductionToolchain(path.join(alias, 'output'), { install() { installs++; } }), /redirected/);
  assert.equal(installs, 0);
  await assert.rejects(lstat(path.join(destination, 'output')), { code: 'ENOENT' });
});
