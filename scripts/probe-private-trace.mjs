import assert from "node:assert/strict";

export async function startPrivateTrace(
  cdp,
  categories,
  { timeoutMs = 30000, maxBytes = 32 * 1024 * 1024 } = {},
) {
  let complete;
  const completion = new Promise((resolve) => {
    complete = resolve;
  });
  cdp.once("Tracing.tracingComplete", complete);
  const bounded = async (operation, ms = timeoutMs) => {
    let timer;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Private trace operation timed out")),
            Math.max(1, ms),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await bounded(
      cdp.send("Tracing.start", {
        traceConfig: {
          includedCategories: categories,
          excludedCategories: ["*"],
          recordMode: "recordUntilFull",
          traceBufferSizeInKb: 16384,
        },
        transferMode: "ReturnAsStream",
      }),
    );
  } catch (error) {
    cdp.off("Tracing.tracingComplete", complete);
    throw error;
  }
  let stopped;
  return () => {
    stopped ??= (async () => {
      let stream;
      const deadline = Date.now() + timeoutMs;
      const remaining = (operation) =>
        bounded(operation, deadline - Date.now());
      try {
        await remaining(cdp.send("Tracing.end"));
        const result = await remaining(completion);
        stream = result.stream;
        assert(stream, "Missing trace stream");
        assert(!result.dataLossOccurred, "Trace lost data");
        const chunks = [];
        let bytes = 0;
        for (;;) {
          const chunk = await remaining(
            cdp.send("IO.read", { handle: stream, size: 1048576 }),
          );
          const data = Buffer.from(
            chunk.data,
            chunk.base64Encoded ? "base64" : "utf8",
          );
          bytes += data.length;
          assert(
            bytes <= maxBytes,
            "Trace exceeds private diagnostic size cap",
          );
          chunks.push(data);
          if (chunk.eof) return Buffer.concat(chunks);
        }
      } finally {
        cdp.off("Tracing.tracingComplete", complete);
        if (stream) await bounded(cdp.send("IO.close", { handle: stream }));
      }
    })();
    return stopped;
  };
}
