import assert from "node:assert/strict";
import test from "node:test";
import { validateAsrResult } from "../probe-asr-result.mjs";

const valid = () => ({
  elements: [
    {
      params: {
        content:
          "The blue bicycle is beside the small garden. This is a caption test.",
      },
      startTime: 0,
      duration: 576000,
    },
  ],
  sourceDuration: 644000,
});

test("reads actual persisted params.content and uses independent audio bounds", () => {
  const fixture = valid();
  const result = validateAsrResult(fixture);
  assert.equal(result[0].content, fixture.elements[0].params.content);
  assert.equal(result[0].duration, 576000);
});

test("rejects missing, misplaced or unrelated recognized text", () => {
  assert.throws(() => validateAsrResult({ ...valid(), elements: [] }));
  for (const element of [
    {
      content: valid().elements[0].params.content,
      startTime: 0,
      duration: 100,
    },
    { params: { content: "unrelated speech" }, startTime: 0, duration: 100 },
  ])
    assert.throws(() => validateAsrResult({ ...valid(), elements: [element] }));
});

test("rejects invalid and out-of-source times without relaxing the 0.1-second bound", () => {
  for (const times of [
    { startTime: -1 },
    { startTime: NaN },
    { duration: 0 },
    { duration: Infinity },
    { duration: 656001 },
  ])
    assert.throws(() =>
      validateAsrResult({
        ...valid(),
        elements: [{ ...valid().elements[0], ...times }],
      }),
    );
  assert.throws(() => validateAsrResult({ ...valid(), sourceDuration: 0 }));
});
