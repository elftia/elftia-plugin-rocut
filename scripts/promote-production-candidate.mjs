import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { publishTreeAtomically } from "./atomic-tree-swap.mjs";
import {
  copyInventory,
  inventoryRegularTree,
  inventoriesEqual,
  validateRocutTree,
  assertRocutPackageBudget,
} from "./dist-layout.mjs";
import { verifyVendorAgainstProvenance } from "./provenance.mjs";
import { validateToolchainClosure } from "./toolchain-closure.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);
const json = async (file) => JSON.parse(await readFile(file, "utf8"));

/** No alternate swap/cleanup implementation: the existing identity-pinned publisher owns the transaction. */
export async function verifyProductionCandidate(
  candidate,
  buildFacts,
  repoRoot = repo,
) {
  assert(
    path.isAbsolute(candidate) && path.isAbsolute(buildFacts),
    "absolute candidate and build facts required",
  );
  const facts = await json(buildFacts),
    pin = await json(path.join(repoRoot, "upstream.json"));
  assert.equal(facts.version, 1, "unsupported production build facts");
  assert.equal(
    facts.upstreamPinSha256,
    createHash("sha256")
      .update(await readFile(path.join(repoRoot, "upstream.json")))
      .digest("hex"),
    "upstream pin metadata drift",
  );
  assert.equal(
    facts.upstreamCommit,
    pin.commit,
    "candidate differs from current upstream pin",
  );
  const inventory = await inventoryRegularTree(candidate);
  assert(
    inventoriesEqual(inventory, facts.candidate.inventory),
    "candidate differs from complete build inventory",
  );
  const checked = await validateRocutTree(candidate, inventory);
  const authoring = await json(path.join(repoRoot, "elftia-plugin.json"));
  const manifest = await json(path.join(candidate, "elftia-plugin.json"));
  assert.equal(
    manifest.version,
    authoring.version,
    "candidate version differs from producer",
  );
  assert.equal(
    manifest.version,
    (await json(path.join(repoRoot, "package.json"))).version,
  );
  assert.deepEqual(manifest.supportedPlatforms, ["win32-x64"]);
  await verifyVendorAgainstProvenance(path.join(candidate, "vendor"));
  const provenance = await readFile(
    path.join(candidate, "vendor/PROVENANCE.md"),
    "utf8",
  );
  const selected = provenance.match(
    /\n\n(\{[\s\S]*?\})\n\n## SHA-256 manifest/,
  );
  assert(selected, "explicit selected production provenance required");
  const source = JSON.parse(selected[1]);
  assert.equal(source.repoHead, pin.commit);
  assert.equal(source.runtimeManifestSha256, facts.runtimeManifestSha256);
  await validateToolchainClosure(
    path.join(candidate, "prebuilds/win32-x64/toolchain"),
  );
  assertRocutPackageBudget(inventory);
  return { inventory, manifest, facts, checked };
}

export async function promoteProductionCandidate(options) {
  const repoRoot = options.repoRoot ?? repo;
  const verified = await verifyProductionCandidate(
    options.candidate,
    options.buildFacts,
    repoRoot,
  );
  const target = path.join(repoRoot, "dist/rocut");
  await exec(
    process.execPath,
    [
      path.join(repoRoot, "node_modules/@elftia/plugin-kit/dist/cli.mjs"),
      "verify",
      options.candidate,
    ],
    {
      cwd: repoRoot,
      windowsHide: true,
      timeout: 240000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (!options.verifyOnly) {
    await publishTreeAtomically({
      repoRoot,
      targetRelative: "dist/rocut",
      runPrefix: "rocut-production",
      expectedInventory: verified.inventory,
      populateStage: (stage) =>
        copyInventory(options.candidate, verified.inventory, stage),
      validateTree: validateRocutTree,
      fault: options.fault,
    });
  }
  const beforeStamp = await inventoryRegularTree(target);
  assert(
    inventoriesEqual(beforeStamp, verified.inventory),
    "published dist differs from verified candidate",
  );
  const kit = path.join(
    repoRoot,
    "node_modules/@elftia/plugin-kit/dist/cli.mjs",
  );
  const run = async (args) =>
    exec(process.execPath, [kit, ...args], {
      cwd: repoRoot,
      windowsHide: true,
      timeout: 240000,
      maxBuffer: 1024 * 1024,
    });
  if (!options.verifyOnly) await run(["stamp", target]);
  await run(["verify", target]);
  const afterStamp = await inventoryRegularTree(target);
  // This candidate already declares the correct code-entry checksum. A stamp drift is a failed release gate.
  assert(
    inventoriesEqual(beforeStamp, afterStamp),
    "stamp changed previously validated bytes; requalify the stamped candidate before release",
  );
  await validateRocutTree(target, afterStamp);
  if (!options.verifyOnly) await run(["release", target, "--out", "release"]);
  const result = {
    version: 1,
    pluginVersion: verified.manifest.version,
    upstreamCommit: verified.facts.upstreamCommit,
    state: options.verifyOnly
      ? "verified-selected-release"
      : "committed-and-released",
    target,
    candidate: options.candidate,
    buildFacts: options.buildFacts,
    beforeStampSha256: beforeStamp.sha256,
    afterStampSha256: afterStamp.sha256,
    fileCount: afterStamp.fileCount,
    defaultVendorComparison:
      "not-run; explicit selected candidate inventory is the comparison owner",
  };
  if (options.report)
    await writeFile(options.report, JSON.stringify(result, null, 2) + "\n", {
      flag: "wx",
    });
  return result;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const flag = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  console.log(
    JSON.stringify(
      await promoteProductionCandidate({
        candidate: flag("candidate"),
        buildFacts: flag("build-facts"),
        report: flag("report"),
        verifyOnly: process.argv.includes("--verify-only"),
      }),
    ),
  );
}
