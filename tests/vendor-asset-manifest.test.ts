import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertMotionTextFontNotice,
  rewriteAssetManifest,
  validateSurfaceAssetManifest,
} from "../scripts/vendor-rocut.mjs";

const roots: string[] = [];
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "rocut-plugin-assets-"));
  roots.push(root);
  const fontPath = "motion-text/fonts/noto-sans-sc-variable.ttf";
  const licensePath = "motion-text/fonts/licenses/notosanssc-OFL.txt";
  const brandingPath = "logos/opencut/svg/logo.svg";
  const font = Buffer.from("font-bytes");
  const license = Buffer.from("SIL OPEN FONT LICENSE Version 1.1\n");
  const placeholder = Buffer.from("<svg>neutral</svg>\n");
  for (const logicalPath of [fontPath, licensePath, brandingPath]) {
    await mkdir(path.dirname(path.join(root, logicalPath)), {
      recursive: true,
    });
  }
  await writeFile(path.join(root, fontPath), font);
  await writeFile(path.join(root, licensePath), license);
  await writeFile(path.join(root, brandingPath), placeholder);
  const files = [
    {
      path: fontPath,
      category: "motion-text-font",
      bytes: font.length,
      sha256: sha256(font),
    },
    {
      path: licensePath,
      category: "motion-text-font-license",
      bytes: license.length,
      sha256: sha256(license),
    },
    {
      path: brandingPath,
      category: "branding",
      bytes: 999,
      sha256: "0".repeat(64),
    },
  ];
  await writeFile(
    path.join(root, "asset-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        files,
        fileCount: files.length,
        totalBytes: files.reduce((total, file) => total + file.bytes, 0),
      },
      null,
      2,
    )}\n`,
  );
  return { root, fontPath, licensePath, placeholder };
}

async function replaceManifestAsset(
  root: string,
  manifest: {
    files: Array<{ path: string; bytes: number; sha256: string }>;
    totalBytes: number;
  },
  logicalPath: string,
  bytes: Buffer,
) {
  const entry = manifest.files.find((file) => file.path === logicalPath);
  if (!entry) throw new Error(`fixture manifest is missing ${logicalPath}`);
  await writeFile(path.join(root, logicalPath), bytes);
  entry.bytes = bytes.length;
  entry.sha256 = sha256(bytes);
  manifest.totalBytes = manifest.files.reduce(
    (total, file) => total + file.bytes,
    0,
  );
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("vendored surface asset manifest", () => {
  it("preserves and verifies motion-text font resources during branding rewrite", async () => {
    const { root, fontPath, licensePath, placeholder } = await fixture();
    const result = await rewriteAssetManifest(root, placeholder);
    const manifest = JSON.parse(
      await readFile(path.join(root, "asset-manifest.json"), "utf8"),
    );

    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([
      fontPath,
      licensePath,
      "logos/opencut/svg/logo.svg",
    ]);
    expect(manifest.fileCount).toBe(3);
    expect(manifest.totalBytes).toBe(
      manifest.files.reduce(
        (total: number, file: { bytes: number }) => total + file.bytes,
        0,
      ),
    );
    expect(result.dropped).toEqual([]);
  });

  it("rejects a motion-text asset whose copied bytes do not match the manifest", async () => {
    const { root, fontPath, placeholder } = await fixture();
    await writeFile(path.join(root, fontPath), "tampered-font");

    await expect(rewriteAssetManifest(root, placeholder)).rejects.toThrow(
      /surface asset manifest (?:byte|digest) mismatch/,
    );
  });

  it("rejects an untracked file in the copied motion-text closure", async () => {
    const { root, placeholder } = await fixture();
    await writeFile(
      path.join(root, "motion-text/fonts/orphan.ttf"),
      "orphan-font",
    );

    await expect(rewriteAssetManifest(root, placeholder)).rejects.toThrow(
      "surface motion-text closure does not match asset-manifest.json",
    );
  });

  it("rejects non-canonical aliases even when they resolve inside surface", async () => {
    const { root, placeholder } = await fixture();
    const { manifest } = await rewriteAssetManifest(root, placeholder);
    manifest.files.find(
      (file: { path: string }) => file.path === "logos/opencut/svg/logo.svg",
    ).path = "logos/opencut/svg/../svg/logo.svg";

    await expect(validateSurfaceAssetManifest(root, manifest)).rejects.toThrow(
      "surface asset manifest has a non-canonical logical path",
    );
  });

  it("rejects a digest-valid license whose text is not OFL 1.1", async () => {
    const { root, licensePath, placeholder } = await fixture();
    const { manifest } = await rewriteAssetManifest(root, placeholder);
    await replaceManifestAsset(
      root,
      manifest,
      licensePath,
      Buffer.from("not a font license\n", "utf8"),
    );

    await expect(validateSurfaceAssetManifest(root, manifest)).rejects.toThrow(
      "motion-text font license is not OFL 1.1",
    );
  });

  it("rejects a digest-valid license whose bytes are not UTF-8", async () => {
    const { root, licensePath, placeholder } = await fixture();
    const { manifest } = await rewriteAssetManifest(root, placeholder);
    await replaceManifestAsset(
      root,
      manifest,
      licensePath,
      Buffer.from([0xc3, 0x28]),
    );

    await expect(validateSurfaceAssetManifest(root, manifest)).rejects.toThrow(
      "motion-text font license is not valid UTF-8",
    );
  });

  it("rejects a digest-valid UTF-8 license with a BOM", async () => {
    const { root, licensePath, placeholder } = await fixture();
    const { manifest } = await rewriteAssetManifest(root, placeholder);
    await replaceManifestAsset(
      root,
      manifest,
      licensePath,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("SIL OPEN FONT LICENSE Version 1.1\n", "utf8"),
      ]),
    );

    await expect(validateSurfaceAssetManifest(root, manifest)).rejects.toThrow(
      "motion-text font license must be UTF-8 without a BOM",
    );
  });

  it("requires the producer notice to disclose a shipped font closure", async () => {
    const { root, placeholder } = await fixture();
    const { manifest } = await rewriteAssetManifest(root, placeholder);

    expect(() => assertMotionTextFontNotice(manifest, "old notice")).toThrow(
      "licenses/NOTICE.md must disclose",
    );
    expect(
      assertMotionTextFontNotice(
        manifest,
        "motion-text/fonts are distributed under OFL-1.1",
      ),
    ).toEqual({ required: true, fonts: 1, licenses: 1 });
  });
});
