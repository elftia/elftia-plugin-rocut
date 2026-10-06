import assert from "node:assert/strict";
import test from "node:test";
import { summarizePresentation } from "../probe-presentation-report.mjs";

const markers = {
  start: "rocut-trace-start",
  end: "rocut-trace-end",
  host: "rocut-trace-host",
};
const marker = (name, pid, ts) => ({
  name,
  pid,
  ts,
  cat: "blink.user_timing",
});
const pair = (pid, ts, state, duration = 10000) => [
  {
    name: "PipelineReporter",
    pid,
    ts,
    ph: "b",
    id2: { local: "0x1" },
    args: {
      frame_reporter: {
        state,
        layer_tree_host_id: 7,
        surface_frame_trace_id: 9999999999999999999,
      },
      secret: "https://private.invalid/?token=secret",
    },
  },
  {
    name: "PipelineReporter",
    pid,
    ts: ts + duration,
    ph: "e",
    id2: { local: "0x1" },
  },
];
const fixture = () => ({
  traceEvents: [
    marker(markers.host, 1, 500),
    marker(markers.start, 2, 1000),
    ...pair(1, 2000, "STATE_PRESENTED_ALL", 999999),
    ...pair(2, 2000, "STATE_PRESENTED_ALL"),
    ...pair(2, 22000, "STATE_DROPPED"),
    ...pair(2, 42000, "STATE_PRESENTED_PARTIAL"),
    ...pair(2, 62000, "STATE_NO_UPDATE_DESIRED"),
    ...pair(2, 82000, "STATE_PRESENTED_ALL", 15000),
    marker(markers.end, 2, 100000),
  ],
});

test("isolates editor reports, reuses exact async IDs, and never claims preview acceptance", () => {
  const result = summarizePresentation(fixture(), markers);
  assert.equal(result.acceptanceEligible, false);
  assert.equal(result.editorPid, 2);
  const row = result.layers[0];
  assert.equal(row.states.STATE_DROPPED, 1);
  assert.equal(row.states.STATE_PRESENTED_PARTIAL, 1);
  assert.deepEqual(row.fullyPresentedBeginFrameToTermination, {
    count: 2,
    p95Ms: 15,
    maxMs: 15,
  });
  assert.deepEqual(row.fullPresentationIntervals, {
    count: 1,
    p95Ms: 85,
    maxMs: 85,
  });
  assert(!JSON.stringify(result).includes("secret"));
  assert(!JSON.stringify(result).includes("surface_frame_trace_id"));
});

test("rejects missing, duplicate, shared-process and navigated attribution", () => {
  for (const change of [
    (events) => events.shift(),
    (events) => events.push(marker(markers.start, 2, 1000)),
    (events) => {
      events[0].pid = 2;
    },
    (events) => {
      events.at(-1).pid = 3;
    },
  ]) {
    const input = fixture();
    change(input.traceEvents);
    assert.throws(() => summarizePresentation(input, markers));
  }
});

test("rejects corrupted pairing, timestamps, states and IDs", () => {
  for (const change of [
    (events) => events.splice(5, 1),
    (events) => {
      events[5].ts = 0;
    },
    (events) => {
      events[4].args.frame_reporter.state = "UNKNOWN";
    },
    (events) => {
      events[4].id2.local = 9007199254740992;
    },
    (events) => events.splice(5, 0, structuredClone(events[4])),
  ]) {
    const input = fixture();
    change(input.traceEvents);
    assert.throws(() => summarizePresentation(input, markers));
  }
});

test("keeps separate layer trees and excludes capture-boundary reports", () => {
  const input = fixture();
  const extra = pair(2, 98000, "STATE_PRESENTED_ALL", 10000);
  input.traceEvents.push(...extra);
  input.traceEvents[12].args.frame_reporter.layer_tree_host_id = 8;
  const result = summarizePresentation(input, markers);
  assert.equal(result.layers.length, 2);
  assert.equal(result.boundaryEvents, 1);
  assert.equal(result.layers[0].fullPresentationIntervals, null);
});
