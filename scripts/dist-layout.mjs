/**
 * The install-tree layout for `dist/rocut/`.
 *
 * The mapping below is a whitelist: every shipped byte is named by an explicit
 * artifact rule, and nothing is copied by "take the repository and exclude some
 * things". Anything not named here cannot reach `dist/rocut/` — including this
 * repository's own build tooling (`scripts/`, `tests/`) and anything a future
 * `tools/` directory might hold.
 */
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";

export const PLUGIN_ID = "rocut";

/** Flat file names allowed inside `vendor/run/` — the bundled CLI closure. */
const RUN_FILE_PATTERN =
  /^(rocut\.mjs|chunk-[A-Za-z0-9_-]+\.js|opencut_wasm_bg\.wasm)$/;

/**
 * The artifact mapping. `kind: "tree"` copies a directory recursively; an
 * optional `filePattern` restricts the flat file names it accepts and rejects
 * any nesting, which is what keeps `vendor/run/` to the three known outputs.
 */
export const ARTIFACT_MAPPING = Object.freeze([
  { kind: "file", source: "elftia-plugin.json" },
  { kind: "file", source: "skills/rocut-studio/SKILL.md" },
  { kind: "file", source: "vendor/LICENSE" },
  { kind: "file", source: "vendor/NOTICE.md" },
  { kind: "file", source: "vendor/PROVENANCE.md" },
  { kind: "tree", source: "vendor/run", filePattern: RUN_FILE_PATTERN },
  { kind: "tree", source: "vendor/surface" },
]);

export const RUNTIME_ROOT_ENTRIES = Object.freeze([
  "elftia-plugin.json",
  "skills",
  "vendor",
]);

export const REQUIRED_RUNTIME_FILES = Object.freeze([
  "elftia-plugin.json",
  "skills/rocut-studio/SKILL.md",
  "vendor/LICENSE",
  "vendor/NOTICE.md",
  "vendor/PROVENANCE.md",
  "vendor/run/rocut.mjs",
  "vendor/run/opencut_wasm_bg.wasm",
  "vendor/surface/index.html",
  "vendor/surface/asset-manifest.json",
]);

/**
 * The editor header renders `branding.logoUrl`, which the surface resolves to
 * this path. It must exist or the header shows a broken image.
 */
export const BRANDING_LOGO_PATH = "vendor/surface/logos/opencut/svg/logo.svg";

/**
 * Upstream OpenCut brand marks, by content digest.
 *
 * These are a **trademark**, not covered by the MIT code grant — upstream says
 * so itself (`SBOM.md` §2: "Upstream OpenCut brand marks. Trademark, not
 * covered by the MIT code grant."). This plugin has no authorization to
 * redistribute them, so the gate is by content rather than by path: a rename,
 * a re-copy, or a new surface build that moves them cannot smuggle one in.
 *
 * Digests observed in `apps/vite-example/dist/logos/opencut/` at upstream
 * commit d71624b2aa470ff91f012b4e18cca61445fb563f.
 */
export const FORBIDDEN_BRAND_DIGESTS = Object.freeze(
  new Map([
    [
      "27bac39c3eac3ad448a5dd2c52807fde8bcfd0327e68ed161399de876b73cf07",
      "logos/opencut/icon.svg",
    ],
    [
      "fdfd03c2747e43f9f3e207d1a6636c97339c8edd75707b7299066d2ceff7b3ff",
      "logos/opencut/logo.svg",
    ],
    [
      "a6328277dd34dbe1508dc863fdf2707132e30c1419963d9a60fd6c1d5958c35c",
      "logos/opencut/logo-light.svg",
    ],
    [
      "2e10887d0f75041b58b3717ef01466083fc81acf2d436b0fb71c7b8fabd1ccc2",
      "logos/opencut/svg/logo.svg",
    ],
    [
      "321029739c41b4c087c62be8ba224845e191b2b621039dfe3d6c685132e31d53",
      "logos/opencut/symbol.svg",
    ],
    [
      "cd163d7c010b93d681864fc9caaf1da51a1d8aa23892cf3ee0d9ea7da8c528e8",
      "logos/opencut/symbol-light.svg",
    ],
    [
      "31e4540f1ee85448a1bb483041cab7d98daafd5b259f9d5098c3ae7507b65143",
      "logos/opencut/text.svg",
    ],
    [
      "59d389688b4b9f385640cd441ec3012055d9a514fe02c82078e1eb76b8e65d79",
      "logos/opencut/text-light.svg",
    ],
  ]),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function compareEntries(left, right) {
  return Buffer.compare(
    Buffer.from(left.path, "utf8"),
    Buffer.from(right.path, "utf8"),
  );
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inventoryDigest(entries) {
  const rows = entries
    .map((entry) => `${entry.path}\t${entry.sha256}\n`)
    .join("");
  return sha256(Buffer.from(rows, "utf8"));
}

async function assertOrdinaryDirectory(directory, label) {
  const state = await lstat(directory);
  assert(
    state.isDirectory() && !state.isSymbolicLink(),
    `${label} must be an ordinary directory without a symlink, junction, or reparse escape`,
  );
  return realpath(directory);
}

async function visitTree(lexicalRoot, realRoot, directory, entries, options) {
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const child of children) {
    const absolutePath = path.join(directory, child.name);
    const relativePath = path
      .relative(lexicalRoot, absolutePath)
      .replaceAll("\\", "/");
    const state = await lstat(absolutePath);
    assert(
      !state.isSymbolicLink(),
      `symlink or junction is forbidden: ${relativePath}`,
    );
    const physicalPath = await realpath(absolutePath);
    assert(
      isContainedPath(realRoot, physicalPath),
      `reparse escape is forbidden: ${relativePath}`,
    );
    if (state.isDirectory()) {
      assert(
        options?.filePattern === undefined,
        `nested directory is forbidden under a flat artifact rule: ${relativePath}`,
      );
      await visitTree(lexicalRoot, realRoot, absolutePath, entries, options);
    } else if (state.isFile()) {
      if (options?.filePattern !== undefined) {
        assert(
          options.filePattern.test(child.name),
          `file is outside the artifact rule's whitelist: ${relativePath}`,
        );
      }
      const bytes = await readFile(absolutePath);
      entries.push({
        path: relativePath,
        size: bytes.length,
        sha256: sha256(bytes),
      });
    } else {
      throw new Error(`special file is forbidden: ${relativePath}`);
    }
  }
}

export async function inventoryRegularTree(treeRoot, label = "plugin tree") {
  const lexicalRoot = path.resolve(treeRoot);
  const realRoot = await assertOrdinaryDirectory(lexicalRoot, label);
  const entries = [];
  await visitTree(lexicalRoot, realRoot, lexicalRoot, entries);
  entries.sort(compareEntries);
  return {
    root: lexicalRoot,
    realRoot,
    fileCount: entries.length,
    sha256: inventoryDigest(entries),
    entries,
  };
}

export function inventoriesEqual(left, right) {
  if (left.fileCount !== right.fileCount || left.sha256 !== right.sha256)
    return false;
  return left.entries.every((entry, index) => {
    const other = right.entries[index];
    return (
      other !== undefined &&
      entry.path === other.path &&
      entry.size === other.size &&
      entry.sha256 === other.sha256
    );
  });
}

/** Walk the artifact mapping and produce the exact inventory dist must hold. */
export async function inventoryRocutSources(repoRootInput) {
  const repoRoot = path.resolve(repoRootInput);
  const realRepoRoot = await assertOrdinaryDirectory(
    repoRoot,
    "producer repository",
  );
  const entries = [];
  for (const rule of ARTIFACT_MAPPING) {
    const sourcePath = path.resolve(repoRoot, ...rule.source.split("/"));
    assert(
      isContainedPath(repoRoot, sourcePath),
      `artifact source escapes repository: ${rule.source}`,
    );
    let state;
    try {
      state = await lstat(sourcePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          `artifact source is missing: ${rule.source} — run \`npm run vendor\` first`,
        );
      }
      throw error;
    }
    assert(
      !state.isSymbolicLink(),
      `artifact source is a symlink or junction: ${rule.source}`,
    );
    const physicalPath = await realpath(sourcePath);
    assert(
      isContainedPath(realRepoRoot, physicalPath),
      `artifact source escapes repository: ${rule.source}`,
    );
    if (rule.kind === "tree") {
      assert(
        state.isDirectory(),
        `artifact source must be a directory: ${rule.source}`,
      );
      const before = entries.length;
      await visitTree(repoRoot, realRepoRoot, sourcePath, entries, {
        filePattern: rule.filePattern,
      });
      assert(
        entries.length > before,
        `artifact source directory is empty: ${rule.source}`,
      );
    } else {
      assert(
        state.isFile(),
        `artifact source must be a regular file: ${rule.source}`,
      );
      const bytes = await readFile(sourcePath);
      entries.push({
        path: rule.source,
        size: bytes.length,
        sha256: sha256(bytes),
      });
    }
  }
  entries.sort(compareEntries);
  const seen = new Set();
  for (const entry of entries) {
    assert(
      !seen.has(entry.path),
      `artifact mapping produced a duplicate path: ${entry.path}`,
    );
    seen.add(entry.path);
  }
  return {
    root: repoRoot,
    realRoot: realRepoRoot,
    fileCount: entries.length,
    sha256: inventoryDigest(entries),
    entries,
  };
}

export async function copyInventory(
  sourceRootInput,
  inventory,
  destinationRootInput,
) {
  const sourceRoot = path.resolve(sourceRootInput);
  const destinationRoot = path.resolve(destinationRootInput);
  await mkdir(destinationRoot);
  for (const entry of inventory.entries) {
    const sourcePath = path.resolve(sourceRoot, ...entry.path.split("/"));
    const destinationPath = path.resolve(
      destinationRoot,
      ...entry.path.split("/"),
    );
    assert(
      isContainedPath(sourceRoot, sourcePath),
      `copy source escapes repository: ${entry.path}`,
    );
    assert(
      isContainedPath(destinationRoot, destinationPath),
      `copy destination escapes stage: ${entry.path}`,
    );
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }
}

/**
 * Reject any shipped byte that is an upstream brand mark.
 *
 * Runs over the inventory, so it sees the tree that is actually about to be
 * published rather than the source rule that produced it.
 */
export function assertNoForbiddenBranding(inventory) {
  const offences = inventory.entries
    .filter((entry) => FORBIDDEN_BRAND_DIGESTS.has(entry.sha256))
    .map(
      (entry) =>
        `${entry.path} (matches upstream ${FORBIDDEN_BRAND_DIGESTS.get(entry.sha256)})`,
    );
  assert(
    offences.length === 0,
    `upstream OpenCut brand marks are trademarked and must not ship: ${offences.join(", ")}`,
  );
}

export async function validateRocutTree(treeRoot, expectedInventory = null) {
  const rootNames = (await readdir(treeRoot)).sort();
  assert(
    JSON.stringify(rootNames) ===
      JSON.stringify([...RUNTIME_ROOT_ENTRIES].sort()),
    `install tree root must contain exactly ${RUNTIME_ROOT_ENTRIES.join(", ")} — found ${rootNames.join(", ")}`,
  );

  const manifest = JSON.parse(
    await readFile(path.join(treeRoot, "elftia-plugin.json"), "utf8"),
  );
  assert(manifest.name === PLUGIN_ID, `manifest name must be ${PLUGIN_ID}`);
  assert(manifest.kind === "agent", "manifest kind must be agent");
  assert(
    typeof manifest.version === "string" && manifest.version.length > 0,
    "manifest version missing",
  );
  const skills = manifest.contributes?.agent?.skills;
  assert(
    Array.isArray(skills) && skills.length === 1,
    "manifest must contribute exactly one skill",
  );
  assert(
    skills[0]?.path === "skills/rocut-studio" ||
      skills[0]?.path === "./skills/rocut-studio",
    "manifest skill path must be skills/rocut-studio",
  );

  const inventory = await inventoryRegularTree(treeRoot, "rocut install tree");
  for (const requiredPath of REQUIRED_RUNTIME_FILES) {
    assert(
      inventory.entries.some((entry) => entry.path === requiredPath),
      `required runtime file missing: ${requiredPath}`,
    );
  }
  assert(
    inventory.entries.some((entry) => entry.path === BRANDING_LOGO_PATH),
    `branding placeholder missing: ${BRANDING_LOGO_PATH}`,
  );
  const chunkCount = inventory.entries.filter((entry) =>
    /^vendor\/run\/chunk-[A-Za-z0-9_-]+\.js$/.test(entry.path),
  ).length;
  assert(
    chunkCount >= 1,
    "vendor/run must carry at least one esbuild chunk (the migration chunk holds the wasm import)",
  );
  const nodeModulesEntry = inventory.entries.find((entry) =>
    entry.path.split("/").includes("node_modules"),
  );
  assert(
    nodeModulesEntry === undefined,
    `node_modules is forbidden in dist: ${nodeModulesEntry?.path}`,
  );
  const toolingEntry = inventory.entries.find((entry) => {
    const head = entry.path.split("/")[0];
    return head === "tools" || head === "scripts" || head === "tests";
  });
  assert(
    toolingEntry === undefined,
    `producer tooling is forbidden in dist: ${toolingEntry?.path}`,
  );
  assertNoForbiddenBranding(inventory);

  if (expectedInventory !== null) {
    assert(
      inventoriesEqual(inventory, expectedInventory),
      "dist inventory differs from the artifact mapping",
    );
  }
  return { manifest, inventory };
}
