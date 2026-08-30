/**
 * Publish a staged tree into `dist/<id>/` as a single rename, or leave the
 * previous tree exactly as it was.
 *
 * Ported from `elftia-plugin-computer-use/scripts/atomic-tree-swap.mjs`; the
 * only change is that the stage/backup basename prefix is a parameter instead
 * of a hardcoded plugin id.
 *
 * Three redirection hazards this guards, all of them Windows-shaped:
 *  - the repository or the `dist/` parent being swapped for a junction between
 *    the identity check and the rename — hence the physical dev/ino recapture
 *    immediately before every rename;
 *  - a rollback that cannot tell "never installed" from "installed and then
 *    failed" — hence the explicit transaction flags;
 *  - a cleanup after a successful commit deleting the bytes it just published —
 *    hence `COMMITTED_CLEANUP_FAILURE`, which reports residue instead of
 *    touching the installed tree.
 */
import { randomBytes } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { inventoriesEqual, inventoryRegularTree } from "./dist-layout.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function pathState(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertOrdinaryDirectory(state, label) {
  assert(
    state.isDirectory() && !state.isSymbolicLink(),
    `${label} must be an ordinary directory without a symlink, junction, or reparse escape`,
  );
}

async function inspectLocation(repoRootInput, targetRelative) {
  const repoRoot = path.resolve(repoRootInput);
  const target = path.resolve(repoRoot, ...targetRelative.split("/"));
  const parent = path.dirname(target);
  assert(
    path.relative(repoRoot, target).split(path.sep)[0] !== "..",
    "target escapes repository",
  );

  const repoState = await lstat(repoRoot);
  assertOrdinaryDirectory(repoState, "producer repository");
  const realRepoRoot = await realpath(repoRoot);

  const parentRelative = path.relative(repoRoot, parent);
  let cursor = repoRoot;
  for (const segment of parentRelative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if ((await pathState(cursor)) === null) await mkdir(cursor);
    assertOrdinaryDirectory(
      await lstat(cursor),
      `target path component ${cursor}`,
    );
  }

  const parentState = await lstat(parent);
  assertOrdinaryDirectory(parentState, "target parent");
  const realParent = await realpath(parent);
  assert(
    samePath(path.dirname(realParent), realRepoRoot),
    "target parent must be a direct physical child of the producer repository",
  );

  const targetState = await pathState(target);
  if (targetState !== null) {
    assertOrdinaryDirectory(targetState, "dist target");
    const realTarget = await realpath(target);
    assert(
      samePath(path.dirname(realTarget), realParent),
      "dist target escapes its physical parent",
    );
  }
  return {
    repoRoot,
    realRepoRoot,
    repoIdentity: { dev: repoState.dev, ino: repoState.ino },
    targetRelative,
    target,
    parent,
    realParent,
    parentIdentity: { dev: parentState.dev, ino: parentState.ino },
  };
}

async function revalidateLocation(location, label) {
  const observed = await inspectLocation(
    location.repoRoot,
    location.targetRelative,
  );
  assert(
    samePath(observed.realRepoRoot, location.realRepoRoot) &&
      sameIdentity(observed.repoIdentity, location.repoIdentity),
    `${label}: producer repository physical identity changed`,
  );
  assert(
    samePath(observed.realParent, location.realParent) &&
      sameIdentity(observed.parentIdentity, location.parentIdentity),
    `${label}: target parent physical identity changed`,
  );
}

async function assertRunPath(candidate, location, kind, runId, prefix) {
  await revalidateLocation(location, `before ${kind} path access`);
  const resolved = path.resolve(candidate);
  assert(
    samePath(path.dirname(resolved), location.parent),
    `${kind} path escapes target parent`,
  );
  assert(
    path.basename(resolved).startsWith(`.${prefix}-${kind}-${runId}`),
    `refusing unowned ${kind} path: ${resolved}`,
  );
  const state = await pathState(resolved);
  if (state === null) return;
  assertOrdinaryDirectory(state, `unsafe ${kind} path`);
  const physicalPath = await realpath(resolved);
  assert(
    samePath(path.dirname(physicalPath), location.realParent),
    `${kind} path physically escapes`,
  );
}

async function removeRunPath(candidate, location, kind, runId, prefix) {
  await assertRunPath(candidate, location, kind, runId, prefix);
  if ((await pathState(candidate)) !== null)
    await rm(candidate, { recursive: true, force: false });
}

async function callFault(fault, point, context) {
  if (fault !== undefined) await fault(point, context);
}

async function rollback(transaction, options, originalError) {
  const failures = [];
  const { prefix } = transaction;
  try {
    await callFault(options.fault, "before-rollback", transaction);
    if (transaction.installed) {
      await assertRunPath(
        transaction.stage,
        transaction.location,
        "stage",
        transaction.runId,
        prefix,
      );
      await revalidateLocation(
        transaction.location,
        "immediately before rollback target rename",
      );
      await rename(transaction.location.target, transaction.stage);
      transaction.installed = false;
    }
    if (transaction.backupCreated) {
      await assertRunPath(
        transaction.backup,
        transaction.location,
        "backup",
        transaction.runId,
        prefix,
      );
      await revalidateLocation(
        transaction.location,
        "immediately before rollback backup rename",
      );
      await rename(transaction.backup, transaction.location.target);
      transaction.backupCreated = false;
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  if (failures.length === 0) {
    for (const [candidate, kind] of [
      [transaction.stage, "stage"],
      [transaction.backup, "backup"],
    ]) {
      try {
        await removeRunPath(
          candidate,
          transaction.location,
          kind,
          transaction.runId,
          prefix,
        );
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  const detail =
    failures.length === 0
      ? "rollback completed"
      : `rollback failures: ${failures.join("; ")}`;
  throw new Error(
    `${originalError instanceof Error ? originalError.message : String(originalError)}; ${detail}; ` +
      `recovery paths: stage=${transaction.stage}, backup=${transaction.backup}`,
    { cause: originalError },
  );
}

export async function publishTreeAtomically(options) {
  const location = await inspectLocation(
    options.repoRoot,
    options.targetRelative,
  );
  const prefix = options.runPrefix ?? "elftia-plugin";
  const runId = randomBytes(8).toString("hex");
  const stage = path.join(location.parent, `.${prefix}-stage-${runId}`);
  const backup = path.join(location.parent, `.${prefix}-backup-${runId}`);
  const transaction = {
    location,
    runId,
    prefix,
    stage,
    backup,
    installed: false,
    backupCreated: false,
  };

  await assertRunPath(stage, location, "stage", runId, prefix);
  await assertRunPath(backup, location, "backup", runId, prefix);
  try {
    await options.populateStage(stage);
    await assertRunPath(stage, location, "stage", runId, prefix);
    const [parentState, stageState] = await Promise.all([
      lstat(location.parent),
      lstat(stage),
    ]);
    assert(
      parentState.dev === stageState.dev,
      "stage and target parent are on different volumes",
    );
    const stagedInventory = await inventoryRegularTree(stage, "rocut stage");
    assert(
      inventoriesEqual(stagedInventory, options.expectedInventory),
      "staged inventory differs",
    );
    await options.validateTree(stage, options.expectedInventory);
  } catch (error) {
    try {
      await removeRunPath(stage, location, "stage", runId, prefix);
    } catch (cleanupError) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; stage cleanup failed: ` +
          `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}; residue=${stage}`,
        { cause: error },
      );
    }
    throw error;
  }

  let committed = false;
  try {
    const targetState = await pathState(location.target);
    if (targetState !== null) {
      assertOrdinaryDirectory(targetState, "existing dist target");
      await callFault(options.fault, "before-backup", transaction);
      await assertRunPath(backup, location, "backup", runId, prefix);
      await revalidateLocation(
        location,
        "immediately before forward backup rename",
      );
      await rename(location.target, backup);
      transaction.backupCreated = true;
    }

    await callFault(options.fault, "before-install", transaction);
    await assertRunPath(stage, location, "stage", runId, prefix);
    await revalidateLocation(
      location,
      "immediately before forward install rename",
    );
    await rename(stage, location.target);
    transaction.installed = true;

    await revalidateLocation(location, "before installed-tree validation");
    await options.validateTree(location.target, options.expectedInventory);
    const installedInventory = await inventoryRegularTree(
      location.target,
      "installed dist target",
    );
    assert(
      inventoriesEqual(installedInventory, options.expectedInventory),
      "installed inventory differs",
    );
    committed = true;

    await callFault(options.fault, "before-cleanup", transaction);
    await removeRunPath(backup, location, "backup", runId, prefix);
    transaction.backupCreated = false;
    return {
      target: location.target,
      inventory: installedInventory,
      state: "committed",
    };
  } catch (error) {
    if (!committed) return rollback(transaction, options, error);
    const committedError = new Error(
      `dist commit completed and installed bytes must be preserved; backup cleanup failed: ` +
        `${error instanceof Error ? error.message : String(error)}; residue=${backup}`,
      { cause: error },
    );
    committedError.code = "COMMITTED_CLEANUP_FAILURE";
    committedError.committed = true;
    committedError.target = location.target;
    committedError.backup = backup;
    throw committedError;
  }
}
