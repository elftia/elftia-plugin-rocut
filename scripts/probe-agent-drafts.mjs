import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { expect } from "./rocut-probe-source.mjs";
const { mainPreviewCanvas } = await loadRocutProbe("probe-multilingual-media.mjs");
const { createAgentDraftFixture, makeAgentDraftMutation } = await loadRocutProbe("probe-agent-draft-fixture.mjs");

const run = promisify(execFile);

// Installed CLI authors proposals; the real Elftia editor UI reviews/decides.
// All data belongs to the dedicated test project. No live model is called.
export async function probeAgentDrafts({
	page,
	hostPage,
	project,
	work,
	evidence,
	onPhase,
	existingTimeline,
}) {
	assert(
		process.env.ELFTIA_INSTALLED_ROCUT,
		"Set the exact installed plugin root",
	);
	const plugin = await realpath(process.env.ELFTIA_INSTALLED_ROCUT);
	const cliPath = join(plugin, "vendor/run/rocut.mjs");
	const bytes = await readFile(cliPath);
	evidence.agentDriver = {
		kind: "installed CLI + real editor UI",
		modelCalled: false,
		cliSha256: createHash("sha256").update(bytes).digest("hex"),
		approval:
			"authorized test actor clicks guarded approval in the real editor dialog",
	};
	const cli = async (...args) => {
		const { stdout } = await run(
			process.execPath,
			[
				cliPath,
				...args,
				"--project",
				project,
				"--targets-root",
				join(homedir(), ".rocut"),
			],
			{ timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
		);
		return stdout.trim();
	};
	const json = async (...args) => JSON.parse(await cli(...args));
	const spec = async (name, data) => {
		const output = join(work, name + ".json");
		await writeFile(output, JSON.stringify(data, null, 2));
		return output;
	};
	const check = (name, details = {}) =>
		evidence.checks.push({ name, ...details, pass: true });
	const verifyTicks = existingTimeline?.verifyTicks ?? 540000;
	const verifyFrame = Math.round(verifyTicks / 4000);
	const verifyTimecode =
		"00:00:" +
		String(Math.floor(verifyFrame / 30)).padStart(2, "0") +
		":" +
		String(verifyFrame % 30).padStart(2, "0");
	const verifyVisible = async (frame, label) => {
		await frame.getByLabel("Edit playhead time", { exact: true }).click();
		await frame
			.getByLabel("Playhead time", { exact: true })
			.fill(verifyTimecode);
		await frame.getByLabel("Playhead time", { exact: true }).press("Enter");
		let greenFraction = 0;
		await expect
			.poll(
				async () => {
					const png = await (
						await mainPreviewCanvas(frame)
					).screenshot({
						path: join(work, label + "-preview.png"),
					});
					greenFraction = await hostPage.evaluate(async (bytes) => {
						const bitmap = await createImageBitmap(
							new Blob([new Uint8Array(bytes)], { type: "image/png" }),
						);
						const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
						const context = canvas.getContext("2d");
						context.drawImage(bitmap, 0, 0);
						const { data } = context.getImageData(
							0,
							0,
							bitmap.width,
							bitmap.height,
						);
						let green = 0;
						for (let i = 0; i < data.length; i += 4)
							if (data[i] < 100 && data[i + 1] > 150 && data[i + 2] < 100)
								green++;
						bitmap.close();
						return green / (data.length / 4);
					}, Array.from(png));
					return greenFraction;
				},
				{
					timeout: 10000,
					message: "Real preview must display the approved local green text",
				},
			)
			.toBeGreaterThan(0.002);
		check(label + " shows approved local color in actual preview pixels", {
			greenFraction,
		});
	};
	const previewAndStage = async (snapshot, label) => {
		const sequence = snapshot.sequences[0];
		const draftId = await cli("draft", "begin");
		assert.match(draftId, /^[a-zA-Z0-9:_-]+$/);
		const input = await spec(
			label,
			makeAgentDraftMutation(sequence, "草稿批准后的第三句"),
		);
		const preview = await json(
			"motion-text",
			"mutate",
			sequence.id,
			input,
			"--preview",
		);
		assert.equal(preview.applied, false);
		assert.equal(preview.baseSequenceRevision, sequence.revision);
		assert.equal(preview.projectRevision, snapshot.projectRevision);
		assert.equal(preview.candidate.cues[2].text, "草稿批准后的第三句");
		assert.equal(
			preview.candidate.resolvedPlan.cuts
				.filter((cut) => cut.cueId === sequence.cues[2].id)
				.map((cut) => cut.text)
				.join(""),
			"草稿批准后的第三句",
			"Rendered cuts must contain the edited lyric, not just its cue label",
		);
		assert.equal(
			preview.candidate.cues[2].overrides.colors.foreground,
			"#00FF00",
		);
		for (const cut of preview.candidate.resolvedPlan.cuts.filter(
			(cut) => cut.cueId === sequence.cues[2].id,
		)) {
			assert.equal(cut.preset.layout, "center");
			assert.equal(cut.preset.treat, "none");
		}
		assert.deepEqual(
			preview.candidate.cues.slice(0, 2),
			sequence.cues.slice(0, 2),
		);
		const batch = await spec(label + "-stage", {
			operations: [
				{
					kind: "update-motion-text-sequence",
					sequenceId: sequence.id,
					expectedSequenceRevision: sequence.revision,
					sequence: preview.candidate,
				},
			],
		});
		assert.equal(
			(await json("draft", "stage", batch, "--draft", draftId)).accepted,
			true,
		);
		assert.deepEqual(
			await json("motion-text", "list"),
			snapshot,
			"Preview/staging must not commit",
		);
		return { draftId, preview };
	};
	const expectCliFailure = async (args, pattern) => {
		let failure;
		try {
			await cli(...args);
		} catch (error) {
			failure = String(error.stderr ?? "");
		}
		assert(
			failure && pattern.test(failure),
			"CLI must report the expected refusal, not succeed or time out",
		);
	};
	if (!existingTimeline) await createAgentDraftFixture({ page, onPhase });
	const clipCount = existingTimeline?.clipCount ?? 1;
	const selectMotion = (frame) =>
		existingTimeline
			? frame
					.locator(
						'[data-testid="timeline-clip"][data-element-id="' +
							existingTimeline.clipId +
							'"]',
					)
					.click({ timeout: 30000 })
			: frame.getByTestId("timeline-clip").click({ timeout: 30000 });
	await expect
		.poll(async () => (await json("motion-text", "list")).sequences.length)
		.toBe(1);
	const before = await json("motion-text", "list");
	assert.equal(before.sequences[0].cues.length, 3);
	onPhase("agent stages canonical text and local color candidate");
	const first = await previewAndStage(before, "initial-proposal");
	check(
		"installed CLI previews and stages a Rust-planned cue edit without changing the live project",
	);
	onPhase("real user edit invalidates the pending agent draft");
	await selectMotion(page);
	await page
		.locator(
			'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
		)
		.nth(1)
		.click();
	await page
		.getByRole("textbox", { name: "Lyric text", exact: true })
		.fill("用户保留的第二句");
	await page
		.getByRole("button", { name: "Apply changes", exact: true })
		.click();
	await expect
		.poll(
			async () => (await json("motion-text", "list")).sequences[0].cues[1].text,
		)
		.toBe("用户保留的第二句");
	const userState = await json("motion-text", "list");
	assert.equal(
		userState.sequences[0].resolvedPlan.cuts
			.filter((cut) => cut.cueId === userState.sequences[0].cues[1].id)
			.map((cut) => cut.text)
			.join(""),
		"用户保留的第二句",
		"User text edits must also change actual rendered cuts",
	);
	await expectCliFailure(
		["draft", "approve", "--draft", first.draftId],
		/404.*unknown-draft/s,
	);
	const stale = await spec("stale-direct-mutation", {
		...makeAgentDraftMutation(before.sequences[0], "must not overwrite"),
		expectedRevision: before.projectRevision,
		idempotencyKey: "agent-draft-probe-stale",
	});
	await expectCliFailure(
		["motion-text", "mutate", before.sequences[0].id, stale],
		/409/,
	);
	assert.deepEqual(await json("motion-text", "list"), userState);
	check(
		"real UI edit invalidates old draft; stale mutation is rejected without overwriting user data",
		{
			beforeRevision: before.projectRevision,
			userRevision: userState.projectRevision,
		},
	);
	onPhase(
		"real editor review refuses unseen changes and allows explicit rejection",
	);
	const openReview = async (id) => {
		await page.getByTestId("editor-menu-trigger").click();
		await page
			.getByRole("menuitem", { name: "Review agent changes", exact: true })
			.click();
		const dialog = page.getByRole("dialog", {
			name: "Review agent changes",
			exact: true,
		});
		await dialog
			.getByRole("button", { name: "Review draft " + id, exact: true })
			.click();
		await expect(dialog.getByTestId("draft-review-changes")).toContainText(
			"草稿批准后的第三句",
		);
		await expect(dialog.getByTestId("draft-review-changes")).toContainText(
			userState.sequences[0].cues[2].text,
		);
		return dialog;
	};
	const changed = await previewAndStage(userState, "review-conflict-proposal");
	let dialog = await openReview(changed.draftId);
	assert.deepEqual(await json("motion-text", "list"), userState);
	await dialog.press("Escape");
	await expect(page.getByTestId("editor-menu-trigger")).toBeFocused();
	assert.deepEqual(await json("motion-text", "list"), userState);
	dialog = await openReview(changed.draftId);
	const extra = await spec("unseen-draft-operation", {
		operations: [
			{
				kind: "create-track",
				track: {
					id: "unseen-review-track",
					kind: "graphic",
					name: "Unseen second operation",
					hidden: false,
				},
			},
		],
	});
	assert.equal(
		(await json("draft", "stage", extra, "--draft", changed.draftId)).accepted,
		true,
	);
	const conflictPath = "/api/drafts/" + changed.draftId + "/approve-reviewed";
	const conflictResponse = hostPage.waitForResponse(
		(response) =>
			response.url().endsWith(conflictPath) &&
			response.request().method() === "POST",
	);
	await dialog
		.getByRole("button", { name: "Approve changes", exact: true })
		.click();
	const refusal = await conflictResponse;
	assert.equal(refusal.status(), 409);
	assert.deepEqual(await refusal.json(), { error: "draft-review-changed" });
	evidence.expectedRequestFailures ??= [];
	evidence.expectedRequestFailures.push({
		phase:
			"real editor review refuses unseen changes and allows explicit rejection",
		status: 409,
		path: conflictPath,
	});
	await expect(dialog.getByRole("alert")).toContainText(
		"changed after you opened",
	);
	assert.deepEqual(await json("motion-text", "list"), userState);
	check(
		"closing review does not apply; unseen new operations invalidate an actual UI approval click",
	);
	await dialog
		.getByRole("button", { name: "Refresh proposals", exact: true })
		.click();
	await dialog
		.getByRole("button", {
			name: "Review draft " + changed.draftId,
			exact: true,
		})
		.click();
	await expect(dialog.getByTestId("draft-review-changes")).toContainText(
		"Unseen second operation",
	);
	await dialog
		.getByRole("button", { name: "Reject proposal", exact: true })
		.click();
	await expect(dialog.getByRole("status")).toContainText("Proposal rejected");
	assert.deepEqual(await json("motion-text", "list"), userState);
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	check("real UI rejection leaves committed lyrics unchanged");
	onPhase(
		"review and approve a fresh proposal in a bounded small-viewport dialog",
	);
	const fresh = await previewAndStage(userState, "rebased-proposal");
	const originalViewport = hostPage.viewportSize();
	const originalThemeMode = await hostPage.evaluate(
		async () => (await window.native.theme.getState()).mode,
	);
	await hostPage.setViewportSize({ width: 1000, height: 650 });
	try {
		dialog = await openReview(fresh.draftId);
		const scroll = dialog.getByTestId("draft-review-body");
		const sizes = await scroll.evaluate((element) => ({
			client: element.clientHeight,
			scroll: element.scrollHeight,
			overflow: getComputedStyle(element).overflowY,
		}));
		assert.equal(sizes.overflow, "auto");
		assert(
			sizes.scroll > sizes.client,
			"small review must expose an actual scrollable body",
		);
		await hostPage.screenshot({
			path: join(work, "agent-draft-ui-review.png"),
		});
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
			await expect(
				dialog.getByRole("button", { name: "Approve changes", exact: true }),
			).toBeVisible();
			await hostPage.screenshot({
				path: join(
					work,
					"agent-draft-ui-" + (dark ? "dark" : "light") + ".png",
				),
			});
		}
		await scroll.hover();
		await hostPage.mouse.wheel(0, 750);
		await expect
			.poll(() => scroll.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(0);
		await dialog.locator("summary").first().click();
		await expect(dialog.locator("details").first()).toHaveAttribute("open", "");
		await expect(dialog.locator("details").first().locator("pre")).toHaveCount(
			2,
		);
		check(
			"review follows both host themes and exposes full large values through a real scroll/expand interaction",
		);
		await dialog
			.getByRole("button", { name: "Approve changes", exact: true })
			.click();
		await expect(dialog.getByRole("status")).toContainText("Changes approved");
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		await expect(page.getByTestId("editor-menu-trigger")).toBeFocused();
		check(
			"small-viewport review scrolls and actual approval/focus return work",
			sizes,
		);
	} finally {
		await hostPage.evaluate(
			(mode) => window.native.theme.setMode(mode),
			originalThemeMode,
		);
		if (originalViewport) await hostPage.setViewportSize(originalViewport);
	}
	const committed = await json("motion-text", "list");
	assert.equal(committed.projectRevision, userState.projectRevision + 1);
	assert.equal(committed.sequences[0].cues[1].text, "用户保留的第二句");
	assert.equal(committed.sequences[0].cues[2].text, "草稿批准后的第三句");
	assert.deepEqual(committed.sequences[0], fresh.preview.candidate);
	await expect(page.getByTestId("timeline-clip")).toHaveCount(clipCount);
	await selectMotion(page);
	await expect(
		page.locator('[aria-labelledby="motion-text-cues-heading"]'),
	).toContainText("草稿批准后的第三句", { timeout: 10000 });
	await verifyVisible(page, "agent-draft-committed");
	await hostPage.screenshot({ path: join(work, "agent-draft-committed.png") });
	const proof = await json("verify", String(verifyTicks));
	check(
		"fresh manual draft commits text and local color atomically and appears in the live editor",
		{
			projectRevision: committed.projectRevision,
			sequenceRevision: committed.sequences[0].revision,
		},
	);
	onPhase(
		"close pane: exports refuse, business reads survive, project reopens",
	);
	await hostPage
		.locator(
			'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
		)
		.click();
	await expect(
		hostPage.locator('[data-testid="webpane-tab-slot"][data-tool-id="rocut"]'),
	).toHaveCount(0);
	await expectCliFailure(
		[
			"export",
			"--format",
			"mp4",
			"--quality",
			"low",
			"--out",
			join(work, "must-not-export.mp4"),
		],
		/409.*(pane|surface|editor)/is,
	);
	const closed = await json("motion-text", "list");
	assert.deepEqual(closed.sequences, committed.sequences);
	await hostPage
		.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
		.click();
	let reopened;
	await expect
		.poll(
			async () => {
				for (const frame of hostPage.frames())
					if (
						(await frame.title().catch(() => "")).startsWith("OpenCut editor")
					)
						reopened = frame;
				return !!reopened;
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	await selectMotion(reopened);
	await expect(
		reopened.locator('[aria-labelledby="motion-text-cues-heading"]'),
	).toContainText("草稿批准后的第三句");
	await expect(
		reopened.locator('[aria-labelledby="motion-text-cues-heading"]'),
	).toContainText("用户保留的第二句");
	assert.equal(
		(await json("verify", String(verifyTicks))).digest,
		proof.digest,
	);
	await verifyVisible(reopened, "agent-draft-reopened");
	await hostPage.screenshot({ path: join(work, "agent-draft-reopened.png") });
	check(
		"closed pane refuses rendering but keeps CLI reads; reopening preserves user and agent changes and frame-description digest",
	);
	return reopened;
}
