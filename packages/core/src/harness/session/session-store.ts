import type { AgentMessage } from "../../primitives/messages.js";

export interface SessionStore {
  append(sessionId: string, messages: readonly AgentMessage[]): Promise<void>;
  read(sessionId: string): Promise<readonly AgentMessage[]>;
}
