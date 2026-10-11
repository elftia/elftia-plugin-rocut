import assert from "node:assert/strict";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

// Fixed producer outputs, not a wildcard permission to ship arbitrary workers.
export const RUN_FILE_PATTERN =
  /^(rocut\.mjs|chunk-[A-Za-z0-9_-]+\.js|opencut_wasm_bg\.wasm|particle-sampler-(wasm|worker-entry)\.mjs|liquid-object-(wasm|worker-entry)\.mjs)$/;

export const RUNTIME_SIDECAR_GROUPS = Object.freeze([
  Object.freeze([
    "particle-sampler-wasm.mjs",
    "particle-sampler-worker-entry.mjs",
  ]),
  Object.freeze(["liquid-object-wasm.mjs", "liquid-object-worker-entry.mjs"]),
]);

/** Older pins have no sidecars. A reference in any entry/chunk, or one present
 * member, requires the whole corresponding pair before staging or shipping.
 */
export async function assertRuntimeSidecarClosure(directory) {
  const root = path.resolve(directory);
  const state = await lstat(root);
  assert(
    state.isDirectory() && !state.isSymbolicLink(),
    "Runtime closure must be an ordinary directory",
  );
  assert.equal(
    path.resolve(await realpath(root)),
    root,
    "Runtime closure directory may not redirect",
  );
  const files = (await readdir(root, { withFileTypes: true })).filter(
    ({ name }) => RUN_FILE_PATTERN.test(name),
  );
  const names = new Set();
  const sources = [];
  for (const file of files) {
    assert(file.isFile(), `Runtime closure file must be regular: ${file.name}`);
    names.add(file.name);
    if (/\.(?:js|mjs)$/.test(file.name)) {
      sources.push(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readFile(path.join(root, file.name)),
        ),
      );
    }
  }
  const required = RUNTIME_SIDECAR_GROUPS.filter((group) =>
    group.some(
      (name) =>
        names.has(name) || sources.some((source) => source.includes(name)),
    ),
  );
  for (const group of required) {
    for (const name of group)
      assert(names.has(name), `Required runtime sidecar missing: ${name}`);
    assert(
      names.has("opencut_wasm_bg.wasm"),
      "Runtime sidecars require the shared WASM sibling",
    );
  }
  return required.flat();
}
