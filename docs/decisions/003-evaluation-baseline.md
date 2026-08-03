---
title: Real Coding Agent evaluation baseline
---

# Real Coding Agent evaluation baseline

Date: 2026-08-02

## Decision

Evaluation is a separate package that composes the public runtime surface. It
does not add benchmark or fixture behavior to Core.

Each fixed task declares:

- a natural-language prompt;
- a copied fixture workspace;
- an independent Node verifier;
- immutable test paths;
- an explicit turn budget.

The runner records a result plus recoverable Session and lifecycle Trace JSONL
artifacts under `.axiom-agent/eval`.

## Real baseline

Provider: Token Rhythm OpenAI-compatible Chat Completions

Model: `deepseek-v4-flash`

| Task | Status | Duration | Turns | Tool calls |
|---|---:|---:|---:|---:|
| Fix clamp boundaries | passed | 13.571s | 5 | 5 |
| Implement sum | passed | 7.438s | 5 | 5 |
| Normalize profile | passed | 9.464s | 5 | 8 |
| Repair retry | passed | 8.717s | 5 | 6 |
| Validate port | passed | 9.917s | 5 | 5 |

Aggregate: 5/5 passed, 25 turns, 29 tool calls, zero tool errors, zero verifier
failures, and zero immutable-file changes.

## Consequences

- The baseline is small enough to understand task by task.
- Provider/model regressions can be compared using a stable artifact format.
- The first dashboard is an example consumer, not a Core dependency.
- Repeated runs and statistical aggregation can be added without changing the
  Agent Loop contract.
