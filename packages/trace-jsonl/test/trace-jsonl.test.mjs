import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentHarness, defineAgent } from "../../core/dist/index.js";
import {
  JsonlRunTrace,
  JsonlRunTraceCorruptError,
} from "../dist/index.js";

async function withTempDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "axiom-agent-trace-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("records and reloads ordered events", async () => {
  await withTempDirectory(async (directory) => {
    const trace = new JsonlRunTrace({ directory, runId: "ordered" });
    await Promise.all([
      trace.record({ type: "run_start", sessionId: "session" }),
      trace.record({ type: "turn_start", turn: 1 }),
      trace.record({
        type: "message_end",
        message: { role: "user", content: "hello" },
      }),
    ]);

    const reloaded = new JsonlRunTrace({ directory, runId: "ordered" });
    const records = await reloaded.records();
    assert.deepEqual(records.map((record) => record.sequence), [0, 1, 2]);
    assert.deepEqual(records.map((record) => record.event.type), [
      "run_start",
      "turn_start",
      "message_end",
    ]);
  });
});

test("serializes Error details from run_error", async () => {
  await withTempDirectory(async (directory) => {
    const trace = new JsonlRunTrace({ directory, runId: "error" });
    await trace.record({
      type: "run_error",
      sessionId: "session",
      error: new TypeError("broken"),
    });
    const [record] = await trace.records();
    assert.equal(record.event.error.name, "TypeError");
    assert.equal(record.event.error.message, "broken");
  });
});

test("repairs an interrupted tail before appending", async () => {
  await withTempDirectory(async (directory) => {
    const first = new JsonlRunTrace({ directory, runId: "repair" });
    await first.record({ type: "run_start", sessionId: "session" });
    await appendFile(first.filePath(), '{"version":1', "utf8");

    const resumed = new JsonlRunTrace({ directory, runId: "repair" });
    await resumed.record({ type: "turn_start", turn: 1 });
    assert.deepEqual((await resumed.records()).map((record) => record.sequence), [0, 1]);
  });
});

test("rejects corrupt committed trace records", async () => {
  await withTempDirectory(async (directory) => {
    const trace = new JsonlRunTrace({ directory, runId: "corrupt" });
    await trace.record({ type: "run_start", sessionId: "session" });
    await appendFile(trace.filePath(), "not-json\n", "utf8");
    await assert.rejects(trace.records(), JsonlRunTraceCorruptError);
  });
});

test("captures a complete harness lifecycle without entering model context", async () => {
  await withTempDirectory(async (directory) => {
    const model = {
      id: "trace-model",
      async *stream() {
        yield { type: "text_delta", delta: "done" };
        yield { type: "done", stopReason: "stop" };
      },
    };
    const harness = new AgentHarness({
      agent: defineAgent({ systemPrompt: "Trace.", model, tools: [] }),
    });
    const trace = new JsonlRunTrace({ directory, runId: "lifecycle" });
    for await (const event of harness.run("go")) await trace.record(event);

    const eventTypes = (await trace.records()).map((record) => record.event.type);
    assert.deepEqual(eventTypes, [
      "run_start",
      "message_start",
      "message_end",
      "turn_start",
      "message_start",
      "message_update",
      "message_end",
      "turn_end",
      "run_end",
    ]);
  });
});
