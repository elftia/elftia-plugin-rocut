import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const skillPath = path.join(repoRoot, "skills", "rocut-studio", "SKILL.md");
const manifestPath = path.join(repoRoot, "elftia-plugin.json");

async function skill(): Promise<string> {
  return readFile(skillPath, "utf8");
}

describe("the skill drives the bundled runtime, not a checkout", () => {
  it("invokes the vendored entry with node", async () => {
    const text = await skill();
    expect(text).toContain("$SKILL_DIR/../../vendor/run/rocut.mjs");
    expect(text).toContain("$SKILL_DIR/../../vendor/surface");
    expect(text).toMatch(/node \$SKILL_DIR\/\.\.\/\.\.\/vendor\/run\/rocut\.mjs/);
  });

  it("carries no bun invocation and no rocut-checkout path", async () => {
    const text = await skill();
    expect(text).not.toMatch(/^\s*bun\s/m);
    expect(text).not.toMatch(/bun \$/);
    expect(text).not.toContain("apps/cli/src/main.ts");
    expect(text).not.toContain("apps/vite-example");
    // `$ROCUT` may only appear where the skill tells the agent NOT to look for
    // a checkout; it must never root a path the agent runs.
    expect(text).not.toMatch(/\$ROCUT\//);
    expect(text).not.toMatch(/\$ROCUT\\/);
    expect(text).toMatch(/Do not look for[\s\S]{0,120}\$ROCUT/);
    // `$ROCUT_TARGETS_ROOT` is part of rocut's own CLI contract and stays.
    expect(text).toContain("$ROCUT_TARGETS_ROOT");
  });

  it("keeps the relative-asset-base constraint", async () => {
    const text = await skill();
    expect(text.toLowerCase()).toContain("relative");
    expect(text).toContain("/<token>/");
    expect(text).toContain("401");
  });

  it("keeps the operating discipline the skill exists for", async () => {
    const text = await skill();
    for (const marker of [
      "120,000 ticks per second",
      "expectedRevision",
      "idempotencyKey",
      "--target auto",
      "Host-lifetime honesty",
      "draft begin",
      "WebPane",
      "Never edit `<project-dir>/project.json` by hand",
    ]) {
      expect(text).toContain(marker);
    }
  });

  it("does not tell the agent to set the obsolete wasm flag", async () => {
    const flat = (await skill()).replace(/\s+/g, " ");
    // The flag was the pre-bundling mitigation and is now inert. Wherever it is
    // mentioned, the surrounding prose must disown it — checked over a window,
    // because the sentence wraps across lines in the source.
    const flag = "--experimental-wasm-modules";
    let index = flat.indexOf(flag);
    expect(index).toBeGreaterThan(-1);
    while (index !== -1) {
      const window = flat.slice(
        Math.max(0, index - 200),
        index + flag.length + 200,
      );
      expect(window).toMatch(/stale|do not|don't|does nothing|obsolete/i);
      index = flat.indexOf(flag, index + 1);
    }
    // and never as a command prefix the agent would copy
    expect(flat).not.toMatch(/NODE_OPTIONS=--experimental-wasm-modules\s*\\?\s*node/);
  });

  it("states that older-schema projects migrate on open", async () => {
    const flat = (await skill()).replace(/\s+/g, " ");
    expect(flat).toMatch(/older rocut schema/i);
    expect(flat).toMatch(/migrat/i);
    // Migration rewrites the record in place — the user-facing consequence.
    expect(flat).toMatch(/one-way|in-place|BEFORE you open/i);
  });

  it("requires Node 20+", async () => {
    const text = await skill();
    expect(text).toContain("node --version");
    expect(text).toMatch(/>=\s*20/);
  });
});

describe("manifest", () => {
  it("no longer advertises a local checkout or bun", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.name).toBe("rocut");
    expect(manifest.kind).toBe("agent");
    // "no bun" is fine; "requires bun" is what must be gone.
    expect(manifest.description).not.toMatch(/requires?[^.]*bun/i);
    expect(manifest.description).not.toMatch(/with bun/i);
    expect(manifest.description).not.toMatch(/requires? a local rocut checkout/i);
    expect(manifest.description).not.toMatch(/no bundled build/i);
    expect(manifest.description).toMatch(/self-contained/i);
    expect(manifest.contributes.agent.skills).toHaveLength(1);
    expect(manifest.contributes.agent.skills[0].path).toBe(
      "./skills/rocut-studio",
    );
  });

  it("keeps the manifest version and the producer version in step", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const pkg = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf8"),
    );
    expect(manifest.version).toBe(pkg.version);
  });
});
