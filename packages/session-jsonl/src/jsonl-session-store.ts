import { Buffer } from "node:buffer";
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentMessage, SessionStore } from "@axiom-agent/core";

const RECORD_VERSION = 1;
const MAX_SESSION_ID_LENGTH = 128;

export interface JsonlSessionStoreOptions {
  readonly directory: string;
}

export class JsonlSessionCorruptError extends Error {
  readonly file: string;
  readonly line: number;

  constructor(file: string, line: number, reason: string) {
    super(`Invalid session record at ${file}:${line}: ${reason}`);
    this.name = "JsonlSessionCorruptError";
    this.file = file;
    this.line = line;
  }
}

export class JsonlSessionSerializationError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Session message cannot be serialized: ${reason}`, options);
    this.name = "JsonlSessionSerializationError";
  }
}

interface SessionRecord {
  readonly version: typeof RECORD_VERSION;
  readonly type: "message";
  readonly sessionId: string;
  readonly writtenAt: string;
  readonly message: AgentMessage;
}

/** Append-only, per-session JSONL storage with in-process write serialization. */
export class JsonlSessionStore implements SessionStore {
  readonly directory: string;
  readonly #writes = new Map<string, Promise<void>>();

  constructor(options: JsonlSessionStoreOptions) {
    if (!options.directory.trim()) throw new TypeError("directory must not be empty.");
    this.directory = resolve(options.directory);
  }

  filePath(sessionId: string): string {
    assertSessionId(sessionId);
    const encoded = Buffer.from(sessionId, "utf8").toString("base64url");
    return resolve(this.directory, `${encoded}.jsonl`);
  }

  async append(sessionId: string, messages: readonly AgentMessage[]): Promise<void> {
    assertSessionId(sessionId);
    if (messages.length === 0) return;

    const previous = this.#writes.get(sessionId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.#appendBatch(sessionId, messages));
    this.#writes.set(sessionId, operation);

    try {
      await operation;
    } finally {
      if (this.#writes.get(sessionId) === operation) this.#writes.delete(sessionId);
    }
  }

  async read(sessionId: string): Promise<readonly AgentMessage[]> {
    assertSessionId(sessionId);
    await this.#writes.get(sessionId)?.catch(() => undefined);

    const file = this.filePath(sessionId);
    let contents: string;
    try {
      contents = await readFile(file, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    const hasTerminatingNewline = contents.endsWith("\n");
    const lines = contents.split("\n");
    if (!hasTerminatingNewline) lines.pop();

    const messages: AgentMessage[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      const record = parseRecord(line, file, index + 1);
      if (record.sessionId !== sessionId) {
        throw new JsonlSessionCorruptError(file, index + 1, "sessionId does not match file");
      }
      messages.push(record.message);
    }
    return messages;
  }

  async #appendBatch(sessionId: string, messages: readonly AgentMessage[]): Promise<void> {
    const writtenAt = new Date().toISOString();
    const lines = messages.map((message) => serializeRecord({
      version: RECORD_VERSION,
      type: "message",
      sessionId,
      writtenAt,
      message,
    }));

    await mkdir(this.directory, { recursive: true });
    const file = this.filePath(sessionId);
    await removeUncommittedTail(file);
    await appendFile(file, `${lines.join("\n")}\n`, {
      encoding: "utf8",
      flag: "a",
    });
  }
}

function serializeRecord(record: SessionRecord): string {
  try {
    if (record.message.role === "assistant") {
      for (const call of record.message.toolCalls) {
        assertJsonValue(call.arguments, `toolCalls.${call.id}.arguments`, new Set());
      }
    }
    const serialized = JSON.stringify(record);
    const roundTrip = JSON.parse(serialized) as unknown;
    if (!isSessionRecord(roundTrip)) {
      throw new TypeError("message changes shape when encoded as JSON");
    }
    return serialized;
  } catch (error) {
    if (error instanceof JsonlSessionSerializationError) throw error;
    const reason = error instanceof Error ? error.message : "unknown serialization error";
    throw new JsonlSessionSerializationError(reason, { cause: error });
  }
}

function parseRecord(line: string, file: string, lineNumber: number): SessionRecord {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw new JsonlSessionCorruptError(file, lineNumber, "invalid JSON");
  }
  if (!isSessionRecord(value)) {
    throw new JsonlSessionCorruptError(file, lineNumber, "record schema is invalid");
  }
  return value;
}

function isSessionRecord(value: unknown): value is SessionRecord {
  return isRecord(value) &&
    value.version === RECORD_VERSION &&
    value.type === "message" &&
    typeof value.sessionId === "string" &&
    typeof value.writtenAt === "string" &&
    isAgentMessage(value.message);
}

function isAgentMessage(value: unknown): value is AgentMessage {
  if (!isRecord(value) || typeof value.content !== "string") return false;
  if (value.role === "user") return true;
  if (value.role === "assistant") {
    return Array.isArray(value.toolCalls) && value.toolCalls.every(isToolCall);
  }
  return value.role === "tool" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string" &&
    typeof value.isError === "boolean";
}

function isToolCall(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    Object.hasOwn(value, "arguments");
}

function assertSessionId(sessionId: string): void {
  if (!sessionId || Buffer.byteLength(sessionId, "utf8") > MAX_SESSION_ID_LENGTH) {
    throw new TypeError(`sessionId must contain 1-${MAX_SESSION_ID_LENGTH} UTF-8 bytes.`);
  }
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

function assertJsonValue(value: unknown, path: string, seen: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError(`${path} contains a non-finite number`);
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contains ${typeof value}, which JSON cannot preserve`);
  }
  if (seen.has(value)) throw new TypeError(`${path} contains a circular reference`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
      return;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(`${path} contains a non-plain object`);
    }
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
