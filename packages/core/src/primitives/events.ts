import type { AgentMessage, AssistantMessage, ToolCall, ToolResultMessage } from "./messages.js";

export type AgentEvent =
  | { readonly type: "run_start"; readonly sessionId: string }
  | { readonly type: "turn_start"; readonly turn: number }
  | { readonly type: "message_start"; readonly role: AgentMessage["role"] }
  | { readonly type: "message_update"; readonly delta: string }
  | { readonly type: "reasoning_update"; readonly delta: string }
  | { readonly type: "message_end"; readonly message: AgentMessage }
  | { readonly type: "tool_execution_start"; readonly call: ToolCall }
  | {
      readonly type: "tool_execution_end";
      readonly call: ToolCall;
      readonly result: ToolResultMessage;
    }
  | {
      readonly type: "turn_end";
      readonly turn: number;
      readonly assistantMessage: AssistantMessage;
      readonly toolResults: readonly ToolResultMessage[];
    }
  | {
      readonly type: "run_end";
      readonly sessionId: string;
      readonly turns: number;
      readonly finalMessage: AssistantMessage;
    }
  | { readonly type: "run_error"; readonly sessionId: string; readonly error: Error };
