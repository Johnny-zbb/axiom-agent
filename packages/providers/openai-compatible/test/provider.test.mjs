import assert from "node:assert/strict";
import test from "node:test";

import {
  ChatCompletionsHttpError,
  OpenAICompatibleChatModel,
} from "../dist/index.js";
import { AgentHarness, defineAgent } from "../../../core/dist/index.js";

function sseResponse(events, chunkSize = Number.POSITIVE_INFINITY) {
  const encoded = new TextEncoder().encode(
    `${events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < encoded.length; offset += chunkSize) {
          controller.enqueue(encoded.slice(offset, offset + chunkSize));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

test("maps messages, tools, and text streaming", async () => {
  let captured;
  const model = new OpenAICompatibleChatModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1/",
    model: "test-model",
    fetch: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return sseResponse([
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: "!" }, finish_reason: "stop" }] },
      ], 7);
    },
  });

  const events = [];
  for await (const event of model.stream({
    systemPrompt: "Be useful.",
    messages: [{ role: "user", content: "Hi" }],
    tools: [{ name: "calculator", description: "Adds", inputSchema: { type: "object" } }],
  })) events.push(event);

  assert.equal(captured.url, "https://example.test/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer test-key");
  assert.deepEqual(captured.body.messages, [
    { role: "system", content: "Be useful." },
    { role: "user", content: "Hi" },
  ]);
  assert.equal(captured.body.tools[0].function.name, "calculator");
  assert.equal(captured.body.tool_choice, "auto");
  assert.equal(captured.body.stream, true);
  assert.deepEqual(events, [
    { type: "text_delta", delta: "Hello" },
    { type: "text_delta", delta: "!" },
    { type: "done", stopReason: "stop" },
  ]);
});

test("assembles fragmented tool calls and serializes tool observations", async () => {
  let body;
  const model = new OpenAICompatibleChatModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return sseResponse([
        {
          choices: [{
            delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "calculator", arguments: "{\"left\":" } }] },
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: { tool_calls: [{ index: 0, function: { arguments: "2,\"right\":12}" } }] },
            finish_reason: "tool_calls",
          }],
        },
      ], 3);
    },
  });

  const events = [];
  for await (const event of model.stream({
    systemPrompt: "",
    messages: [
      { role: "assistant", content: "", toolCalls: [{ id: "old", name: "calculator", arguments: { left: 1, right: 1 } }] },
      { role: "tool", toolCallId: "old", toolName: "calculator", content: "2", isError: false },
    ],
    tools: [],
  })) events.push(event);

  assert.deepEqual(body.messages, [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "old", type: "function", function: { name: "calculator", arguments: "{\"left\":1,\"right\":1}" } }],
    },
    { role: "tool", content: "2", tool_call_id: "old" },
  ]);
  assert.deepEqual(events, [
    { type: "tool_call", call: { id: "call-1", name: "calculator", arguments: { left: 2, right: 12 } } },
    { type: "done", stopReason: "tool_use" },
  ]);
});

test("surfaces HTTP status, body, and trace id", async () => {
  const model = new OpenAICompatibleChatModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetch: async () => new Response('{"error":"denied"}', {
      status: 401,
      statusText: "Unauthorized",
      headers: { "x-trace-id": "trace-123" },
    }),
  });

  await assert.rejects(
    async () => {
      for await (const _event of model.stream({ systemPrompt: "", messages: [], tools: [] })) {
        // consume
      }
    },
    (error) => {
      assert.ok(error instanceof ChatCompletionsHttpError);
      assert.equal(error.status, 401);
      assert.equal(error.responseBody, '{"error":"denied"}');
      assert.equal(error.traceId, "trace-123");
      return true;
    },
  );
});

test("runs the complete harness -> provider -> tool -> provider loop", async () => {
  let requestCount = 0;
  const model = new OpenAICompatibleChatModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetch: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return sseResponse([
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "calc-1",
                  function: { name: "calculator", arguments: '{"left":27,"right":15}' },
                }],
              },
              finish_reason: "tool_calls",
            }],
          },
        ]);
      }
      return sseResponse([
        { choices: [{ delta: { content: "42" }, finish_reason: "stop" }] },
      ]);
    },
  });
  const calculator = {
    definition: { name: "calculator", description: "Adds", inputSchema: {} },
    validate: () => ({ valid: true }),
    execute: async ({ left, right }) => ({ content: String(left + right) }),
  };
  const harness = new AgentHarness({
    agent: defineAgent({ systemPrompt: "Use tools.", model, tools: [calculator] }),
  });

  const events = [];
  for await (const event of harness.run("27 + 15")) events.push(event);

  assert.equal(requestCount, 2);
  assert.equal(events.find((event) => event.type === "tool_execution_end").result.content, "42");
  assert.equal(events.at(-1).finalMessage.content, "42");
});
