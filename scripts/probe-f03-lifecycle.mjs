import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { expect } from "./rocut-probe-source.mjs";
const { readF03, seekF03 } = await loadRocutProbe("probe-f03-fixture.mjs");
const { captureF03 } = await loadRocutProbe("probe-f03-pixels.mjs");
const { reloadEditorFrame } = await loadRocutProbe("probe-reload-editor.mjs");

export async function probeF03Lifecycle({
	page,
	hostPage,
	project,
	folder,
	authored,
	baselines,
	evidence,
	onPhase,
}) {
	const owned = new Set([realpathSync(project)]);
	const cdpSessions = [];
	const editorUrls = new Set([await page.evaluate(() => location.href)]);
	const editorFrames = new Set();
	let externalBlocked = 0;
	const fontLoads = new Set();
	const route = async (route) => {
		const request = route.request();
		let owner, frame;
		try {
			frame = request.frame();
			owner = frame.url();
		} catch {
			return route.continue();
		}
		if (
			!editorFrames.has(frame) &&
			!editorUrls.has(owner) &&
			!editorUrls.has(request.url())
		)
			return route.continue();
		const url = new URL(request.url());
		if (!["http:", "https:"].includes(url.protocol)) return route.continue();
		if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
			if (url.pathname.endsWith(".ttf"))
				fontLoads.add(url.pathname.split("/").at(-1));
			return route.continue();
		}
		externalBlocked++;
		return route.abort("internetdisconnected");
	};
	const disableCache = async (frame) => {
		const session = await hostPage.context().newCDPSession(frame);
		cdpSessions.push(session);
		await session.send("Network.enable");
		await session.send("Network.setCacheDisabled", { cacheDisabled: true });
	};
	const close = async () => {
		const old = page;
		await hostPage
			.locator(
				'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
			)
			.click();
		await expect(
			hostPage.locator(
				'[data-testid="webpane-tab-slot"][data-tool-id="rocut"]',
			),
		).toHaveCount(0);
		await expect.poll(() => old.isDetached()).toBe(true);
	};
	const open = async (path) => {
		assert(owned.has(realpathSync(path)), "only owned projects may be opened");
		const result = await hostPage.evaluate(
			({ folder, path }) =>
				window.native.toolHosts.openProject({
					toolId: "rocut",
					workingFolder: folder,
					projectPath: path,
				}),
			{ folder, path },
		);
		editorUrls.add(result.editorUrl);
		await hostPage
			.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
			.click();
		await expect
			.poll(
				async () => {
					for (const frame of hostPage.frames())
						if (
							(await frame.evaluate(() => location.href).catch(() => "")) ===
							result.editorUrl
						) {
							page = frame;
							editorFrames.add(frame);
							return true;
						}
					return false;
				},
				{ timeout: 30000 },
			)
			.toBe(true);
		await page
			.locator("#editor-assets")
			.getByLabel("Media", { exact: true })
			.waitFor({ timeout: 30000 });
		await disableCache(page);
		await reloadEditorFrame(page);
		// A reserved .invalid request must hit this route, not merely fail DNS.
		const before = externalBlocked;
		assert.equal(
			await page.evaluate(async () => {
				try {
					await fetch("https://rocut-offline-check.invalid/f03");
					return false;
				} catch {
					return true;
				}
			}),
			true,
		);
		assert.equal(
			externalBlocked,
			before + 1,
			"owned editor external request must be intercepted",
		);
	};
	const verifyA = async () => {
		await expect.poll(() => readF03(page)).toEqual(authored);
		for (const [frame, sample] of [...baselines].reverse()) {
			await seekF03(page, frame);
			await expect
				.poll(async () => (await captureF03(page)).hash, { timeout: 30000 })
				.toBe(sample.hash);
		}
	};
	await hostPage.route("**/*", route);
	try {
		await disableCache(page);
		for (let i = 0; i < 2; i++) {
			onPhase(
				`F03 real workspace remount ${i + 1} with external network denied`,
			);
			const marker = randomUUID();
			await page.evaluate((marker) => {
				globalThis.__f03DocumentMarker = marker;
			}, marker);
			await close();
			await open(project);
			assert.notEqual(
				await page.evaluate(() => globalThis.__f03DocumentMarker),
				marker,
			);
			await verifyA();
		}
		evidence.checks.push({
			name: "F03 two actual workspace remounts reproduce all three language layers exactly with external network denied",
			pass: true,
		});
		onPhase("F03 create and switch to a second dedicated empty project");
		await close();
		const created = await hostPage.evaluate(
			(folder) =>
				window.native.toolHosts.createProject({
					toolId: "rocut",
					workingFolder: folder,
					name: "f03-other-" + Date.now(),
				}),
			folder,
		);
		const other = realpathSync(created.path);
		const nested = relative(realpathSync(folder), other);
		assert(nested && !nested.startsWith("..") && !isAbsolute(nested));
		owned.add(other);
		await open(other);
		const empty = await readF03(page);
		assert.notEqual(empty.id, authored.id);
		assert.equal(empty.sequences.length, 0);
		assert.equal(empty.clips.length, 0);
		await page
			.locator("#editor-assets")
			.getByLabel("Motion text", { exact: true })
			.click();
		await page
			.getByRole("combobox", { name: "Motion text language", exact: true })
			.click();
		await page.getByRole("option", { name: "English", exact: true }).click();
		await page.locator("#motion-text-source").fill("OTHER PROJECT ONLY");
		await page
			.getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
			.fill("3");
		await page.getByTestId("motion-text-add").click();
		await expect(page.getByTestId("timeline-clip")).toHaveCount(1);
		await seekF03(page, 30);
		const otherState = await readF03(page);
		assert.equal(otherState.sequences.length, 1);
		assert(
			otherState.sequences.every(
				(s) => !authored.sequences.some((a) => a.id === s.id),
			),
		);
		const fonts = await page.evaluate(() =>
			[...document.fonts].map((f) => f.family),
		);
		assert(
			fonts.every((f) => !/^__rocut_mt_(gothic_bold_ko|mono)_/.test(f)),
			"second document must not retain first project's Korean/Mono font faces",
		);
		for (let i = 0; i < 2; i++) {
			onPhase(`F03 project round trip ${i + 1}`);
			await close();
			await open(project);
			await verifyA();
			await close();
			await open(other);
			await expect.poll(() => readF03(page)).toEqual(otherState);
		}
		await close();
		await open(project);
		await verifyA();
		for (const font of [
			"noto-sans-jp-variable.ttf",
			"noto-sans-kr-variable.ttf",
			"ibm-plex-mono-medium.ttf",
		])
			assert(fontLoads.has(font), `cold local font request required: ${font}`);
		evidence.f03Lifecycle = {
			otherProject: other,
			externalBlocked,
			localFonts: [...fontLoads].sort(),
			remounts: 2,
			projectRoundTrips: 2,
		};
		evidence.checks.push({
			name: "F03 two real project round trips preserve independent sequences and exact three-language pixels; cold local fonts load without external network",
			pass: true,
		});
		return page;
	} finally {
		await hostPage.unroute("**/*", route);
		for (const session of cdpSessions) {
			await session
				.send("Network.setCacheDisabled", { cacheDisabled: false })
				.catch(() => {});
			await session.detach().catch(() => {});
		}
	}
}
