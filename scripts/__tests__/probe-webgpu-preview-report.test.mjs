import assert from "node:assert/strict";
import test from "node:test";
import { summarizeWebGpuObservation } from "../probe-webgpu-preview-report.mjs";

const fixture = () => {
  const submissions = Array.from({ length: 101 }, (_, index) => ({
    time: 600000 + index * 4000,
    startedAt: index * 40,
    durationMs: 5,
    width: 1280,
    height: 720,
    completed: true,
  }));
  return {
    environment: { width: 1280, height: 720 },
    status: {
      submitted: 101,
      pending: 0,
      overflows: 0,
      submissionOverflows: 0,
      failures: 0,
      timedOut: false,
      ownsObserver: true,
    },
    submissions,
    samples: submissions.map(({ completed, ...sample }) => ({
      ...sample,
      submittedAt: sample.startedAt + 5,
      gpuCallbackAt: sample.startedAt + 20,
    })),
  };
};

test("reports complete independently matched GPU callbacks without acceptance claims", () => {
  const result = summarizeWebGpuObservation(fixture());
  assert.equal(result.acceptanceEligible, false);
  assert.deepEqual(result.previewToGpuCallback, {
    count: 101,
    p95Ms: 20,
    maxMs: 20,
  });
  assert.equal(result.submission.p95Ms, 5);
  assert.equal(result.queueWaitAndCallbackDelivery.p95Ms, 15);
});

test("rejects missing, duplicate, mismatched and invalid completion records", () => {
  for (const change of [
    (value) => value.samples.pop(),
    (value) => {
      value.samples[1] = { ...value.samples[0] };
    },
    (value) => {
      value.samples[0].width = 1920;
    },
    (value) => {
      value.samples[0].durationMs = 99;
    },
    (value) => {
      value.samples[0].gpuCallbackAt = 0;
    },
    (value) => {
      value.samples[0].gpuCallbackAt = NaN;
    },
    (value) => {
      value.status.pending = 1;
    },
    (value) => {
      value.status.overflows = 1;
    },
    (value) => {
      value.status.timedOut = true;
    },
    (value) => {
      value.status.ownsObserver = false;
    },
  ]) {
    const value = fixture();
    change(value);
    assert.throws(() => summarizeWebGpuObservation(value));
  }
});

test("requires actual warmed samples rather than counting cold starts", () => {
  const value = fixture();
  value.samples[0].time = 0;
  value.submissions[0].time = 0;
  assert.throws(() => summarizeWebGpuObservation(value), /Insufficient warmed/);
});
