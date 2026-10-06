import { loadRocutProbe } from "./rocut-probe-source.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "./rocut-probe-source.mjs";
const { probeCueLockWorkflow } = await loadRocutProbe("probe-cue-lock-workflow.mjs");
const { probeMotionClipContinuity } = await loadRocutProbe("probe-motion-clip-continuity.mjs");
import { probeAgentDrafts } from "./probe-agent-drafts.mjs";
const { probeLinkedLanguages } = await loadRocutProbe("probe-linked-languages.mjs");
const { createRangeSource } = await loadRocutProbe("probe-ui-range-media.mjs");
const { probeLinkedRange } = await loadRocutProbe("probe-linked-range.mjs");
const { probeLinkedFontRecovery } = await loadRocutProbe("probe-linked-font-recovery.mjs");
const { probeUnknownPreset } = await loadRocutProbe("probe-unknown-preset.mjs");

export async function probeLinkedWorkflow({
	page,
	hostPage,
	project,
	work,
	evidence,
	onPhase,
}) {
	evidence.linkedWorkflow = {
		status: "partial",
		completedSections: [],
		pendingSections: [9, "10-range", 12],
	};
	const record = await page.evaluate(
		async () =>
			(await (await fetch(new URL("api/record", location.href))).json()).record,
	);
	const disk = JSON.parse(readFileSync(join(project, "project.json"), "utf8"));
	assert.equal(
		record.id,
		disk.record.id,
		"real Creator entry must load the newly-created dedicated fixture",
	);
	assert(record.id, "fixture identity must exist");
	evidence.linkedWorkflow.projectId = record.id;
	const video = join(work, "continuity-underlay.mp4");
	createRangeSource(video, { segmentSeconds: 4, secondColor: "red" });
	evidence.linkedWorkflow.mediaSha256 = createHash("sha256")
		.update(readFileSync(video))
		.digest("hex");
	const afterCreate = async (frame) => {
		onPhase("same-project cyan lyric palette and audiovisual media import");
		await frame
			.getByRole("button", { name: "Edit font and colors", exact: true })
			.click();
		const customize = frame.getByRole("button", {
			name: "Customize",
			exact: true,
		});
		const form = frame
			.getByRole("button", { name: /^(Customize|Use preset colors)$/ })
			.locator("..")
			.locator("..");
		await customize.click();
		for (const label of ["Text", "Accent"]) {
			const field = form
				.locator("label")
				.filter({ hasText: new RegExp("^" + label + "$") })
				.locator("..")
				.getByRole("textbox");
			await field.fill("00FFFF");
			await field.press("Tab");
		}
		await form
			.getByRole("button", { name: "Apply changes", exact: true })
			.click();
		await frame.getByLabel("Media", { exact: true }).click();
		await frame.locator('input[type="file"]').setInputFiles(video);
		await frame
			.getByLabel("Add continuity-underlay.mp4 to timeline", { exact: true })
			.click();
		await expect(frame.getByTestId("timeline-clip")).toHaveCount(2);
		const id = await frame.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return [
				record.data.scenes[0].tracks.main,
				...record.data.scenes[0].tracks.overlay,
			]
				.flatMap((t) => t.elements)
				.find((c) => c.type === "motion-text").id;
		});
		await frame
			.locator('[data-testid="timeline-clip"][data-element-id="' + id + '"]')
			.click();
	};
	page = await probeCueLockWorkflow({
		page,
		hostPage,
		work,
		evidence,
		onPhase,
		afterCreate,
	});
	evidence.linkedWorkflow.completedSections.push(1, 2, 3, 4);
	const timeline = await probeMotionClipContinuity({
		page,
		hostPage,
		work,
		evidence,
		onPhase,
		existingLyrics: true,
	});
	evidence.linkedWorkflow.completedSections.push(5, 6, 7, "10-full");
	page = await probeAgentDrafts({
		page: timeline.page,
		hostPage,
		project,
		work,
		evidence,
		onPhase,
		existingTimeline: timeline.existingTimeline,
	});
	const final = await page.evaluate(
		async () =>
			(await (await fetch(new URL("api/record", location.href))).json()).record,
	);
	assert.equal(final.id, record.id);
	assert.deepEqual(final.data.scenes, timeline.state.scenes);
	assert.deepEqual(
		final.data.motionTextSequences[0].cues[1].locks,
		timeline.state.sequences[0].cues[1].locks,
	);
	evidence.linkedWorkflow.completedSections.push(8, 11);
	evidence.checks.push({
		name: "Agent review and reopening preserve the same project identity, edited timeline, media references and second-cue locks",
		pass: true,
	});
	page = await probeLinkedLanguages({
		page,
		hostPage,
		work,
		evidence,
		onPhase,
	});
	evidence.linkedWorkflow.completedSections.push(9);
	evidence.linkedWorkflow.pendingSections = ["10-range", 12];
	page = await probeLinkedRange({ page, hostPage, work, evidence, onPhase });
	evidence.linkedWorkflow.completedSections.push("10-range", "10-final-full");
	evidence.linkedWorkflow.pendingSections = [12];
	page = await probeLinkedFontRecovery({
		page,
		hostPage,
		work,
		evidence,
		onPhase,
	});
	evidence.linkedWorkflow.completedSections.push("12-font-retry");
	await probeUnknownPreset({
		page,
		hostPage,
		work,
		evidence,
		onPhase,
		existingProject: true,
	});
	evidence.linkedWorkflow.completedSections.push("12-unknown-preset");
	evidence.linkedWorkflow.pendingSections = ["12-actual-legacy-plugin"];
	return page;
}
