# @axiom-agent/openai-compatible

An adapter from OpenAI-compatible Chat Completions SSE responses to the Axiom Agent Core `Model` contract.

```typescript
const model = new OpenAICompatibleChatModel({
  apiKey: process.env.TOKENRHYTHM_API_KEY!,
  baseUrl: "https://tokenrhythm.studio/v1",
  model: "deepseek-v4-flash",
});
```

The provider owns protocol translation only. Sessions, tool execution, retries, and the agent loop remain Core responsibilities.
