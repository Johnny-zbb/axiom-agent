# Next Step

The Coding Agent GUI is now a Tauri desktop application (React + Vite + Tailwind v4 + shadcn/ui renderer, Node sidecar backend, Bun-compiled release binary).

Recommended next slices:

1. Add a workspace file tree and a read-only before/after diff to the Coding Agent GUI.
2. Add explicit approval/permission UI before expanding the command allowlist or targeting arbitrary repositories.
3. Add a small read-only results loader/API so the Evaluation dashboard can consume `.axiom-agent/eval/results.jsonl` instead of embedding one recorded run.
4. Add repeated-run aggregation (pass rate, p50 latency, tool-error rate) without changing Core.
5. Add context projection and compaction only after repeated evaluations expose concrete context pressure.

Do not add memory, skills, MCP, subagents, or a second runtime loop merely to enrich either frontend.

Desktop-specific follow-ups: the bundled sidecar is a 98 MB Bun runtime single file (smaller than Electron but not tiny); consider measuring an alternative like bundling a trimmed Node or native Rust rewrite only if size becomes a product requirement. `tauri dev` requires `cargo` on PATH and Bun for `build:sidecar`. Smart App Control must stay off on this host for Rust builds.
