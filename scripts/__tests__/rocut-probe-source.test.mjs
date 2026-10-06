import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "node:test";
import { getRocutProbeRoot, loadRocutProbe } from "../rocut-probe-source.mjs";

test("neutral source helpers are explicitly rooted and expose the existing API", async () => {
  assert(getRocutProbeRoot());
  const helper = await loadRocutProbe("probe-reload-editor.mjs");
  assert.equal(typeof helper.reloadEditorFrame, "function");
});

test("neutral helper loader refuses path traversal, absolute paths and unrelated files", async () => {
  for (const name of [
    "../probe-reload-editor.mjs",
    "/probe-reload-editor.mjs",
    "C:/probe-reload-editor.mjs",
    "package.json",
    "probe-../../escape.mjs",
  ]) {
    await assert.rejects(
      loadRocutProbe(name),
      /Only named neutral probe helpers/,
    );
  }
});

test("a missing checkout is never inferred from cwd or an adjacent private host", () => {
  const previous = process.env.ROCUT_WORKTREE;
  try {
    delete process.env.ROCUT_WORKTREE;
    assert.throws(getRocutProbeRoot, /Set ROCUT_WORKTREE/);
  } finally {
    if (previous === undefined) delete process.env.ROCUT_WORKTREE;
    else process.env.ROCUT_WORKTREE = previous;
  }
});

test("every relocated driver's neutral helper and named exports still resolve", async () => {
  const scripts = fileURLToPath(new URL("../", import.meta.url));
  const helpers = new Map();
  for (const name of await readdir(scripts)) {
    if (!name.startsWith("probe-") || !name.endsWith(".mjs")) continue;
    const text = await readFile(join(scripts, name), "utf8");
    for (const match of text.matchAll(
      /const \{([^}]+)\} = await loadRocutProbe\("(probe-[a-z0-9-]+\.mjs)"\)/g,
    )) {
      const names = helpers.get(match[2]) ?? new Set();
      for (const binding of match[1].split(",")) {
        const name = binding.split(":")[0].trim();
        if (name) names.add(name); // Formatted multiline destructuring may end with a comma.
      }
      helpers.set(match[2], names);
    }
  }
  assert(
    helpers.size >= 40,
    "The migrated helper graph must not be an empty proof",
  );
  for (const [name, exports] of helpers) {
    const helper = await loadRocutProbe(name);
    for (const key of exports) assert(key in helper, `${name} must export ${key}`);
  }
});
