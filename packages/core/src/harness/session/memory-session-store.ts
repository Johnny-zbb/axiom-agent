import type { AgentMessage } from "../../primitives/messages.js";
import type { SessionStore } from "./session-store.js";

export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, AgentMessage[]>();

  async append(sessionId: string, messages: readonly AgentMessage[]): Promise<void> {
    const current = this.#sessions.get(sessionId) ?? [];
    this.#sessions.set(sessionId, [...current, ...messages]);
  }

  async read(sessionId: string): Promise<readonly AgentMessage[]> {
    return [...(this.#sessions.get(sessionId) ?? [])];
  }
}
