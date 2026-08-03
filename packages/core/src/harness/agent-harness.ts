import { executeTurn, type TurnResult } from "../loop/execute-turn.js";
import type { AgentEvent } from "../primitives/events.js";
import type { UserMessage } from "../primitives/messages.js";
import type { AgentDefinition } from "./agent-definition.js";
import { DefaultContextBuilder, type ContextBuilder } from "./context-builder.js";
import { Session } from "./session/session.js";
import { ToolRegistry } from "./tool-registry.js";

export interface AgentHarnessOptions {
  readonly agent: AgentDefinition;
  readonly session?: Session;
  readonly contextBuilder?: ContextBuilder;
  readonly maxTurns?: number;
}

export interface RunOptions {
  readonly maxTurns?: number;
  readonly signal?: AbortSignal;
}

export class HarnessBusyError extends Error {
  constructor() {
    super("AgentHarness is already running.");
    this.name = "HarnessBusyError";
  }
}

export class MaxTurnsExceededError extends Error {
  constructor(maxTurns: number) {
    super(`Agent run exceeded the maximum of ${maxTurns} turns.`);
    this.name = "MaxTurnsExceededError";
  }
}

export class AgentHarness {
  readonly agent: AgentDefinition;
  readonly session: Session;
  readonly tools: ToolRegistry;
  readonly #contextBuilder: ContextBuilder;
  readonly #defaultMaxTurns: number;
  #running = false;

  constructor(options: AgentHarnessOptions) {
    this.agent = options.agent;
    this.session = options.session ?? new Session();
    this.tools = new ToolRegistry(options.agent.tools);
    this.#contextBuilder = options.contextBuilder ?? new DefaultContextBuilder();
    this.#defaultMaxTurns = assertMaxTurns(options.maxTurns ?? 8);
  }

  get isRunning(): boolean {
    return this.#running;
  }

  async *run(input: string, options: RunOptions = {}): AsyncGenerator<AgentEvent, void> {
    if (this.#running) throw new HarnessBusyError();
    this.#running = true;

    const maxTurns = assertMaxTurns(options.maxTurns ?? this.#defaultMaxTurns);

    try {
      options.signal?.throwIfAborted();
      yield { type: "run_start", sessionId: this.session.id };

      const userMessage: UserMessage = { role: "user", content: input };
      await this.session.append(userMessage);
      yield { type: "message_start", role: "user" };
      yield { type: "message_end", message: userMessage };

      for (let turn = 1; turn <= maxTurns; turn += 1) {
        options.signal?.throwIfAborted();
        yield { type: "turn_start", turn };

        const context = await this.#contextBuilder.build({
          agent: this.agent,
          session: this.session,
          tools: this.tools.definitions(),
        });

        const stream = executeTurn({
          turn,
          sessionId: this.session.id,
          systemPrompt: context.systemPrompt,
          messages: context.messages,
          toolDefinitions: context.tools,
          tools: this.tools,
          model: this.agent.model,
          ...(options.signal ? { signal: options.signal } : {}),
        });

        const turnResult = yield* forwardTurn(stream);
        await this.session.appendMany([
          turnResult.assistantMessage,
          ...turnResult.toolResults,
        ]);

        if (!turnResult.shouldContinue) {
          yield {
            type: "run_end",
            sessionId: this.session.id,
            turns: turn,
            finalMessage: turnResult.assistantMessage,
          };
          return;
        }
      }

      throw new MaxTurnsExceededError(maxTurns);
    } catch (error) {
      const normalized = toError(error);
      yield { type: "run_error", sessionId: this.session.id, error: normalized };
      throw normalized;
    } finally {
      this.#running = false;
    }
  }
}

async function* forwardTurn(
  stream: AsyncGenerator<AgentEvent, TurnResult>,
): AsyncGenerator<AgentEvent, TurnResult> {
  while (true) {
    const item = await stream.next();
    if (item.done) return item.value;
    yield item.value;
  }
}

function assertMaxTurns(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError("maxTurns must be a positive integer.");
  }
  return value;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("Agent run failed with an unknown error.");
}
