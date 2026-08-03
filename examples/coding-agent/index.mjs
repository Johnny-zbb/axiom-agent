import { resolve } from "node:path";

import { createCodingAgent } from "@axiom-agent/coding-agent";
import { AgentHarness, Session } from "@axiom-agent/core";
import { OpenAICompatibleChatModel } from "@axiom-agent/openai-compatible";
import { JsonlSessionStore } from "@axiom-agent/session-jsonl";
import { JsonlRunTrace } from "@axiom-agent/trace-jsonl";

const apiKey = process.env.TOKENRHYTHM_API_KEY;
if (!apiKey) throw new Error("Set TOKENRHYTHM_API_KEY before running this example.");

const workspace = resolve(process.argv[2] ?? "");
const task = process.argv.slice(3).join(" ");
if (!process.argv[2] || !task) {
  throw new Error("Usage: node index.mjs <workspace> <task>");
}

const model = new OpenAICompatibleChatModel({
  apiKey,
  baseUrl: process.env.TOKENRHYTHM_BASE_URL ?? "https://tokenrhythm.studio/v1",
  model: process.env.TOKENRHYTHM_MODEL ?? "deepseek-v4-flash",
});
const agent = await createCodingAgent({
  workspace,
  allowedCommands: [process.execPath],
  model,
});
const session = new Session({
  id: process.env.AXIOM_SESSION_ID ?? "coding-agent-demo",
  store: new JsonlSessionStore({
    directory: process.env.AXIOM_SESSION_DIR ?? ".axiom-agent/coding-sessions",
  }),
});
const harness = new AgentHarness({ agent, session, maxTurns: 20 });
const trace = new JsonlRunTrace({
  directory: process.env.AXIOM_TRACE_DIR ?? ".axiom-agent/traces",
});

console.log(`session -> ${session.id}`);
console.log(`workspace -> ${workspace}`);
console.log(`trace -> ${trace.runId}`);
for await (const event of harness.run(task)) {
  await trace.record(event);
  switch (event.type) {
    case "turn_start":
      console.log(`\nturn -> ${event.turn}`);
      break;
    case "tool_execution_start":
      console.log(`tool -> ${event.call.name}`, event.call.arguments);
      break;
    case "tool_execution_end":
      console.log(`observation -> ${event.result.content}`);
      break;
    case "message_update":
      process.stdout.write(event.delta);
      break;
    case "run_end":
      process.stdout.write("\n");
      break;
    case "run_error":
      console.error(`run error -> ${event.error.message}`);
      break;
  }
}
