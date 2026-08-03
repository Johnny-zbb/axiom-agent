# Coding Agent

A real Coding Agent application composed from Core, the OpenAI-compatible provider, JSONL sessions, and four workspace tools.

PowerShell:

```powershell
$env:TOKENRHYTHM_API_KEY = "your-api-key"
pnpm --filter @axiom-agent/example-coding-agent start `
  ./path/to/sandboxed-workspace `
  "Implement the missing function and run the tests."
```

The example allows only the current Node executable through `run_command`. Commands use argv without a shell and receive a filtered environment. This is not an OS sandbox: run untrusted model-generated code inside a container or another host sandbox.

Sessions persist under `.axiom-agent/coding-sessions` by default. Set a unique `AXIOM_SESSION_ID` for each task or reuse one to resume it.

Every public lifecycle event is also recorded under `.axiom-agent/traces`. The CLI prints the run ID so the execution can be inspected independently from the model transcript.

The `fixtures/math-task` directory is a deterministic proof task. Copy it to a temporary workspace before running the agent so the checked-in fixture stays unchanged.
