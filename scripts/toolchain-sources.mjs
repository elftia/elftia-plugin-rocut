import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectToolchainSource, validateToolchainClosure } from "./toolchain-closure.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function identity(directory) {
  const state = await lstat(directory, { bigint: true });
  assert(state.isDirectory() && !state.isSymbolicLink(), "ordinary toolchain target parent required");
  assert.equal((await realpath(directory)).toLowerCase(), path.resolve(directory).toLowerCase(), "redirected toolchain target parent");
  return async () => {
    const current = await lstat(directory, { bigint: true });
    assert(current.isDirectory() && !current.isSymbolicLink(), "toolchain target redirected");
    assert.equal(current.dev, state.dev); assert.equal(current.ino, state.ino);
    assert.equal((await realpath(directory)).toLowerCase(), path.resolve(directory).toLowerCase());
  };
}

/** Compose a fresh selected closure; never replace a previously installed tree. */
export async function composeToolchainSources(sources, target) {
  assert(Array.isArray(sources) && sources.length > 0, "explicit toolchain sources required");
  assert(path.isAbsolute(target) && sources.every(s => path.isAbsolute(s.directory)), "absolute toolchain paths required");
  const inspected = await Promise.all(sources.map(s => inspectToolchainSource(s.directory, s.engines, s.licenseEvidence)));
  const packages = new Map(), origins = new Map(), lockPackages = {}, evidence = new Map();
  const engines = [...new Set(inspected.flatMap(s => s.engines))];
  for (const [index, source] of inspected.entries()) {
    const lock = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source.lockBytes));
    for (const pkg of source.packages) {
      if (packages.has(pkg.path)) {
        assert.deepEqual(packages.get(pkg.path), pkg, `toolchain package collision: ${pkg.path}`);
        assert.deepEqual(lockPackages[pkg.path], lock.packages[pkg.path], `toolchain dependency lock collision: ${pkg.path}`);
      } else {
        packages.set(pkg.path, pkg); origins.set(pkg.path, index); lockPackages[pkg.path] = lock.packages[pkg.path];
      }
    }
    for (const proof of source.licenseEvidence) {
      const key = `${proof.name}@${proof.version}`;
      if (evidence.has(key)) assert.deepEqual(evidence.get(key), proof, `toolchain license evidence collision: ${key}`);
      else evidence.set(key, proof);
    }
  }
  const ordered = [...packages.values()].sort((a,b) => a.path.localeCompare(b.path));
  const filePins = ordered.flatMap(p => p.files).sort((a,b) => a.path.localeCompare(b.path));
  const parentGuard = await identity(path.dirname(target));
  await parentGuard(); await mkdir(target);
  const targetGuard = await identity(target);
  const put = async (relative, bytes) => {
    await parentGuard(); await targetGuard();
    const destination = path.join(target, ...relative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    const destinationGuard = await identity(path.dirname(destination));
    await parentGuard(); await targetGuard(); await destinationGuard();
    await writeFile(destination, bytes, { flag: "wx" });
  };
  for (const pkg of ordered) {
    const index = origins.get(pkg.path), source = inspected[index];
    for (const pin of pkg.files) {
      const supplemental = source.supplementalFiles.find(f => f.path === pin.path);
      const origin = supplemental?.sourceFile ?? path.join(sources[index].directory, ...pin.path.split("/"));
      const state = await lstat(origin);
      assert(state.isFile() && !state.isSymbolicLink(), `toolchain source file redirected: ${pin.path}`);
      assert.equal((await realpath(origin)).toLowerCase(), path.resolve(origin).toLowerCase());
      const bytes = await readFile(origin);
      assert.equal(bytes.length, pin.size); assert.equal(digest(bytes), pin.sha256, `toolchain source drift: ${pin.path}`);
      await put(pin.path, bytes);
    }
  }
  const sourceLocks = [];
  for (const [index, source] of inspected.entries()) {
    const relative = `source-locks/${index}.package-lock.json`;
    await put(relative, source.lockBytes);
    sourceLocks.push({ path: relative, sha256: source.packageLockSha256, engines: source.engines });
  }
  const lockBytes = Buffer.from(JSON.stringify({ name: "rocut-engine-toolchain", lockfileVersion: 3, requires: true, packages: lockPackages }, null, 2) + "\n");
  await put("package-lock.json", lockBytes);
  await put("rocut-engine-toolchain.json", Buffer.from(JSON.stringify({ version: 1, kind: "rocut-engine-toolchain", engines }) + "\n"));
  const packageSources = ordered.map(pkg => ({ path: pkg.path, sourceLocks: inspected.flatMap((s, i) => s.packages.some(p => p.path === pkg.path) ? [sourceLocks[i].path] : []) }));
  const closure = { version: 1, packageLockSha256: digest(lockBytes), sourceLocks, packageSources, licenseEvidence: [...evidence.values()], packages: ordered.map(({ files: ignored, ...pkg }) => pkg), files: filePins };
  await put("closure-manifest.json", Buffer.from(JSON.stringify(closure, null, 2) + "\n"));
  await validateToolchainClosure(target);
  return closure;
}
