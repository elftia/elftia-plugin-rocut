import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { installWebGpuPreviewObserver } from "../probe-webgpu-preview.mjs";

function fixture(options = {}) {
  const waiters = [];
  let clock = 20;
  const queue = {
    onSubmittedWorkDone: () =>
      new Promise((resolve, reject) => waiters.push({ resolve, reject })),
  };
  const canvas = {
    width: 1280,
    height: 720,
    getContext: () => ({ getConfiguration: () => ({ device: { queue } }) }),
  };
  const context = vm.createContext({
    window: {},
    document: { querySelectorAll: () => [canvas] },
    performance: { now: () => clock },
    setTimeout,
    clearTimeout,
  });
  const install = () =>
    vm.runInContext(
      `(${installWebGpuPreviewObserver.toString()})(${JSON.stringify(options)})`,
      context,
    );
  const sample = () =>
    context.window.__rocutPreviewPerf.samples.push({
      time: 120000,
      width: 1280,
      height: 720,
      startedAt: 5,
      durationMs: 15,
      completed: true,
    });
  return {
    context,
    queue,
    waiters,
    install,
    sample,
    tick: (value) => {
      clock = value;
    },
  };
}

test("observes the existing device without replacing queue methods and waits for completion", async () => {
  const f = fixture();
  const original = f.queue.onSubmittedWorkDone;
  const info = f.install();
  assert.equal(info.width, 1280);
  f.sample();
  const probe = f.context.window.__rocutGpuCompletionProbe;
  assert.equal(probe.read().samples.length, 0);
  f.tick(35);
  f.waiters[0].resolve();
  const result = await probe.stop();
  assert.equal(
    result.samples[0].gpuCallbackAt - result.samples[0].startedAt,
    30,
  );
  assert.equal(result.submitted, 1);
  assert.equal(result.pending, 0);
  assert.equal(result.timedOut, false);
  assert.equal(f.queue.onSubmittedWorkDone, original);
  assert.equal(f.context.window.__rocutPreviewPerf, undefined);
  assert.equal(f.context.window.__rocutGpuCompletionProbe, undefined);
});

test("refuses to replace another observer and preserves later ownership", async () => {
  const f = fixture();
  f.install();
  assert.throws(f.install, /already owned/);
  const probe = f.context.window.__rocutGpuCompletionProbe;
  const other = {};
  f.context.window.__rocutPreviewPerf = other;
  assert.equal((await probe.stop()).ownsObserver, false);
  assert.equal(f.context.window.__rocutPreviewPerf, other);
});

test("bounds pending promises and counts rejected GPU completion", async () => {
  const f = fixture({ capacity: 1 });
  f.install();
  f.sample();
  f.sample();
  f.waiters[0].reject(new Error("private device error"));
  const result = await f.context.window.__rocutGpuCompletionProbe.stop();
  assert.equal(result.overflows, 1);
  assert.equal(result.failures, 1);
  assert(!JSON.stringify(result).includes("private"));
});

test("releases globals on timeout", async () => {
  const f = fixture({ capacity: 1, timeoutMs: 20 });
  f.install();
  f.sample();
  const result = await f.context.window.__rocutGpuCompletionProbe.stop();
  assert.equal(result.timedOut, true);
  assert.equal(result.pending, 1);
  assert.equal(f.context.window.__rocutGpuCompletionProbe, undefined);
  f.waiters[0].resolve();
});

test("bounds completed samples until drained", async () => {
  const f = fixture({ capacity: 1 });
  f.install();
  f.sample();
  f.waiters[0].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  f.sample();
  f.waiters[1].resolve();
  const result = await f.context.window.__rocutGpuCompletionProbe.stop();
  assert.equal(result.samples.length, 1);
  assert.equal(result.overflows, 1);
});

test("rejects unsupported backends, ambiguous canvases and invalid bounds", () => {
  for (const change of [
    (f) => {
      f.queue.onSubmittedWorkDone = undefined;
    },
    (f) => {
      f.context.document.querySelectorAll = () => [];
    },
    (f) => {
      f.context.document.querySelectorAll = () => [{}, {}];
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(f.install);
    assert.equal(f.context.window.__rocutPreviewPerf, undefined);
  }
  assert.throws(fixture({ capacity: 0 }).install);
  assert.throws(fixture({ timeoutMs: 60000 }).install);
});

test("counts synchronous queue failures without breaking preview publication", async () => {
  const f = fixture();
  f.queue.onSubmittedWorkDone = () => {
    throw new Error("private device error");
  };
  f.install();
  assert.equal(f.sample(), 1);
  const result = await f.context.window.__rocutGpuCompletionProbe.stop();
  assert.equal(result.failures, 1);
  assert.equal(result.submissions.length, 1);
});
