import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "./rocut-probe-source.mjs";

export async function probeResourceNoticeLayout({
	page,
	hostPage,
	warning,
	work,
	evidence,
}) {
	await warning.locator("summary").focus();
	await warning.locator("summary").press("Enter");
	await expect(warning.locator("details")).toHaveAttribute("open", "");
	await warning.locator("summary").press("Space");
	await expect(warning.locator("details")).not.toHaveAttribute("open", "");
	await warning.locator("summary").press("Enter");
	await expect(warning.locator("details")).toHaveAttribute("open", "");
	await expect(
		page.getByLabel("Edit playhead time", { exact: true }),
	).toHaveText("00:00:01:00");
	await expect(warning).toContainText("U+BC14");
	await expect(warning).toContainText("change its font or text");
	const bounds = await warning.evaluate((element) => ({
		width: element.clientWidth,
		scrollWidth: element.scrollWidth,
		height: element.clientHeight,
		scrollHeight: element.scrollHeight,
	}));
	assert(bounds.width > 150 && bounds.scrollWidth <= bounds.width + 1);
	assert(bounds.height <= 128);
	assert(
		bounds.scrollHeight > bounds.height,
		"narrow-pane details must exercise overflow",
	);
	await warning.hover();
	await hostPage.mouse.wheel(0, 480);
	await expect
		.poll(() => warning.evaluate((element) => element.scrollTop))
		.toBeGreaterThan(0);
	evidence.missingGlyphLayout = bounds;
	const originalTheme = await hostPage.evaluate(
		async () => (await window.native.theme.getState()).mode,
	);
	try {
		for (const dark of [false, true]) {
			const current = await hostPage.evaluate(() =>
				document.documentElement.classList.contains("dark"),
			);
			if (current !== dark)
				await hostPage
					.getByRole("button", { name: current ? "深色" : "浅色", exact: true })
					.click();
			await expect
				.poll(() =>
					page.evaluate(() =>
						document.documentElement.classList.contains("dark"),
					),
				)
				.toBe(dark);
			const contrast = await warning.evaluate((element) => {
				const rgb = (value) => value.match(/[\d.]+/g).map(Number);
				const luminance = (channels) =>
					channels.slice(0, 3).reduce((total, channel, i) => {
						const c = channel / 255;
						return (
							total +
							(c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) *
								[0.2126, 0.7152, 0.0722][i]
						);
					}, 0);
				let ancestor = element;
				while (ancestor) {
					const background = rgb(getComputedStyle(ancestor).backgroundColor);
					if (background.length === 3 || background[3] === 1) {
						const fg = luminance(rgb(getComputedStyle(element).color));
						const bg = luminance(background);
						return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
					}
					ancestor = ancestor.parentElement;
				}
				return 0;
			});
			assert(contrast >= 4.5, `notice contrast below AA: ${contrast}`);
			evidence.checks.push({
				name: `resource notice ${dark ? "dark" : "light"} contrast and keyboard/wheel details`,
				contrast,
				pass: true,
			});
			await hostPage.screenshot({
				path: join(work, `missing-glyph-${dark ? "dark" : "light"}.png`),
			});
		}
	} finally {
		await hostPage.evaluate(
			(mode) => window.native.theme.setMode(mode),
			originalTheme,
		);
	}
}
