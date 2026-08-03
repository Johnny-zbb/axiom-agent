---
title: 轻量 Axiom Agent 设计综述
sidebar_position: 2
---

# Axiom Agent 共性设计总纲

> 定位：反推轻量 Axiom Agent（`packages/core`）的共性设计依据
> 依据：Claude Code、OpenAI Codex、Pi Agent、OpenHarness 四项目研究（未含 Hermes，按用户决定跳过）
> 目标读者：负责 `packages/core` 实现的工程师

本文回答一个最小 Harness 必须包含什么、哪些能力必须内置（Core）、哪些应当插件化（Plugin）、Runtime 与 Application 的边界在哪里，并提炼跨四项目的共性设计模式，给出 `packages/core` 的目标定位与边界。所有结论均落点为可执行的设计建议，而非项目复述。

---

## 1. 一个最小 Harness 必须包含什么（最小内核清单）

四个成熟项目的共识高度一致：**Harness 是包裹在 LLM 之外的运行时基础设施，模型负责"决定做什么"，Harness 负责"如何安全高效地执行"**（[OpenHarness](../research/openharness.md) 的 "model is the agent, code is the harness" 与 [Claude Code](../research/claude-code.md) 的 "所有智能在模型侧、所有副作用在客户端侧" 同构）。

由此反推，一个最小 Harness 必须包含以下 7 个内核构件：

| # | 内核构件 | 职责 | 四项目佐证 |
|---|---------|------|-----------|
| 1 | **Agent Loop 引擎** | 单线程主循环 `while(tool_call){ execute; feed; }` | [Claude Code](../research/claude-code.md) queryLoop；[Codex](../research/codex.md) AgentLoop.run；[OpenHarness](../research/openharness.md) `engine/` |
| 2 | **Context Builder** | 每轮动态组装 system+history+memory+tool schema | 四项目均有等价模块（[Pi Agent](../research/pi.md) 的 `transformContext/convertToLlm`） |
| 3 | **State Store** | append-only 转录 + 会话级状态，支持 resume | [Claude Code](../research/claude-code.md) `history.jsonl`；[Codex](../research/codex.md) rollout JSONL |
| 4 | **Tool Registry + 执行模型** | 统一 schema、注册、派发、结果回流 | 四项目统一 "JSON schema + 注册表 + 执行" |
| 5 | **Permission Gate** | 调用前 deny-first 门禁 | [Claude Code](../research/claude-code.md) deny>ask>allow；[Codex](../research/codex.md) 三态审批 |
| 6 | **Hook / 事件总线** | 生命周期拦截 + 可观测信号 | [Claude Code](../research/claude-code.md) 12+ 事件；[Pi Agent](../research/pi.md) 20+ 事件 |
| 7 | **Observability Sink** | token/成本计数、trace 事件、可选 OTel | [Claude Code](../research/claude-code.md)、[Codex](../research/codex.md) 内建 OTel |

**设计建议**：`packages/core` 的 v1 内核 = 上述 7 件，对应导出 `agentLoop / buildContext / StateStore / ToolRegistry / PermissionGate / EventBus / Observability`。不在此清单中的一律外置（见第 3 节）。

---

## 2. Core（必须内置、始终在场）vs Plugin（可扩展、按需加载）

### 2.1 Core —— 必须内置，因为缺失会让循环不可运行或不可控

- **Agent Loop / Context Builder / State Store / Tool Registry**：循环的物理结构，缺一则 Agent 不成立。
- **Permission Gate（最小 deny-first 默认）**：安全默认应保守。即便 [Pi Agent](../research/pi.md) 默认不内置权限系统，也**至少提供 `beforeToolCall` 拦截点**——`packages/core` 应内置"默认拒绝 + 可配置放行"的最小门禁，而非完全缺失。
- **Hook / 事件总线**：是 Core 与 Plugin 之间唯一解耦面；若 Core 不发出事件，Plugin 无法介入（[Pi Agent](../research/pi.md) 的 Extension-first 哲学）。
- **Observability Sink**：token/成本计数是预算治理的第一手数据，应进循环内部（[OpenHarness](../research/openharness.md) 把计数放进循环）。

### 2.2 Plugin —— 必须可扩展，因为写死会令 Core 膨胀、违背"low-level"定位

- **Skills / Subagents / MCP server 连接器**：四类手段承载领域能力，应即插即用（[Claude Code](../research/claude-code.md) 的 Skills/Subagents/MCP；[Codex](../research/codex.md) 同）。
- **UI Surface（CLI / TUI / Web / IM / MCP-Server 模式）**：[Codex](../research/codex.md) 的 Surface 层、[OpenHarness](../research/openharness.md) 的 UI 与后端解耦，证明 UI 是外壳而非内核。
- **Provider 适配**：[Codex](../research/codex.md) 5 类 Workflow 抽象、[OpenHarness](../research/openharness.md) Provider 抽象，均把"模型接入"做成适配层；`packages/core` 只定义 LLM 调用契约（流式 `stream(messages, tools)`），具体 SDK 在 Plugin 层。
- **Observability 后端**：OTel 导出器（Prometheus/Grafana/Datadog）应可插拔，Core 只发标准事件。
- **Plugin 市场 / 打包分发**：[Codex](../research/codex.md) plugin marketplace、[OpenHarness](../research/openharness.md) 兼容 `claude-code/plugins` 格式。

**判据**：凡是"会随部署环境/领域/用户偏好变化"的，一律 Plugin；凡是"循环与治理的物理骨架"，一律 Core。

---

## 3. Runtime 与 Application 的边界

这是 `packages/core` 最关键的分层判据。四项目都把状态切成三层，但命名略有差异，本文统一为 **Runtime / Context / Application 三分**（详见 [state-model.md](state-model.md)）。此处先给 Runtime/Application 的分层定义与判据：

### 3.1 分层定义

- **Runtime State（运行时态）**：发生在一次执行 run / session 生命周期内的瞬时状态。包括 loop 控制变量、在途工具调用句柄、并行任务、重试/退避计数器、步骤计数、当前正在构建的 message 缓冲区。**位于进程内存，run 结束即清，仅转录（transcript）以 append-only 落盘。**
- **Context State（上下文态）**：每一轮实际发送给模型的内容视图（system + history + memory 召回 + tool schema + 压缩结果）。每轮动态重建，受 Token 预算约束，**不独立持久化**（是 Runtime/Application 的投影）。
- **Application State（应用态）**：跨会话、跨 run 持久，由部署方/应用层拥有。包括会话持久化、配置/设置、provider 注册、UI、领域对象（git 状态/worktree/DOM 快照）、项目规则（`CLAUDE.md`）、长期记忆（`MEMORY.md`）、扩展/插件注册表。

### 3.2 判据（一句话决策树）

> 问："这个状态会在进程退出后还被需要、且由使用者而非 Harness 拥有吗？"
> - 是 → **Application**（落盘，交给上层）。
> - 否，但它决定"模型下一轮看到什么" → **Context**（每轮重建）。
> - 否，且只在本次 run 内部流转 → **Runtime**（内存，不持久）。

[Codex](../research/codex.md) 的 `codex-rs/core` 只持有 Runtime+Context，审批策略/沙箱配置/UI 属 Application 由会话层注入；[Pi Agent](../research/pi.md) 的 `pi-agent-core` 只持有 Runtime，`session/provider/扩展注册` 在应用层——两者判据一致。

---

## 4. 跨四项目的共性设计模式

提炼出 8 个共性模式，作为 `packages/core` 的设计母题：

1. **Agent Loop 单线程 + 扁平历史**：`while(tool_call)` 极简循环换取可调试性，并行交给显式 Subagent 原语（[Claude Code](../research/claude-code.md)、[Codex](../research/codex.md) 同思路）。
2. **Context 动态构建**：每轮 `[稳定前缀(system+tool schema+项目指引)] + [动态尾部(history+tool 结果)]`，前缀稳定以利缓存（[Codex](../research/codex.md) 缓存纪律）。
3. **Tool 契约统一**：JSON Schema 定义 + 注册表 + 执行管线 + 文本结果回流；内置与 MCP 工具同等待遇（[Codex](../research/codex.md) ToolRouter 模式）。
4. **State 三分**：Runtime / Context / Application 互不污染（[Claude Code](../research/claude-code.md) §4 三分法）。
5. **Permission 默认拒绝**：deny > ask > allow，权限**不跨会话继承**（[Claude Code](../research/claude-code.md) 安全设计）。
6. **Observability 内建**：从第一天内置 trace/event/metric，span 精确映射 loop 结构（[Claude Code](../research/claude-code.md)、[Codex](../research/codex.md) 均内建 OTel）。
7. **Memory 用文件而非数据库**：短期=窗口内历史+compaction；长期=Markdown 指令文件（[Claude Code](../research/claude-code.md)、[OpenHarness](../research/openharness.md) `MEMORY.md`）。
8. **扩展靠原语而非硬编码**：Skills（按需）/ Subagents（隔离+并行）/ Hooks（确定性拦截）/ MCP（外部协议）/ Plugins（分发）。

---

## 5. `packages/core` 的目标定位与边界建议

**目标定位**：`packages/core` 是一个**与 UI、Provider SDK、领域对象完全解耦的"执行器内核"**——输入 messages + tools + 策略，输出事件流（`AsyncIterator<Event>`）。它"知道如何循环、如何组装上下文、如何门禁、如何执行、如何记录"，但"不知道用哪个具体模型、跑在哪个界面、解决哪个业务问题"。

**边界建议（明确内置/外置）**：

| 维度 | `packages/core` 内置（Core） | 外置（Plugin/应用层） |
|------|------------------------------|----------------------|
| 循环 | ✅ Agent Loop 引擎 | ❌ Subagent 调度策略细节 |
| 上下文 | ✅ 构建管线骨架 + 默认窗口裁剪 | ❌ RAG 检索后端、具体注入内容 |
| 工具 | ✅ Registry + 执行管线 + 入口校验 | ❌ 具体工具实现、MCP server 连接 |
| 安全 | ✅ deny-first 门禁 + Hook 拦截点 | ❌ 交互式审批 UI、沙箱具体实现 |
| 状态 | ✅ 三分模型 + append-only 转录 + resume 接口 | ❌ SQLite 后端（可选插件）、UI 状态 |
| 可观测 | ✅ 事件总线 + token/成本计数 | ❌ OTel 导出器、Dashboard |
| 模型 | ✅ 调用契约（`stream`） | ❌ Provider SDK（Plugin 适配） |

**一句话总结（给实现者）**：`packages/core` 只做"执行器"，不做"产品"——把推理留模型、把执行/管控/持久化留内核、把 UI/领域/Provider 留外壳，用事件总线与 Hook 作为唯一扩展面。

---

## 参考来源

- [Claude Code 架构研究](../research/claude-code.md)
- [OpenAI Codex 架构研究](../research/codex.md)
- [Pi Agent 架构研究](../research/pi.md)
- [OpenHarness 架构研究](../research/openharness.md)
