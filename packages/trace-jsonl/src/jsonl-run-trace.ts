import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentEvent } from "@axiom-agent/core";

const RECORD_VERSION = 1;
const MAX_RUN_ID_BYTES = 128;

export interface JsonlRunTraceOptions {
  readonly directory: string;
  readonly runId?: string;
}

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export type SerializedAgentEvent =
  | Exclude<AgentEvent, { readonly type: "run_error" }>
  | {
      readonly type: "run_error";
      readonly sessionId: string;
      readonly error: SerializedError;
    };

export interface RunTraceRecord {
  readonly version: typeof RECORD_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly event: SerializedAgentEvent;
}

export class JsonlRunTraceCorruptError extends Error {
  readonly file: string;
  readonly line: number;

  constructor(file: string, line: number, reason: string) {
    super(`Invalid run trace at ${file}:${line}: ${reason}`);
    this.name = "JsonlRunTraceCorruptError";
    this.file = file;
    this.line = line;
  }
}

/** Records the public AgentEvent stream without changing Core execution. */
export class JsonlRunTrace {
  readonly directory: string;
  readonly runId: string;
  readonly #file: string;
  #writes: Promise<void> = Promise.resolve();
  #initialized = false;
  #nextSequence = 0;

  constructor(options: JsonlRunTraceOptions) {
    if (!options.directory.trim()) throw new TypeError("directory must not be empty.");
    this.directory = resolve(options.directory);
    this.runId = options.runId ?? randomUUID();
    assertRunId(this.runId);
    this.#file = resolve(
      this.directory,
      `${Buffer.from(this.runId, "utf8").toString("base64url")}.jsonl`,
    );
  }

  filePath(): string {
    return this.#file;
  }

  record(event: AgentEvent): Promise<void> {
    const operation = this.#writes
      .catch(() => undefined)
      .then(async () => {
        if (!this.#initialized) await this.#initializeForAppend();
        const record: RunTraceRecord = {
          version: RECORD_VERSION,
          runId: this.runId,
          sequence: this.#nextSequence,
          recordedAt: new Date().toISOString(),
          event: serializeEvent(event),
        };
        const line = JSON.stringify(record);
        await appendFile(this.#file, `${line}\n`, { encoding: "utf8", flag: "a" });
        this.#nextSequence += 1;
      });
    this.#writes = operation;
    return operation;
  }

  async records(): Promise<readonly RunTraceRecord[]> {
    await this.#writes.catch(() => undefined);
    return readRecords(this.#file, this.runId);
  }

  async #initializeForAppend(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const existing = await readRecords(this.#file, this.runId);
    await removeUncommittedTail(this.#file);
    this.#nextSequence = existing.length;
    this.#initialized = true;
  }
}

function serializeEvent(event: AgentEvent): SerializedAgentEvent {
  if (event.type !== "run_error") return event;
  return {
    type: "run_error",
    sessionId: event.sessionId,
    error: {
      name: event.error.name,
      message: event.error.message,
      ...(event.error.stack ? { stack: event.error.stack } : {}),
    },
  };
}

async function readRecords(file: string, runId: string): Promise<readonly RunTraceRecord[]> {
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }

  const lines = contents.split("\n");
  if (!contents.endsWith("\n")) lines.pop();
  const records: RunTraceRecord[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new JsonlRunTraceCorruptError(file, index + 1, "invalid JSON");
    }
    if (!isTraceRecord(value)) {
      throw new JsonlRunTraceCorruptError(file, index + 1, "record schema is invalid");
    }
    if (value.runId !== runId) {
      throw new JsonlRunTraceCorruptError(file, index + 1, "runId does not match file");
    }
    if (value.sequence !== records.length) {
      throw new JsonlRunTraceCorruptError(file, index + 1, "sequence is not contiguous");
    }
    records.push(value);
  }
  return records;
}

function isTraceRecord(value: unknown): value is RunTraceRecord {
  return isRecord(value) &&
    value.version === RECORD_VERSION &&
    typeof value.runId === "string" &&
    Number.isInteger(value.sequence) &&
    typeof value.sequence === "number" &&
    value.sequence >= 0 &&
    typeof value.recordedAt === "string" &&
    isRecord(value.event) &&
    typeof value.event.type === "string";
}

async function removeUncommittedTail(file: string): Promise<void> {
  let handle;
  try {
    handle = await open(file, "r+");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }

  try {
    const { size } = await handle.stat();
    if (size === 0) return;
    const blockSize = 8 * 1024;
    let end = size;
    while (end > 0) {
      const start = Math.max(0, end - blockSize);
      const block = Buffer.allocUnsafe(end - start);
      await handle.read(block, 0, block.length, start);
      const newline = block.lastIndexOf(0x0a);
      if (newline >= 0) {
        const committedLength = start + newline + 1;
        if (committedLength < size) await handle.truncate(committedLength);
        return;
      }
      end = start;
    }
    await handle.truncate(0);
  } finally {
    await handle.close();
  }
}

function assertRunId(runId: string): void {
  if (!runId || Buffer.byteLength(runId, "utf8") > MAX_RUN_ID_BYTES) {
    throw new TypeError(`runId must contain 1-${MAX_RUN_ID_BYTES} UTF-8 bytes.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
