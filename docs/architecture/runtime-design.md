---
title: Runtime 设计
sidebar_position: 3
---

# Runtime 架构设计依据

> 聚焦 Runtime 层：Agent Loop 的通用形态、模块职责、主循环 vs 子代理/并发、沙箱与权限边界、错误与重试位置。
> 对比 Claude Code / Codex / Pi Agent / OpenHarness，给出 `packages/core` 的 Runtime 设计建议（含事件流与生命周期契约）。

本文是 [设计综述](core-design-overview.md) 中"Core/Plugin 边界"与"Runtime/Application 分层"在 Runtime 维度的贯彻。Runtime 指**进程内的执行引擎**——它拥有 Loop、Context Builder、Tool 执行编排、Permission Gate、Hook 总线，但**不拥有 UI、Provider SDK、领域对象**（那些是 Application/插件）。

---

## 1. Agent Loop 的通用形态（跨四项目共识）

四个项目的循环骨架同构，可抽象为"单线程主循环 + ReAct 工具调用 + observation 回流"：

```
User Input → buildContext → LLM.stream(messages, tools)
                                  │ stop_reason == "tool_use"?
              ┌───────────────────yes───────────────────┐
              ▼                                            │
       Permission Gate → Hook(Pre) → Execute Tool → Hook(Post)
              │  tool_result (observation)                 │
              └────────── append → messages ──────────────┘
                                  │ no (纯文本 / maxSteps / 超时)
                                  ▼
                            Return / 交还控制权
```

- **LLM 调用点**：在每轮循环顶部，带"完整 messages + tools schema"调用一次，流式返回（[Claude Code](../research/claude-code.md) queryLoop；[Codex](../research/codex.md) `AgentLoop.run`；[OpenHarness](../research/openharness.md) `while True` ReAct）。
- **Observation 回流**：工具结果作为 `tool_result` 消息追加回 history，下一轮模型基于全部可见信息决策（[Claude Code](../research/claude-code.md)、[Codex](../research/codex.md) 同）。
- **终止条件**：① 模型产出纯文本（无 `tool_use`）；② 达到 `maxSteps`/超时；③ 被策略/hook 中断（[OpenHarness](../research/openharness.md) 显式 `maxSteps` 与超时）。

**设计建议**：`packages/core` 的 Loop 必须是"纯函数式执行点"——`调模型` 是循环里一个被横切能力（重试/并行/计数/压缩）包裹的调用点，而非侵入模型逻辑（[OpenHarness](../research/openharness.md) §3.2）。

---

## 2. 模块职责划分与交互

Runtime 内部模块与 [设计综述](core-design-overview.md) 内核清单一一对应：

| 模块 | 职责 | 关键接口 |
|------|------|---------|
| Loop Engine | 驱动 turn 流程、计数、超时 | `run(messages, input): AsyncIterator<Event>` |
| Context Builder | 每轮组装 system+history+memory+schema | `buildContext(session, budget): LlmMessages` |
| Tool Router/Registry | 解析/路由/校验/派发 | `dispatch(tool_call): ToolResult` |
| Permission Gate | 调用前 deny-first 判定 | `evaluate(tool_call, policy): Decision` |
| Hook Bus | 生命周期事件发射与拦截 | `emit(event); PreToolUse→block/allow` |
| Observability Sink | token/成本计数、trace span | `record(usage, span)` |

交互主链路（一次请求）：

```
Application 提交 Op → Loop Engine 启动 turn
  → Context Builder 组装 → LLM.stream
  → 若 tool_use：Permission Gate 判定 → Hook(PreToolUse) [可 block]
  → Tool Registry 派发执行 → Hook(PostToolUse)
  → tool_result 回流 messages → 继续 / 终止
```

[Codex](../research/codex.md) 的 App Server 把这个主链路封装为"Submission 通道（应用→内核）/ Event 通道（内核→应用）"双通道；[Pi Agent](../research/pi.md) 的 `submit()/next_event()` 同构。**建议 `packages/core` 对外收敛为"提交 Op → 接收 Event 流"的双向通道**，ConsoleAgent/SiteAgent 皆为其表面实现。

---

## 3. 主循环 vs 子代理 / 并发执行

**主循环是单线程、顺序累积扁平历史**（[Claude Code](../research/claude-code.md)、[Codex](../research/codex.md) 刻意避免多 Agent 并发复杂度）。并发走**显式子代理原语**，且**默认一次只派生有限分支**（[Claude Code](../research/claude-code.md) 建议）。

- **子代理隔离**：每个 Subagent 跑在独立 context window，主线程只回收精简摘要（[Codex](../research/codex.md) 0.107+ subagent；[Claude Code](../research/claude-code.md) subagent 返回最终消息+元数据）。[Pi Agent](../research/pi.md) 用 `pi-orchestrator` 做 RPC 子代理编排。
- **同轮并行工具**：多个 `tool_use` 默认可并行（[OpenHarness](../research/openharness.md) 同轮并行；[Pi Agent](../research/pi.md) 默认并行、可 `sequential` 覆盖）。
- **SiteAgent 即"环境特化的 Subagent"**：浏览器任务需自身 context 隔离 + DOM Grounding，复用 subagent 思想——独立 context、仅返回摘要（[Claude Code](../research/claude-code.md) 讨论）。

**设计建议**：`packages/core` 内置主循环 + Subagent 派发/隔离/恢复（resume by id）原语；Subagent 不是 Core 内部并发，而是 Application 通过 `registerTool`/`Agent tool` 触发的**独立 Context 实例**。并行工具执行由 Loop 在单轮内 fan-out，结果按 `call_id` 关联回流。

---

## 4. 沙箱与权限执行边界

**权限门禁位于派发前（Pre-execution）**，是横切拦截而非工具内硬编码（[OpenHarness](../research/openharness.md) §6.4；[Claude Code](../research/claude-code.md) deny-first）。

- **权限模式**：`default`（交互确认）/ `plan`（只读探索）/ `auto`（沙箱内自主）/ `strict`（严格治理）。评估顺序 **deny > ask > allow**，deny 永远优先（[Claude Code](../research/claude-code.md)）。
- **沙箱三级**：read-only / workspace-write / full-access（[Codex](../research/codex.md) macOS Seatbelt / Linux Landlock+seccomp / Windows Restricted Tokens；Cloud 默认断网）。
- **权限不跨会话继承**：resume 时全量历史还原但需重新批准（[Claude Code](../research/claude-code.md) 刻意安全设计）。
- **Hook 比规则更可靠**：`PreToolUse` 可返回 `deny` 阻断（[Claude Code](../research/claude-code.md)）。

**设计建议（边界判据）**：Permission Gate 属 **Core**（最小 deny-first 内置）；但"交互式审批 UI"与"具体沙箱实现"属 **Application/插件**（容器/微 VM/OS 级隔离由部署方提供）。`packages/core` 暴露 `PermissionPolicy` 接口，内置 default/plan/auto/strict + 路径/命令规则，审批与沙箱实现可替换。

---

## 5. 错误与重试的位置

- **易错逻辑放 Harness 而非模型**：输出溢出、上下文过长由 Loop 层处理（[Claude Code](../research/claude-code.md) 最大输出 token 升级、响应式压缩）。
- **API 失败**：指数退避重试（[OpenHarness](../research/openharness.md) 退避重试；[Claude Code](../research/claude-code.md) 每轮最多 3 次重试）。
- **工具失败**：错误信息回灌模型，模型诊断并尝试重试（[Codex](../research/codex.md)）；结果应"能指导下一步"而非仅返回失败（[Claude Code](../research/claude-code.md) 好工具标准）。
- **prompt-too-long**：依次 context-collapse → 响应式压缩 → 终止（[Claude Code](../research/claude-code.md)）。

**设计建议**：重试/退避/并行/计数/压缩均为**循环级横切能力**，工具本身无感知（[OpenHarness](../research/openharness.md) §3.2）。`packages/core` 在 Loop 层内置：① API 指数退避；② 同轮并行 + 串行覆盖；③ `maxSteps` 与超时；④ 超限响应式压缩（v1 先实现"超限摘要"，[Claude Code](../research/claude-code.md) 5 策略可后续分级）。

---

## 6. `packages/core` Runtime 设计建议（事件流 + 生命周期契约）

**事件流契约**（对齐 [Claude Code](../research/claude-code.md) span 层级、[Codex](../research/codex.md) rollout、`interaction → llm_request / tool / hook`）：

```typescript
AsyncIterator<Event> where Event ∈ {
  turn.start,                 // 一轮开始
  context.built,              // Context 组装完成（含 token 计数）
  llm.request,                // 模型调用（含模型名，不记内容）
  text.delta,                 // 流式文本
  tool.call,                  // 即将执行（含权限判定结果 blocked/allow）
  tool.result,                // 工具结果（observation，可 opt-in 内容）
  hook.fire,                  // Pre/Post ToolUse
  compaction,                 // 触发压缩
  cost,                       // token/成本增量
  turn.end,                   // 一轮结束
  done                        // 全部结束
}
```

**生命周期契约**：`session.start → (turn.start … turn.end)* → session.end/fork/resume`。Subagent 经 `Agent tool` 派生，其 span 嵌套于父 `tool.call` 下（对齐 [Claude Code](../research/claude-code.md) subagent span 嵌套）。敏感数据默认只记时长/模型名/工具名，内容采集由 `OTEL_LOG_TOOL_CONTENT` 类开关 opt-in（对齐 [Claude Code](../research/claude-code.md) §9）。

**一句话**：Runtime 是"单线程主循环 + 横切能力叠加 + 事件流输出"的执行器；子代理是显式隔离原语，权限/沙箱/重试是派发前与循环级的横切关注点，绝不侵入模型调用逻辑。

---

## 参考来源

- [Claude Code 架构研究](../research/claude-code.md)
- [OpenAI Codex 架构研究](../research/codex.md)
- [Pi Agent 架构研究](../research/pi.md)
- [OpenHarness 架构研究](../research/openharness.md)
