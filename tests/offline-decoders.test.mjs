import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, copyFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareOfflineDecoders } from '../scripts/prepare-offline-decoders.mjs';

test('LF and CRLF archived-input metadata project to the same exact decoder ledger without network', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rocut-offline-build-'));
  try {
    const a = await prepareOfflineDecoders(path.join(root, 'a'));
    const variant = path.join(root, 'crlf-inputs');
    const inputs = path.join(variant, 'build-inputs/offline-decoders');
    await mkdir(inputs, { recursive: true });
    const original = new URL('../build-inputs/offline-decoders/', import.meta.url);
    for (const name of await readdir(original)) {
      const source = new URL(name, original), target = path.join(inputs, name);
      if (/\.(json|txt|md)$/.test(name)) {
        const text = (await readFile(source)).toString('utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
        await writeFile(target, Buffer.from(text, 'utf8'));
      } else await copyFile(source, target);
    }
    const b = await prepareOfflineDecoders(path.join(root, 'b'), variant);
    assert.equal(a.manifestSha256, b.manifestSha256);
    assert.equal(a.manifestSha256, '46f4257d11cca234ab4504f9ffbe5153e5118e77a328222af9cb67449b7437c7');
    assert.equal(a.fileCount, 16);
    assert.equal(a.expandedBytes, 184655812);
    assert.deepEqual(await readFile(path.join(a.target, 'decoder-manifest.json')), await readFile(path.join(b.target, 'decoder-manifest.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a modified committed archive fails before output publication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rocut-offline-drift-'));
  try {
    const inputs = path.join(root, 'build-inputs/offline-decoders');
    await mkdir(inputs, { recursive: true });
    await writeFile(path.join(inputs, 'drift.zip'), 'drift');
    await writeFile(path.join(inputs, 'provenance.json'), JSON.stringify({ archive: { file: 'drift.zip', bytes: 5, sha256: '0'.repeat(64) }, sources: [] }));
    await assert.rejects(prepareOfflineDecoders(path.join(root, 'output'), root), /input hash drift/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
