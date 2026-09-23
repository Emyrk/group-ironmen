import { describe, expect, it } from "vitest";
import { createWorkerCalculatorTransport } from "../../src/pvm/calculator-client";

class FakeWorker {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.messages = [];
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
  }
}

describe("worker calculator transport", () => {
  it("posts requests and resolves matching responses", async () => {
    const transport = createWorkerCalculatorTransport("/calculator-worker.js", FakeWorker);
    const worker = FakeWorker.instances.at(-1);
    const response = transport({ version: 1, requestId: 12 });

    expect(worker.url).toBe("/calculator-worker.js");
    expect(worker.messages).toEqual([{ version: 1, requestId: 12 }]);

    worker.onmessage({ data: { version: 1, requestId: 12, result: { dps: 4.2 } } });
    await expect(response).resolves.toEqual({ version: 1, requestId: 12, result: { dps: 4.2 } });
  });

  it("routes out-of-order responses by request ID", async () => {
    const transport = createWorkerCalculatorTransport(undefined, FakeWorker);
    const worker = FakeWorker.instances.at(-1);
    const first = transport({ version: 1, requestId: 1 });
    const second = transport({ version: 1, requestId: 2 });

    worker.onmessage({ data: { version: 1, requestId: 2, result: { dps: 2 } } });
    worker.onmessage({ data: { version: 1, requestId: 1, result: { dps: 1 } } });

    await expect(first).resolves.toMatchObject({ requestId: 1 });
    await expect(second).resolves.toMatchObject({ requestId: 2 });
  });

  it("rejects pending requests when the worker fails", async () => {
    const transport = createWorkerCalculatorTransport(undefined, FakeWorker);
    const worker = FakeWorker.instances.at(-1);
    const response = transport({ version: 1, requestId: 3 });

    worker.onerror({ message: "worker exploded" });
    await expect(response).rejects.toThrow("worker exploded");
  });
});
