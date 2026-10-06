import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

for (const key of [
  "ELFTIA_WORKTREE",
  "ELFTIA_TEST_SESSION",
  "ELFTIA_CLI_DEBUG_PORT",
  "ELFTIA_INSTALLED_ROCUT",
  "ELFTIA_REUSE_TEST_PROJECT",
])
  assert(process.env[key], `Missing ${key}`);
const host = await realpath(process.env.ELFTIA_WORKTREE);
const folder = await realpath(join(host, ".tmp-rocut-e2e/project"));
const project = await realpath(process.env.ELFTIA_REUSE_TEST_PROJECT);
const rel = relative(folder, project);
assert(
  rel && !rel.startsWith("..") && !isAbsolute(rel),
  "Owned E2E project required",
);
const installed = resolve(process.env.ELFTIA_INSTALLED_ROCUT);
const source = fileURLToPath(new URL("../dist/rocut", import.meta.url));
const backupRoot = join(host, ".tmp-rocut-e2e/archived-plugin-backups");
const normalized = (path) => resolve(path).toLowerCase();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function inventory(root) {
  assert.equal(
    normalized(await realpath(root)),
    normalized(root),
    "No redirected tree",
  );
  const files = [];
  async function visit(path, rel) {
    const stat = await lstat(path);
    assert(!stat.isSymbolicLink(), "No redirected entries");
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name), rel ? `${rel}/${name}` : name);
    } else {
      assert(stat.isFile(), "Regular files only");
      files.push({
        path: rel,
        bytes: stat.size,
        sha256: hash(await readFile(path)),
      });
    }
  }
  await visit(root, "");
  return { files, sha256: hash(JSON.stringify(files)) };
}
const { connect } = await import(
  pathToFileURL(join(host, "packages/elftia-cli/src/connect.ts")).href
);
const conn = await connect({
  mode: "attach",
  port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
try {
  const owner = await conn.page.evaluate(
    async (id) => ({
      active: document
        .querySelector('[data-session-active="true"]')
        ?.getAttribute("data-session-id"),
      folder: (await window.native.sessions.chat.get(id)).projectPath,
    }),
    process.env.ELFTIA_TEST_SESSION,
  );
  assert.equal(owner.active, process.env.ELFTIA_TEST_SESSION);
  assert.equal(await realpath(owner.folder), folder);
  const close = conn.page.locator(
    '[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
  );
  if (await close.count()) await close.click();
  await conn.page
    .locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]')
    .waitFor({ state: "detached", timeout: 20000 });
  const projectHash = hash(await readFile(join(project, "project.json")));
  const before = await inventory(installed);
  const candidate = await inventory(source);
  assert.equal(normalized(await realpath(backupRoot)), normalized(backupRoot));
  const work = await mkdtemp(
    join(backupRoot, "rocut-0.5.0-before-caption-cancel-"),
  );
  const backup = join(work, "rocut");
  await cp(installed, backup, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  assert.deepEqual((await inventory(backup)).files, before.files);
  assert.deepEqual((await inventory(installed)).files, before.files);
  const evidence = {
    backup,
    backupFiles: before.files.length,
    backupSha256: before.sha256,
    installedFiles: candidate.files.length,
    expectedSha256: candidate.sha256,
    parity: false,
  };
  await writeFile(
    join(work, "installation-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      backup,
      backupVerified: true,
      files: before.files.length,
    }),
  );
  const result = await conn.page.evaluate(async (path) => {
    const response = await window.native.plugins.installLocal({ path });
    return { success: response.success, id: response.plugin?.id };
  }, source);
  assert.notEqual(result.success, false, "Host refused installation");
  assert.deepEqual((await inventory(installed)).files, candidate.files);
  assert.equal(
    hash(await readFile(join(project, "project.json"))),
    projectHash,
  );
  await conn.page.evaluate(
    async ({ folder, project }) => {
      await window.native.plugins.setEnabled({ id: "rocut", enabled: true });
      await window.native.toolHosts.openProject({
        toolId: "rocut",
        workingFolder: folder,
        projectPath: project,
      });
    },
    { folder, project },
  );
  await conn.page
    .locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
    .click();
  evidence.parity = true;
  await writeFile(
    join(work, "installation-evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
} finally {
  await conn.close();
}
