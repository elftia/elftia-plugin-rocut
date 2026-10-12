import { lstatSync, realpathSync, readdirSync } from "node:fs";
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
};

/** Fresh output ownership, including physical ancestor identities. No path is trusted twice. */
export function prepareVendorPaths(options, pluginRoot, upstreamRoot) {
  const fresh = options.outputRoot !== undefined;
  if (
    fresh &&
    (typeof options.outputRoot !== "string" ||
      !path.isAbsolute(options.outputRoot))
  ) {
    throw new Error("outputRoot must be an absolute path");
  }
  const root = fresh ? path.resolve(options.outputRoot) : pluginRoot;
  if (fresh && options.skipPack === true)
    throw new Error("fresh outputRoot rejects --skip-pack");
  const workRoot = path.join(root, ".elftia-work");
  const vendorRoot = path.join(root, "vendor");
  const identities = new Map();
  const inspect = (candidate) => {
    let stat;
    try {
      stat = lstatSync(candidate);
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`refusing redirected or special path: ${candidate}`);
    }
    const real = realpathSync.native(candidate);
    if (path.relative(candidate, real) !== "")
      throw new Error(`redirected physical path: ${candidate}`);
    const prior = identities.get(candidate);
    if (
      prior &&
      (prior.real !== real || prior.dev !== stat.dev || prior.ino !== stat.ino)
    ) {
      throw new Error(`path identity changed: ${candidate}`);
    }
    // File contents may be rewritten; directory identity must remain stable.
    if (stat.isDirectory())
      identities.set(candidate, { real, dev: stat.dev, ino: stat.ino });
    return true;
  };
  const ancestors = (candidate) => {
    const chain = [];
    for (
      let current = path.resolve(candidate);
      ;
      current = path.dirname(current)
    ) {
      chain.push(current);
      if (path.dirname(current) === current) break;
    }
    for (const current of chain.reverse()) {
      if (!inspect(current) && identities.has(current))
        throw new Error(`captured path disappeared: ${current}`);
    }
  };
  const protectedRoots = [
    pluginRoot,
    upstreamRoot,
    options.surfaceDirectory,
    options.wasmPackageDirectory,
    path.join(homedir(), ".elftia", "plugins"),
  ]
    .filter(Boolean)
    .map((value) => path.resolve(value));
  if (fresh) {
    for (const value of [
      options.surfaceDirectory,
      options.wasmPackageDirectory,
    ].filter((value) => value !== undefined)) {
      if (
        typeof value !== "string" ||
        !path.isAbsolute(value) ||
        !lstatSync(value).isDirectory()
      )
        throw new Error("explicit input must be an absolute directory");
    }
    ancestors(root);
    if (inspect(root))
      throw new Error("outputRoot must be fresh (must not exist)");
    for (const protectedRoot of protectedRoots) {
      ancestors(protectedRoot);
      if (inside(root, protectedRoot) || inside(protectedRoot, root)) {
        throw new Error(
          `outputRoot must be disjoint from protected tree: ${protectedRoot}`,
        );
      }
    }
  }
  const assert = (target = root, source) => {
    if (!fresh) return;
    if (!inside(root, path.resolve(target)))
      throw new Error(`output path escapes owned root: ${target}`);
    for (const captured of identities.keys()) {
      if (!inspect(captured))
        throw new Error(`captured path disappeared: ${captured}`);
    }
    ancestors(target);
    if (source) ancestors(source);
  };
  const tree = (target) => {
    assert(target);
    if (!inspect(target)) return;
    if (lstatSync(target).isDirectory()) {
      for (const child of readdirSync(target)) tree(path.join(target, child));
    }
  };
  let initialized;
  const initialize = () => {
    if (!fresh) return Promise.resolve();
    if (!initialized) {
      initialized = (async () => {
        assert(root);
        // Exclusive creation establishes ownership; never adopt a root created after preparation.
        await mkdir(root);
        assert(root);
      })();
    }
    return initialized;
  };
  return {
    fresh,
    root,
    workRoot,
    vendorRoot,
    assert,
    packOut: path.join(workRoot, "dist-runtime"),
    packManifest: path.join(workRoot, "runtime-bundle-manifest.json"),
    async mkdir(target, opts) {
      await initialize();
      assert(target);
      if (fresh && path.resolve(target) === root) return;
      await mkdir(target, opts);
      assert(target);
    },
    async copyFile(source, target) {
      await initialize();
      assert(target, source);
      await copyFile(source, target);
    },
    async writeFile(target, bytes) {
      await initialize();
      assert(target);
      await writeFile(target, bytes);
    },
    async rm(target, opts) {
      await initialize();
      if (fresh) tree(target);
      await rm(target, opts);
    },
  };
}
