import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "./rocut-probe-source.mjs";
const { installWebGpuAudit } = await loadRocutProbe("probe-webgpu-audit.mjs");
const { reloadEditorFrame } = await loadRocutProbe("probe-reload-editor.mjs");
const { probeMotionStressMemory } = await loadRocutProbe("probe-motion-stress-memory.mjs");

const required = [
	"ELFTIA_WORKTREE",
	"ELFTIA_TEST_SESSION",
	"ELFTIA_CLI_DEBUG_PORT",
	"ELFTIA_REUSE_TEST_PROJECT",
	"ELFTIA_RESTORE_TEST_PROJECT",
	"ELFTIA_INSTALLED_ROCUT",
];
for (const key of required) assert(process.env[key], "Missing " + key);
const host = await realpath(process.env.ELFTIA_WORKTREE);
const folder = await realpath(join(host, ".tmp-rocut-e2e/project"));
const project = await realpath(process.env.ELFTIA_REUSE_TEST_PROJECT);
const restoreProject = await realpath(process.env.ELFTIA_RESTORE_TEST_PROJECT);
for (const candidate of [project, restoreProject]) {
	const nested = relative(folder, candidate);
	assert(
		nested && !nested.startsWith("..") && !isAbsolute(nested),
		"Only owned fixtures may open",
	);
}
const work = await mkdtemp(join(host, ".tmp-rocut-e2e/installed-gpu-"));
const evidence = {
	kind: "installed-ordinary-editor-webgpu-api-diagnostic",
	date: new Date().toISOString(),
	acceptanceEligible: false,
	projectPath: project,
	scope:
		"Native WebGPU create/destroy API calls during exact visible F05 seeks; not driver memory bytes, implicit GC release, or uninstrumented timing",
	checks: [],
	checkpoints: [],
	passed: false,
};
const projection = (record) => ({
	id: record.id,
	settings: record.data.settings,
	sequences: record.data.motionTextSequences,
	scenes: record.data.scenes.map(({ updatedAt, ...scene }) => scene),
});
const original = projection(
	JSON.parse(await readFile(join(project, "project.json"), "utf8")).record,
);
assert.equal(original.sequences[0].cues.length, 600);
assert.equal(original.sequences[0].duration, 480 * 120000);
const installed = await realpath(process.env.ELFTIA_INSTALLED_ROCUT);
const manifest = JSON.parse(
	await readFile(join(installed, "elftia-plugin.json"), "utf8"),
);
evidence.pluginVersion = manifest.version;
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
	instrument,
	scriptId,
	switched = false;
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
				for (const candidate of conn.page.frames()) {
					if (
						(await candidate.evaluate(() => location.href).catch(() => "")) ===
						result.editorUrl
					) {
						frame = candidate;
						return true;
					}
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
	await conn.page.setViewportSize({ width: 1920, height: 1080 });
	await close();
	switched = true;
	await open(project);
	instrument = await conn.context.newCDPSession(frame);
	await instrument.send("Page.enable");
	({ identifier: scriptId } = await instrument.send(
		"Page.addScriptToEvaluateOnNewDocument",
		{ source: "(" + installWebGpuAudit.toString() + ")()" },
	));
	await reloadEditorFrame(frame);
	await expect
		.poll(() =>
			frame.evaluate(
				() => globalThis.__rocutGpuAudit?.snapshot().texture.created ?? 0,
			),
		)
		.toBeGreaterThan(0);
	// Remove the reload hook immediately; instrumentation lives only in this document.
	await instrument.send("Page.removeScriptToEvaluateOnNewDocument", {
		identifier: scriptId,
	});
	scriptId = undefined;
	const scripts = await frame.evaluate(() =>
		[...document.scripts].map((s) => s.src).filter(Boolean),
	);
	evidence.assets = [];
	for (const url of scripts) {
		const pathname = new URL(url).pathname;
		const offset = pathname.lastIndexOf("/assets/");
		assert(offset >= 0, "Only packaged editor assets expected");
		const asset = pathname.slice(offset + 1);
		const local = resolve(installed, "vendor/surface", asset);
		const bytes = await readFile(local);
		const hash = createHash("sha256").update(bytes).digest("hex");
		const actual = await frame.evaluate(async (url) => {
			const bytes = await (await fetch(url)).arrayBuffer();
			return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
				.map((v) => v.toString(16).padStart(2, "0"))
				.join("");
		}, url);
		assert.equal(actual, hash);
		evidence.assets.push({ asset, sha256: hash });
	}
	const checkpoint = async (label) => {
		const state = await frame.evaluate(async () => {
			await globalThis.__rocutGpuAudit.settle();
			return globalThis.__rocutGpuAudit.snapshot();
		});
		assert.equal(state.available, true);
		assert.equal(state.unexpectedLosses, 0);
		evidence.checkpoints.push({ label, ...state });
		console.log(
			JSON.stringify({ label, textures: state.texture, buffers: state.buffer }),
		);
	};
	await probeMotionStressMemory({
		page: frame,
		hostPage: conn.page,
		work,
		evidence,
		onPhase: (phase) => console.log("phase: " + phase),
		onCheckpoint: checkpoint,
	});
	const baseline = evidence.checkpoints[0];
	for (const point of evidence.checkpoints.slice(1)) {
		for (const kind of ["texture", "buffer"])
			assert.equal(
				point[kind].live,
				baseline[kind].live,
				kind + " unreleased JS-wrapper count must stay flat after GC",
			);
	}
	assert(
		evidence.checkpoints.at(-1).texture.created > baseline.texture.created,
	);
	assert(
		evidence.checkpoints.at(-1).texture.collectedWithoutDestroy +
			evidence.checkpoints.at(-1).texture.destroyed >
			baseline.texture.collectedWithoutDestroy + baseline.texture.destroyed,
	);
	assert.equal(evidence.f05Memory.closedTargetDestroyed, true);
	evidence.checks.push({
		name: "Native WebGPU unreleased wrapper retention remains flat after forced GC; old iframe target destroyed",
		pass: true,
	});
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
		if (scriptId)
			await instrument.send("Page.removeScriptToEvaluateOnNewDocument", {
				identifier: scriptId,
			});
		await instrument?.detach().catch(() => {});
		if (switched) {
			await close();
			await open(restoreProject);
		}
		const after = projection(
			JSON.parse(await readFile(join(project, "project.json"), "utf8")).record,
		);
		assert.deepEqual(
			after,
			original,
			"Authored F05 project content must remain unchanged",
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
