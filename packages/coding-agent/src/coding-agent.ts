import type { AgentDefinition, Model } from "@axiom-agent/core";

import { createCodingTools, type CodingToolsOptions } from "./coding-tools.js";

export interface CreateCodingAgentOptions extends CodingToolsOptions {
  readonly model: Model;
  readonly systemPrompt?: string;
}

export async function createCodingAgent(
  options: CreateCodingAgentOptions,
): Promise<AgentDefinition> {
  const tools = await createCodingTools(options);
  return {
    name: "coding-agent",
    model: options.model,
    tools,
    systemPrompt: options.systemPrompt ?? defaultCodingSystemPrompt(options.workspace),
  };
}

function defaultCodingSystemPrompt(workspace: string): string {
  return `You are a focused coding agent working in this workspace: ${workspace}

Inspect relevant files before editing. Make the smallest change that fully solves the task.
Use only the provided tools. Paths must stay inside the workspace.
Run the relevant tests after editing. If a command fails, inspect its output and fix the cause.
Do not claim a file was changed or a test passed unless the corresponding tool result confirms it.
Finish with a concise summary of changes and tests.`;
}
