import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, readFile, realpath, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { expect } from "./rocut-probe-source.mjs";
const { probeFocusedMotion } = await loadRocutProbe("probe-focused-motion.mjs");
const { inventoryPlugin: inventory, normalizePluginPath: normalize } = await loadRocutProbe("probe-plugin-inventory.mjs");

// Explicit opt-in: temporarily install an actual historical plugin, never a mock.
// Only a new dedicated fixture is opened by that runtime; always restore current.
assert(process.argv.includes("--allow-plugin-replacement"));
for (const name of [
	"ELFTIA_WORKTREE",
	"ELFTIA_TEST_SESSION",
	"ELFTIA_INSTALLED_ROCUT",
	"ELFTIA_LEGACY_ROCUT",
	"ELFTIA_RESTORE_TEST_PROJECT",
	"ELFTIA_CLI_DEBUG_PORT",
	"ELFTIA_PLUGIN_KIT_CLI",
])
	assert(process.env[name], name);
const main = resolve(process.env.ELFTIA_WORKTREE);
const installed = resolve(process.env.ELFTIA_INSTALLED_ROCUT);
const legacy = resolve(process.env.ELFTIA_LEGACY_ROCUT);
const restoreProject = await realpath(process.env.ELFTIA_RESTORE_TEST_PROJECT);
const folder = await realpath(join(main, ".tmp-rocut-e2e/project"));
const nested = relative(folder, restoreProject);
assert(nested && !nested.startsWith("..") && !isAbsolute(nested));
const work = await mkdtemp(join(main, ".tmp-rocut-e2e/installed-legacy-"));
const evidence = {
	kind: "real-elftia-historical-plugin",
	checks: [],
	errors: [],
	replacementAttempted: false,
	restored: false,
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
await import(
	pathToFileURL(join(main, "packages/elftia-cli/src/proxy.ts")).href
);
const { connect } = await import(
	pathToFileURL(join(main, "packages/elftia-cli/src/connect.ts")).href
);
const conn = await connect({
	mode: "attach",
	port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
const scrub = (value) =>
	String(value).replace(
		/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/[^\s/]+/g,
		"$1/[redacted]",
	);
conn.page.on("pageerror", (error) =>
	evidence.errors.push(scrub(error.message)),
);
const run = promisify(execFile);
let backup, before, legacyBefore;
const close = async () => {
	const button = conn.page.locator(
		'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
	);
	if (await button.count()) await button.click();
	await expect(
		conn.page.locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]'),
	).toHaveCount(0, { timeout: 20000 });
};
const install = async (source) => {
	const result = await conn.page.evaluate(async (path) => {
		const r = await window.native.plugins.installLocal({ path });
		return { success: r.success, error: r.error };
	}, source);
	assert.notEqual(result.success, false, JSON.stringify(result));
	await conn.page.evaluate(() =>
		window.native.plugins.setEnabled({ id: "rocut", enabled: true }),
	);
};
const open = async (projectPath) => {
	const opened = await conn.page.evaluate(
		({ folder, projectPath }) =>
			window.native.toolHosts.openProject({
				toolId: "rocut",
				workingFolder: folder,
				projectPath,
			}),
		{ folder, projectPath },
	);
	await conn.page
		.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
		.click();
	let frame;
	await expect
		.poll(
			async () => {
				for (const f of conn.page.frames())
					if (
						(await f.evaluate(() => location.href).catch(() => "")) ===
						opened.editorUrl
					) {
						frame = f;
						return true;
					}
				return false;
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	await frame.getByLabel("Media", { exact: true }).waitFor({ timeout: 30000 });
	return frame;
};
const recordBytes = (project) => readFile(join(project, "project.json"));
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
	const oldManifest = JSON.parse(
		await readFile(join(legacy, "elftia-plugin.json"), "utf8"),
	);
	assert.equal(oldManifest.name, "rocut");
	assert.equal(oldManifest.version, "0.4.0");
	evidence.legacyVersion = oldManifest.version;
	evidence.legacySourceCommit = (
		await readFile(join(legacy, "vendor/PROVENANCE.md"), "utf8")
	).match(/Upstream source commit: ([a-f0-9]{40})/)?.[1];
	assert(
		evidence.legacySourceCommit,
		"Historical source identity must be known",
	);
	legacyBefore = await inventory(legacy);
	// Old distribution predates mandatory code-entry metadata. Only the
	// official stamp tool may adapt the isolated copy; historical bytes stay exact.
	const legacyPackage = join(work, "legacy-package");
	await cp(legacy, legacyPackage, {
		recursive: true,
		force: false,
		errorOnExist: true,
	});
	for (const command of ["stamp", "verify"]) {
		await run(
			process.execPath,
			[process.env.ELFTIA_PLUGIN_KIT_CLI, command, legacyPackage],
			{ timeout: 30000, windowsHide: true },
		);
	}
	const stamped = JSON.parse(
		await readFile(join(legacyPackage, "elftia-plugin.json"), "utf8"),
	);
	const checksum = stamped.contributes.main.checksum;
	assert.equal(
		checksum,
		"sha512-" +
			createHash("sha512")
				.update(await readFile(join(legacy, "main/index.cjs")))
				.digest("base64"),
	);
	delete stamped.contributes.main.checksum;
	assert.deepEqual(
		stamped,
		oldManifest,
		"Only code-entry checksum metadata may change",
	);
	const packaged = await inventory(legacyPackage);
	assert.deepEqual(
		packaged.files.filter((f) => f.path !== "elftia-plugin.json"),
		legacyBefore.files.filter((f) => f.path !== "elftia-plugin.json"),
	);
	evidence.legacyAdaptation = {
		kind: "official code-entry checksum stamp only",
		checksum,
		inventory: packaged.sha256,
	};
	await close();
	const originalProjectHash = hash(await recordBytes(restoreProject));
	evidence.restoreProject = restoreProject;
	evidence.originalProjectHash = originalProjectHash;
	before = await inventory(installed);
	const backupRoot = join(homedir(), ".elftia/plugin-backups");
	assert.equal(normalize(await realpath(backupRoot)), normalize(backupRoot));
	backup = join(
		await mkdtemp(join(backupRoot, "rocut-before-actual-legacy-")),
		"rocut",
	);
	await cp(installed, backup, {
		recursive: true,
		force: false,
		errorOnExist: true,
	});
	assert.deepEqual((await inventory(backup)).files, before.files);
	assert.deepEqual((await inventory(installed)).files, before.files);
	evidence.backup = backup;
	evidence.currentInventory = before.sha256;
	evidence.legacyInventory = legacyBefore.sha256;
	await writeFile(
		join(work, "evidence.json"),
		JSON.stringify(evidence, null, 2),
	);
	console.log("phase: verified backup; install actual 0.4.0 plugin");
	evidence.replacementAttempted = true;
	await install(legacyPackage);
	assert.deepEqual((await inventory(installed)).files, packaged.files);
	const created = await conn.page.evaluate(
		(folder) =>
			window.native.toolHosts.createProject({
				toolId: "rocut",
				workingFolder: folder,
				name: "legacy-" + Date.now(),
			}),
		folder,
	);
	assert(
		relative(folder, created.path) &&
			!relative(folder, created.path).startsWith("..") &&
			!isAbsolute(relative(folder, created.path)),
	);
	evidence.fixture = created.path;
	let frame = await open(created.path);
	await conn.page.screenshot({ path: join(work, "actual-legacy-editor.png") });
	const cli = async () =>
		run(
			process.execPath,
			[
				join(backup, "vendor/run/rocut.mjs"),
				"motion-text",
				"catalog",
				"--project",
				created.path,
				"--targets-root",
				join(homedir(), ".rocut"),
			],
			{ timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
		);
	const unchanged = hash(await recordBytes(created.path));
	let failure;
	try {
		await cli();
	} catch (error) {
		failure = error;
	}
	assert.equal(failure?.code, 1);
	assert.equal(failure.stdout, "");
	assert.match(failure.stderr, /Upgrade the Rocut plugin/);
	assert.match(failure.stderr, /reopen its editor/);
	const detail = JSON.parse(failure.stderr.trim().split(/\r?\n/u)[1]);
	assert.equal(detail.httpStatus, 404);
	assert.equal(detail.response.code, "motion-text-capability-unavailable");
	assert.equal(detail.response.action, "upgrade-rocut-and-reopen");
	assert.equal(hash(await recordBytes(created.path)), unchanged);
	evidence.checks.push({
		name: "actual installed 0.4.0 refuses modern catalog with actionable diagnostic and no record write",
		pass: true,
	});
	console.log("phase: upgrade same legacy fixture back to current plugin");
	await close();
	await install(backup);
	assert.deepEqual((await inventory(installed)).files, before.files);
	frame = await open(created.path);
	const recovered = await cli();
	assert.equal(recovered.stderr, "");
	assert(JSON.parse(recovered.stdout).catalog.rendererSupportVersion >= 38);
	evidence.checks.push({
		name: "same project catalog recovers after actual plugin upgrade and reopen",
		pass: true,
	});
	await probeFocusedMotion({
		page: frame,
		hostPage: conn.page,
		work,
		evidence,
		onPhase: (value) => console.log("phase:", value),
	});
	assert.equal(hash(await recordBytes(restoreProject)), originalProjectHash);
	evidence.checks.push({
		name: "old runtime never changed the original modern project",
		pass: true,
	});
	assert.equal(
		evidence.errors.length,
		0,
		"Historical upgrade must not report uncaught page errors",
	);
	evidence.passed = true;
} catch (error) {
	evidence.error = String(error.stack).replace(
		/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/[^\s/]+/g,
		"$1/[redacted]",
	);
	process.exitCode = 1;
} finally {
	try {
		if (evidence.replacementAttempted) {
			await close();
			if ((await inventory(installed)).sha256 !== before.sha256)
				await install(backup);
			assert.deepEqual((await inventory(installed)).files, before.files);
			assert.deepEqual((await inventory(legacy)).files, legacyBefore.files);
			await open(restoreProject);
			evidence.restored = true;
		}
	} catch (error) {
		evidence.restoreError = String(error.message);
		process.exitCode = 1;
	}
	evidence.passed = evidence.passed === true && evidence.restored === true;
	await writeFile(
		join(work, "evidence.json"),
		JSON.stringify(evidence, null, 2),
	);
	await conn.close();
	console.log(
		JSON.stringify({
			work,
			passed: evidence.passed === true,
			checks: evidence.checks.length,
			restored: evidence.restored,
			error: evidence.error,
			restoreError: evidence.restoreError,
		}),
	);
}
