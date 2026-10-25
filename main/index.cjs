'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');

const MANIFEST = require('../elftia-plugin.json');

const TOOL_ID = 'rocut';
const PROJECT_SENTINEL = '.elftia-rocut-project';
const CAPABILITY_ID = 'atelier.tool-host.rocut';

/**
 * The `provides` entry for {@link CAPABILITY_ID}, read back out of THIS
 * plugin's own manifest.
 *
 * Deliberately not a second literal: the Broker rejects `provide()` outright
 * when the runtime descriptor's `version` or `cardinality` disagrees with the
 * manifest declaration (it is the manifest a reviewer or marketplace reads, so
 * every selection field must come from it). Hard-coding them here would mean a
 * version bump that touched only the manifest silently turned registration
 * into a throw at the next activation.
 */
function declaredCapability() {
  const provides
    = MANIFEST && MANIFEST.capabilities && Array.isArray(MANIFEST.capabilities.provides)
      ? MANIFEST.capabilities.provides
      : [];
  return provides.find((entry) => entry && entry.id === CAPABILITY_ID);
}

/**
 * The one operation this Capability offers.
 *
 * READ-ONLY ON PURPOSE. rocut's automation surface is its CLI, driven by the
 * agent through the bundled skill — that is the single supported way to MUTATE
 * a project, and duplicating any of it here would create a second write path
 * that the skill's transaction/revision discipline does not cover. What a
 * consuming PLUGIN needs is different from what the agent needs: it cannot
 * shell out, and it only wants to know this tool host is here and how to name
 * it. `mutability: 'read'` also keeps the three Phase 1 composition weaknesses
 * dormant (design §14.7 — they come due with the first WRITE operation).
 *
 * The schema ids follow the `<capability>.<op>.<dir>@<n>` convention. No
 * Contract Package resolves them in v1; they are forward-compatibility labels.
 */
const DESCRIBE_OPERATION = {
  name: 'describe',
  mutability: 'read',
  idempotency: 'idempotent',
  cancellable: false,
  inputSchemaId: `${CAPABILITY_ID}.describe.in@1`,
  outputSchemaId: `${CAPABILITY_ID}.describe.out@1`,
};

function createCapabilityDescriptor(declared) {
  return {
    id: declared.id,
    version: declared.version,
    target: declared.target,
    cardinality: declared.cardinality,
    operations: [DESCRIBE_OPERATION],
  };
}

/**
 * The Capability endpoint. Answers from the tool-host descriptor this plugin
 * just built, so it cannot report something the host was not actually given.
 *
 * `version` is absent from the payload by design — a consumer already has it
 * as the Lease's `negotiatedVersion`, and a second copy could disagree.
 */
function createCapabilityEndpoint(toolDescriptor) {
  return {
    async invoke(_context, operation) {
      if (operation !== DESCRIBE_OPERATION.name) {
        throw new Error(`[rocut] unknown capability operation "${operation}"`);
      }
      return {
        toolId: toolDescriptor.toolId,
        displayName: toolDescriptor.displayName,
        projectsDirName: toolDescriptor.projectsDirName,
        // States the automation contract as DATA: a consumer must not go
        // looking for verbs to drive rocut here — the agent's CLI skill owns
        // that, and this Capability will never grow them.
        automation: 'cli',
      };
    },
  };
}

async function verifyOfflineDecoders(pluginRoot) {
  const expectedLedgerSha256 = '46f4257d11cca234ab4504f9ffbe5153e5118e77a328222af9cb67449b7437c7';
  const root = path.join(pluginRoot, 'prebuilds', 'win32-x64', 'decoder');
  const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  async function ordinary(file, directory = false) {
    const absolute = path.resolve(file), volume = path.parse(absolute).root;
    let current = volume;
    for (const part of path.relative(volume, absolute).split(path.sep)) {
      current = path.join(current, part);
      const state = await fs.lstat(current);
      if (state.isSymbolicLink() || !same(await fs.realpath(current), current) ||
          (current !== absolute || directory ? !state.isDirectory() : !state.isFile()))
        throw Error('[rocut] offline decoder path is redirected or not ordinary');
    }
    return fs.lstat(absolute, { bigint: true });
  }
  const rootIdentity = await ordinary(root, true);
  const ledgerPath = path.join(root, 'decoder-manifest.json');
  await ordinary(ledgerPath);
  const manifestBytes = await fs.readFile(ledgerPath);
  if (createHash('sha256').update(manifestBytes).digest('hex') !== expectedLedgerSha256)
    throw Error('[rocut] offline decoder manifest failed pinned integrity verification');
  const ledger = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  if (ledger.version !== 1 || ledger.platform !== 'win32-x64' || !Array.isArray(ledger.files) ||
      ledger.files.length < 10 || ledger.files.length > 64)
    throw Error('[rocut] invalid offline decoder manifest');
  const declared = new Set(['decoder-manifest.json']);
  const snapshots = [];
  for (const pin of ledger.files) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pin.path) || declared.has(pin.path) ||
        !/^[a-f0-9]{64}$/.test(pin.sha256) || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || pin.bytes > 200 * 1024 ** 2)
      throw Error('[rocut] invalid offline decoder file pin');
    declared.add(pin.path);
    const file = path.join(root, pin.path), before = await ordinary(file);
    if (before.size !== BigInt(pin.bytes)) throw Error('[rocut] offline decoder size differs');
    const hash = createHash('sha256');
    // Stream asynchronously: activation never blocks the main thread hashing the DLL closure.
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const after = await ordinary(file);
    if (hash.digest('hex') !== pin.sha256 || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key]))
      throw Error('[rocut] offline decoder changed or failed integrity verification');
    snapshots.push({ file, state: after });
  }
  if (JSON.stringify((await fs.readdir(root)).sort()) !== JSON.stringify([...declared].sort()) ||
      !declared.has('ffmpeg.exe') || !declared.has('ffprobe.exe') || !declared.has('LICENSE.txt') ||
      !(await fs.readFile(ledgerPath)).equals(manifestBytes))
    throw Error('[rocut] offline decoder closure differs from manifest');
  for (const { file, state } of snapshots) {
    const after = await ordinary(file);
    if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => state[key] !== after[key]))
      throw Error('[rocut] offline decoder closure changed during verification');
  }
  const currentRoot = await ordinary(root, true);
  if (['dev', 'ino', 'mtimeNs', 'ctimeNs'].some(key => rootIdentity[key] !== currentRoot[key]))
    throw Error('[rocut] offline decoder directory changed during verification');
  return { ROCUT_NATIVE_FFMPEG_PATH: path.join(root, 'ffmpeg.exe'), ROCUT_NATIVE_FFPROBE_PATH: path.join(root, 'ffprobe.exe') };
}

async function createDescriptor(options = {}) {
  const pluginRoot = path.resolve(options.pluginRoot || path.join(__dirname, '..'));
  const registryRoot = path.resolve(options.registryRoot || path.join(os.homedir(), '.rocut'));
  // The restricted Tool Host launcher does not inherit application configuration.
  // Declare only this tool's existing, non-secret toolchain/decoder settings.
  const nativeEnvironment = {};
  for (const name of [
    'ROCUT_ENGINE_TOOLCHAIN_DIR',
  ]) {
    if (process.env[name] !== undefined) nativeEnvironment[name] = process.env[name];
  }
  // Decoder identity comes only from the installed, verified package, never PATH or env.
  Object.assign(nativeEnvironment, await verifyOfflineDecoders(pluginRoot));

  return {
    toolId: TOOL_ID,
    htmlFrameCapture: 'v1',
    htmlFrameCaptureCapabilities: [
      'particle-surface-session-v2',
      'liquid-object-session-v2',
      'html-frames-native-video-v1',
      'html-frames-native-audio-v1',
      'html-frames-native-audio-session-v1',
    ],
    displayName: 'rocut video editor',
    projectsDirName: 'rocut',
    project: {
      markers: ['project.json', PROJECT_SENTINEL],
      entryPath: null,
      scaffold: {
        files: [
          {
            relativePath: PROJECT_SENTINEL,
            content: 'Created by Elftia for rocut.\n',
          },
        ],
      },
    },
    launch: {
      command: process.execPath,
      args: [
        path.join(pluginRoot, 'vendor', 'run', 'rocut.mjs'),
        'host',
        'start',
        '{project}',
        '--static',
        path.join(pluginRoot, 'vendor', 'surface'),
      ],
      cwd: pluginRoot,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        ROCUT_TARGETS_ROOT: registryRoot,
        ...nativeEnvironment,
      },
    },
    registry: {
      indexPath: path.join(registryRoot, 'targets.json'),
      secretPathTemplate: path.join(registryRoot, 'targets', '{id}.json'),
    },
    editorUrlTemplate: 'http://127.0.0.1:{port}/{token}/',
    healthPath: '/health',
  };
}

/**
 * Register the Capability, if this host can host one.
 *
 * NEVER THROWS. The tool-host registration above is what makes rocut usable at
 * all; this one only makes the plugin DISCOVERABLE to other plugins. A host
 * without a wired Broker (`host.capabilities` is optional and honestly so) or
 * a manifest someone stripped the declaration out of must degrade to "no
 * Capability", never to "rocut failed to activate" — a throw here would be
 * marked `failed` by the loader and cost the user the editor.
 *
 * No teardown is threaded back: `ExtensionCapabilityBroker.removePlugin`
 * already runs `unregisterAllFor(pluginId)` on unload/disable, so the endpoint
 * cannot outlive its plugin.
 */
function registerCapability(host, toolDescriptor) {
  if (!host.capabilities || typeof host.capabilities.provide !== 'function') return;
  const declared = declaredCapability();
  if (!declared) {
    console.warn(
      `[rocut] manifest declares no "${CAPABILITY_ID}" provider; skipping capability registration`,
    );
    return;
  }
  try {
    host.capabilities.provide(
      createCapabilityDescriptor(declared),
      createCapabilityEndpoint(toolDescriptor),
    );
  } catch (error) {
    console.warn(
      `[rocut] capability registration for "${CAPABILITY_ID}" failed; the tool host is unaffected:`,
      error && error.message ? error.message : error,
    );
  }
}

async function activate(host) {
  if (!host || !host.toolHosts || typeof host.toolHosts.register !== 'function') {
    throw new Error(
      '[rocut] Elftia host.toolHosts is unavailable; Elftia Host API >= 1.51 is required.',
    );
  }
  const toolDescriptor = await createDescriptor();
  const unregister = host.toolHosts.register(toolDescriptor);
  registerCapability(host, toolDescriptor);
  return unregister;
}

module.exports = {
  activate,
  createDescriptor,
  createCapabilityDescriptor,
  createCapabilityEndpoint,
  declaredCapability,
  verifyOfflineDecoders,
};
