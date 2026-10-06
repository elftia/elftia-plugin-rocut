import assert from "node:assert/strict";

// Validate persisted editor elements, not worker mocks or derived metadata.
export function validateAsrResult({ elements, sourceDuration }) {
  assert(Number.isFinite(sourceDuration) && sourceDuration > 0);
  assert(elements.length > 0, "No persisted ASR captions");
  const captions = elements.map(({ params, startTime, duration }) => {
    assert.equal(
      typeof params?.content,
      "string",
      "Missing persisted caption text",
    );
    assert(Number.isFinite(startTime) && startTime >= 0);
    assert(Number.isFinite(duration) && duration > 0);
    assert(
      startTime + duration <= sourceDuration + 12000,
      `Caption end ${startTime + duration} exceeds source ${sourceDuration}`,
    );
    return { content: params.content, startTime, duration };
  });
  const text = captions
    .map((item) => item.content)
    .join(" ")
    .toLowerCase();
  for (const keyword of ["blue", "bicycle", "garden", "caption", "test"])
    assert(text.includes(keyword), `Missing recognized word: ${keyword}`);
  return captions;
}
