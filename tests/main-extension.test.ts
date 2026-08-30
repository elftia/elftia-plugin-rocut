import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = require(path.join(repoRoot, "main", "index.cjs")) as {
  activate(host: unknown): unknown;
  createDescriptor(options?: { pluginRoot?: string; registryRoot?: string }): Record<string, any>;
};

describe("rocut main extension", () => {
  it("registers exactly one host-owned Tool Host descriptor", () => {
    const unregister = vi.fn();
    const register = vi.fn(() => unregister);

    expect(main.activate({ toolHosts: { register } })).toBe(unregister);
    expect(register).toHaveBeenCalledTimes(1);

    const descriptor = register.mock.calls[0][0];
    expect(descriptor).toMatchObject({
      toolId: "rocut",
      displayName: "rocut video editor",
      projectsDirName: "rocut",
      healthPath: "/health",
      editorUrlTemplate: "http://127.0.0.1:{port}/{token}/",
      project: {
        markers: ["project.json", ".elftia-rocut-project"],
        entryPath: null,
      },
    });
  });

  it("points launch and rendezvous paths at the installed runtime", () => {
    const pluginRoot = path.join(os.tmpdir(), "rocut-plugin-fixture");
    const registryRoot = path.join(os.tmpdir(), "rocut-registry-fixture");
    const descriptor = main.createDescriptor({ pluginRoot, registryRoot });

    expect(descriptor.launch.command).toBe(process.execPath);
    expect(descriptor.launch.args).toEqual([
      path.join(pluginRoot, "vendor", "run", "rocut.mjs"),
      "host",
      "start",
      "{project}",
      "--static",
      path.join(pluginRoot, "vendor", "surface"),
    ]);
    expect(descriptor.launch.env).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      ROCUT_TARGETS_ROOT: path.resolve(registryRoot),
    });
    expect(descriptor.registry).toEqual({
      indexPath: path.join(path.resolve(registryRoot), "targets.json"),
      secretPathTemplate: path.join(path.resolve(registryRoot), "targets", "{id}.json"),
    });
  });

  it("fails loudly on an older host without the v1.51 port", () => {
    expect(() => main.activate({})).toThrow(/host\.toolHosts.*1\.51/);
  });
});
