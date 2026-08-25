'use strict';

const os = require('node:os');
const path = require('node:path');

const TOOL_ID = 'rocut';
const PROJECT_SENTINEL = '.elftia-rocut-project';

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

function activate(host) {
  if (!host || !host.toolHosts || typeof host.toolHosts.register !== 'function') {
    throw new Error(
      '[rocut] Elftia host.toolHosts is unavailable; Elftia Host API >= 1.51 is required.',
    );
  }
  return host.toolHosts.register(createDescriptor());
}

module.exports = { activate, createDescriptor };
