# Next Step

The fixed real-model baseline, Evaluation dashboard, and first interactive Coding Agent GUI are complete.

Recommended next slice:

1. Add a workspace file tree and a read-only before/after diff to the Coding Agent GUI.
2. Add explicit approval/permission UI before expanding the command allowlist or targeting arbitrary repositories.
3. Add a small read-only results loader/API so the Evaluation dashboard can consume `.axiom-agent/eval/results.jsonl` instead of embedding one recorded run.
4. Add repeated-run aggregation (pass rate, p50 latency, tool-error rate) without changing Core.
5. Add context projection and compaction only after repeated evaluations expose concrete context pressure.

Do not add memory, skills, MCP, subagents, or a second runtime loop merely to enrich either frontend.
