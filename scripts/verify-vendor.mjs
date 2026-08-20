#!/usr/bin/env node

import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { assertNoForbiddenBranding } from "./dist-layout.mjs";
import {
  inventoryVendorTree,
  verifyVendorAgainstProvenance,
} from "./provenance.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(repoRoot, "vendor");

try {
  const result = await verifyVendorAgainstProvenance(vendorRoot);
  const entries = await inventoryVendorTree(vendorRoot);
  assertNoForbiddenBranding({ entries });
  console.info(
    `verify-vendor: PASS (${result.fileCount} files match vendor/PROVENANCE.md; upstream ${String(result.upstreamCommit).slice(0, 12)}; no upstream brand marks)`,
  );
} catch (error) {
  console.error(
    `verify-vendor: FAIL: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
