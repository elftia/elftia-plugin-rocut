import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { expect } from "./rocut-probe-source.mjs";

export function createOwnedPreviewSession(conn, folder) {
  let frame;
  let settingsStates;
  const readSettings = () =>
    frame.evaluate(
      async () =>
        (await (await fetch(new URL("api/record", location.href))).json())
          .record.data.settings,
    );
  return {
    get frame() {
      return frame;
    },
    async close() {
      const button = conn.page.locator(
        '[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
      );
      if (await button.count()) await button.click();
      await expect(
        conn.page.locator(
          '[data-testid="webpane-tab-slot"][data-tool-id="rocut"]',
        ),
      ).toHaveCount(0);
    },
    async open(path) {
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
        .locator(
          '[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]',
        )
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
      await frame
        .getByLabel("Media", { exact: true })
        .waitFor({ timeout: 30000 });
    },
    async seek(value) {
      await frame.getByLabel("Edit playhead time", { exact: true }).click();
      const input = frame.getByLabel("Playhead time", { exact: true });
      await input.fill(value);
      await input.press("Enter");
      await expect(
        frame.getByLabel("Edit playhead time", { exact: true }),
      ).toHaveText(value);
    },
    async configure720p() {
      const initial = await readSettings();
      assert.equal(initial.canvasSizeMode, "preset");
      assert.equal(initial.lastCustomCanvasSize, null);
      assert.deepEqual(initial.canvasSize, { width: 1920, height: 1080 });
      assert.deepEqual(initial.fps, { numerator: 30, denominator: 1 });
      // Independent UI expectations also bound rollback to these exact three
      // owned edits. Never blindly undo arbitrary pre-existing history.
      settingsStates = [
        initial,
        ...[
          { width: 1920, height: 1080 },
          { width: 1280, height: 1080 },
          { width: 1280, height: 720 },
        ].map((canvasSize) => ({
          ...initial,
          canvasSizeMode: "custom",
          canvasSize,
          lastCustomCanvasSize: canvasSize,
        })),
      ];
      await frame.getByLabel("Settings", { exact: true }).click();
      await frame.getByRole("button", { name: "Custom", exact: true }).click();
      await expect.poll(readSettings).toEqual(settingsStates[1]);
      for (const [index, name, value] of [
        [2, "Canvas width", "1280"],
        [3, "Canvas height", "720"],
      ]) {
        const input = frame.getByLabel(name, { exact: true });
        await input.fill(value);
        await input.press("Tab");
        await expect.poll(readSettings).toEqual(settingsStates[index]);
      }
      await frame.getByLabel("Media", { exact: true }).click();
      await expect(
        frame.locator('canvas[width="1280"][height="720"]'),
      ).toBeVisible();
    },
    async restoreCanvas() {
      if (!settingsStates) return;
      const current = await readSettings();
      const index = settingsStates.findIndex((state) =>
        isDeepStrictEqual(state, current),
      );
      assert(
        index >= 0,
        "Unexpected authored settings; refusing ambiguous undo",
      );
      await frame.getByLabel("Media", { exact: true }).click();
      for (let step = index; step > 0; step--) {
        await conn.page.keyboard.press("Control+z");
        await expect.poll(readSettings).toEqual(settingsStates[step - 1]);
      }
      await expect(
        frame.locator('canvas[width="1920"][height="1080"]'),
      ).toBeVisible();
      settingsStates = undefined;
    },
  };
}
