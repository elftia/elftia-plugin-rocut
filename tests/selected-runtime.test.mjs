import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { ownedTemp } from "./owned-temp.mjs";
import { inspectSelectedRuntime } from "../scripts/selected-runtime.mjs";
import { RUN_FILE_PATTERN, sha256 } from "../scripts/dist-layout.mjs";

async function fixture(extra = []) {
  const root = await ownedTemp("rocut-selected-runtime-test-");
  const runtime = path.join(root, "runtime"); await mkdir(runtime);
  const files = [];
  for (const name of ["rocut.mjs", "chunk-ABC.js", "opencut_wasm_bg.wasm", "liquid-object-wasm.mjs", "liquid-object-worker-entry.mjs", "particle-sampler-wasm.mjs", "particle-sampler-worker-entry.mjs", ...extra]) {
    await writeFile(path.join(runtime, name), name); files.push({ path: name, sha256: sha256(Buffer.from(name)), sizeBytes: Buffer.byteLength(name) });
  }
  const manifest = path.join(root, "manifest.json"); await writeFile(manifest, JSON.stringify({ files }));
  return { root, runtime, manifest };
}
test("current exact worker/glue runtime closure accepted", async () => {
  const f = await fixture(); assert.equal((await inspectSelectedRuntime(f.runtime, f.manifest)).runtime.length, 7);
});
test("unexpected file rejected even if manifest declares it", async () => {
  const f = await fixture(["unexpected.mjs"]); await assert.rejects(inspectSelectedRuntime(f.runtime, f.manifest), /unexpected runtime file/);
});
test("path escape names and redirected runtime rejected", async () => {
  assert.equal(RUN_FILE_PATTERN.test("../rocut.mjs"), false);
  const f = await fixture(); const link = path.join(f.root, "redirect"); await symlink(f.runtime, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(inspectSelectedRuntime(link, f.manifest), /symlink|junction|ordinary|directory/i);
});
test("runtime digest mismatch rejected", async () => {
  const f = await fixture(); await writeFile(path.join(f.runtime, "rocut.mjs"), "changed"); await assert.rejects(inspectSelectedRuntime(f.runtime, f.manifest), /manifest mismatch/);
});
