import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
const { inventoryPlugin, normalizePluginPath } = await loadRocutProbe("probe-plugin-inventory.mjs");
const { validateInstalledWorkflow } = await loadRocutProbe("probe-installed-workflow-result.mjs");

// Fresh continuous editor workflow followed by actual historical installation.
// No reuse of old passing evidence and no modification of child evidence files.
assert(process.argv.includes("--allow-plugin-replacement"));
for (const key of [
	"ELFTIA_WORKTREE",
	"ELFTIA_TEST_SESSION",
	"ELFTIA_INSTALLED_ROCUT",
	"ELFTIA_LEGACY_ROCUT",
	"ELFTIA_CLI_DEBUG_PORT",
	"ELFTIA_PLUGIN_KIT_CLI",
])
	assert(process.env[key], key);
const main = await realpath(process.env.ELFTIA_WORKTREE);
const installed = resolve(process.env.ELFTIA_INSTALLED_ROCUT);
const evidenceRoot = await realpath(join(main, ".tmp-rocut-e2e"));
const work = await mkdtemp(join(evidenceRoot, "installed-workflow-"));
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const evidence = {
	kind: "real-elftia-continuous-and-historical-upgrade",
	passed: false,
	checks: [],
	children: [],
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const scrub = (value) =>
	String(value).replace(
		/(https?:\/\/(?:127\.0\.0\.1|localhost):\d+)\/[^\s/]+/g,
		"$1/[redacted]",
	);
const save = () =>
	writeFile(join(work, "evidence.json"), JSON.stringify(evidence, null, 2));
async function runProbe({ script, flags, env = {} }) {
	let summary;
	const child = spawn(
		process.execPath,
		[
			join(main, "node_modules/tsx/dist/cli.mjs"),
			join(repo, "scripts", script),
			...flags,
		],
		{
			cwd: repo,
			env: { ...process.env, ...env },
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const output = createInterface({ input: child.stdout });
	const errors = createInterface({ input: child.stderr });
	output.on("line", (line) => {
		console.log(scrub(line));
		try {
			const parsed = JSON.parse(line);
			if (parsed.work) summary = parsed;
		} catch {
			/* Ordinary phase line. */
		}
	});
	errors.on("line", (line) => console.error(scrub(line)));
	const status = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve(code));
	});
	assert(summary?.work, `${script} did not report an evidence directory`);
	const childWork = await realpath(summary.work);
	const nested = relative(evidenceRoot, childWork);
	assert(nested && !nested.startsWith("..") && !isAbsolute(nested));
	const bytes = await readFile(join(childWork, "evidence.json"));
	const result = JSON.parse(bytes.toString("utf8"));
	evidence.children.push({
		script,
		work: childWork,
		evidenceSha256: hash(bytes),
		status,
		passed: result.passed === true,
	});
	await save();
	assert.equal(
		status,
		0,
		`${script} failed; retain its evidence and do not retry`,
	);
	assert.equal(result.passed, true);
	return result;
}
try {
	const initial = await inventoryPlugin(installed);
	evidence.initialInventory = initial.sha256;
	await save();
	const linked = await runProbe({
		script: "probe-elftia-interactions.mjs",
		flags: ["--linked-workflow-only"],
	});
	assert.equal(
		(await inventoryPlugin(installed)).sha256,
		initial.sha256,
		"runtime changed during continuous workflow",
	);
	const folder = await realpath(join(evidenceRoot, "project"));
	const project = await realpath(linked.projectPath);
	const nested = relative(folder, project);
	assert(nested && !nested.startsWith("..") && !isAbsolute(nested));
	evidence.projectPath = project;
	const legacy = await runProbe({
		script: "probe-installed-legacy.mjs",
		flags: ["--allow-plugin-replacement"],
		env: { ELFTIA_RESTORE_TEST_PROJECT: project },
	});
	const final = await inventoryPlugin(installed);
	assert.deepEqual(
		final.files,
		initial.files,
		"historical probe must restore the complete current plugin",
	);
	assert.equal(
		normalizePluginPath(legacy.restoreProject),
		normalizePluginPath(project),
	);
	const combined = validateInstalledWorkflow({
		linked,
		legacy,
		initialInventory: initial.sha256,
		finalInventory: final.sha256,
	});
	Object.assign(evidence, combined, {
		finalInventory: final.sha256,
		passed: true,
	});
} catch (error) {
	evidence.error = scrub(error.stack ?? error);
	process.exitCode = 1;
} finally {
	await save();
	console.log(
		JSON.stringify({
			work,
			passed: evidence.passed,
			checks: evidence.checks.length,
			error: evidence.error,
		}),
	);
}
