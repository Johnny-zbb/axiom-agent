import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentHarness,
  DuplicateToolError,
  MaxTurnsExceededError,
  Session,
  ToolRegistry,
  defineAgent,
} from "../dist/index.js";

function createCalculatorTool() {
  return {
    definition: {
      name: "calculator",
      description: "Add two numbers.",
      inputSchema: {
        type: "object",
        properties: {
          left: { type: "number" },
          right: { type: "number" },
        },
        required: ["left", "right"],
      },
    },
    validate(input) {
      const valid =
        typeof input === "object" &&
        input !== null &&
        typeof input.left === "number" &&
        typeof input.right === "number";
      return valid ? { valid: true } : { valid: false, error: "left and right must be numbers" };
    },
    async execute(input) {
      return { content: String(input.left + input.right) };
    },
  };
}

function scriptedCalculatorModel() {
  return {
    id: "fake-calculator-model",
    async *stream(request) {
      const toolResult = request.messages.findLast((message) => message.role === "tool");
      if (!toolResult) {
        yield {
          type: "tool_call",
          call: { id: "call-1", name: "calculator", arguments: { left: 2, right: 12 } },
        };
        yield { type: "done", stopReason: "tool_use" };
        return;
      }
      yield { type: "text_delta", delta: `答案是 ${toolResult.content}。` };
      yield { type: "done", stopReason: "stop" };
    },
  };
}

test("runs model -> tool -> observation -> final response", async () => {
  const session = new Session({ id: "calculator-test" });
  const harness = new AgentHarness({
    agent: defineAgent({
      systemPrompt: "Use the calculator for arithmetic.",
      model: scriptedCalculatorModel(),
      tools: [createCalculatorTool()],
    }),
    session,
  });

  const events = [];
  for await (const event of harness.run("2 + 12 等于多少？")) events.push(event);

  assert.deepEqual(events.map((event) => event.type), [
    "run_start",
    "message_start",
    "message_end",
    "turn_start",
    "message_start",
    "message_end",
    "tool_execution_start",
    "tool_execution_end",
    "message_start",
    "message_end",
    "turn_end",
    "turn_start",
    "message_start",
    "message_update",
    "message_end",
    "turn_end",
    "run_end",
  ]);

  const messages = await session.messages();
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "tool", "assistant"]);
  assert.equal(messages[2].content, "14");
  assert.equal(messages[3].content, "答案是 14。");
});

test("turns tool exceptions into model-visible error results", async () => {
  const registry = new ToolRegistry([
    {
      definition: { name: "explode", description: "Fails", inputSchema: {} },
      validate: () => ({ valid: true }),
      execute: async () => {
        throw new Error("boom");
      },
    },
  ]);

  const result = await registry.execute(
    { id: "call-error", name: "explode", arguments: {} },
    { sessionId: "test" },
  );
  assert.equal(result.isError, true);
  assert.equal(result.content, "boom");
});

test("propagates cancellation instead of returning it as a tool error", async () => {
  const controller = new AbortController();
  const registry = new ToolRegistry([
    {
      definition: { name: "wait", description: "Waits", inputSchema: {} },
      validate: () => ({ valid: true }),
      execute: async () => {
        controller.abort(new Error("cancelled"));
        throw controller.signal.reason;
      },
    },
  ]);

  await assert.rejects(
    registry.execute(
      { id: "call-cancel", name: "wait", arguments: {} },
      { sessionId: "test", signal: controller.signal },
    ),
    /cancelled/,
  );
});

test("rejects duplicate tool names", () => {
  const calculator = createCalculatorTool();
  assert.throws(() => new ToolRegistry([calculator, calculator]), DuplicateToolError);
});

test("returns a defensive session snapshot", async () => {
  const session = new Session({ id: "snapshot-test" });
  await session.append({ role: "user", content: "original" });
  const snapshot = await session.messages();
  snapshot.push({ role: "user", content: "mutated copy" });
  assert.equal((await session.messages()).length, 1);
});

test("stops an unbounded tool loop at maxTurns", async () => {
  const loopingModel = {
    id: "looping-model",
    async *stream() {
      yield { type: "tool_call", call: { id: "loop", name: "calculator", arguments: { left: 1, right: 1 } } };
      yield { type: "done", stopReason: "tool_use" };
    },
  };
  const harness = new AgentHarness({
    agent: defineAgent({ systemPrompt: "Loop", model: loopingModel, tools: [createCalculatorTool()] }),
    maxTurns: 2,
  });

  const events = [];
  await assert.rejects(async () => {
    for await (const event of harness.run("loop")) events.push(event);
  }, MaxTurnsExceededError);
  assert.equal(events.at(-1).type, "run_error");
});
