/** Verify the packaged CLI's process contract against an isolated loopback fixture. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const entry = process.argv[process.argv.indexOf("--entry") + 1];
assert.ok(process.argv.includes("--entry") && path.isAbsolute(entry), "explicit absolute --entry required");
const exec = promisify(execFile);
const invoke = async args => {
  try { return { code: 0, ...await exec(process.execPath, [entry, ...args], { windowsHide: true, timeout: 30000 }) }; }
  catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
};
const root = await mkdtemp(path.join(tmpdir(), "rocut-packaged-errors-"));
let accepted = false;
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/health" && request.headers.authorization === "Bearer isolated") response.end(JSON.stringify({ id: "test" }));
  else if (request.url === "/isolated/api/drafts/example/stage" && request.method === "POST") response.end(JSON.stringify({ accepted, diagnostics: [{ code: "field-diagnostic" }] }));
  else { response.statusCode = 404; response.end("{}"); }
});
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await mkdir(path.join(root, "targets"));
  await writeFile(path.join(root, "targets.json"), JSON.stringify([{ id: "test", port, pid: process.pid, projectPath: root, startedAt: Date.now() }]));
  await writeFile(path.join(root, "targets/test.json"), JSON.stringify({ id: "test", port, token: "isolated" }));
  const operations = path.join(root, "operations.json");
  await writeFile(operations, JSON.stringify({ operations: [] }));
  const unknown = await invoke(["editing catalog"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /separate arguments/);
  for (const value of [false, true]) {
    accepted = value;
    const result = await invoke(["draft", "stage", operations, "--draft", "example", "--target", "test", "--targets-root", root]);
    assert.equal(result.code, accepted ? 0 : 1);
    assert.deepEqual(JSON.parse(result.stdout), { accepted, diagnostics: [{ code: "field-diagnostic" }] });
    if (!accepted) assert.match(result.stderr, /draft stage rejected/);
  }
  console.log("smoke-command-errors: PASS (packaged Node CLI, merged-command exit 1, rejected/accepted stage exit 1/0 with diagnostics)");
} finally {
  await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(root), path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith("rocut-packaged-errors-"));
  await rm(root, { recursive: true, force: true });
}
