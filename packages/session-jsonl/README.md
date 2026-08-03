# @axiom-agent/session-jsonl

Append-only JSONL persistence for Axiom Agent sessions.

```typescript
const store = new JsonlSessionStore({ directory: ".axiom-agent/sessions" });
const session = new Session({ id: "my-session", store });
```

Each session uses one safely encoded `.jsonl` file. Writes for the same session are serialized within a process, and every `append()` batch is written with one append operation.

On recovery, the store ignores one unterminated tail fragment, which may be left by an interrupted write. Invalid newline-terminated records throw `JsonlSessionCorruptError`; committed history is never silently skipped.
