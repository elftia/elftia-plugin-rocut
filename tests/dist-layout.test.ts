import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  ARTIFACT_MAPPING,
  assertNoForbiddenBranding,
  BRANDING_LOGO_PATH,
  FORBIDDEN_BRAND_DIGESTS,
  inventoryRegularTree,
  inventoryRocutSources,
  REQUIRED_RUNTIME_FILES,
  RUNTIME_ROOT_ENTRIES,
  validateRocutTree,
} from "../scripts/dist-layout.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const scratchDirs: string[] = [];
const MAIN_FIXTURE = "module.exports = {};\n";

function sha512Text(contents: string): string {
  return `sha512-${createHash("sha512").update(contents, "utf8").digest("base64")}`;
}

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "rocut-dist-test-"));
  scratchDirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
});

/** A minimal but structurally valid install tree. */
async function buildFakeTree(): Promise<string> {
  const root = path.join(await scratch(), "rocut");
  await mkdir(path.join(root, "main"), { recursive: true });
  await mkdir(path.join(root, "skills", "rocut-studio"), { recursive: true });
  await mkdir(path.join(root, "vendor", "run"), { recursive: true });
  await mkdir(path.join(root, "vendor", "surface", "logos", "opencut", "svg"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "elftia-plugin.json"),
    JSON.stringify({
      name: "rocut",
      version: "0.0.0-test",
      kind: "app-extension",
      permissions: ["host:tool-hosts"],
      contributes: {
        main: {
          entry: "index.cjs",
          checksum: sha512Text(MAIN_FIXTURE),
          requiredMajor: 1,
          requiredMinor: 51,
          builtAgainst: "1.54.0",
        },
        agent: { skills: [{ id: "rocut-studio", path: "./skills/rocut-studio" }] },
      },
    }),
  );
  await writeFile(path.join(root, "main/index.cjs"), MAIN_FIXTURE);
  await writeFile(path.join(root, "skills/rocut-studio/SKILL.md"), "# skill\n");
  await writeFile(path.join(root, "vendor/LICENSE"), "MIT\n");
  await writeFile(path.join(root, "vendor/NOTICE.md"), "# notice\n");
  await writeFile(path.join(root, "vendor/PROVENANCE.md"), "# provenance\n");
  await writeFile(path.join(root, "vendor/run/rocut.mjs"), "export {};\n");
  await writeFile(path.join(root, "vendor/run/chunk-AAAAAAAA.js"), "export {};\n");
  await writeFile(
    path.join(root, "vendor/run/opencut_wasm_bg.wasm"),
    Buffer.from([0x00, 0x61, 0x73, 0x6d]),
  );
  await writeFile(path.join(root, "vendor/surface/index.html"), "<html></html>\n");
  await writeFile(path.join(root, "vendor/surface/asset-manifest.json"), "{}\n");
  await writeFile(
    path.join(root, "vendor/surface/logos/opencut/svg/logo.svg"),
    "<svg/>\n",
  );
  return root;
}

describe("artifact mapping", () => {
  it("names every shipped path explicitly instead of excluding", () => {
    expect(ARTIFACT_MAPPING.map((rule) => rule.source)).toEqual([
      "elftia-plugin.json",
      "main/index.cjs",
      "skills/rocut-studio/SKILL.md",
      "vendor/LICENSE",
      "vendor/NOTICE.md",
      "vendor/PROVENANCE.md",
      "vendor/run",
      "vendor/surface",
    ]);
  });

  it("ships nothing from the producer's own tooling", async () => {
    const inventory = await inventoryRocutSources(repoRoot);
    const heads = new Set(
      inventory.entries.map((entry) => entry.path.split("/")[0]),
    );
    expect([...heads].sort()).toEqual([
      "elftia-plugin.json",
      "main",
      "skills",
      "vendor",
    ]);
    for (const forbidden of [
      "tools",
      "scripts",
      "tests",
      "licenses",
      "node_modules",
      "package.json",
      "package-lock.json",
      ".gitignore",
    ]) {
      expect(heads.has(forbidden)).toBe(false);
    }
  });

  it("keeps vendor/run flat and limited to the three known shapes", async () => {
    const inventory = await inventoryRocutSources(repoRoot);
    const run = inventory.entries
      .filter((entry) => entry.path.startsWith("vendor/run/"))
      .map((entry) => entry.path.slice("vendor/run/".length));
    expect(run.length).toBeGreaterThan(0);
    for (const name of run) {
      expect(name).not.toContain("/");
      expect(name).toMatch(
        /^(rocut\.mjs|chunk-[A-Za-z0-9_-]+\.js|opencut_wasm_bg\.wasm)$/,
      );
    }
    expect(run).toContain("rocut.mjs");
    expect(run).toContain("opencut_wasm_bg.wasm");
  });
});

describe("trademark gate", () => {
  it("refuses any shipped byte whose digest is an upstream brand mark", () => {
    const [digest, name] = [...FORBIDDEN_BRAND_DIGESTS.entries()][0];
    expect(() =>
      assertNoForbiddenBranding({
        entries: [{ path: "vendor/surface/anywhere.svg", size: 1, sha256: digest }],
      }),
    ).toThrow(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("covers all eight upstream marks", () => {
    expect(FORBIDDEN_BRAND_DIGESTS.size).toBe(8);
  });

  it("passes for the real artifact mapping", async () => {
    const inventory = await inventoryRocutSources(repoRoot);
    expect(() => assertNoForbiddenBranding(inventory)).not.toThrow();
    expect(
      inventory.entries.some((entry) => entry.path === BRANDING_LOGO_PATH),
    ).toBe(true);
  });
});

describe("install-tree validation fails closed", () => {
  it("accepts a structurally valid tree", async () => {
    const root = await buildFakeTree();
    const result = await validateRocutTree(root);
    expect(result.manifest.name).toBe("rocut");
    expect(result.inventory.fileCount).toBe(12);
  });

  it("rejects an extra root entry", async () => {
    const root = await buildFakeTree();
    await writeFile(path.join(root, "README.md"), "nope\n");
    await expect(validateRocutTree(root)).rejects.toThrow(
      /install tree root must contain exactly/,
    );
    expect(RUNTIME_ROOT_ENTRIES).toContain("vendor");
  });

  it("rejects node_modules at any depth", async () => {
    const root = await buildFakeTree();
    await mkdir(path.join(root, "vendor/surface/node_modules"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "vendor/surface/node_modules/index.js"),
      "0\n",
    );
    await expect(validateRocutTree(root)).rejects.toThrow(
      /node_modules is forbidden/,
    );
  });

  it("rejects a missing required runtime file", async () => {
    const root = await buildFakeTree();
    await rm(path.join(root, "vendor/run/opencut_wasm_bg.wasm"));
    await expect(validateRocutTree(root)).rejects.toThrow(
      /required runtime file missing: vendor\/run\/opencut_wasm_bg\.wasm/,
    );
    expect(REQUIRED_RUNTIME_FILES).toContain("vendor/run/rocut.mjs");
  });

  it("rejects a main entry whose bytes do not match the manifest checksum", async () => {
    const root = await buildFakeTree();
    await writeFile(path.join(root, "main/index.cjs"), "module.exports = { tampered: true };\n");
    await expect(validateRocutTree(root)).rejects.toThrow(
      /manifest main checksum must match main\/index\.cjs/,
    );
  });

  it("rejects a tree with no esbuild chunk beside the entry", async () => {
    const root = await buildFakeTree();
    await rm(path.join(root, "vendor/run/chunk-AAAAAAAA.js"));
    await expect(validateRocutTree(root)).rejects.toThrow(
      /at least one esbuild chunk/,
    );
  });

  it("rejects a brand mark smuggled in under a new path", async () => {
    const root = await buildFakeTree();
    const iconBytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32"/></svg>',
    );
    await writeFile(path.join(root, "vendor/surface/brand.svg"), iconBytes);
    const inventory = await inventoryRegularTree(root);
    const entry = inventory.entries.find(
      (item) => item.path === "vendor/surface/brand.svg",
    );
    expect(entry).toBeDefined();
    // Force the digest to a known upstream mark to prove the gate is by content.
    const [digest] = [...FORBIDDEN_BRAND_DIGESTS.keys()];
    expect(() =>
      assertNoForbiddenBranding({
        entries: [{ ...entry!, sha256: digest }],
      }),
    ).toThrow(/trademarked/);
  });

  it("rejects a manifest that is not this plugin", async () => {
    const root = await buildFakeTree();
    await writeFile(
      path.join(root, "elftia-plugin.json"),
      JSON.stringify({
        name: "not-rocut",
        version: "1.0.0",
        kind: "agent",
        contributes: {
          agent: { skills: [{ id: "x", path: "./skills/rocut-studio" }] },
        },
      }),
    );
    await expect(validateRocutTree(root)).rejects.toThrow(
      /manifest name must be rocut/,
    );
  });

  it("rejects an inventory that drifted from the artifact mapping", async () => {
    const root = await buildFakeTree();
    const expected = await inventoryRegularTree(root);
    await writeFile(path.join(root, "vendor/surface/index.html"), "<html>x</html>\n");
    await expect(validateRocutTree(root, expected)).rejects.toThrow(
      /dist inventory differs/,
    );
  });
});
