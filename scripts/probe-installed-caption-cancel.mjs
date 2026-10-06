import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, loadRocutProbe } from "./rocut-probe-source.mjs";
const { reloadEditorFrame } = await loadRocutProbe("probe-reload-editor.mjs");

for (const key of [
  "ELFTIA_WORKTREE",
  "ELFTIA_TEST_SESSION",
  "ELFTIA_CLI_DEBUG_PORT",
  "ELFTIA_REUSE_TEST_PROJECT",
  "ELFTIA_INSTALLED_ROCUT",
])
  assert(process.env[key], `Missing ${key}`);
const host = await realpath(process.env.ELFTIA_WORKTREE);
const folder = await realpath(join(host, ".tmp-rocut-e2e/project"));
const restore = await realpath(process.env.ELFTIA_REUSE_TEST_PROJECT);
const installed = await realpath(process.env.ELFTIA_INSTALLED_ROCUT);
const contained = (path) => {
  const rel = relative(folder, path);
  assert(
    rel && !rel.startsWith("..") && !isAbsolute(rel),
    "Owned E2E projects only",
  );
};
contained(restore);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const work = await mkdtemp(
  join(host, ".tmp-rocut-e2e/installed-caption-cancel-"),
);
const { connect } = await import(
  pathToFileURL(join(host, "packages/elftia-cli/src/connect.ts")).href
);
const conn = await connect({
  mode: "attach",
  port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
const previousViewport = conn.page.viewportSize();
const evidence = {
  kind: "installed-caption-cancellation-and-durable-import",
  fixtureSetup:
    "Owned project; self-generated PCM. Model requests intercepted before network; no inference success claim.",
  checks: [],
  errors: [],
  passed: false,
};
const check = (name, details = {}) =>
  evidence.checks.push({ name, ...details, pass: true });
const scrub = (error) =>
  String(error?.message ?? error)
    .replace(/data:[^\s'"]+/g, "[redacted-data]")
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .slice(0, 3000);
const onError = (error) => evidence.errors.push(scrub(error));
let editor, project, browserCdp, restoreHash, recordRoute, recordUrl;
const pendingModels = [];
let modelRequests = 0;
const modelPattern = /\/onnx-community\/whisper-[^/]+\//;
const holdModel = async (route) => {
  modelRequests++;
  await new Promise((resolve) => pendingModels.push({ route, resolve }));
};
async function releaseModels() {
  for (const pending of pendingModels.splice(0)) {
    await pending.route.abort().catch(() => {});
    pending.resolve();
  }
}
async function closeWorkspace() {
  const close = conn.page.locator(
    '[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
  );
  if (await close.count()) await close.click();
  await conn.page
    .locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]')
    .waitFor({ state: "detached", timeout: 20000 });
}
async function selectAssets() {
  const tab = editor.getByRole("tab", { name: "Media & text", exact: true });
  if (await tab.isVisible()) await tab.click();
}
async function openProject(path) {
  const opened = await conn.page.evaluate(
    async ({ folder, path }) =>
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
  await selectAssets();
  await editor.getByLabel("Media", { exact: true }).waitFor({ timeout: 30000 });
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
  await closeWorkspace();
  restoreHash = hash(await readFile(join(restore, "project.json")));
  await conn.page.setViewportSize({ width: 1100, height: 800 });
  project = await conn.page.evaluate(
    async ({ folder, name }) =>
      (
        await window.native.toolHosts.createProject({
          toolId: "rocut",
          workingFolder: folder,
          name,
        })
      ).path,
    { folder, name: `caption-cancel-${Date.now()}` },
  );
  contained(await realpath(project));
  evidence.project = project;
  await openProject(project);
  conn.page.on("pageerror", onError);
  const asset = await editor.evaluate(
    () =>
      new URL(
        [...document.scripts].find((script) =>
          script.src.includes("/assets/app-"),
        )?.src,
      ).pathname.split("/assets/")[1],
  );
  assert(asset && !asset.includes("/"));
  evidence.asset = {
    name: asset,
    sha256: hash(
      await readFile(join(installed, "vendor/surface/assets", asset)),
    ),
  };
  const servedHash = await editor.evaluate(async () => {
    const bytes = await (
      await fetch(
        [...document.scripts].find((script) =>
          script.src.includes("/assets/app-"),
        ).src,
      )
    ).arrayBuffer();
    return Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
  });
  assert.equal(servedHash, evidence.asset.sha256);
  const record = () =>
    editor.evaluate(
      async () =>
        (await (await fetch(new URL("api/record", location.href))).json())
          .record,
    );
  const captionCount = async () =>
    (await record()).data.scenes.reduce(
      (count, scene) =>
        count +
        scene.tracks.overlay
          .filter((track) => track.type === "text")
          .reduce((sum, track) => sum + track.elements.length, 0),
      0,
    );
  // Four seconds of self-generated tone, imported through the actual Media file input.
  const wav = Buffer.alloc(44 + 32000 * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 32000; i++)
    wav.writeInt16LE(
      Math.round(2000 * Math.sin((2 * Math.PI * 440 * i) / 8000)),
      44 + i * 2,
    );
  await editor.locator('input[type="file"]').first().setInputFiles({
    name: "owned-caption.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await editor
    .getByLabel("Add owned-caption.wav to timeline", { exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await record()).data.scenes.flatMap((scene) =>
          scene.tracks.audio.flatMap((track) => track.elements),
        ).length,
    )
    .toBe(1);
  await selectAssets();
  await editor.getByLabel("Captions", { exact: true }).click();
  const generate = () =>
    editor.getByRole("button", { name: "Generate transcript", exact: true });
  const cancel = () =>
    editor.getByRole("button", {
      name: "Cancel caption operation",
      exact: true,
    });
  await expect(generate()).toBeEnabled();
  // Let the just-inserted audio's derived duration reach its normal autosave.
  await expect
    .poll(async () => (await record()).data.metadata.duration)
    .toBe(480000);
  // Thumbnail/timestamps/view state are normal UI save bookkeeping, not edits.
  // Preserve all other fields, including domain content, duration and ledger.
  const authoredHash = (record) => {
    const copy = structuredClone(record);
    delete copy.data.metadata.thumbnail;
    delete copy.data.metadata.updatedAt;
    delete copy.data.timelineViewState;
    for (const scene of copy.data.scenes) delete scene.updatedAt;
    return hash(JSON.stringify(copy));
  };
  const baseline = authoredHash(await record());
  await conn.context.route(modelPattern, holdModel);
  browserCdp = await conn.context.browser().newBrowserCDPSession();
  const targets = async () =>
    (await browserCdp.send("Target.getTargets")).targetInfos;
  const baselineTargets = new Set(
    (await targets()).map((target) => target.targetId),
  );
  let priorWorker;
  for (const mode of ["cancel", "retry", "panel-exit"]) {
    const beforeRequests = modelRequests;
    await generate().click();
    await expect(cancel()).toBeVisible();
    await expect
      .poll(() => modelRequests, { timeout: 30000 })
      .toBeGreaterThan(beforeRequests);
    let worker;
    await expect
      .poll(
        async () => {
          worker = (await targets()).find(
            (target) =>
              target.type === "worker" && !baselineTargets.has(target.targetId),
          );
          return Boolean(worker);
        },
        { timeout: 10000 },
      )
      .toBe(true);
    assert.notEqual(
      worker.targetId,
      priorWorker,
      "Retry must create a fresh native worker",
    );
    priorWorker = worker.targetId;
    if (mode === "panel-exit")
      await editor.getByLabel("Media", { exact: true }).click();
    else {
      await cancel().focus();
      await conn.page.keyboard.press("Enter");
    }
    await expect
      .poll(async () =>
        (await targets()).some((target) => target.targetId === worker.targetId),
      )
      .toBe(false);
    await releaseModels();
    if (mode === "panel-exit")
      await editor.getByLabel("Captions", { exact: true }).click();
    else await expect(generate()).toBeFocused();
    await expect(generate()).toBeVisible();
    await expect(editor.getByRole("alert")).toHaveCount(0);
    assert.equal(
      authoredHash(await record()),
      baseline,
      "ASR must not change authored project content or its ledger",
    );
    check(
      `Actual ASR ${mode} destroys the native Worker and leaves authored content unchanged`,
    );
  }
  await conn.context.unroute(modelPattern, holdModel);
  const importSubtitle = async (name) => {
    await selectAssets();
    const chooser = conn.page.waitForEvent("filechooser");
    await editor.getByRole("button", { name: "Import", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nOwned caption\n"),
    });
  };
  await editor.evaluate(() => {
    const original = File.prototype.text;
    const pending = [];
    File.prototype.text = function () {
      if (this.name !== "delayed.srt") return original.call(this);
      return new Promise((resolve) =>
        pending.push(() => original.call(this).then(resolve)),
      );
    };
    window.__releaseCaptionReads = async () => {
      await Promise.all(pending.splice(0).map((release) => release()));
    };
  });
  await importSubtitle("delayed.srt");
  await expect(cancel()).toBeVisible();
  await cancel().click();
  await editor.evaluate(() => window.__releaseCaptionReads());
  assert.equal(
    authoredHash(await record()),
    baseline,
    "Cancelled subtitle read must publish nothing",
  );
  await importSubtitle("caption.srt");
  await expect.poll(captionCount).toBe(1);
  await conn.page.keyboard.press("Control+z");
  await expect.poll(captionCount).toBe(0);
  await conn.page.keyboard.press("Control+Shift+z");
  await expect.poll(captionCount).toBe(1);
  check(
    "Actual file chooser supports cancellation, fresh import and keyboard Undo/Redo",
  );
  const beforeFailure = authoredHash(await record());
  recordUrl = await editor.evaluate(
    () => new URL("api/record", location.href).href,
  );
  let injected = 0;
  recordRoute = async (route) => {
    const request = route.request();
    const proposedCaptions =
      request.method() === "PUT"
        ? request
            .postDataJSON()
            .record.data.scenes.flatMap((scene) =>
              scene.tracks.overlay
                .filter((track) => track.type === "text")
                .flatMap((track) => track.elements),
            ).length
        : 0;
    if (proposedCaptions === 2) {
      injected++;
      return route.fulfill({
        status: 503,
        json: { error: "owned-caption-save-unavailable" },
      });
    }
    return route.continue();
  };
  await conn.context.route(recordUrl, recordRoute);
  await importSubtitle("failure.srt");
  await expect(editor.getByRole("alert")).toContainText(
    /503|unavailable|save|persist/i,
  );
  assert.equal(injected, 1);
  assert.equal(
    authoredHash(await record()),
    beforeFailure,
    "Failed caption save must publish nothing",
  );
  await conn.context.unroute(recordUrl, recordRoute);
  recordRoute = undefined;
  await importSubtitle("retry.srt");
  await expect.poll(captionCount).toBe(2);
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await reloadEditorFrame(editor);
  assert.equal(await captionCount(), 2);
  check(
    "Actual HTTP save failure is visible; retry saves durably and survives reload",
  );
  await conn.page.screenshot({ path: join(work, "result.png") });
  assert.deepEqual(evidence.errors, []);
  evidence.modelRequestsIntercepted = modelRequests;
  evidence.passed = true;
} catch (error) {
  evidence.error = scrub(error);
  await conn.page
    .screenshot({ path: join(work, "failure.png") })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  conn.page.off("pageerror", onError);
  try {
    await closeWorkspace();
    await releaseModels();
    await conn.context.unroute(modelPattern, holdModel);
    if (recordRoute) await conn.context.unroute(recordUrl, recordRoute);
    if (restoreHash)
      assert.equal(
        hash(await readFile(join(restore, "project.json"))),
        restoreHash,
      );
    await openProject(restore);
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
  await browserCdp?.detach().catch(() => {});
  await writeFile(
    join(work, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await conn.close();
  console.log(JSON.stringify({ work, ...evidence }));
}
