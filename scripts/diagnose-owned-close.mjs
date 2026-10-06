import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const host = process.env.ELFTIA_WORKTREE;
assert(host && process.env.ELFTIA_TEST_SESSION);
const { connect } = await import(
  pathToFileURL(join(host, "packages/elftia-cli/src/connect.ts")).href
);
const conn = await connect({
  mode: "attach",
  port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
const sanitize = (value) =>
  String(value)
    .replace(/https?:\/\/[^\s"')]+/g, "[URL]")
    .slice(0, 1000);
let debuggerSession;
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
  assert.equal(resolve(owner.folder), resolve(host, ".tmp-rocut-e2e/project"));
  const frames = [];
  for (const frame of conn.page.frames())
    if ((await frame.title()).startsWith("OpenCut editor")) frames.push(frame);
  assert.equal(frames.length, 1);
  const frame = frames[0];
  if (process.env.ROCUT_DIAGNOSE_EXCEPTIONS === "1") {
    debuggerSession = await conn.context.newCDPSession(frame);
    debuggerSession.on("Debugger.paused", async (event) => {
      console.log(
        JSON.stringify({
          exception: sanitize(event.data?.description ?? event.reason),
          stack: event.callFrames
            .slice(0, 8)
            .map((f) => ({
              name: f.functionName,
              line: f.location.lineNumber,
              column: f.location.columnNumber,
            })),
        }),
      );
      await debuggerSession.send("Debugger.resume");
    });
    await debuggerSession.send("Debugger.enable");
    await debuggerSession.send("Debugger.setPauseOnExceptions", {
      state: "all",
    });
  }
  conn.page.on("pageerror", (error) =>
    console.log(JSON.stringify({ pageError: sanitize(error.message) })),
  );
  conn.page.on("console", (message) => {
    if (message.type() === "error")
      console.log(JSON.stringify({ consoleError: sanitize(message.text()) }));
  });
  conn.page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/api/record"))
      console.log(
        JSON.stringify({
          record: response.status(),
          method: response.request().method(),
        }),
      );
  });
  console.log(
    JSON.stringify(
      await frame.evaluate(() => ({
        nativeFetch: String(window.fetch).includes("[native code]"),
        originalFetch: typeof window.__originalFetch,
        trace: typeof window.__mutationTrace,
      })),
    ),
  );
  if (process.env.ROCUT_RESTORE_LEGACY_PROFILE_FETCH === "1") {
    await frame.evaluate(() => {
      if (
        !String(window.fetch).includes("[native code]") ||
        window.__originalFetch !== undefined ||
        window.__mutationTrace !== undefined
      )
        throw new Error("Unexpected profiling globals; refusing recovery");
      // Repair only the diagnostic wrapper's deleted dependencies. Do not
      // replace the store, acknowledge close, or skip its durable flush.
      window.__originalFetch = window.fetch;
      window.__mutationTrace = [];
    });
  }
  await conn.page.evaluate(() => {
    window.__closeDiagnosis = [];
    window.__closeDiagnosisListener = (event) => {
      if (event.data?.type === "elftia:tool-host-close-ready")
        window.__closeDiagnosis.push({
          type: event.data.type,
          ok: event.data.ok,
        });
    };
    window.addEventListener("message", window.__closeDiagnosisListener);
  });
  try {
    await conn.page
      .locator(
        '[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
      )
      .click();
    await conn.page.waitForFunction(
      () => window.__closeDiagnosis.length > 0,
      undefined,
      { timeout: 18000 },
    );
  } catch (error) {
    console.log(JSON.stringify({ waitError: sanitize(error.message) }));
  }
  console.log(
    JSON.stringify(
      await conn.page.evaluate(() => ({
        replies: window.__closeDiagnosis,
        attached: !!document.querySelector(
          '[data-testid="webpane-tab-slot"][data-tool-id="rocut"]',
        ),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(
          (e) => e.textContent,
        ),
      })),
    ),
  );
} finally {
  if (debuggerSession) {
    await debuggerSession.send("Debugger.setPauseOnExceptions", {
      state: "none",
    });
    await debuggerSession.detach();
  }
  await conn.page
    .evaluate(() => {
      window.removeEventListener("message", window.__closeDiagnosisListener);
      delete window.__closeDiagnosisListener;
      delete window.__closeDiagnosis;
    })
    .catch(() => {});
  await conn.close();
}
