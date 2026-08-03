import type { ToolCall, ToolResultMessage } from "../primitives/messages.js";
import type {
  AgentTool,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutor,
} from "../primitives/tool.js";

export class DuplicateToolError extends Error {
  constructor(name: string) {
    super(`Tool \"${name}\" is already registered.`);
    this.name = "DuplicateToolError";
  }
}

export class ToolRegistry implements ToolExecutor {
  readonly #tools = new Map<string, AgentTool>();

  constructor(tools: readonly AgentTool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: AgentTool): void {
    const { name } = tool.definition;
    if (this.#tools.has(name)) {
      throw new DuplicateToolError(name);
    }
    this.#tools.set(name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.#tools.get(name);
  }

  list(): readonly AgentTool[] {
    return [...this.#tools.values()];
  }

  definitions(): readonly ToolDefinition[] {
    return this.list().map((tool) => tool.definition);
  }

  async execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResultMessage> {
    const tool = this.get(call.name);
    if (!tool) {
      return this.#errorResult(call, `Unknown tool: ${call.name}`);
    }

    const validation = tool.validate(call.arguments);
    if (!validation.valid) {
      return this.#errorResult(call, `Invalid arguments: ${validation.error}`);
    }

    context.signal?.throwIfAborted();
    try {
      const result = await tool.execute(call.arguments, context);
      context.signal?.throwIfAborted();
      return {
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        content: result.content,
        isError: false,
      };
    } catch (error) {
      // Cancellation belongs to the harness lifecycle; it is not a tool
      // observation that the model should try to recover from.
      context.signal?.throwIfAborted();
      return this.#errorResult(call, toErrorMessage(error));
    }
  }

  #errorResult(call: ToolCall, content: string): ToolResultMessage {
    return {
      role: "tool",
      toolCallId: call.id,
      toolName: call.name,
      content,
      isError: true,
    };
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Tool execution failed with an unknown error.";
}
