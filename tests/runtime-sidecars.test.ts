import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  RUN_FILE_PATTERN,
  assertRuntimeSidecarClosure,
} from "../scripts/runtime-sidecars.mjs";

const roots: string[] = [];
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "rocut-runtime-sidecars-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files))
    await writeFile(path.join(root, name), text);
  return root;
}
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("fixed runtime sidecar closure", () => {
  it("allows exactly the fixed outputs, not arbitrary workers or nested paths", () => {
    for (const name of [
      "rocut.mjs",
      "chunk-ABCD.js",
      "opencut_wasm_bg.wasm",
      "particle-sampler-wasm.mjs",
      "particle-sampler-worker-entry.mjs",
      "liquid-object-wasm.mjs",
      "liquid-object-worker-entry.mjs",
    ])
      expect(RUN_FILE_PATTERN.test(name)).toBe(true);
    for (const name of [
      "arbitrary-worker.mjs",
      "particle-sampler-extra.mjs",
      "particle-sampler-wasm.js",
      "nested/liquid-object-wasm.mjs",
      "liquid-object-worker-entry.mjs.bak",
    ])
      expect(RUN_FILE_PATTERN.test(name)).toBe(false);
  });

  it("retains compatibility with old pins without sidecars", async () => {
    expect(
      await assertRuntimeSidecarClosure(
        await fixture({ "rocut.mjs": "export {};" }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["particle-sampler-wasm.mjs", "particle-sampler-worker-entry.mjs"],
    ["liquid-object-wasm.mjs", "liquid-object-worker-entry.mjs"],
  ])(
    "requires the companion of a partially present pair: %s",
    async (module, worker) => {
      const root = await fixture({
        [module]: "export {};",
        "opencut_wasm_bg.wasm": "wasm",
      });
      await expect(assertRuntimeSidecarClosure(root)).rejects.toThrow(
        `Required runtime sidecar missing: ${worker}`,
      );
      await writeFile(path.join(root, worker), "export {};");
      expect(await assertRuntimeSidecarClosure(root)).toEqual([module, worker]);
    },
  );

  it("rejects sidecars without their shared WASM binary", async () => {
    const root = await fixture({
      "liquid-object-wasm.mjs": "export {};",
      "liquid-object-worker-entry.mjs": "export {};",
    });
    await expect(assertRuntimeSidecarClosure(root)).rejects.toThrow(
      "shared WASM sibling",
    );
  });

  it("rejects a fixed sidecar name replaced by a directory", async () => {
    const root = await fixture({ "rocut.mjs": "export {};" });
    await mkdir(path.join(root, "particle-sampler-wasm.mjs"));
    await expect(assertRuntimeSidecarClosure(root)).rejects.toThrow(
      "must be regular",
    );
  });

  it("rejects invalid UTF-8 in runtime JavaScript", async () => {
    const root = await fixture({ "rocut.mjs": "export {};" });
    await writeFile(path.join(root, "rocut.mjs"), Buffer.from([0xc3, 0x28]));
    await expect(assertRuntimeSidecarClosure(root)).rejects.toThrow();
  });
});
