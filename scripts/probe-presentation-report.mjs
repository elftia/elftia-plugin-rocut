import assert from "node:assert/strict";

const states = new Set([
  "STATE_PRESENTED_ALL",
  "STATE_PRESENTED_PARTIAL",
  "STATE_DROPPED",
  "STATE_NO_UPDATE_DESIRED",
]);
const distribution = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
};

// Chromium 144 cc/metrics/compositor_frame_reporter.cc: PipelineReporter
// begins at BeginFrameArgs.frame_time and ends at frame_termination_time_.
// This is NOT a preview-canvas-specific submit-to-presentation measurement.
export function summarizePresentation(trace, markers) {
  assert(Array.isArray(trace.traceEvents), "Missing trace events");
  const events = trace.traceEvents;
  const mark = (name) => {
    assert.match(name, /^rocut-trace-[a-z0-9-]+$/);
    const found = events.filter(
      (event) => event.name === name && event.cat === "blink.user_timing",
    );
    assert.equal(found.length, 1, "Missing or ambiguous attribution marker");
    const event = found[0];
    assert(Number.isSafeInteger(event.pid) && Number.isFinite(event.ts));
    return event;
  };
  const start = mark(markers.start);
  const end = mark(markers.end);
  const host = mark(markers.host);
  assert.equal(start.pid, end.pid, "Editor process changed during capture");
  assert.notEqual(start.pid, host.pid, "Editor is not process-isolated");
  assert(end.ts > start.ts, "Invalid capture window");
  const pending = new Map();
  const layers = new Map();
  let boundaryEvents = 0;
  const key = (event) => {
    // Do not use numeric surface_frame_trace_id/display_trace_id: JSON loses
    // their int64 precision. Local async IDs are exact strings scoped by PID.
    assert.match(event.id2?.local ?? "", /^0x[0-9a-f]+$/i);
    return `${event.pid}:${event.scope ?? ""}:${event.id2.local}`;
  };
  for (const event of events) {
    if (event.name !== "PipelineReporter" || event.pid !== start.pid) continue;
    assert(Number.isFinite(event.ts), "Invalid reporter timestamp");
    const id = key(event);
    if (event.ph === "b") {
      assert(!pending.has(id), "Overlapping reporter IDs");
      pending.set(id, event);
      continue;
    }
    assert.equal(event.ph, "e", "Unsupported reporter phase");
    const begin = pending.get(id);
    if (!begin) {
      assert(event.ts < start.ts, "Unpaired reporter inside capture window");
      boundaryEvents++;
      continue;
    }
    pending.delete(id);
    assert(event.ts >= begin.ts, "Reporter ends before start");
    if (begin.ts < start.ts || event.ts > end.ts) {
      boundaryEvents++;
      continue;
    }
    const info = begin.args?.frame_reporter;
    assert(states.has(info?.state), "Unknown presentation state");
    assert(Number.isSafeInteger(info.layer_tree_host_id), "Invalid layer ID");
    const row = layers.get(info.layer_tree_host_id) ?? {
      states: Object.fromEntries([...states].map((state) => [state, 0])),
      durations: [],
      presentations: [],
    };
    row.states[info.state]++;
    if (info.state === "STATE_PRESENTED_ALL") {
      row.durations.push((event.ts - begin.ts) / 1000);
      row.presentations.push(event.ts);
    }
    layers.set(info.layer_tree_host_id, row);
  }
  for (const begin of pending.values()) {
    assert(begin.ts > end.ts, "Incomplete reporter inside capture window");
    boundaryEvents++;
  }
  assert(layers.size, "No attributed compositor reports");
  return {
    acceptanceEligible: false,
    scope: "Isolated editor compositor; not exclusive preview canvas frames",
    editorPid: start.pid,
    hostPid: host.pid,
    windowMs: (end.ts - start.ts) / 1000,
    boundaryEvents,
    layers: [...layers].map(([layerTreeHostId, row]) => {
      const times = [...new Set(row.presentations)].sort((a, b) => a - b);
      return {
        layerTreeHostId,
        states: row.states,
        fullyPresentedBeginFrameToTermination: distribution(row.durations),
        uniqueFullPresentationTimes: times.length,
        fullPresentationIntervals: distribution(
          times.slice(1).map((time, index) => (time - times[index]) / 1000),
        ),
      };
    }),
  };
}
