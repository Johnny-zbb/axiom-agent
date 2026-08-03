# @axiom-agent/trace-jsonl

Append-only JSONL recording for the public Core `AgentEvent` stream.

```typescript
const trace = new JsonlRunTrace({ directory: ".axiom-agent/traces" });

for await (const event of harness.run(input)) {
  await trace.record(event);
  // render the same event elsewhere
}
```

Session JSONL is the model transcript; trace JSONL is the observable execution history. They remain separate so lifecycle events never pollute model context.

Trace records include a run ID, contiguous sequence, timestamp, and serialized event. An interrupted unterminated tail is repaired before the next append; malformed committed records fail loudly.
