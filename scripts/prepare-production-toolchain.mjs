import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeToolchainSources } from "./toolchain-sources.mjs";
import { projectToolchainPrebuild } from "./toolchain-prebuild.mjs";
import { COMPILER_PROFILE } from "./toolchain-compiler-profile.mjs";
import { validateToolchainClosure } from "./toolchain-closure.mjs";
import { assertOrdinaryPath, assertDisjointDecoderPaths } from './offline-decoder-inputs.mjs';

const repo = fileURLToPath(new URL("../", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function copyRegular(source, target) {
  await mkdir(target);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "build input links forbidden");
    if (entry.isDirectory()) await copyRegular(path.join(source, entry.name), path.join(target, entry.name));
    else { assert(entry.isFile(), "ordinary build inputs required"); await copyFile(path.join(source, entry.name), path.join(target, entry.name)); }
  }
}
function install(directory, cache) {
  const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const result = spawnSync(process.execPath, [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache], {
    cwd: directory, windowsHide: true, encoding: "utf8", timeout: 240000, maxBuffer: 4 * 1024 ** 2,
  });
  assert.equal(result.status, 0, `isolated locked npm ci failed: ${result.stderr || result.stdout}`);
}

export async function validateProductionToolchainInputs(inputs) {
  await assertOrdinaryPath(inputs);
  for (const name of ['three-assets/provenance.json', 'hyperframes-remotion/package-lock.json', 'three/package-lock.json', 'license-evidence.json', 'compiler-review.json']) await assertOrdinaryPath(path.join(inputs, name), 'file');
  const provenance = JSON.parse(await readFile(path.join(inputs, "three-assets/provenance.json"), "utf8"));
  assert(/^[A-Za-z0-9._-]+$/.test(provenance.archive.file) && !['.', '..'].includes(provenance.archive.file), 'flat toolchain source archive name required');
  await assertOrdinaryPath(path.join(inputs, 'three-assets', provenance.archive.file), 'file');
  const archive = await readFile(path.join(inputs, "three-assets", provenance.archive.file));
  assert.equal(archive.length, provenance.archive.bytes, 'portable source archive size drift');
  assert.equal(digest(archive), provenance.archive.sha256, "portable source archive drift");
  assert.equal("sha512-" + createHash("sha512").update(archive).digest("base64"), provenance.archive.integrity);
  for (const name of ["hyperframes-remotion", "three"]) {
    await assertOrdinaryPath(path.join(inputs, name, 'package.json'), 'file');
    const manifest = JSON.parse(await readFile(path.join(inputs, name, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(path.join(inputs, name, "package-lock.json"), "utf8"));
    const root = lock.packages?.[''];
    assert(root && typeof root === 'object', `toolchain root lock metadata required: ${name}`);
    for (const key of ['name', 'version']) {
      assert.equal(root[key], manifest[key], `toolchain manifest/root lock ${key} mismatch: ${name}`);
      assert.equal(lock[key], manifest[key], `toolchain manifest/lock ${key} mismatch: ${name}`);
    }
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) assert.deepEqual(root[key] ?? {}, manifest[key] ?? {}, `toolchain manifest/root lock ${key} mismatch: ${name}`);
    for (const [key, pin] of Object.entries(lock.packages).filter(([key]) => key)) {
      if (key === "node_modules/@elftia/three-assets") {
        assert.equal(pin.resolved, `file:../three-assets/${provenance.archive.file}`);
        assert.equal(pin.integrity, provenance.archive.integrity);
      } else {
        assert(pin.resolved.startsWith("https://registry.npmjs.org/") && /^sha512-/.test(pin.integrity), `portable locked registry source required: ${key}`);
      }
    }
  }
  return provenance;
}

/** Fresh-clone recipe: registry SRI locks plus the committed source-bearing package archive. */
export async function prepareProductionToolchain(outputRoot, options = {}, ports = {}) {
  assert.equal(`${process.platform}-${process.arch}`, "win32-x64", "explicit win32-x64 production toolchain only");
  assert(typeof outputRoot === 'string' && path.isAbsolute(outputRoot), "absolute fresh output root required");
  // The repository port is for isolated tests, never a CLI-selected metadata source.
  const sourceRepo = ports.repoRoot ?? repo;
  const sourceInputs = path.join(sourceRepo, 'build-inputs/toolchain');
  await assertOrdinaryPath(path.dirname(outputRoot));
  assertDisjointDecoderPaths(outputRoot, sourceInputs);
  assert.notEqual(path.resolve(outputRoot), path.resolve(sourceRepo), 'cannot overwrite producer repository');
  await validateProductionToolchainInputs(sourceInputs);
  await mkdir(outputRoot);
  await assertOrdinaryPath(outputRoot);
  const inputs = path.join(outputRoot, 'inputs');
  await copyRegular(sourceInputs, inputs);
  // Recheck the copied snapshot in full before either npm invocation.
  const provenance = await validateProductionToolchainInputs(inputs);
  for (const name of ['hyperframes-remotion', 'three']) await (options.install ?? install)(path.join(inputs, name), path.join(outputRoot, 'npm-cache'));
  const evidence = JSON.parse(await readFile(path.join(inputs, "license-evidence.json"), "utf8"));
  const licenseEvidence = evidence.map(({ sourceUrl, ...pin }) => ({ ...pin, sourceFile: path.join(inputs, pin.sourceFile) }));
  const full = path.join(outputRoot, "full");
  await composeToolchainSources([
    { directory: path.join(inputs, "hyperframes-remotion"), engines: ["hyperframes", "remotion"], licenseEvidence },
    { directory: path.join(inputs, "three"), engines: ["three"] },
  ], full);
  const review = JSON.parse(await readFile(path.join(inputs, "compiler-review.json"), "utf8"));
  for (const pin of review.filePins) {
    const bytes = await readFile(path.join(full, pin.path));
    assert.equal(bytes.length, pin.size); assert.equal(digest(bytes), pin.sha256, `compiler reachability source drift: ${pin.path}`);
  }
  const target = path.join(outputRoot, "toolchain");
  await projectToolchainPrebuild(full, target, "win32-x64", {
    consumerProfile: COMPILER_PROFILE,
    reachabilityEvidence: { ...review, visited: review.filePins.map(pin => pin.path) },
  });
  const validated = await validateToolchainClosure(target);
  const facts = {
    version: 1, platform: "win32-x64", policy: COMPILER_PROFILE,
    threeAssets: provenance.archive,
    compilerReviewSha256: digest(await readFile(path.join(inputs, "compiler-review.json"))),
    sourceLocks: validated.closure.sourceLocks,
    closureSha256: digest(await readFile(path.join(target, "closure-manifest.json"))),
    fileCount: validated.closure.files.length,
  };
  await writeFile(path.join(outputRoot, "production-toolchain.json"), JSON.stringify(facts, null, 2) + "\n", { flag: "wx" });
  return { target, facts };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const index = process.argv.indexOf("--output-root");
  assert(index >= 0 && process.argv[index + 1], "--output-root <fresh absolute directory> required");
  const result = await prepareProductionToolchain(process.argv[index + 1]);
  console.log(JSON.stringify({ target: result.target, ...result.facts }));
}
