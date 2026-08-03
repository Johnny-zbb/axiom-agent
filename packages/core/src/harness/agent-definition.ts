import type { Model } from "../primitives/model.js";
import type { AgentTool } from "../primitives/tool.js";

export interface AgentDefinition {
  readonly name?: string;
  readonly systemPrompt: string;
  readonly model: Model;
  readonly tools: readonly AgentTool[];
}

export function defineAgent(definition: AgentDefinition): AgentDefinition {
  return {
    ...definition,
    tools: [...definition.tools],
  };
}
