# Current State

The repository now contains the first implementation of `@axiom-agent/core`.

Implemented:

- provider-agnostic model streaming contract
- typed messages, tools, and lifecycle events
- stateless `executeTurn()` primitive
- stateful `AgentHarness` run orchestration
- `ToolRegistry` with validation and error normalization
- `Session` plus `MemorySessionStore`
- functional `ContextBuilder`
- offline calculator example
- deterministic unit tests
- OpenAI-compatible Chat Completions provider using native fetch
- Token Rhythm calculator example with environment-only API key configuration
- SSE, fragmented tool-call, HTTP error, and provider/Core integration tests
- verified real Token Rhythm loop: model -> calculator(27, 15) -> observation(42) -> final response
- append-only `@axiom-agent/session-jsonl` persistence adapter
- recovery across separate Node processes with in-process per-session write ordering
- interrupted-tail repair plus explicit committed-record corruption errors
- offline resumable-session example verified across two invocations
- minimal `@axiom-agent/coding-agent` product layer with read/write/search/run tools
- canonical workspace path checks, symlink escape prevention, command allowlisting, and filtered child environments
- scripted Core coding loop verified real file edit plus passing `node --test`
- persistent Coding Agent CLI and deterministic failing math fixture
- append-only `@axiom-agent/trace-jsonl` lifecycle recorder wired into the Coding Agent CLI
- run traces preserve ordered run/turn/message/tool/final/error events separately from model context

Not implemented: SQLite persistence, hooks, compaction, memory, skills, MCP, parallel tools, or subagents.

The real-model coding proof is complete. Token Rhythm `deepseek-v4-flash` inspected the isolated fixture, edited only the implementation, ran the tests, observed 2/2 passing, and produced a final summary. Independent verification confirmed the unchanged test hash, passing exit code, 11-message recoverable transcript, and a contiguous 117-record lifecycle trace from `run_start` to `run_end`.

The fixed Evaluation Harness is also complete. `@axiom-agent/eval` ships five intentionally failing Coding Agent tasks, copies each fixture into an isolated artifact directory, runs the real Core/Coding Agent stack, independently verifies the result, hashes immutable tests, and records Session, Trace, and result JSONL. A real Token Rhythm baseline passed 5/5 tasks in 25 turns and 29 tool calls with zero tool errors or immutable-file changes.

`examples/astryx-eval-dashboard` is the first frontend example. It was selected and scaffolded with the official Astryx CLI, initialized with generated Codex guidance, and adapted into an interactive view of the real baseline. Astryx doctor reports 6 passes and no warnings; TypeScript, Vite production build, browser rendering, task selection, and console checks pass.

`examples/coding-agent-gui` is now the first interactive Coding Agent frontend. Its localhost server keeps the provider key out of the browser, composes the existing Coding Agent, Core Harness, Session JSONL, and Trace JSONL packages, and streams public lifecycle events as NDJSON. An Astryx `AppShell` owns the application frame. `SideNav` keeps one product title, places workspace selection first, exposes lightweight New chat/Search actions, and ends with Settings plus an explicit collapse control. The primary message stream is top-aligned while the composer remains bottom-docked. The Tools/Run/Settings inspector is hidden by default and can be reopened from the header or Settings. Astryx `CommandPalette` provides global conversation/action search with Ctrl/Cmd+K. Empty conversations use a focused landing state adapted from the official `ai-chat-landing` template. Assistant output renders with streaming `Markdown`; a `Collapsible` shows a concise public execution summary. It exposes live assistant output, inline tool calls, lifecycle state, durable artifact IDs, workspace selection, and stop control. A real browser-driven Token Rhythm run edited an approved copied math fixture, ran `node --test`, and completed with 2/2 tests passing. A separate read-only browser run verified the collapsible activity summary and Markdown rendering. TypeScript, Vite production builds, the 40-test regression suite, browser rendering, and console checks pass.

The GUI localhost service also rejects cross-origin state-changing requests and requires JSON for run creation. It remains intentionally not sandboxed: Node execution has the host process's permissions, so only trusted disposable workspaces are appropriate until external isolation and explicit approval UI are implemented. Evaluation now records deleted or non-file immutable paths as `immutable_changed` instead of losing the result to a hashing error.
