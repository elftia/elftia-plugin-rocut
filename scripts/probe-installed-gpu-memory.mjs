import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "./rocut-probe-source.mjs";
const { probeMotionStressMemory } = await loadRocutProbe("probe-motion-stress-memory.mjs");
const { readWindowsGpuMemory } = await loadRocutProbe("probe-windows-gpu-memory.mjs");

for (const key of [
	"ELFTIA_WORKTREE",
	"ELFTIA_TEST_SESSION",
	"ELFTIA_CLI_DEBUG_PORT",
	"ELFTIA_REUSE_TEST_PROJECT",
	"ELFTIA_RESTORE_TEST_PROJECT",
	"ELFTIA_INSTALLED_ROCUT",
	"ELFTIA_MAIN_PID",
	"ELFTIA_GPU_PID",
])
	assert(process.env[key], "Missing " + key);
const host = await realpath(process.env.ELFTIA_WORKTREE);
const folder = await realpath(join(host, ".tmp-rocut-e2e/project"));
const project = await realpath(process.env.ELFTIA_REUSE_TEST_PROJECT);
const restore = await realpath(process.env.ELFTIA_RESTORE_TEST_PROJECT);
const installed = await realpath(process.env.ELFTIA_INSTALLED_ROCUT);
for (const candidate of [project, restore]) {
	const nested = relative(folder, candidate);
	assert(
		nested && !nested.startsWith("..") && !isAbsolute(nested),
		"Owned fixtures only",
	);
}
const gpuPid = Number(process.env.ELFTIA_GPU_PID),
	mainPid = Number(process.env.ELFTIA_MAIN_PID);
const work = await mkdtemp(join(host, ".tmp-rocut-e2e/installed-gpu-memory-"));
const evidence = {
	kind: "actual-installed-windows-gpu-process-memory",
	acceptanceEligible: false,
	scope:
		"Whole Elftia GPU process OS counters, not editor-exclusive allocation or timing. No WebGPU instrumentation.",
	projectPath: project,
	gpuPid,
	mainPid,
	checks: [],
	checkpoints: [],
	assets: [],
	passed: false,
};
const projection = (r) => ({
	id: r.id,
	settings: r.data.settings,
	sequences: r.data.motionTextSequences,
	scenes: r.data.scenes.map(({ updatedAt, ...scene }) => scene),
});
const original = projection(
	JSON.parse(await readFile(join(project, "project.json"), "utf8")).record,
);
assert.equal(original.sequences[0].cues.length, 600);
assert.equal(original.sequences[0].duration, 480 * 120000);
await import(
	pathToFileURL(join(host, "packages/elftia-cli/src/proxy.ts")).href
);
const { connect } = await import(
	pathToFileURL(join(host, "packages/elftia-cli/src/connect.ts")).href
);
const conn = await connect({
	mode: "attach",
	port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
const previous = conn.page.viewportSize();
let frame,
	created,
	switched = false;
const checkpoint = async (label) => {
	const samples = [];
	// Each CIM query refreshes native formatted counters; retain all samples.
	// Do not select only a minimum or subtract unrelated process allocations.
	for (let i = 0; i < 3; i++) {
		const sample = await readWindowsGpuMemory({ gpuPid, mainPid, created });
		created ??= sample.created;
		samples.push({ time: new Date().toISOString(), ...sample });
	}
	evidence.checkpoints.push({ label, samples });
	await writeFile(
		join(work, "evidence.json"),
		JSON.stringify(evidence, null, 2),
	);
	console.log(JSON.stringify({ label, totals: samples.map((s) => s.totals) }));
};
const close = async () => {
	const button = conn.page.locator(
		'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
	);
	if (await button.count()) await button.click();
	await expect(
		conn.page.locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]'),
	).toHaveCount(0);
};
const open = async (path) => {
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
		.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
		.click();
	await expect
		.poll(
			async () => {
				for (const candidate of conn.page.frames())
					if (candidate.url() === result.editorUrl) {
						frame = candidate;
						return true;
					}
				return false;
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	await frame.getByLabel("Media", { exact: true }).waitFor({ timeout: 30000 });
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
	const browserCdp = await conn.context.browser().newBrowserCDPSession();
	try {
		const info = await browserCdp.send("SystemInfo.getProcessInfo");
		assert(
			info.processInfo.some((p) => p.id === gpuPid && p.type === "GPU"),
			"CDP GPU must match sampled PID",
		);
		assert(
			info.processInfo.some((p) => p.id === mainPid && p.type === "browser"),
			"CDP browser must match owning host",
		);
	} finally {
		await browserCdp.detach();
	}
	await conn.page.setViewportSize({ width: 1920, height: 1080 });
	await close();
	switched = true;
	await checkpoint("before F05, editor closed");
	await open(project);
	const scripts = await frame.evaluate(() =>
		[...document.scripts].map((s) => s.src).filter(Boolean),
	);
	for (const url of scripts) {
		const pathname = new URL(url).pathname,
			offset = pathname.lastIndexOf("/assets/");
		assert(offset >= 0);
		const asset = pathname.slice(offset + 1);
		const local = resolve(installed, "vendor/surface", asset);
		assert(
			!relative(resolve(installed, "vendor/surface"), local).startsWith(".."),
		);
		const sha256 = createHash("sha256")
			.update(await readFile(local))
			.digest("hex");
		const served = await frame.evaluate(
			async (url) =>
				[
					...new Uint8Array(
						await crypto.subtle.digest(
							"SHA-256",
							await (await fetch(url)).arrayBuffer(),
						),
					),
				]
					.map((v) => v.toString(16).padStart(2, "0"))
					.join(""),
			url,
		);
		assert.equal(served, sha256);
		evidence.assets.push({ asset, sha256 });
	}
	await checkpoint("F05 opened before warmup");
	await probeMotionStressMemory({
		page: frame,
		hostPage: conn.page,
		work,
		evidence,
		onPhase: (phase) => console.log("phase: " + phase),
		onCheckpoint: checkpoint,
		onLifecycle: checkpoint,
	});
	assert.equal(evidence.f05Memory.closedTargetDestroyed, true);
	await close();
	await checkpoint("final editor close after verified reopen");
	evidence.passed = true;
} catch (error) {
	evidence.error = String(error.stack).replace(
		/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/[^\s/]+/g,
		"$1/[redacted]",
	);
	process.exitCode = 1;
	await conn.page
		.screenshot({ path: join(work, "failure.png") })
		.catch(() => {});
} finally {
	try {
		if (switched) {
			await close();
			await open(restore);
		}
		assert.deepEqual(
			projection(
				JSON.parse(await readFile(join(project, "project.json"), "utf8"))
					.record,
			),
			original,
		);
		if (previous) await conn.page.setViewportSize(previous);
		else {
			const cdp = await conn.context.newCDPSession(conn.page);
			await cdp.send("Emulation.clearDeviceMetricsOverride");
			await cdp.detach();
		}
		evidence.restored = true;
	} catch (error) {
		evidence.restoreError = String(error.message);
		evidence.passed = false;
		process.exitCode = 1;
	}
	await writeFile(
		join(work, "evidence.json"),
		JSON.stringify(evidence, null, 2),
	);
	await conn.close();
	console.log(
		JSON.stringify({
			work,
			passed: evidence.passed,
			restored: evidence.restored,
			error: evidence.error,
		}),
	);
}
