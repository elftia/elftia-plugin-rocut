import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { runInThisContext } from 'node:vm';
import { copyFile, mkdir, mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prepareOfflineDecoders } from '../scripts/prepare-offline-decoders.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let root: string, main: any;

// Exercise the real verifier with tiny, non-executable files. Only this isolated
// module's ledger trust anchor changes; production bytes and release pins stay intact.
async function fixtureMain(pluginRoot: string) {
  const directory = path.join(pluginRoot, 'prebuilds/win32-x64/decoder');
  await mkdir(directory, { recursive: true });
  const files = [];
  for (const name of ['ffmpeg.exe', 'ffprobe.exe', 'LICENSE.txt', 'NOTICE.txt', ...Array.from({ length: 6 }, (_, i) => `fixture-${i}.dll`)]) {
    const bytes = Buffer.from(`test fixture, not executable: ${name}\n`);
    await writeFile(path.join(directory, name), bytes);
    files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const ledger = JSON.stringify({ version: 1, platform: 'win32-x64', files }, null, 2) + '\n';
  await writeFile(path.join(directory, 'decoder-manifest.json'), ledger);
  const source = await readFile(path.join(repoRoot, 'main/index.cjs'), 'utf8');
  const anchor = /const expectedLedgerSha256 = '[a-f0-9]{64}';/g;
  expect(source.match(anchor)).toHaveLength(1);
  const fixtureSource = source.replace(anchor, `const expectedLedgerSha256 = '${createHash('sha256').update(ledger).digest('hex')}';`);
  const filename = path.join(pluginRoot, 'main/index.cjs');
  const instance = { exports: {} };
  const load = runInThisContext(`(function(require, module, exports, __filename, __dirname) {\n${fixtureSource}\n})`, { filename });
  load(createRequire(filename), instance, instance.exports, filename, path.dirname(filename));
  return instance.exports;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rocut-decoder-test-'));
  await mkdir(path.join(root, 'main'));
  await copyFile(path.join(repoRoot, 'main/index.cjs'), path.join(root, 'main/index.cjs'));
  await copyFile(path.join(repoRoot, 'elftia-plugin.json'), path.join(root, 'elftia-plugin.json'));
  main = await fixtureMain(root);
}, 30000);
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });
afterEach(() => vi.unstubAllEnvs());

describe('rocut installed decoder registration', () => {
  it('keeps the unchanged production verifier closed to the test ledger', async () => {
    const productionMain = require(path.join(root, 'main/index.cjs'));
    await expect(productionMain.createDescriptor()).rejects.toThrow(/pinned integrity/);
  });
  it('awaits verification before registering exactly one tool host', async () => {
    const unregister = vi.fn(), register = vi.fn(() => unregister);
    const pending = main.activate({ toolHosts: { register } });
    expect(register).not.toHaveBeenCalled();
    expect(await pending).toBe(unregister);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0][0]).toMatchObject({ toolId: 'rocut', htmlFrameCapture: 'v1', project: { entryPath: null } });
  });
  it('uses canonical bundled decoders with no environment or PATH dependency', async () => {
    vi.stubEnv('PATH', '');
    vi.stubEnv('ROCUT_NATIVE_FFMPEG_PATH', 'C:/untrusted/ffmpeg.exe');
    vi.stubEnv('ROCUT_NATIVE_FFPROBE_PATH', 'C:/untrusted/ffprobe.exe');
    const descriptor = await main.createDescriptor();
    expect(descriptor.launch.env.ROCUT_NATIVE_FFMPEG_PATH).toBe(path.join(root, 'prebuilds/win32-x64/decoder/ffmpeg.exe'));
    expect(descriptor.launch.env.ROCUT_NATIVE_FFPROBE_PATH).toBe(path.join(root, 'prebuilds/win32-x64/decoder/ffprobe.exe'));
    expect(process.env.ROCUT_NATIVE_FFMPEG_PATH).toBe('C:/untrusted/ffmpeg.exe');
    expect(descriptor.launch.args).toEqual([path.join(root, 'vendor/run/rocut.mjs'), 'host', 'start', '{project}', '--static', path.join(root, 'vendor/surface')]);
  });
  it('keeps only the existing explicit engine setting, without unrelated configuration', async () => {
    vi.stubEnv('ROCUT_ENGINE_TOOLCHAIN_DIR', 'C:/configured engine');
    vi.stubEnv('ROCUT_UNRELATED_SECRET', 'must-not-forward');
    const descriptor = await main.createDescriptor();
    expect(descriptor.launch.env.ROCUT_ENGINE_TOOLCHAIN_DIR).toBe('C:/configured engine');
    expect(descriptor.launch.env).not.toHaveProperty('ROCUT_UNRELATED_SECRET');
  });
  // Opt-in integration coverage requires the genuine pinned decoder archives.
  // Source CI runs the fixture verifier above, never calls fake bytes a decoder smoke.
  it.skipIf(process.platform !== 'win32' || process.env.ROCUT_TEST_REAL_DECODERS !== '1')('decodes MP3 using only the packaged executable and DLL closure with PATH empty', async () => {
    const realRoot = await mkdtemp(path.join(os.tmpdir(), 'rocut-real-decoder-test-'));
    try {
      await mkdir(path.join(realRoot, 'main'));
      await copyFile(path.join(repoRoot, 'main/index.cjs'), path.join(realRoot, 'main/index.cjs'));
      await copyFile(path.join(repoRoot, 'elftia-plugin.json'), path.join(realRoot, 'elftia-plugin.json'));
      await prepareOfflineDecoders(path.join(realRoot, 'prebuilds/win32-x64/decoder'));
      const descriptor = await require(path.join(realRoot, 'main/index.cjs')).createDescriptor(), run = promisify(execFile);
      const audio = path.join(realRoot, 'fixture.mp3');
      const options = { env: { ...process.env, PATH: '' }, windowsHide: true, timeout: 15000 };
      await run(descriptor.launch.env.ROCUT_NATIVE_FFMPEG_PATH, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-c:a', 'libmp3lame', audio], options);
      const result = await run(descriptor.launch.env.ROCUT_NATIVE_FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audio], options);
      expect(Number(JSON.parse(result.stdout).format.duration)).toBeGreaterThan(0.25);
      const pcm = path.join(realRoot, 'fixture.pcm');
      await run(descriptor.launch.env.ROCUT_NATIVE_FFMPEG_PATH, ['-v', 'error', '-i', audio, '-f', 's16le', pcm], options);
      expect((await readFile(pcm)).some(byte => byte !== 0)).toBe(true);
    } finally { await rm(realRoot, { recursive: true, force: true }); }
  });
  it('fails before registration after a previously verified file is changed', async () => {
    const file = path.join(root, 'prebuilds/win32-x64/decoder/NOTICE.txt');
    const bytes = await readFile(file), register = vi.fn();
    try {
      await writeFile(file, Buffer.alloc(bytes.length, 0x78));
      await expect(main.activate({ toolHosts: { register } })).rejects.toThrow(/integrity/);
      expect(register).not.toHaveBeenCalled();
    } finally { await writeFile(file, bytes); }
  });
  it('rejects missing files and a rewritten manifest', async () => {
    const directory = path.join(root, 'prebuilds/win32-x64/decoder');
    const file = path.join(directory, 'NOTICE.txt'), bytes = await readFile(file);
    await rm(file);
    try { await expect(main.createDescriptor()).rejects.toThrow(); }
    finally { await writeFile(file, bytes); }
    const ledger = path.join(directory, 'decoder-manifest.json'), manifest = await readFile(ledger);
    try {
      await writeFile(ledger, manifest.toString().replace('"version": 1', '"version": 2'));
      await expect(main.createDescriptor()).rejects.toThrow(/pinned integrity/);
    } finally { await writeFile(ledger, manifest); }
  });
  it('rejects a directory junction even to the verified decoder directory', async () => {
    const redirect = path.join(root, 'redirect');
    await mkdir(path.join(redirect, 'prebuilds/win32-x64'), { recursive: true });
    await symlink(path.join(root, 'prebuilds/win32-x64/decoder'), path.join(redirect, 'prebuilds/win32-x64/decoder'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(main.createDescriptor({ pluginRoot: redirect })).rejects.toThrow(/redirected/);
  });
  it('rejects an old host without registering anything', async () => {
    await expect(main.activate({})).rejects.toThrow(/host\.toolHosts.*1\.51/);
  });
});
