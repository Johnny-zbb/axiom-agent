import type { ModelMessage, ToolCall } from "./messages.js";
import type { ToolDefinition } from "./tool.js";

export interface ModelRequest {
  readonly systemPrompt: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly signal?: AbortSignal;
}

export type ModelStopReason = "stop" | "tool_use";

export type ModelStreamEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "tool_call"; readonly call: ToolCall }
  | { readonly type: "done"; readonly stopReason: ModelStopReason };

export interface Model {
  readonly id: string;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
