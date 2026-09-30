import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { buildDist } from "../scripts/build-dist.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const realVendorAvailable =
  process.env.ROCUT_TEST_REAL_VENDOR !== "0" &&
  existsSync(path.join(repoRoot, "vendor", "PROVENANCE.md"));

const scratchDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rocut-preflight-test-"));
  scratchDirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of scratchDirs)
    await rm(dir, { recursive: true, force: true });
});

/**
 * `vendor/` is gitignored, so "I cloned it and ran build" is the FIRST thing a
 * new contributor does and the first thing that can fail. It has to fail with
 * the command to run, not an ENOENT from inside a copy loop.
 */
describe("build preflight when vendor/ is absent or incomplete", () => {
  it("names the vendor command when vendor/ does not exist", async () => {
    const fake = await scratch();
    await writeFile(
      path.join(fake, "upstream.json"),
      JSON.stringify({
        repository: "https://example.invalid/rocut",
        commit: "e".repeat(40),
      }),
    );
    await expect(buildDist({ repoRoot: fake })).rejects.toThrow(
      /vendor\/ does not exist/,
    );
    await expect(buildDist({ repoRoot: fake })).rejects.toThrow(
      /npm run vendor -- --rocut <path-to-rocut-checkout>/,
    );
    // and it tells you which upstream commit that checkout has to be at
    await expect(buildDist({ repoRoot: fake })).rejects.toThrow(
      new RegExp("e".repeat(40)),
    );
  });

  it("names the missing files when vendor/ is half-populated", async () => {
    const fake = await scratch();
    await mkdir(path.join(fake, "vendor", "run"), { recursive: true });
    await writeFile(
      path.join(fake, "vendor", "run", "rocut.mjs"),
      "export {};\n",
    );
    await expect(buildDist({ repoRoot: fake })).rejects.toThrow(
      /vendor\/ is incomplete — missing .*vendor\/PROVENANCE\.md/,
    );
  });

  it("never surfaces a bare ENOENT", async () => {
    const fake = await scratch();
    await expect(buildDist({ repoRoot: fake })).rejects.not.toThrow(/ENOENT/);
  });

  it.runIf(realVendorAvailable)(
    "passes preflight for the real repository",
    async () => {
      // Only asserts the preflight gate, not a full build: reaching the provenance
      // verification means vendor/ is present and complete.
      await expect(
        (async () => {
          const { verifyVendorAgainstProvenance } =
            await import("../scripts/provenance.mjs");
          return verifyVendorAgainstProvenance(path.join(repoRoot, "vendor"));
        })(),
      ).resolves.toBeTruthy();
    },
  );
});
