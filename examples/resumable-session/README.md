# Resumable Session

An offline demonstration that restores a Core session from append-only JSONL.

```bash
pnpm --filter @axiom-agent/example-resumable-session start demo first
pnpm --filter @axiom-agent/example-resumable-session start demo second
```

The second invocation reports two restored messages and responds as turn 2.
Session files default to `.axiom-agent/sessions`; override the directory with
`AXIOM_SESSION_DIR`.
