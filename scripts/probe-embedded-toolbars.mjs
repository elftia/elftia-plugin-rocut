import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "./rocut-probe-source.mjs";

async function assertUnclipped(control) {
	await expect(control).toBeVisible();
	const result = await control.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const panel = element.closest(".panel").getBoundingClientRect();
		// The scene selector sits inside a rounded pill: 2px corners are
		// intentionally outside its shape. Keep full-box panel containment,
		// but sample pointer hits 4px inside the visible rounded boundary.
		const points = [
			[rect.left + 4, rect.top + 4],
			[rect.right - 4, rect.top + 4],
			[rect.left + 4, rect.bottom - 4],
			[rect.right - 4, rect.bottom - 4],
		];
		return {
			label: element.getAttribute("aria-label"),
			contained:
				rect.left >= panel.left &&
				rect.right <= panel.right &&
				rect.top >= panel.top &&
				rect.bottom <= panel.bottom,
			hit: points.every(([x, y]) =>
				element.contains(document.elementFromPoint(x, y)),
			),
			width: rect.width,
			panelWidth: panel.width,
		};
	});
	assert(
		result.contained && result.hit,
		"control is clipped or covered: " + JSON.stringify(result),
	);
}

export async function probeEmbeddedToolbars({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const previous = hostPage.viewportSize();
	const theme = await hostPage.evaluate(
		async () => (await window.native.theme.getState()).mode,
	);
	const originallyDark = await hostPage.evaluate(() =>
		document.documentElement.classList.contains("dark"),
	);
	const setTheme = async (dark) => {
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
	};
	const state = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return {
				id: record.id,
				sequences: record.data.motionTextSequences,
				scenes: record.data.scenes.map(({ updatedAt, ...scene }) => scene),
				settings: record.data.settings,
			};
		});
	const before = await state();
	await page.getByLabel("Media", { exact: true }).click();
	try {
		for (const width of [1000, 900, 760, 1920]) {
			await hostPage.setViewportSize({
				width,
				height: width === 1920 ? 1080 : 650,
			});
			// ResizeObserver updates the iframe layout after host metrics settle.
			// Do not click a focus tab that the incoming wide layout will remove.
			await expect(page.getByTestId("editor-main-panels")).toHaveAttribute(
				"data-layout",
				width === 1920 ? "wide" : "focus",
			);
			for (const mode of ["dark", "light"]) {
				const assetsTab = page.getByRole("tab", {
					name: "Media & text",
					exact: true,
				});
				if (await assetsTab.isVisible()) await assetsTab.click();
				onPhase("embedded toolbar reachability " + width + " " + mode);
				await setTheme(mode === "dark");
				await expect
					.poll(() =>
						page.evaluate(() =>
							document.documentElement.classList.contains("dark"),
						),
					)
					.toBe(mode === "dark");
				const importButton = page.getByRole("button", {
					name: "Import media",
					exact: true,
				});
				const view = page.getByRole("button", {
					name: /^Switch to (list|grid) view$/,
				});
				const sort = page.getByRole("button", {
					name: "Sort media",
					exact: true,
				});
				const zoomIn = page.getByRole("button", {
					name: "Zoom timeline in",
					exact: true,
				});
				const zoomOut = page.getByRole("button", {
					name: "Zoom timeline out",
					exact: true,
				});
				const scenes = page.getByRole("button", {
					name: "Manage scenes",
					exact: true,
				});
				for (const control of [
					importButton,
					view,
					sort,
					zoomIn,
					zoomOut,
					scenes,
				])
					await assertUnclipped(control);
				const toolbar = page.getByTestId("timeline-toolbar");
				const sizes = await toolbar.evaluate((e) => ({
					width: e.clientWidth,
					content: e.scrollWidth,
					height: e.clientHeight,
				}));
				assert(
					sizes.content <= sizes.width + 1,
					"timeline toolbar must not require concealed horizontal scrolling",
				);
				assert(
					sizes.height <= 100,
					"toolbar wrapping must leave usable timeline height",
				);
				if (width === 1920)
					assert(sizes.height <= 40, "wide toolbar should stay one row");
				const chooser = hostPage.waitForEvent("filechooser");
				await importButton.click();
				await (await chooser).setFiles([]);
				const originalView = await view.getAttribute("aria-label");
				const assetAdd = page.getByTestId("asset-add-to-timeline").first();
				const hasAssets = (await assetAdd.count()) > 0;
				if (hasAssets) await assertUnclipped(assetAdd);
				await view.click();
				await expect(view).not.toHaveAttribute("aria-label", originalView);
				if (hasAssets) await assertUnclipped(assetAdd);
				await view.click();
				await expect(view).toHaveAttribute("aria-label", originalView);
				if (hasAssets) {
					const count = await page.getByTestId("timeline-clip").count();
					await assetAdd.click();
					await expect(page.getByTestId("timeline-clip")).toHaveCount(
						count + 1,
					);
					if (width !== 1920) {
						await expect(
							page.getByRole("tab", { name: "Inspector", exact: true }),
						).toBeFocused();
					}
					await hostPage.keyboard.press("Control+z");
					await expect(page.getByTestId("timeline-clip")).toHaveCount(count);
					await expect.poll(state).toEqual(before);
					if (await assetsTab.isVisible()) await assetsTab.click();
				}
				await sort.focus();
				await hostPage.keyboard.press("Enter");
				await expect(page.getByRole("menu")).toBeVisible();
				await hostPage.keyboard.press("Escape");
				await expect(sort).toBeFocused();
				await scenes.click();
				await expect(
					page.getByRole("dialog", { name: "Scenes", exact: true }),
				).toBeVisible();
				await hostPage.keyboard.press("Escape");
				await expect(scenes).toBeFocused();
				const slider = page.getByRole("slider", {
					name: "Timeline zoom",
					exact: true,
				});
				const value = Number(await slider.getAttribute("aria-valuenow"));
				const first = value > 0.9 ? zoomOut : zoomIn;
				const second = value > 0.9 ? zoomIn : zoomOut;
				await first.click();
				await expect
					.poll(async () => Number(await slider.getAttribute("aria-valuenow")))
					.not.toBe(value);
				await second.click();
				await expect
					.poll(async () => Number(await slider.getAttribute("aria-valuenow")))
					.toBeCloseTo(value, 5);
				assert.deepEqual(
					await state(),
					before,
					"toolbar interaction must not edit the open project",
				);
				await hostPage.screenshot({
					path: join(work, "toolbars-" + width + "-" + mode + ".png"),
				});
				evidence.checks.push({
					name: "embedded media and timeline controls are fully hit-testable with working dialogs, menus, view mode and zoom",
					width,
					mode,
					sizes,
					assetAddAndUndo: hasAssets,
					pass: true,
				});
			}
		}
	} catch (error) {
		await hostPage.screenshot({ path: join(work, "failure-at-test-size.png") });
		throw error;
	} finally {
		await hostPage.keyboard.press("Escape");
		await setTheme(originallyDark);
		await hostPage.evaluate(
			(value) => window.native.theme.setMode(value),
			theme,
		);
		if (previous) await hostPage.setViewportSize(previous);
		else {
			const cdp = await hostPage.context().newCDPSession(hostPage);
			await cdp.send("Emulation.clearDeviceMetricsOverride");
			await cdp.detach();
		}
	}
}
