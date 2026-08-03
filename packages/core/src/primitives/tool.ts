import type { ToolCall, ToolResultMessage } from "./messages.js";

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly error: string };

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export interface ToolResult {
  readonly content: string;
  readonly details?: unknown;
}

export interface AgentTool {
  readonly definition: ToolDefinition;
  validate(input: unknown): ValidationResult;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}

export interface ToolExecutor {
  definitions(): readonly ToolDefinition[];
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResultMessage>;
}
