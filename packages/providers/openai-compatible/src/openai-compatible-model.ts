import type {
  Model,
  ModelMessage,
  ModelRequest,
  ModelStreamEvent,
  ToolCall,
  ToolDefinition,
} from "@axiom-agent/core";

export interface OpenAICompatibleModelOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Readonly<Record<string, string>>;
}

export class ChatCompletionsHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;
  readonly traceId?: string;

  constructor(status: number, statusText: string, responseBody: string, traceId?: string) {
    super(`Chat Completions request failed (${status} ${statusText}).`);
    this.name = "ChatCompletionsHttpError";
    this.status = status;
    this.responseBody = responseBody;
    if (traceId) this.traceId = traceId;
  }
}

export class ChatCompletionsProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatCompletionsProtocolError";
  }
}

/** Adapts an OpenAI-compatible Chat Completions SSE stream to the Core Model contract. */
export class OpenAICompatibleChatModel implements Model {
  readonly id: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #headers: Readonly<Record<string, string>>;

  constructor(options: OpenAICompatibleModelOptions) {
    if (!options.apiKey.trim()) throw new TypeError("apiKey must not be empty.");
    if (!options.baseUrl.trim()) throw new TypeError("baseUrl must not be empty.");
    if (!options.model.trim()) throw new TypeError("model must not be empty.");

    this.id = options.model;
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#headers = options.headers ?? {};
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.#apiKey}`,
        ...this.#headers,
      },
      body: JSON.stringify({
        model: this.id,
        messages: toChatMessages(request.systemPrompt, request.messages),
        ...(request.tools.length > 0
          ? { tools: request.tools.map(toChatTool), tool_choice: "auto" }
          : {}),
        stream: true,
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      const traceId = response.headers.get("x-trace-id") ?? response.headers.get("trace-id");
      throw new ChatCompletionsHttpError(
        response.status,
        response.statusText,
        responseBody,
        traceId ?? undefined,
      );
    }
    if (!response.body) {
      throw new ChatCompletionsProtocolError("Chat Completions response has no body.");
    }

    const pendingToolCalls = new Map<number, PendingToolCall>();

    for await (const data of readSseData(response.body)) {
      request.signal?.throwIfAborted();
      if (data === "[DONE]") break;

      const chunk = parseChunk(data);
      const choice = chunk.choices[0];
      if (!choice) continue;

      if (typeof choice.delta.content === "string" && choice.delta.content.length > 0) {
        yield { type: "text_delta", delta: choice.delta.content };
      }
      if (typeof choice.delta.reasoning_content === "string" && choice.delta.reasoning_content.length > 0) {
        yield { type: "reasoning_delta", delta: choice.delta.reasoning_content };
      }
      for (const fragment of choice.delta.tool_calls ?? []) {
        mergeToolCall(pendingToolCalls, fragment);
      }

      if (choice.finish_reason != null) {
        if (choice.finish_reason === "tool_calls") {
          if (pendingToolCalls.size === 0) {
            throw new ChatCompletionsProtocolError(
              "Stream finished for tool calls without any tool call data.",
            );
          }
          for (const call of finalizeToolCalls(pendingToolCalls)) {
            yield { type: "tool_call", call };
          }
          yield { type: "done", stopReason: "tool_use" };
          return;
        } else if (choice.finish_reason === "stop") {
          if (pendingToolCalls.size > 0) {
            throw new ChatCompletionsProtocolError(
              "Stream contained tool calls but finished with stop.",
            );
          }
          yield { type: "done", stopReason: "stop" };
          return;
        } else {
          throw new ChatCompletionsProtocolError(
            `Unsupported finish reason: ${choice.finish_reason}`,
          );
        }
      }
    }

    throw new ChatCompletionsProtocolError("Stream ended without a finish reason.");
  }
}

interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly tool_calls?: readonly ChatToolCall[];
  readonly tool_call_id?: string;
}

interface ChatToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

function toChatMessages(
  systemPrompt: string,
  messages: readonly ModelMessage[],
): readonly ChatMessage[] {
  const result: ChatMessage[] = [];
  if (systemPrompt) result.push({ role: "system", content: systemPrompt });

  for (const message of messages) {
    switch (message.role) {
      case "user":
        result.push({ role: "user", content: message.content });
        break;
      case "assistant":
        result.push({
          role: "assistant",
          content: message.content || null,
          ...(message.toolCalls.length > 0
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function" as const,
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              }
            : {}),
        });
        break;
      case "tool":
        result.push({
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
        });
        break;
    }
  }
  return result;
}

function toChatTool(tool: ToolDefinition): object {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

interface PendingToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

interface ToolCallFragment {
  readonly index: number;
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

function mergeToolCall(
  pending: Map<number, PendingToolCall>,
  fragment: ToolCallFragment,
): void {
  const current = pending.get(fragment.index) ?? { id: "", name: "", argumentsJson: "" };
  current.id += fragment.id ?? "";
  current.name += fragment.function?.name ?? "";
  current.argumentsJson += fragment.function?.arguments ?? "";
  pending.set(fragment.index, current);
}

function finalizeToolCalls(pending: ReadonlyMap<number, PendingToolCall>): readonly ToolCall[] {
  return [...pending.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, call]) => {
      if (!call.id || !call.name) {
        throw new ChatCompletionsProtocolError(`Tool call ${index} is missing id or name.`);
      }
      try {
        return {
          id: call.id,
          name: call.name,
          arguments: JSON.parse(call.argumentsJson || "{}") as unknown,
        };
      } catch {
        throw new ChatCompletionsProtocolError(
          `Tool call ${call.id} contains invalid JSON arguments.`,
        );
      }
    });
}

interface ChatCompletionChunk {
  readonly choices: readonly {
    readonly delta: {
      readonly content?: string | null;
      readonly reasoning_content?: string | null;
      readonly tool_calls?: readonly ToolCallFragment[];
    };
    readonly finish_reason?: string | null;
  }[];
}

function parseChunk(data: string): ChatCompletionChunk {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    throw new ChatCompletionsProtocolError("Stream contained invalid JSON.");
  }
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new ChatCompletionsProtocolError("Stream chunk is missing choices.");
  }
  return value as unknown as ChatCompletionChunk;
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
