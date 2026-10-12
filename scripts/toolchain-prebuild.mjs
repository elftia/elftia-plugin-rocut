import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectToolchainSource, validateToolchainClosure } from "./toolchain-closure.mjs";
import { PROJECTION_POLICY, CI_VCS_SEGMENTS, isNonRuntimeToolchainFile, isProjectedRemoval } from "./toolchain-projection-policy.mjs";
import { COMPILER_PROFILE, assertCompilerProfile, isCompilerOmission, ownsFile, PROFILE_ENTRY_POINTS } from "./toolchain-compiler-profile.mjs";

export { PROJECTION_POLICY, isNonRuntimeToolchainFile };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function guard(directory) {
  const state = await lstat(directory, { bigint: true });
  assert(state.isDirectory() && !state.isSymbolicLink(), "prebuild ordinary directory required");
  assert.equal((await realpath(directory)).toLowerCase(), path.resolve(directory).toLowerCase(), "prebuild redirected directory");
  return async () => {
    const current = await lstat(directory, { bigint: true });
    assert(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, state.dev); assert.equal(current.ino, state.ino);
    assert.equal((await realpath(directory)).toLowerCase(), path.resolve(directory).toLowerCase());
  };
}

/** Explicit local platform candidate; never mutate the full input closure. */
export async function projectToolchainPrebuild(source, target, platformTarget, options = {}) {
  assert.equal(platformTarget, "win32-x64", "only explicit win32-x64 local candidate supported");
  assert.equal(`${process.platform}-${process.arch}`, platformTarget, "prebuild projection requires matching host target");
  const validated = await validateToolchainClosure(source);
  assert(!validated.closure.projection, "project only a complete original closure");
  const originalBytes = await readFile(path.join(source, "closure-manifest.json"));
  let consumerProfile = null, evidenceBytes = null;
  if (options.consumerProfile) {
    assertCompilerProfile(options.consumerProfile);
    assert(["hyperframes", "remotion", "three"].every(e => validated.marker.engines.includes(e)), "compiler profile requires all three engine inputs");
    const omitted = validated.closure.packages.filter(p => isCompilerOmission(p.path, p.version));
    assert.equal(omitted.length, 11, "compiler profile requires exact reviewed source packages");
    const review = options.reachabilityEvidence;
    assert(review && Array.isArray(review.visited) && Array.isArray(review.edges), "compiler reachability review required");
    assert.deepEqual(review.nonLiteralDynamic, [], "unreviewed dynamic compiler imports");
    const paths = [...new Set([...review.visited, ...PROFILE_ENTRY_POINTS])].sort();
    const filePins = paths.map(p => { const pin = validated.closure.files.find(f => f.path === p); assert(pin, `compiler evidence source missing: ${p}`); return pin; });
    assert(review.edges.every(e => !omitted.some(p => ownsFile(p.path, e.to))), "compiler graph reaches omitted package");
    evidenceBytes = Buffer.from(JSON.stringify({ consumer: "Rocut compileProgrammaticProject/bundleToSingleHtml with inline assets, media IDs and native audio FX", filePins, edges: review.edges, bareImports: review.bareImports, nonLiteralDynamic: review.nonLiteralDynamic }, null, 2) + "\n");
    consumerProfile = { id: COMPILER_PROFILE, packageClosureComplete: false, omittedPackages: omitted.map(p => ({ ...p, reason: "not-reachable-from-reviewed-rocut-compiler-entrypoints", files: validated.closure.files.filter(f => ownsFile(p.path, f.path)) })), evidencePath: "compiler-profile-evidence.json", evidenceSha256: digest(evidenceBytes) };
  }
  const remove = f => isProjectedRemoval(f.path, PROJECTION_POLICY) || consumerProfile?.omittedPackages.some(p => ownsFile(p.path, f.path));
  const removedFiles = validated.closure.files.filter(remove);
  const keptFiles = validated.closure.files.filter(f => !remove(f));
  const parentGuard = await guard(path.dirname(target));
  await parentGuard(); await mkdir(target);
  const targetGuard = await guard(target);
  const put = async (relative, bytes) => {
    await parentGuard(); await targetGuard();
    const destination = path.join(target, ...relative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    const destinationGuard = await guard(path.dirname(destination));
    await parentGuard(); await targetGuard(); await destinationGuard();
    await writeFile(destination, bytes, { flag: "wx" });
  };
  for (const pin of keptFiles) {
    const origin = path.join(source, ...pin.path.split("/"));
    const state = await lstat(origin);
    assert(state.isFile() && !state.isSymbolicLink());
    assert.equal((await realpath(origin)).toLowerCase(), path.resolve(origin).toLowerCase());
    const bytes = await readFile(origin);
    assert.equal(bytes.length, pin.size); assert.equal(digest(bytes), pin.sha256, `prebuild source drift: ${pin.path}`);
    await put(pin.path, bytes);
  }
  const metadata = ["package-lock.json", "rocut-engine-toolchain.json", ...(validated.closure.sourceLocks ?? []).map(p => p.path)];
  for (const relative of metadata) await put(relative, await readFile(path.join(source, ...relative.split("/"))));
  await put("source-closure-manifest.json", originalBytes);
  if (evidenceBytes) await put("compiler-profile-evidence.json", evidenceBytes);
  const inspected = await inspectToolchainSource(target, validated.marker.engines, validated.closure.licenseEvidence ?? [], consumerProfile?.id);
  assert.deepEqual(inspected.files, keptFiles, "projection must preserve every runtime file pin");
  const projection = { policy: PROJECTION_POLICY, ciVcsSegments: CI_VCS_SEGMENTS, platformTarget, sourceClosurePath: "source-closure-manifest.json", sourceClosureSha256: digest(originalBytes), originalFileCount: validated.closure.files.length, retainedFileCount: keptFiles.length, removedFiles };
  const closure = { ...validated.closure, packages: inspected.packages.map(({ files: ignored, ...p }) => p), files: keptFiles, projection, ...(consumerProfile ? { consumerProfile } : {}) };
  await put("closure-manifest.json", Buffer.from(JSON.stringify(closure, null, 2) + "\n"));
  await validateToolchainClosure(target);
  return closure;
}
