import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

for (const key of [
  "ELFTIA_WORKTREE",
  "ROCUT_WORKTREE",
  "ELFTIA_TEST_SESSION",
  "ELFTIA_CLI_DEBUG_PORT",
  "ELFTIA_REUSE_TEST_PROJECT",
])
  assert(process.env[key], `Missing ${key}`);
const host = await realpath(process.env.ELFTIA_WORKTREE);
const rocut = await realpath(process.env.ROCUT_WORKTREE);
const folder = await realpath(join(host, ".tmp-rocut-e2e/project"));
const restore = await realpath(process.env.ELFTIA_REUSE_TEST_PROJECT);
const contained = (path) => {
  const rel = relative(folder, path);
  assert(
    rel && !rel.startsWith("..") && !isAbsolute(rel),
    "Only owned E2E projects",
  );
};
contained(restore);
const work = await mkdtemp(
  join(host, ".tmp-rocut-e2e/installed-sound-insertion-"),
);
const importFile = (path) => import(pathToFileURL(path).href);
const { connect } = await importFile(
  join(host, "packages/elftia-cli/src/connect.ts"),
);
const { expect } = await importFile(
  join(rocut, "node_modules/@playwright/test/index.mjs"),
);
const { reloadEditorFrame } = await importFile(
  join(rocut, "script/probe-reload-editor.mjs"),
);
const { attachAudioOutputObserver, observeAudioPlayback } = await importFile(
  join(rocut, "script/probe-audio-format-output.mjs"),
);
const { downloadUiExport } = await importFile(
  join(rocut, "script/probe-ui-export-fixture.mjs"),
);
// Self-generated PCM fixture; no external provider/account and no user media.
const wav = Buffer.alloc(44 + 8000 * 4 * 2);
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
    Math.round(3000 * Math.sin((2 * Math.PI * 880 * i) / 8000)),
    44 + i * 2,
  );
let offline = false,
  requests = 0;
const server = createServer((request, response) => {
  requests++;
  if (request.url !== "/fixture.wav") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(offline ? 503 : 200, {
    "Content-Type": "audio/wav",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  response.end(offline ? undefined : wav);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const sourceUrl = `http://127.0.0.1:${server.address().port}/fixture.wav`;
const conn = await connect({
  mode: "attach",
  port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
const previousViewport = conn.page.viewportSize();
const evidence = {
  kind: "installed-saved-sound-insertion",
  fixtureSetup:
    "host-created isolated project and API-seeded Saved record, not online-provider/search acceptance",
  checks: [],
  errors: [],
  passed: false,
};
const check = (name, details = {}) =>
  evidence.checks.push({ name, ...details, pass: true });
const scrub = (error) =>
  String(error?.message ?? error).replace(/https?:\/\/\S+/g, "[redacted-url]");
const onError = (error) => evidence.errors.push(scrub(error));
let editor, project, downloadCdp, metricsCdp, restoreHash;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function closeWorkspace() {
  const close = conn.page.locator(
    '[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
  );
  if (await close.count()) await close.click();
  await conn.page
    .locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]')
    .waitFor({ state: "detached", timeout: 20000 });
}
async function getEditor() {
  await conn.page
    .locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
    .click();
  await expect
    .poll(
      async () => {
        for (const frame of conn.page.frames())
          if (
            (await frame.title().catch(() => "")).startsWith("OpenCut editor")
          ) {
            editor = frame;
            return true;
          }
        return false;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await editor
    .getByLabel("Media", { exact: true })
    .waitFor({ state: "visible", timeout: 30000 });
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
  metricsCdp = await conn.context.newCDPSession(conn.page);
  await metricsCdp.send("Emulation.clearDeviceMetricsOverride");
  project = await conn.page.evaluate(
    async ({ folder, name }) => {
      const created = await window.native.toolHosts.createProject({
        toolId: "rocut",
        workingFolder: folder,
        name,
      });
      await window.native.toolHosts.openProject({
        toolId: "rocut",
        workingFolder: folder,
        projectPath: created.path,
      });
      return created.path;
    },
    { folder, name: "sound-insertion-" + Date.now() },
  );
  contained(await realpath(project));
  evidence.project = project;
  await getEditor();
  conn.page.on("pageerror", onError);
  const record = () =>
    editor.evaluate(
      async () =>
        (await (await fetch(new URL("api/record", location.href))).json())
          .record,
    );
  const audio = async () =>
    (await record()).data.scenes.flatMap((scene) =>
      scene.tracks.audio.flatMap((track) => track.elements),
    );
  assert.equal((await audio()).length, 0);
  const seeded = await editor.evaluate(async (previewUrl) => {
    const endpoint = new URL(
      "api/library/saved-sounds/user-sounds",
      location.href,
    );
    const existing = await fetch(endpoint);
    if (existing.status !== 404)
      throw new Error("Fresh fixture already has Saved data");
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        data: {
          sounds: [
            {
              id: 880,
              name: "Owned 880Hz tone",
              username: "E2E fixture",
              previewUrl,
              duration: 1,
              tags: [],
              license: "self-generated",
              savedAt: new Date().toISOString(),
            },
          ],
        },
      }),
    });
    return response.status;
  }, sourceUrl);
  assert.equal(seeded, 200);
  await editor.evaluate(() => {
    const NativeAudio = window.Audio;
    const audios = [];
    window.Audio = class extends NativeAudio {
      constructor(src) {
        super(src);
        this.volume = 0;
        audios.push(this);
      }
    };
    window.__savedPreviewAudit = () =>
      audios.map((a) => ({
        paused: a.paused,
        src: a.getAttribute("src"),
        time: a.currentTime,
      }));
  });
  await editor.getByLabel("Sounds", { exact: true }).click();
  await editor.getByRole("tab", { name: "Saved", exact: true }).click();
  await editor
    .getByRole("button", { name: "Owned 880Hz tone E2E fixture", exact: true })
    .click();
  await expect
    .poll(() =>
      editor.evaluate(() =>
        window.__savedPreviewAudit().some((a) => !a.paused && a.time > 0),
      ),
    )
    .toBe(true);
  await editor.getByLabel("Media", { exact: true }).click();
  await expect
    .poll(() =>
      editor.evaluate(() =>
        window.__savedPreviewAudit().every((a) => a.paused && a.src === null),
      ),
    )
    .toBe(true);
  check("Actual Saved audition advances and releases its source on panel exit");
  await editor.getByLabel("Sounds", { exact: true }).click();
  await editor.getByRole("tab", { name: "Saved", exact: true }).click();
  await editor.getByTitle("Add to timeline", { exact: true }).click();
  await expect.poll(async () => (await audio()).length).toBe(1);
  const inserted = (await audio())[0];
  assert.equal(inserted.sourceType, "upload");
  assert.equal(inserted.duration, 480000);
  assert.equal(inserted.buffer, undefined);
  assert.match(inserted.mediaId, /^[a-zA-Z0-9-]+$/);
  assert.equal(
    hash(
      await readFile(
        join(project, "attachments", inserted.mediaId, "body.bin"),
      ),
    ),
    hash(wav),
  );
  await expect(editor.getByTestId("timeline-clip")).toHaveCount(1);
  check(
    "Actual Add creates a durable media asset with exact bytes and decoded 4-second duration",
  );
  await conn.page.keyboard.press("Control+z");
  await expect.poll(async () => (await audio()).length).toBe(0);
  await conn.page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await audio()).length).toBe(1);
  assert.equal((await audio())[0].mediaId, inserted.mediaId);
  check("Real keyboard Undo/Redo preserves the imported asset");
  offline = true;
  await reloadEditorFrame(editor);
  assert.equal((await audio())[0].mediaId, inserted.mediaId);
  await attachAudioOutputObserver(editor);
  check("Reopened timeline plays actual 880Hz output without provider", {
    playback: await observeAudioPlayback(editor),
  });
  await editor.getByTestId("editor-menu-trigger").click();
  await editor
    .getByRole("menuitem", { name: "Export project", exact: true })
    .click();
  const dialog = editor.getByRole("dialog", {
    name: "Export project",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  downloadCdp = await conn.context.browser().newBrowserCDPSession();
  await downloadCdp.send("Browser.setDownloadBehavior", {
    behavior: "allowAndName",
    downloadPath: work,
    eventsEnabled: true,
  });
  const output = await downloadUiExport(downloadCdp, dialog, work);
  const pcm = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      output.path,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { windowsHide: true },
  );
  let energy = 0,
    crossings = 0,
    previous = 0;
  for (let i = 0; i < pcm.length; i += 4) {
    const v = pcm.readFloatLE(i);
    energy += v * v;
    if (previous <= 0 && v > 0) crossings++;
    previous = v;
  }
  const seconds = pcm.length / 4 / 8000,
    rms = Math.sqrt(energy / (pcm.length / 4)),
    hz = crossings / seconds;
  assert(
    Math.abs(seconds - 4) < 0.15 && rms > 0.015 && Math.abs(hz - 880) < 15,
    JSON.stringify({ seconds, rms, hz }),
  );
  check("Real menu export independently decodes to the complete 880Hz sound", {
    seconds,
    rms,
    hz,
  });
  await editor.getByLabel("Sounds", { exact: true }).click();
  await editor.getByRole("tab", { name: "Saved", exact: true }).click();
  let injected = 0;
  const failClear = (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    injected++;
    return route.fulfill({
      status: 503,
      json: { error: "owned-clear-failure" },
    });
  };
  const clearRoute = /\/api\/library\/saved-sounds$/;
  await conn.context.route(clearRoute, failClear);
  await editor.getByRole("button", { name: "Clear all", exact: true }).click();
  await editor
    .getByRole("button", { name: "Clear all sounds", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText(
    "Saved sounds could not be persisted",
  );
  assert.equal(injected, 1);
  await conn.context.unroute(clearRoute, failClear);
  await editor
    .getByRole("button", { name: "Reload saved sounds", exact: true })
    .click();
  await expect(
    editor.getByRole("button", {
      name: "Owned 880Hz tone E2E fixture",
      exact: true,
    }),
  ).toBeVisible();
  check(
    "Failed namespace clear leaves data intact and real Reload recovers the panel",
  );
  await editor.getByRole("button", { name: "Clear all", exact: true }).click();
  await editor
    .getByRole("button", { name: "Clear all sounds", exact: true })
    .click();
  await expect(
    editor.getByText("No saved sounds", { exact: true }),
  ).toBeVisible();
  assert.equal((await audio())[0].mediaId, inserted.mediaId);
  assert.equal(
    hash(
      await readFile(
        join(project, "attachments", inserted.mediaId, "body.bin"),
      ),
    ),
    hash(wav),
  );
  check("Clear Saved leaves the independently imported timeline audio intact");
  await conn.page.screenshot({ path: join(work, "result.png") });
  assert.deepEqual(evidence.errors, []);
  evidence.passed = true;
} catch (error) {
  evidence.error = scrub(error);
  process.exitCode = 1;
  await conn.page
    .screenshot({ path: join(work, "failure.png") })
    .catch(() => {});
} finally {
  try {
    if (project) {
      await closeWorkspace();
      assert.equal(
        hash(await readFile(join(restore, "project.json"))),
        restoreHash,
        "Previous E2E project unchanged while testing",
      );
      await conn.page.evaluate(
        async ({ folder, projectPath }) => {
          await window.native.toolHosts.openProject({
            toolId: "rocut",
            workingFolder: folder,
            projectPath,
          });
        },
        { folder, projectPath: restore },
      );
      await getEditor();
      evidence.restored = true;
    }
  } catch (error) {
    evidence.restoreError = scrub(error);
    evidence.passed = false;
    process.exitCode = 1;
  }
  if (downloadCdp) {
    await downloadCdp.send("Browser.setDownloadBehavior", {
      behavior: "default",
    });
    await downloadCdp.detach();
  }
  if (metricsCdp) await metricsCdp.detach();
  if (previousViewport) await conn.page.setViewportSize(previousViewport);
  conn.page.off("pageerror", onError);
  await conn.close();
  await new Promise((resolve) => server.close(resolve));
  evidence.fixtureRequests = requests;
  await writeFile(
    join(work, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify({ work, ...evidence }));
}
