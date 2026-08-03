# Coding Agent evaluation example

Runs one or all built-in tasks through the real Coding Agent and Token Rhythm's
OpenAI-compatible Chat Completions endpoint.

Set `TOKENRHYTHM_API_KEY`, then run:

```sh
pnpm --filter @axiom-agent/example-eval-coding-agent start
```

Pass task directory names after `start --` to limit a run. Results, copied
workspaces, Sessions, and Traces are written under `.axiom-agent/eval`.
