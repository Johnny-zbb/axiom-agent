import { AgentHarness, Session, defineAgent } from "@axiom-agent/core";
import { JsonlSessionStore } from "@axiom-agent/session-jsonl";

const sessionId = process.argv[2] ?? "resumable-demo";
const input = process.argv[3] ?? "hello";
const directory = process.env.AXIOM_SESSION_DIR ?? ".axiom-agent/sessions";

const session = new Session({
  id: sessionId,
  store: new JsonlSessionStore({ directory }),
});
const restoredMessages = await session.messages();

const model = {
  id: "offline-resume-demo",
  async *stream(request) {
    const userMessages = request.messages.filter((message) => message.role === "user");
    const latest = userMessages.at(-1)?.content ?? "";
    yield {
      type: "text_delta",
      delta: `Turn ${userMessages.length}; received: ${latest}`,
    };
    yield { type: "done", stopReason: "stop" };
  },
};

const harness = new AgentHarness({
  agent: defineAgent({ systemPrompt: "Demonstrate session recovery.", model, tools: [] }),
  session,
});

console.log(`session -> ${session.id}`);
console.log(`restored messages -> ${restoredMessages.length}`);
for await (const event of harness.run(input)) {
  if (event.type === "message_update") process.stdout.write(event.delta);
  if (event.type === "run_end") process.stdout.write("\n");
}
