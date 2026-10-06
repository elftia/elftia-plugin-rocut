import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import {
	mkdtemp,
	readFile,
	readdir,
	realpath,
	writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { expect } from "./rocut-probe-source.mjs";
const { reloadEditorFrame } = await loadRocutProbe("probe-reload-editor.mjs");
const { checksum, createLegacyProjectFixture } = await loadRocutProbe("probe-project-migration-fixtures.mjs");

// Synthetic legacy fixtures are isolated copies, never an in-place user-project downgrade.
const hostRoot = resolve(process.env.ELFTIA_WORKTREE ?? "");
assert(process.env.ELFTIA_WORKTREE && process.env.ELFTIA_TEST_SESSION);
assert(process.env.ELFTIA_MIGRATION_SOURCE_PROJECT);
const ownerFolder = join(hostRoot, ".tmp-rocut-e2e", "project");
const source = await realpath(process.env.ELFTIA_MIGRATION_SOURCE_PROJECT);
const inside = relative(await realpath(ownerFolder), source);
assert(inside && !inside.startsWith("..") && !isAbsolute(inside));
await import(
	pathToFileURL(join(hostRoot, "packages/elftia-cli/src/proxy.ts")).href
);
const { connect } = await import(
	pathToFileURL(join(hostRoot, "packages/elftia-cli/src/connect.ts")).href
);
const conn = await connect({
	mode: "attach",
	port: Number(process.env.ELFTIA_CLI_DEBUG_PORT ?? 9333),
});
const work = await mkdtemp(join(hostRoot, ".tmp-rocut-e2e", "migration-"));
const evidence = {
	kind: "real-elftia-installed-migration",
	fixture:
		"synthetic v31 copy of owned v32 media project, not an archival user project",
	checks: [],
	errors: [],
};
const scrub = (value) =>
	String(value).replace(
		/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/[^\s/]+/g,
		"$1/[redacted]",
	);
const createFixture = (
	version,
	invalidIdentity = false,
	payloadVersion = version,
) =>
	createLegacyProjectFixture({
		source,
		ownerFolder,
		work,
		version,
		invalidIdentity,
		payloadVersion,
	});
const previousViewport = conn.page.viewportSize();
let phase = "ownership";
function check(name, details = {}) {
	evidence.checks.push({ name, ...details, pass: true });
}
function next(name) {
	phase = name;
	console.log("phase:", name);
}

async function openProject(folder) {
	const opened = await conn.page.evaluate(
		async ({ folder, ownerFolder }) =>
			window.native.toolHosts.openProject({
				toolId: "rocut",
				workingFolder: ownerFolder,
				projectPath: folder,
			}),
		{ folder, ownerFolder },
	);
	const close = conn.page.locator(
		'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
	);
	if (await close.count()) await close.click();
	await conn.page
		.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
		.click();
	let editor;
	await expect
		.poll(
			async () => {
				for (const frame of conn.page.frames()) {
					if (
						(await frame.title().catch(() => "")).startsWith(
							"OpenCut editor",
						) &&
						(await frame.evaluate(() => location.href).catch(() => "")) ===
							opened.editorUrl
					) {
						editor = frame;
						return true;
					}
				}
				return false;
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	await expect(editor.getByLabel("Media", { exact: true })).toBeVisible({
		timeout: 30000,
	});
	return editor;
}

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
	assert.equal(resolve(owner.folder), ownerFolder);
	await conn.page.setViewportSize({ width: 1280, height: 900 });
	conn.page.on("pageerror", (error) =>
		evidence.errors.push(scrub(error.message)),
	);
	next("open synthetic v31 media project through installed Tool Host");
	const legacy = await createFixture(31);
	evidence.projectPath = legacy.folder;
	let editor = await openProject(legacy.folder);
	const readRecord = () =>
		editor.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record,
		);
	let migrated = await readRecord();
	assert.equal(migrated.schemaVersion, 32);
	assert.equal(migrated.data.version, 32);
	assert.deepEqual(migrated.data.motionTextSequences, []);
	assert.deepEqual(
		migrated.data.providerExtension,
		legacy.wrapper.record.data.providerExtension,
	);
	assert.deepEqual(migrated.data.scenes, legacy.wrapper.record.data.scenes);
	check(
		"v31 migrates additively to v32 and preserves existing media timeline and unknown extension",
	);
	for (const entry of await readdir(join(source, "attachments"))) {
		for (const name of ["body.bin", "metadata.json"]) {
			const expected = checksum(
				await readFile(join(source, "attachments", entry, name)),
			);
			assert.equal(
				checksum(
					await readFile(join(legacy.folder, "attachments", entry, name)),
				),
				expected,
			);
		}
	}
	check("migration preserves every fixture attachment byte and metadata");
	next("edit migrated audio through UI and verify undo redo plus reopen");
	const clip = migrated.data.scenes[0].tracks.audio[0].elements[0];
	assert.equal(clip.params.volume, 0);
	await editor
		.locator('[data-testid="timeline-clip"][data-element-id="' + clip.id + '"]')
		.click();
	await editor.getByLabel("Volume", { exact: true }).fill("-6");
	await editor.getByLabel("Volume", { exact: true }).press("Enter");
	const volume = async () =>
		(await readRecord()).data.scenes[0].tracks.audio[0].elements[0].params
			.volume;
	await expect.poll(volume).toBe(-6);
	await editor
		.locator('[data-testid="timeline-clip"][data-element-id="' + clip.id + '"]')
		.click();
	await conn.page.keyboard.press("Control+z");
	await expect.poll(volume).toBe(0);
	await conn.page.keyboard.press("Control+Shift+z");
	await expect.poll(volume).toBe(-6);
	await reloadEditorFrame(editor);
	await expect.poll(volume).toBe(-6);
	migrated = await readRecord();
	assert.deepEqual(
		migrated.data.providerExtension,
		legacy.wrapper.record.data.providerExtension,
	);
	check(
		"real migrated-project audio edit, undo, redo and reload persist without losing unknown data",
	);
	await editor.getByLabel("Edit playhead time", { exact: true }).click();
	await editor.getByLabel("Playhead time", { exact: true }).fill("00:00:01:00");
	await editor.getByLabel("Playhead time", { exact: true }).press("Enter");
	await conn.page.screenshot({ path: join(work, "migrated-preview.png") });
	next("refuse future and unmigratable schemas without modifying files");
	for (const [version, invalidIdentity, payloadVersion, expectedMessage] of [
		[33, false, 33, "newer than supported"],
		[31, true, 31, "refused a required schema step"],
		[32, false, 33, "newer than supported"],
		[31, false, 33, "newer than supported"],
		[32, false, 31, "does not match"],
	]) {
		const fixture = await createFixture(
			version,
			invalidIdentity,
			payloadVersion,
		);
		evidence.refusalFixtures ??= [];
		evidence.refusalFixtures.push({
			projectPath: fixture.folder,
			schemaVersion: version,
			payloadVersion,
		});
		let message = "";
		try {
			await conn.page.evaluate(
				async ({ folder, ownerFolder }) =>
					window.native.toolHosts.openProject({
						toolId: "rocut",
						workingFolder: ownerFolder,
						projectPath: folder,
					}),
				{ folder: fixture.folder, ownerFolder },
			);
		} catch (error) {
			message = scrub(error.message);
		}
		// The host deliberately withholds arbitrary process output (it may include
		// authenticated URLs). Confirm the exact refusal from its local log while
		// retaining only the known, non-secret migration reason in test evidence.
		if (!message.includes(expectedMessage)) {
			assert(
				message.includes("exited (exit code 1) before becoming live"),
				"Unexpected host failure: " + message,
			);
			const logPath = message.match(
				/withheld from diagnostics bundles\): ([^\r\n]+)/,
			)?.[1];
			assert(logPath, "Refusal omitted its diagnostic log path");
			const logName = relative(
				await realpath(join(homedir(), ".elftia", "logs", "tool-hosts")),
				await realpath(logPath),
			);
			assert(
				/^rocut-[a-f0-9]+\.log$/.test(logName),
				"Unexpected diagnostic log location",
			);
			const logText = await readFile(logPath, "utf8");
			assert(
				logText.includes(expectedMessage),
				"Diagnostic log did not confirm the expected migration refusal",
			);
		}
		assert.equal(
			checksum(await readFile(join(fixture.folder, "project.json"))),
			fixture.checksum,
		);
		check(
			payloadVersion === 33
				? "future schema or payload rejected without a downgrade write"
				: "unmigratable legacy payload rejected without partial migration",
			{
				schemaVersion: version,
				payloadVersion,
				diagnosticReason: expectedMessage,
				publicErrorIsGeneric: !message.includes(expectedMessage),
			},
		);
	}
	next("reopen valid project after rejected migrations");
	editor = await openProject(legacy.folder);
	await expect.poll(volume).toBe(-6);
	assert.deepEqual(
		(await readRecord()).data.providerExtension,
		legacy.wrapper.record.data.providerExtension,
	);
	assert.equal(evidence.errors.length, 0, evidence.errors.join("\n"));
	check("valid installed editor recovers after failed project opens");
	evidence.passed = true;
} catch (error) {
	evidence.passed = false;
	evidence.failure = { phase, message: scrub(error.stack ?? error.message) };
	console.error("FAILED", phase, scrub(error.message));
	process.exitCode = 1;
} finally {
	try {
		if (previousViewport) await conn.page.setViewportSize(previousViewport);
	} catch (error) {
		evidence.cleanupFailure = scrub(error.message);
	}
	await writeFile(
		join(work, "evidence.json"),
		JSON.stringify(evidence, null, 2),
		"utf8",
	);
	console.log(
		JSON.stringify({
			work,
			passed: evidence.passed,
			checks: evidence.checks.length,
			phase,
		}),
	);
	await conn
		.close()
		.catch((error) =>
			console.error("Disconnect failed:", scrub(error.message)),
		);
}
