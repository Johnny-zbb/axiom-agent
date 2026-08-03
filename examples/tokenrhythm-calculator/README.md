# Token Rhythm Calculator

A real provider-backed Axiom Agent loop using Token Rhythm's OpenAI-compatible Chat Completions endpoint.

PowerShell:

```powershell
$env:TOKENRHYTHM_API_KEY = "your-api-key"
pnpm --filter @axiom-agent/example-tokenrhythm-calculator start
```

Defaults:

- Base URL: `https://tokenrhythm.studio/v1`
- Model: `deepseek-v4-flash`

Override them with `TOKENRHYTHM_BASE_URL` and `TOKENRHYTHM_MODEL`.

The transcript is persisted under `.axiom-agent/sessions`. Reuse the same
`AXIOM_SESSION_ID` to continue with the previous model context.
