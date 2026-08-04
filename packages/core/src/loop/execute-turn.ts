import type { AgentEvent } from "../primitives/events.js";
import type { AssistantMessage, ToolCall, ToolResultMessage } from "../primitives/messages.js";
import type { Model, ModelStopReason } from "../primitives/model.js";
import type { ToolDefinition, ToolExecutor } from "../primitives/tool.js";
import type { ModelMessage } from "../primitives/messages.js";

export interface ExecuteTurnInput {
  readonly turn: number;
  readonly sessionId: string;
  readonly systemPrompt: string;
  readonly messages: readonly ModelMessage[];
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly tools: ToolExecutor;
  readonly model: Model;
  readonly signal?: AbortSignal;
}

export interface TurnResult {
  readonly assistantMessage: AssistantMessage;
  readonly toolResults: readonly ToolResultMessage[];
  readonly shouldContinue: boolean;
}

export class ModelProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelProtocolError";
  }
}

/** Execute one model response and the complete tool batch it requested. */
export async function* executeTurn(input: ExecuteTurnInput): AsyncGenerator<AgentEvent, TurnResult> {
  input.signal?.throwIfAborted();

  let content = "";
  const toolCalls: ToolCall[] = [];
  let stopReason: ModelStopReason | undefined;

  yield { type: "message_start", role: "assistant" };

  for await (const event of input.model.stream({
    systemPrompt: input.systemPrompt,
    messages: input.messages,
    tools: input.toolDefinitions,
    ...(input.signal ? { signal: input.signal } : {}),
  })) {
    input.signal?.throwIfAborted();

    switch (event.type) {
      case "text_delta":
        content += event.delta;
        yield { type: "message_update", delta: event.delta };
        break;
      case "reasoning_delta":
        yield { type: "reasoning_update", delta: event.delta };
        break;
      case "tool_call":
        toolCalls.push(event.call);
        break;
      case "done":
        if (stopReason) {
          throw new ModelProtocolError("Model emitted more than one done event.");
        }
        stopReason = event.stopReason;
        break;
    }
  }

  if (!stopReason) {
    throw new ModelProtocolError("Model stream ended without a done event.");
  }
  if (stopReason === "tool_use" && toolCalls.length === 0) {
    throw new ModelProtocolError("Model stopped for tool use without emitting a tool call.");
  }

  const assistantMessage: AssistantMessage = {
    role: "assistant",
    content,
    toolCalls,
  };
  yield { type: "message_end", message: assistantMessage };

  const toolResults: ToolResultMessage[] = [];
  for (const call of toolCalls) {
    input.signal?.throwIfAborted();
    yield { type: "tool_execution_start", call };
    const result = await input.tools.execute(call, {
      sessionId: input.sessionId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    yield { type: "tool_execution_end", call, result };
    yield { type: "message_start", role: "tool" };
    yield { type: "message_end", message: result };
    toolResults.push(result);
  }

  const result: TurnResult = {
    assistantMessage,
    toolResults,
    shouldContinue: toolCalls.length > 0,
  };
  yield {
    type: "turn_end",
    turn: input.turn,
    assistantMessage,
    toolResults,
  };
  return result;
}
