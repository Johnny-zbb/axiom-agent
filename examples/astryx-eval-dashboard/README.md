# Astryx evaluation dashboard

An interactive frontend example for the real five-task Coding Agent baseline.
It was started with `astryx build`, scaffolded from the official `dashboard`
template, initialized with `astryx init --agent codex`, and then adapted to the
Axiom Agent Evaluation and Event Stream vocabulary.

```sh
pnpm install
pnpm --filter @axiom-agent/example-astryx-eval-dashboard dev
```

The displayed baseline is the Token Rhythm `deepseek-v4-flash` run recorded in
`.axiom-agent/eval/results.jsonl` on 2026-08-02.
