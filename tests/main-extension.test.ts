import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const main = require(path.join(repoRoot, "main", "index.cjs")) as {
  activate(host: unknown): unknown;
  createDescriptor(options?: {
    pluginRoot?: string;
    registryRoot?: string;
  }): Record<string, any>;
};
const nativeSettings = [
  "ROCUT_ENGINE_TOOLCHAIN_DIR",
  "ROCUT_NATIVE_FFMPEG_PATH",
  "ROCUT_NATIVE_FFPROBE_PATH",
];
afterEach(() => vi.unstubAllEnvs());

describe("rocut main extension", () => {
  it("registers exactly one host-owned Tool Host descriptor", () => {
    const unregister = vi.fn();
    const register = vi.fn(() => unregister);

    expect(main.activate({ toolHosts: { register } })).toBe(unregister);
    expect(register).toHaveBeenCalledTimes(1);

    const descriptor = register.mock.calls[0][0];
    expect(descriptor).toMatchObject({
      toolId: "rocut",
      htmlFrameCapture: "v1",
      htmlFrameCaptureCapabilities: [
        "particle-surface-session-v2",
        "liquid-object-session-v2",
        "html-frames-native-video-v1",
        "html-frames-native-audio-v1",
        "html-frames-native-audio-session-v1",
      ],
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
    for (const name of nativeSettings) vi.stubEnv(name, undefined);
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
      secretPathTemplate: path.join(
        path.resolve(registryRoot),
        "targets",
        "{id}.json",
      ),
    });
  });

  it("explicitly declares only its native configuration without changing empty or absent settings", () => {
    vi.stubEnv("ROCUT_ENGINE_TOOLCHAIN_DIR", "C:/configured toolchain");
    vi.stubEnv("ROCUT_NATIVE_FFMPEG_PATH", "");
    vi.stubEnv("ROCUT_NATIVE_FFPROBE_PATH", undefined);
    vi.stubEnv("ROCUT_UNRELATED_SECRET", "must-not-forward");
    const descriptor = main.createDescriptor();
    expect(descriptor.launch.env.ROCUT_ENGINE_TOOLCHAIN_DIR).toBe(
      "C:/configured toolchain",
    );
    expect(descriptor.launch.env.ROCUT_NATIVE_FFMPEG_PATH).toBe("");
    expect(descriptor.launch.env).not.toHaveProperty(
      "ROCUT_NATIVE_FFPROBE_PATH",
    );
    expect(descriptor.launch.env).not.toHaveProperty("ROCUT_UNRELATED_SECRET");
  });

  it("fails loudly on an older host without the v1.51 port", () => {
    expect(() => main.activate({})).toThrow(/host\.toolHosts.*1\.51/);
  });

  it.each(nativeSettings)("forwards configured %s to the Tool Host", (name) => {
    for (const setting of nativeSettings) vi.stubEnv(setting, undefined);
    vi.stubEnv(name, "C:/configured tool path");
    const descriptor = main.createDescriptor();
    expect(descriptor.launch.env[name]).toBe("C:/configured tool path");
    for (const setting of nativeSettings.filter((key) => key !== name)) {
      expect(descriptor.launch.env).not.toHaveProperty(setting);
    }
  });

  it("preserves empty configuration without forwarding unrelated settings", () => {
    for (const name of nativeSettings) vi.stubEnv(name, "");
    vi.stubEnv("ROCUT_UNRELATED_SECRET", "must-not-forward");
    const descriptor = main.createDescriptor();
    for (const name of nativeSettings) expect(descriptor.launch.env[name]).toBe("");
    expect(descriptor.launch.env).not.toHaveProperty("ROCUT_UNRELATED_SECRET");
  });
});
