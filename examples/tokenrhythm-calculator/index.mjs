import { AgentHarness, Session, defineAgent } from "@axiom-agent/core";
import { OpenAICompatibleChatModel } from "@axiom-agent/openai-compatible";
import { JsonlSessionStore } from "@axiom-agent/session-jsonl";

const apiKey = process.env.TOKENRHYTHM_API_KEY;
if (!apiKey) {
  throw new Error("Set TOKENRHYTHM_API_KEY before running this example.");
}

const calculator = {
  definition: {
    name: "calculator",
    description: "Add two numbers. Use this tool instead of calculating mentally.",
    inputSchema: {
      type: "object",
      properties: {
        left: { type: "number" },
        right: { type: "number" },
      },
      required: ["left", "right"],
      additionalProperties: false,
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

const model = new OpenAICompatibleChatModel({
  apiKey,
  baseUrl: process.env.TOKENRHYTHM_BASE_URL ?? "https://tokenrhythm.studio/v1",
  model: process.env.TOKENRHYTHM_MODEL ?? "deepseek-v4-flash",
});

const agent = defineAgent({
  name: "tokenrhythm-calculator",
  systemPrompt: "You are a concise assistant. Always use the calculator for arithmetic.",
  model,
  tools: [calculator],
});

const sessionId = process.env.AXIOM_SESSION_ID ?? "tokenrhythm-calculator";
const session = new Session({
  id: sessionId,
  store: new JsonlSessionStore({
    directory: process.env.AXIOM_SESSION_DIR ?? ".axiom-agent/sessions",
  }),
});
const harness = new AgentHarness({ agent, session });
console.log(`session -> ${session.id}`);
for await (const event of harness.run("What is 27 + 15?")) {
  if (event.type === "tool_execution_start") {
    console.log(`tool -> ${event.call.name}`, event.call.arguments);
  } else if (event.type === "tool_execution_end") {
    console.log(`observation -> ${event.result.content}`);
  } else if (event.type === "message_update") {
    process.stdout.write(event.delta);
  } else if (event.type === "run_end") {
    process.stdout.write("\n");
  }
}
