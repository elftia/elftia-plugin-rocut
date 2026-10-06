import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "./rocut-probe-source.mjs";
import { summarizePresentation } from "./probe-presentation-report.mjs";
import { startPrivateTrace } from "./probe-private-trace.mjs";

for (const key of [
  "ELFTIA_WORKTREE",
  "ELFTIA_TEST_SESSION",
  "ELFTIA_CLI_DEBUG_PORT",
  "ELFTIA_REUSE_TEST_PROJECT",
  "ELFTIA_RESTORE_TEST_PROJECT",
  "ELFTIA_INSTALLED_ROCUT",
])
  assert(process.env[key], `Missing ${key}`);
const host = await realpath(process.env.ELFTIA_WORKTREE);
const folder = await realpath(join(host, ".tmp-rocut-e2e/project"));
const project = await realpath(process.env.ELFTIA_REUSE_TEST_PROJECT);
const restore = await realpath(process.env.ELFTIA_RESTORE_TEST_PROJECT);
for (const candidate of [project, restore]) {
  const rel = relative(folder, candidate);
  assert(
    rel && !rel.startsWith("..") && !isAbsolute(rel),
    "Owned project required",
  );
}
const installed = await realpath(process.env.ELFTIA_INSTALLED_ROCUT);
const work = await mkdtemp(join(host, ".tmp-rocut-e2e/presentation-trace-"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const scrub = (value) =>
  String(value?.message ?? value)
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .slice(0, 2000);
const projection = (record) => ({
  id: record.id,
  settings: record.data.settings,
  sequences: record.data.motionTextSequences,
  scenes: record.data.scenes.map(({ updatedAt, ...scene }) => scene),
});
const before = JSON.parse(
  await readFile(join(project, "project.json"), "utf8"),
).record;
assert.equal(before.data.motionTextSequences[0].cues.length, 120);
const evidence = {
  kind: "owned-compositor-trace-discovery",
  acceptanceEligible: false,
  measurement:
    "Trace schema discovery only; no inferred frame presentation latency",
  checks: [],
  errors: [],
  passed: false,
};
await import(
  pathToFileURL(join(host, "packages/elftia-cli/src/proxy.ts")).href
);
const { connect } = await import(
  pathToFileURL(join(host, "packages/elftia-cli/src/connect.ts")).href
);
const conn = await connect({
  mode: "attach",
  port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
const previousViewport = conn.page.viewportSize();
let frame,
  browserCdp,
  switched = false,
  previousTimecode;
let finishTrace;
const markerPrefix = `rocut-trace-${Date.now()}`;
const markers = {
  start: `${markerPrefix}-start`,
  end: `${markerPrefix}-end`,
  host: `${markerPrefix}-host`,
};
const onError = (error) => evidence.errors.push(scrub(error));
const close = async () => {
  const button = conn.page.locator(
    '[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
  );
  if (await button.count()) await button.click();
  await expect(
    conn.page.locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]'),
  ).toHaveCount(0);
};
const open = async (path) => {
  const result = await conn.page.evaluate(
    ({ folder, path }) =>
      window.native.toolHosts.openProject({
        toolId: "rocut",
        workingFolder: folder,
        projectPath: path,
      }),
    { folder, path },
  );
  await conn.page
    .locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
    .click();
  await expect
    .poll(
      () => {
        frame = conn.page
          .frames()
          .find((candidate) => candidate.url() === result.editorUrl);
        return Boolean(frame);
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await frame.getByLabel("Media", { exact: true }).waitFor({ timeout: 30000 });
};
const seek = async (value) => {
  await frame.getByLabel("Edit playhead time", { exact: true }).click();
  const input = frame.getByLabel("Playhead time", { exact: true });
  await input.fill(value);
  await input.press("Enter");
  await expect(
    frame.getByLabel("Edit playhead time", { exact: true }),
  ).toHaveText(value);
};
async function stopTrace() {
  if (!finishTrace) return;
  const finish = finishTrace;
  finishTrace = undefined;
  const raw = await finish();
  // This private artifact may contain URLs. Never print it or include it in a release.
  await writeFile(join(work, "trace.private.json"), raw);
  const trace = JSON.parse(raw.toString("utf8"));
  evidence.trace = {
    bytes: raw.length,
    sha256: hash(raw),
    eventCount: trace.traceEvents.length,
    presentation: summarizePresentation(trace, markers),
  };
}
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
  await close();
  switched = true;
  await conn.page.setViewportSize({ width: 1920, height: 1080 });
  await open(project);
  conn.page.on("pageerror", onError);
  previousTimecode = await frame
    .getByLabel("Edit playhead time", { exact: true })
    .innerText();
  evidence.asset = await frame.evaluate(async () => {
    const src = [...document.scripts].find((script) =>
      script.src.includes("/assets/app-"),
    ).src;
    return {
      name: new URL(src).pathname.split("/").pop(),
      sha256: [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            await (await fetch(src)).arrayBuffer(),
          ),
        ),
      ]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join(""),
    };
  });
  assert.equal(
    evidence.asset.sha256,
    hash(
      await readFile(
        join(installed, "vendor/surface/assets", evidence.asset.name),
      ),
    ),
  );
  browserCdp = await conn.context.browser().newBrowserCDPSession();
  const version = await browserCdp.send("Browser.getVersion");
  evidence.browser = {
    product: version.product,
    protocolVersion: version.protocolVersion,
  };
  const available = (await browserCdp.send("Tracing.getCategories")).categories;
  const wanted = [
    "blink.user_timing",
    "disabled-by-default-devtools.timeline.frame",
  ];
  evidence.categories = wanted.filter((category) =>
    available.includes(category),
  );
  assert(evidence.categories.length === wanted.length);
  await seek("00:00:00:00");
  finishTrace = await startPrivateTrace(browserCdp, evidence.categories);
  await conn.page.evaluate((name) => performance.mark(name), markers.host);
  evidence.dimensions = await frame.evaluate((name) => {
    performance.mark(name);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      canvases: [...document.querySelectorAll("canvas")].map((canvas) => ({
        width: canvas.width,
        height: canvas.height,
      })),
    };
  }, markers.start);
  await frame.getByLabel("Play preview", { exact: true }).click();
  console.log(JSON.stringify({ work, phase: "20 second real playback trace" }));
  const started = Date.now();
  evidence.clocks = [];
  while (Date.now() - started < 20000) {
    evidence.clocks.push(
      await frame.evaluate(() => ({
        timecode: document.querySelector('[aria-label="Edit playhead time"]')
          ?.textContent,
        visible: document.visibilityState,
        playing: Boolean(
          document.querySelector('[aria-label="Pause preview"]'),
        ),
      })),
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await frame.evaluate((name) => performance.mark(name), markers.end);
  await stopTrace();
  assert(
    evidence.clocks.every((row) => row.visible === "visible" && row.playing),
  );
  assert(evidence.trace.eventCount > 100);
  assert.deepEqual(evidence.errors, [], "Renderer errors during capture");
  await conn.page.screenshot({ path: join(work, "playback.png") });
  evidence.passed = true;
} catch (error) {
  evidence.error = scrub(error);
  process.exitCode = 1;
} finally {
  // Trace cleanup failure must not prevent restoration of the owned project.
  try {
    await stopTrace();
  } catch (error) {
    evidence.traceCleanupError = scrub(error);
    evidence.passed = false;
    process.exitCode = 1;
  }
  try {
    if (frame && previousTimecode !== undefined) {
      const pause = frame.getByLabel("Pause preview", { exact: true });
      if (await pause.count()) await pause.click();
      await seek(previousTimecode);
    }
    if (switched) {
      await close();
      const after = JSON.parse(
        await readFile(join(project, "project.json"), "utf8"),
      ).record;
      assert.deepEqual(projection(after), projection(before));
      await open(restore);
    }
    if (previousViewport) await conn.page.setViewportSize(previousViewport);
    else {
      const cdp = await conn.context.newCDPSession(conn.page);
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await cdp.detach();
    }
    evidence.restored = true;
  } catch (error) {
    evidence.restoreError = scrub(error);
    evidence.passed = false;
    process.exitCode = 1;
  }
  conn.page.off("pageerror", onError);
  if (evidence.errors.length) {
    evidence.passed = false;
    process.exitCode = 1;
  }
  try {
    await browserCdp?.detach();
  } catch (error) {
    evidence.traceDetachError = scrub(error);
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
      restored: evidence.restored,
      error: evidence.error,
    }),
  );
}
