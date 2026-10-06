export async function collectWebGpuObservation(frame, evidence, stop = false) {
  const result = await frame.evaluate((stop) => {
    const probe = window.__rocutGpuCompletionProbe;
    if (!probe) throw new Error("GPU observer disappeared");
    return stop ? probe.stop() : probe.read();
  }, stop);
  evidence.samples.push(...result.samples);
  evidence.submissions.push(...result.submissions);
  const { samples, submissions, ...status } = result;
  evidence.status = status;
}

// Serialized into the owned editor frame. Uses the runtime's existing opt-in
// preview observer, not patched rendering/queue methods or a different device.
export function installWebGpuPreviewObserver({
  capacity = 512,
  timeoutMs = 5000,
} = {}) {
  if (window.__rocutPreviewPerf || window.__rocutGpuCompletionProbe)
    throw new Error("Preview observer already owned");
  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 4096 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 30000
  )
    throw new Error("Invalid observer bounds");
  const canvases = [...document.querySelectorAll("canvas")];
  if (canvases.length !== 1)
    throw new Error("Require one unambiguous preview canvas");
  const canvas = canvases[0];
  const context = canvas.getContext("webgpu");
  const config = context?.getConfiguration?.();
  const queue = config?.device?.queue;
  if (!queue || typeof queue.onSubmittedWorkDone !== "function")
    throw new Error("Configured WebGPU completion signal unavailable");
  const pending = new Set();
  const completed = [];
  let closed = false,
    overflows = 0,
    failures = 0,
    submitted = 0;
  const observer = { samples: [], droppedSamples: 0 };
  Object.defineProperty(observer.samples, "push", {
    value(...samples) {
      const length = Array.prototype.push.apply(this, samples);
      for (const sample of samples) {
        if (closed) continue;
        submitted++;
        if (!sample.completed) {
          failures++;
          continue;
        }
        if (pending.size >= capacity) {
          overflows++;
          continue;
        }
        const { time, width, height, startedAt, durationMs } = sample;
        const submittedAt = performance.now();
        let done;
        try {
          done = queue.onSubmittedWorkDone();
        } catch {
          failures++;
          continue;
        }
        const task = Promise.resolve(done)
          .then(
            () => {
              if (closed) return;
              if (completed.length >= capacity) {
                overflows++;
                return;
              }
              completed.push({
                time,
                width,
                height,
                startedAt,
                durationMs,
                submittedAt,
                gpuCallbackAt: performance.now(),
              });
            },
            () => {
              if (!closed) failures++;
            },
          )
          .finally(() => pending.delete(task));
        pending.add(task);
      }
      return length;
    },
  });
  const read = () => ({
    samples: completed.splice(0),
    submissions: observer.samples.splice(0),
    pending: pending.size,
    submitted,
    overflows,
    failures,
    submissionOverflows: observer.droppedSamples,
  });
  let stopPromise;
  const probe = {
    read,
    stop() {
      stopPromise ??= (async () => {
        const ownsObserver = window.__rocutPreviewPerf === observer;
        if (ownsObserver) delete window.__rocutPreviewPerf;
        let timer;
        let timedOut = false;
        try {
          await Promise.race([
            Promise.all([...pending]),
            new Promise((resolve) => {
              timer = setTimeout(() => {
                timedOut = true;
                resolve();
              }, timeoutMs);
            }),
          ]);
          return { ...read(), timedOut, ownsObserver };
        } finally {
          clearTimeout(timer);
          closed = true;
          if (window.__rocutGpuCompletionProbe === probe)
            delete window.__rocutGpuCompletionProbe;
        }
      })();
      return stopPromise;
    },
  };
  window.__rocutPreviewPerf = observer;
  window.__rocutGpuCompletionProbe = probe;
  return {
    width: canvas.width,
    height: canvas.height,
    measurement:
      "Preview start to WebGPU queue-completion callback; includes callback delivery, NOT display presentation",
  };
}
