import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export interface EvalTaskDefinition {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly fixture: string;
  readonly verifier: {
    readonly command: "node";
    readonly args: readonly string[];
    readonly timeoutMs?: number;
  };
  readonly immutablePaths: readonly string[];
  readonly expectInitialFailure: boolean;
  readonly maxTurns: number;
}

export interface LoadedEvalTask extends EvalTaskDefinition {
  readonly taskDirectory: string;
  readonly fixtureDirectory: string;
}

export class EvalTaskConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalTaskConfigurationError";
  }
}

export async function loadEvalTask(taskDirectory: string): Promise<LoadedEvalTask> {
  const directory = resolve(taskDirectory);
  const raw = JSON.parse(await readFile(resolve(directory, "task.json"), "utf8")) as unknown;
  if (!isRecord(raw)) throw new EvalTaskConfigurationError("task.json must contain an object.");

  const id = stringField(raw, "id");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new EvalTaskConfigurationError("id must use lowercase letters, digits, and hyphens.");
  }
  const title = stringField(raw, "title");
  const prompt = stringField(raw, "prompt");
  const fixture = safeRelativePath(stringField(raw, "fixture"), "fixture");
  const verifier = verifierField(raw.verifier);
  const immutablePaths = stringArrayField(raw, "immutablePaths").map((path) =>
    safeRelativePath(path, "immutablePaths")
  );
  if (typeof raw.expectInitialFailure !== "boolean") {
    throw new EvalTaskConfigurationError("expectInitialFailure must be boolean.");
  }
  if (typeof raw.maxTurns !== "number" || !Number.isInteger(raw.maxTurns) || raw.maxTurns < 1) {
    throw new EvalTaskConfigurationError("maxTurns must be a positive integer.");
  }

  const fixtureDirectory = resolve(directory, fixture);
  if (!(await stat(fixtureDirectory)).isDirectory()) {
    throw new EvalTaskConfigurationError("fixture must resolve to a directory.");
  }
  return {
    id,
    title,
    prompt,
    fixture,
    verifier,
    immutablePaths,
    expectInitialFailure: raw.expectInitialFailure,
    maxTurns: raw.maxTurns,
    taskDirectory: directory,
    fixtureDirectory,
  };
}

function verifierField(value: unknown): EvalTaskDefinition["verifier"] {
  if (!isRecord(value) || value.command !== "node") {
    throw new EvalTaskConfigurationError('verifier.command must be "node".');
  }
  if (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string")) {
    throw new EvalTaskConfigurationError("verifier.args must be an array of strings.");
  }
  const args = value.args.map((arg) => {
    if (isAbsolute(arg) || arg.split(/[\\/]/).includes("..")) {
      throw new EvalTaskConfigurationError("verifier args cannot escape the fixture.");
    }
    return arg;
  });
  if (value.timeoutMs !== undefined &&
    (typeof value.timeoutMs !== "number" || !Number.isInteger(value.timeoutMs) || value.timeoutMs < 1)) {
    throw new EvalTaskConfigurationError("verifier.timeoutMs must be a positive integer.");
  }
  return {
    command: "node",
    args,
    ...(typeof value.timeoutMs === "number" ? { timeoutMs: value.timeoutMs } : {}),
  };
}

function safeRelativePath(value: string, field: string): string {
  if (isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new EvalTaskConfigurationError(`${field} must stay inside the task directory.`);
  }
  return value;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new EvalTaskConfigurationError(`${field} must be a non-empty string.`);
  }
  return value;
}

function stringArrayField(record: Record<string, unknown>, field: string): readonly string[] {
  const value = record[field];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new EvalTaskConfigurationError(`${field} must be an array of strings.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
