import type { AgentMessage } from "../../primitives/messages.js";
import { MemorySessionStore } from "./memory-session-store.js";
import type { SessionStore } from "./session-store.js";

export interface SessionOptions {
  readonly id?: string;
  readonly store?: SessionStore;
}

export class Session {
  readonly id: string;
  readonly #store: SessionStore;

  constructor(options: SessionOptions = {}) {
    this.id = options.id ?? createSessionId();
    this.#store = options.store ?? new MemorySessionStore();
  }

  append(message: AgentMessage): Promise<void> {
    return this.appendMany([message]);
  }

  appendMany(messages: readonly AgentMessage[]): Promise<void> {
    return this.#store.append(this.id, messages);
  }

  messages(): Promise<readonly AgentMessage[]> {
    return this.#store.read(this.id);
  }
}

function createSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
