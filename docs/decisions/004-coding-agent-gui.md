# Coding Agent GUI

## Decision

Build the first interactive Coding Agent UI as `examples/coding-agent-gui`, a thin Tauri desktop application over the existing public packages. Do not introduce a GUI runtime, browser-specific events, or another agent loop.

## Shape

A Tauri 2 shell owns the window and spawns a Node sidecar server. The sidecar keeps the provider key in its own environment, creates the existing Coding Agent and `AgentHarness`, persists Session and Trace JSONL, binds `127.0.0.1:4174`, and streams serializable public lifecycle events as NDJSON. The webview renderer is a plain React + Vite + Tailwind v4 + shadcn/ui application that talks to the sidecar over the same HTTP contract; it never has Node or shell access.

The UI uses shadcn `Sidebar` plus a two-region layout with one optional inspection region:

- workspace selection, lightweight chat/search actions, conversation history, settings, and collapse control on the left
- streamed user/assistant messages, inline tool calls, and composer in the center
- a hideable tabbed Tools, Run, and Settings inspector on the right

An empty conversation uses a greeting and coding-task suggestion cards. Once a message is sent, that region becomes the real message stream. A scroll region owns the message list while the composer stays docked at the bottom.

Assistant output renders with `react-markdown` + `remark-gfm` and typography prose styles instead of rendering model text as a plain paragraph. A controlled `Collapsible` exposes a concise public activity summary (turns, tools, and selected lifecycle milestones) while deliberately avoiding hidden chain-of-thought. The workspace control is a shadcn `Select` with known workspaces plus an explicit custom-path mode. shadcn `Command` inside a `Dialog` provides global conversation/action search and opens with Ctrl/Cmd+K.

Cancellation aborts the active Harness run. Command execution remains allowlisted to the Node executable, and file tools retain the Coding Agent's canonical workspace boundary. The sidecar rejects unlisted cross-origin state-changing requests (the desktop webview origins and configured origins are allowlisted), answers CORS preflight, and run creation accepts only JSON.

## Desktop form

Tauri was chosen over Electron for bundle size. The entire backend stays in Node — a Bun-compiled single-file sidecar binary replaces `server.mjs` at release time, so no Rust reimplementation of the harness exists. The renderer stays Web-portable: the same UI and HTTP contract can be served by plain `node server.mjs` in a browser (web mode), which keeps the door open for future web or Electron variants without forking the frontend.

The renderer uses a Vite build mode (`vite --mode tauri`) so `VITE_API_BASE` points at `http://127.0.0.1:4174` only in the desktop build; web mode uses same-origin relative URLs. The sidecar binds loopback only and never serves static assets in desktop mode.

## Proof

A release-mode Tauri run verified end-to-end:

- Rust shell compiles and launches; it spawns the bundled sidecar and kills it on exit
- sidecar single-file binary (`bun build --compile`) serves `/api/health` and rejects non-API routes in sidecar mode
- CORS allowlist accepts desktop webview origins and rejects unlisted cross-origin writes
- NSIS installer bundles the sidecar next to the app binary

## Deferred

The first slice does not provide a file tree, editor, diff approval, broad shell access, arbitrary permission policy, or evaluation-result loading. Those remain application-layer increments and do not justify changes to Core.

Executable allowlisting and workspace-bounded file tools do not form an OS sandbox. In particular, an allowed Node process can execute workspace code with the server user's host permissions. Until external isolation and approval UI exist, the GUI is limited to trusted disposable workspaces.
