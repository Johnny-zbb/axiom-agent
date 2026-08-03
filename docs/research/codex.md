---
title: Codex 架构调研
sidebar_position: 3
---

# OpenAI Codex 架构深度研究：Axiom Agent 实现

> 研究课题：Axiom Agent 业界成熟实现架构调研（对象：OpenAI Codex）
> 研究角度：聚焦"为什么这样设计"（架构思想），用于反推轻量 Axiom Agent（packages/core）
> 时效窗口：last_1_year（优先 2025–2026 资料）
> 成文日期：2026-07-30

---

## 1. 定位

OpenAI 用 "Codex" 这个品牌涵盖了**一整套软件工程 Agent 产品线**，而非单一工具。官方明确把 Codex 定义为 "a suite of software agent offerings"，至少包含四种形态：Codex CLI（本地终端）、Codex Cloud / Codex Web（云端异步）、Codex VS Code 扩展，以及 macOS 桌面 App ([OpenAI, *Unrolling the Codex agent loop*](https://openai.com/index/unrolling-the-codex-agent-loop))。其中真正可复用的"内核"被 OpenAI 称为 **harness（代理运行时）**——它提供所有 Codex 体验共享的核心 agent loop 与执行逻辑 ([OpenAI, *Unrolling the Codex agent loop*](https://openai.com/index/unrolling-the-codex-agent-loop))。

**两种核心形态及其 Harness 取舍**（这是理解 Codex 设计的关键分叉）：

- **Codex CLI —— 本地、交互式、同步**。一个用 Rust 编写、在用户本机运行的终端 AI 编程 Agent，定位语是 "a coding agent from OpenAI that runs locally on your computer" ([Toutiao 拆解 Codex](https://www.toutiao.com/article/7649651848315585065))。它直接写入用户的工作目录，借助操作系统级沙箱（macOS Seatbelt / Linux Landlock+seccomp / Windows Restricted Tokens）隔离命令执行，用户可实时看到推理、逐条审批工具调用 ([Daniel Vaughan, *CLI vs Cloud*](https://codex.danielvaughan.com/2026/04/18/codex-cli-vs-codex-cloud-when-to-use-each))。CLI 形态适合"紧反馈回路"：本地可复现的调试、探索陌生代码库、需要本地数据库/Docker 的任务。
- **Codex Cloud —— 云端、异步、委派式**。每次任务在独立的受隔离云容器中运行，预先克隆仓库、跑 setup 脚本，agent 阶段**默认断网**，耗时 1–30 分钟后产出可审查 diff/PR ([OpenAI, *Introducing Codex*](https://openai.com/index/introducing-codex/))。它面向"委派—切换—审查"的并行工作流：用户可并行提交多个任务、关闭笔记本、稍后审查。Codex Cloud 还提供合规可见性（Compliance API）与 Slack/@Codex、Linear 触发器 ([Daniel Vaughan, *Cloud vs Local*](https://codex.danielvaughan.com/2026/03/27/codex-cloud-vs-local-when-to-run-in-cloud))。

OpenAI 内部**两个团队分别攻克这两个切片**：Codex Web 负责异步云端方案，Codex CLI 负责本地迭代式开发，二者同在 2025 春季发布（CLI 4 月、ChatGPT 内 Codex 5 月）([ailinux, *How Codex is built*](https://ailinux.me/how-codex-is-built))。这种"一个核心 harness + 多端表面"的分工，正是 Codex 最值得借鉴的架构判断。

**底层模型**：云端由 `codex-1`（基于 o3、针对软件工程用强化学习训练的变体）驱动，强调贴近人类 PR 风格、精确遵从指令、迭代跑测试直到通过 ([OpenAI, *Introducing Codex*](https://openai.com/index/introducing-codex/))；CLI 默认用 `codex-mini-latest`（基于 o4-mini、面向低延迟代码编辑），云端与 CLI 共享同一模型目录 ([LoreAI, *Codex 完全指南*](https://loreai.dev/blog/codex-complete-guide))。

**为什么选 Rust**：团队在 TS / Go / Rust 间权衡后选 Rust，理由有三——性能（未来大规模部署时每毫秒都重要，本地沙箱内也需高效）、正确性（强类型与内存安全消除一类错误）、依赖最少（规避 npm 供应链不可控风险）、单二进制分发（用户无需装运行时）([ailinux, *How Codex is built*](https://ailinux.me/how-codex-is-built)；[Toutiao 拆解 Codex](https://www.toutiao.com/article/7649651848315585065))。

**面向谁**：开发者（处理 backlog 杂活、写测试、修 lint）、GitHub 团队（在 issue/PR 里 @codex）、学习代码库的初学者，以及"想委派而非自动补全"的用户 ([ai-tldr, *What Is OpenAI Codex*](https://ai-tldr.dev/learn/ai-coding-tools/coding-agents-assistants/what-is-openai-codex))。本质是**从"建议"（suggest）到"行动"（act）**的范式跃迁。

---

## 2. Architecture

Codex CLI 的架构可抽象为**四层堆叠**，每层职责边界清晰 ([grapeot.me, *Codex CLI 内部实现解析*](https://grapeot.me/share/codex-cli-internals-survey-20260314.html))：

1. **表面层（Surface）**：TUI（终端界面）、App Server（供 IDE/Web 调用的 JSON-RPC 服务）、MCP Server（供其他 agent 调用）、SDK（供 CI/CD 与脚本调用）。它们共享同一个 core，只是交互模式不同。
2. **会话层（Session）**：Thread 的创建/恢复/fork/归档、配置加载与切换、认证（含 ChatGPT OAuth）。Celia Chen 称之为 "the full agent experience beyond the core loop"。
3. **核心层（Core）**：`codex-rs/core/` 中的 agent loop 本身——接收输入、组装 prompt、调模型、处理 tool call、管理 context window。**所有 Codex 体验（CLI/Web/VS Code/macOS App/JetBrains/Xcode）共享这同一个核心**。
4. **执行层（Execution）**：sandbox 隔离、shell 命令执行、文件编辑、MCP tool 调度。

仓库本身是 Rust workspace（`codex-rs/`，含 `core`、`cli`、`tui`、`headless` 四个顶层 crate），外加 npm 分发壳 `@openai/codex`、`sdk/`、`docs/` ([dev.to, *71,700 Stars and 60 Rust Crates*](https://dev.to/ji_ai/71700-stars-and-60-rust-crates-inside-openais-codex-cli-source-363i))。`headless` crate 通过 stdio 上的 JSON-RPC 让 VS Code 扩展与 Web 应用连接同一引擎而无需 GUI。

**App Server（harness 的对外协议面）**是理解多端架构的钥匙。它是一个长生命周期进程，包含四个组件：① `stdio reader`（读客户端 JSON-RPC 请求）；② `Codex message processor`（把请求翻译成 core 操作、把 core 内部事件流翻译成稳定的 UI 通知）；③ `thread manager`（为每个 thread 拉起一个 core session）；④ `core threads`（实际执行 agent loop 的 core 实例）。stdio reader 与 message processor 共同构成翻译层 ([OpenAI, *Unlocking the Codex harness*](https://openai.com/index/unlocking-the-codex-harness))。

```
                          ┌─────────────────────────────────────────────┐
   多种 Surface 表面层     │  TUI  │  App Server(JSON-RPC)  │  MCP Srv │ SDK│
                          └───────────────┬─────────────────────────────┘
                                          │ Submission / Event 通道
                          ┌───────────────▼─────────────────────────────┐
   会话层 Session           │  Thread 生命周期 / 配置 / 认证 / 审批策略     │
                          └───────────────┬─────────────────────────────┘
                                          │
                          ┌───────────────▼─────────────────────────────┐
   核心层 Core (codex-rs/core)                                         │
   │  Agent Loop (AgentLoop.run)                                       │
   │    ├─ Context Builder (system + AGENTS.md + tools + history)      │
   │    ├─ LLM (Responses API, streaming)                              │
   │    ├─ Tool Router/Registry                                        │
   │    └─ Compaction / Prompt-cache 管理                              │
   └───────────────┬───────────────────────────────────────────────────┘
                   │ function_call → function_call_output
   ┌───────────────▼───────────────────────────────────────────────────┐
   执行层 Execution   │ Sandbox Executor │ unified_exec │ apply_patch │ MCP │
   │  (Seatbelt / Landlock+seccomp / Restricted Tokens)                │
   └────────────────────────────────────────────────────────────────────┘
```

**设计思想**：harness 与表面解耦。"Codex 在把 AI 写代码这件事，从模型能力往 runtime 能力上推"——harness 才是真正的产品核心，CLI/App/Web 只是不同外壳 ([CSDN, *Codex 是一套 Agent Harness Runtime*](https://blog.csdn.net/xx_nm98/article/details/161495071))。

---

## 3. Agent Loop

Codex CLI 的 agent loop 是**单 Agent、ReAct 风格**的循环，实现在 `AgentLoop.run()` 中（[zenn, *Exploring the Codex CLI Source*](https://zenn.dev/takiko/articles/e2b8065158c8d0?locale=en)）。其经典形态即 Think → Tool Call → Observe → Repeat，直到模型产出最终回复而不再请求工具（[PromptLayer via tool.lu, *How Codex Works*](https://tool.lu/article/7oS/preview)）。官方工程博客给出了最权威的措辞 ([OpenAI, *Unrolling the Codex agent loop*](https://openai.com/index/unrolling-the-codex-agent-loop))：

1. **Input**：取用户输入，构建发送给模型的文本指令集（prompt）。
2. **Inference**：prompt token 化后送模型采样，输出 token 转回文本（常封装在文本级 API 后，支持流式）。
3. **分支**：推理结果要么是对用户的最终回复，要么是一次 tool call 请求（如"运行 `ls` 并报输出"）。
4. **Execute & Re-query**：若请求工具，agent 在本地执行它，把输出追加回原 prompt 生成新输入，重新查询模型。
5. **终止**：循环"until the model stops emitting tool calls and instead produces a message for the user（assistant message）"。每个 turn 必以 assistant message 收尾（如"I added the architecture.md you asked for"），标志控制权交还用户。

```
User ──input──▶ AgentLoop.run()
                  │
                  ▼
        Context Builder: [system prefix + AGENTS.md + tool schemas + history]
                  │
                  ▼
        LLM  (Responses API, stream:true)  ◀── observation (function_call_output) 回灌
                  │                                  │
        ┌─────────┴───────────┐                      │
     text/final            function_call             │
        │                      │                      │
        ▼                      ▼                      │
   assistant message    Tool Executor (sandbox) ──────┘
   (turn 结束)          (unified_exec / apply_patch)
                        result → 追加为 input → 重新询模型
```

**LLM 调用位置**：在 `AgentLoop` 内通过 `this.oai.responses.create({ stream: true, input: turnInput, tools: [...] })` 发起；模型响应以流式事件返回，`response.output_item.done` 事件中若 `item.type === "function_call"` 则进入工具执行分支（[zenn, *Exploring the Codex CLI Source*](https://zenn.dev/takiko/articles/e2b8065158c8d0?locale=en)）。**Observation 如何返回**：工具执行结果作为 `function_call_output` 追加到原 prompt（新 input 列表尾部），模型据此重新推理（[OpenAI, *Unrolling the Codex agent loop*](https://openai.com/index/unrolling-the-codex-agent-loop)）。**何时结束**：模型停止产出 tool call、改为产出 assistant message（[OpenAI, *Unrolling the Codex agent loop*](https://openai.com/index/unrolling-the-codex-agent-loop)）。

**工具形态**：CLI 的工具主要是 `shell`/`container.exec` 与 `apply_patch`（文件补丁）；模型通过统一的 shell 执行器调用 `cat`/`grep`/`find`/`git` 等熟悉 CLI 工具，文件改动走严格 `apply_patch` 信封（[zenn](https://zenn.dev/takiko/articles/e2b8065158c8d0?locale=en)；[PromptLayer via tool.lu](https://tool.lu/article/7oS/preview)）。**自 0.107.0 起支持 subagent 委派**：每个 subagent 跑在独立 context window，主线程只回收精简摘要，既是上下文隔离也是成本优化（[Daniel Vaughan, *Context Budget*](https://codex.danielvaughan.com/2026/04/20/codex-cli-context-window-budget-token-management-large-codebases)）。

**设计思想**：单线程、顺序累积扁平消息历史，保证"straightforward, debuggable flow"——刻意避免多 Agent 并发的复杂度，与 Claude Code 同思路（[PromptLayer via tool.lu](https://tool.lu/article/7oS/preview)）。

---

## 4. State Model

Codex 的核心抽象是 **Session**：每个会话封装完整工作上下文——对话历史、工作目录、审批策略、沙箱配置、工具调用记录（[agent-io, *开源 Agent 架构之 Codex*](https://www.agent-io.com/posts/Agent-Analysis_Codex)）。状态管理是**分层**的：

- **会话级状态（持久化）**：对话历史、配置信息、Token 使用统计，写入磁盘。
- **Turn 级状态（临时）**：当前轮待处理的审批请求、用户输入，Turn 结束时自动清理（[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)）。

**通信即状态通道**：UI 与 Agent 核心通过两个通道解耦——`Submission` 通道（UI→Agent，如 `tx_sub`）与 `Event` 通道（Agent→UI，如 `rx_event`）。`Codex` 结构体只持有 `next_id`、`tx_sub`、`rx_event`，提供 `submit(op)` 与阻塞式 `next_event()`，形成 C/S 交互模式（[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)）。`submission_loop` 异步运行，按 `Op` 分类：`UserInput/UserTurn`（触发或注入任务）、`Compact/Review/Undo`（特殊任务）、`ExecApproval/PatchApproval`（审批响应）、`Interrupt/Shutdown`（中断/关闭）。

**Thread 是持久化容器**：可 create / resume / fork / archive，历史持久化到 `~/.codex/sessions/` 的 JSONL rollout 文件，支持随时中断与恢复；完成的会话自动归档（[OpenAI, *Unlocking the Codex harness*](https://openai.com/index/unlocking-the-codex-harness)；[Daniel Vaughan, *Session Forensics*](https://codex.danielvaughan.com/2026/06/05/codex-cli-session-forensics-jsonl-post-mortems-codex-trace-cass-ccusage)）。`spawn()` 接受 `conversation_history: InitialHistory` 与 `session_source` 以支持恢复（[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)）。

**哪些属于 Runtime / Context / Application**（本文分析）：

| 维度 | 归属 | 说明 |
|------|------|------|
| Agent loop 运行态、core session | **Runtime（core）** | `codex-rs/core` 内，进程内存 |
| 对话历史 items、system prompt、tool schema | **Context** | `ContextManager.items` 向量，决定发给模型的内容 |
| 审批策略、沙箱配置、UI、配置（config.toml） | **Application** | 由表面层/会话层注入，harness 消费但不拥有 |

**Rollout 文件结构**（observability 与状态重建的基础，见第 9 节）：每行一个 JSON 对象，`type` 有 `session_meta`、`turn_context`、`response_item`、`event_msg`（含 token_count）、`input_item`、`config_snapshot` 六类；工具调用与结果通过扁平的 `call_id` 关联（非嵌套 begin/end），因果须按事件顺序推断（[Daniel Vaughan, *Session Forensics*](https://codex.danielvaughan.com/2026/06/05/codex-cli-session-forensics-jsonl-post-mortems-codex-trace-cass-ccusage)）。

---

## 5. Context Engineering

Context Engineering 是 Codex 在长程任务中"跑得动"的关键。Prompt 装配（prompt assembly）包含：系统指令（编码规范、规则）、可用工具列表（含 MCP server）、实际输入（文本/图片/文件）、`AGENTS.md` 内容、本地环境信息（[ailinux, *How Codex is built*](https://ailinux.me/how-codex-is-built)）。Responses API 把这些信息组织成带 role 的 item 列表，优先级递减为 system / developer / user / assistant（[ZenML, *Codex CLI Architecture*](https://www.zenml.io/llmops-database/building-production-ready-ai-agents-openai-codex-cli-architecture-and-agent-loop-design)）。

**AGENTS.md（分层项目指引）**：散布在项目目录中的 `AGENTS.md` 被聚合成一个**上限 32KB 的 JSON blob** 注入 system prompt（[aihola, *Under the Hood*](http://aihola.com/article/openai-codex-cli-architecture)）。越是靠近工作目录的文件优先级越高；子目录 `AGENTS.md` 是**追加**（additive）而非覆盖，`AGENTS.override.md` 才在该层**替换**对应 `AGENTS.md`（[Daniel Vaughan, *Customisation Stack*](https://codex.danielvaughan.com/2026/04/12/codex-cli-customisation-stack-unified-system)）。建议"根文件短而架构化、服务级文件详细但限定作用域"，使上下文与任务范围成正比（[developertoolkit.ai, *Context Patterns*](https://developertoolkit.ai/en/codex/productivity-patterns/context-patterns)）。

**Compaction（压缩）**有两条路径（[lin-guanguo, *Codex Context Management Research*](https://lin-guanguo.github.io/llm-memory-research/codex-context.research/)）：
- **远端压缩（OpenAI 提供商）**：调用 `/responses/compact` 端点，服务端返回 `type=compaction` 且带 `encrypted_content` 的 item——加密内容保留模型潜在理解（对客户端不透明），可在推理中途触发；
- **本地压缩（非 OpenAI 提供商）**：客户端 LLM 摘要，用专门 compaction prompt 生成 handoff summary（进度/决策/约束/剩余工作），以带 `SUMMARY_PREFIX` 的 user message 注入。
触发阈值：`auto_compact_token_limit`（按模型可配）、`effective_context_window_percent` 默认 95%（[lin-guanguo](https://lin-guanguo.github.io/llm-memory-research/codex-context.research/)）。

**Prompt Caching（缓存）**是把二次成本拉回线性的主杠杆：Codex 每 turn 重发全量 `input`（为支持 ZDR 无状态，不用 `previous_response_id`），靠"旧 prompt 是新 prompt 的精确前缀"命中缓存，静态部分（system、tools、AGENTS.md）按低费率计费（[OpenAI, *Unrolling the Codex agent loop*](https://openai.com/index/unrolling-the-codex-agent-loop)；[Daniel Vaughan, *Don't Break the Cache*](https://codex.danielvaughan.com/2026/06/19/dont-break-the-cache-prompt-caching-research-codex-cli-cost-latency-optimisation-agent-loop)）。但缓存**脆弱**：改变 tool 顺序、沙箱配置、单条指令都会让前缀失配 → cache miss（[aihola](http://aihola.com/article/openai-codex-cli-architecture)；[Daniel Vaughan, *Don't Break the Cache*](https://codex.danielvaughan.com/2026/06/19/dont-break-the-cache-prompt-caching-research-codex-cli-cost-latency-optimisation-agent-loop)）。中途改配置以"追加同格式新消息（role=developer/user）"处理而非改旧消息，避免 miss（[OpenAI, *Unrolling the Codex agent loop*](https://openai.com/index/unrolling-the-codex-agent-loop)）。

**Tool 输出截断**：按模型配置在 `record` 时即截断，默认 `TruncationPolicyConfig::bytes(10_000)`，大输出永不全量进入 context（[lin-guanguo](https://lin-guanguo.github.io/llm-memory-research/codex-context.research/)）。**无状态 + 客户端持久化**：对 ZDR 场景不用 `previous_response_id`，改为把 `reasoning.encrypted_content` 存客户端、随下次请求回传，服务端内存解密即用即弃（[aihola](http://aihola.com/article/openai-codex-cli-architecture)）。

---

## 6. Tool System

工具系统通过 **`ToolSpec` 枚举**定义，每个工具用 JSON Schema 声明 input/output，Rust 下编译期即做 schema 校验（无运行时类型强制、无 `any` 逃逸）（[dev.to, *60 Rust Crates*](https://dev.to/ji_ai/71700-stars-and-60-rust-crates-inside-openais-codex-cli-source-363i)）。内置工具：`unified_exec`（命令执行）、`apply_patch`（代码修改）、`read_file`、`update_plan`（任务规划）等（[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)；[zenn](https://zenn.dev/takiko/articles/e2b8065158c8d0?locale=en)）。

**Shell 中心化设计**：CLI 本质上暴露一个通用 shell 执行器，模型通过它调用 `cat`/`grep`/`find`/`git` 等熟悉工具；文件改动走严格 `apply_patch` 信封——生成统一 diff，CLI 拦截后展示彩色 diff（红删绿增），用户可 approve/reject/edit/approve-all（[PromptLayer via tool.lu](https://tool.lu/article/7oS/preview)；[zenn](https://zenn.dev/takiko/articles/e2b8065158c8d0?locale=en)）。系统提示里就"教会模型一个 mini-API"，把工具契约与"keep working until done"偏置直接写进 prompt（[PromptLayer via tool.lu](https://tool.lu/article/7oS/preview)）。

**执行分层**：`ToolRouter`（解析/路由 内置/MCP/特殊工具）→ `ToolRegistry`（统一注册与查找）→ 执行编排（对系统操作统一处理审批、选沙箱、降级重试；只读工具直执行）→ `Sandbox Executor`（OS 级隔离）（[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)）。

```
 tool_call (name, args, call_id)
        │
        ▼
 ┌─────────────────┐
 │  Tool Router     │  内置 / MCP / 特殊
 └────────┬────────┘
          ▼
 ┌─────────────────┐
 │  Tool Registry   │  统一 schema 校验
 └────────┬────────┘
          ▼
 ┌─────────────────┐
 │ Exec Orchestrator│ 审批策略? → 选沙箱级别 → 降级重试
 └────────┬────────┘
          ▼
 ┌─────────────────┐
 │ Sandbox Executor │ macOS Seatbelt / Linux Landlock+seccomp / Windows Restricted Tokens
 └────────┬────────┘
          ▼
 function_call_output(call_id) ──▶ 回灌 Context
```

**沙箱三级策略**：read-only（代码分析）/ workspace-write（限定项目目录）/ full-access（仅容器）。macOS 用 Seatbelt，Linux 用 Landlock+seccomp，Windows 用 Restricted Tokens；网络默认禁用（[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)；[dev.to, *60 Rust Crates*](https://dev.to/ji_ai/71700-stars-and-60-rust-crates-inside-openais-codex-cli-source-363i)）。

**权限/审批**：三种模式 untrusted（每个非受信命令确认）/ auto-edit（沙箱内自主、越界才问）/ never（full-auto 全不提示）；`codex.tool_decision` 事件会记录决策来自配置（auto-approve）还是用户交互（[Daniel Vaughan, *CLI vs Cloud*](https://codex.danielvaughan.com/2026/04/18/codex-cli-vs-codex-cloud-when-to-use-each)；[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)）。**错误处理**：命令失败 → 错误信息回灌模型 → 模型诊断并尝试重试（[ailinux, *How Codex is built*](https://ailinux.me/how-codex-is-built)）。**MCP 工具与内置工具同等待遇**：同样的 schema 校验、同样的沙箱限制（[dev.to, *60 Rust Crates*](https://dev.to/ji_ai/71700-stars-and-60-rust-crates-inside-openais-codex-cli-source-363i)）。

---

## 7. Memory

Codex 的"记忆"由三层互补机制构成：

1. **短期（对话）记忆**：`ContextManager.items: Vec` 单向累积向量，内存中供 LLM 使用；`record_items()` 追加并做 per-item 截断，`for_prompt()` 做归一化与过滤（[lin-guanguo, *Codex Context Management Research*](https://lin-guanguo.github.io/llm-memory-research/codex-context.research/)）。
2. **长期（持久化）记忆**：每次会话以 JSONL rollout 写入 `~/.codex/sessions/YYYY/MM/DD/`，支持 resume / fork / archive 与随时中断恢复（[Daniel Vaughan, *Session Forensics*](https://codex.danielvaughan.com/2026/06/05/codex-cli-session-forensics-jsonl-post-mortems-codex-trace-cass-ccusage)；[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)）。`spawn()` 接受 `InitialHistory` 与 `session_source` 实现恢复（[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)）。
3. **指引型记忆（AGENTS.md / Memories）**：官方定制文档把"Memories for useful context learned from prior work"列为独立层，与 AGENTS.md（持久项目指引）并列；AGENTS.md 被视为跨会话的"反馈闭环"载体——纠正 agent 后让它更新 AGENTS.md，使修复在后续会话继承（[OpenAI, *Customization*](https://developers.openai.com/codex/concepts/customization/)）。

**检索（retrieval）**：短期靠 context window 内 items；长期靠 JSONL 复盘与 `/status` 检视当前上下文；subagent 委派则把"调查类"上下文隔离进可丢弃子窗口，主线程只回收摘要（[Daniel Vaughan, *Context Budget*](https://codex.danielvaughan.com/2026/04/20/codex-cli-context-window-budget-token-management-large-codebases)）。**存储**：本地 SQLite（`~/.codex/` 下）存会话状态、JSONL 存 rollout，**无任何云状态**——一切在用户机器上（[dev.to, *60 Rust Crates*](https://dev.to/ji_ai/71700-stars-and-60-rust-crates-inside-openais-codex-cli-source-363i)）。

**设计思想**：Codex 没有独立向量库式的"长期记忆"，而是把"记忆"拆为**会话持久化（JSONL）+ 项目指引（AGENTS.md）+ 上下文窗口管理（compaction）**三件事，分别用最小可行机制解决——这对轻量 harness 是重要启示：不必一上来就上 RAG。

---

## 8. Skills / Extension

Codex 的"定制栈"由五层互补能力组成（[OpenAI, *Customization*](https://developers.openai.com/codex/concepts/customization/)）：
- **AGENTS.md**：持久项目指引（行为塑造）
- **Memories**：从既往工作中学到的本地上下文
- **Skills**：可复用工作流与领域专长
- **MCP**：连接本地工作区之外的外部工具/系统
- **Subagents**：把工作委派给专门子 Agent

**Skill 定义**：一个 `SKILL.md`（必需，含 instructions + metadata）加可选 `scripts/`、`references/`、`assets/`。采用**渐进式披露（progressive disclosure）**：先暴露元数据（name/description）供发现，仅在被选中时加载 `SKILL.md`，需要时才读 references 或跑 scripts——让丰富工作流"可用但不预占上下文"（[OpenAI, *Customization*](https://developers.openai.com/codex/concepts/customization/)；[Daniel Vaughan, *Customisation Stack*](https://codex.danielvaughan.com/2026/04/12/codex-cli-customisation-stack-unified-system)）。Skills 可全局（`~/.agents/skills`）或仓库级（`.agents/skills`），可被显式调用，也可在任务匹配 description 时由模型隐式选择（[OpenAI, *Customization*](https://developers.openai.com/codex/concepts/customization/)）。

**Plugin（分发单元）**：`codex plugin marketplace add <org>/<name>` 可把 MCP server + skills 打包安装（如 MongoDB 官方插件一步装入 41+ 工具的 MCP server 与 7 个 skill）（[Daniel Vaughan, *MongoDB + Codex*](https://codex.danielvaughan.com/2026/05/26/codex-cli-mongodb-development-mcp-server-agent-skills-document-modelling-workflows)）。即：**Skill 是创作格式，Plugin 是可安装分发单元**。

**MCP（扩展主干）**：代码 `codex mcp add` 或在 `config.toml` 的 `[mcp_servers.*]` 配置，支持 STDIO 与 HTTP 两种 transport；MCP 工具与内置工具同 schema、同沙箱（[OpenAI, *Customization*](https://developers.openai.com/codex/concepts/customization/)；[Daniel Vaughan, *MongoDB + Codex*](https://codex.danielvaughan.com/2026/05/26/codex-cli-mongodb-development-mcp-server-agent-skills-document-modelling-workflows)）。

**Subagents（委派扩展）**：`.codex/agents/*.toml` 定义专门角色（如只读探索 Agent），把可并行的、限定作用域的任务委派出去，既并行又隔离上下文（[Daniel Vaughan, *Customisation Stack*](https://codex.danielvaughan.com/2026/04/12/codex-cli-customisation-stack-unified-system)；[Daniel Vaughan, *Context Budget*](https://codex.danielvaughan.com/2026/04/20/codex-cli-context-window-budget-token-management-large-codebases)）。

**harness 对外扩展面**：App Server 把 harness 暴露给任意客户端（Go/Python/TS/Swift/Kotlin 绑定）；CLI 还能以 MCP Server 模式运行，让"其他 agent 调用 Codex"——Codex 因此可扮演 code reviewer / 本地执行 worker / 富客户端 runtime 三种角色（[OpenAI, *Unlocking the Codex harness*](https://openai.com/index/unlocking-the-codex-harness)；[CSDN, *Codex Harness Runtime*](https://blog.csdn.net/xx_nm98/article/details/161495071)）。

---

## 9. Observability

Codex CLI **内建 OpenTelemetry**，通过 OTLP 导出三路信号：Logs（结构化事件）、Metrics（计数器与直方图）、Traces（span）（[last9, *Codex CLI 集成*](https://last9.io/docs/integrations/codex)；[Coralogix, *Codex CLI*](https://coralogix.com/docs/integrations/ai-observability/codex-cli/)）。

**关键事件**：`codex.user_prompt`（prompt 长度，内容默认脱敏）、`codex.tool_decision`（工具名、approve/deny、决策来自配置还是用户——调审批策略的金矿）、`codex.tool_result`（耗时/成功/输出片段）、`codex.sse_event`（token 计数：input/output/cached/reasoning/tool）（[last9](https://last9.io/docs/integrations/codex)；[Coralogix](https://coralogix.com/docs/integrations/ai-observability/codex-cli/)；[Daniel Vaughan, *OTel Observability*](https://codex.danielvaughan.com/2026/04/16/codex-cli-opentelemetry-observability-tracing-agent-sessions)）。所有事件共享 `conversation.id`，可端到端重建单次会话。

**Traces**：每个会话一个 trace，顶层 span `session_loop`（`service.name = codex_cli_rs`），子 span 覆盖 API 调用与工具调用（[Coralogix](https://coralogix.com/docs/integrations/ai-observability/codex-cli/)）。指标直方图涵盖 `codex.turn.e2e_duration_ms`、`codex.turn.ttft.duration_ms`、`codex.turn.token_usage`（按 input/output/cached/reasoning/tool 分类）、`codex.tool.call.duration_ms` 等（[last9](https://last9.io/docs/integrations/codex)）。

**Rollout JSONL 复盘（forensics）**：会话写 `~/.codex/sessions/.../rollout-{ts}-{uuid}.jsonl`，六类 `type` 事件（见第 4 节）；工具调用与结果靠扁平 `call_id` 配对，可 jq 提取工具时间线、按 turn 算 token 增量、定位最贵工具调用（[Daniel Vaughan, *Session Forensics*](https://codex.danielvaughan.com/2026/06/05/codex-cli-session-forensics-jsonl-post-mortems-codex-trace-cass-ccusage)）。v0.140.0 起 `/usage` 视图直接展示日/周 token 活动（[Daniel Vaughan, *Don't Break the Cache*](https://codex.danielvaughan.com/2026/06/19/dont-break-the-cache-prompt-caching-research-codex-cli-cost-latency-optimisation-agent-loop)）。社区工具 `codex-trace`（[GitHub, *PixelPaw-Labs/codex-trace*](https://github.com/PixelPaw-Labs/codex-trace)）把 JSONL 变成交互式会话查看器，支持实时 tail、工具调用检视、协作链追踪——专为"个人 AI harness 平台"设计。

**Evaluation（可验证证据）**：云端 Codex 通过终端日志与测试输出的**引用（citations）**提供可验证行动证据，不确定或测试失败时显式告知用户（[OpenAI, *Introducing Codex*](https://openai.com/index/introducing-codex/)；[OpenAI, *Codex System Card Addendum*](https://openai.com/index/o3-o4-mini-codex-system-card-addendum)）。**设计思想**：可观测性不是附加件，而是 harness 的一等公民——日志/追踪/复盘三件套开箱即用，可直接接 SigNoz / VictoriaMetrics / Oodle 等后端（[Daniel Vaughan, *OTel Observability*](https://codex.danielvaughan.com/2026/04/16/codex-cli-opentelemetry-observability-tracing-agent-sessions)）。

---

## 10. 对 Axiom Agent 的启发

结合"轻量 Axiom Agent / packages/core"目标，Codex 给出以下几点可落地启发：

1. **harness/core 与 surface 严格分离**。Codex 的真正产品是 `codex-rs/core` 这个"agent loop + 执行逻辑"的库+运行时，CLI/TUI/Web/IDE/MCP 只是外壳（[OpenAI, *Unlocking the Codex harness*](https://openai.com/index/unlocking-the-codex-harness)）。**建议**：`packages/core` 应只承载 agent loop、state、context、tool dispatch，绝不包含 UI；ConsoleAgent / SiteAgent 作为 surface 共用同一 core。

2. **用"对话原语"统一多端表现**。Codex 用 Item / Turn / Thread 三级原语（带 `started`/`delta`/`completed` 生命周期）表达非请求-响应式的 agent 交互（[OpenAI, *Unlocking the Codex harness*](https://openai.com/index/unlocking-the-codex-harness)）。**建议**：轻量 harness 不必照搬 JSON-RPC，但应内建等价的三级事件模型——这是后续 Trace/Evaluation 的数据底座。

3. **无状态请求 + 客户端持久化**。Codex 每 turn 重发全量 input（为 ZDR 不用 `previous_response_id`），把推理状态以 `encrypted_content` 存客户端（[OpenAI, *Unrolling the Codex agent loop*](https://openai.com/index/unrolling-the-codex-agent-loop)；[aihola](http://aihola.com/article/openai-codex-cli-architecture)）。**建议**：本地优先的轻量 harness 天然无服务端持久化需求，但应保留"可序列化会话状态 + 可恢复"的接口（对应你们的 Agent Trace 恢复）。

4. **静态前缀缓存纪律**。把 system / tool schema / 项目指引放在 prompt 前缀且保持稳定，动态内容（tool 结果、用户输入）严格追加在尾部，避免缓存失效（[Daniel Vaughan, *Don't Break the Cache*](https://codex.danielvaughan.com/2026/06/19/dont-break-the-cache-prompt-caching-research-codex-cli-cost-latency-optimisation-agent-loop)）。**建议**：`packages/core` 的 Context Builder 应把"稳定前缀 vs 动态尾部"作为一等概念。

5. **统一工具接口 + schema 校验 + 沙箱 + 审批策略**。ToolSpec/JSON Schema + 编译期校验 + 三级沙箱 + 三态审批，让"能力扩展"与"安全可控"解耦（[dev.to, *60 Rust Crates*](https://dev.to/ji_ai/71700-stars-and-60-rust-crates-inside-openais-codex-cli-source-363i)；[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)）。**建议**：你们的 MCP·Tool 调用应让内置工具与 MCP 工具走同一注册表/同一 schema/同一权限策略。

6. **surgical 编辑优于整文件重写**。Codex 用 `apply_patch` 约束模型产出最小 diff（[PromptLayer via tool.lu](https://tool.lu/article/7oS/preview)）。**建议**：若 harness 需要"写回环境"，应提供类似的受控 write-back 信封，而非让模型自由输出全文。

7. **subagent 委派做上下文隔离**。把只读/限定任务委派给独立 context window 的子 Agent（[Daniel Vaughan, *Context Budget*](https://codex.danielvaughan.com/2026/04/20/codex-cli-context-window-budget-token-management-large-codebases)）。**建议**：轻量 harness 可把"探索/检索"类子任务外包给 subagent，主上下文只回收摘要。

8. **可观测性第一天就内建**。OTel 日志/追踪/rollout 三件套是默认能力（[last9](https://last9.io/docs/integrations/codex)；[Daniel Vaughan, *Session Forensics*](https://codex.danielvaughan.com/2026/06/05/codex-cli-session-forensics-jsonl-post-mortems-codex-trace-cass-ccusage)）。**建议**：`packages/core` 的 Trace 不应事后补，而应作为 agent loop 的事件自然产物。

---

## 11. 对本项目设计的影响

本项目已有 ConsoleAgent / SiteAgent(Browser Agent) / MCP·Tool 调用 / DOM Grounding / Agent Trace·Evaluation 经验，`packages/core` 的定位与 Codex core 同构。具体映射与影响：

| 本项目资产 | 对应 Codex 概念 | 设计影响 |
|------------|----------------|----------|
| `packages/core` | `codex-rs/core`（harness 库+运行时） | core 只放 agent loop / state / context / tool dispatch，不得耦合 UI |
| ConsoleAgent | TUI 表面 | 与 SiteAgent 共用同一 core，通过相同的"提交/事件"通道通信（对齐 Codex 的 Submission/Event 双通道） |
| SiteAgent（Browser Agent） | headless / App Server 表面 | 把浏览器作为"环境"接入执行层，等价于 Codex 的 sandbox executor；其会话可经 App Server 式协议被远程驱动 |
| DOM Grounding | `apply_patch` / shell 中心化观察 | DOM Grounding 是 Codex "observation 回灌" 的浏览器版——把 DOM 状态作为 `function_call_output` 回灌模型；应设计成与文件/shell 观察同质的观察通道 |
| MCP·Tool 调用 | Codex MCP 集成 | 内置工具与 MCP 工具统一注册表、统一 schema、统一沙箱/审批；`ToolRouter` 模式可直接复用 |
| Agent Trace·Evaluation | rollout JSONL + OTel 事件 | Trace 用扁平 `call_id` 关联工具调用与结果（对齐 Codex rollout），events 带 `conversation.id` 端到端可重建；Evaluation 应消费 Trace 而非另起炉灶 |

**具体落地建议**：

1. **core 接口最小化**：参考 Codex `Codex` 结构体的 `submit()/next_event()`，把 `packages/core` 的对外 API 收敛为"提交一个 Op → 接收一串 Event"的双向通道；ConsoleAgent 与 SiteAgent 都只是这个通道的两端实现（[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)；[OpenAI, *Unlocking the Codex harness*](https://openai.com/index/unlocking-the-codex-harness)）。

2. **Context Builder 三段式**：`[稳定前缀(system + tool schema + 项目指引)] + [动态尾部(history + tool 结果)] + [observation(DOM/shell/file)]`，前缀稳定以利缓存，observation 始终追加尾部（[OpenAI, *Unrolling the Codex agent loop*](https://openai.com/index/unrolling-the-codex-agent-loop)；[Daniel Vaughan, *Don't Break the Cache*](https://codex.danielvaughan.com/2026/06/19/dont-break-the-cache-prompt-caching-research-codex-cli-cost-latency-optimisation-agent-loop)）。

3. **审批/沙箱策略可移植**：直接采用 untrusted / auto / full-auto 三态与 read-only / workspace-write / full-access 三级，作为 `packages/core` 的默认权限模型（[Daniel Vaughan, *CLI vs Cloud*](https://codex.danielvaughan.com/2026/04/18/codex-cli-vs-codex-cloud-when-to-use-each)；[agent-io](https://www.agent-io.com/posts/Agent-Analysis_Codex)）。

4. **会话可恢复**：把会话状态序列化为 JSONL/结构化记录（对齐 rollout），支持 resume/fork；这对长任务的 SiteAgent 尤其重要（[Daniel Vaughan, *Session Forensics*](https://codex.danielvaughan.com/2026/06/05/codex-cli-session-forensics-jsonl-post-mortems-codex-trace-cass-ccusage)）。

5. **Skill/扩展走渐进式披露**：若项目要支持可复用工作流，采用 `SKILL.md` + 元数据先暴露、按需加载正文的模式，避免预占上下文（[OpenAI, *Customization*](https://developers.openai.com/codex/concepts/customization/)）。

6. **把"评价"做成 harness 的内建产出**：Codex 云端用 citations（终端日志/测试输出）作为可验证证据（[OpenAI, *Introducing Codex*](https://openai.com/index/introducing-codex/)）——本项目 Agent Evaluation 应直接消费 Trace 中的 observation/tool_result 来自动判定"是否通过"，而非要求人肉审查。

**一句话总结**：Codex 证明了一件事——**一个与表面解耦、以"对话原语 + 统一工具 + 内建可观测"为骨架的 core，是支撑多端 Agent 的最小可行内核**。`packages/core` 应沿着这条线，把你们的 ConsoleAgent / SiteAgent / DOM Grounding / MCP·Tool / Trace 收敛进同一个 harness。

---

## 参考文献（APA 风格）

OpenAI. (2025, May 16). *Introducing Codex*. https://openai.com/index/introducing-codex/

OpenAI. (2025). *Addendum to OpenAI o3 and o4-mini system card: Codex*. https://openai.com/index/o3-o4-mini-codex-system-card-addendum

OpenAI. (2026, January 23). *Unrolling the Codex agent loop* (M. Bolin). https://openai.com/index/unrolling-the-codex-agent-loop

OpenAI. (2026, February 4). *Unlocking the Codex harness: how we built the App Server* (C. Chen). https://openai.com/index/unlocking-the-codex-harness

OpenAI. (n.d.). *Customization – Codex* (Developers documentation). https://developers.openai.com/codex/concepts/customization/

OpenAI. (n.d.). *Codex CLI source repository* (Apache-2.0). GitHub. https://github.com/openai/codex

takiko. (2025). *Exploring the OpenAI Codex CLI source code*. Zenn. https://zenn.dev/takiko/articles/e2b8065158c8d0

ZenML. (2026). *Building production-ready AI agents: OpenAI Codex CLI architecture and agent loop design*. https://www.zenml.io/llmops-database/building-production-ready-ai-agents-openai-codex-cli-architecture-and-agent-loop-design

PromptLayer. (2025). *How OpenAI Codex works behind-the-scenes (and how it compares to Claude Code)*. https://tool.lu/article/7oS/preview

agent-io. (2025). *开源 Agent 架构的设计与实现之：Codex*. https://www.agent-io.com/posts/Agent-Analysis_Codex

Peal, G. (2025). *How Codex is built*. https://ailinux.me/how-codex-is-built

ji_ai. (2025). *71,700 stars and 60 Rust crates: Inside OpenAI's Codex CLI source*. DEV. https://dev.to/ji_ai/71700-stars-and-60-rust-crates-inside-openais-codex-cli-source-363i

grapeot. (2026, March 14). *Codex CLI 内部实现解析：一个 Production-Grade Agent 客户端是怎么造的*. https://grapeot.me/share/codex-cli-internals-survey-20260314.html

Vaughan, D. (2026, April 20). *The model context window budget: Practical token management for large codebases*. https://codex.danielvaughan.com/2026/04/20/codex-cli-context-window-budget-token-management-large-codebases

Vaughan, D. (2026, June 19). *Don't break the cache: Prompt caching research and Codex CLI cost/latency optimisation*. https://codex.danielvaughan.com/2026/06/19/dont-break-the-cache-prompt-caching-research-codex-cli-cost-latency-optimisation-agent-loop

Vaughan, D. (2026, April 12). *The Codex CLI customisation stack: How AGENTS.md, Skills, MCP, Subagents, and Plugins compose into one system*. https://codex.danielvaughan.com/2026/04/12/codex-cli-customisation-stack-unified-system

Vaughan, D. (2026, April 16). *Codex CLI observability with OpenTelemetry: Tracing agent sessions, tool calls, and API requests*. https://codex.danielvaughan.com/2026/04/16/codex-cli-opentelemetry-observability-tracing-agent-sessions

Vaughan, D. (2026, June 5). *Codex CLI session forensics: JSONL post-mortems, codex-trace, cass, and ccusage*. https://codex.danielvaughan.com/2026/06/05/codex-cli-session-forensics-jsonl-post-mortems-codex-trace-cass-ccusage

Vaughan, D. (2026, April 18). *Codex CLI vs Codex Cloud: When to use each*. https://codex.danielvaughan.com/2026/04/18/codex-cli-vs-codex-cloud-when-to-use-each

Vaughan, D. (2026, March 27). *Codex Cloud vs Codex Local: When to run in the cloud*. https://codex.danielvaughan.com/2026/03/27/codex-cloud-vs-local-when-to-run-in-cloud

Vaughan, D. (2026, May 26). *Codex CLI for MongoDB development: MCP server, agent skills, and document modelling workflows*. https://codex.danielvaughan.com/2026/05/26/codex-cli-mongodb-development-mcp-server-agent-skills-document-modelling-workflows

lin. (n.d.). *Codex CLI context management research*. https://lin-guanguo.github.io/llm-memory-research/codex-context.research/

aihola. (n.d.). *How OpenAI's Codex CLI actually works under the hood*. http://aihola.com/article/openai-codex-cli-architecture

developertoolkit.ai. (n.d.). *Context management across Codex surfaces*. https://developertoolkit.ai/en/codex/productivity-patterns/context-patterns

last9. (n.d.). *OpenAI Codex CLI integration*. https://last9.io/docs/integrations/codex

Coralogix. (n.d.). *Codex CLI integration (AI observability)*. https://coralogix.com/docs/integrations/ai-observability/codex-cli/

PixelPaw-Labs. (n.d.). *codex-trace: OpenAI Codex CLI session log viewer* (GitHub). https://github.com/PixelPaw-Labs/codex-trace

Codex Workshop. (2026, May 21). *Codex CLI, GitHub, and MCP*. https://www.codexworkshop.com/research/codex-cli-workflows-20260521-0535

xx_nm98. (n.d.). *万字详解 codex 全链路架构：Codex 是一套 Agent Harness Runtime*. CSDN. https://blog.csdn.net/xx_nm98/article/details/161495071

LoreAI. (n.d.). *OpenAI Codex: The complete guide to cloud-based AI coding agents*. https://loreai.dev/blog/codex-complete-guide

ai-tldr. (n.d.). *What is OpenAI Codex? Cloud and CLI coding agents explained*. https://ai-tldr.dev/learn/ai-coding-tools/coding-agents-assistants/what-is-openai-codex

Toutiao. (n.d.). *拆解 OpenAI Codex：一个本地编码 Agent 的工程化设计全景*. https://www.toutiao.com/article/7649651848315585065
