import { AgentHarness, defineAgent } from "@axiom-agent/core";

const calculator = {
  definition: {
    name: "calculator",
    description: "Adds two numbers.",
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

const fakeModel = {
  id: "scripted-demo-model",
  async *stream(request) {
    const result = request.messages.findLast((message) => message.role === "tool");
    if (!result) {
      yield {
        type: "tool_call",
        call: {
          id: "calculator-call-1",
          name: "calculator",
          arguments: { left: 2, right: 12 },
        },
      };
      yield { type: "done", stopReason: "tool_use" };
      return;
    }
    yield { type: "text_delta", delta: `The answer is ${result.content}.` };
    yield { type: "done", stopReason: "stop" };
  },
};

const agent = defineAgent({
  name: "calculator-agent",
  systemPrompt: "Use the calculator whenever arithmetic is required.",
  model: fakeModel,
  tools: [calculator],
});

const harness = new AgentHarness({ agent });

for await (const event of harness.run("What is 2 + 12?")) {
  if (event.type === "tool_execution_start") {
    console.log(`tool -> ${event.call.name}`, event.call.arguments);
  }
  if (event.type === "tool_execution_end") {
    console.log(`observation -> ${event.result.content}`);
  }
  if (event.type === "message_update") {
    process.stdout.write(event.delta);
  }
  if (event.type === "run_end") {
    process.stdout.write("\n");
  }
}
