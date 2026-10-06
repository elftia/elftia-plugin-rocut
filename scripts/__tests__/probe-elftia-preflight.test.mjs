// Consumer-owned preflight: no host connection or project writes are permitted.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

for (const flag of ["--linked-workflow-only", "--agent-drafts-only"]) {
	test(`${flag} refuses missing install root before connecting or creating fixtures`, () => {
		const result = spawnSync(
			process.execPath,
			[
				fileURLToPath(
					new URL("../probe-elftia-interactions.mjs", import.meta.url),
				),
				flag,
			],
			{
				env: {
					...process.env,
					ELFTIA_WORKTREE: "nonexistent-preflight-worktree",
					ELFTIA_TEST_SESSION: "preflight-no-host",
					ELFTIA_INSTALLED_ROCUT: "",
				},
				encoding: "utf8",
				timeout: 15000,
			},
		);
		assert.equal(result.error, undefined);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Set the exact installed plugin root/);
		assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|ECONNREFUSED/);
		assert.equal(result.stdout, "");
	});
}
