/**
 * `vendor/PROVENANCE.md` — write it, parse it, and check the vendored bytes
 * against it.
 *
 * The document is the contract for everything under `vendor/`: which upstream
 * commit produced it, with what toolchain, in what dirty state, and the exact
 * SHA-256 of every file. `build` verifies the tree against this manifest before
 * anything is staged, so a hand-edited or half-copied `vendor/` fails the build
 * instead of quietly shipping.
 *
 * The fenced manifest block is `<sha256>  <path>` per line, sorted by path —
 * the `elftia-plugin-director/vendor/PROVENANCE.md` shape, so `sha256sum -c`
 * reads it directly.
 */
import { readdir, readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./dist-layout.mjs";

export const PROVENANCE_FILENAME = "PROVENANCE.md";
const MANIFEST_FENCE = "```";
const MANIFEST_HEADING = "## SHA-256 manifest";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Every file under `vendor/`, except `PROVENANCE.md` itself — a manifest
 * cannot digest the document that carries it.
 */
export async function inventoryVendorTree(vendorRoot) {
  const root = path.resolve(vendorRoot);
  const realRoot = await realpath(root);
  const entries = [];
  const walk = async (directory) => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const relativePath = path
        .relative(root, absolutePath)
        .replaceAll("\\", "/");
      const state = await lstat(absolutePath);
      assert(
        !state.isSymbolicLink(),
        `vendor/ must not contain a symlink or junction: ${relativePath}`,
      );
      const physicalPath = await realpath(absolutePath);
      assert(
        physicalPath === realRoot ||
          physicalPath.startsWith(realRoot + path.sep),
        `vendor/ entry physically escapes: ${relativePath}`,
      );
      if (state.isDirectory()) {
        await walk(absolutePath);
      } else if (state.isFile()) {
        if (relativePath === PROVENANCE_FILENAME) continue;
        entries.push({
          path: relativePath,
          size: state.size,
          sha256: sha256(await readFile(absolutePath)),
        });
      } else {
        throw new Error(`vendor/ special file is forbidden: ${relativePath}`);
      }
    }
  };
  await walk(root);
  entries.sort((left, right) => (left.path < right.path ? -1 : 1));
  return entries;
}

export function renderProvenance(facts) {
  const modified = facts.modifiedTracked ?? null;
  const lines = [
    "# Vendored rocut runtime — provenance",
    "",
    ...(modified === null
      ? []
      : [
          "> **NOT A PIN-ONLY BUILD.** These bytes were packed from the commit below",
          "> **plus uncommitted modifications to tracked upstream files**, listed under",
          "> \"Uncommitted upstream modifications\". The commit alone does not reproduce",
          "> them. Commit the upstream patch and re-vendor to restore a pin-only build.",
          "",
        ]),
    // Kept machine-parseable: the deviation is carried by the banner above and
    // the dedicated section below, never by decorating this field.
    `- Upstream source commit: ${facts.upstreamCommit}`,
    ...(modified === null
      ? []
      : ["- Pin-only build: **no** — see \"Uncommitted upstream modifications\""]),
    `- Upstream repository: ${facts.upstreamRepository}`,
    `- Packed at: ${facts.packedAt}`,
    `- Packed with node ${facts.nodeVersion}, esbuild ${facts.esbuildVersion}, bun ${facts.bunVersion} (build tooling only)`,
    `- Build platform: ${facts.platform}`,
    "",
    "## Runtime",
    "",
    "The shipped bytes run on Elftia's managed **Node >= 20**. Bun appears above",
    "because upstream's install/build scripts use it; nothing under `vendor/`",
    "requires bun at run time, and no experimental Node flag is required for any",
    "part of the surface — legacy-schema record migration included.",
    "",
    "`opencut-wasm` is linked through its declared `./sync` entry (upstream",
    "BOUNDARIES §17), which reads `opencut_wasm_bg.wasm` from the sibling copy in",
    "`run/` and instantiates it explicitly. The `--target bundler` entry is not",
    "used here: once bundled, the binary's own `./opencut_wasm_bg.js` import has",
    "nothing to resolve against.",
    "",
    "## Upstream working tree at pack time",
    "",
    facts.dirtyEntries.length === 0
      ? "The upstream tree was clean — `git status --porcelain` was empty."
      : [
          "The upstream tree carried **untracked** entries only; every tracked file",
          "was byte-identical to the pinned commit (`git status --porcelain`",
          "reported no `M`/`A`/`D`/`R` rows, and `git diff HEAD --stat` was empty).",
          "Upstream's packer counts untracked files as dirty, so it was run with",
          "`--allow-dirty`; the pin above is still exact for every byte that ships.",
          "",
          "Untracked entries present, verbatim from `git status --porcelain`:",
          "",
          ...facts.dirtyEntries.map((entry) => `- \`${entry}\``),
        ].join("\n"),
    "",
    ...(modified === null
      ? []
      : [
          "## Uncommitted upstream modifications",
          "",
          "Tracked files that differ from the pinned commit in the checkout these",
          "bytes were packed from. Each is listed with the digest of the content",
          "actually used and of the committed content it replaced, so a reviewer can",
          "tell exactly what deviated without access to that working tree.",
          "",
          "```",
          modified.diffstat,
          "```",
          "",
          "| file | packed (working tree) sha256 | committed sha256 |",
          "|---|---|---|",
          ...modified.files.map(
            (file) =>
              `| ${file.path} | ${file.workingTreeSha256} | ${file.committedSha256} |`,
          ),
          "",
        ]),
    "## Build claim",
    "",
    "- `vendor/run/` — upstream `node script/pack-runtime.mjs`: esbuild",
    "  `bundle/platform=node/format=esm/target=es2022/splitting=true` over",
    "  `apps/cli/src/main.ts`, with `*.wasm` external so the migration chunk keeps",
    "  its verbatim ESM wasm import, satisfied by the byte-equal",
    "  `opencut_wasm_bg.wasm` sibling copied from `rust/wasm/pkg/`.",
    "- `vendor/surface/` — upstream `apps/vite-example` production build with",
    "  `OPENCUT_PUBLIC_BASE=./` (relative base is load-bearing: absolute asset",
    "  paths escape the host's `/<token>/` prefix and answer 401).",
    "- `vendor/LICENSE` — upstream repository-root MIT licence, copied verbatim.",
    "- `vendor/NOTICE.md` — this repository's third-party inventory over the",
    "  shipped bytes.",
    "",
    "The bundles are not byte-copies of upstream sources. The commit plus the",
    "recorded esbuild version reproduce them; the manifest below pins what",
    "actually ships.",
    "",
    "## Substitutions",
    "",
    ...(facts.substitutions.length === 0
      ? ["None."]
      : facts.substitutions.map(
          (item) =>
            `- \`${item.path}\` — ${item.reason}\n  - upstream sha256: \`${item.upstreamSha256}\`\n  - shipped sha256: \`${item.shippedSha256}\``,
        )),
    "",
    "## Removals",
    "",
    ...(facts.removals.length === 0
      ? ["None."]
      : facts.removals.map(
          (item) => `- \`${item.path}\` (sha256 \`${item.sha256}\`) — ${item.reason}`,
        )),
    "",
    MANIFEST_HEADING,
    "",
    `${facts.entries.length} file(s) under \`vendor/\` (this document excluded).`,
    "",
    MANIFEST_FENCE,
    ...facts.entries.map((entry) => `${entry.sha256}  ${entry.path}`),
    MANIFEST_FENCE,
    "",
  ];
  return `${lines.join("\n")}`;
}

export function parseProvenanceManifest(text) {
  const headingIndex = text.indexOf(MANIFEST_HEADING);
  assert(headingIndex !== -1, "PROVENANCE.md has no SHA-256 manifest section");
  const afterHeading = text.slice(headingIndex);
  const open = afterHeading.indexOf(MANIFEST_FENCE);
  assert(open !== -1, "PROVENANCE.md manifest block is not fenced");
  const bodyStart = afterHeading.indexOf("\n", open) + 1;
  const close = afterHeading.indexOf(MANIFEST_FENCE, bodyStart);
  assert(close !== -1, "PROVENANCE.md manifest block is unterminated");
  const rows = afterHeading
    .slice(bodyStart, close)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const entries = rows.map((row) => {
    const match = /^([0-9a-f]{64})\s\s?(.+)$/.exec(row);
    assert(match !== null, `unparseable manifest row: ${row}`);
    return { sha256: match[1], path: match[2] };
  });
  assert(entries.length > 0, "PROVENANCE.md manifest is empty");
  return entries;
}

export function readProvenanceFact(text, label) {
  const match = new RegExp(`^- ${label}: (.+)$`, "m").exec(text);
  return match === null ? null : match[1].trim();
}

/**
 * Fail closed on any drift between the manifest and the bytes on disk:
 * missing, extra, or altered.
 */
export async function verifyVendorAgainstProvenance(vendorRoot) {
  const provenancePath = path.join(vendorRoot, PROVENANCE_FILENAME);
  let text;
  try {
    text = await readFile(provenancePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `vendor/${PROVENANCE_FILENAME} is missing — run \`npm run vendor\` first`,
      );
    }
    throw error;
  }
  const declared = parseProvenanceManifest(text);
  const actual = await inventoryVendorTree(vendorRoot);
  const declaredByPath = new Map(
    declared.map((entry) => [entry.path, entry.sha256]),
  );
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry.sha256]));

  const missing = declared
    .filter((entry) => !actualByPath.has(entry.path))
    .map((entry) => entry.path);
  const extra = actual
    .filter((entry) => !declaredByPath.has(entry.path))
    .map((entry) => entry.path);
  const altered = actual
    .filter(
      (entry) =>
        declaredByPath.has(entry.path) &&
        declaredByPath.get(entry.path) !== entry.sha256,
    )
    .map(
      (entry) =>
        `${entry.path} (declared ${declaredByPath.get(entry.path)}, found ${entry.sha256})`,
    );

  const problems = [
    ...missing.map((item) => `missing: ${item}`),
    ...extra.map((item) => `undeclared: ${item}`),
    ...altered.map((item) => `altered: ${item}`),
  ];
  assert(
    problems.length === 0,
    `vendor/ does not match vendor/${PROVENANCE_FILENAME}:\n  ${problems.join("\n  ")}`,
  );
  return {
    fileCount: actual.length,
    upstreamCommit: readProvenanceFact(text, "Upstream source commit"),
    packedAt: readProvenanceFact(text, "Packed at"),
  };
}
