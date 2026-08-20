#!/usr/bin/env node

import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  inventoryRocutSources,
  PLUGIN_ID,
  validateRocutTree,
} from "./dist-layout.mjs";
import { verifyVendorAgainstProvenance } from "./provenance.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  await verifyVendorAgainstProvenance(join(repoRoot, "vendor"));
  const sourceInventory = await inventoryRocutSources(repoRoot);
  const result = await validateRocutTree(
    join(repoRoot, "dist", PLUGIN_ID),
    sourceInventory,
  );
  console.info(
    `verify-dist: PASS (${result.inventory.fileCount} files, ${result.inventory.sha256})`,
  );
} catch (error) {
  console.error(
    `verify-dist: FAIL: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
