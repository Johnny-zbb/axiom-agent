import { readFile, writeFile } from "node:fs/promises";

import type { AgentTool, ToolExecutionContext, ToolResult } from "@axiom-agent/core";

import { runProcess } from "./process.js";
import { CodingWorkspace } from "./workspace.js";

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CodingToolsOptions {
  readonly workspace: string;
  readonly allowedCommands: readonly string[];
  readonly rgCommand?: string;
  readonly maxFileBytes?: number;
  readonly maxOutputBytes?: number;
  readonly commandTimeoutMs?: number;
}

export async function createCodingTools(options: CodingToolsOptions): Promise<readonly AgentTool[]> {
  const workspace = await CodingWorkspace.create(options.workspace);
  const allowedCommands = [...new Set(options.allowedCommands)];
  const maxFileBytes = positiveInteger(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, "maxFileBytes");
  const maxOutputBytes = positiveInteger(
    options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    "maxOutputBytes",
  );
  const commandTimeoutMs = positiveInteger(
    options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    "commandTimeoutMs",
  );
  const rgCommand = options.rgCommand ?? "rg";

  return [
    createReadFileTool(workspace, maxFileBytes),
    createWriteFileTool(workspace, maxFileBytes),
    createSearchTool(workspace, rgCommand, maxOutputBytes, commandTimeoutMs),
    createRunCommandTool(workspace, allowedCommands, maxOutputBytes, commandTimeoutMs),
  ];
}

function createReadFileTool(workspace: CodingWorkspace, maxFileBytes: number): AgentTool {
  return {
    definition: {
      name: "read_file",
      description: "Read a UTF-8 text file inside the workspace with line numbers.",
      inputSchema: objectSchema({ path: { type: "string" } }, ["path"]),
    },
    validate: validatePathInput,
    async execute(input): Promise<ToolResult> {
      const { path } = input as PathInput;
      const file = await workspace.resolveExisting(path);
      const contents = await readFile(file);
      if (contents.length > maxFileBytes) {
        throw new Error(`File exceeds the ${maxFileBytes} byte read limit.`);
      }
      const text = contents.toString("utf8");
      const numbered = text
        .split("\n")
        .map((line, index) => `${String(index + 1).padStart(4, " ")} | ${line}`)
        .join("\n");
      return { content: numbered, details: { path: workspace.displayPath(file) } };
    },
  };
}

function createWriteFileTool(workspace: CodingWorkspace, maxFileBytes: number): AgentTool {
  return {
    definition: {
      name: "write_file",
      description: "Create or replace a UTF-8 text file inside an existing workspace directory.",
      inputSchema: objectSchema(
        { path: { type: "string" }, content: { type: "string" } },
        ["path", "content"],
      ),
    },
    validate(input) {
      if (!isRecord(input) || typeof input.path !== "string" || !input.path) {
        return { valid: false, error: "path must be a non-empty string" };
      }
      if (typeof input.content !== "string") {
        return { valid: false, error: "content must be a string" };
      }
      if (Buffer.byteLength(input.content, "utf8") > maxFileBytes) {
        return { valid: false, error: `content exceeds ${maxFileBytes} bytes` };
      }
      return { valid: true };
    },
    async execute(input): Promise<ToolResult> {
      const { path, content } = input as WriteFileInput;
      const file = await workspace.resolveWritable(path);
      await writeFile(file, content, "utf8");
      return {
        content: `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${workspace.displayPath(file)}.`,
        details: { path: workspace.displayPath(file) },
      };
    },
  };
}

function createSearchTool(
  workspace: CodingWorkspace,
  rgCommand: string,
  maxOutputBytes: number,
  timeoutMs: number,
): AgentTool {
  return {
    definition: {
      name: "search",
      description: "Search workspace text with ripgrep. Returns file, line, column, and matching text.",
      inputSchema: objectSchema(
        {
          query: { type: "string" },
          path: { type: "string", default: "." },
          glob: { type: "string" },
        },
        ["query"],
      ),
    },
    validate(input) {
      if (!isRecord(input) || typeof input.query !== "string" || !input.query) {
        return { valid: false, error: "query must be a non-empty string" };
      }
      if (input.path !== undefined && typeof input.path !== "string") {
        return { valid: false, error: "path must be a string" };
      }
      if (input.glob !== undefined && typeof input.glob !== "string") {
        return { valid: false, error: "glob must be a string" };
      }
      return { valid: true };
    },
    async execute(input, context): Promise<ToolResult> {
      const { query, path = ".", glob } = input as SearchInput;
      const target = await workspace.resolveExisting(path);
      const args = ["--line-number", "--column", "--no-heading", "--color", "never", "--max-count", "200"];
      if (glob) args.push("--glob", glob);
      args.push("--", query, target);
      const result = await runProcess({
        command: rgCommand,
        args,
        cwd: workspace.root,
        timeoutMs,
        maxOutputBytes,
        ...(context.signal ? { signal: context.signal } : {}),
      });
      if (result.timedOut) throw new Error(`Search timed out after ${timeoutMs}ms.`);
      if (result.exitCode === 1) return { content: "No matches." };
      if (result.exitCode !== 0) throw new Error(result.stderr || `ripgrep exited ${result.exitCode}`);
      return {
        content: `${result.stdout}${result.truncated ? "\n[output truncated]" : ""}`.trimEnd(),
      };
    },
  };
}

function createRunCommandTool(
  workspace: CodingWorkspace,
  allowedCommands: readonly string[],
  maxOutputBytes: number,
  defaultTimeoutMs: number,
): AgentTool {
  return {
    definition: {
      name: "run_command",
      description: "Run one explicitly allowed executable without a shell inside the workspace.",
      inputSchema: objectSchema(
        {
          command: { type: "string", enum: allowedCommands },
          args: { type: "array", items: { type: "string" }, default: [] },
          cwd: { type: "string", default: "." },
          timeoutMs: { type: "integer", minimum: 1, maximum: defaultTimeoutMs },
        },
        ["command"],
      ),
    },
    validate(input) {
      if (!isRecord(input) || typeof input.command !== "string") {
        return { valid: false, error: "command must be a string" };
      }
      if (!allowedCommands.includes(input.command)) {
        return { valid: false, error: `command is not allowed: ${input.command}` };
      }
      if (input.args !== undefined &&
        (!Array.isArray(input.args) || !input.args.every((item) => typeof item === "string"))) {
        return { valid: false, error: "args must be an array of strings" };
      }
      if (input.cwd !== undefined && typeof input.cwd !== "string") {
        return { valid: false, error: "cwd must be a string" };
      }
      if (input.timeoutMs !== undefined &&
        (typeof input.timeoutMs !== "number" ||
          !Number.isInteger(input.timeoutMs) ||
          input.timeoutMs < 1 ||
          input.timeoutMs > defaultTimeoutMs)) {
        return { valid: false, error: `timeoutMs must be an integer from 1 to ${defaultTimeoutMs}` };
      }
      return { valid: true };
    },
    async execute(input, context): Promise<ToolResult> {
      const {
        command,
        args = [],
        cwd = ".",
        timeoutMs = defaultTimeoutMs,
      } = input as RunCommandInput;
      const resolvedCwd = await workspace.resolveExisting(cwd);
      const result = await runProcess({
        command,
        args,
        cwd: resolvedCwd,
        timeoutMs,
        maxOutputBytes,
        ...(context.signal ? { signal: context.signal } : {}),
      });
      return {
        content: formatProcessResult(result),
        details: { command, args, cwd: workspace.displayPath(resolvedCwd), ...result },
      };
    },
  };
}

function formatProcessResult(result: Awaited<ReturnType<typeof runProcess>>): string {
  const sections = [`exitCode: ${result.exitCode ?? "null"}`, `timedOut: ${result.timedOut}`];
  if (result.stdout) sections.push(`stdout:\n${result.stdout.trimEnd()}`);
  if (result.stderr) sections.push(`stderr:\n${result.stderr.trimEnd()}`);
  if (result.truncated) sections.push("[output truncated]");
  return sections.join("\n");
}

interface PathInput { readonly path: string }
interface WriteFileInput extends PathInput { readonly content: string }
interface SearchInput { readonly query: string; readonly path?: string; readonly glob?: string }
interface RunCommandInput {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

function validatePathInput(input: unknown) {
  return isRecord(input) && typeof input.path === "string" && input.path
    ? { valid: true as const }
    : { valid: false as const, error: "path must be a non-empty string" };
}

function objectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[],
): Readonly<Record<string, unknown>> {
  return { type: "object", properties, required, additionalProperties: false };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
