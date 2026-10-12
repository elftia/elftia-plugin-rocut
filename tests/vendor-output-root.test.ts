import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { prepareVendorPaths } from "../scripts/vendor-paths.mjs";
import { vendorRocut } from "../scripts/vendor-rocut.mjs";

const roots: string[] = [];
const links: string[] = [];
const identities = new Map<string, { dev: number; ino: number }>();
async function fixture() {
  const root = await mkdtemp(
    path.join(path.parse(process.cwd()).root, "rocut-output-test-"),
  );
  roots.push(root);
  identities.set(root, lstatSync(root));
  const plugin = path.join(root, "plugin");
  const upstream = path.join(root, "upstream");
  const parent = path.join(root, "staging");
  const outside = path.join(root, "outside");
  for (const dir of [plugin, upstream, parent, outside]) await mkdir(dir);
  await writeFile(path.join(outside, "sentinel"), "unchanged");
  return {
    root,
    plugin,
    upstream,
    parent,
    outside,
    outputRoot: path.join(parent, "output"),
  };
}
afterEach(async () => {
  for (const link of links.splice(0)) {
    if (!lstatSync(link).isSymbolicLink())
      throw new Error("test link changed identity");
    await unlink(link);
  }
  for (const root of roots.splice(0)) {
    const stat = lstatSync(root);
    const prior = identities.get(root)!;
    if (
      realpathSync.native(root) !== root ||
      stat.dev !== prior.dev ||
      stat.ino !== prior.ino
    )
      throw new Error("test cleanup root changed identity");
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps legacy roots and rejects relative, existing, overlapping or reused fresh output", async () => {
  const f = await fixture();
  expect(prepareVendorPaths({}, f.plugin, f.upstream).vendorRoot).toBe(
    path.join(f.plugin, "vendor"),
  );
  expect(() =>
    prepareVendorPaths({ outputRoot: "relative" }, f.plugin, f.upstream),
  ).toThrow(/absolute/);
  expect(() =>
    prepareVendorPaths({ outputRoot: f.parent }, f.plugin, f.upstream),
  ).toThrow(/fresh/);
  expect(() =>
    prepareVendorPaths(
      { outputRoot: path.join(f.plugin, "fresh") },
      f.plugin,
      f.upstream,
    ),
  ).toThrow(/disjoint/);
  expect(() =>
    prepareVendorPaths(
      { outputRoot: f.outputRoot, skipPack: true },
      f.plugin,
      f.upstream,
    ),
  ).toThrow(/skip-pack/);
  await expect(
    vendorRocut({ outputRoot: f.outputRoot, skipPack: true }),
  ).rejects.toThrow(/skip-pack/);
});

it("rejects Surface and WASM overlap without creating output", async () => {
  const f = await fixture();
  for (const key of ["surfaceDirectory", "wasmPackageDirectory"]) {
    expect(() =>
      prepareVendorPaths(
        { outputRoot: f.outputRoot, [key]: f.parent },
        f.plugin,
        f.upstream,
      ),
    ).toThrow(/disjoint/);
  }
  await expect(readFile(f.outputRoot)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("refuses escape and redirected parent before writes or cleanup; outside remains unchanged", async () => {
  const f = await fixture();
  const io = prepareVendorPaths(
    { outputRoot: f.outputRoot },
    f.plugin,
    f.upstream,
  );
  await io.mkdir(f.outputRoot);
  await expect(
    io.writeFile(path.join(f.outside, "new"), "bad"),
  ).rejects.toThrow(/escapes/);
  await rename(f.parent, `${f.parent}-retained`);
  await symlink(f.outside, f.parent, "junction");
  links.push(f.parent);
  await expect(
    io.writeFile(path.join(f.outputRoot, "new"), "bad"),
  ).rejects.toThrow(/redirect|identity/);
  await expect(
    io.rm(f.outputRoot, { recursive: true, force: true }),
  ).rejects.toThrow(/redirect|identity/);
  expect(await readFile(path.join(f.outside, "sentinel"), "utf8")).toBe(
    "unchanged",
  );
  await expect(
    readFile(path.join(f.outside, "output", "new")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects redirected inputs and allows only owned ordinary writes", async () => {
  const f = await fixture();
  const alias = path.join(f.root, "alias");
  await symlink(f.outside, alias, "junction");
  links.push(alias);
  expect(() =>
    prepareVendorPaths(
      { outputRoot: f.outputRoot, surfaceDirectory: alias },
      f.plugin,
      f.upstream,
    ),
  ).toThrow(/absolute|redirect/);
  const io = prepareVendorPaths(
    { outputRoot: f.outputRoot },
    f.plugin,
    f.upstream,
  );
  await io.mkdir(io.vendorRoot, { recursive: true });
  await io.copyFile(
    path.join(f.outside, "sentinel"),
    path.join(io.vendorRoot, "copy"),
  );
  expect(await readFile(path.join(io.vendorRoot, "copy"), "utf8")).toBe(
    "unchanged",
  );
});

it("never adopts a root created by someone else after preparation", async () => {
  const f = await fixture();
  const io = prepareVendorPaths(
    { outputRoot: f.outputRoot },
    f.plugin,
    f.upstream,
  );
  await mkdir(f.outputRoot);
  await writeFile(path.join(f.outputRoot, "sentinel"), "not-owned");
  await expect(
    io.mkdir(io.workRoot, { recursive: true }),
  ).rejects.toMatchObject({ code: "EEXIST" });
  await expect(
    io.writeFile(path.join(f.outputRoot, "new"), "bad"),
  ).rejects.toMatchObject({ code: "EEXIST" });
  await expect(
    io.rm(f.outputRoot, { recursive: true, force: true }),
  ).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(path.join(f.outputRoot, "sentinel"), "utf8")).toBe(
    "not-owned",
  );
});

it("CLI missing output-root value cannot fall back to legacy vendor", () => {
  const script = fileURLToPath(
    new URL("../scripts/vendor-rocut.mjs", import.meta.url),
  );
  for (const args of [["--output-root"], ["--output-root", "--skip-pack"]]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--output-root requires a value");
  }
});
