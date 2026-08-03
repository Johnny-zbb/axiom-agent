---
title: State 模型设计
sidebar_position: 6
---

# State Model 设计依据

> 聚焦 State 层：状态的三分（Runtime State / Context State / Application State），各自生命周期、存储位置、跨 turn/session 持久化、session resume 机制。
> 对比 Claude Code / Codex / Pi Agent / OpenHarness，给出 `packages/core` 的 State 模型设计（含落点表与数据结构草图）。

本文是 [设计综述](core-design-overview.md) 第 3 节"Runtime/Application 边界"的完整展开，并补入 Context State 作为投影层。三分的根本动机：**把"会变化的运行时状态"与"每轮重建的上下文状态"与"跨会话持久的应用状态"分离，使 compaction、resume、subagent 隔离在各自边界内独立处理、互不污染**（[Claude Code](../research/claude-code.md) §4）。

---

## 1. 三分模型定义与对比

| 状态类别 | 包含什么 | Claude Code | Codex | Pi Agent | OpenHarness |
|---------|---------|-------------|-------|----------|-------------|
| **Runtime State** | loop 控制变量、在途工具句柄、并行任务、重试计数、步骤计数、当前 message 缓冲 | transcript(JSONL)、工具结果流 | core session、turn 级临时态 | `AgentMessage[]`、双队列、执行标志 | messages 缓冲、并行句柄、计数 |
| **Context State** | system+history+CLAUDE.md+skills+tool schema+memory 召回+压缩结果 | 每轮重建 | `ContextManager.items` | `convertToLlm` 后视图 | prompts/ + context/ 动态组装 |
| **Application State** | session 持久化、配置、provider 注册、UI、领域对象、CLAUDE.md、MEMORY.md、插件注册 | git/worktree/roster/配置 | 审批策略/沙箱/UI/config | session/分支/扩展注册 | 会话历史/MEMORY.md/settings |

**关键共性**：
- Runtime 与 Context 在进程内存，Application 持久化（[Codex](../research/codex.md)、[Pi Agent](../research/pi.md) 同）。
- Context 是 Application + Runtime 的**投影**，不独立持久化。
- Application 不锁死在内核：HKUDS 版 `messages` 显式传递，TS 同名项目推到极致"pass in history, get back events"（[OpenHarness](../research/openharness.md)）。

---

## 2. 各自生命周期与存储位置

### 2.1 Runtime State
- **生命周期**：一次 run / session 内部；turn 结束清理 turn 级临时态。
- **存储**：进程内存；仅 transcript 以 **append-only JSONL** 落盘（`~/.claude/projects/.../history.jsonl`，[Claude Code](../research/claude-code.md)）。
- **不可变更新**：[Pi Agent](../research/pi.md) 采用 COW（写时复制），工具/消息数组原子替换，Hook 拿一致快照——避免就地修改导致的竞态与不可重放。
- **设计建议**：`packages/core` 的 Runtime State 用不可变更新（COW）维护 `messages` 与执行标志；不持久化，但 transcript 以 append-only 落盘供 resume。

### 2.2 Context State
- **生命周期**：每轮 LLM 调用前动态重建，受 Token 预算约束；compaction 后失效重建。
- **存储**：不独立持久化（是 Runtime/Application 的投影）。
- **设计建议**：由 [context-design.md](context-design.md) 的管线每轮构建；Core 不持有"context 对象"，只在调用 `buildContext()` 时产生。

### 2.3 Application State
- **生命周期**：跨 session、跨 run 持久，由部署方拥有。
- **存储**：落盘文件（Markdown / JSON / JSONL），可版本化、可审阅（[OpenHarness](../research/openharness.md) 把 CLAUDE.md/MEMORY.md/settings.json 下沉文件）。
- **设计建议**：Application State 全由上层/插件拥有；`packages/core` 只定义序列化接口（resume/fork）与默认 JSONL 后端，不强制数据库（[Pi Agent](../research/pi.md) "without a database"）。

---

## 3. 跨 turn / session 持久化

- **跨 turn**：扁平消息历史 append-only 累积（[Claude Code](../research/claude-code.md)、[Codex](../research/codex.md)、[Pi Agent](../research/pi.md) 同）。[Pi Agent](../research/pi.md) 用 `AgentMessage[]` + COW。
- **跨 session**：JSONL rollout 持久化（`~/.codex/sessions/` 六类 `type` 事件，[Codex](../research/codex.md)）；或 JSONL 树（`id/parentId` 分支，[Pi Agent](../research/pi.md)）。
- **无状态 + 客户端持久化**：[Codex](../research/codex.md) 每 turn 重发全量 input（为 ZDR 不用 `previous_response_id`），把 `encrypted_content` 存客户端。

**设计建议（落点表）**：

| State | 落点（v1） | 序列化 |
|-------|-----------|--------|
| Runtime | 进程内存 + append-only transcript | JSONL（仅转录） |
| Context | 不落盘，每轮重建 | — |
| Application | 会话目录 `sessions/<id>.jsonl` + `CLAUDE.md` + `MEMORY.md` + `settings.json` | JSONL 树 + Markdown |

---

## 4. Session Resume 机制

- **[Claude Code](../research/claude-code.md)**：`--continue/--resume` 同 session id 续写；`--fork-session` 保留历史生成新 id；**全量历史还原但权限不继承**（刻意安全）。
- **[Codex](../research/codex.md)**：Thread create/resume/fork/archive；`spawn()` 接受 `InitialHistory` + `session_source`；rollout 可随时中断恢复。
- **[Pi Agent](../research/pi.md)**：JSONL 树支持从历史任意 turn 创建分支（`/tree`），零数据库获得 branch/undo/compact/full history。
- **[OpenHarness](../research/openharness.md)**：Session Resume 断点续聊，Auto-Compact 跨压缩保留任务状态。

**设计建议**：`packages/core` 提供 `session.resume(id)` / `session.fork(id)` / `session.archive(id)`；resume 全量重放 transcript 但**不继承权限**（对齐 [Claude Code](../research/claude-code.md)）。可选 SQLite 后端加速恢复（[Pi Agent](../research/pi.md) PR #6594），但非默认。

---

## 5. `packages/core` State 模型数据结构草图

```typescript
// Runtime State（内存，COW）
interface RuntimeState {
  messages: AgentMessage[];        // append-only，不可变更新
  steering: Queue<Message>;        // mid-turn 打断（借鉴 Pi Agent）
  followUp: Queue<Message>;        // turn 后追加
  inFlight: Map<call_id, ToolCall>; // 在途工具
  retryCount: number;
  stepCount: number;
}

// Context State（每轮由 buildContext 产生，不持久）
interface ContextView {
  system: string;
  history: AgentMessage[];
  memory: MemoryEntry[];
  toolSchemas: ToolDefinition[];
  tokenCount: number;
}

// Application State（落盘，上层拥有）
interface ApplicationState {
  sessionId: string;
  parentId?: string;               // 分支树（借鉴 Pi Agent JSONL 树）
  config: Settings;                // 权限模式、沙箱级别
  providerRegistry: ProviderRef[];
  extensionRegistry: ExtensionRef[];
  memory: MemoryFileRef;           // MEMORY.md
  rules: RuleFileRef;              // CLAUDE.md / AGENTS.md
}
```

**transcript 记录（append-only JSONL，对齐 [Codex](../research/codex.md) rollout 六类）**：

```json
{"type":"session_meta","id":"...","model":"..."}
{"type":"turn_context","token_count":1234}
{"type":"response_item","role":"assistant","tool_calls":[{"call_id":"c1","name":"read","args":{...}}]}
{"type":"input_item","role":"tool","call_id":"c1","content":"..."}
{"type":"config_snapshot","permission":"default"}
{"type":"event_msg","kind":"cost","usage":{"input":..,"output":..}}
```

---

## 6. 设计总结

- **三分互不污染**：Runtime（瞬时/内存+转录）、Context（投影/不持久）、Application（持久/上层拥有）。
- **不可变更新**：Runtime 用 COW，Hook 拿一致快照（[Pi Agent](../research/pi.md)）。
- **文件优于数据库**：Application 用 JSONL 树 + Markdown，零数据库获得分支/回滚/重放（[Pi Agent](../research/pi.md)、[Claude Code](../research/claude-code.md)）。
- **resume 不继承权限**：安全边界不跨会话（[Claude Code](../research/claude-code.md)）。
- **Core 只定义接口与默认 JSONL 后端**，SQLite/UI/领域对象外置。

**一句话**：State 是"三分隔离 + 不可变 + 文件式持久"的模型——`packages/core` 持有 Runtime（内存+转录）与 Context（每轮投影），Application 全交上层落盘，用 append-only JSONL 树支撑 resume/fork/branch，权限绝不跨会话继承。

---

## 参考来源

- [Claude Code 架构研究](../research/claude-code.md)
- [OpenAI Codex 架构研究](../research/codex.md)
- [Pi Agent 架构研究](../research/pi.md)
- [OpenHarness 架构研究](../research/openharness.md)
