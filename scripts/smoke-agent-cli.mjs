/** Isolated bundled-Node acceptance; never connects to an installed plugin or pane. */
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const entry = fileURLToPath(new URL("../vendor/run/rocut.mjs", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "rocut-bundled-agent-"));
const targets = path.join(root, "registry");
const project = path.join(root, "mv");
let child;

async function stopHost() {
  if (!child || child.exitCode !== null) return;
  const stopped = once(child, "exit");
  child.kill(); // Only the child created by this test.
  await stopped;
}

async function startHost() {
  child = spawn(process.execPath, [entry, "host", "start", project, "--targets-root", targets], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  // Read readiness without exposing the authenticated editor URL in test output.
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Bundled Host did not start in 30 seconds")), 30000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (/^pid \d+$/m.test(output)) { clearTimeout(timer); resolve(); }
    });
    child.stderr.resume();
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Bundled Host exited: ${code}`)); });
  });
}

async function cli(...args) {
  const { stdout } = await exec(process.execPath, [entry, ...args, "--target", "mv", "--targets-root", targets], {
    windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function spec(name, value) {
  const file = path.join(root, `${name}.json`);
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

try {
  await startHost();
  const capabilities = await cli("capabilities");
  assert.equal(capabilities.mediaImport.route, "media/import");
  assert.ok(capabilities.supportedOperations.includes("reorder-tracks"));
  assert.ok((await cli("editing", "catalog")).catalog.elements.text.length > 0);
  assert.deepEqual((await cli("task", "list")).result.surfaces, []);

  // Original one-second mono PCM fixture, no model or external media dependency.
  const wave = Buffer.alloc(44 + 16000 * 2);
  wave.write("RIFF", 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write("data", 36); wave.writeUInt32LE(wave.length - 44, 40);
  for (let i = 0; i < 16000; i++) wave.writeInt16LE(Math.round(2000 * Math.sin(i * Math.PI * 440 / 8000)), 44 + i * 2);
  const songPath = path.join(root, "song.wav");
  await writeFile(songPath, wave);
  const importSpec = await spec("import", { filePath: songPath, expectedRevision: 0, idempotencyKey: "smoke-song" });
  const song = await cli("media", "import", importSpec);
  assert.equal(song.asset.duration, 120000);
  assert.equal(song.metadataSource, "container");
  const state = await cli("read");
  const sceneId = state.projectEntity.sceneState.currentSceneId;
  await cli("apply", await spec("layout", {
    expectedRevision: state.revision, idempotencyKey: "smoke-layout",
    operations: [
      { kind: "create-track", track: { id: "song", kind: "audio", name: "Song", sceneId, hidden: false } },
      { kind: "create-clip", clip: { id: "song-clip", trackId: "song", assetId: song.asset.id, startTime: 0, duration: 120000, trimStart: 0, trimEnd: 0 } },
      { kind: "create-track", track: { id: "titles", kind: "text", name: "Titles", sceneId, hidden: false } },
      { kind: "create-clip", clip: { id: "title", trackId: "titles", startTime: 0, duration: 120000, trimStart: 0, trimEnd: 0, editing: { type: "text", params: { content: "MV smoke", opacity: 0.75 } } } },
    ],
  }));
  await cli("motion-text", "create", await spec("lyrics", {
    source: "[00:00.00]Hello\n[00:00.50]World", sourceFormat: "lrc", language: "en", duration: 120000, startTime: 0,
    starterPreset: "impact-title", seed: 7, expectedRevision: 2, idempotencyKey: "smoke-lyrics",
  }));
  assert.equal((await cli("motion-text", "list")).sequences.length, 1);
  const plan = await cli("scenes", "plan", await spec("scene", {
    idempotencyKey: "smoke-scene", operation: { kind: "create", id: "alternate", name: "Alternate", mainTrackId: "alternate-main" },
  }));
  assert.equal((await cli("read")).revision, 3); // Planning is read-only.
  await cli("apply", await spec("scene-batch", plan));
  assert.equal((await cli("scenes", "list")).scenes.length, 2);
  const finalState = await cli("read");
  assert.equal(finalState.revision, 4);
  assert.equal(finalState.entities.clips.find(clip => clip.id === "title").editing.params.opacity, 0.75);
  const storedBytes = await readFile(path.join(project, "attachments", song.asset.id, "body.bin"));
  assert.deepEqual(storedBytes, wave);
  await assert.rejects(cli("task", "start", await spec("caption-task", {
    request: { kind: "captions.import", expectedRevision: 4, idempotencyKey: "smoke-captions", sceneId, trackId: "captions", fileName: "lyrics.srt", input: "1\n00:00:00,000 --> 00:00:01,000\nHello\n" },
  })), /no-task-surface/);
  await stopHost();
  await startHost();
  assert.equal((await cli("read")).revision, 4);
  assert.equal((await cli("media", "import", importSpec)).replayed, true);
  assert.equal((await cli("read")).assets, 1);
  console.log("smoke-agent-cli: PASS (bundled Node/WASM, discovery, media bytes, layered timeline, LRC, scenes, pane refusal, reopen/replay)");
} finally {
  await stopHost();
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("rocut-bundled-agent-"))
    throw new Error("Unexpected smoke cleanup target");
  await rm(root, { recursive: true, force: true });
}
