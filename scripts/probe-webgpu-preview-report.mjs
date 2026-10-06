import assert from "node:assert/strict";

export function summarizeWebGpuObservation(evidence) {
  const { status, samples, submissions, environment } = evidence;
  assert.equal(
    status.overflows +
      status.submissionOverflows +
      status.failures +
      status.pending,
    0,
  );
  assert.equal(status.timedOut, false);
  assert.equal(status.ownsObserver, true);
  assert.equal(samples.length, status.submitted);
  assert.equal(submissions.length, status.submitted);
  const keys = new Map(
    submissions.map((sample) => [`${sample.time}:${sample.startedAt}`, sample]),
  );
  assert.equal(keys.size, submissions.length, "Ambiguous submission identity");
  const seen = new Set();
  for (const sample of samples) {
    const key = `${sample.time}:${sample.startedAt}`;
    const submitted = keys.get(key);
    assert(submitted?.completed && !seen.has(key), "Unmatched GPU completion");
    seen.add(key);
    for (const field of [
      "time",
      "startedAt",
      "durationMs",
      "width",
      "height",
    ]) {
      assert(Number.isFinite(sample[field]));
      assert.equal(sample[field], submitted[field]);
    }
    assert.equal(sample.width, environment.width);
    assert.equal(sample.height, environment.height);
    assert(
      sample.durationMs >= 0 &&
        Number.isFinite(sample.submittedAt) &&
        Number.isFinite(sample.gpuCallbackAt),
    );
    assert(sample.submittedAt >= sample.startedAt + sample.durationMs);
    assert(sample.gpuCallbackAt >= sample.submittedAt);
  }
  const warm = samples.filter((sample) => sample.time >= 5 * 120000);
  assert(warm.length > 100, "Insufficient warmed preview completions");
  const distribution = (values) => {
    values.sort((a, b) => a - b);
    return {
      count: values.length,
      p95Ms: values[Math.ceil(values.length * 0.95) - 1],
      maxMs: values.at(-1),
    };
  };
  return {
    acceptanceEligible: false,
    warmupTimelineSeconds: 5,
    submission: distribution(warm.map((sample) => sample.durationMs)),
    previewToGpuCallback: distribution(
      warm.map((sample) => sample.gpuCallbackAt - sample.startedAt),
    ),
    queueWaitAndCallbackDelivery: distribution(
      warm.map((sample) => sample.gpuCallbackAt - sample.submittedAt),
    ),
  };
}
