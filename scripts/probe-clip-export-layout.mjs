import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "./rocut-probe-source.mjs";
const { createRangeSource } = await loadRocutProbe("probe-ui-range-media.mjs");

export async function probeClipExportLayout({ page, hostPage, work, evidence, openAsset, dialog, asset }) {
	const viewport = hostPage.viewportSize();
	const theme = await hostPage.evaluate(async () => (await window.native.theme.getState()).mode);
	const originalDark = await hostPage.evaluate(() => document.documentElement.classList.contains("dark"));
	const setDark = async dark => {
		const current = await hostPage.evaluate(() => document.documentElement.classList.contains("dark"));
		if (current !== dark) await hostPage.getByRole("button", { name: current ? "深色" : "浅色", exact: true }).click();
		await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(dark);
	};
	try {
		await hostPage.setViewportSize({ width: 1000, height: 650 });
		await openAsset();
		const scroll = dialog.getByTestId("clip-export-scroll");
		const sizes = await scroll.evaluate(e => ({ client: e.clientHeight, scroll: e.scrollHeight, overflow: getComputedStyle(e).overflowY }));
		assert.equal(sizes.overflow, "auto");
		assert(sizes.scroll > sizes.client, "constrained dialog needs an actual scroll area");
		for (const mode of ["dark", "light"]) {
			await setDark(mode === "dark");
			await expect(dialog.getByRole("button", { name: "Export 2 clips", exact: true })).toBeInViewport();
			await scroll.hover();
			await hostPage.mouse.wheel(0, 800);
			await expect.poll(() => scroll.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
			await expect(dialog.getByRole("combobox", { name: "Clip export quality" })).toBeInViewport();
			await hostPage.screenshot({ path: join(work, "clip-export-narrow-" + mode + ".png") });
		}
		await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
		const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute("aria-label") }));
		evidence.checks.push({ name: "clip export narrow light/dark native scrolling and fixed footer", pass: true, sizes, focus });
	} finally {
		await setDark(originalDark);
		await hostPage.evaluate(value => window.native.theme.setMode(value), theme);
		if (viewport) await hostPage.setViewportSize(viewport);
	}
	const unused = join(work, "unused-export-media.mp4");
	createRangeSource(unused);
	await page.locator('input[type="file"]').setInputFiles(unused);
	await page.getByLabel("Add unused-export-media.mp4 to timeline", { exact: true }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Export clips", exact: true }).click();
	await expect(dialog.getByText(/No timeline clips to export/)).toBeVisible();
	await expect(dialog.getByRole("button", { name: "Export 0 clips", exact: true })).toBeDisabled();
	await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
	await expect(asset).toBeVisible();
	evidence.checks.push({ name: "unused asset explains empty clip list and cannot export the full project", pass: true });
}
