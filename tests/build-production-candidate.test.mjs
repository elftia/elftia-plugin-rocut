import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { ownedTemp } from "./owned-temp.mjs";
import { buildProductionCandidate } from "../scripts/build-production-candidate.mjs";

test("normal production assembly consumes only this fresh vendor's runtime, manifest and LICENSE", async () => {
  const root = await ownedTemp("rocut-normal-production-");
  const outputRoot = path.join(root, "output");
  const toolchain = path.join(root, "toolchain"); await mkdir(toolchain);
  for (const name of ['upstream', 'surface', 'wasm']) await mkdir(path.join(root, name));
  await writeFile(path.join(toolchain, "closure-manifest.json"), "{}\n");
  let verified = false;
  const head = "1".repeat(40);
  const result = await buildProductionCandidate({
    outputRoot, rocutRoot: path.join(root, "upstream"), surfaceDirectory: path.join(root, "surface"),
    wasmPackageDirectory: path.join(root, "wasm"), toolchainDir: toolchain,
    offlineDecoderInputs: process.env.ROCUT_OFFLINE_DECODER_INPUTS,
  }, {
    async vendor(options) {
      assert.equal(options.allowModifiedTracked, undefined);
      await mkdir(path.join(options.outputRoot, ".elftia-work"), { recursive: true });
      await writeFile(path.join(options.outputRoot, ".elftia-work/runtime-bundle-manifest.json"), JSON.stringify({ repoHead: head }));
      return { head, vendorRoot: path.join(options.outputRoot, "vendor") };
    },
    async validateToolchain(directory) { assert.equal(directory, toolchain); verified = true; },
    async build(options) {
      assert(verified);
      assert.equal(options.offlineDecoderInputs, process.env.ROCUT_OFFLINE_DECODER_INPUTS);
      assert.equal(options.licenseFile, path.join(outputRoot, "vendoring/vendor/LICENSE"));
      assert.equal(options.vendorProvenanceFile, path.join(outputRoot, 'vendoring/vendor/PROVENANCE.md'));
      assert.equal(options.runtimeDir, path.join(outputRoot, "vendoring/.elftia-work/dist-runtime"));
      assert.equal(options.surfaceDir, path.join(options.runtimeDir, "surface"));
      assert.equal(options.packManifest, path.join(outputRoot, "vendoring/.elftia-work/runtime-bundle-manifest.json"));
      return { target: path.join(outputRoot, "candidate/dist/rocut"), inventory: { fileCount: 1, sha256: "test" } };
    },
  });
  assert.equal(result.facts.upstreamCommit, head);
  assert.equal(result.facts.candidate.relativePath, "candidate/dist/rocut");
});

test('invalid explicit production directories or toolchain fail before output/vendor/install', async () => {
  const root = await ownedTemp('rocut-production-preflight-');
  for (const name of ['upstream', 'surface', 'wasm', 'toolchain']) await mkdir(path.join(root, name));
  const options = { outputRoot: path.join(root, 'output'), rocutRoot: path.join(root, 'upstream'), surfaceDirectory: path.join(root, 'surface'), wasmPackageDirectory: path.join(root, 'wasm'), toolchainDir: path.join(root, 'toolchain') };
  let vendorCalls = 0, installCalls = 0;
  const ports = { vendor() { vendorCalls++; }, toolchain() { installCalls++; } };
  for (const invalid of [{ ...options, surfaceDirectory: path.join(root, 'absent') }, options]) {
    await assert.rejects(buildProductionCandidate(invalid, ports));
    await assert.rejects(lstat(options.outputRoot), { code: 'ENOENT' });
  }
  assert.equal(vendorCalls, 0); assert.equal(installCalls, 0);
});
