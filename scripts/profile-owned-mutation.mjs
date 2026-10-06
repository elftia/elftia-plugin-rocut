import assert from "node:assert/strict";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { loadRocutProbe } from "./rocut-probe-source.mjs";

const { probePreviewMutation } = await loadRocutProbe(
  "probe-preview-mutation.mjs",
);
for (const key of [
  "ELFTIA_WORKTREE",
  "ELFTIA_TEST_SESSION",
  "ELFTIA_CLI_DEBUG_PORT",
  "ELFTIA_PROFILE_PROJECT",
])
  assert(process.env[key], `Missing ${key}`);
const host = await realpath(process.env.ELFTIA_WORKTREE);
const folder = await realpath(join(host, ".tmp-rocut-e2e/project"));
const project = await realpath(process.env.ELFTIA_PROFILE_PROJECT);
const nested = relative(folder, project);
assert(nested && !nested.startsWith("..") && !isAbsolute(nested));
const { connect } = await import(
  pathToFileURL(join(host, "packages/elftia-cli/src/connect.ts")).href
);
const conn = await connect({
  mode: "attach",
  port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
const work = await mkdtemp(join(host, ".tmp-rocut-e2e/mutation-profile-"));
const evidence = { acceptanceEligible: false, checks: [], network: [] };
let profiler,
  previous,
  cpuStarted = false;
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
    .waitFor({ state: "detached" });
  await conn.page.evaluate(
    async ({ folder, project }) => {
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
  const slot = conn.page.locator(
    '[data-testid="webpane-tab-slot"][data-tool-id="rocut"] iframe',
  );
  await slot.waitFor();
  const frame = await (await slot.elementHandle()).contentFrame();
  assert(frame);
  await frame.locator('[data-testid="timeline-clip"]').first().waitFor();
  previous = conn.page.viewportSize();
  await conn.page.setViewportSize({ width: 1920, height: 1080 });
  profiler = await conn.context.newCDPSession(frame);
  // Observe transport through CDP only. Stores may retain a fetch function:
  // replacing window.fetch and deleting its dependencies poisons later saves.
  const pending = new Map();
  profiler.on("Network.requestWillBeSent", (event) => {
    if (!new URL(event.request.url).pathname.endsWith("/api/record")) return;
    const request = {
      id: event.requestId,
      method: event.request.method,
      start: event.wallTime * 1000,
      stamp: event.timestamp,
      bytes: event.request.postData?.length ?? 0,
    };
    pending.set(event.requestId, request);
    evidence.network.push(request);
  });
  profiler.on("Network.loadingFinished", (event) => {
    const request = pending.get(event.requestId);
    if (request) request.duration = (event.timestamp - request.stamp) * 1000;
  });
  await profiler.send("Network.enable");
  await profiler.send("Performance.enable");
  const before = Date.now();
  const metrics = await profiler.send("Performance.getMetrics");
  evidence.clock = {
    before,
    after: Date.now(),
    timestamp: metrics.metrics.find((m) => m.name === "Timestamp").value,
  };
  if (process.env.ROCUT_PROFILE_CPU === "1") {
    await profiler.send("Profiler.enable");
    await profiler.send("Profiler.start");
    cpuStarted = true;
  }
  await probePreviewMutation({
    page: frame,
    hostPage: conn.page,
    work,
    evidence,
    onPhase: console.log,
  });
} catch (error) {
  evidence.error = String(error.message).replace(
    /https?:\/\/[^\s"')]+/g,
    "[URL]",
  );
  process.exitCode = 1;
} finally {
  if (profiler) {
    if (cpuStarted) {
      const { profile } = await profiler.send("Profiler.stop");
      // Private local evidence: raw CPU profiles contain authenticated URLs.
      await writeFile(
        join(work, "mutation.cpuprofile"),
        JSON.stringify(profile),
      );
    }
    await profiler.detach();
  }
  await writeFile(
    join(work, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  if (previous) await conn.page.setViewportSize(previous);
  else {
    const metrics = await conn.context.newCDPSession(conn.page);
    try {
      await metrics.send("Emulation.clearDeviceMetricsOverride");
    } finally {
      await metrics.detach();
    }
  }
  await conn.close();
  console.log(
    JSON.stringify({ work, acceptanceEligible: false, error: evidence.error }),
  );
}
