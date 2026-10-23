import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rename,
  symlink,
  unlink,
  realpath,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { publishTreeAtomically } from "../scripts/atomic-tree-swap.mjs";
import {
  inventoryRegularTree,
  inventoriesEqual,
  copyInventory,
} from "../scripts/dist-layout.mjs";

for (const phase of ["before-install", "before-rollback", "before-cleanup"])
  test(`promotion publisher preserves outside tree during parent replacement at ${phase}`, async () => {
    const temp = await realpath(tmpdir()),
      root = await mkdtemp(path.join(temp, "rocut-promotion-atomic-"));
    const repo = path.join(root, "producer"),
      outside = path.join(root, "outside"),
      source = path.join(root, "source");
    for (const directory of [repo, outside, source]) await mkdir(directory);
    await mkdir(path.join(repo, "dist"));
    await mkdir(path.join(repo, "dist/rocut"));
    await writeFile(path.join(repo, "dist/rocut/payload"), "old");
    await writeFile(path.join(outside, "sentinel"), "untouched");
    await writeFile(path.join(source, "payload"), "new");
    const before = await inventoryRegularTree(outside),
      inventory = await inventoryRegularTree(source);
    let redirected = false,
      failure;
    try {
      await publishTreeAtomically({
        repoRoot: repo,
        targetRelative: "dist/rocut",
        expectedInventory: inventory,
        populateStage: (stage) => copyInventory(source, inventory, stage),
        validateTree: async (target) => {
          assert(
            inventoriesEqual(await inventoryRegularTree(target), inventory),
          );
        },
        fault: async (point) => {
          if (phase === "before-rollback" && point === "before-install")
            throw new Error("force rollback");
          if (point !== phase) return;
          await rename(
            path.join(repo, "dist"),
            path.join(repo, "captured-dist"),
          );
          await symlink(
            outside,
            path.join(repo, "dist"),
            process.platform === "win32" ? "junction" : "dir",
          );
          redirected = true;
        },
      });
      assert.fail("parent replacement must fail closed");
    } catch (error) {
      failure = error;
    }
    assert(redirected);
    assert(inventoriesEqual(before, await inventoryRegularTree(outside)));
    const residue = await readdir(path.join(repo, "captured-dist"));
    assert(
      residue.some((name) => name.includes("backup")),
      "old tree must remain in truthful recovery residue",
    );
    if (phase === "before-cleanup") {
      assert.equal(failure.code, "COMMITTED_CLEANUP_FAILURE");
      assert.equal(failure.committed, true);
      assert.equal(
        await readFile(path.join(repo, "captured-dist/rocut/payload"), "utf8"),
        "new",
      );
      assert(!residue.some((name) => name.includes("stage")));
    } else {
      assert.match(failure.message, /rollback failures/);
      assert(residue.some((name) => name.includes("stage")));
      assert(!residue.includes("rocut"));
    }
    await unlink(path.join(repo, "dist"));
    await rename(path.join(repo, "captured-dist"), path.join(repo, "dist"));
    assert.equal(path.dirname(await realpath(root)), temp);
    assert(path.basename(root).startsWith("rocut-promotion-atomic-"));
    await rm(root, { recursive: true, force: true });
  });
