import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ownedTemp } from "./owned-temp.mjs";
import { sha256 } from "../scripts/dist-layout.mjs";
import { ENGINE_PACKAGES, copyToolchainClosure, validateToolchainClosure } from "../scripts/toolchain-closure.mjs";
import { normalizeDeliveryBytes, normalizeSelectedToolchain, refreshSelectedSurfaceManifest } from "../scripts/selected-delivery-bytes.mjs";
import { projectToolchainPrebuild } from "../scripts/toolchain-prebuild.mjs";
import { prepareSelectedSources } from "../scripts/selected-runtime.mjs";
import { validateSurfaceAssetManifest } from "../scripts/vendor-rocut.mjs";
import { verifyVendorAgainstProvenance } from "../scripts/provenance.mjs";
import { composeToolchainSources } from "../scripts/toolchain-sources.mjs";
import { COMPILER_PROFILE, OMITTED_PACKAGES, PROFILE_ENTRY_POINTS } from "../scripts/toolchain-compiler-profile.mjs";

test("selected byte normalization exactly follows SDK no-NUL CRLF law", () => {
  const text = Buffer.from([255, 13, 10, 128, 13, 65]);
  assert.deepEqual(normalizeDeliveryBytes(text), Buffer.from([255, 10, 128, 13, 65]));
  const binary = Buffer.from([0, 13, 10, 255]);
  assert.deepEqual(normalizeDeliveryBytes(binary), binary);
  assert.deepEqual(normalizeDeliveryBytes(Buffer.from("a\nb\r")), Buffer.from("a\nb\r"));
});

test("selected Surface inventory is refreshed from normalized delivery bytes before branding rewrite", async () => {
  const root = await ownedTemp("rocut-selected-surface-lf-");
  const original = Buffer.from("<svg>\r\n</svg>\r\n");
  const delivered = normalizeDeliveryBytes(original);
  await writeFile(path.join(root, "flag.svg"), delivered);
  await writeFile(path.join(root, "asset-manifest.json"), JSON.stringify({ files: [{ path: "flag.svg", category: "flags", bytes: original.length, sha256: sha256(original) }] }));
  await refreshSelectedSurfaceManifest(root);
  const manifest = JSON.parse(await readFile(path.join(root, "asset-manifest.json")));
  assert.equal(manifest.files[0].sha256, sha256(delivered));
  assert.equal(manifest.totalBytes, delivered.length);
});

async function fixture(project = false, compilerProfile = false) {
  const root = await ownedTemp("rocut-selected-toolchain-lf-"), source = path.join(root, "source");
  const engines = compilerProfile ? ["hyperframes", "remotion", "three"] : ["hyperframes"];
  const packages = Object.assign({}, ...engines.map(engine => ENGINE_PACKAGES[engine])), lock = { lockfileVersion: 3, packages: {} };
  if (compilerProfile) {
    for (const [relative, version] of Object.entries(OMITTED_PACKAGES)) packages[relative.slice("node_modules/".length)] = version;
    packages["@esbuild/win32-x64"] = "0.27.3";
  }
  for (const [name, version] of Object.entries(packages)) {
    const directory = path.join(source, "node_modules", name);
    await mkdir(directory, { recursive: true });
    const dependencies = !compilerProfile ? {} : name === "@hyperframes/core" ? { "@chenglou/pretext": "0.0.5", "@hyperframes/studio-server": "0.8.139", "bpm-detective": "2.0.5", wawoff2: "2.0.1" }
      : name === "@hyperframes/studio-server" ? { sharp: "0.35.5", hono: "4.13.13" }
      : name === "sharp" ? { "@img/colour": "1.1.0", "@img/sharp-win32-x64": "0.35.5", "detect-libc": "2.1.2", semver: "7.8.5" }
      : name === "wawoff2" ? { argparse: "2.0.1" } : name === "esbuild" ? { "@esbuild/win32-x64": "0.27.3" } : {};
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, version, license: "MIT", dependencies }));
    await writeFile(path.join(directory, "LICENSE"), "MIT\r\nnotice\r\n");
    lock.packages[`node_modules/${name}`] = { version, integrity: "sha512-AAAA", license: "MIT" };
  }
  const compiler = path.join(source, "node_modules/@hyperframes/core/dist/compiler");
  await mkdir(compiler, { recursive: true });
  await writeFile(path.join(compiler, "index.js"), "export {};\r\n");
  await writeFile(path.join(compiler, "binary.wasm"), Buffer.from([0, 13, 10, 42]));
  await writeFile(path.join(source, "package-lock.json"), JSON.stringify(lock) + "\r\n");
  const bundled = path.join(root, "bundled");
  if (compilerProfile) {
    for (const entry of [...PROFILE_ENTRY_POINTS, "node_modules/esbuild/lib/main.js", "node_modules/@esbuild/win32-x64/esbuild.exe"]) {
      await mkdir(path.dirname(path.join(source, entry)), { recursive: true }); await writeFile(path.join(source, entry), "fixture\r\n");
    }
    const notice = Buffer.from("supplemental upstream MIT notice\r\n");
    await writeFile(path.join(source, "node_modules/bpm-detective/NOTICE-upstream-README.md"), notice);
    await composeToolchainSources([{ directory: source, engines, licenseEvidence: [{ name: "bpm-detective", version: "2.0.5", license: "MIT", noticePath: "NOTICE-upstream-README.md", sha256: sha256(notice) }] }], bundled);
  } else await copyToolchainClosure(source, bundled, engines);
  const target = project ? path.join(root, "projected") : bundled;
  if (project) await projectToolchainPrebuild(bundled, target, "win32-x64", compilerProfile ? { consumerProfile: COMPILER_PROFILE, reachabilityEvidence: { visited: PROFILE_ENTRY_POINTS, edges: [], bareImports: [], nonLiteralDynamic: [] } } : {});
  const originalBytes = await readFile(path.join(target, "closure-manifest.json"));
  const original = await validateToolchainClosure(target);
  await normalizeSelectedToolchain(target, original);
  return { root, source, target, original, originalBytes };
}

test("delivery closure pins match LF bytes while source provenance retains exact original bytes", async () => {
  const f = await fixture(), result = await validateToolchainClosure(f.target);
  const evidence = JSON.parse(await readFile(path.join(f.target, "lf-normalization.json")));
  assert.deepEqual(Buffer.from(evidence.sourceClosure.bytesBase64, "base64"), f.originalBytes);
  assert.equal(evidence.changes.length, 4);
  assert.equal(await readFile(path.join(f.target, "node_modules/acorn/LICENSE"), "utf8"), "MIT\nnotice\n");
  assert.equal(await readFile(path.join(f.source, "node_modules/acorn/LICENSE"), "utf8"), "MIT\r\nnotice\r\n");
  const pin = result.closure.files.find(file => file.path === "node_modules/acorn/LICENSE");
  assert.equal(pin.sha256, sha256(Buffer.from("MIT\nnotice\n")));
  assert.notEqual(pin.sha256, f.original.closure.files.find(file => file.path === pin.path).sha256);
  assert.deepEqual(await readFile(path.join(f.target, "node_modules/@hyperframes/core/dist/compiler/binary.wasm")), Buffer.from([0, 13, 10, 42]));
  await copyToolchainClosure(f.target, path.join(f.root, "copy"));
});

test("tampered normalization source bytes are rejected even after restamping the evidence hash", async () => {
  const f = await fixture(), evidencePath = path.join(f.target, "lf-normalization.json");
  const evidence = JSON.parse(await readFile(evidencePath));
  evidence.changes[0].sourceBytesBase64 = Buffer.from("forged\r\n").toString("base64");
  evidence.changes[0].sourceSha256 = sha256(Buffer.from("forged\r\n"));
  const bytes = Buffer.from(JSON.stringify(evidence) + "\n");
  await writeFile(evidencePath, bytes);
  const manifestPath = path.join(f.target, "closure-manifest.json"), closure = JSON.parse(await readFile(manifestPath));
  closure.deliveryNormalization.evidenceSha256 = sha256(bytes);
  await writeFile(manifestPath, JSON.stringify(closure) + "\n");
  await assert.rejects(validateToolchainClosure(f.target), /LF delivery bytes mismatch/);
});

test("LF delivery retains source projection evidence and validates the original full closure", { skip: process.platform !== "win32" || process.arch !== "x64" }, async () => {
  const f = await fixture(true);
  const result = await validateToolchainClosure(f.target);
  assert(result.closure.projection);
  assert(result.closure.deliveryNormalization);
  const original = JSON.parse(f.originalBytes);
  assert.deepEqual(original.projection, result.closure.projection);
  await copyToolchainClosure(f.target, path.join(f.root, "projected-copy"));
});

test("compiler omission retains exact supplemental notice provenance without requiring omitted bytes", { skip: process.platform !== "win32" || process.arch !== "x64" }, async () => {
  const f = await fixture(true, true), result = await validateToolchainClosure(f.target);
  assert.deepEqual(result.closure.licenseEvidence, f.original.closure.licenseEvidence);
  const proof = result.closure.licenseEvidence.find(file => file.name === "bpm-detective");
  assert(result.closure.consumerProfile.omittedPackages.some(pkg => pkg.name === proof.name && pkg.version === proof.version && pkg.files.some(pin => pin.sha256 === proof.sha256)));
  assert(!result.closure.files.some(file => file.path.startsWith("node_modules/bpm-detective/")));
  await copyToolchainClosure(f.target, path.join(f.root, "profile-copy"));
  const closurePath = path.join(f.target, "closure-manifest.json"), closure = JSON.parse(await readFile(closurePath));
  closure.licenseEvidence[0].sha256 = "0".repeat(64);
  await writeFile(closurePath, JSON.stringify(closure) + "\n");
  await assert.rejects(validateToolchainClosure(f.target), /LF delivery closure projection mismatch/);
  const copy = path.join(f.root, "profile-copy"), evidencePath = path.join(copy, "lf-normalization.json");
  const evidence = JSON.parse(await readFile(evidencePath));
  const sourceClosure = JSON.parse(Buffer.from(evidence.sourceClosure.bytesBase64, "base64"));
  sourceClosure.licenseEvidence[0].sha256 = "0".repeat(64);
  const sourceBytes = Buffer.from(JSON.stringify(sourceClosure));
  evidence.sourceClosure = { sha256: sha256(sourceBytes), bytesBase64: sourceBytes.toString("base64") };
  const evidenceBytes = Buffer.from(JSON.stringify(evidence) + "\n");
  await writeFile(evidencePath, evidenceBytes);
  const copiedClosurePath = path.join(copy, "closure-manifest.json"), copiedClosure = JSON.parse(await readFile(copiedClosurePath));
  copiedClosure.licenseEvidence[0].sha256 = "0".repeat(64);
  copiedClosure.deliveryNormalization.evidenceSha256 = sha256(evidenceBytes);
  await writeFile(copiedClosurePath, JSON.stringify(copiedClosure) + "\n");
  await assert.rejects(validateToolchainClosure(copy), /omitted notice source pin mismatch/);
});

test("selected producer normalizes before Surface and vendor manifests and distinguishes input pins", async () => {
  const root = await ownedTemp("rocut-selected-production-lf-"), repo = path.join(root, "producer");
  for (const [relative, content] of Object.entries({
    "elftia-plugin.json": "{}\r\n", "main/index.cjs": "module.exports = {};\r\n",
    "skills/rocut-studio/SKILL.md": "# Skill\r\n", "skills/rocut-studio/references/agent-editing.md": "Edit\r\n",
    "skills/rocut-studio/references/media-import.md": "Import\r\n", "vendor/LICENSE": "MIT\r\n",
    "licenses/NOTICE.md": "Notices\r\n", "licenses/branding-placeholder.svg": "<svg/>\r\n",
  })) { await mkdir(path.dirname(path.join(repo, relative)), { recursive: true }); await writeFile(path.join(repo, relative), content); }
  const runtimeDir = path.join(root, "runtime"), surfaceDir = path.join(root, "surface");
  await mkdir(runtimeDir); await mkdir(surfaceDir);
  const files = [];
  for (const [name, bytes] of [["rocut.mjs", Buffer.from("export {};\r\n")], ["opencut_wasm_bg.wasm", Buffer.from([0, 13, 10])]]) {
    await writeFile(path.join(runtimeDir, name), bytes); files.push({ path: name, sizeBytes: bytes.length, sha256: sha256(bytes) });
  }
  const flag = Buffer.from("<svg>\r\n</svg>\r\n");
  await writeFile(path.join(surfaceDir, "flag.svg"), flag);
  await writeFile(path.join(surfaceDir, "index.html"), "<!doctype html>\r\n");
  await writeFile(path.join(surfaceDir, "asset-manifest.json"), JSON.stringify({ fileCount: 1, totalBytes: flag.length, files: [{ path: "flag.svg", category: "flags", bytes: flag.length, sha256: sha256(flag) }] }));
  const packManifest = path.join(root, "pack.json"); await writeFile(packManifest, JSON.stringify({ files }));
  const selected = await prepareSelectedSources(repo, { runtimeDir, surfaceDir, packManifest, outputRoot: path.join(root, "output") });
  const vendor = path.join(selected.sourceRoot, "vendor"), manifest = JSON.parse(await readFile(path.join(vendor, "surface/asset-manifest.json")));
  await validateSurfaceAssetManifest(path.join(vendor, "surface"), manifest);
  await verifyVendorAgainstProvenance(vendor);
  const pin = selected.facts.sourcePins.find(pin => pin.path === "main/index.cjs");
  assert.notEqual(pin.sourceSha256, pin.deliveredSha256);
  assert.equal(pin.sourceSha256, sha256(await readFile(path.join(repo, pin.path))));
  assert.equal(pin.deliveredSha256, sha256(await readFile(path.join(selected.sourceRoot, pin.path))));
  assert.equal(manifest.files[0].sha256, sha256(normalizeDeliveryBytes(flag)));
});
