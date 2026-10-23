import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { vendorRocut } from "./vendor-rocut.mjs";
import { prepareProductionToolchain } from "./prepare-production-toolchain.mjs";
import { buildDist } from "./build-dist.mjs";
import { validateToolchainClosure } from "./toolchain-closure.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

/** Normal pin-checked pack -> verified source closure -> isolated candidate. */
export async function buildProductionCandidate(options, ports = {}) {
  const { outputRoot, rocutRoot, surfaceDirectory, wasmPackageDirectory } = options;
  assert([outputRoot, rocutRoot, surfaceDirectory, wasmPackageDirectory].every(value => typeof value === "string" && path.isAbsolute(value)), "explicit absolute production paths required");
  await mkdir(outputRoot);
  const vendoring = path.join(outputRoot, "vendoring");
  const vendor = await (ports.vendor ?? vendorRocut)({
    rocutRoot, surfaceDirectory, wasmPackageDirectory, outputRoot: vendoring,
  });
  const runtime = path.join(vendoring, ".elftia-work/dist-runtime");
  const packManifest = path.join(vendoring, ".elftia-work/runtime-bundle-manifest.json");
  const manifest = JSON.parse(await readFile(packManifest, "utf8"));
  assert.equal(manifest.repoHead, vendor.head, "new runtime source identity differs from pin-checked vendor");
  const toolchain = options.toolchainDir ?? (await (ports.toolchain ?? prepareProductionToolchain)(path.join(outputRoot, "toolchain-build"))).target;
  await (ports.validateToolchain ?? validateToolchainClosure)(toolchain);
  const candidate = await (ports.build ?? buildDist)({
    runtimeDir: runtime, surfaceDir: path.join(runtime, "surface"), packManifest,
    licenseFile: path.join(vendor.vendorRoot, "LICENSE"),
    toolchainDir: toolchain, platformTarget: "win32-x64", outputRoot: path.join(outputRoot, "candidate"),
  });
  const facts = {
    version: 1, platformTarget: "win32-x64", upstreamCommit: vendor.head,
    upstreamPinSha256: digest(await readFile(path.join(repo, "upstream.json"))),
    runtimeManifestSha256: digest(await readFile(packManifest)),
    toolchainClosureSha256: digest(await readFile(path.join(toolchain, "closure-manifest.json"))),
    buildInputs: {
      threeAssets: digest(await readFile(path.join(repo, "build-inputs/toolchain/three-assets/provenance.json"))),
      compilerReview: digest(await readFile(path.join(repo, "build-inputs/toolchain/compiler-review.json"))),
    },
    candidate: { relativePath: path.relative(outputRoot, candidate.target).split(path.sep).join("/"), inventory: candidate.inventory, packageBudget: candidate.packageBudget },
  };
  await writeFile(path.join(outputRoot, "production-candidate.json"), JSON.stringify(facts, null, 2) + "\n", { flag: "wx" });
  return { ...candidate, facts };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const flag = name => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1]; };
  const result = await buildProductionCandidate({ outputRoot: flag("output-root"), rocutRoot: flag("rocut"), surfaceDirectory: flag("surface-dir"), wasmPackageDirectory: flag("wasm-package-dir"), toolchainDir: flag("toolchain-dir") });
  const { entries, ...inventory } = result.facts.candidate.inventory;
  console.log(JSON.stringify({ target: result.target, ...result.facts, candidate: { ...result.facts.candidate, inventory } }));
}
