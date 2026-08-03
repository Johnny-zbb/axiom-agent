# @axiom-agent/coding-agent

A deliberately small Coding Agent product layer built on `@axiom-agent/core`.

It provides four tools:

- `read_file`
- `write_file`
- `search`
- `run_command`

The package owns workspace boundaries and coding-specific prompts. Core continues to own the loop, session, context, tools, and lifecycle.

`run_command` does not accept shell text. Callers must provide an explicit executable allowlist; child processes receive a filtered environment that excludes API keys and other application secrets.

Executable allowlisting is not an OS sandbox: an allowed interpreter or test can still access resources available to the host process. Run model-generated code only in a trusted disposable workspace or an external container/host sandbox.
