import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, cp, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { createCodingAgent } from "@axiom-agent/coding-agent";
import { AgentHarness, Session, type Model } from "@axiom-agent/core";
import { JsonlSessionStore } from "@axiom-agent/session-jsonl";
import { JsonlRunTrace } from "@axiom-agent/trace-jsonl";

import { EvalTaskConfigurationError, type LoadedEvalTask } from "./task.js";

export interface EvalRunnerOptions {
  readonly task: LoadedEvalTask;
  readonly model: Model;
  readonly artifactsDirectory: string;
  readonly resultsFile?: string;
  readonly rgCommand?: string;
}

export interface VerificationResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const MAX_VERIFIER_OUTPUT = 64 * 1024;
const MISSING_FILE_HASH = "<missing-or-not-a-file>";

export type EvalStatus = "passed" | "agent_error" | "verifier_failed" | "immutable_changed";

export interface EvalRunResult {
  readonly taskId: string;
  readonly title: string;
  readonly status: EvalStatus;
  readonly success: boolean;
  readonly model: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolErrors: number;
  readonly initialVerification: VerificationResult;
  readonly finalVerification: VerificationResult;
  readonly immutableChanges: readonly string[];
  readonly finalMessage?: string;
  readonly agentError?: string;
  readonly sessionId: string;
  readonly traceRunId: string;
  readonly artifactDirectory: string;
}

export async function runEvalTask(options: EvalRunnerOptions): Promise<EvalRunResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const runSuffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const artifactDirectory = resolve(options.artifactsDirectory, `${options.task.id}-${runSuffix}`);
  const workspace = resolve(artifactDirectory, "workspace");
  const sessions = resolve(artifactDirectory, "sessions");
  const traces = resolve(artifactDirectory, "traces");
  await mkdir(artifactDirectory, { recursive: true });
  await cp(options.task.fixtureDirectory, workspace, { recursive: true, errorOnExist: true });

  const initialHashes = await hashPaths(workspace, options.task.immutablePaths);
  const initialVerification = await verify(workspace, options.task.verifier);
  if (options.task.expectInitialFailure && initialVerification.exitCode === 0) {
    throw new EvalTaskConfigurationError(
      `Task ${options.task.id} expected an initially failing verifier, but it passed.`,
    );
  }

  const sessionId = `${options.task.id}-${runSuffix}`;
  const session = new Session({
    id: sessionId,
    store: new JsonlSessionStore({ directory: sessions }),
  });
  const trace = new JsonlRunTrace({ directory: traces });
  const agent = await createCodingAgent({
    workspace,
    allowedCommands: [process.execPath],
    model: options.model,
    ...(options.rgCommand ? { rgCommand: options.rgCommand } : {}),
  });
  const harness = new AgentHarness({ agent, session, maxTurns: options.task.maxTurns });

  let turns = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let finalMessage: string | undefined;
  let agentError: string | undefined;
  try {
    for await (const event of harness.run(options.task.prompt)) {
      await trace.record(event);
      if (event.type === "turn_start") turns += 1;
      if (event.type === "tool_execution_start") toolCalls += 1;
      if (event.type === "tool_execution_end" && event.result.isError) toolErrors += 1;
      if (event.type === "run_end") finalMessage = event.finalMessage.content;
    }
  } catch (error) {
    agentError = error instanceof Error ? error.message : "Unknown agent error";
  }

  const finalVerification = await verify(workspace, options.task.verifier);
  const finalHashes = await hashPaths(workspace, options.task.immutablePaths, true);
  const immutableChanges = [...initialHashes.keys()].filter(
    (path) => initialHashes.get(path) !== finalHashes.get(path),
  );
  const status: EvalStatus = agentError
    ? "agent_error"
    : immutableChanges.length > 0
    ? "immutable_changed"
    : finalVerification.exitCode !== 0
    ? "verifier_failed"
    : "passed";
  const result: EvalRunResult = {
    taskId: options.task.id,
    title: options.task.title,
    status,
    success: status === "passed",
    model: options.model.id,
    startedAt,
    durationMs: Math.round(performance.now() - start),
    turns,
    toolCalls,
    toolErrors,
    initialVerification,
    finalVerification,
    immutableChanges,
    ...(finalMessage !== undefined ? { finalMessage } : {}),
    ...(agentError !== undefined ? { agentError } : {}),
    sessionId,
    traceRunId: trace.runId,
    artifactDirectory,
  };
  if (options.resultsFile) await appendResult(options.resultsFile, result);
  return result;
}

async function appendResult(file: string, result: EvalRunResult): Promise<void> {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(result)}\n`, "utf8");
}

async function hashPaths(
  root: string,
  paths: readonly string[],
  allowMissing = false,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const path of paths) {
    const file = resolve(root, path);
    try {
      if (!(await stat(file)).isFile()) {
        if (allowMissing) {
          hashes.set(path, MISSING_FILE_HASH);
          continue;
        }
        throw new EvalTaskConfigurationError(`${path} is not a file.`);
      }
      hashes.set(path, createHash("sha256").update(await readFile(file)).digest("hex"));
    } catch (error) {
      if (allowMissing && isNodeError(error) && error.code === "ENOENT") {
        hashes.set(path, MISSING_FILE_HASH);
        continue;
      }
      throw error;
    }
  }
  return hashes;
}

function verify(
  cwd: string,
  verifier: LoadedEvalTask["verifier"],
): Promise<VerificationResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [...verifier.args], {
      cwd,
      env: safeEnvironment(),
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = appendBounded(stderr, chunk);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, verifier.timeoutMs ?? 30_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolveResult({ exitCode, stdout, stderr, timedOut });
    });
  });
}

function appendBounded(current: string, chunk: string): string {
  const combined = current + chunk;
  if (combined.length <= MAX_VERIFIER_OUTPUT) return combined;
  return `${combined.slice(0, MAX_VERIFIER_OUTPUT)}\n[output truncated]`;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"]) {
    if (process.env[name] !== undefined) result[name] = process.env[name];
  }
  return result;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
