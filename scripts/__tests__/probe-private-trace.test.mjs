import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { startPrivateTrace } from "../probe-private-trace.mjs";

class Session extends EventEmitter {
  calls = [];
  loss = false;
  noCompletion = false;
  hangingRead = false;
  async send(name, params) {
    this.calls.push({ name, params });
    if (name === "Tracing.end" && !this.noCompletion)
      this.emit("Tracing.tracingComplete", {
        stream: "owned",
        dataLossOccurred: this.loss,
      });
    if (name === "IO.read") {
      if (this.hangingRead) return new Promise(() => {});
      return {
        data: Buffer.from("{}").toString("base64"),
        base64Encoded: true,
        eof: true,
      };
    }
    return {};
  }
}

test("bounded collector stops once, decodes bytes and closes stream", async () => {
  const cdp = new Session();
  const stop = await startPrivateTrace(cdp, ["blink.user_timing"]);
  assert.equal((await stop()).toString(), "{}");
  await stop();
  assert.equal(
    cdp.calls.filter((call) => call.name === "Tracing.end").length,
    1,
  );
  assert.equal(cdp.calls.filter((call) => call.name === "IO.close").length, 1);
  assert.equal(cdp.listenerCount("Tracing.tracingComplete"), 0);
});

test("loss and oversize evidence fail closed but still close streams", async () => {
  for (const mode of ["loss", "oversize"]) {
    const cdp = new Session();
    cdp.loss = mode === "loss";
    const stop = await startPrivateTrace(cdp, [], {
      maxBytes: mode === "oversize" ? 1 : 32,
    });
    await assert.rejects(stop());
    assert(cdp.calls.some((call) => call.name === "IO.close"));
  }
});

test("missing completion and stuck reads time out with listener cleanup", async () => {
  for (const property of ["noCompletion", "hangingRead"]) {
    const cdp = new Session();
    cdp[property] = true;
    const stop = await startPrivateTrace(cdp, [], { timeoutMs: 20 });
    await assert.rejects(stop(), /timed out/);
    assert.equal(cdp.listenerCount("Tracing.tracingComplete"), 0);
    if (property === "hangingRead")
      assert(cdp.calls.some((call) => call.name === "IO.close"));
  }
});
