import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  inventoryVendorTree,
  parseProvenanceManifest,
  readProvenanceFact,
  renderProvenance,
  verifyVendorAgainstProvenance,
} from "../scripts/provenance.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const scratchDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rocut-prov-test-"));
  scratchDirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
});

async function buildFakeVendor(): Promise<string> {
  const vendor = path.join(await scratch(), "vendor");
  await mkdir(path.join(vendor, "run"), { recursive: true });
  await mkdir(path.join(vendor, "surface"), { recursive: true });
  await writeFile(path.join(vendor, "LICENSE"), "MIT\n");
  await writeFile(path.join(vendor, "run/rocut.mjs"), "export {};\n");
  await writeFile(path.join(vendor, "surface/index.html"), "<html></html>\n");
  const entries = await inventoryVendorTree(vendor);
  await writeFile(
    path.join(vendor, "PROVENANCE.md"),
    renderProvenance({
      upstreamCommit: "0".repeat(40),
      upstreamRepository: "https://example.invalid/rocut",
      packedAt: "2026-08-20T00:00:00.000Z",
      nodeVersion: "v20.0.0",
      esbuildVersion: "0.27.3",
      bunVersion: "1.2.2",
      platform: "win32 x64",
      dirtyEntries: ["?? .scratch/"],
      substitutions: [],
      removals: [],
      entries,
    }),
  );
  return vendor;
}

describe("provenance document", () => {
  it("round-trips the rendered manifest through the parser", async () => {
    const vendor = await buildFakeVendor();
    const text = await readFile(path.join(vendor, "PROVENANCE.md"), "utf8");
    const parsed = parseProvenanceManifest(text);
    const actual = await inventoryVendorTree(vendor);
    expect(parsed.map((entry) => entry.path)).toEqual(
      actual.map((entry) => entry.path),
    );
    expect(parsed.map((entry) => entry.sha256)).toEqual(
      actual.map((entry) => entry.sha256),
    );
  });

  it("discloses untracked upstream entries verbatim", async () => {
    const vendor = await buildFakeVendor();
    const text = await readFile(path.join(vendor, "PROVENANCE.md"), "utf8");
    expect(text).toContain("`?? .scratch/`");
    expect(text).toContain("untracked");
    expect(readProvenanceFact(text, "Upstream source commit")).toBe("0".repeat(40));
  });

  it("excludes itself from its own manifest", async () => {
    const vendor = await buildFakeVendor();
    const text = await readFile(path.join(vendor, "PROVENANCE.md"), "utf8");
    expect(parseProvenanceManifest(text).some((e) => e.path === "PROVENANCE.md")).toBe(
      false,
    );
  });
});

describe("vendor verification fails closed", () => {
  it("passes for an untouched vendor tree", async () => {
    const vendor = await buildFakeVendor();
    const result = await verifyVendorAgainstProvenance(vendor);
    expect(result.fileCount).toBe(3);
  });

  it("rejects an altered file", async () => {
    const vendor = await buildFakeVendor();
    await writeFile(path.join(vendor, "run/rocut.mjs"), "export const x = 1;\n");
    await expect(verifyVendorAgainstProvenance(vendor)).rejects.toThrow(
      /altered: run\/rocut\.mjs/,
    );
  });

  it("rejects a missing file", async () => {
    const vendor = await buildFakeVendor();
    await rm(path.join(vendor, "surface/index.html"));
    await expect(verifyVendorAgainstProvenance(vendor)).rejects.toThrow(
      /missing: surface\/index\.html/,
    );
  });

  it("rejects an undeclared extra file", async () => {
    const vendor = await buildFakeVendor();
    await writeFile(path.join(vendor, "surface/sneaked.js"), "0\n");
    await expect(verifyVendorAgainstProvenance(vendor)).rejects.toThrow(
      /undeclared: surface\/sneaked\.js/,
    );
  });

  it("rejects a vendor tree with no provenance at all", async () => {
    const vendor = await buildFakeVendor();
    await rm(path.join(vendor, "PROVENANCE.md"));
    await expect(verifyVendorAgainstProvenance(vendor)).rejects.toThrow(
      /is missing — run `npm run vendor` first/,
    );
  });
});

describe("uncommitted upstream changes are disclosed, not hidden", () => {
  const facts = {
    upstreamCommit: "a".repeat(40),
    upstreamRepository: "https://example.invalid/rocut",
    packedAt: "2026-08-20T00:00:00.000Z",
    nodeVersion: "v20.0.0",
    esbuildVersion: "0.27.3",
    bunVersion: "1.2.2",
    platform: "win32 x64",
    dirtyEntries: [],
    substitutions: [],
    removals: [],
    entries: [{ path: "run/rocut.mjs", size: 1, sha256: "b".repeat(64) }],
  };

  it("says plainly that a patched build is not a pin-only build", () => {
    const text = renderProvenance({
      ...facts,
      modifiedTracked: {
        diffstat: " script/pack-runtime.mjs | 10 +++---",
        files: [
          {
            path: "script/pack-runtime.mjs",
            workingTreeSha256: "c".repeat(64),
            committedSha256: "d".repeat(64),
          },
        ],
      },
    });
    expect(text).toContain("NOT A PIN-ONLY BUILD");
    expect(text).toContain("Uncommitted upstream modifications");
    expect(text).toContain("script/pack-runtime.mjs");
    expect(text).toContain("c".repeat(64));
    expect(text).toContain("d".repeat(64));
    expect(text).toContain("- Pin-only build: **no**");
  });

  it("keeps the commit field machine-parseable either way", () => {
    for (const modifiedTracked of [
      undefined,
      {
        diffstat: "x",
        files: [
          {
            path: "p",
            workingTreeSha256: "c".repeat(64),
            committedSha256: "d".repeat(64),
          },
        ],
      },
    ]) {
      const text = renderProvenance({ ...facts, modifiedTracked });
      expect(readProvenanceFact(text, "Upstream source commit")).toBe(
        "a".repeat(40),
      );
    }
  });

  it("says nothing about modifications on a clean build", () => {
    const text = renderProvenance(facts);
    expect(text).not.toContain("NOT A PIN-ONLY BUILD");
    expect(text).not.toContain("Uncommitted upstream modifications");
  });
});

describe("the real vendored tree", () => {
  it("matches its own provenance manifest", async () => {
    const result = await verifyVendorAgainstProvenance(
      path.join(repoRoot, "vendor"),
    );
    expect(result.fileCount).toBeGreaterThan(300);
    expect(result.upstreamCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});
