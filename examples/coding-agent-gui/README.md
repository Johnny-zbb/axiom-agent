# Coding Agent GUI

Local Astryx frontend plus a localhost-only Node service for the real Agent
Harness Coding Agent.

Features:

- choose a workspace and task;
- reuse a persisted Session ID;
- stream assistant text, tool calls, observations, and Core events;
- stop an active run;
- persist Session and Trace JSONL under `.axiom-agent/gui`;
- keep the Token Rhythm API key in the server process, never the browser.

Build and start:

```sh
pnpm --filter @axiom-agent/example-coding-agent-gui build
TOKENRHYTHM_API_KEY=... pnpm --filter @axiom-agent/example-coding-agent-gui start
```

Open `http://127.0.0.1:4174`. The service binds only to `127.0.0.1`.
State-changing endpoints reject cross-origin browser requests, and run creation requires JSON.

This example is not an OS sandbox. The allowed Node process can execute code from the selected workspace with the server user's host permissions. Use only a trusted disposable workspace until an external sandbox and explicit command approval UI are added.
