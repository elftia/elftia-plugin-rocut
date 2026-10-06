import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "./rocut-probe-source.mjs";
const { createF03, readF03, seekF03 } = await loadRocutProbe("probe-f03-fixture.mjs");
const { captureF03, stableF03, inspectF03 } = await loadRocutProbe("probe-f03-pixels.mjs");
import { probeF03Lifecycle } from "./probe-f03-lifecycle.mjs";
const { probeF03Export } = await loadRocutProbe("probe-f03-export.mjs");
const { captureExportReference } = await loadRocutProbe("probe-export-reference.mjs");
const { samplePreviewPng } = await loadRocutProbe("probe-multilingual-media.mjs");

export async function probeF03Languages({
	page,
	hostPage,
	project,
	folder,
	work,
	evidence,
	onPhase,
}) {
	await hostPage.setViewportSize({ width: 1920, height: 1080 });
	const { layers, authored } = await createF03({ page, hostPage, onPhase });
	evidence.checks.push({
		name: "F03 three actual JIZURA imports retain distinct languages fonts and locked seeds on one simultaneous timeline",
		pass: true,
	});
	const baselines = new Map();
	const references = new Map();
	for (const frame of [24, 36, 69, 87]) {
		onPhase("F03 simultaneous visible baseline " + frame);
		await seekF03(page, frame);
		baselines.set(frame, await stableF03(page));
		references.set(
			frame,
			await captureExportReference({
				page,
				hostPage,
				path: join(work, `f03-reference-${frame}.png`),
				sample: (page, png) => samplePreviewPng(page, png, inspectF03),
			}),
		);
		await hostPage.screenshot({
			path: join(work, `f03-baseline-${frame}.png`),
		});
	}
	assert(new Set([...baselines.values()].map((s) => s.hash)).size >= 3);
	for (const frame of [87, 24, 69, 36, 24, 87]) {
		await seekF03(page, frame);
		await expect
			.poll(async () => (await captureF03(page)).hash, { timeout: 15000 })
			.toBe(baselines.get(frame).hash);
	}
	await seekF03(page, 69);
	for (const [index, layer] of layers.entries()) {
		onPhase("F03 hide only " + layer.lang);
		await page
			.locator(
				`[data-testid="timeline-clip"][data-element-id="${layer.clipId}"]`,
			)
			.click({ button: "right" });
		await page.getByRole("menuitem", { name: "Hide", exact: true }).click();
		await expect
			.poll(
				async () =>
					(await readF03(page)).clips.find((c) => c.id === layer.clipId).hidden,
			)
			.toBe(true);
		await seekF03(page, 69);
		const expected = baselines
			.get(69)
			.regions.map((pixels, i) => (i === index ? [] : pixels));
		await expect
			.poll(async () => (await captureF03(page)).regions, { timeout: 15000 })
			.toEqual(expected);
		assert.deepEqual((await readF03(page)).sequences, authored.sequences);
		await hostPage.keyboard.press("Control+z");
		await expect.poll(() => readF03(page)).toEqual(authored);
		await expect
			.poll(async () => (await captureF03(page)).hash, { timeout: 15000 })
			.toBe(baselines.get(69).hash);
	}
	evidence.checks.push({
		name: "F03 independent hide and undo of every layer leave both other language pixel masks unchanged",
		pass: true,
	});
	const fonts = await page.evaluate(() =>
		[...document.fonts].map((f) => ({ family: f.family, status: f.status })),
	);
	for (const layer of layers)
		assert(
			fonts.some(
				(f) =>
					f.family.startsWith(`__rocut_mt_${layer.font}_`) &&
					f.status === "loaded",
			),
		);
	evidence.f03Languages = {
		fonts: fonts.filter((f) => f.family.startsWith("__rocut_mt_")),
		frames: [...baselines.keys()],
		layers: layers.map(({ lang, font, seed }) => ({ lang, font, seed })),
	};
	page = await probeF03Lifecycle({
		page,
		hostPage,
		project,
		folder,
		authored,
		baselines,
		evidence,
		onPhase,
	});
	await probeF03Export({
		page,
		hostPage,
		work,
		references,
		authored,
		evidence,
		onPhase,
	});
	assert.deepEqual(await readF03(page), authored);
}
