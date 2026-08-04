# Coding Agent GUI

Tauri desktop application (React + Vite + Tailwind v4 + shadcn/ui frontend, Node
sidecar backend) for the real Agent Harness Coding Agent.

Features:

- choose a workspace and task;
- reuse a persisted Session ID;
- stream assistant text, tool calls, observations, and Core events;
- stop an active run;
- persist Session and Trace JSONL under `.axiom-agent/gui`;
- keep the Token Rhythm API key in the sidecar process, never the webview.

## Prerequisites

- Node.js 20+ and pnpm
- Rust toolchain (rustup) with the MSVC target — `cargo` must be on `PATH`
- Bun (only for building the release sidecar binary; see `build:sidecar`)

## Desktop (Tauri) mode

```sh
TOKENRHYTHM_API_KEY=... pnpm --filter @axiom-agent/example-coding-agent-gui dev
```

`tauri dev` starts the Vite renderer (mode `tauri`, `VITE_API_BASE` points at
the sidecar), compiles the Rust shell, and launches the desktop window. The Rust
shell spawns `node server.mjs` as the sidecar on `127.0.0.1:4174` and kills it
on exit.

Release build (renderer + sidecar binary + NSIS installer):

```sh
pnpm --filter @axiom-agent/example-coding-agent-gui build
pnpm --filter @axiom-agent/example-coding-agent-gui tauri build
```

`build:sidecar` compiles `server.mjs` with `bun build --compile` into a single
executable that Tauri bundles next to the app binary. The bundled sidecar never
serves static assets and binds loopback only.

## Web mode

The same renderer and HTTP contract run in a browser without Tauri:

```sh
pnpm --filter @axiom-agent/example-coding-agent-gui build:renderer
TOKENRHYTHM_API_KEY=... pnpm --filter @axiom-agent/example-coding-agent-gui start
```

Open `http://127.0.0.1:4174`. The service binds only to `127.0.0.1`.
State-changing endpoints reject unlisted cross-origin browser requests (Tauri
webview origins and configured origins are allowlisted), and run creation
requires JSON.

## Layout

- `src/` — React renderer (shadcn/ui components under `src/components/ui`)
- `server.mjs` — Node sidecar (API + CORS guards; static serving in web mode)
- `server-guards.mjs` — origin allowlist and content-type guards
- `src-tauri/` — Rust shell (window + sidecar lifecycle) and bundle config

This example is not an OS sandbox. The allowed Node process can execute code from the selected workspace with the server user's host permissions. Use only a trusted disposable workspace until an external sandbox and explicit command approval UI are added.
