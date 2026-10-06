import assert from "node:assert/strict";
import { resolve } from "node:path";
import { expect } from "./rocut-probe-source.mjs";

export async function enterCreatorProject({
	hostPage,
	sessionId,
	folder,
	evidence,
}) {
	const session = await hostPage.evaluate(
		(id) => window.native.sessions.chat.get(id),
		sessionId,
	);
	assert.equal(session.agentId, "creator-studio");
	assert.equal(session.sessionType, "agent");
	assert.equal(resolve(session.projectPath), resolve(folder));
	await hostPage.getByTestId("sidebar-agent-page-creator-studio").click();
	await expect(hostPage.getByTestId("creator-studio-home")).toBeVisible();
	const card = hostPage.locator(
		'[data-testid="creator-studio-project-card"][data-session-id="' +
			sessionId +
			'"]',
	);
	await expect(card).toBeVisible({ timeout: 30000 });
	await card.click();
	await expect
		.poll(() =>
			hostPage.evaluate(
				() =>
					document
						.querySelector('[data-session-active="true"]')
						?.getAttribute("data-session-id") ??
					window.__ELFTIA__?.activeSessionId,
			),
		)
		.toBe(sessionId);
	await expect(
		hostPage.locator(
			'[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]',
		),
	).toBeVisible();
	evidence.creatorEntry = {
		sessionId,
		agentId: session.agentId,
		folder,
		via: "sidebar and existing project card",
	};
	evidence.checks.push({
		name: "actual Creator Studio project card resumes the owned session and exposes Rocut workspace",
		pass: true,
	});
}
