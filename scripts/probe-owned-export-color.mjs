import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { getRocutProbeRoot, loadRocutProbe } from "./rocut-probe-source.mjs";

const {
  inspectContinuityExportPixels,
  compareContinuityExport,
  sampleContinuityExportPng,
  assertContinuityExport,
} = await loadRocutProbe("probe-continuity-export-pixels.mjs");
for (const key of [
  "ELFTIA_WORKTREE",
  "ELFTIA_CLI_DEBUG_PORT",
  "ELFTIA_EXPORT_EVIDENCE",
  "ELFTIA_EXPORT_VIDEO",
])
  assert(process.env[key], key);
const host = await realpath(process.env.ELFTIA_WORKTREE);
const evidenceRoot = await realpath(join(host, ".tmp-rocut-e2e"));
const source = await realpath(process.env.ELFTIA_EXPORT_EVIDENCE);
const video = await realpath(process.env.ELFTIA_EXPORT_VIDEO);
const outputRelative = relative(source, video);
assert(
  outputRelative &&
    !outputRelative.startsWith("..") &&
    !isAbsolute(outputRelative),
);
assert(
  (await stat(video)).size <= 64 * 1024 * 1024,
  "Bounded eight-second export required",
);
for (const path of [source, video]) {
  const nested = relative(evidenceRoot, path);
  assert(nested && !nested.startsWith("..") && !isAbsolute(nested));
}
const work = await mkdtemp(join(evidenceRoot, "export-color-"));
const { connect } = await import(
  pathToFileURL(join(host, "packages/elftia-cli/src/connect.ts")).href
);
const conn = await connect({
  mode: "attach",
  port: Number(process.env.ELFTIA_CLI_DEBUG_PORT),
});
const evidence = {
  acceptanceEligible: false,
  passed: false,
  source,
  video,
  samples: [],
};
try {
  const originalEvidence = JSON.parse(
    await readFile(join(source, "evidence.json"), "utf8"),
  );
  const sourceVideo = join(source, "continuity-underlay.mp4");
  assert.equal(
    createHash("sha256")
      .update(await readFile(sourceVideo))
      .digest("hex"),
    originalEvidence.linkedWorkflow.mediaSha256,
  );
  evidence.outputSha256 = createHash("sha256")
    .update(await readFile(video))
    .digest("hex");
  const { Input, BufferSource, ALL_FORMATS, EncodedPacketSink } = await import(
    pathToFileURL(
      join(
        getRocutProbeRoot(),
        "node_modules/mediabunny/dist/modules/src/index.js",
      ),
    ).href
  );
  const input = new Input({
    source: new BufferSource(await readFile(video)),
    formats: ALL_FORMATS,
  });
  let config,
    packets = [];
  try {
    const track = await input.getPrimaryVideoTrack();
    config = await track.getDecoderConfig();
    assert.equal(config.codedWidth, 1920);
    assert.equal(config.codedHeight, 1080);
    config.description = Array.from(config.description);
    for await (const packet of new EncodedPacketSink(track).packets())
      packets.push({
        type: packet.type,
        timestamp: packet.microsecondTimestamp,
        duration: packet.microsecondDuration,
        data: Array.from(packet.data),
      });
  } finally {
    input.dispose();
  }
  assert.equal(
    packets.length,
    240,
    "Exact eight-second / 30fps fixture required",
  );
  const videoSamples = await conn.page.evaluate(
    async ({ config, packets }) => {
      const canvas = new OffscreenCanvas(320, 180);
      const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
      const samples = {};
      let failure;
      const decoder = new VideoDecoder({
        output(frame) {
          try {
            const index = Math.round((frame.timestamp * 30) / 1000000);
            if (![0, 54, 78, 114, 174, 198].includes(index)) return;
            ctx.drawImage(frame, 0, 0, 320, 180);
            samples[index] = Array.from(ctx.getImageData(0, 0, 320, 180).data);
          } finally {
            frame.close();
          }
        },
        error(error) {
          failure = error.message;
        },
      });
      try {
        decoder.configure({
          ...config,
          description: new Uint8Array(config.description),
        });
        for (const packet of packets) {
          decoder.decode(
            new EncodedVideoChunk({
              ...packet,
              data: new Uint8Array(packet.data),
            }),
          );
        }
        await decoder.flush();
        if (failure) throw new Error(failure);
        return samples;
      } finally {
        decoder.close();
      }
    },
    { config, packets },
  );
  evidence.decoderColorSpace = config.colorSpace;
  assert.equal(Object.keys(videoSamples).length, 6);
  assert.equal(
    inspectContinuityExportPixels(videoSamples[0]).foreground.length,
    0,
  );
  for (const frame of [24, 48, 84, 144, 168]) {
    const reference = Array.from(
      await readFile(join(source, "export-reference-" + frame + ".png")),
    );
    const png = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        video,
        "-vf",
        "select=eq(n\\," + (frame + 30) + ")",
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
      ],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
    const sampled = await conn.page.evaluate(
      async ({ reference, decoded }) => {
        const canvas = new OffscreenCanvas(320, 180);
        const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
        const raster = (image) => {
          ctx.clearRect(0, 0, 320, 180);
          ctx.drawImage(image, 0, 0, 320, 180);
          return Array.from(ctx.getImageData(0, 0, 320, 180).data);
        };
        const image = async (data, conversion) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(data)], { type: "image/png" }),
            { colorSpaceConversion: conversion },
          );
          try {
            return raster(bitmap);
          } finally {
            bitmap.close();
          }
        };
        const result = {
          reference: await image(reference, "default"),
          png: await image(decoded, "default"),
          pngNoConversion: await image(decoded, "none"),
        };
        return result;
      },
      { reference, decoded: Array.from(png) },
    );
    sampled.video = videoSamples[frame + 30];
    const expected = inspectContinuityExportPixels(sampled.reference);
    const result = { sourceFrame: frame, floor: {}, scores: {} };
    for (const [kind, pixels] of Object.entries(sampled)) {
      result.floor[kind] = pixels.slice(
        (160 * 320 + 20) * 4,
        (160 * 320 + 20) * 4 + 3,
      );
      if (kind !== "reference")
        result.scores[kind] = compareContinuityExport({
          expected,
          actual: inspectContinuityExportPixels(pixels),
        });
    }
    evidence.samples.push(result);
    const production = compareContinuityExport({
      expected: await sampleContinuityExportPng(
        conn.page,
        Buffer.from(reference),
      ),
      actual: await sampleContinuityExportPng(conn.page, png),
    });
    result.scores.production = production;
    assertContinuityExport(production);
    assertContinuityExport(result.scores.video);
  }
  const audioRms = (path, channel) => {
    const bytes = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        "-vn",
        "-af",
        "pan=mono|c0=c" + channel,
        "-ar",
        "8000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { windowsHide: true },
    );
    let sum = 0;
    for (let index = 0; index < bytes.length; index += 4)
      sum += bytes.readFloatLE(index) ** 2;
    return Math.sqrt(sum / (bytes.length / 4));
  };
  const sourceRms = audioRms(sourceVideo, 0);
  const rms = [audioRms(video, 0), audioRms(video, 1)];
  assert(sourceRms > 0.07 && sourceRms < 0.11);
  assert(
    rms.every((value) => value / sourceRms > 0.95 && value / sourceRms < 1.05),
  );
  evidence.audio = { sourceRms, rms };
  evidence.passed = true;
} finally {
  await writeFile(
    join(work, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await conn.close();
  console.log(JSON.stringify({ work, samples: evidence.samples }));
}
