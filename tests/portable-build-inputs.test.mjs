import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const input = path.join(root, "build-inputs/toolchain");
const sha = value => createHash("sha256").update(value).digest("hex");
const json = async relative => JSON.parse(await readFile(path.join(input, relative), "utf8"));

test("source-bearing portable Three archive has all tracked source and legal notices", async () => {
  const provenance = await json("three-assets/provenance.json");
  assert.equal(provenance.source.commit, "920b1e8a823e8f232f6e4a0fa112b66b3868ccaa");
  assert.match(provenance.source.remoteCommitAvailability, /not-advertised/);
  const archive = path.join(input, "three-assets", provenance.archive.file);
  const bytes = await readFile(archive);
  assert.equal(sha(bytes), provenance.archive.sha256);
  assert.equal("sha512-" + createHash("sha512").update(bytes).digest("base64"), provenance.archive.integrity);
  const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split(/\r?\n/);
  for (const pin of provenance.inputs) {
    assert(names.includes("package/" + pin.path), `missing cached source ${pin.path}`);
    const content = execFileSync("tar", ["-xOzf", archive, "package/" + pin.path], { maxBuffer: 8 * 1024 ** 2 });
    assert.equal(content.length, pin.bytes); assert.equal(sha(content), pin.sha256);
  }
  for (const notice of provenance.license.notices) assert(names.includes("package/" + notice), `missing legal notice ${notice}`);
  assert(names.includes("package/dist/index.js"));
  assert.equal(sha(await readFile(path.join(root, "build-inputs/three-assets-build/package-lock.json"))), provenance.compiler.dependencyLockSha256);
  assert.equal(sha(await readFile(path.join(root, "build-inputs/three-assets-build/tsconfig.json"))), provenance.compiler.tsconfigSha256);
});

test("new clone toolchain locks use registry SRI and a sibling cached archive, never machine paths", async () => {
  const provenance = await json("three-assets/provenance.json");
  for (const name of ["hyperframes-remotion", "three"]) {
    const lock = await json(name + "/package-lock.json");
    const manifest = await json(name + "/package.json");
    assert.deepEqual(manifest.dependencies, lock.packages[""].dependencies);
    for (const [relative, pin] of Object.entries(lock.packages).filter(([key]) => key)) {
      if (relative === "node_modules/@elftia/three-assets") {
        assert.equal(pin.resolved, "file:../three-assets/" + provenance.archive.file);
        assert.equal(pin.integrity, provenance.archive.integrity);
        assert.equal(manifest.dependencies["@elftia/three-assets"], pin.resolved);
      } else {
        assert(pin.resolved.startsWith("https://registry.npmjs.org/"));
        assert.match(pin.integrity, /^sha512-/);
      }
    }
  }
  for (const pin of await json("license-evidence.json")) {
    assert(pin.sourceFile.startsWith("notices/") && !pin.sourceFile.includes(".."));
    assert.equal(sha(await readFile(path.join(input, pin.sourceFile))), pin.sha256);
    assert(pin.sourceUrl.startsWith("https://raw.githubusercontent.com/"));
  }
});
