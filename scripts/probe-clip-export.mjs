import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { basename, join } from "node:path";
import { expect } from "./rocut-probe-source.mjs";
const { createUiExportFixture } = await loadRocutProbe("probe-ui-export-fixture.mjs");
const { createRangeSource, verifyRangeMedia } = await loadRocutProbe("probe-ui-range-media.mjs");
import { probeClipExportLayout } from "./probe-clip-export-layout.mjs";

export async function probeClipExport({ page, hostPage, work, evidence, onPhase }) {
	const check = (name, extra = {}) => evidence.checks.push({ name, pass: true, ...extra });
	const readRecord = () => page.evaluate(async () =>
		(await (await fetch(new URL("api/record", location.href))).json()).record.data);
	const videoClips = data => [data.scenes[0].tracks.main, ...data.scenes[0].tracks.overlay]
		.flatMap(track => track.elements).filter(clip => clip.type === "video")
		.sort((a, b) => a.startTime - b.startTime);
	onPhase("clip export: create overlapping animated text and two-color audiovisual fixture");
	const sourceVideo = join(work, "clip-underlay.mp4");
	createRangeSource(sourceVideo);
	await createUiExportFixture({ page, work, sourceVideo });
	await expect.poll(async () => videoClips(await readRecord()).length).toBe(1);
	const original = videoClips(await readRecord())[0];
	await page.locator(`[data-testid="timeline-clip"][data-element-id="${original.id}"]`).click();
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page.getByLabel("Playhead time", { exact: true }).fill("00:00:01:00");
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	await page.getByLabel("Split element", { exact: true }).click();
	await expect.poll(async () => videoClips(await readRecord()).length).toBe(2);
	const initial = await readRecord();
	assert.deepEqual(videoClips(initial).map(c => [c.startTime, c.duration]), [[0, 120000], [120000, 120000]]);
	await page.getByLabel("Media", { exact: true }).click();
	const asset = page.getByLabel(`Add ${basename(sourceVideo)} to timeline`, { exact: true });
	const dialog = page.getByRole("dialog", { name: "Export clips", exact: true });
	const openAsset = async () => {
		await asset.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Export clips", exact: true }).click();
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("checkbox", { name: /^Export / })).toHaveCount(2);
	};
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	const downloads = new Map();
	const begin = event => downloads.set(event.guid, { ...event, completed: false });
	const progress = event => {
		const item = downloads.get(event.guid);
		if (item) item.completed = event.state === "completed";
	};
	cdp.on("Browser.downloadWillBegin", begin);
	cdp.on("Browser.downloadProgress", progress);
	try {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: work, eventsEnabled: true });
		for (const format of ["mp4", "webm"]) {
			onPhase("clip export: actual context-menu batch " + format);
			await openAsset();
			await expect(dialog.getByText("0.00s – 1.00s", { exact: false })).toBeVisible();
			await expect(dialog.getByText("1.00s – 2.00s", { exact: false })).toBeVisible();
			await dialog.getByRole("combobox", { name: "Clip export format" }).selectOption(format);
			await hostPage.screenshot({ path: join(work, "clip-export-" + format + ".png") });
			downloads.clear();
			await dialog.getByRole("button", { name: "Export 2 clips", exact: true }).click();
			await expect(dialog.getByRole("status")).toHaveText("2 of 2 files sent to downloads.", { timeout: 120000 });
			await expect.poll(() => [...downloads.values()].filter(d => d.completed).length, { timeout: 20000 }).toBe(2);
			const outputs = [...downloads.values()];
			assert.equal(new Set(outputs.map(d => d.suggestedFilename)).size, 2);
			for (const [index, output] of outputs.entries()) {
				assert.match(output.guid, /^[a-zA-Z0-9-]+$/);
				assert(output.suggestedFilename.startsWith(index === 0 ? "001-" : "002-"));
				check("rendered timeline clip " + (index + 1) + " " + format,
					verifyRangeMedia({ path: join(work, output.guid), suggestedFilename: output.suggestedFilename },
						{ format, ranged: index === 1, firstClip: index === 0 }));
			}
			await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
			await expect(dialog).toHaveCount(0);
		}
		onPhase("clip export: row selection, no late download after cancellation");
		await openAsset();
		await dialog.getByRole("button", { name: "Clear selection", exact: true }).click();
		await expect(dialog.getByRole("button", { name: "Export 0 clips", exact: true })).toBeDisabled();
		await dialog.getByRole("checkbox", { name: /^Export / }).nth(1).check();
		downloads.clear();
		await dialog.getByRole("button", { name: "Export 1 clips", exact: true }).click();
		await dialog.getByRole("button", { name: "Cancel export", exact: true }).click();
		await expect(dialog.getByRole("status")).toHaveText("Cancelled. 0 of 1 files sent to downloads.", { timeout: 30000 });
		await expect(dialog.getByRole("button", { name: "Export 1 clips", exact: true })).toBeEnabled();
		assert.equal(downloads.size, 0);
		await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
		const after = await readRecord();
		for (const key of ["scenes", "settings", "motionTextSequences"]) assert.deepEqual(after[key], initial[key]);
		check("checkbox selection and cancellation retain timeline without publishing late output");
		onPhase("clip export: main menu respects selected timeline clip");
		await page.locator(`[data-testid="timeline-clip"][data-element-id="${videoClips(initial)[1].id}"]`).click();
		const trigger = page.getByTestId("editor-menu-trigger");
		await trigger.click();
		await page.getByRole("menuitem", { name: "Export clips", exact: true }).click();
		await expect(dialog.getByRole("checkbox", { name: /^Export / })).toHaveCount(1);
		await expect(dialog.getByText("1.00s – 2.00s", { exact: false })).toBeVisible();
		await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
		await expect(trigger).toBeFocused();
		check("main-menu selected clip range and keyboard focus restoration");
		onPhase("clip export: narrow themes, scrolling and unused asset");
		await probeClipExportLayout({ page, hostPage, work, evidence, openAsset, dialog, asset });
	} finally {
		cdp.off("Browser.downloadWillBegin", begin);
		cdp.off("Browser.downloadProgress", progress);
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
