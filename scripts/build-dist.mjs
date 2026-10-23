#!/usr/bin/env node
/**
 * Assemble `dist/rocut/` — the only tree Elftia installs.
 *
 * The vendored bytes are checked against `vendor/PROVENANCE.md` before anything
 * is staged, so a `vendor/` that drifted from its manifest fails here rather
 * than reaching a release.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publishTreeAtomically } from "./atomic-tree-swap.mjs";
import {
  copyInventory,
  inventoryRocutSources,
  PLUGIN_ID,
  validateRocutTree,
  assertRocutPackageBudget,
} from "./dist-layout.mjs";
import { verifyVendorAgainstProvenance } from "./provenance.mjs";
import { prepareSelectedSources } from "./selected-runtime.mjs";

const defaultRepoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `vendor/` is gitignored, so a fresh clone reaches this script with no vendored
 * runtime at all. Say so in one sentence with the command to run, instead of an
 * ENOENT from somewhere inside a copy loop.
 */
async function assertVendorPresent(repoRoot) {
  const vendorRoot = join(repoRoot, "vendor");
  const required = [
    "PROVENANCE.md",
    "LICENSE",
    "NOTICE.md",
    "run/rocut.mjs",
    "surface/index.html",
  ];
  const missing = [];
  let vendorExists = true;
  try {
    const state = await stat(vendorRoot);
    if (!state.isDirectory()) vendorExists = false;
  } catch {
    vendorExists = false;
  }
  if (vendorExists) {
    for (const relative of required) {
      try {
        await stat(join(vendorRoot, ...relative.split("/")));
      } catch {
        missing.push(`vendor/${relative}`);
      }
    }
    if (missing.length === 0) return;
  }

  let pinLine = "";
  try {
    const pin = JSON.parse(
      await readFile(join(repoRoot, "upstream.json"), "utf8"),
    );
    pinLine = `\n  The pinned upstream commit is ${pin.commit} (${pin.repository}).`;
  } catch {
    /* upstream.json is validated by the vendor step itself */
  }

  throw new Error(
    [
      vendorExists
        ? `vendor/ is incomplete — missing ${missing.join(", ")}.`
        : "vendor/ does not exist.",
      "",
      "  vendor/ is a build product and is NOT committed, so a fresh clone has to",
      "  produce it before dist/ can be assembled. Run the vendor step first:",
      "",
      "    npm run vendor -- --rocut <path-to-rocut-checkout>",
      "",
      "  That step needs a local rocut checkout; it is the only step that does." +
        pinLine,
    ].join("\n"),
  );
}

export async function buildDist(options = {}) {
  if ((options.toolchainDir || options.toolchainSources) && !options.runtimeDir) throw new Error("toolchain sources require explicit selected runtime/surface/manifest inputs");
  let repoRoot = options.repoRoot ?? defaultRepoRoot;
  let selection = null;
  if (options.runtimeDir || options.surfaceDir || options.packManifest) {
    if (!options.runtimeDir || !options.surfaceDir || !options.packManifest) throw new Error("runtimeDir, surfaceDir and packManifest must be supplied together");
    selection = await prepareSelectedSources(repoRoot, options);
    repoRoot = selection.sourceRoot;
  }
  await assertVendorPresent(repoRoot);
  const provenance = await verifyVendorAgainstProvenance(
    join(repoRoot, "vendor"),
  );
  const sourceInventory = await inventoryRocutSources(repoRoot);
  const packageBudget = assertRocutPackageBudget(sourceInventory);
  const result = await publishTreeAtomically({
    repoRoot,
    targetRelative: `dist/${PLUGIN_ID}`,
    runPrefix: PLUGIN_ID,
    expectedInventory: sourceInventory,
    populateStage: (stage) => copyInventory(repoRoot, sourceInventory, stage),
    validateTree: validateRocutTree,
    fault: options.fault,
  });
  return { ...result, provenance, selection, packageBudget };
}

const invokedPath =
  process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;
if (invokedPath === import.meta.url) {
  try {
    const argv = process.argv.slice(2);
    const flag = name => { const index = argv.indexOf(`--${name}`); return index < 0 ? undefined : argv[index + 1]; };
    const result = await buildDist({ runtimeDir: flag("runtime-dir"), surfaceDir: flag("surface-dir"), packManifest: flag("pack-manifest"), licenseFile: flag("license-file"), outputRoot: flag("output-root"), toolchainDir: flag("toolchain-dir"), toolchainEngines: flag("toolchain-engines")?.split(","), platformTarget: flag("platform-target") });
    console.info(
      result.selection
        ? `build-dist: selected vendor OK (${result.provenance.fileCount} files; HEAD ${result.selection.facts.repoHead}, dirty=${result.selection.facts.dirty}; not pin-only)`
        : `build-dist: vendor OK (${result.provenance.fileCount} files pinned to ${String(result.provenance.upstreamCommit).slice(0, 12)})`,
    );
    console.info(
      `build-dist: PASS (${result.inventory.fileCount} files, ${result.inventory.sha256}) -> ${result.target}`,
    );
  } catch (error) {
    console.error(
      `build-dist: FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
