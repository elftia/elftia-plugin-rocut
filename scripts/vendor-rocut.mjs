#!/usr/bin/env node
/**
 * Vendor the rocut runtime from a pinned upstream checkout into `vendor/`.
 *
 * This is the only step that needs the upstream repository. Everything after it
 * — `build`, `verify:dist`, `pack`, `release` — works from `vendor/` alone. But
 * `vendor/` is gitignored, so a fresh clone must run THIS step once, against a
 * local rocut checkout at the commit pinned in `upstream.json`, before anything
 * else will work. `build` fails closed with that instruction.
 *
 * Pipeline:
 *   1. read the committed pin, resolve the upstream root, assert HEAD == pin;
 *   2. refuse a tree with modified tracked files unless
 *      `--allow-modified-tracked` is passed, which discloses them in PROVENANCE
 *      instead of hiding them; untracked scratch is always allowed and listed;
 *   3. run upstream `script/pack-runtime.mjs` into this repo's `.elftia-work/`,
 *      never into the upstream tree;
 *   4. whitelist-copy the pack output into `vendor/run` and `vendor/surface`;
 *   5. drop the upstream OpenCut brand marks (trademark) and substitute a
 *      neutral placeholder at the one path the editor header resolves;
 *   6. copy the upstream MIT licence and this repository's NOTICE;
 *   7. write `vendor/PROVENANCE.md` with the per-file SHA-256 manifest.
 *
 *   node scripts/vendor-rocut.mjs [--rocut <path>] [--skip-pack]
 *                                 [--allow-modified-tracked]
 *
 * The upstream checkout comes from `--rocut`, else `$ROCUT_REPO`, else the
 * documented default `../../_others/rocut`; an absent checkout names all three.
 *
 * `--skip-pack` reuses an existing `.elftia-work/dist-runtime` (iteration only;
 * the provenance still records the upstream commit, so never use it across a
 * commit change).
 */
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FORBIDDEN_BRAND_DIGESTS, sha256 } from "./dist-layout.mjs";
import { inventoryVendorTree, renderProvenance } from "./provenance.mjs";

const pluginRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const UPSTREAM_REPOSITORY = "https://github.com/DumoeDss/rocut";
const RUN_FILE_PATTERN =
  /^(rocut\.mjs|chunk-[A-Za-z0-9_-]+\.js|opencut_wasm_bg\.wasm)$/;
/** The one branding path the editor header resolves at run time. */
const BRANDING_LOGO_RELATIVE = "logos/opencut/svg/logo.svg";

function fail(message) {
  throw new Error(message);
}

function git(upstreamRoot, args) {
  const result = spawnSync("git", args, {
    cwd: upstreamRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(
      `git ${args.join(" ")} failed (exit ${result.status}): ${(result.stderr || "").trim()}`,
    );
  }
  return result.stdout;
}

/** The documented default, used only when neither --rocut nor $ROCUT_REPO is given. */
const DEFAULT_UPSTREAM_RELATIVE = ["..", "..", "_others", "rocut"];

function upstreamHelp(pin) {
  return [
    "  npm run vendor -- --rocut <path-to-rocut-checkout>",
    "  ROCUT_REPO=<path-to-rocut-checkout> npm run vendor",
    `  (default when neither is given: ${path.resolve(pluginRoot, ...DEFAULT_UPSTREAM_RELATIVE)})`,
    "",
    `The checkout must be at the pinned commit ${pin.commit}`,
    `from ${pin.repository}, with a current wasm build and editor surface:`,
    ...pin.prerequisites.map((step) => `  ${step}`),
  ].join("\n");
}

function resolveUpstreamRoot(explicit, pin) {
  const source =
    explicit !== undefined
      ? "--rocut"
      : process.env.ROCUT_REPO !== undefined
        ? "$ROCUT_REPO"
        : "the documented default path";
  const candidate =
    explicit ??
    process.env.ROCUT_REPO ??
    path.resolve(pluginRoot, ...DEFAULT_UPSTREAM_RELATIVE);
  const resolved = path.resolve(candidate);
  if (!existsSync(path.join(resolved, "script", "pack-runtime.mjs"))) {
    fail(
      `no rocut checkout at ${resolved} (from ${source}; script/pack-runtime.mjs is absent).\n` +
        `Point the vendor step at one:\n${upstreamHelp(pin)}`,
    );
  }
  return { root: resolved, source };
}

/**
 * The committed pin of record.
 *
 * `vendor/` is gitignored, so `vendor/PROVENANCE.md` — which records the commit
 * actually packed — does not survive a fresh clone. Without this file the pin
 * would exist only inside a build product, and "rebuild the same bytes from a
 * clean checkout" would stop being a property anyone could check. Moving the
 * pin is a deliberate edit to `upstream.json`, not a side effect of whatever
 * the packer happened to find checked out.
 */
async function readPin() {
  const pinPath = path.join(pluginRoot, "upstream.json");
  let raw;
  try {
    raw = await readFile(pinPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(`upstream.json is missing — it is the committed pin of record for vendor/`);
    }
    throw error;
  }
  const pin = JSON.parse(raw);
  if (!/^[0-9a-f]{40}$/.test(pin.commit ?? "")) {
    fail(`upstream.json has no valid 40-character \`commit\` pin`);
  }
  if (!Array.isArray(pin.prerequisites)) pin.prerequisites = [];
  return pin;
}

/**
 * Split `git status --porcelain` into untracked entries and everything else.
 *
 * Upstream's packer treats any non-empty porcelain output as dirty, untracked
 * included. Untracked scratch in someone's working copy is not a provenance
 * problem as long as no tracked byte moved, so those are allowed through
 * `--allow-dirty` and disclosed; a modified tracked file is a hard stop,
 * because then the commit no longer describes what was built.
 */
function classifyWorkingTree(upstreamRoot) {
  const porcelain = git(upstreamRoot, ["status", "--porcelain"]);
  const rows = porcelain.split("\n").filter((line) => line.trim().length > 0);
  const untracked = rows.filter((row) => row.startsWith("??"));
  const tracked = rows.filter((row) => !row.startsWith("??"));
  return { rows, untracked, tracked };
}

function toolVersion(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  if (result.status !== 0 || !result.stdout) return "unavailable";
  return result.stdout.trim().split("\n")[0];
}

async function copyTree(sourceRoot, destinationRoot, options = {}) {
  const copied = [];
  const walk = async (relative) => {
    const absoluteSource = path.join(sourceRoot, relative);
    const children = await readdir(absoluteSource, { withFileTypes: true });
    children.sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const child of children) {
      const childRelative = relative
        ? `${relative}/${child.name}`
        : child.name;
      if (child.isDirectory()) {
        if (options.filePattern !== undefined) {
          fail(`unexpected nested directory in a flat tree: ${childRelative}`);
        }
        await walk(childRelative);
        continue;
      }
      if (!child.isFile()) {
        fail(`refusing to vendor a special file: ${childRelative}`);
      }
      if (
        options.filePattern !== undefined &&
        !options.filePattern.test(child.name)
      ) {
        fail(
          `pack output has a file outside the run whitelist: ${childRelative}`,
        );
      }
      if (options.skip?.(childRelative)) continue;
      const from = path.join(sourceRoot, ...childRelative.split("/"));
      const to = path.join(destinationRoot, ...childRelative.split("/"));
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
      copied.push(childRelative);
    }
  };
  await mkdir(destinationRoot, { recursive: true });
  await walk("");
  return copied;
}

/**
 * Rewrite the surface's own asset inventory so it describes the bytes that
 * actually ship. Leaving it verbatim would have it claim eight branding files
 * that were deliberately removed — an inventory that lies is worse than none.
 */
async function rewriteAssetManifest(surfaceRoot, placeholderBytes) {
  const manifestPath = path.join(surfaceRoot, "asset-manifest.json");
  const original = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(original);
  const kept = [];
  const dropped = [];
  for (const file of manifest.files) {
    if (file.category !== "branding") {
      kept.push(file);
      continue;
    }
    if (file.path === BRANDING_LOGO_RELATIVE) {
      kept.push({
        ...file,
        bytes: placeholderBytes.length,
        sha256: sha256(placeholderBytes),
        sourcePath: "elftia-plugin-rocut/licenses/branding-placeholder.svg",
        requiredBy: `${file.requiredBy} — substituted, see vendor/PROVENANCE.md`,
      });
      continue;
    }
    dropped.push(file);
  }
  manifest.files = kept;
  manifest.fileCount = kept.length;
  manifest.totalBytes = kept.reduce((sum, file) => sum + file.bytes, 0);
  manifest.elftiaSubstitutions = {
    note:
      "Repackaged for the Elftia rocut plugin. Upstream OpenCut brand marks are " +
      "a trademark outside the MIT code grant and are not redistributed here; " +
      `${BRANDING_LOGO_RELATIVE} is a neutral placeholder. See vendor/PROVENANCE.md.`,
    removed: dropped.map((file) => ({ path: file.path, sha256: file.sha256 })),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    original: sha256(Buffer.from(original, "utf8")),
    rewritten: sha256(
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    ),
    dropped,
  };
}

export async function vendorRocut(options = {}) {
  const pin = await readPin();
  const { root: upstreamRoot, source: upstreamSource } = resolveUpstreamRoot(
    options.rocutRoot,
    pin,
  );
  const workRoot = path.join(pluginRoot, ".elftia-work");
  const packOut = path.join(workRoot, "dist-runtime");
  const packManifest = path.join(workRoot, "runtime-bundle-manifest.json");
  const vendorRoot = path.join(pluginRoot, "vendor");
  const log = options.log ?? ((line) => console.info(line));

  const head = git(upstreamRoot, ["rev-parse", "HEAD"]).trim();
  if (head !== pin.commit) {
    fail(
      `upstream HEAD ${head}\ndoes not match the pin in upstream.json ${pin.commit}.\n` +
        `Either check the upstream out at the pin:\n` +
        `  git -C ${upstreamRoot} checkout ${pin.commit}\n` +
        `or move the pin deliberately by editing upstream.json (it is the committed\n` +
        `record of what vendor/ is built from, and vendor/ is not in git).`,
    );
  }
  const tree = classifyWorkingTree(upstreamRoot);
  const trackedDiff = git(upstreamRoot, ["diff", "HEAD", "--stat"]).trim();
  let modifiedTracked = null;
  if (tree.tracked.length > 0 || trackedDiff.length > 0) {
    // A modified tracked file means the pin alone no longer describes the packed
    // bytes. Refuse by default. The opt-in exists for the reviewed-but-not-yet-
    // committed upstream patch case, and it buys disclosure, not silence: the
    // paths, the diffstat and each file's working-tree digest go into the
    // shipped PROVENANCE, which states in its first line that this is not a
    // pin-only build.
    if (options.allowModifiedTracked !== true) {
      fail(
        "upstream has modified tracked files, so the pinned commit does not describe the\n" +
          "packed bytes:\n  " +
          [...tree.tracked].join("\n  ") +
          "\n\nCommit them upstream, or re-run with --allow-modified-tracked to pack anyway\n" +
          "and have the deviation disclosed in vendor/PROVENANCE.md.",
      );
    }
    const paths = git(upstreamRoot, ["diff", "HEAD", "--name-only"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    modifiedTracked = {
      diffstat: trackedDiff,
      files: paths.map((relative) => ({
        path: relative,
        workingTreeSha256: sha256(
          readFileSync(path.join(upstreamRoot, ...relative.split("/"))),
        ),
        committedSha256: sha256(
          Buffer.from(git(upstreamRoot, ["show", `HEAD:${relative}`]), "utf8"),
        ),
      })),
    };
    log(
      `vendor: WARNING packing with ${paths.length} MODIFIED TRACKED upstream file(s) — ` +
        `not a pin-only build: ${paths.join(", ")}`,
    );
  }
  log(
    `vendor: upstream ${upstreamRoot} (via ${upstreamSource}) @ ${head} — matches upstream.json pin`,
  );
  if (tree.untracked.length > 0) {
    log(
      `vendor: upstream carries ${tree.untracked.length} untracked entr(ies); packing with --allow-dirty and disclosing them`,
    );
  }

  if (options.skipPack !== true) {
    await rm(packOut, { recursive: true, force: true });
    await mkdir(workRoot, { recursive: true });
    const packArgs = [
      path.join(upstreamRoot, "script", "pack-runtime.mjs"),
      "--out",
      packOut,
      "--manifest",
      packManifest,
      "--skip-smoke",
    ];
    if (tree.rows.length > 0) packArgs.push("--allow-dirty");
    log(`vendor: node ${packArgs.map((a) => path.basename(a)).join(" ")}`);
    const pack = spawnSync(process.execPath, packArgs, {
      cwd: upstreamRoot,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    const packOutput = `${pack.stdout || ""}${pack.stderr || ""}`.trim();
    log(packOutput);
    log(`REAL_EXIT_CODE[pack-runtime]:${pack.status}`);
    if (pack.status !== 0) fail(`upstream pack-runtime failed:\n${packOutput}`);
  } else {
    log("vendor: --skip-pack, reusing .elftia-work/dist-runtime");
  }
  if (!existsSync(path.join(packOut, "rocut.mjs"))) {
    fail(`pack output has no rocut.mjs at ${packOut}`);
  }
  if (!existsSync(path.join(packOut, "surface"))) {
    fail(
      `pack output has no surface/ at ${packOut} — build apps/vite-example with OPENCUT_PUBLIC_BASE=./ first`,
    );
  }

  await rm(vendorRoot, { recursive: true, force: true });
  await mkdir(vendorRoot, { recursive: true });

  // vendor/run — the bundled CLI closure. Flat by construction: the pack output
  // root holds the entry, its chunks, the wasm sibling and its own PROVENANCE;
  // only the first three are runtime bytes, and the wasm must stay a sibling of
  // the chunk that imports it, so the flat shape is load-bearing.
  const runRoot = path.join(vendorRoot, "run");
  await mkdir(runRoot, { recursive: true });
  const runFiles = [];
  for (const child of await readdir(packOut, { withFileTypes: true })) {
    if (!child.isFile() || !RUN_FILE_PATTERN.test(child.name)) continue;
    await copyFile(path.join(packOut, child.name), path.join(runRoot, child.name));
    runFiles.push(child.name);
  }
  if (!runFiles.includes("rocut.mjs")) fail("vendor/run did not receive rocut.mjs");
  if (!runFiles.includes("opencut_wasm_bg.wasm")) {
    fail("vendor/run did not receive the opencut_wasm_bg.wasm sibling");
  }
  if (!runFiles.some((name) => name.startsWith("chunk-"))) {
    fail("vendor/run received no esbuild chunk — the split-bundle contract broke");
  }
  log(`vendor: run/ ${runFiles.length} file(s): ${runFiles.sort().join(", ")}`);

  // vendor/surface — the prebuilt editor, minus the upstream brand marks.
  const removals = [];
  const surfaceSource = path.join(packOut, "surface");
  await copyTree(surfaceSource, path.join(vendorRoot, "surface"), {
    skip: (relative) => {
      if (!relative.startsWith("logos/")) return false;
      removals.push(relative);
      return true;
    },
  });
  const surfaceRoot = path.join(vendorRoot, "surface");
  const removalRecords = [];
  for (const relative of removals.sort()) {
    const bytes = await readFile(
      path.join(surfaceSource, ...relative.split("/")),
    );
    removalRecords.push({
      path: `surface/${relative}`,
      sha256: sha256(bytes),
      reason:
        "upstream OpenCut brand mark — trademark, outside the MIT code grant",
    });
  }

  // The editor header renders branding.logoUrl; substitute rather than 404.
  const placeholderSource = path.join(
    pluginRoot,
    "licenses",
    "branding-placeholder.svg",
  );
  const placeholderBytes = await readFile(placeholderSource);
  const placeholderTarget = path.join(
    surfaceRoot,
    ...BRANDING_LOGO_RELATIVE.split("/"),
  );
  await mkdir(path.dirname(placeholderTarget), { recursive: true });
  await writeFile(placeholderTarget, placeholderBytes);
  const upstreamLogo = removalRecords.find(
    (item) => item.path === `surface/${BRANDING_LOGO_RELATIVE}`,
  );
  if (upstreamLogo === undefined) {
    fail(
      `upstream surface did not carry ${BRANDING_LOGO_RELATIVE}; the substitution rule is stale`,
    );
  }
  const substitutions = [
    {
      path: `surface/${BRANDING_LOGO_RELATIVE}`,
      reason:
        "neutral placeholder replacing the upstream OpenCut brand mark the editor header resolves as branding.logoUrl",
      upstreamSha256: upstreamLogo.sha256,
      shippedSha256: sha256(placeholderBytes),
    },
  ];
  const manifestRewrite = await rewriteAssetManifest(
    surfaceRoot,
    placeholderBytes,
  );
  substitutions.push({
    path: "surface/asset-manifest.json",
    reason:
      "regenerated so the surface's own inventory matches the shipped bytes after the branding removal",
    upstreamSha256: manifestRewrite.original,
    shippedSha256: manifestRewrite.rewritten,
  });
  // The removed brand-mark digests are the ones the dist gate refuses.
  for (const record of removalRecords) {
    if (record.path === `surface/${BRANDING_LOGO_RELATIVE}`) continue;
    if (!FORBIDDEN_BRAND_DIGESTS.has(record.sha256)) {
      log(
        `vendor: WARNING removed ${record.path} is not in the dist trademark denylist (sha256 ${record.sha256})`,
      );
    }
  }
  log(
    `vendor: surface/ packed; removed ${removalRecords.length} brand mark(s), substituted 1 placeholder`,
  );

  // Licence + notice.
  await copyFile(
    path.join(upstreamRoot, "LICENSE"),
    path.join(vendorRoot, "LICENSE"),
  );
  await copyFile(
    path.join(pluginRoot, "licenses", "NOTICE.md"),
    path.join(vendorRoot, "NOTICE.md"),
  );

  const entries = await inventoryVendorTree(vendorRoot);
  const facts = {
    upstreamCommit: head,
    upstreamRepository: UPSTREAM_REPOSITORY,
    packedAt: new Date().toISOString(),
    nodeVersion: process.version,
    esbuildVersion: JSON.parse(
      await readFile(
        path.join(upstreamRoot, "node_modules", "esbuild", "package.json"),
        "utf8",
      ),
    ).version,
    bunVersion: toolVersion(
      process.platform === "win32" ? "bun.exe" : "bun",
      ["--version"],
    ),
    platform: `${process.platform} ${process.arch}`,
    dirtyEntries: tree.untracked,
    modifiedTracked,
    substitutions,
    removals: removalRecords,
    entries,
  };
  await writeFile(
    path.join(vendorRoot, "PROVENANCE.md"),
    renderProvenance(facts),
  );
  log(
    `vendor: PASS ${entries.length} file(s) under vendor/ pinned to ${head.slice(0, 12)}`,
  );
  return { vendorRoot, head, entries, removals: removalRecords, substitutions };
}

const invokedPath =
  process.argv[1] === undefined ? null : pathToFileURL(process.argv[1]).href;
if (invokedPath === import.meta.url) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  try {
    await vendorRocut({
      rocutRoot: flag("rocut"),
      skipPack: argv.includes("--skip-pack"),
      allowModifiedTracked: argv.includes("--allow-modified-tracked"),
    });
  } catch (error) {
    console.error(
      `vendor-rocut: FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
