import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { loadEvalTask, runEvalTask } from "@axiom-agent/eval";
import { OpenAICompatibleChatModel } from "@axiom-agent/openai-compatible";

const apiKey = process.env.TOKENRHYTHM_API_KEY;
if (!apiKey) throw new Error("Set TOKENRHYTHM_API_KEY before running this example.");

const tasksRoot = resolve("packages/eval/tasks");
const requested = process.argv.slice(2);
const taskNames = requested.length > 0
  ? requested
  : (await readdir(tasksRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
const artifactsDirectory = resolve(".axiom-agent/eval/runs");
const resultsFile = resolve(".axiom-agent/eval/results.jsonl");

for (const taskName of taskNames) {
  const task = await loadEvalTask(resolve(tasksRoot, taskName));
  const model = new OpenAICompatibleChatModel({
    apiKey,
    baseUrl: process.env.TOKENRHYTHM_BASE_URL ?? "https://tokenrhythm.studio/v1",
    model: process.env.TOKENRHYTHM_MODEL ?? "deepseek-v4-flash",
  });
  console.log(`\n[${task.id}] ${task.title}`);
  const result = await runEvalTask({ task, model, artifactsDirectory, resultsFile });
  console.log(`${result.status} | ${result.durationMs}ms | ${result.turns} turns | ${result.toolCalls} tool calls`);
  console.log(`artifacts -> ${result.artifactDirectory}`);
}

console.log(`\nresults -> ${resultsFile}`);
