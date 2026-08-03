# Decisions

## Core is the package boundary

Use `packages/core` / `@axiom-agent/core`. Do not create a separate harness package yet.

## Harness and loop are separate layers

- `executeTurn()` performs one model response and its complete tool batch without owning durable state.
- `AgentHarness` owns a run, builds context, updates the session, enforces turn limits, and repeats turns.

## Agent is configuration

`AgentDefinition` describes identity, model, system prompt, and tools. It is not another stateful runtime object competing with `AgentHarness`.

## Session semantics belong to core; storage dependencies do not

Core defines `SessionStore` and includes an in-memory implementation. File and database adapters should be separate packages.

## First version is deliberately sequential

Tool calls execute in model source order. Parallel execution can be added later while preserving deterministic transcript order.

## Providers are protocol adapters

`@axiom-agent/openai-compatible` translates Chat Completions requests and SSE events only. It does not own sessions, tools, retries, or loop state. It uses native `fetch` to keep the first adapter small and SDK-independent.

API keys are constructor inputs and examples read them from environment variables. Secrets never receive repository defaults.

OpenAI-compatible gateways may omit `finish_reason` on intermediate SSE chunks. The adapter treats both missing and `null` values as "not finished" and only emits Core completion events for explicit terminal reasons.

## JSONL stores committed message records

`@axiom-agent/session-jsonl` implements the Core `SessionStore` without adding filesystem dependencies to Core. Each session has one safely encoded append-only file, and one append batch uses one filesystem append operation.

Newline-terminated records are committed. Recovery may discard and repair only one unterminated tail left by interruption; malformed committed records fail loudly. Concurrent writes to the same session are ordered within one process. Cross-process concurrent writers are intentionally not supported yet.

## Coding Agent is a product layer

`@axiom-agent/coding-agent` supplies a coding prompt, canonical workspace boundary, and four tools. It does not add another loop, session, context, or tool runtime.

File tools resolve canonical paths and reject lexical or symlink escapes. `run_command` accepts an allowlisted executable plus argv, never shell text, and passes a filtered environment without application secrets. This is capability control, not an OS sandbox; callers must isolate untrusted generated code with a container or host sandbox.

## Transcript and trace are different records

Session JSONL contains only messages projected back into model context. `@axiom-agent/trace-jsonl` records the public `AgentEvent` lifecycle with run ID, sequence, and timestamp. Observability data therefore cannot accidentally inflate or alter the model prompt.

## v0.1 is proven with a real coding task

The acceptance fixture begins with two failing tests. A real `deepseek-v4-flash` run inspected both files, changed only the implementation, executed the tests, and finished after observing 2/2 passing. A fresh Session instance recovered the complete transcript, and the separate trace captured every lifecycle event. The durable evidence is summarized in `docs/decisions/002-real-coding-agent-proof.md`.

## Evaluation stays outside Core

`@axiom-agent/eval` composes the public Coding Agent, Session, and Trace packages. It does not add evaluation branches, verifier concepts, fixture IO, or benchmark metrics to Core. A task is a prompt, copied fixture, Node verifier, immutable paths, and turn budget. The real five-task baseline and its artifact contract are documented in `docs/decisions/003-evaluation-baseline.md`.

## The first UI is an example, not a runtime dependency

The Astryx dashboard consumes recorded Evaluation concepts and stays under `examples/`. Core and the Evaluation runner remain headless. The CLI-generated `AGENTS.md` is local to the example, so its UI conventions do not become repository-wide runtime architecture rules.

## The Coding Agent GUI is a thin application layer

`examples/coding-agent-gui` composes public packages without adding browser concepts to Core. A small localhost Node server owns the provider credential, workspace validation, cancellation controller, Session store, and Trace recorder. The browser receives only serializable public `AgentEvent` values over newline-delimited JSON.

The first GUI follows Astryx's `ai-chat` application frame: conversation history on the left, the actual chat stream and composer in the center, and a Tools/Run/Help inspector on the right. Runtime observability stays visible without displacing the conversation from the primary surface. Command execution remains restricted to the Node executable. File tree, diff approval, arbitrary command permissions, and editor integration are later product capabilities, not reasons to enlarge the runtime kernel.
