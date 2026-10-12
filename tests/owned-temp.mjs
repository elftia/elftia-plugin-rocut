import assert from "node:assert/strict";
import { after } from "node:test";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const owned = [];
export async function ownedTemp(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const state = await lstat(root, { bigint: true });
  owned.push({ root, state, resolved: await realpath(root) });
  return root;
}
after(async () => {
  for (const { root, state, resolved } of owned) {
    const current = await lstat(root, { bigint: true });
    assert(current.isDirectory() && !current.isSymbolicLink(), "owned fixture root redirected");
    assert.equal(await realpath(root), resolved);
    assert.equal(current.dev, state.dev);
    assert.equal(current.ino, state.ino);
    await rm(root, { recursive: true, force: true });
  }
});
