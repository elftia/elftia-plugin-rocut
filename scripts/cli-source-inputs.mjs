import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Project sources actually resolved by the production CLI graph; never copies their contents. */
export async function captureCliSourceInputs(upstreamRoot, options, ports = {}) {
  const git = ports.git ?? (args => execFileSync('git', args, { cwd: upstreamRoot, windowsHide: true }));
  const tracked = new Set(git(['ls-files', '-z']).toString('utf8').split('\0'));
  const changed = new Set(git(['diff', 'HEAD', '--name-only', '-z']).toString('utf8').split('\0'));
  const packer = ports.packer ?? await import(pathToFileURL(path.join(upstreamRoot, 'script/pack-runtime.mjs')));
  const wasmResolver = ports.wasmResolver ?? await import(pathToFileURL(path.join(upstreamRoot, 'script/runtime-wasm-package-closure.mjs')));
  const wasm = wasmResolver.resolveRuntimeWasmPackage({ repoRoot: upstreamRoot, wasmPackageDirectory: options.wasmPackageDirectory });
  const esbuild = ports.esbuild ?? createRequire(path.join(upstreamRoot, 'script/pack-runtime.mjs'))('esbuild');
  const graph = await esbuild.build({
    ...packer.runtimeBundleOptions({ repoRoot: upstreamRoot, outDir: options.outDir, wasmSyncEntry: wasm.wasmSyncEntry }),
    absWorkingDir: upstreamRoot, write: false,
  });
  const files = [];
  for (const input of Object.keys(graph.metafile.inputs).sort()) {
    const absolute = path.resolve(upstreamRoot, input);
    const relative = path.relative(upstreamRoot, absolute).split(path.sep).join('/');
    if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative) || relative.split('/').includes('node_modules')) continue;
    const before = await lstat(absolute, { bigint: true });
    assert(before.isFile() && !before.isSymbolicLink(), 'CLI source input must be an ordinary file');
    assert.equal((await realpath(absolute)).toLowerCase(), absolute.toLowerCase(), 'redirected CLI source rejected');
    const bytes = await readFile(absolute), after = await lstat(absolute, { bigint: true });
    assert(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]), 'CLI source changed while reading');
    files.push({ path: relative, status: tracked.has(relative) ? (changed.has(relative) ? 'modified-tracked' : 'tracked') : 'untracked', sizeBytes: bytes.length, sha256: digest(bytes) });
  }
  assert(files.some(file => file.path === 'apps/cli/src/main.ts'), 'CLI entry source must be captured');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { version: 1, scope: 'Production CLI esbuild project-source inputs only; excludes node_modules, external selected WASM, worker and Surface build sources', files, sha256: digest(Buffer.from(JSON.stringify(files))) };
}

export function assertCliSourceInputsUnchanged(before, after) {
  assert.deepEqual(after, before, 'CLI project source inputs drifted during runtime packing');
}
