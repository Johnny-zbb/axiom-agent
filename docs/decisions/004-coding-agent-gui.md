# Coding Agent GUI

## Decision

Build the first interactive Coding Agent UI as `examples/coding-agent-gui`, a thin localhost application over the existing public packages. Do not introduce a GUI runtime, browser-specific events, or another agent loop.

## Shape

The browser submits a workspace, session ID, and task to a small Node server. The server keeps the provider key in its environment, creates the existing Coding Agent and `AgentHarness`, persists Session and Trace JSONL, and streams serializable public lifecycle events as NDJSON.

The interface uses Astryx `AppShell` plus the `ai-chat` page structure with two primary regions and one optional inspection region:

- workspace selection, lightweight chat/search actions, conversation history, settings, and collapse control on the left
- streamed user/assistant messages, inline tool calls, and composer in the center
- a hideable tabbed Tools, Run, and Settings inspector on the right

An empty conversation uses an adapted `ai-chat-landing` greeting and coding-task suggestion cards. Once a message is sent, that region becomes the real message stream. `ChatLayout` fills the center content region and owns the composer dock, keeping input at the bottom while only messages scroll.

Assistant output uses Astryx `Markdown` in streaming mode instead of rendering model text as a plain paragraph. Messages begin at the top of the scroll region; short conversations are not bottom-aligned. A controlled `Collapsible` exposes a concise public activity summary (turns, tools, and selected lifecycle milestones) while deliberately avoiding hidden chain-of-thought. The workspace control is an Astryx `Selector` with known workspaces plus an explicit custom-path mode. Astryx `CommandPalette` provides global conversation/action search and opens with Ctrl/Cmd+K.

Cancellation aborts the active Harness run. Command execution remains allowlisted to the Node executable, and file tools retain the Coding Agent's canonical workspace boundary.
The localhost service rejects cross-origin state-changing browser requests, and run creation accepts only JSON, preventing ordinary web pages from silently starting a host-side run.

## Proof

A real browser-driven run used Token Rhythm `deepseek-v4-flash` against an approved copied math fixture. The agent searched and read the workspace, implemented `sum`, preserved the test file, ran `node --test math.test.mjs`, observed two passing tests, and returned a final explanation.

Independent checks passed:

- 40/40 package and GUI server tests
- 2/2 copied fixture tests
- unchanged test-file SHA-256
- TypeScript check
- Vite production build
- Astryx doctor (6 passed, 0 warnings, 0 failures)
- browser render and empty application console log

## Deferred

The first slice does not provide a file tree, editor, diff approval, broad shell access, arbitrary permission policy, or evaluation-result loading. Those remain application-layer increments and do not justify changes to Core.

Executable allowlisting and workspace-bounded file tools do not form an OS sandbox. In particular, an allowed Node process can execute workspace code with the server user's host permissions. Until external isolation and approval UI exist, the GUI is limited to trusted disposable workspaces.
