import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import { ownedTemp } from "./owned-temp.mjs";
import { ENGINE_PACKAGES, copyToolchainClosure, inspectToolchainSource, validateToolchainClosure } from "../scripts/toolchain-closure.mjs";
import { composeToolchainSources } from "../scripts/toolchain-sources.mjs";
import { createHash } from "node:crypto";
import { projectToolchainPrebuild } from "../scripts/toolchain-prebuild.mjs";
import { COMPILER_PROFILE, OMITTED_PACKAGES, PROFILE_ENTRY_POINTS } from "../scripts/toolchain-compiler-profile.mjs";

async function fixture(engines = ["hyperframes", "remotion", "three"]) {
  const root = await ownedTemp("rocut-toolchain-closure-");
  const source = path.join(root, "source"); await mkdir(source);
  const requirements = Object.assign({}, ...engines.map(e => ENGINE_PACKAGES[e]));
  const lock = { lockfileVersion: 3, packages: {} };
  async function pkg(name, version, extra = {}) {
    const relative = "node_modules/" + name, directory = path.join(source, relative);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, version, license: "MIT", ...extra }));
    await writeFile(path.join(directory, "LICENSE"), "MIT permission notice");
    lock.packages[relative] = { version, integrity: "sha512-AAAA", license: "MIT" };
    return directory;
  }
  for (const [name, version] of Object.entries(requirements)) await pkg(name, version);
  if (requirements.esbuild) {
    const binary = await pkg("@esbuild/win32-x64", "0.27.3"); await writeFile(path.join(binary, "esbuild.exe"), "fixture binary");
    const directory = path.join(source, "node_modules/esbuild");
    await mkdir(path.join(directory, "lib")); await writeFile(path.join(directory, "lib/main.js"), "export {};");
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "esbuild", version: "0.27.3", license: "MIT", optionalDependencies: { "@esbuild/win32-x64": "0.27.3", "@esbuild/linux-x64": "0.27.3" } }));
  }
  if (requirements["@hyperframes/core"]) { const compiler = path.join(source, "node_modules/@hyperframes/core/dist/compiler"); await mkdir(compiler, { recursive: true }); await writeFile(path.join(compiler, "index.js"), "export {};"); }
  await writeFile(path.join(source, "package-lock.json"), JSON.stringify(lock));
  return { root, source, lock, target: path.join(root, "target"), pkg };
}

test("explicit all-engine closure copies only locked package bytes and licenses", async () => {
  const f = await fixture(); await f.pkg("unrelated-dev-tool", "9.9.9");
  const closure = await copyToolchainClosure(f.source, f.target);
  const validated = await validateToolchainClosure(f.target);
  assert.deepEqual(validated.marker.engines, ["hyperframes", "remotion", "three"]);
  assert(!closure.packages.some(p => p.name === "unrelated-dev-tool"));
  assert(closure.packages.some(p => p.name === "@esbuild/win32-x64"));
  assert.equal((await readFile(path.join(f.target, "node_modules/three/LICENSE"), "utf8")), "MIT permission notice");
});
test("Three-only remains explicitly partial; default all-engine request fails", async () => {
  const f = await fixture(["three"]);
  await assert.rejects(inspectToolchainSource(f.source), /locked integrity required/);
  await copyToolchainClosure(f.source, f.target, ["three"]);
  assert.deepEqual((await validateToolchainClosure(f.target)).marker.engines, ["three"]);
});
test("wrong manifest version fails before a complete closure can ship", async () => {
  const f = await fixture(["hyperframes"]);
  await writeFile(path.join(f.source, "node_modules/@hyperframes/core/package.json"), JSON.stringify({ name: "@hyperframes/core", version: "0.8.138", license: "MIT" }));
  await assert.rejects(inspectToolchainSource(f.source, ["hyperframes"]), /manifest\/lock version mismatch/);
});
test("missing compiler entry cannot advertise an engine", async () => {
  const f = await fixture(["hyperframes"]);
  await unlink(path.join(f.source, "node_modules/@hyperframes/core/dist/compiler/index.js"));
  await assert.rejects(inspectToolchainSource(f.source, ["hyperframes"]), /compiler entry missing/);
});
test("lock integrity and package license metadata are mandatory", async () => {
  const f = await fixture(["three"]); delete f.lock.packages["node_modules/three"].integrity;
  await writeFile(path.join(f.source, "package-lock.json"), JSON.stringify(f.lock));
  await assert.rejects(inspectToolchainSource(f.source, ["three"]), /locked integrity required/);
});
test("missing or drifted license metadata rejects production packaging", async () => {
  for (const license of [undefined, "GPL-3.0-only"]) {
    const f = await fixture(["three"]);
    await writeFile(path.join(f.source, "node_modules/three/package.json"), JSON.stringify({ name: "three", version: "0.185.1", license }));
    await assert.rejects(inspectToolchainSource(f.source, ["three"]), /license metadata required|license mismatch/);
  }
});
test("undeclared file, file drift and lock drift reject bundled closure", async () => {
  for (const mode of ["extra", "file", "lock"]) {
    const f = await fixture(["three"]); await copyToolchainClosure(f.source, f.target, ["three"]);
    if (mode === "extra") await writeFile(path.join(f.target, "unexpected.js"), "extra");
    if (mode === "file") await writeFile(path.join(f.target, "node_modules/three/LICENSE"), "drift");
    if (mode === "lock") await writeFile(path.join(f.target, "package-lock.json"), JSON.stringify({ ...f.lock, name: "drift" }));
    await assert.rejects(validateToolchainClosure(f.target), /undeclared|pins mismatch|lock digest mismatch/);
  }
});
test("unknown engines, package redirects and linked lock packages reject", async () => {
  const f = await fixture(["three"]);
  await assert.rejects(inspectToolchainSource(f.source, ["other"]), /known unique/);
  const redirect = path.join(f.root, "redirect"); await symlink(f.source, redirect, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(inspectToolchainSource(redirect, ["three"]), /ordinary|redirected/);
  f.lock.packages["node_modules/three"].link = true; await writeFile(path.join(f.source, "package-lock.json"), JSON.stringify(f.lock));
  await assert.rejects(inspectToolchainSource(f.source, ["three"]), /locked integrity required/);
});
test("required transitive dependency missing cannot be silently pruned", async () => {
  const f = await fixture(["three"]);
  await writeFile(path.join(f.source, "node_modules/three/package.json"), JSON.stringify({ name: "three", version: "0.185.1", license: "MIT", dependencies: { "required-helper": "1.0.0" } }));
  await assert.rejects(inspectToolchainSource(f.source, ["three"]), /dependency lock missing/);
});
test("multiple fixed sources merge exact duplicate packages and retain original locks", async () => {
  const a = await fixture(["three"]), b = await fixture(["remotion"]);
  const closure = await composeToolchainSources([{ directory: a.source, engines: ["three"] }, { directory: b.source, engines: ["remotion"] }], a.target);
  assert.equal(closure.packages.filter(p => p.name === "esbuild").length, 1);
  assert.equal(closure.sourceLocks.length, 2);
  assert.deepEqual(await readFile(path.join(a.target, "source-locks/0.package-lock.json")), await readFile(path.join(a.source, "package-lock.json")));
  assert.deepEqual((await validateToolchainClosure(a.target)).marker.engines, ["three", "remotion"]);
});
test("merge refuses file and dependency lock collisions before creating target", async () => {
  for (const mode of ["file", "integrity"]) {
    const a = await fixture(["three"]), b = await fixture(["remotion"]);
    if (mode === "file") await writeFile(path.join(b.source, "node_modules/esbuild/LICENSE"), "different notice");
    else { b.lock.packages["node_modules/esbuild"].integrity = "sha512-BBBB"; await writeFile(path.join(b.source, "package-lock.json"), JSON.stringify(b.lock)); }
    await assert.rejects(composeToolchainSources([{ directory: a.source, engines: ["three"] }, { directory: b.source, engines: ["remotion"] }], a.target), /collision/);
    await assert.rejects(readFile(path.join(a.target, "package-lock.json")), /ENOENT/);
  }
});
test("exact license evidence admits absent metadata and copies real supplemental notice without manifest edits", async () => {
  const f = await fixture(["hyperframes"]), packageRoot = path.join(f.source, "node_modules/@hyperframes/core");
  const manifest = Buffer.from(JSON.stringify({ name: "@hyperframes/core", version: "0.8.139" }));
  await writeFile(path.join(packageRoot, "package.json"), manifest);
  delete f.lock.packages["node_modules/@hyperframes/core"].license;
  await writeFile(path.join(f.source, "package-lock.json"), JSON.stringify(f.lock));
  const bytes = await readFile(path.join(packageRoot, "LICENSE"));
  const proof = { name: "@hyperframes/core", version: "0.8.139", license: "MIT", noticePath: "LICENSE", sha256: createHash("sha256").update(bytes).digest("hex") };
  await composeToolchainSources([{ directory: f.source, engines: ["hyperframes"], licenseEvidence: [proof] }], f.target);
  assert.deepEqual(await readFile(path.join(f.target, "node_modules/@hyperframes/core/package.json")), manifest);
  const copied = path.join(f.root, "copied");
  const copiedClosure = await copyToolchainClosure(f.target, copied);
  assert.deepEqual(copiedClosure, (await validateToolchainClosure(f.target)).closure);
  await validateToolchainClosure(copied);
  await writeFile(path.join(f.target, "undeclared.txt"), "extra");
  await assert.rejects(copyToolchainClosure(f.target, path.join(f.root, "rejected")), /undeclared/);
  const g = await fixture(["remotion"]), notice = path.join(g.root, "official-notice.md");
  await writeFile(notice, bytes); await unlink(path.join(g.source, "node_modules/remotion/LICENSE"));
  const supplemental = { ...proof, name: "remotion", version: "4.0.440", noticePath: "LICENSE.md", sourceFile: notice };
  await composeToolchainSources([{ directory: g.source, engines: ["remotion"], licenseEvidence: [supplemental] }], g.target);
  assert.deepEqual(await readFile(path.join(g.target, "node_modules/remotion/LICENSE.md")), bytes);
  await assert.rejects(inspectToolchainSource(g.source, ["remotion"], [{ ...supplemental, sha256: "0".repeat(64) }]), /digest mismatch/);
  await assert.rejects(inspectToolchainSource(g.source, ["remotion"], [{ ...supplemental, version: "4.0.439" }]), /notice file required/);
});
test("platform prebuild removes only pinned types/source maps and preserves original closure", async () => {
  const f = await fixture(["three"]), root = path.join(f.source, "node_modules/three");
  for (const name of ["index.d.ts", "index.d.ts.map", "index.js.map", "runtime.js", "model.map", "asset.wasm"]) await writeFile(path.join(root, name), name);
  await mkdir(path.join(root, ".github/workflows"), { recursive: true });
  await writeFile(path.join(root, ".github/workflows/ci.yml"), "official SDK forbidden CI metadata");
  await mkdir(path.join(root, "docs")); await writeFile(path.join(root, "docs/node_modules-policy.md"), "runtime unrelated filename retained");
  await composeToolchainSources([{ directory: f.source, engines: ["three"] }], f.target);
  const projected = path.join(f.root, "projected");
  const closure = await projectToolchainPrebuild(f.target, projected, "win32-x64");
  assert.equal(closure.projection.removedFiles.length, 4);
  assert(closure.projection.removedFiles.some(p => p.path.includes("/.github/")));
  assert(closure.files.some(p => p.path.endsWith("/docs/node_modules-policy.md")));
  assert(closure.files.some(p => p.path.endsWith("/model.map")));
  assert(closure.files.some(p => p.path.endsWith("/asset.wasm")));
  assert(closure.files.some(p => p.path.endsWith("/esbuild.exe")));
  assert.deepEqual(await readFile(path.join(projected, "source-closure-manifest.json")), await readFile(path.join(f.target, "closure-manifest.json")));
  await validateToolchainClosure(projected);
  await copyToolchainClosure(projected, path.join(f.root, "copy"));
  closure.projection.removedFiles.push(closure.files.find(p => p.path.endsWith("/runtime.js")));
  await writeFile(path.join(projected, "closure-manifest.json"), JSON.stringify(closure));
  await assert.rejects(validateToolchainClosure(projected), /removed runtime file/);
  await assert.rejects(projectToolchainPrebuild(f.target, path.join(f.root, "wrong-platform"), "linux-x64"), /win32-x64/);
});
test("reviewed compiler profile omits only exact service packages, keeps truthful full lock and fails missing runtime", async () => {
  const f = await fixture();
  for (const [relative, version] of Object.entries(OMITTED_PACKAGES)) {
    const name = relative.slice("node_modules/".length);
    const dependencies = name === "@hyperframes/studio-server" ? { sharp: "0.35.5", hono: "4.13.13" }
      : name === "sharp" ? { "@img/colour": "1.1.0", "@img/sharp-win32-x64": "0.35.5", "detect-libc": "2.1.2", semver: "7.8.5" }
      : name === "wawoff2" ? { argparse: "2.0.1" } : {};
    await f.pkg(name, version, { dependencies });
  }
  await f.pkg("@hyperframes/lint", "0.8.139"); await f.pkg("@hyperframes/parsers", "0.8.139");
  await f.pkg("required-helper", "1.0.0");
  await writeFile(path.join(f.source, "node_modules/@hyperframes/core/package.json"), JSON.stringify({ name: "@hyperframes/core", version: "0.8.139", license: "MIT", dependencies: { "@chenglou/pretext": "0.0.5", "bpm-detective": "2.0.5", wawoff2: "2.0.1", "@hyperframes/studio-server": "0.8.139", "@hyperframes/lint": "0.8.139", "@hyperframes/parsers": "0.8.139", "required-helper": "1.0.0" } }));
  for (const entry of PROFILE_ENTRY_POINTS) {
    await mkdir(path.dirname(path.join(f.source, entry)), { recursive: true });
    await writeFile(path.join(f.source, entry), "export {};");
  }
  await writeFile(path.join(f.source, "package-lock.json"), JSON.stringify(f.lock));
  await composeToolchainSources([{ directory: f.source, engines: ["hyperframes", "remotion", "three"] }], f.target);
  const projected = path.join(f.root, "compiler-profile");
  const closure = await projectToolchainPrebuild(f.target, projected, "win32-x64", { consumerProfile: COMPILER_PROFILE, reachabilityEvidence: { visited: PROFILE_ENTRY_POINTS, edges: [], bareImports: [], nonLiteralDynamic: [] } });
  assert.equal(closure.consumerProfile.packageClosureComplete, false);
  assert.equal(closure.consumerProfile.omittedPackages.length, 11);
  assert(closure.packages.some(p => p.name === "@hyperframes/lint"));
  assert(closure.packages.some(p => p.name === "@hyperframes/parsers"));
  assert(!closure.packages.some(p => p.name === "sharp"));
  assert.deepEqual(await readFile(path.join(projected, "package-lock.json")), await readFile(path.join(f.target, "package-lock.json")));
  await validateToolchainClosure(projected); await copyToolchainClosure(projected, path.join(f.root, "profile-copy"));
  await assert.rejects(inspectToolchainSource(projected), /ENOENT/);
  await unlink(path.join(projected, "node_modules/required-helper/package.json"));
  await assert.rejects(validateToolchainClosure(projected), /ENOENT/);
  await assert.rejects(projectToolchainPrebuild(f.target, path.join(f.root, "unknown"), "win32-x64", { consumerProfile: "unknown-profile" }), /unknown.*profile/);
});
