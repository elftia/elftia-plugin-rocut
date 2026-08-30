'use strict';

const os = require('node:os');
const path = require('node:path');

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

function createDescriptor(options = {}) {
  const pluginRoot = path.resolve(options.pluginRoot || path.join(__dirname, '..'));
  const registryRoot = path.resolve(options.registryRoot || path.join(os.homedir(), '.rocut'));

  return {
    toolId: TOOL_ID,
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

function activate(host) {
  if (!host || !host.toolHosts || typeof host.toolHosts.register !== 'function') {
    throw new Error(
      '[rocut] Elftia host.toolHosts is unavailable; Elftia Host API >= 1.51 is required.',
    );
  }
  const toolDescriptor = createDescriptor();
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
};
