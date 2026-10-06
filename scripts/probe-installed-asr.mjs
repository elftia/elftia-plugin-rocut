import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, loadRocutProbe } from "./rocut-probe-source.mjs";
import { validateAsrResult } from "./probe-asr-result.mjs";

// Explicit opt-in: real public model downloads, never paid ASR or user audio.
const durationOnly = process.env.ROCUT_ASR_DURATION_ONLY === "1";
if (!durationOnly) assert.equal(process.env.ROCUT_ALLOW_LOCAL_ASR, "1");
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
    "Owned E2E project only",
  );
};
contained(restore);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const work = await mkdtemp(join(host, ".tmp-rocut-e2e/installed-asr-"));
const wavPath = join(work, "owned-speech.wav");
const speech =
  "The blue bicycle is beside the small garden. This is a caption test.";
// Built-in local Windows speech synthesis; no network TTS.
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Add-Type -AssemblyName System.Speech; " +
      "$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
      "try { $speaker.SelectVoice('Microsoft Zira Desktop'); " +
      `$speaker.SetOutputToWaveFile('${wavPath.replaceAll("'", "''")}'); ` +
      `$speaker.Speak('${speech}'); } finally { $speaker.Dispose() }`,
  ],
  { timeout: 30000, windowsHide: true, stdio: "pipe" },
);
const { reloadEditorFrame } = await loadRocutProbe("probe-reload-editor.mjs");
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
const evidence = {
  kind: durationOnly
    ? "installed-durable-duration"
    : "installed-real-local-asr",
  speech,
  checks: [],
  errors: [],
  modelRequests: [],
  passed: false,
  audioSha256: hash(await readFile(wavPath)),
};
const scrub = (value) =>
  String(value?.message ?? value)
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .slice(0, 2000);
const onError = (error) => evidence.errors.push(scrub(error));
const onRequest = (request) => {
  const url = new URL(request.url());
  if (/huggingface\.co$|hf\.co$|xethub\.hf\.co$/.test(url.hostname))
    evidence.modelRequests.push({
      host: url.hostname,
      file: url.pathname.split("/").pop(),
      method: request.method(),
    });
};
let editor,
  restoreHash,
  switched = false;
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
        editor = conn.page
          .frames()
          .find((frame) => frame.url() === result.editorUrl);
        return Boolean(editor);
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await editor.getByLabel("Media", { exact: true }).waitFor({ timeout: 30000 });
};
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
  restoreHash = hash(await readFile(join(restore, "project.json")));
  await conn.page.setViewportSize({ width: 1920, height: 1080 });
  const project = await conn.page.evaluate(
    async ({ folder, name }) =>
      (
        await window.native.toolHosts.createProject({
          toolId: "rocut",
          workingFolder: folder,
          name,
        })
      ).path,
    { folder, name: `local-asr-${Date.now()}` },
  );
  contained(await realpath(project));
  evidence.project = project;
  await open(project);
  conn.page.on("pageerror", onError);
  conn.page.on("request", onRequest);
  evidence.asset = await editor.evaluate(async () => {
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
  const record = () =>
    editor.evaluate(
      async () =>
        (await (await fetch(new URL("api/record", location.href))).json())
          .record,
    );
  const captions = async () =>
    (await record()).data.scenes.flatMap((scene) =>
      scene.tracks.overlay
        .filter((track) => track.type === "text")
        .flatMap((track) => track.elements),
    );
  await editor.locator('input[type="file"]').first().setInputFiles(wavPath);
  await editor
    .getByLabel("Add owned-speech.wav to timeline", { exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await record()).data.scenes.flatMap((scene) =>
          scene.tracks.audio.flatMap((track) => track.elements),
        ).length,
    )
    .toBe(1);
  const sourceAudio = (await record()).data.scenes.flatMap((scene) =>
    scene.tracks.audio.flatMap((track) => track.elements),
  )[0];
  const sourceDuration = sourceAudio.startTime + sourceAudio.duration;
  assert(Number.isFinite(sourceDuration) && sourceDuration > 0);
  evidence.sourceDuration = sourceDuration;
  evidence.metadataDurationBeforeRecognition = (
    await record()
  ).data.metadata.duration;
  assert.equal(
    evidence.metadataDurationBeforeRecognition,
    sourceDuration,
    "The audio transaction itself must persist its summary duration",
  );
  await conn.page.keyboard.press("Control+z");
  await expect
    .poll(async () => (await record()).data.metadata.duration)
    .toBe(0);
  await conn.page.keyboard.press("Control+Shift+z");
  await expect
    .poll(async () => (await record()).data.metadata.duration)
    .toBe(sourceDuration);
  evidence.checks.push({
    name: "Audio insertion and Undo/Redo durably update summary without close or flush",
    pass: true,
  });
  if (!durationOnly) {
    await editor.getByLabel("Captions", { exact: true }).click();
    await expect(
      editor.getByRole("combobox").filter({ hasText: /^Auto detect$/ }),
    ).toHaveCount(1);
    const started = Date.now();
    await editor
      .getByRole("button", { name: "Generate transcript", exact: true })
      .click();
    console.log(
      JSON.stringify({ work, phase: "real default-model inference started" }),
    );
    let lastPhase = "";
    while ((await captions()).length === 0) {
      assert(
        Date.now() - started < 900000,
        "Real ASR exceeded the 15-minute limit",
      );
      const alert = editor.getByRole("alert");
      if (await alert.count()) throw new Error(await alert.innerText());
      const busy = editor.locator('button[aria-busy="true"]');
      const phase = (await busy.count()) ? await busy.innerText() : "idle";
      if (phase !== lastPhase) {
        console.log("ASR: " + phase);
        lastPhase = phase;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    evidence.elapsedMs = Date.now() - started;
    const result = await captions();
    evidence.metadataDurationAtRecognition = (
      await record()
    ).data.metadata.duration;
    evidence.captions = validateAsrResult({ elements: result, sourceDuration });
    evidence.checks.push({
      name: "Real default ASR recognizes generated speech with bounded timestamps",
      pass: true,
    });
    await conn.page.keyboard.press("Control+z");
    await expect.poll(async () => (await captions()).length).toBe(0);
    await conn.page.keyboard.press("Control+Shift+z");
    await expect.poll(captions).toEqual(result);
    await reloadEditorFrame(editor);
    assert.deepEqual(await captions(), result);
    evidence.checks.push({
      name: "Recognized captions survive Undo/Redo and editor reload",
      pass: true,
    });
  } else {
    assert.deepEqual(evidence.modelRequests, []);
    await reloadEditorFrame(editor);
  }
  assert.equal((await record()).data.metadata.duration, sourceDuration);
  assert.deepEqual(
    (await record()).data.scenes.flatMap((scene) =>
      scene.tracks.audio.flatMap((track) => track.elements),
    ),
    [sourceAudio],
  );
  evidence.checks.push({
    name: "Reopened source audio and summary match exactly",
    pass: true,
  });
  assert.deepEqual(evidence.errors, []);
  assert(
    evidence.modelRequests.every((request) =>
      ["GET", "HEAD"].includes(request.method),
    ),
  );
  await conn.page.screenshot({ path: join(work, "result.png") });
  evidence.passed = true;
} catch (error) {
  evidence.error = scrub(error);
  process.exitCode = 1;
  await conn.page
    .screenshot({ path: join(work, "failure.png") })
    .catch(() => {});
} finally {
  conn.page.off("pageerror", onError);
  conn.page.off("request", onRequest);
  try {
    if (switched) {
      await close();
      if (restoreHash)
        assert.equal(
          hash(await readFile(join(restore, "project.json"))),
          restoreHash,
        );
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
