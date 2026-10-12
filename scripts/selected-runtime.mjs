import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, mkdtemp, lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { RUN_FILE_PATTERN, inventoryRegularTree, sha256, ARTIFACT_MAPPING } from "./dist-layout.mjs";
import { inventoryVendorTree } from "./provenance.mjs";
import { rewriteAssetManifest, assertMotionTextFontNotice, validateSurfaceAssetManifest } from "./vendor-rocut.mjs";
import { copyToolchainClosure, validateToolchainClosure } from "./toolchain-closure.mjs";
import { composeToolchainSources } from "./toolchain-sources.mjs";
import { projectToolchainPrebuild } from "./toolchain-prebuild.mjs";

export async function inspectSelectedRuntime(runtimeDir, manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const inventory = await inventoryRegularTree(runtimeDir, "selected runtime");
  const expected = manifest.files;
  assert(Array.isArray(expected), "pack manifest files required");
  const runtime = inventory.entries.filter(entry => !entry.path.startsWith("surface/") && entry.path !== "PROVENANCE.md");
  for (const entry of runtime) {
    assert(RUN_FILE_PATTERN.test(entry.path), `unexpected runtime file: ${entry.path}`);
    const pin = expected.find(file => file.path === entry.path);
    assert(pin && pin.sha256 === entry.sha256 && pin.sizeBytes === entry.size, `runtime manifest mismatch: ${entry.path}`);
  }
  const declared = expected.filter(file => !file.path.startsWith("surface/") && file.path !== "PROVENANCE.md");
  assert.deepEqual(runtime.map(e => e.path).sort(), declared.map(e => e.path).sort(), "runtime closure differs from pack manifest");
  for (const required of ["rocut.mjs", "opencut_wasm_bg.wasm"]) assert(runtime.some(e => e.path === required), `missing ${required}`);
  for (const prefix of ["liquid-object", "particle-sampler"]) {
    const pair = [`${prefix}-wasm.mjs`, `${prefix}-worker-entry.mjs`];
    assert(pair.every(name => runtime.some(e => e.path === name)) || pair.every(name => !runtime.some(e => e.path === name)), `incomplete ${prefix} worker closure`);
  }
  return { manifest, inventory, runtime };
}

export async function prepareSelectedSources(repoRoot, options) {
  if (options.toolchainDir || options.toolchainSources) assert.equal(options.platformTarget, "win32-x64", "toolchain delivery requires explicit local platformTarget win32-x64");
  else assert(options.platformTarget === undefined, "platformTarget requires a toolchain");
  assert(options.outputRoot && path.isAbsolute(options.outputRoot), "selected artifact build requires explicit absolute outputRoot");
  assert(path.isAbsolute(options.runtimeDir) && path.isAbsolute(options.surfaceDir) && path.isAbsolute(options.packManifest), "selected inputs must be explicit absolute paths");
  assert(path.resolve(options.outputRoot) !== path.resolve(repoRoot), "selected output must not overwrite producer repository");
  const selected = await inspectSelectedRuntime(options.runtimeDir, options.packManifest);
  const surface = await inventoryRegularTree(options.surfaceDir, "selected surface");
  await validateSurfaceAssetManifest(options.surfaceDir, JSON.parse(await readFile(path.join(options.surfaceDir, "asset-manifest.json"), "utf8")));
  const parent = path.resolve(options.outputRoot);
  await mkdir(parent);
  assert((await lstat(parent)).isDirectory() && !(await lstat(parent)).isSymbolicLink(), "outputRoot must be an ordinary fresh directory");
  assert(path.resolve(await realpath(parent)).toLowerCase() === parent.toLowerCase(), "redirected outputRoot rejected");
  const sourceRoot = await mkdtemp(path.join(parent, "selected-source-"));
  const copy = async (source, target, expectedHash) => {
    const state = await lstat(source);
    assert(state.isFile() && !state.isSymbolicLink(), `selected source must be a regular file: ${source}`);
    const bytes = await readFile(source);
    if (expectedHash) assert.equal(sha256(bytes), expectedHash, `selected source drift: ${source}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
  };
  const realRepoRoot = await realpath(repoRoot);
  const sourcePins = [];
  for (const rule of ARTIFACT_MAPPING.filter(rule => !rule.source.startsWith("vendor/") && !rule.source.startsWith("prebuilds/"))) {
    const source = path.join(repoRoot, rule.source);
    const relative = path.relative(realRepoRoot, await realpath(source));
    assert(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `source artifact escapes producer: ${rule.source}`);
    await copy(source, path.join(sourceRoot, rule.source));
    sourcePins.push({ path: rule.source, sha256: sha256(await readFile(path.join(sourceRoot, rule.source))) });
  }
  let manifestProjection = null;
  if (options.platformTarget) {
    const manifestPath = path.join(sourceRoot, "elftia-plugin.json"), bytes = await readFile(manifestPath);
    const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    manifest.supportedPlatforms = [options.platformTarget];
    const projected = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(manifestPath, projected);
    manifestProjection = { scope: "explicit-local-platform-candidate-not-cross-platform-release", supportedPlatforms: manifest.supportedPlatforms, originalSha256: sha256(bytes), projectedSha256: sha256(projected) };
  }
  const vendor = path.join(sourceRoot, "vendor");
  for (const entry of selected.runtime) await copy(path.join(options.runtimeDir, entry.path), path.join(vendor, "run", entry.path), entry.sha256);
  for (const entry of surface.entries) if (!entry.path.startsWith("logos/")) await copy(path.join(options.surfaceDir, entry.path), path.join(vendor, "surface", entry.path), entry.sha256);
  const placeholder = await readFile(path.join(repoRoot, "licenses", "branding-placeholder.svg"));
  await mkdir(path.join(vendor, "surface", "logos", "opencut", "svg"), { recursive: true });
  await writeFile(path.join(vendor, "surface", "logos", "opencut", "svg", "logo.svg"), placeholder);
  const rewritten = await rewriteAssetManifest(path.join(vendor, "surface"), placeholder);
  const notice = await readFile(path.join(repoRoot, "licenses", "NOTICE.md"));
  assertMotionTextFontNotice(rewritten.manifest, notice.toString("utf8"));
  await copy(path.join(repoRoot, "vendor", "LICENSE"), path.join(vendor, "LICENSE"));
  await writeFile(path.join(vendor, "NOTICE.md"), notice);
  assert(!(options.toolchainDir && options.toolchainSources), "choose toolchainDir or toolchainSources");
  let toolchain = null;
  if (options.toolchainDir || options.toolchainSources) {
    const prebuildParent = path.join(sourceRoot, "prebuilds", options.platformTarget);
    await mkdir(prebuildParent, { recursive: true });
    let input = options.toolchainDir, scratch = null, scratchState = null;
    try {
      if (options.toolchainSources) {
        scratch = await mkdtemp(path.join(parent, "toolchain-composition-"));
        scratchState = await lstat(scratch, { bigint: true }); input = path.join(scratch, "toolchain");
        await composeToolchainSources(options.toolchainSources, input);
      }
      const validated = await validateToolchainClosure(input);
      if (options.toolchainEngines) assert.deepEqual(options.toolchainEngines, validated.marker.engines, "toolchain engines cannot be relabeled");
      toolchain = validated.closure.projection
        ? await copyToolchainClosure(input, path.join(prebuildParent, "toolchain"))
        : await projectToolchainPrebuild(input, path.join(prebuildParent, "toolchain"), options.platformTarget);
    } finally {
      if (scratch) {
        const current = await lstat(scratch, { bigint: true });
        assert(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, scratchState.dev); assert.equal(current.ino, scratchState.ino);
        assert.equal((await realpath(scratch)).toLowerCase(), path.resolve(scratch).toLowerCase());
        await rm(scratch, { recursive: true, force: true });
      }
    }
  }
  const entries = await inventoryVendorTree(vendor);
  const facts = { mode: "explicit-selected-production-artifacts-not-pin-only", repoHead: selected.manifest.repoHead, dirty: selected.manifest.dirty, sourcePins, manifestProjection, runtimeManifestSha256: sha256(await readFile(options.packManifest)), runtime: selected.runtime, surfaceInput: surface.entries, brandingSubstitution: sha256(placeholder), surfaceManifestRewrite: rewritten, toolchain };
  await writeFile(path.join(vendor, "PROVENANCE.md"), `# Selected production artifact provenance\n\nNot a pin-only source build. Current producer manifest/main/skills and explicitly selected production runtime/Surface; the unchanged upstream.json default pin is not claimed to reproduce these bytes.\n\n${JSON.stringify(facts, null, 2)}\n\n## SHA-256 manifest\n\n${entries.length} files.\n\n\`\`\`\n${entries.map(e => `${e.sha256}  ${e.path}`).join("\n")}\n\`\`\`\n`);
  return { sourceRoot, facts };
}
