import type { AgentDefinition } from "./agent-definition.js";
import type { ModelMessage } from "../primitives/messages.js";
import type { ToolDefinition } from "../primitives/tool.js";
import type { Session } from "./session/session.js";

export interface ModelContext {
  readonly systemPrompt: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDefinition[];
}

export interface ContextBuildInput {
  readonly agent: AgentDefinition;
  readonly session: Session;
  readonly tools: readonly ToolDefinition[];
}

export interface ContextBuilder {
  build(input: ContextBuildInput): Promise<ModelContext>;
}

export class DefaultContextBuilder implements ContextBuilder {
  async build(input: ContextBuildInput): Promise<ModelContext> {
    return {
      systemPrompt: input.agent.systemPrompt,
      messages: [...(await input.session.messages())],
      tools: [...input.tools],
    };
  }
}
