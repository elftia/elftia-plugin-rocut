import { createRequire } from 'node:module';
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
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rocut-decoder-test-'));
  await mkdir(path.join(root, 'main'));
  await copyFile(path.join(repoRoot, 'main/index.cjs'), path.join(root, 'main/index.cjs'));
  await copyFile(path.join(repoRoot, 'elftia-plugin.json'), path.join(root, 'elftia-plugin.json'));
  await mkdir(path.join(root, 'prebuilds/win32-x64'), { recursive: true });
  await prepareOfflineDecoders(path.join(root, 'prebuilds/win32-x64/decoder'));
  main = require(path.join(root, 'main/index.cjs'));
}, 30000);
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });
afterEach(() => vi.unstubAllEnvs());

describe('rocut installed decoder registration', () => {
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
  it.skipIf(process.platform !== 'win32')('decodes MP3 using only the packaged executable and DLL closure with PATH empty', async () => {
    const descriptor = await main.createDescriptor(), run = promisify(execFile);
    const audio = path.join(root, 'fixture.mp3');
    const options = { env: { ...process.env, PATH: '' }, windowsHide: true, timeout: 15000 };
    await run(descriptor.launch.env.ROCUT_NATIVE_FFMPEG_PATH, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-c:a', 'libmp3lame', audio], options);
    const result = await run(descriptor.launch.env.ROCUT_NATIVE_FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audio], options);
    expect(Number(JSON.parse(result.stdout).format.duration)).toBeGreaterThan(0.25);
    const pcm = path.join(root, 'fixture.pcm');
    await run(descriptor.launch.env.ROCUT_NATIVE_FFMPEG_PATH, ['-v', 'error', '-i', audio, '-f', 's16le', pcm], options);
    expect((await readFile(pcm)).some(byte => byte !== 0)).toBe(true);
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
