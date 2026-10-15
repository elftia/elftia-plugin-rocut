import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const POLICY = "sdk-lf-law-v1";
const EVIDENCE = "lf-normalization.json";
export function normalizeDeliveryBytes(bytes) {
  if (!bytes.length || bytes.includes(0) || !bytes.includes(13)) return bytes;
  return Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
}
async function inventory(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix + entry.name, absolute = path.join(root, entry.name);
    assert(!entry.isSymbolicLink(), "delivery symlink forbidden");
    if (entry.isDirectory()) result.push(...await inventory(absolute, relative + "/"));
    else { assert(entry.isFile(), "delivery regular file required"); result.push(relative); }
  }
  return result.sort();
}
export async function refreshSelectedSurfaceManifest(root) {
  const file = path.join(root, "asset-manifest.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  for (const pin of manifest.files.filter(pin => pin.category !== "branding")) {
    const bytes = await readFile(path.join(root, pin.path));
    pin.bytes = bytes.length; pin.sha256 = digest(bytes);
  }
  manifest.totalBytes = manifest.files.reduce((sum, pin) => sum + pin.bytes, 0);
  await writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
}
function projectedClosure(original, pins, evidencePin) {
  const pin = relative => { const value = pins.get(relative); assert(value, `missing delivery pin: ${relative}`); return value; };
  const licenseEvidence = original.licenseEvidence?.map(file => {
    const noticePath = `node_modules/${file.name}/${file.noticePath}`;
    const omitted = original.consumerProfile?.omittedPackages.find(pkg => pkg.path === `node_modules/${file.name}` && pkg.version === file.version);
    if (omitted) {
      // This is source provenance for a reviewed omission, not a delivered notice.
      assert(omitted.files.some(pin => pin.path === noticePath && pin.sha256 === file.sha256), `omitted notice source pin mismatch: ${noticePath}`);
      return file;
    }
    return { ...file, sha256: pin(noticePath).sha256 };
  });
  return {
    ...original,
    files: original.files.map(file => pin(file.path)),
    packageLockSha256: pin("package-lock.json").sha256,
    ...(original.sourceLocks ? { sourceLocks: original.sourceLocks.map(file => ({ ...file, sha256: pin(file.path).sha256 })) } : {}),
    ...(licenseEvidence ? { licenseEvidence } : {}),
    ...(original.consumerProfile ? { consumerProfile: { ...original.consumerProfile, evidenceSha256: pin(original.consumerProfile.evidencePath).sha256 } } : {}),
    ...(original.projection ? { projection: { ...original.projection, sourceClosureSha256: pin(original.projection.sourceClosurePath).sha256 } } : {}),
    deliveryNormalization: { policy: POLICY, evidencePath: EVIDENCE, evidenceSha256: evidencePin },
  };
}
export async function normalizeSelectedToolchain(root, validated) {
  assert(!validated.closure.deliveryNormalization, "toolchain delivery already normalized");
  const original = await readFile(path.join(root, "closure-manifest.json"));
  assert.deepEqual(JSON.parse(original), validated.closure, "toolchain closure drift before delivery projection");
  const changes = [], pins = new Map();
  for (const relative of await inventory(root)) {
    if (relative === "closure-manifest.json") continue;
    const file = path.join(root, relative), bytes = await readFile(file), delivered = normalizeDeliveryBytes(bytes);
    if (!delivered.equals(bytes)) {
      changes.push({ path: relative, sourceSha256: digest(bytes), sourceBytesBase64: bytes.toString("base64") });
      await writeFile(file, delivered);
    }
    pins.set(relative, { path: relative, size: delivered.length, sha256: digest(delivered) });
  }
  const evidence = Buffer.from(JSON.stringify({ version: 1, policy: POLICY, sourceClosure: { sha256: digest(original), bytesBase64: original.toString("base64") }, changes }, null, 2) + "\n");
  await writeFile(path.join(root, EVIDENCE), evidence, { flag: "wx" });
  const closure = projectedClosure(validated.closure, pins, digest(evidence));
  await writeFile(path.join(root, "closure-manifest.json"), JSON.stringify(closure, null, 2) + "\n");
  return closure;
}
export async function validateSelectedToolchainDelivery(root, delivered) {
  const marker = delivered.deliveryNormalization;
  if (!marker) return null;
  assert.equal(marker.policy, POLICY); assert.equal(marker.evidencePath, EVIDENCE);
  const bytes = await readFile(path.join(root, EVIDENCE));
  assert.equal(digest(bytes), marker.evidenceSha256, "LF delivery evidence digest mismatch");
  const evidence = JSON.parse(bytes);
  assert.equal(evidence.version, 1); assert.equal(evidence.policy, POLICY);
  const sourceBytes = Buffer.from(evidence.sourceClosure.bytesBase64, "base64");
  assert.equal(digest(sourceBytes), evidence.sourceClosure.sha256, "LF original closure digest mismatch");
  const original = JSON.parse(sourceBytes);
  assert(!original.deliveryNormalization, "nested LF delivery evidence forbidden");
  const originals = new Map(), pins = new Map();
  const names = await inventory(root);
  for (const change of evidence.changes) {
    assert(names.includes(change.path) && ![EVIDENCE, "closure-manifest.json"].includes(change.path) && !originals.has(change.path), "invalid LF delivery change path");
    const source = Buffer.from(change.sourceBytesBase64, "base64");
    assert.equal(digest(source), change.sourceSha256, "LF original file digest mismatch");
    const actual = await readFile(path.join(root, change.path));
    assert(!source.equals(normalizeDeliveryBytes(source)), "LF delivery change must transform bytes");
    assert(actual.equals(normalizeDeliveryBytes(source)), `LF delivery bytes mismatch: ${change.path}`);
    originals.set(change.path, source);
  }
  for (const relative of names) {
    const actual = await readFile(path.join(root, relative));
    assert(actual.equals(normalizeDeliveryBytes(actual)), `delivery still contains CRLF: ${relative}`);
    pins.set(relative, { path: relative, size: actual.length, sha256: digest(actual) });
  }
  assert.deepEqual(delivered, projectedClosure(original, pins, digest(bytes)), "LF delivery closure projection mismatch");
  const readOriginal = async relative => originals.get(relative) ?? readFile(path.join(root, relative));
  assert.equal(digest(await readOriginal("package-lock.json")), original.packageLockSha256, "LF source lock pin mismatch");
  for (const pin of original.files) {
    const source = await readOriginal(pin.path);
    assert.equal(source.length, pin.size); assert.equal(digest(source), pin.sha256, `LF source pin mismatch: ${pin.path}`);
  }
  return { original, readOriginal, additionalAllowed: [EVIDENCE] };
}
