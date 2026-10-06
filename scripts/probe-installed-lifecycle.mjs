import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, join, relative, resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "./rocut-probe-source.mjs";

// Runs shipped session lifecycle controls inside the user's actual Elftia.
// A new loopback origin isolates BrowserProjectStore from all user projects.
// This is runtime lifecycle evidence, not a full-editor long-session GPU test.
const host = resolve(process.env.ELFTIA_WORKTREE ?? "");
const sessionId = process.env.ELFTIA_TEST_SESSION;
assert(
	process.env.ELFTIA_WORKTREE &&
		sessionId &&
		process.env.ELFTIA_INSTALLED_ROCUT,
);
const surface = await realpath(
	join(process.env.ELFTIA_INSTALLED_ROCUT, "vendor/surface"),
);
const work = await mkdtemp(join(host, ".tmp-rocut-e2e", "lifecycle-"));
const evidence = {
	kind: "installed-runtime-lifecycle-in-real-elftia",
	date: new Date().toISOString(),
	scope:
		"six-cycle shipped lifecycle harness; isolated BrowserProjectStore; not ordinary timeline UI or GPU byte accounting",
	controls: [],
	assets: {},
};
const types = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".wasm": "application/wasm",
	".json": "application/json",
	".woff2": "font/woff2",
	".png": "image/png",
	".svg": "image/svg+xml",
};
const server = createServer(async (request, response) => {
	try {
		const pathname = decodeURIComponent(
			new URL(request.url, "http://localhost").pathname,
		);
		const candidate = resolve(
			surface,
			"." + (pathname === "/" ? "/index.html" : pathname),
		);
		const nested = relative(surface, candidate);
		if (!nested || nested.startsWith("..") || isAbsolute(nested))
			throw Error("outside surface");
		const canonical = await realpath(candidate);
		const actual = relative(surface, canonical);
		if (!actual || actual.startsWith("..") || isAbsolute(actual))
			throw Error("outside surface");
		const bytes = await readFile(canonical);
		evidence.assets[actual.replaceAll("\\", "/")] = createHash("sha256")
			.update(bytes)
			.digest("hex");
		response.writeHead(200, {
			"Content-Type": types[extname(canonical)] ?? "application/octet-stream",
			"Cache-Control": "no-store",
		});
		response.end(bytes);
	} catch {
		response.writeHead(404);
		response.end();
	}
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port + "/";
const probeId = "rocut-owned-lifecycle-" + randomUUID();
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
	assert.equal(
		await realpath(ownership.folder),
		await realpath(join(host, ".tmp-rocut-e2e/project")),
	);
	for (const control of ["ordinary", "missing-created", "leak"]) {
		console.log("phase: installed lifecycle " + control);
		const consoleErrors = [],
			pageErrors = [],
			expectedRevocationFailures = [];
		const onConsole = (message) => {
			if (message.type() !== "error") return;
			const location = message.location().url;
			if (!location.startsWith(base) && !location.startsWith("blob:" + base))
				return;
			const target =
				location.startsWith("blob:" + base) &&
				message.text().includes("net::ERR_FILE_NOT_FOUND")
					? expectedRevocationFailures
					: consoleErrors;
			if (target.length < 50) target.push(message.text());
		};
		const onPageError = (error) => {
			if (error.stack?.includes(base) && pageErrors.length < 50)
				pageErrors.push(error.message);
		};
		conn.page.on("console", onConsole);
		conn.page.on("pageerror", onPageError);
		const url = new URL(base);
		url.searchParams.set("c6-disposal-harness", "1");
		url.searchParams.set("control", control);
		await conn.page.evaluate(
			({ id, src }) => {
				if (document.getElementById(id))
					throw Error("owned probe already present");
				const iframe = document.createElement("iframe");
				iframe.id = id;
				iframe.title = "Rocut owned lifecycle verification";
				iframe.allow = "autoplay";
				iframe.style.cssText =
					"position:fixed;inset:90px 20px 20px 80px;width:960px;height:650px;z-index:2147483647;background:white;border:2px solid #00aaff";
				iframe.src = src;
				document.body.append(iframe);
			},
			{ id: probeId, src: url.href },
		);
		try {
			const element = await conn.page.waitForSelector("#" + probeId);
			const frame = await element.contentFrame();
			const harness = frame.getByTestId("c6-disposal-harness");
			await expect(harness).toHaveAttribute("data-status", /^(ready|error)$/, {
				timeout: 120000,
			});
			const errorElement = frame.getByTestId("c6-disposal-error");
			const observation = {
				control,
				consoleErrors,
				pageErrors,
				expectedRevocationFailures,
				status: await harness.getAttribute("data-status"),
				marker: await harness.getAttribute("data-c6-build-marker"),
				store: await harness.getAttribute("data-c5-host-store"),
				audioFallback: await harness.getAttribute("data-audio-fallback"),
				error: (await errorElement.count())
					? await errorElement.textContent()
					: null,
				result: JSON.parse(
					(await frame.getByTestId("c6-disposal-report").textContent()) ||
						"null",
				),
			};
			evidence.controls.push(observation);
			await conn.page.screenshot({ path: join(work, control + ".png") });
			assert.equal(
				observation.status,
				"ready",
				observation.error ?? "harness not ready",
			);
			assert.equal(observation.store, "BrowserProjectStore");
			assert.equal(observation.audioFallback, "false");
			assert.deepEqual(consoleErrors, [], "unexpected harness console errors");
			assert.deepEqual(pageErrors, [], "unexpected harness page errors");
			assert.equal(observation.result.cycles.length, 6);
			for (const cycle of observation.result.cycles) {
				assert(
					cycle.lifecycle.sameEditor &&
						cycle.lifecycle.rootMountedDuringSuspend &&
						cycle.lifecycle.rootMountedAfterResume &&
						cycle.lifecycle.postResumeOperation,
				);
				const dwell = cycle.platformProof?.suspendedDwell;
				assert(dwell?.postResumeActivity);
				assert.equal(
					dwell.renderPublicationsBefore,
					dwell.renderPublicationsAfter,
				);
				assert.equal(
					dwell.timerResourcesCreatedBefore,
					dwell.timerResourcesCreatedAfter,
				);
				assert(
					dwell.rendererBeforeSuspend.generation != null &&
						dwell.rendererAfterResume.generation >
							dwell.rendererBeforeSuspend.generation,
				);
				assert(dwell.rendererBeforeSuspend.resourceId != null);
				assert.notEqual(
					dwell.rendererAfterResume.resourceId,
					dwell.rendererBeforeSuspend.resourceId,
				);
				assert(
					dwell.rendererAfterResume.publications >
						dwell.rendererDwellAfter.publications,
				);
			}
			if (control === "ordinary")
				assert.equal(
					observation.result.clean,
					true,
					JSON.stringify(observation.result.failures),
				);
			if (control === "missing-created") {
				assert.equal(observation.result.clean, false);
				assert(
					observation.result.failures.some((f) =>
						f.includes("worker was not CREATED"),
					),
				);
			}
			if (control === "leak") {
				assert.equal(observation.result.clean, false);
				assert(
					observation.result.failures.some(
						(f) =>
							f.includes("independent platform residual") ||
							f.includes("gpuResource platform residual"),
					),
				);
			}
			console.log(
				JSON.stringify({
					control,
					clean: observation.result.clean,
					cycles: observation.result.cycles.length,
				}),
			);
		} finally {
			conn.page.off("console", onConsole);
			conn.page.off("pageerror", onPageError);
			await conn.page.evaluate(
				(id) => document.getElementById(id)?.remove(),
				probeId,
			);
		}
	}
	assert.equal(new Set(evidence.controls.map((c) => c.marker)).size, 1);
	assert(evidence.controls[0].marker);
	evidence.passed = true;
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
	await writeFile(
		join(work, "evidence.json"),
		JSON.stringify(evidence, null, 2),
	);
	console.log(
		JSON.stringify({
			work,
			passed: evidence.passed,
			controls: evidence.controls.length,
			error: evidence.error,
		}),
	);
}
