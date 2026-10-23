import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sri = bytes => "sha512-" + createHash("sha512").update(bytes).digest("base64");
async function regularFiles(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "source links forbidden");
    const relative = prefix + entry.name, absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await regularFiles(absolute, relative + "/"));
    else { assert(entry.isFile(), "ordinary source files required"); files.push(relative); }
  }
  return files.sort();
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, windowsHide: true, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 ** 2 });
  assert.equal(result.status, 0, `${path.basename(command)} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

/** Build in a fresh output tree; neither the supplied source nor dependency tree is modified. */
export async function packThreeAssetsSource(source, dependencies, output) {
  assert(path.isAbsolute(source) && path.isAbsolute(dependencies) && path.isAbsolute(output), "absolute build paths required");
  for (const input of [source, dependencies]) {
    assert((await lstat(input)).isDirectory() && !(await lstat(input)).isSymbolicLink(), "ordinary build input required");
    const relative = path.relative(input, output);
    assert(relative && (relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)), "output must be disjoint from inputs");
  }
  const compilerLock = JSON.parse(await readFile(path.join(repo, "build-inputs/three-assets-build/package-lock.json"), "utf8"));
  for (const [relative, pin] of Object.entries(compilerLock.packages).filter(([p]) => p)) {
    const manifest = JSON.parse(await readFile(path.join(dependencies, relative, "package.json"), "utf8"));
    assert.equal(manifest.version, pin.version, `compiler dependency differs: ${relative}`);
  }
  await mkdir(output);
  assert.equal(await realpath(output), path.resolve(output), "redirected output rejected");
  const build = path.join(output, "build"); await mkdir(build);
  const inputs = [];
  for (const relative of await regularFiles(source)) {
    assert(!relative.startsWith("dist/") && !relative.startsWith("node_modules/"), "source-only input required");
    const bytes = await readFile(path.join(source, relative));
    const destination = path.join(build, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
    inputs.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length });
  }
  const manifest = JSON.parse(await readFile(path.join(build, "package.json"), "utf8"));
  assert.equal(manifest.name, "@elftia/three-assets"); assert.equal(manifest.version, "0.1.1"); assert.equal(manifest.license, "MIT");
  await copyFile(path.join(repo, "build-inputs/three-assets-build/tsconfig.json"), path.join(build, "tsconfig.json"));
  const link = path.join(build, "node_modules");
  await symlink(path.join(dependencies, "node_modules"), link, process.platform === "win32" ? "junction" : "dir");
  try {
    run(process.execPath, [path.join(dependencies, "node_modules/typescript/bin/tsc"), "-p", path.join(build, "tsconfig.json")], build);
  } finally { await unlink(link); }
  const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const packed = JSON.parse(run(process.execPath, [npm, "pack", "--ignore-scripts", "--json", "--pack-destination", output], build))[0];
  const archive = path.join(output, packed.filename), bytes = await readFile(archive);
  return { archive, sha256: sha256(bytes), integrity: sri(bytes), inputs, packedFiles: packed.files.map(f => ({ path: f.path, size: f.size })) };
}

export async function rebuildThreeAssets(dependencies, output) {
  const cache = path.join(repo, "build-inputs/toolchain/three-assets");
  const provenance = JSON.parse(await readFile(path.join(cache, "provenance.json"), "utf8"));
  const archive = path.join(cache, provenance.archive.file), bytes = await readFile(archive);
  assert.equal(sha256(bytes), provenance.archive.sha256); assert.equal(sri(bytes), provenance.archive.integrity);
  await mkdir(output);
  const extracted = path.join(output, "extracted"); await mkdir(extracted);
  const entries = run("tar", ["-tzf", archive], extracted).trim().split(/\r?\n/);
  assert(entries.every(p => p.startsWith("package/") && !p.includes("..") && !p.includes("\\")), "noncanonical archive entries");
  run("tar", ["-xzf", archive, "-C", extracted], extracted);
  const source = path.join(output, "source"); await mkdir(source);
  for (const pin of provenance.inputs) {
    const from = path.join(extracted, "package", pin.path), content = await readFile(from);
    assert.equal(sha256(content), pin.sha256, `cached source differs: ${pin.path}`);
    const to = path.join(source, pin.path); await mkdir(path.dirname(to), { recursive: true }); await writeFile(to, content, { flag: "wx" });
  }
  const result = await packThreeAssetsSource(source, dependencies, path.join(output, "repacked"));
  assert.equal(result.sha256, provenance.archive.sha256, "normal source rebuild must reproduce cached tarball");
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const flag = name => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1]; };
  assert(flag("dependencies") && flag("output-root"), "--dependencies <locked compiler root> --output-root <fresh directory> required");
  const result = await rebuildThreeAssets(flag("dependencies"), flag("output-root"));
  console.log(JSON.stringify({ archive: result.archive, sha256: result.sha256, integrity: result.integrity }));
}
