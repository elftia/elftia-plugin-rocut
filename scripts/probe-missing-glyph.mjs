import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "./rocut-probe-source.mjs";
const { downloadUiExport } = await loadRocutProbe("probe-ui-export-fixture.mjs");
import { probeResourceNoticeLayout } from "./probe-resource-notice-layout.mjs";

// Dedicated host-owned fixture; no project/asset injection and no external font.
export async function probeMissingGlyph({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const state = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return {
				scenes: record.data.scenes,
				sequences: record.data.motionTextSequences,
			};
		});
	onPhase(
		"F02 enter Korean text with an explicitly incompatible Chinese font default",
	);
	await page.getByLabel("Motion text", { exact: true }).click();
	await page
		.getByRole("combobox", { name: "Motion text language", exact: true })
		.click();
	await page
		.getByRole("option", { name: "Chinese (Simplified)", exact: true })
		.click();
	await page
		.locator("#motion-text-source")
		.fill("바람이 분다. 밤의 도시, 그리고 아침!");
	await page
		.getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
		.fill("3");
	await page.getByTestId("motion-text-add").click();
	await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page.getByLabel("Playhead time", { exact: true }).fill("00:00:01:00");
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	await expect
		.poll(() =>
			page.evaluate(() =>
				[...document.fonts].some(
					(font) =>
						font.family.startsWith("__rocut_mt_") && font.status === "loaded",
				),
			),
		)
		.toBe(true);
	const before = await state();
	assert.equal(before.sequences[0].defaults.fontId, "gothic_bold_zh_hans");
	assert.equal(
		before.sequences[0].cues[0].text,
		"바람이 분다. 밤의 도시, 그리고 아침",
	);
	assert.equal(before.sequences[0].cues[0].impact, true);
	const warning = page
		.getByRole("status")
		.filter({ hasText: /missing.*required glyphs/i });
	const previewWarning = await expect(warning)
		.toBeVisible({ timeout: 10000 })
		.then(() => true)
		.catch(() => false);
	if (previewWarning) {
		await probeResourceNoticeLayout({
			page,
			hostPage,
			warning,
			work,
			evidence,
		});
	}
	evidence.missingGlyph = {
		previewWarning,
		font: before.sequences[0].defaults.fontId,
	};
	await hostPage.screenshot({ path: join(work, "missing-glyph-preview.png") });
	onPhase(
		"F02 real export refuses missing Korean glyphs without downloading fallback",
	);
	let downloads = 0;
	const onDownload = () => downloads++;
	hostPage.on("download", onDownload);
	try {
		await page.getByTestId("editor-menu-trigger").click();
		await page
			.getByRole("menuitem", { name: "Export project", exact: true })
			.click();
		const dialog = page.getByRole("dialog", {
			name: "Export project",
			exact: true,
		});
		await dialog.getByRole("button", { name: "Export", exact: true }).click();
		await expect(
			dialog.getByRole("button", { name: "Retry", exact: true }),
		).toBeVisible({ timeout: 20000 });
		const error = await dialog.innerText();
		assert.match(error, /missing \d+ required glyphs/i);
		assert.equal(downloads, 0);
		assert.deepEqual(await state(), before);
		evidence.missingGlyph.exportError = error;
		evidence.checks.push({
			name: "actual export refuses missing Korean glyphs without download or mutation",
			pass: true,
		});
		await hostPage.screenshot({ path: join(work, "missing-glyph-export.png") });
		await hostPage.keyboard.press("Escape");
	} finally {
		hostPage.off("download", onDownload);
	}
	onPhase("F02 preview must warn before the user attempts export");
	assert(
		previewWarning,
		"Preview silently uses fallback glyphs: missing-glyph warning must be visible before export",
	);
	evidence.checks.push({
		name: "preview exposes missing-glyph warning before export",
		pass: true,
	});
	onPhase(
		"F02 correcting unsupported text clears the warning and restores export",
	);
	await page.getByTestId("timeline-clip").click();
	await page
		.locator(
			'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
		)
		.first()
		.click();
	await page
		.getByRole("textbox", { name: "Lyric text", exact: true })
		.fill("Font recovery succeeds");
	await page
		.getByRole("button", { name: "Apply changes", exact: true })
		.click();
	await expect
		.poll(async () => (await state()).sequences[0].cues[0].text)
		.toBe("Font recovery succeeds");
	await expect(page.getByTestId("preview-resource-notice")).toHaveCount(0);
	const cdp = await hostPage.context().browser().newBrowserCDPSession();
	try {
		await cdp.send("Browser.setDownloadBehavior", {
			behavior: "allowAndName",
			downloadPath: work,
			eventsEnabled: true,
		});
		await page.getByTestId("editor-menu-trigger").click();
		await page
			.getByRole("menuitem", { name: "Export project", exact: true })
			.click();
		const output = await downloadUiExport(
			cdp,
			page.getByRole("dialog", { name: "Export project", exact: true }),
			work,
		);
		const media = JSON.parse(
			execFileSync(
				"ffprobe",
				[
					"-v",
					"error",
					"-select_streams",
					"v:0",
					"-count_frames",
					"-show_entries",
					"stream=codec_name,width,height,nb_read_frames",
					"-show_entries",
					"format=duration",
					"-of",
					"json",
					output.path,
				],
				{ encoding: "utf8", windowsHide: true },
			),
		);
		assert.equal(media.streams[0].nb_read_frames, "90");
		assert.equal(media.streams[0].width, 1920);
		assert.equal(media.streams[0].height, 1080);
		assert.equal(Number(media.format.duration), 3);
		evidence.checks.push({
			name: "actual text correction clears stale warnings and exports successfully",
			pass: true,
			output,
			media,
		});
	} finally {
		await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
		await cdp.detach();
	}
}
