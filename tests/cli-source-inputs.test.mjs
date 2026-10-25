import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { captureCliSourceInputs, assertCliSourceInputsUnchanged } from '../scripts/cli-source-inputs.mjs';
import { readCliSourceInputs, renderProvenance } from '../scripts/provenance.mjs';
import { ownedTemp } from './owned-temp.mjs';

const require = createRequire(import.meta.url);
const esbuild = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite'))('esbuild');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('actual CLI graph includes an untracked imported helper, excludes unrelated contents, and rejects source drift', async () => {
  const root = await ownedTemp('rocut-cli-source-');
  const src = path.join(root, 'apps/cli/src');
  await mkdir(src, { recursive: true });
  await writeFile(path.join(src, 'main.ts'), "import { scope } from './agent-project-scope'; console.log(scope);\n");
  const helper = Buffer.from("export const scope = 'new-untracked-scope-behavior';\n");
  await writeFile(path.join(src, 'agent-project-scope.ts'), helper);
  await writeFile(path.join(root, 'private-unrelated.txt'), 'must never enter source facts');
  let output = '';
  const ports = {
    git: args => Buffer.from(args[0] === 'ls-files' ? 'apps/cli/src/main.ts\0' : 'apps/cli/src/main.ts\0'),
    packer: { runtimeBundleOptions: ({ repoRoot, outDir }) => ({ entryPoints: [path.join(repoRoot, 'apps/cli/src/main.ts')], bundle: true, platform: 'node', format: 'esm', outdir: outDir, metafile: true }) },
    wasmResolver: { resolveRuntimeWasmPackage: () => ({ wasmSyncEntry: 'unused' }) },
    esbuild: { build: async options => { const result = await esbuild.build(options); output = result.outputFiles.map(file => file.text).join(''); return result; } },
  };
  const options = { outDir: path.join(root, 'not-written') };
  const before = await captureCliSourceInputs(root, options, ports);
  assert(output.includes('new-untracked-scope-behavior'));
  assert.deepEqual(before.files.find(file => file.path.endsWith('agent-project-scope.ts')), {
    path: 'apps/cli/src/agent-project-scope.ts', status: 'untracked', sizeBytes: helper.length, sha256: digest(helper),
  });
  assert.equal(before.files.length, 2);
  assertCliSourceInputsUnchanged(before, await captureCliSourceInputs(root, options, ports));
  await writeFile(path.join(src, 'agent-project-scope.ts'), "export const scope = 'changed';\n");
  const after = await captureCliSourceInputs(root, options, ports);
  assert.throws(() => assertCliSourceInputsUnchanged(before, after), /drifted/);
  const text = renderProvenance({ upstreamCommit: 'a'.repeat(40), upstreamRepository: 'fixture', packedAt: 'fixture',
    nodeVersion: 'fixture', esbuildVersion: 'fixture', bunVersion: 'fixture', platform: 'fixture',
    dirtyEntries: ['?? apps/cli/src/agent-project-scope.ts'], modifiedTracked: { diffstat: 'main.ts changed', files: [] },
    cliSourceInputs: before, substitutions: [], removals: [], entries: [{ path: 'run/rocut.mjs', sha256: 'b'.repeat(64) }] });
  assert.deepEqual(readCliSourceInputs(text), before);
  assert(!text.includes('untracked** entries only'));
  assert(!text.includes('every tracked file'));
  assert.throws(() => readCliSourceInputs(text.replace(before.sha256, '0'.repeat(64))), /digest mismatch/);
});
