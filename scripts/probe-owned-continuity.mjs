import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, loadRocutProbe } from "./rocut-probe-source.mjs";

// Continue the exact failed, test-owned fixture; never reroll its plan to pass.
for (const key of [
  "ELFTIA_WORKTREE",
  "ELFTIA_TEST_SESSION",
  "ELFTIA_CLI_DEBUG_PORT",
  "ELFTIA_REUSE_TEST_PROJECT",
  "ELFTIA_INSTALLED_ROCUT",
  "ELFTIA_CONTINUITY_SOURCE_MEDIA",
  "ELFTIA_CONTINUITY_SOURCE_SHA256",
])
  assert(process.env[key], `Missing ${key}`);
const host = await realpath(process.env.ELFTIA_WORKTREE);
const folder = await realpath(join(host, ".tmp-rocut-e2e/project"));
const project = await realpath(process.env.ELFTIA_REUSE_TEST_PROJECT);
const installed = await realpath(process.env.ELFTIA_INSTALLED_ROCUT);
const rel = relative(folder, project);
assert(
  rel && !rel.startsWith("..") && !isAbsolute(rel),
  "Owned fixture required",
);
const work = await mkdtemp(join(host, ".tmp-rocut-e2e/owned-continuity-"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = await realpath(process.env.ELFTIA_CONTINUITY_SOURCE_MEDIA);
const sourceRel = relative(
  await realpath(join(host, ".tmp-rocut-e2e")),
  source,
);
assert(
  sourceRel && !sourceRel.startsWith("..") && !isAbsolute(sourceRel),
  "Owned source media required",
);
const sourceBytes = await readFile(source);
assert.equal(
  hash(sourceBytes),
  process.env.ELFTIA_CONTINUITY_SOURCE_SHA256,
  "Source must match original fixture evidence",
);
await writeFile(join(work, "continuity-underlay.mp4"), sourceBytes, {
  flag: "wx",
});
const evidence = {
  kind: "existing-owned-continuity",
  acceptanceEligible: false,
  checks: [],
  errors: [],
  passed: false,
};
const scrub = (error) =>
  String(error?.message ?? error)
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .slice(0, 3000);
const onError = (error) => evidence.errors.push(scrub(error));
const { connect } = await import(
  pathToFileURL(join(host, "packages/elftia-cli/src/connect.ts")).href
);
const { probeMotionClipContinuity } = await loadRocutProbe(
  "probe-motion-clip-continuity.mjs",
);
const conn = await connect({
  mode: "attach",
  port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
const viewport = conn.page.viewportSize();
let phase = "ownership";
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
  const before = JSON.parse(
    await readFile(join(project, "project.json"), "utf8"),
  );
  const sequence = before.record.data.motionTextSequences[0];
  assert.equal(
    sequence.duration,
    720000,
    "This helper requires the six-second linked fixture",
  );
  evidence.originalPlanSha256 = hash(JSON.stringify(sequence));
  const close = conn.page.locator(
    '[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
  );
  if (await close.count()) await close.click();
  await conn.page
    .locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]')
    .waitFor({ state: "detached", timeout: 20000 });
  const opened = await conn.page.evaluate(
    async ({ folder, project }) =>
      window.native.toolHosts.openProject({
        toolId: "rocut",
        workingFolder: folder,
        projectPath: project,
      }),
    { folder, project },
  );
  await conn.page
    .locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
    .click();
  let editor;
  await expect
    .poll(
      async () => {
        for (const frame of conn.page.frames()) {
          if (
            (await frame.evaluate(() => location.href).catch(() => "")) ===
            opened.editorUrl
          ) {
            editor = frame;
            return true;
          }
        }
        return false;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  const stored = await editor.evaluate(
    async () =>
      (await (await fetch(new URL("api/record", location.href))).json()).record,
  );
  assert.equal(stored.id, before.record.id);
  assert.deepEqual(
    stored.data.motionTextSequences[0],
    sequence,
    "Must preserve exact failed plan",
  );
  const asset = await editor.evaluate(
    () =>
      new URL(
        [...document.scripts].find((s) => s.src.includes("/assets/app-")).src,
      ).pathname.split("/assets/")[1],
  );
  assert(asset && !asset.includes("/"));
  const served = await editor.evaluate(async () => {
    const bytes = await (
      await fetch(
        [...document.scripts].find((s) => s.src.includes("/assets/app-")).src,
      )
    ).arrayBuffer();
    return Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
  });
  evidence.asset = {
    name: asset,
    sha256: hash(
      await readFile(join(installed, "vendor/surface/assets", asset)),
    ),
  };
  assert.equal(served, evidence.asset.sha256);
  conn.page.on("pageerror", onError);
  await probeMotionClipContinuity({
    page: editor,
    hostPage: conn.page,
    work,
    evidence,
    existingLyrics: true,
    onPhase: (value) => {
      phase = value;
      console.log("phase:", value);
    },
  });
  assert.deepEqual(evidence.errors, []);
  evidence.passed = true;
} catch (error) {
  evidence.failure = { phase, message: scrub(error) };
  await conn.page
    .screenshot({ path: join(work, "failure.png") })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  conn.page.off("pageerror", onError);
  try {
    if (viewport) await conn.page.setViewportSize(viewport);
    else {
      const cdp = await conn.context.newCDPSession(conn.page);
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await cdp.detach();
    }
  } catch (error) {
    evidence.cleanupFailure = scrub(error);
    evidence.passed = false;
    process.exitCode = 1;
  }
  await writeFile(
    join(work, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await conn.close();
  console.log(
    JSON.stringify({
      work,
      passed: evidence.passed,
      checks: evidence.checks.length,
      failure: evidence.failure,
    }),
  );
}
