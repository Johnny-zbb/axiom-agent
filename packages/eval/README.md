# @axiom-agent/eval

Small, reproducible Coding Agent evaluations. Each task contains a fixture,
natural-language prompt, independent Node verifier, immutable test paths, and a
turn budget. The runner copies the fixture into an isolated artifact directory,
runs the real Coding Agent through Core, verifies the result, and records Session
and Trace JSONL files beside a machine-readable result.

The built-in baseline contains five intentionally failing tasks:

- `implement-sum`
- `fix-clamp-boundaries`
- `validate-port`
- `repair-retry`
- `normalize-profile`

This package measures the product layer without moving agent policy into Core.
Provider selection belongs to the caller; Evaluation does not import a model SDK.
