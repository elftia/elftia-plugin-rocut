import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  ARTIFACT_MAPPING,
  copyInventory,
  assertNoForbiddenBranding,
  BRANDING_LOGO_PATH,
  FORBIDDEN_BRAND_DIGESTS,
  inventoryRegularTree,
  inventoryRocutSources,
  REQUIRED_RUNTIME_FILES,
  RUNTIME_ROOT_ENTRIES,
  validateRocutTree,
  assertRocutPackageBudget,
} from "../scripts/dist-layout.mjs";
import { copyToolchainClosure } from "../scripts/toolchain-closure.mjs";
import { composeToolchainSources } from "../scripts/toolchain-sources.mjs";
import { projectToolchainPrebuild } from "../scripts/toolchain-prebuild.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const realVendorAvailable =
  process.env.ROCUT_TEST_REAL_VENDOR !== "0" &&
  existsSync(path.join(repoRoot, "vendor", "PROVENANCE.md"));

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
  for (const dir of scratchDirs)
    await rm(dir, { recursive: true, force: true });
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
          requiredMinor: 77,
          builtAgainst: "1.77.0",
        },
        agent: {
          skills: [{ id: "rocut-studio", path: "./skills/rocut-studio" }],
        },
      },
    }),
  );
  await writeFile(path.join(root, "main/index.cjs"), MAIN_FIXTURE);
  await writeFile(path.join(root, "skills/rocut-studio/SKILL.md"), "# skill\n");
  await mkdir(path.join(root, "skills/rocut-studio/references"), { recursive: true });
  for (const name of ["agent-editing", "media-import"]) {
    await writeFile(path.join(root, `skills/rocut-studio/references/${name}.md`), `# ${name}\n`);
  }
  await writeFile(path.join(root, "vendor/LICENSE"), "MIT\n");
  await writeFile(path.join(root, "vendor/NOTICE.md"), "# notice\n");
  await writeFile(path.join(root, "vendor/PROVENANCE.md"), "# provenance\n");
  await writeFile(path.join(root, "vendor/run/rocut.mjs"), "export {};\n");
  await writeFile(
    path.join(root, "vendor/run/chunk-AAAAAAAA.js"),
    "export {};\n",
  );
  await writeFile(
    path.join(root, "vendor/run/opencut_wasm_bg.wasm"),
    Buffer.from([0x00, 0x61, 0x73, 0x6d]),
  );
  await writeFile(
    path.join(root, "vendor/surface/index.html"),
    "<html></html>\n",
  );
  await writeFile(
    path.join(root, "vendor/surface/asset-manifest.json"),
    "{}\n",
  );
  await writeFile(
    path.join(root, "vendor/surface/logos/opencut/svg/logo.svg"),
    "<svg/>\n",
  );
  return root;
}

describe("artifact mapping", () => {
  it("preflights Core expanded bytes before packaging or installation", () => {
    expect(assertRocutPackageBudget({ entries: [{ path: "fixture", size: 1073741824 }] }).headroomBytes).toBe(0);
    expect(() => assertRocutPackageBudget({ entries: [{ path: "fixture", size: 1073741825 }] })).toThrow(/declared expanded bytes.*Core/);
    expect(assertRocutPackageBudget({ entries: [{ path: "fixture", size: 268435457 }] }).expandedByteLimit).toBe(1073741824);
    expect(assertRocutPackageBudget({ entries: Array.from({ length: 4096 }, () => ({ path: "fixture", size: 0 })) }).fileCount).toBe(4096);
    expect(() => assertRocutPackageBudget({ entries: Array.from({ length: 4097 }, () => ({ path: "fixture", size: 0 })) })).toThrow(/4096 archive entries/);
  });
  it("admits node_modules only inside an exact licensed toolchain closure", async () => {
    const source = await buildFakeTree();
    const toolchain = path.join(await scratch(), "toolchain");
    const packages: Record<string, { version: string; integrity: string }> = {};
    for (const [name, version] of [["@hyperframes/core", "0.8.139"], ["acorn", "8.19.0"]]) {
      const relative = `node_modules/${name}`;
      const directory = path.join(toolchain, relative);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, version, ...(name === "acorn" ? { license: "MIT" } : {}) }));
      await writeFile(path.join(directory, "LICENSE"), "MIT permission notice");
      packages[relative] = { version, integrity: "sha512-AAAA" };
    }
    const compiler = path.join(toolchain, "node_modules/@hyperframes/core/dist/compiler");
    await mkdir(compiler, { recursive: true });
    await writeFile(path.join(compiler, "index.js"), "export {};");
    await writeFile(path.join(toolchain, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
    const composed = path.join(await scratch(), "composed");
    await composeToolchainSources([{ directory: toolchain, engines: ["hyperframes"], licenseEvidence: [{ name: "@hyperframes/core", version: "0.8.139", license: "MIT", noticePath: "LICENSE", sha256: createHash("sha256").update("MIT permission notice").digest("hex") }] }], composed);
    const candidateManifest = JSON.parse(await readFile(path.join(source, "elftia-plugin.json"), "utf8"));
    candidateManifest.supportedPlatforms = ["win32-x64"];
    await writeFile(path.join(source, "elftia-plugin.json"), JSON.stringify(candidateManifest));
    await mkdir(path.join(source, "prebuilds/win32-x64"), { recursive: true });
    await projectToolchainPrebuild(composed, path.join(source, "prebuilds/win32-x64/toolchain"), "win32-x64");
    expect(await readFile(path.join(source, "prebuilds/win32-x64/toolchain/source-closure-manifest.json"), "utf8")).toBe(await readFile(path.join(composed, "closure-manifest.json"), "utf8"));
    const inventory = await inventoryRocutSources(source);
    expect(inventory.entries.some(entry => entry.path === "prebuilds/win32-x64/toolchain/rocut-engine-toolchain.json")).toBe(true);
    await validateRocutTree(source, inventory);
    candidateManifest.supportedPlatforms = ["linux-x64"];
    await writeFile(path.join(source, "elftia-plugin.json"), JSON.stringify(candidateManifest));
    await expect(validateRocutTree(source)).rejects.toThrow(/supportedPlatforms/);
    candidateManifest.supportedPlatforms = ["win32-x64"];
    await writeFile(path.join(source, "elftia-plugin.json"), JSON.stringify(candidateManifest));
    await writeFile(path.join(source, "prebuilds/win32-x64/toolchain/node_modules/acorn/extra.js"), "undeclared");
    await expect(validateRocutTree(source)).rejects.toThrow(/pins mismatch|undeclared/);
  });

  it("names every shipped path explicitly instead of excluding", () => {
    expect(ARTIFACT_MAPPING.map((rule) => rule.source)).toEqual([
      "elftia-plugin.json",
      "main/index.cjs",
      "skills/rocut-studio/SKILL.md",
      "skills/rocut-studio/references/agent-editing.md",
      "skills/rocut-studio/references/media-import.md",
      "vendor/LICENSE",
      "vendor/NOTICE.md",
      "vendor/PROVENANCE.md",
      "vendor/run",
      "vendor/surface",
      "prebuilds/win32-x64/toolchain",
      "prebuilds/win32-x64/decoder",
    ]);
  });

  it("copies on-demand skill references and refuses an install tree missing one", async () => {
    const source = await buildFakeTree();
    const inventory = await inventoryRocutSources(source);
    const installed = path.join(await scratch(), "installed");
    await copyInventory(source, inventory, installed);
    await validateRocutTree(installed, inventory);
    for (const name of ["agent-editing", "media-import"]) {
      const relative = `skills/rocut-studio/references/${name}.md`;
      expect(await readFile(path.join(installed, relative), "utf8")).toBe(`# ${name}\n`);
    }
    await rm(path.join(installed, "skills/rocut-studio/references/media-import.md"));
    await expect(validateRocutTree(installed)).rejects.toThrow("required runtime file missing");
  });

  it.runIf(realVendorAvailable)(
    "ships nothing from the producer's own tooling",
    async () => {
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
    },
  );

  it.runIf(realVendorAvailable)(
    "keeps vendor/run flat and limited to the known runtime outputs",
    async () => {
      const inventory = await inventoryRocutSources(repoRoot);
      const run = inventory.entries
        .filter((entry) => entry.path.startsWith("vendor/run/"))
        .map((entry) => entry.path.slice("vendor/run/".length));
      expect(run.length).toBeGreaterThan(0);
      for (const name of run) {
        expect(name).not.toContain("/");
        expect(name).toMatch(
          /^(rocut\.mjs|chunk-[A-Za-z0-9_-]+\.js|opencut_wasm_bg\.wasm|particle-sampler-(wasm|worker-entry)\.mjs|liquid-object-(wasm|worker-entry)\.mjs)$/,
        );
      }
      expect(run).toContain("rocut.mjs");
      expect(run).toContain("opencut_wasm_bg.wasm");
    },
  );
});

describe("trademark gate", () => {
  it("refuses any shipped byte whose digest is an upstream brand mark", () => {
    const [digest, name] = [...FORBIDDEN_BRAND_DIGESTS.entries()][0];
    expect(() =>
      assertNoForbiddenBranding({
        entries: [
          { path: "vendor/surface/anywhere.svg", size: 1, sha256: digest },
        ],
      }),
    ).toThrow(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("covers all eight upstream marks", () => {
    expect(FORBIDDEN_BRAND_DIGESTS.size).toBe(8);
  });

  it.runIf(realVendorAvailable)(
    "passes for the real artifact mapping",
    async () => {
      const inventory = await inventoryRocutSources(repoRoot);
      expect(() => assertNoForbiddenBranding(inventory)).not.toThrow();
      expect(
        inventory.entries.some((entry) => entry.path === BRANDING_LOGO_PATH),
      ).toBe(true);
    },
  );
});

describe("install-tree validation fails closed", () => {
  it.each([51, 76, 78])("rejects an ABI minor other than current77: %s", async (minor) => {
    const root = await buildFakeTree();
    const file = path.join(root, "elftia-plugin.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.contributes.main.requiredMinor = minor;
    await writeFile(file, JSON.stringify(manifest));
    await expect(validateRocutTree(root)).rejects.toThrow("manifest main requiredMinor must be 77");
  });
  it("accepts a structurally valid tree", async () => {
    const root = await buildFakeTree();
    const result = await validateRocutTree(root);
    expect(result.manifest.name).toBe("rocut");
    expect(result.inventory.fileCount).toBe(14);
  });

  it("requires the pinned decoder closure with the actual committed manifest and main checksum", async () => {
    const root = await buildFakeTree();
    await writeFile(
      path.join(root, "elftia-plugin.json"),
      await readFile(path.join(repoRoot, "elftia-plugin.json")),
    );
    await writeFile(
      path.join(root, "main/index.cjs"),
      await readFile(path.join(repoRoot, "main/index.cjs")),
    );
    await expect(validateRocutTree(root)).rejects.toThrow(/ENOENT/);
    const manifest = JSON.parse(await readFile(path.join(root, 'elftia-plugin.json'), 'utf8'));
    expect(manifest.contributes.main.checksum).toBe(sha512Text(await readFile(path.join(root, 'main/index.cjs'), 'utf8')));
    expect(manifest.contributes.main.requiredMinor).toBe(77);
    expect(manifest.contributes.main.builtAgainst).toBe('1.77.0');
  });

  it("rejects the obsolete Host API 1.51 requirement", async () => {
    const root = await buildFakeTree();
    const manifest = JSON.parse(
      await readFile(path.join(root, "elftia-plugin.json"), "utf8"),
    );
    manifest.contributes.main.requiredMinor = 51;
    await writeFile(path.join(root, "elftia-plugin.json"), JSON.stringify(manifest));
    await expect(validateRocutTree(root)).rejects.toThrow("requiredMinor must be 77");
  });

  it("ships fixed Particle and Liquid sidecars unchanged through the artifact mapping", async () => {
    const root = await buildFakeTree();
    const sidecars = [
      "particle-sampler-wasm.mjs",
      "particle-sampler-worker-entry.mjs",
      "liquid-object-wasm.mjs",
      "liquid-object-worker-entry.mjs",
    ];
    for (const name of sidecars)
      await writeFile(path.join(root, "vendor/run", name), `// ${name}\nexport {};\n`);
    const inventory = await inventoryRocutSources(root);
    const staged = path.join(await scratch(), "staged");
    await copyInventory(root, inventory, staged);
    const result = await validateRocutTree(staged, inventory);
    expect(result.inventory.fileCount).toBe(18);
    for (const name of sidecars) {
      expect(await readFile(path.join(staged, "vendor/run", name))).toEqual(
        await readFile(path.join(root, "vendor/run", name)),
      );
    }
  });

  it.each(["particle-sampler-wasm.mjs", "liquid-object-wasm.mjs"])(
    "rejects a referenced but missing sidecar pair: %s",
    async (name) => {
      const root = await buildFakeTree();
      await writeFile(
        path.join(root, "vendor/run/chunk-AAAAAAAA.js"),
        `export const workerModule = './${name}';\n`,
      );
      await expect(inventoryRocutSources(root)).rejects.toThrow(
        `Required runtime sidecar missing: ${name}`,
      );
      await expect(validateRocutTree(root)).rejects.toThrow(
        `Required runtime sidecar missing: ${name}`,
      );
    },
  );

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
    await writeFile(
      path.join(root, "main/index.cjs"),
      "module.exports = { tampered: true };\n",
    );
    await expect(validateRocutTree(root)).rejects.toThrow(
      /manifest main checksum must match main\/index\.cjs/,
    );
  });

  it("accepts CRLF working-source bytes against the canonical LF checksum without rewriting them", async () => {
    const root = await buildFakeTree();
    const file = path.join(root, "main/index.cjs");
    const workingSource = MAIN_FIXTURE.replaceAll("\n", "\r\n");
    await writeFile(file, workingSource);
    const result = await validateRocutTree(root);
    expect(result.manifest.contributes.main.checksum).toBe(sha512Text(MAIN_FIXTURE));
    expect(await readFile(file, "utf8")).toBe(workingSource);
  });

  it("rejects a non-newline content change even in CRLF working-source bytes", async () => {
    const root = await buildFakeTree();
    await writeFile(path.join(root, "main/index.cjs"), "module.exports = { changed: true };\r\n");
    await expect(validateRocutTree(root)).rejects.toThrow(
      /manifest main checksum must match main\/index\.cjs/,
    );
  });

  it("rejects a raw CRLF checksum rather than accepting two checksum laws", async () => {
    const root = await buildFakeTree();
    const workingSource = MAIN_FIXTURE.replaceAll("\n", "\r\n");
    const manifestFile = path.join(root, "elftia-plugin.json");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    manifest.contributes.main.checksum = sha512Text(workingSource);
    await writeFile(manifestFile, JSON.stringify(manifest));
    await writeFile(path.join(root, "main/index.cjs"), workingSource);
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
    await writeFile(
      path.join(root, "vendor/surface/index.html"),
      "<html>x</html>\n",
    );
    await expect(validateRocutTree(root, expected)).rejects.toThrow(
      /dist inventory differs/,
    );
  });
});
