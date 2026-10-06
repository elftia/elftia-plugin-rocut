import assert from "node:assert/strict";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";

for (const key of [
  "ELFTIA_WORKTREE",
  "ELFTIA_TEST_SESSION",
  "ELFTIA_CLI_DEBUG_PORT",
  "ELFTIA_REUSE_TEST_PROJECT",
]) {
  assert(process.env[key], `Missing ${key}`);
}
const host = await realpath(process.env.ELFTIA_WORKTREE);
const folder = await realpath(join(host, ".tmp-rocut-e2e/project"));
const project = await realpath(process.env.ELFTIA_REUSE_TEST_PROJECT);
const nested = relative(folder, project);
assert(
  nested && !nested.startsWith("..") && !isAbsolute(nested),
  "Only owned test projects",
);
const work = await mkdtemp(join(host, ".tmp-rocut-e2e/installed-sounds-"));
const { connect } = await import(
  pathToFileURL(join(host, "packages/elftia-cli/src/connect.ts")).href
);
const conn = await connect({
  mode: "attach",
  port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
const previous = conn.page.viewportSize();
const evidence = {
  kind: "installed-sounds-unconfigured-host",
  checks: [],
  errors: [],
  soundRequests: 0,
  passed: false,
};
const hash = async () =>
  createHash("sha256")
    .update(await readFile(join(project, "project.json")))
    .digest("hex");
let before;
let frame;
const pageError = (error) =>
  evidence.errors.push(
    error.message.replace(/https?:\/\/\S+/g, "[redacted-url]"),
  );
const request = (value) => {
  if (new URL(value.url()).pathname.includes("/sounds"))
    evidence.soundRequests++;
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
  for (const candidate of conn.page.frames()) {
    if ((await candidate.title().catch(() => "")).startsWith("OpenCut editor"))
      frame = candidate;
  }
  assert(frame, "Actual installed editor frame must be open");
  const activeId = await frame.evaluate(
    async () =>
      (await (await fetch(new URL("api/record", location.href))).json()).record
        .id,
  );
  const stored = JSON.parse(
    await readFile(join(project, "project.json"), "utf8"),
  );
  assert.equal(
    activeId,
    stored.record.id,
    "Only the specified owned project may be driven",
  );
  conn.page.on("pageerror", pageError);
  conn.page.on("request", request);
  const beforeSetup = JSON.parse(
    await readFile(join(project, "project.json"), "utf8"),
  );
  await conn.page.setViewportSize({ width: 1280, height: 900 });
  // Viewport setup can notify the timeline and queue the 800ms autosave.
  // Establish the byte baseline after setup, never by ignoring later writes.
  await conn.page.waitForTimeout(1800);
  const afterSetup = JSON.parse(
    await readFile(join(project, "project.json"), "utf8"),
  );
  const withoutSaveTimestamp = (value) => {
    const copy = structuredClone(value);
    delete copy.record.data.metadata.updatedAt;
    delete copy.summary.updatedAt;
    return copy;
  };
  assert.deepEqual(
    withoutSaveTimestamp(afterSetup),
    withoutSaveTimestamp(beforeSetup),
    "Viewport setup must not alter project content",
  );
  before = await hash();
  await frame.getByLabel("Sounds", { exact: true }).click();
  const notice = frame
    .getByRole("status")
    .filter({ hasText: "Online sounds are not configured" });
  await notice.waitFor({ state: "visible" });
  assert((await notice.innerText()).includes("import audio from Media"));
  evidence.checks.push({
    name: "Actual Sounds panel explains missing provider and available alternatives",
    pass: true,
  });
  const input = frame.getByPlaceholder("Search sound effects");
  await input.fill("rain");
  await frame
    .getByRole("button", { name: "Filter sounds", exact: true })
    .click();
  const filter = frame.getByRole("menuitemcheckbox", {
    name: "Show only commercially licensed",
  });
  assert.equal(await filter.getAttribute("aria-checked"), "true");
  await filter.click();
  assert.equal(await filter.getAttribute("aria-checked"), "false");
  await conn.page.keyboard.press("Escape");
  await conn.page.waitForTimeout(600);
  assert.equal(await input.inputValue(), "rain");
  assert.equal(
    await frame.getByText("Searching...", { exact: true }).count(),
    0,
  );
  assert.equal(
    await frame.getByText("Loading more sounds...", { exact: true }).count(),
    0,
  );
  assert.equal(evidence.soundRequests, 0);
  evidence.checks.push({
    name: "Search/filter controls respond without phantom API requests or stuck spinners",
    pass: true,
  });
  await conn.page.screenshot({ path: join(work, "sounds.png") });
  await frame.getByRole("tab", { name: "Saved", exact: true }).click();
  await frame.getByRole("tab", { name: "Sound effects", exact: true }).click();
  await notice.waitFor({ state: "visible" });
  await frame.getByLabel("Media", { exact: true }).click();
  await frame.getByLabel("Sounds", { exact: true }).click();
  await notice.waitFor({ state: "visible" });
  evidence.checks.push({
    name: "Saved and Media navigation return to a usable Sounds panel",
    pass: true,
  });
  await conn.page.waitForTimeout(1000);
  assert.equal(await hash(), before);
  assert.deepEqual(evidence.errors, []);
  evidence.checks.push({
    name: "Project bytes unchanged and no captured page errors",
    pass: true,
  });
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error.message).replace(
    /https?:\/\/\S+/g,
    "[redacted-url]",
  );
  process.exitCode = 1;
} finally {
  conn.page.off("pageerror", pageError);
  conn.page.off("request", request);
  if (frame)
    await frame
      .getByLabel("Motion text", { exact: true })
      .click()
      .catch(() => {});
  if (previous) await conn.page.setViewportSize(previous);
  else {
    const cdp = await conn.context.newCDPSession(conn.page);
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.detach();
  }
  await writeFile(
    join(work, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await conn.close();
  console.log(JSON.stringify({ work, ...evidence }));
}
