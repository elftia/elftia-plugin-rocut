import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { getRocutProbeRoot } from "./rocut-probe-source.mjs";
import { pathToFileURL } from "node:url";

const root = getRocutProbeRoot();
const host = resolve(process.env.ELFTIA_WORKTREE ?? "");
const sessionId = process.env.ELFTIA_TEST_SESSION;
const installed = process.env.ELFTIA_INSTALLED_ROCUT;
assert(
	process.env.ELFTIA_WORKTREE && sessionId && installed,
	"Set explicit Elftia worktree, owned test session and installed Rocut paths",
);
const wasm = readFileSync(join(root, "rust/wasm/pkg/opencut_wasm_bg.wasm"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wasmSha256 = hash(wasm);
assert.equal(
	hash(readFileSync(join(installed, "vendor/run/opencut_wasm_bg.wasm"))),
	wasmSha256,
	"Probe binary must be the installed plugin binary",
);
const routes = new Map([
	[
		"/",
		[
			"text/html",
			Buffer.from(
				'<!doctype html><title>Rocut compositor protocol probe</title><script type="module">import {runTransitionCompositorProbe} from "./probe.js"; window.probeResult=runTransitionCompositorProbe().catch(error=>({passed:false,error:String(error)}));</script>',
			),
		],
	],
	[
		"/probe.js",
		[
			"text/javascript",
			readFileSync(
				join(root, "script/probe-transition-compositor-browser.mjs"),
			),
		],
	],
	[
		"/opencut_wasm_bg.js",
		[
			"text/javascript",
			readFileSync(join(root, "rust/wasm/pkg/opencut_wasm_bg.js")),
		],
	],
	[
		"/transition-graph.js",
		[
			"text/javascript",
			readFileSync(join(root, "script/probe-transition-graph-browser.mjs")),
		],
	],
	["/opencut_wasm_bg.wasm", ["application/wasm", wasm]],
]);
const server = createServer((request, response) => {
	const route = routes.get(request.url);
	if (!route) {
		response.writeHead(404);
		response.end();
		return;
	}
	response.writeHead(200, {
		"Content-Type": route[0],
		"Cache-Control": "no-store",
	});
	response.end(route[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port + "/";
const evidenceRoot = join(host, ".tmp-rocut-e2e");
mkdirSync(evidenceRoot, { recursive: true });
const work = mkdtempSync(join(evidenceRoot, "compositor-"));
const evidence = {
	kind: "real-elftia-compositor-protocol",
	notTransitionUiAcceptance: true,
	wasmSha256,
};
const probeId = "rocut-owned-compositor-probe-" + randomUUID();
let conn;
try {
	await import(
		pathToFileURL(join(host, "packages/elftia-cli/src/proxy.ts")).href
	);
	const { connect } = await import(
		pathToFileURL(join(host, "packages/elftia-cli/src/connect.ts")).href
	);
	conn = await connect({
		mode: "attach",
		port: Number(process.env.ELFTIA_CLI_DEBUG_PORT ?? 9333),
	});
	const ownership = await conn.page.evaluate(
		async (id) => ({
			active: document
				.querySelector('[data-session-active="true"]')
				?.getAttribute("data-session-id"),
			folder: (await window.native.sessions.chat.get(id)).projectPath,
		}),
		sessionId,
	);
	assert.equal(ownership.active, sessionId);
	assert.equal(resolve(ownership.folder), join(evidenceRoot, "project"));
	await conn.page.evaluate(
		({ src, id }) => {
			if (document.getElementById(id)) throw Error("Probe already exists");
			const iframe = document.createElement("iframe");
			iframe.id = id;
			iframe.title = "Rocut compositor protocol probe";
			iframe.style.cssText =
				"position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
			iframe.src = src;
			document.body.append(iframe);
		},
		{ src: url, id: probeId },
	);
	const element = await conn.page.waitForSelector("#" + probeId);
	const frame = await element.contentFrame();
	await frame.waitForFunction(() => Boolean(window.probeResult), undefined, {
		timeout: 30000,
	});
	const result = await frame.evaluate(() => window.probeResult);
	Object.assign(evidence, result);
	assert.equal(result.passed, true, result.error);
} catch (error) {
	evidence.passed = false;
	evidence.error = String(error);
	process.exitCode = 1;
} finally {
	if (conn) {
		await conn.page
			.evaluate((id) => document.getElementById(id)?.remove(), probeId)
			.catch(() => {});
		await conn.close();
	}
	await new Promise((resolve) => server.close(resolve));
	writeFileSync(join(work, "evidence.json"), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify({ work, ...evidence }));
}
