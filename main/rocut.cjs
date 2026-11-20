#!/usr/bin/env node
'use strict';

const { execFile } = require('node:child_process');
const { stat } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const { decoderEnvironment } = require('./index.cjs');
const exec = promisify(execFile);
const pluginRoot = path.resolve(__dirname, '..');
const features = ['edit', 'media-tools', 'segment-mp4', 'segment-webm'];
const doctorUsage = 'rocut doctor [--json] [--require ' + features.join('|') + ']';

async function probe(file, args) {
  if (!file) return '';
  try {
    const { stdout } = await exec(file, args, { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 });
    return stdout;
  } catch { return ''; }
}

async function doctor(args) {
  if (args.includes('--help')) return console.log(doctorUsage);
  const rest = args.filter(arg => arg !== '--json');
  const required = rest[1];
  if (rest.length && (rest.length !== 2 || rest[0] !== '--require' || !features.includes(required))) {
    throw Error('usage: ' + doctorUsage);
  }
  const resolved = await decoderEnvironment(pluginRoot);
  const ffmpeg = resolved.env.ROCUT_NATIVE_FFMPEG_PATH;
  const ffprobe = resolved.env.ROCUT_NATIVE_FFPROBE_PATH;
  const [mpegVersion, probeVersion] = await Promise.all([probe(ffmpeg, ['-version']), probe(ffprobe, ['-version'])]);
  const runnable = /^ffmpeg version /i.test(mpegVersion) && /^ffprobe version /i.test(probeVersion);
  const encoders = runnable ? await probe(ffmpeg, ['-hide_banner', '-encoders']) : '';
  const supported = new Set(Array.from(encoders.matchAll(/^\s*[VAS][A-Z.]{5}\s+(\S+)/gm), match => match[1]));
  const mediaFix = resolved.reason ?? 'Use a working FFmpeg/ffprobe pair and retry doctor.';
  const coreFiles = await Promise.all(['rocut.mjs', 'opencut_wasm_bg.wasm'].map(name =>
    stat(path.join(pluginRoot, 'vendor', 'run', name)).then(file => file.isFile() && file.size > 0, () => false)));
  function segment(names) {
    const missing = names.filter(name => !supported.has(name));
    if (!runnable) return { available: false, fix: mediaFix };
    return missing.length ? { available: false, missingEncoders: missing,
      fix: 'Select an FFmpeg build with ' + missing.join(', ') + ' or install it alongside the current build.' } : { available: true };
  }
  const report = {
    source: resolved.source,
    tools: {
      ffmpeg: { path: ffmpeg ?? null, version: mpegVersion.split(/\r?\n/)[0] || null },
      ffprobe: { path: ffprobe ?? null, version: probeVersion.split(/\r?\n/)[0] || null },
    },
    features: {
      edit: coreFiles.every(Boolean) ? { available: true } : { available: false, fix: 'Install the packaged Rocut CLI and its sibling WASM core.' },
      'media-tools': runnable ? { available: true } : { available: false, fix: mediaFix },
      'segment-mp4': segment(['libopenh264', 'aac']),
      'segment-webm': segment(['libvpx-vp9', 'libopus']),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (required && !report.features[required].available) process.exitCode = 1;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'doctor') return doctor(args);
  if (process.argv.includes('--help')) console.log('  ' + doctorUsage);
  if (command === 'host' || command === 'video-poster') {
    const resolved = await decoderEnvironment(pluginRoot);
    delete process.env.ROCUT_NATIVE_FFMPEG_PATH;
    delete process.env.ROCUT_NATIVE_FFPROBE_PATH;
    Object.assign(process.env, resolved.env);
    if (command === 'video-poster' && resolved.reason) console.error('rocut: ' + resolved.reason);
  }
  // Keep the upstream entry guard, sibling WASM resolution and detached host re-exec intact.
  const entry = path.join(pluginRoot, 'vendor', 'run', 'rocut.mjs');
  process.argv[1] = entry;
  await import(pathToFileURL(entry).href);
}

main().catch(error => { console.error('rocut: ' + error.message); process.exitCode = 1; });
