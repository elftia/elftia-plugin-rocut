import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECTION_POLICY, CI_VCS_SEGMENTS, isProjectedRemoval } from "./toolchain-projection-policy.mjs";
import { assertCompilerProfile, isCompilerOmission, maySkipCompilerDependency, ownsFile, PROFILE_ENTRY_POINTS } from "./toolchain-compiler-profile.mjs";

export const ENGINE_PACKAGES = Object.freeze({
  hyperframes: { "@hyperframes/core": "0.8.139", acorn: "8.19.0" },
  remotion: { remotion: "4.0.440", react: "18.3.1", "react-dom": "18.3.1", esbuild: "0.27.3" },
  three: { three: "0.185.1", "@elftia/three-assets": "0.1.1", "@noble/hashes": "2.0.1", esbuild: "0.27.3" },
});
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async p => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(p)));
const safe = value => typeof value === "string" && value !== "" && !value.includes("\\") && !path.posix.isAbsolute(value) && !value.split("/").some(part => part === ".." || part === "." || part === "");

async function ordinary(p, directory) {
  const state = await lstat(p);
  assert(!state.isSymbolicLink() && (directory ? state.isDirectory() : state.isFile()), `toolchain ordinary ${directory ? "directory" : "file"} required: ${p}`);
  assert.equal((await realpath(p)).toLowerCase(), path.resolve(p).toLowerCase(), `toolchain redirected path: ${p}`);
}
async function files(root, prefix = "", skipNestedModules = false) {
  await ordinary(root, true);
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), `toolchain symlink forbidden: ${entry.name}`);
    if (skipNestedModules && entry.name === "node_modules") continue;
    const p = path.join(root, entry.name), relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(p, relative + "/", skipNestedModules));
    else { await ordinary(p, false); const bytes = await readFile(p); result.push({ path: relative, size: bytes.length, sha256: digest(bytes) }); }
  }
  return result.sort((a,b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
function resolveDependency(lock, owner, name) {
  assert(/^(@[^/]+\/)?[^/]+$/.test(name), `invalid package name: ${name}`);
  for (let directory = owner;; directory = path.posix.dirname(directory)) {
    const candidate = (directory === "." ? "" : directory + "/") + "node_modules/" + name;
    if (lock.packages[candidate]) return candidate;
    if (directory === ".") return null;
  }
}

export async function inspectToolchainSource(directory, engines = Object.keys(ENGINE_PACKAGES), licenseEvidence = [], consumerProfile = null) {
  await ordinary(directory, true);
  assert(Array.isArray(engines) && engines.length > 0 && new Set(engines).size === engines.length && engines.every(e => Object.hasOwn(ENGINE_PACKAGES, e)), "known unique toolchain engines required");
  const lockBytes = await readFile(path.join(directory, "package-lock.json")), lock = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(lockBytes));
  assert(lock.packages && lock.lockfileVersion >= 2, "toolchain npm package-lock packages required");
  const required = Object.assign({}, ...engines.map(e => ENGINE_PACKAGES[e]));
  assert(Array.isArray(licenseEvidence), "license evidence array required");
  if (consumerProfile) assertCompilerProfile(consumerProfile);
  const activeEvidence = consumerProfile ? licenseEvidence.filter(e => !isCompilerOmission(`node_modules/${e.name}`, e.version)) : licenseEvidence;
  const usedEvidence = [], supplementalFiles = [];
  const pending = Object.keys(required).map(name => `node_modules/${name}`), selected = new Map();
  while (pending.length) {
    const relative = pending.shift();
    if (selected.has(relative)) continue;
    assert(safe(relative) && relative.startsWith("node_modules/"), "unsafe toolchain package path");
    const locked = lock.packages[relative];
    assert(locked && !locked.link && typeof locked.integrity === "string" && /^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/.test(locked.integrity), `locked integrity required: ${relative}`);
    const packageRoot = path.join(directory, ...relative.split("/"));
    await ordinary(packageRoot, true);
    const manifest = await json(path.join(packageRoot, "package.json"));
    assert.equal(manifest.name, relative.split("node_modules/").at(-1), `toolchain package name mismatch: ${relative}`);
    assert.equal(manifest.version, locked.version, `toolchain manifest/lock version mismatch: ${relative}`);
    if (relative === `node_modules/${manifest.name}` && required[manifest.name]) assert.equal(manifest.version, required[manifest.name], `toolchain engine version mismatch: ${manifest.name}`);
    const evidence = activeEvidence.filter(e => e.name === manifest.name && e.version === manifest.version);
    assert(evidence.length <= 1, `duplicate license evidence: ${relative}`);
    const proof = evidence[0];
    if (proof) {
      assert(typeof proof.license === "string" && proof.license.length && safe(proof.noticePath) && /^(?:licen[cs]e|copying|notice)(?:[.\-_]|$)/i.test(proof.noticePath) && /^[a-f0-9]{64}$/.test(proof.sha256), `invalid license evidence: ${relative}`);
      if (manifest.license !== undefined) assert.equal(proof.license, manifest.license, `license evidence label mismatch: ${relative}`);
      const noticeSource = proof.sourceFile ?? path.join(packageRoot, ...proof.noticePath.split("/"));
      await ordinary(noticeSource, false);
      const bytes = await readFile(noticeSource);
      assert.equal(digest(bytes), proof.sha256, `license evidence digest mismatch: ${relative}`);
      usedEvidence.push({ name: proof.name, version: proof.version, license: proof.license, noticePath: proof.noticePath, sha256: proof.sha256 });
      if (proof.sourceFile) supplementalFiles.push({ path: `${relative}/${proof.noticePath}`, sourceFile: proof.sourceFile, size: bytes.length, sha256: proof.sha256 });
    }
    const license = manifest.license ?? proof?.license;
    assert(typeof license === "string" && license.length > 0, `toolchain license metadata required: ${relative}`);
    if (locked.license !== undefined) assert.equal(manifest.license, locked.license, `toolchain manifest/lock license mismatch: ${relative}`);
    const inventory = await files(packageRoot, relative + "/", true);
    for (const supplement of supplementalFiles.filter(f => f.path.startsWith(relative + "/"))) {
      const existing = inventory.find(f => f.path === supplement.path);
      assert(!existing || (existing.sha256 === supplement.sha256 && existing.size === supplement.size), `supplemental notice conflict: ${relative}`);
      if (!existing) inventory.push({ path: supplement.path, size: supplement.size, sha256: supplement.sha256 });
    }
    inventory.sort((a,b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    const hasNotice = inventory.some(e => /\/(?:licen[cs]e|copying|notice)(?:[.\-_]|$)/i.test(e.path));
    const licenseNoticePackage = !hasNotice && manifest.name.startsWith("@esbuild/") ? "esbuild" : null;
    assert(hasNotice || licenseNoticePackage, `toolchain license notice file required: ${relative}`);
    selected.set(relative, { path: relative, name: manifest.name, version: manifest.version, integrity: locked.integrity, license, licenseNoticePackage, files: inventory });
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
      const dependency = resolveDependency(lock, relative, name);
      if (!dependency) { assert(Object.hasOwn(manifest.optionalDependencies ?? {}, name), `toolchain dependency lock missing: ${name}`); continue; }
      if (consumerProfile && maySkipCompilerDependency(relative, name, dependency, lock.packages[dependency].version)) continue;
      try { await lstat(path.join(directory, ...dependency.split("/"))); } catch (error) { if (error.code === "ENOENT" && Object.hasOwn(manifest.optionalDependencies ?? {}, name)) continue; throw error; }
      pending.push(dependency);
    }
    for (const name of Object.keys(manifest.peerDependencies ?? {})) {
      const dependency = resolveDependency(lock, relative, name);
      if (!dependency && manifest.peerDependenciesMeta?.[name]?.optional) continue;
      assert(dependency, `toolchain peer dependency missing: ${name}`); pending.push(dependency);
    }
  }
  const packages = [...selected.values()].sort((a,b) => a.path.localeCompare(b.path));
  for (const p of packages) if (p.licenseNoticePackage) assert(packages.some(n => n.name === p.licenseNoticePackage && n.version === p.version && n.license === p.license && !n.licenseNoticePackage), `toolchain inherited license missing: ${p.path}`);
  for (const engine of engines) {
    const entry = engine === "hyperframes" ? "node_modules/@hyperframes/core/dist/compiler/index.js" : "node_modules/esbuild/lib/main.js";
    assert(packages.some(p => p.files.some(f => f.path === entry)), `toolchain compiler entry missing: ${engine}`);
  }
  if (engines.includes("three")) assert.equal(Object.keys(lock.packages).filter(p => p.endsWith("/node_modules/three") || p === "node_modules/three").length, 1, "toolchain must lock exactly one Three runtime");
  if (required.esbuild) {
    const platform = `@esbuild/${process.platform}-${process.arch}`;
    const executable = process.platform === "win32" ? "esbuild.exe" : "bin/esbuild";
    assert(packages.some(p => p.name === platform && p.version === required.esbuild && p.files.some(f => f.path === `${p.path}/${executable}`)), `toolchain platform compiler missing: ${platform}`);
  }
  assert.equal(usedEvidence.length, activeEvidence.length, "unused or incorrectly pinned license evidence");
  return { engines: [...engines], lockBytes, packageLockSha256: digest(lockBytes), packages, licenseEvidence: usedEvidence, supplementalFiles, files: packages.flatMap(p => p.files).sort((a,b) => a.path.localeCompare(b.path)) };
}

export async function copyToolchainClosure(directory, target, engines) {
  let bundled = false;
  try { await lstat(path.join(directory, "rocut-engine-toolchain.json")); bundled = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (bundled) return copyValidatedClosure(directory, target, engines);
  const source = await inspectToolchainSource(directory, engines);
  await mkdir(target); await ordinary(target, true);
  const state = await lstat(target, { bigint: true });
  const revalidate = async () => { await ordinary(target, true); const current = await lstat(target, { bigint: true }); assert.equal(current.dev, state.dev); assert.equal(current.ino, state.ino); };
  for (const entry of source.files) {
    await revalidate(); const from = path.join(directory, ...entry.path.split("/")), to = path.join(target, ...entry.path.split("/"));
    const bytes = await readFile(from); assert.equal(digest(bytes), entry.sha256, `toolchain source drift: ${entry.path}`);
    await mkdir(path.dirname(to), { recursive: true }); await copyFile(from, to);
  }
  await revalidate();
  await writeFile(path.join(target, "package-lock.json"), source.lockBytes, { flag: "wx" });
  await writeFile(path.join(target, "rocut-engine-toolchain.json"), JSON.stringify({ version: 1, kind: "rocut-engine-toolchain", engines: source.engines }) + "\n", { flag: "wx" });
  const closure = { version: 1, packageLockSha256: source.packageLockSha256, packages: source.packages.map(({ files: ignored, ...p }) => p), files: source.files };
  await writeFile(path.join(target, "closure-manifest.json"), JSON.stringify(closure, null, 2) + "\n", { flag: "wx" });
  await validateToolchainClosure(target);
  return closure;
}

async function copyValidatedClosure(directory, target, engines) {
  const validated = await validateToolchainClosure(directory);
  if (engines !== undefined) assert.deepEqual(engines, validated.marker.engines, "validated toolchain engines cannot be relabeled");
  const inventory = await files(directory);
  const parent = path.dirname(target);
  await ordinary(parent, true);
  const parentState = await lstat(parent, { bigint: true });
  await mkdir(target); await ordinary(target, true);
  const targetState = await lstat(target, { bigint: true });
  const guard = async (p, state) => {
    await ordinary(p, true); const current = await lstat(p, { bigint: true });
    assert.equal(current.dev, state.dev); assert.equal(current.ino, state.ino);
  };
  for (const pin of inventory) {
    await guard(parent, parentState); await guard(target, targetState);
    const source = path.join(directory, ...pin.path.split("/"));
    await ordinary(source, false);
    const bytes = await readFile(source);
    assert.equal(bytes.length, pin.size); assert.equal(digest(bytes), pin.sha256, `validated toolchain source drift: ${pin.path}`);
    const destination = path.join(target, ...pin.path.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await ordinary(path.dirname(destination), true);
    const destinationState = await lstat(path.dirname(destination), { bigint: true });
    await guard(parent, parentState); await guard(target, targetState); await guard(path.dirname(destination), destinationState);
    await writeFile(destination, bytes, { flag: "wx" });
  }
  const copied = await validateToolchainClosure(target);
  assert.deepEqual(copied.closure, validated.closure, "validated toolchain closure changed during copy");
  return copied.closure;
}

export async function validateToolchainClosure(directory) {
  const marker = await json(path.join(directory, "rocut-engine-toolchain.json"));
  assert.deepEqual(Object.keys(marker).sort(), ["engines", "kind", "version"]);
  assert(marker.version === 1 && marker.kind === "rocut-engine-toolchain", "invalid toolchain marker");
  const closure = await json(path.join(directory, "closure-manifest.json"));
  const inspected = await inspectToolchainSource(directory, marker.engines, closure.licenseEvidence ?? [], closure.consumerProfile?.id);
  assert.equal(closure.version, 1, "invalid toolchain closure version");
  assert.equal(closure.packageLockSha256, inspected.packageLockSha256, "toolchain lock digest mismatch");
  assert.deepEqual(closure.packages, inspected.packages.map(({ files: ignored, ...p }) => p), "toolchain package metadata mismatch");
  assert.deepEqual(closure.files, inspected.files, "toolchain package file pins mismatch");
  const actual = await files(directory);
  const sourceLocks = closure.sourceLocks ?? [];
  const originalLocks = new Map();
  for (const pin of sourceLocks) {
    assert(safe(pin.path) && pin.path.startsWith("source-locks/"), "invalid source lock path");
    assert.equal(digest(await readFile(path.join(directory, ...pin.path.split("/")))), pin.sha256, "source lock digest mismatch");
    originalLocks.set(pin.path, await json(path.join(directory, ...pin.path.split("/"))));
  }
  if (sourceLocks.length) {
    const merged = await json(path.join(directory, "package-lock.json"));
    const ancestryPaths = [...inspected.packages.map(p => p.path), ...(closure.consumerProfile?.omittedPackages.map(p => p.path) ?? [])];
    assert.deepEqual(closure.packageSources.map(p => p.path).sort(), ancestryPaths.sort(), "package source provenance incomplete");
    for (const pin of closure.packageSources) {
      assert(pin.sourceLocks.length > 0 && new Set(pin.sourceLocks).size === pin.sourceLocks.length, "package source locks required");
      for (const source of pin.sourceLocks) assert.deepEqual(originalLocks.get(source)?.packages?.[pin.path], merged.packages[pin.path], `package source lock mismatch: ${pin.path}`);
    }
  }
  if (closure.projection) {
    const projection = closure.projection;
    assert(["runtime-without-types-and-source-maps-v1", PROJECTION_POLICY].includes(projection.policy), "unknown toolchain projection policy");
    if (projection.policy === PROJECTION_POLICY) assert.deepEqual(projection.ciVcsSegments, CI_VCS_SEGMENTS, "CI/VCS projection must match SDK forbidden segments");
    assert.equal(projection.platformTarget, "win32-x64", "unknown projected platform target");
    assert.equal(projection.sourceClosurePath, "source-closure-manifest.json");
    const originalBytes = await readFile(path.join(directory, projection.sourceClosurePath));
    assert.equal(digest(originalBytes), projection.sourceClosureSha256, "source closure digest mismatch");
    const original = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(originalBytes));
    assert(!original.projection, "projection source must be complete");
    if (closure.consumerProfile) {
      const profile = closure.consumerProfile;
      assertCompilerProfile(profile.id);
      assert.equal(profile.packageClosureComplete, false, "compiler profile cannot claim complete npm installation");
      const omitted = original.packages.filter(p => isCompilerOmission(p.path, p.version));
      assert.equal(omitted.length, 11, "compiler profile requires exact reviewed source packages");
      assert.deepEqual(profile.omittedPackages, omitted.map(p => ({ ...p, reason: "not-reachable-from-reviewed-rocut-compiler-entrypoints", files: original.files.filter(f => ownsFile(p.path, f.path)) })), "compiler omitted package pins mismatch");
      assert.deepEqual(original.packages.filter(p => !omitted.some(o => o.path === p.path)), closure.packages, "compiler profile changed retained package metadata");
      assert.equal(profile.evidencePath, "compiler-profile-evidence.json");
      const evidenceBytes = await readFile(path.join(directory, profile.evidencePath));
      assert.equal(digest(evidenceBytes), profile.evidenceSha256, "compiler evidence digest mismatch");
      const evidence = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(evidenceBytes));
      assert.deepEqual(evidence.nonLiteralDynamic, [], "compiler evidence has unresolved dynamic imports");
      for (const required of PROFILE_ENTRY_POINTS) assert(evidence.filePins.some(f => f.path === required), `compiler evidence entry missing: ${required}`);
      for (const pin of evidence.filePins) {
        assert.deepEqual(pin, original.files.find(f => f.path === pin.path), "compiler evidence source pin mismatch");
        assert(closure.files.some(f => f.path === pin.path), "compiler evidence runtime file omitted");
      }
      assert(evidence.edges.every(e => !omitted.some(p => ownsFile(p.path, e.to))), "compiler evidence reaches omitted package");
    } else assert.deepEqual(original.packages, closure.packages, "projection package metadata changed");
    for (const key of ["packageLockSha256", "sourceLocks", "packageSources", "licenseEvidence"]) assert.deepEqual(original[key], closure[key], `projection ${key} changed`);
    assert(projection.removedFiles.every(f => isProjectedRemoval(f.path, projection.policy) || closure.consumerProfile?.omittedPackages.some(p => ownsFile(p.path, f.path))), "projection removed runtime file");
    assert.equal(projection.originalFileCount, original.files.length);
    assert.equal(projection.retainedFileCount, closure.files.length);
    const reconstructed = [...closure.files, ...projection.removedFiles].sort((a,b) => a.path.localeCompare(b.path));
    assert.deepEqual(reconstructed, original.files, "projection lost or changed original file pins");
  }
  assert(!closure.consumerProfile || closure.projection, "compiler profile requires full source projection evidence");
  const allowed = new Set([...closure.files.map(e => e.path), ...sourceLocks.map(e => e.path), ...(closure.projection ? ["source-closure-manifest.json"] : []), ...(closure.consumerProfile ? ["compiler-profile-evidence.json"] : []), "package-lock.json", "closure-manifest.json", "rocut-engine-toolchain.json"]);
  assert(actual.every(e => allowed.has(e.path)) && actual.length === allowed.size, "undeclared toolchain file or missing closure file");
  return { marker, closure, fileCount: actual.length, bytes: actual.reduce((n,e) => n + e.size, 0) };
}
