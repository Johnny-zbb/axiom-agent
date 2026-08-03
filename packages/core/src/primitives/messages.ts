export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface UserMessage {
  readonly role: "user";
  readonly content: string;
}

export interface AssistantMessage {
  readonly role: "assistant";
  readonly content: string;
  readonly toolCalls: readonly ToolCall[];
}

export interface ToolResultMessage {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly content: string;
  readonly isError: boolean;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

/**
 * The model-facing message type is deliberately separate from AgentMessage.
 * They are identical in v1, but context projection may filter or transform
 * application-specific messages later without changing the model contract.
 */
export type ModelMessage = AgentMessage;
