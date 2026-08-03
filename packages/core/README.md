# @axiom-agent/core

The minimal execution core for Axiom Agent.

The package has two layers:

- `executeTurn()` is a stateless primitive for one model response and its tool batch.
- `AgentHarness` owns a run, builds context, updates a session, and repeats turns until completion.

Concrete model providers, tools, persistence backends, user interfaces, memory, skills, and MCP integrations live outside this package.

```typescript
const agent = defineAgent({
  systemPrompt: "You are helpful.",
  model,
  tools: [calculator],
});

const harness = new AgentHarness({ agent });

for await (const event of harness.run("What is 2 + 2?")) {
  console.log(event.type);
}
```
