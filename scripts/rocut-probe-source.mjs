import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// Preserve the installed-driver preflight before loading its helper graph.
if (
  ["--linked-workflow-only", "--agent-drafts-only"].some((flag) =>
    process.argv.includes(flag),
  )
) {
  assert(
    process.env.ELFTIA_INSTALLED_ROCUT,
    "Set the exact installed plugin root",
  );
  realpathSync(process.env.ELFTIA_INSTALLED_ROCUT);
}

export function getRocutProbeRoot() {
  assert(
    process.env.ROCUT_WORKTREE,
    "Set ROCUT_WORKTREE to the explicit Rocut source checkout",
  );
  const root = realpathSync(process.env.ROCUT_WORKTREE);
  assert.equal(
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name,
    "opencut",
    "ROCUT_WORKTREE must be a Rocut checkout",
  );
  return root;
}

export async function loadRocutProbe(name) {
  assert.match(
    name,
    /^probe-[a-z0-9-]+\.mjs$/,
    "Only named neutral probe helpers may be loaded",
  );
  const base = realpathSync(join(getRocutProbeRoot(), "script"));
  const file = realpathSync(join(base, name));
  const rel = relative(base, file);
  assert(
    rel && !rel.startsWith("..") && !isAbsolute(rel),
    "Probe helper must remain in Rocut script/",
  );
  return import(pathToFileURL(file).href);
}

// Reuse the checkout's existing test dependency; never install into the host or
// introduce an Elftia dependency into the portable editor packages.
export const { expect } = await import(
  pathToFileURL(
    join(getRocutProbeRoot(), "node_modules/@playwright/test/index.mjs"),
  ).href
);
