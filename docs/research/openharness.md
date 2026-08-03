---
title: OpenHarness 架构调研
sidebar_position: 5
---

# OpenHarness 深度架构研究

> 研究课题：Axiom Agent 业界成熟实现架构调研（聚焦"为什么这样设计"）
> 执行模式：完整（含审稿） ｜ 时效窗口：last_1_year（优先 2025–2026 资料）
> 用途：反推一个轻量 Axiom Agent（`packages/core`）的设计

---

## 0. 「OpenHarness」界定说明（必读）

公开资料中**存在两个同名但代码库不同的项目**，必须先行澄清，以免混用：

1. **HKUDS OpenHarness（本研究的主界定对象）**：由香港大学数据智能实验室（HKUDS）开源的**纯 Python** 轻量 Agent Harness，CLI 入口为 `oh`，仓库为 `github.com/hkuds/openharness`，MIT 许可，2026-04-01 发布 v0.1.0，截至研究时演进至 v0.1.9（约 429 commits）。其设计目标是"以轻量代码复刻 Claude Code 的 Harness 架构"，与本研究"反推轻量 harness"的诉求高度契合，故作为**主分析对象** ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
2. **TypeScript 同名项目（`@openharness/core`，docs.open-harness.dev）**：一个基于 Vercel AI SDK 5 的 **TypeScript/JavaScript** 框架，提供 `Agent`、`createFsTools`、`createBashTool` 等 API，强调 Stateless Agents、Composable Middleware、Subagent Delegation、MCP、AI SDK 5 UI Streaming ([OpenHarness Introduction](https://docs.open-harness.dev/))。**它与 HKUDS 项目是不同团队、不同语言的两个独立项目**，仅命名相同、设计哲学相似。

**本研究的界定与依据**：以 **HKUDS OpenHarness（Python, `oh`）** 为唯一主对象；仅在"设计思想可类比"之处，明确标注地引用 TS 同名项目作为**对照/类比**，绝不将两者源码或细节混为一谈。所有事实性陈述均标注来源；第二节起的"未核实"项会单独标注。

---

## 1. 定位

**OpenHarness 是什么类型的 Agent？** 它定位为**通用型（General-purpose）、以 Coding 为核心的 Agent Harness**——即包裹在 LLM 之外的"运行时基础设施"，把任意 LLM 变成具备工具调用、记忆、安全治理与多 Agent 协调能力的智能体 ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。其官方定义极具代表性：

> "An agent harness is the complete infrastructure that wraps around an LLM to make it a functional agent. The model provides intelligence; the harness provides hands, eyes, memory, and safety boundaries." ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))

**解决什么问题？** 它将"生产级 AI Agent 的通用痛点"——工具集成、记忆管理、安全管控、循环执行、多模型适配——收敛为一套**可理解、可实验、可扩展**的轻骨架，避免开发者直接面对 Claude Code 这类 51 万行（TypeScript）企业级代码库的复杂度 ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。

**面向谁？** 官方明确指向三类人：**研究者（理解生产 Agent 的底层原理）、构建者（在成熟架构上搭建专用 Agent）、社区（贡献插件/Provider/领域知识）** ([cloud.tencent – OpenHarness](https://cloud.tencent.com.cn/developer/article/2692900))。

**为什么这样设计（定位层面的"为什么"）**：其设计哲学是一句话——**"The model is the agent. The code is the harness."（模型即智能体，代码即挽具）** ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。这意味着它刻意**不训练新模型**，而是把价值放在"执行层"：既然模型只负责"决定做什么（What）"，那么工程上值得重金投入的，是把"如何安全、高效地执行（How）"做到极致且可控。这种"模型无关 + 执行层解耦"的定位，正是它把工程价值压在"执行层"的根本原因。至于"11,733 行 Python（约为 Claude Code 1/44）""复刻 98% 工具能力、61% 命令集"等说法，均属二手/媒体口径——**源码核验显示全仓 Python 约 80,970 行（src/openharness 约 46,220 行），默认注册工具 39 个**，上述行数与比例均未被代码证实（详见第 12 节）([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。

---

## 2. Architecture

### 2.1 架构图（基于可确认模块构建；标注推测）

OpenHarness 采用"**智能层（模型）与执行层（工具/记忆/安全）分离**"的扁平模块化子系统设计，由 10+ 个边界清晰的子系统组成 ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。核心模块与交互如下：

```
┌──────────────────────────────────────────────────────────────────────┐
│                         User / IM (Feishu·Slack·TG·Discord)           │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ prompt / event
┌───────────────────────────────▼──────────────────────────────────────┐
│  UI Layer  (React + Ink TUI  ·  HTTP Gateway  ·  CLI `oh` / `ohmo`)   │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ (后端可独立运行，UI 与后端通过 stdio/HTTP 解耦)
┌───────────────────────────────▼──────────────────────────────────────┐
│  RuntimeBundle  (会话/配置/Provider 抽象)                              │
│   ├─ prompts/   系统提示组装 + CLAUDE.md + Skills 注入                │
│   ├─ engine/    ★ Agent Loop 主循环（流式工具调用、重试、并行、计数） │
│   ├─ context/   History Management + Auto-Compact（Token 预算）       │
│   ├─ permissions/  多级权限模式 + 路径/命令规则                       │
│   └─ hooks/     PreToolUse / PostToolUse 生命周期拦截                │
└──────────┬───────────────────────────────────┬──────────────────────┘
           │ API call (Anthropic/OpenAI/... 兼容)  │ tool_use
┌──────────▼──────────┐              ┌─────────────▼────────────────────┐
│ Provider Abstraction│              │ Tool Registry (39 default tools)    │
│ (5 类 Workflow 接入) │              │  FileIO·Shell·Search·Web·MCP·    │
│ Anthropic / OpenAI  │              │  Notebook·Agent·Task·Schedule·Meta│
│ ClaudeSub / CodexSub│              └─────────────┬────────────────────┘
│ GitHub Copilot      │                            │ execute (经权限+Hook)
└─────────────────────┘              ┌─────────────▼────────────────────┐
                                      │ Environment: FS · Shell · Web ·  │
                                      │ MCP Servers · Subagents(coordinator)│
                                      └───────────────────────────────────┘
        ┌──────────── memory/ (MEMORY.md 跨会话持久) · tasks/(后台任务) ─┐
```

> 说明：上述模块名（`engine/`、`tools/`、`skills/`、`plugins/`、`permissions/`、`hooks/`、`commands/`、`mcp/`、`memory/`、`tasks/`、`coordinator/`、`prompts/`、`config/`、`ui/`）直接来自官方仓库目录结构 ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))；连线与数据流为基于 README 描述的逻辑重构，**非逐文件还原**。

### 2.2 核心交互（一次请求的主链路）

官方给出的 Harness Flow 可抽象为：

```
User Prompt → CLI/TUI → RuntimeBundle → QueryEngine → Anthropic-compatible API
                                                        │ tool_use
                                                        ▼
                                              Tool Registry → Permissions+Hooks
                                                        │
                                                        ▼
                              Files / Shell / Web / MCP / Tasks → 结果回流 QueryEngine（循环）
```
([HKUDS/OpenHarness](https://github.com/hkuds/openharness))

**为什么这样设计（架构层面的"为什么"）**：
- **扁平子系统而非深层嵌套**：把"循环、上下文、权限、钩子、记忆、协调"切成正交模块，各自通过明确定义接口解耦，使研究者能单独替换某一层（如换 Provider、加 Tool、写 Plugin）而不动全局 ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。
- **UI 与后端解耦**：React TUI 只是"可选前端"，后端可独立以 `stdio`/HTTP 运行，支持 `oh -p "..." --output-format json` 的无头/CI 模式 ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。这把"交互"与"智能体内核"分离，使同一内核既能进终端、进 IM、进流水线。
- **Provider 抽象成"5 类 Workflow"**：Anthropic 兼容、OpenAI 兼容、Claude 订阅复用、Codex 订阅复用、GitHub Copilot OAuth——把"模型接入"做成适配层而非硬编码，是"模型无关"定位的落地 ([cloud.tencent – OpenHarness](https://cloud.tencent.com.cn/developer/article/2692900))。

---

## 3. Agent Loop

### 3.1 一次 turn 的标准流程

官方 README 给出的循环伪代码清晰地表达了"输入→构建上下文→LLM→工具调用？→执行工具→更新状态→继续/结束"：

```python
while True:
    response = await api.stream(messages, tools)        # ① 构建上下文后调用 LLM（流式）
    if response.stop_reason != "tool_use":
        break                                            # ④ 模型不再要工具 → 结束
    for tool_call in response.tool_uses:                 # ② 解析工具调用
        # 权限检查 → Hook → 执行 → Hook → 结果
        result = await harness.execute_tool(tool_call)   # ③ 执行（含治理）
    messages.append(tool_results)                        # ⑤ 更新状态（observation 回流）
    # 循环继续——模型看到结果，决定下一步
```
([HKUDS/OpenHarness](https://github.com/hkuds/openharness))

它本质上是标准的 **ReAct 工具调用循环**：LLM 输出 JSON 格式工具规格 → Harness 解析并（可并行）执行 → 结果作为 observation 流回 messages → 模型基于新上下文再决策，直到 `stop_reason != "tool_use"` ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。

### 3.2 关键工程特性

- **流式工具调用周期（Streaming Tool-Call Cycle）**：边思考边执行，实时把 `text.delta` 与工具事件回传给 UI ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
- **API 指数退避重试**：对模型/工具 API 失败做带 exponential backoff 的重试，保障稳定执行 ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。
- **并行工具执行**：同一轮内的多个 tool_use 可并行执行（如同时检索多个代码仓库）([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。
- **Token 计数 & 成本追踪**：在循环内内置统计，为可观测性提供底层数据 ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
- **生命周期管理**：会话恢复、上下文自动压缩、步骤计数（`maxSteps`）与超时控制 ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。

**LLM 调用位置**：在 `while` 循环顶部，每次都带"当前完整 messages + tools schema"调用；observation（工具结果）以 `tool_result` 消息追加回 messages，作为下一轮输入。

**何时结束**：`stop_reason != "tool_use"`（模型给出最终文本，或达到 `maxSteps`/超时/被测策略中断）。

**为什么这样设计（Loop 层面的"为什么"）**：把"调模型"做成循环里的一个纯函数调用点，把"执行工具"做成被治理（权限+Hooks）包裹的动作，使**重试、并行、计数、压缩都成为可叠加在循环上的横切关注点**，而不是侵入模型调用逻辑。这与 TS 同名项目的 "Stateless Agents：pass in history, get back events" 思想一致——把"状态所有权"交给调用方，内核只做"执行器" ([OpenHarness Introduction](https://docs.open-harness.dev/))。

> **未核实项**：循环内部"步骤计数/超时"的具体默认阈值、并行执行的并发上限，官方 README 与二手资料均未给出明确数值；本文不做猜测。

---

## 4. State Model

OpenHarness 的状态可拆为三层，对应"哪些属于 Runtime、哪些属于 Context、哪些属于 Application"：

| 状态类别 | 包含内容 | 归属层 | 说明 |
|---|---|---|---|
| **Runtime（执行态，瞬时）** | 当前 turn 的 messages 缓冲区、tool_use 解析结果、并行任务句柄、重试/退避计数器、步骤计数 | RuntimeBundle / engine | 一次运行内有效，不跨会话 |
| **Context（发送给模型的内容）** | System Prompt、CLAUDE.md 注入、History、Memory 检索片段、Tool Schema、压缩后的窗口 | prompts/ + context/ | 动态构建，受 Token 预算约束 |
| **Application（应用态，持久）** | 会话历史（Session Resume）、`MEMORY.md` 长期记忆、CLAUDE.md 项目规则、`settings.json` 权限配置、Skills/Plugins 注册 | memory/ + config/ + 文件系统 | 跨会话、跨运行保留 |

设计上它刻意**不把"对话状态"锁死在内核里**：HKUDS 版本以 `messages` 在循环中显式传递；TS 同名项目则把这点推到极致——"Agents are pure executors: pass in history, get back events. Full control over conversation state" ([OpenHarness Introduction](https://docs.open-harness.dev/))。

**为什么这样设计（State 层面的"为什么"）**：
- **执行态与持久态分离**，使"断点续聊（Session Resume）"与"多日会话"成为可能——v0.1.6 起 Auto-Compact 能在压缩上下文时**保留任务状态与渠道日志**，agent 可跨天运行而不必手动 compact/clear ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
- **Context 作为"受预算约束的工作记忆"**，而非简单拼接；这与 Claude Code 的设计原则相通——"Context is working memory. Governance exists to keep the system able to continue work"，压缩要保留"行动语义"而非"信息量最大" ([Harness Engineering: Claude Code 设计指南 · Ch.5](http://harness-books.agentway.dev/en/book1-claude-code/chapter-05-context-memory-compact.html))。OpenHarness 借鉴了同一思想。
- **Application 态下沉到文件**（CLAUDE.md / MEMORY.md / settings.json），让状态可被人类审阅、版本化、复用，天然契合"开源、可理解"定位。

---

## 5. Context Engineering

OpenHarness 的上下文工程围绕"**动态、受预算约束地把正确信息送进模型**"展开，主要机制：

1. **CLAUDE.md Discovery & Injection**：自动发现项目目录下的 `CLAUDE.md` 并注入系统上下文（项目规范、接口约定），相当于"稳定层规则" ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
2. **MEMORY.md Persistent Memory**：跨会话持久化记忆文件，作为长期知识层 ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。
3. **Context Compression（Auto-Compact）**：基于 **Token 预算机制**做自动压缩；二手资料给出的示例为"128k 限制压缩至 80k"（**该数值为二手报道，未在第一手 README 中核实，仅作量级参考**）([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。v0.1.6 起压缩可**跨压缩保留任务状态与渠道日志**，支持多日会话 ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。**源码核验**：默认上下文窗口 200k 时，真实触发阈值约 **167k**（200k−20k−13k，见 `src/openharness/compact/__init__.py`），非 128k→80k。
4. **System Prompt 组装（prompts/ 模块）**：整合 CLAUDE.md、Skills、工具说明，统一生成系统提示 ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。
5. **Skills / Memory 注入**：按需把 `.md` 技能与召回记忆注入上下文；`MEMORY_PLACEHOLDER` 支持模板化上下文管理 ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。
6. **Tool Schema 注入**：把 **39 个默认注册工具**（schema 驱动，pydantic `input_model.model_json_schema()`）的自描述 JSON Schema 随请求下发，让模型知道"能用手"（"43+"为 README 营销口径，已源码核验修正）([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。

**为什么这样设计（Context 层面的"为什么"）**：
- **分层注入（稳定规则 / 持久记忆 / 会话连续）而非混在一起**：对应 Claude Code 的可移植工程原则——"layer long-term rules, persistent memory, and session continuity rather than mixing them; keep index-like artifacts small"（保持索引类产物精简、可寻址）([Harness Engineering: Claude Code 设计指南 · Ch.5](http://harness-books.agentway.dev/en/book1-claude-code/chapter-05-context-memory-compact.html))。OpenHarness 的 `MEMORY.md` 即"索引式长期记忆"，其 v0.1.6 引入的结构化 schema（含稳定 id、软删除、TTL）与 `usage_index.json` 召回追踪，正是把"记忆"当受治理的资源而非随意堆积的文本 ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
- **压缩被当作"预算治理（budgeting）"**：不是盲目截断，而是预留摘要预算、缓冲与失败熔断，且压缩后须**重建运行时语义**（计划、文件、技能、工具附件、Hook 状态），保证压缩后仍能继续工作 ([Harness Engineering: Claude Code 设计指南 · Ch.5](http://harness-books.agentway.dev/en/book1-claude-code/chapter-05-context-memory-compact.html))。OpenHarness 的 Auto-Compact 延续此取向。

---

## 6. Tool System

### 6.1 工具规模与分类

内置 **39 个默认注册工具**（schema 驱动；旧文"43+"为 README 营销口径，已源码核验修正），覆盖 ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))：

- **File I/O**：`Bash`、`Read`、`Write`、`Edit`、`Glob`、`Grep`
- **Search/Web**：`WebFetch`、`WebSearch`、`ToolSearch`、`LSP`
- **Notebook**：`NotebookEdit`
- **Agent/Task**：`Agent`、`SendMessage`、`TeamCreate/Delete`、`TaskCreate/Get/List/Update/Stop/Output`
- **MCP**：`MCPTool`、`ListMcpResources`、`ReadMcpResource`
- **Mode/Schedule**：`EnterPlanMode`/`ExitPlanMode`、`Worktree`、`CronCreate/List/Delete`、`RemoteTrigger`
- **Meta**：`Skill`、`Config`、`Brief`、`Sleep`、`AskUser`

### 6.2 每个工具的设计契约

每个工具具备：**Pydantic 输入校验、自描述 JSON Schema、权限集成、Hook 支持**，BaseTool + Pydantic 校验 + 插件化注册 ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。开发者扩展只需继承 `BaseTool` 并实现 `execute(context, input) -> ToolResult` ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。

### 6.3 执行、错误处理与重试

- **执行**：工具调用经"权限检查 → PreToolUse Hook → 执行 → PostToolUse Hook → 结果"的管线 ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
- **错误处理 / 重试**：API 失败走**指数退避重试**；同一轮 tool_use 可**并行执行** ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。
- **结果处理**：工具结果作为 `tool_result` 回流 messages，供模型下一轮决策。

### 6.4 权限与审批

- **权限模式（源码核验为 3 种，非 4 级）**：`DEFAULT`（写/执行前询问，日常开发）、`PLAN`（阻止所有写入，大型重构）、`FULL_AUTO`（允许一切，沙箱；旧文称"Auto"）。**源码确认无独立 `Strict` 模式**，且默认模式为"只读工具直接放行"而非严格 deny-first（[aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html), [bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。
- **路径级/命令级规则**（`settings.json`）：如拒绝 `/etc/*`、拒绝 `rm -rf /` ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
- **交互式审批对话框**：敏感操作二次确认 ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。

**为什么这样设计（Tool 层面的"为什么"）**：
- **工具是"一等公民 + Schema 驱动"**：把工具抽象成"自描述 JSON Schema + 校验 + 权限 + Hook"的统一原语，使"工具接入"与"模型调用"彻底解耦——任何符合 schema 的工具都能即插即用，这正是"一次接入、处处调用"的基础 ([cloud.tencent – OpenHarness](https://cloud.tencent.com.cn/developer/article/2692900))。
- **安全是"横切拦截"而非"工具内硬编码"**：权限与 Hooks 在工具执行**外层**拦截，模型/工具本身不必关心治理；这与把"安全边界"归为 harness 职责的设计哲学一致。
- **重试/并行是循环级能力**：不污染单个工具实现，复用第 3 节的循环机制。

---

## 7. Memory

OpenHarness 的 Memory 采用**双层记忆架构** ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))：

- **工作记忆（Working Memory）**：实时管理对话上下文（即在 Context 层的 History），随会话流动。
- **持久记忆（Persistent Memory）**：`MEMORY.md` 文件跨会话存储长期知识；v0.1.6 引入结构化 schema（`schema-v1` frontmatter，含稳定 id、软删除、TTL）与 `usage_index.json` 追踪"被召回的记忆"，并通过 `auto-dream` 清理陈旧条目 ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。

其他记忆相关能力：
- **Session Resume & History**：会话恢复与历史管理，支持断点续聊 ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
- **CLAUDE.md**：项目级稳定规则，属"长期规则层"而非"对话层"。
- **MEMORY_PLACEHOLDER**：模板化上下文管理，使记忆按需占位注入 ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。

> **未核实项**：有二手资料称"使用 SQLite 持久化 MEMORY.md"([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。但第一手 README 仅表述为 `MEMORY.md` 文件持久化；SQLite 是否为底层存储**未能在第一手来源核实**，本文按"文件式 MEMORY.md + 结构化 frontmatter 索引"描述，SQLite 一说标注存疑。

**为什么这样设计（Memory 层面的"为什么"）**：
- **长期规则 / 持久记忆 / 会话连续三层分离**（见第 4、5 节），避免把"稳定知识"和"临时对话"混在同一缓冲区，符合"保持索引类产物精简、可寻址"的工程原则 ([Harness Engineering: Claude Code 设计指南 · Ch.5](http://harness-books.agentway.dev/en/book1-claude-code/chapter-05-context-memory-compact.html))。
- **记忆是"受治理的资源"**：用稳定 id + 软删除 + TTL + 召回索引，把记忆当成可检索、可淘汰的资源，而非无限增长的文本堆——这与"上下文即受预算约束的工作记忆"一脉相承。

---

## 8. Skills / Extension

### 8.1 Skills（技能 = 数据而非代码）

- **定义**：基于 Markdown 文件的**按需加载**知识/流程；兼容 `anthropics/skills` 生态（可复用 1000+ 官方/社区技能）([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。
- **加载位置**：用户级 `~/.openharness/skills/`、项目级 `<project>/.openharness/skills/`；系统识别 frontmatter 元数据按需加载，内置 40+ 技能（commit、review、debug…）([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。
- **为什么是 .md**：把"技能"做成**数据**，降低扩展门槛——无需写代码即可新增领域能力，契合"社区可贡献"定位。

### 8.2 Plugins（插件）

- 兼容 `claude-code/plugins` 格式，支持自定义命令、Hooks、Agent 类、MCP 服务器扩展；已测试 12+ 官方插件 ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。
- 管理命令：`oh plugin list/install/enable` ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。

### 8.3 MCP（Model Context Protocol）

- 作为 MCP **客户端**，支持 stdio / HTTP / SSE 传输；v0.1.5 起支持 HTTP 传输、断线自动重连、tool-only server 兼容，并能**自动推断 MCP 工具输入的 JSON Schema**（无需手动类型映射）([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
- 内建 `MCPTool`、`ListMcpResources`、`ReadMcpResource` 等工具接入外部 MCP 服务器 ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。

### 8.4 扩展 API 与 Hook 体系

- **Hooks**：`PreToolUse` / `PostToolUse` 生命周期事件拦截；v0.1.8+ 支持 `priority` 字段做优先级排序（高优先级先执行）([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。Hooks 是插件/治理注入的主要扩展点。
- **Provider / 工具 / Agent 类**均可注册扩展 ([cloud.tencent – OpenHarness](https://cloud.tencent.com.cn/developer/article/2692900))。

**为什么这样设计（Extension 层面的"为什么"）**：
- **"技能即数据 + 插件即格式兼容"**：通过兼容 `anthropics/skills` 与 `claude-code/plugins` 两大现有生态，以极低成本借力千级技能库，是"不重复造轮子、只做轻骨架"定位的直接体现 ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。
- **MCP 作为"外部工具标准接口"**：用 industry 标准协议而非私有接口接入外部能力，避免被特定工具实现锁定。
- **Hook 是统一的"横切注入点"**：权限、日志、自定义命令都通过同一生命周期事件机制插入，保持内核精简。

---

## 9. Observability

OpenHarness 在可观测性上的**内置**能力：

- **Token Counting（成本仅 token，无货币成本字段）**：在 Agent Loop 内原生追踪 Token 消耗，为调用方提供实时数据；**源码核验确认仅累加 input/output tokens，无货币成本聚合**（[HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
- **Dry-run 安全预览**：`oh --dry-run` 在不调用模型/工具/子 agent 的前提下，解析运行时设置、认证状态、技能、命令、工具与已配置 MCP 服务器，给出 `ready / warning / blocked` 三类结论及具体下一步建议（如修复认证、修复 MCP 配置）([HKUDS/OpenHarness](https://github.com/hkuds/openharness), [cloud.tencent – OpenHarness](https://cloud.tencent.com.cn/developer/article/2692900))。
- **调试与轨迹**：`--debug` 日志；React TUI 提供状态动画反馈 ([aipuzi – OpenHarness](https://www.aipuzi.cn/ai-news/openharness.html))。
- **测试与质量可观测**：114 个单元测试 + 6 套 E2E 测试套件，作为"框架自身可信度"的可观测证据 ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。

**为什么这样设计（Observability 层面的"为什么"）**：
- **可观测性是"一等公民"而非补丁**：把 token/成本计数放进循环内部，是因为"模型调用成本"是 Agent 运行的核心约束——不观测就无法治理预算。
- **Dry-run 体现"安全可预览"哲学**：在真正执行前把"将要发生什么"显式呈现，把"治理"前置为可审核的步骤，而非事后日志。

> **缺口标注（诚实声明）**：在已查到的第一手（GitHub README）与二手资料中，**未见到独立的"Trajectory 回放 / 评测（Evaluation）框架 / 结构化 Trace 导出（如 OpenTelemetry）"** 作为突出特性。本文**不臆测**其存在；若本项目需要强评测能力，应在 `packages/core` 中主动补齐（见第 11 节）。

---

## 10. 对 Axiom Agent 的启发

从 OpenHarness（及同名 TS 项目的可类比思想）可提炼出对"通用 Agent Harness"具有普适性的设计原则：

1. **智能与执行彻底解耦**：内核只做"执行器"，模型只决策"What"；换模型、换 Provider、换前端都不应触动循环与治理逻辑。TS 项目把这点推到极致——"pass in history, get back events"的无状态 Agent ([OpenHarness Introduction](https://docs.open-harness.dev/))。
2. **循环是"纯函数式执行点"+ 横切能力叠加**：重试、并行、计数、压缩都应作为可叠加在 `while` 循环上的层，而非侵入模型调用。这正是 OpenHarness "Composable Middleware" 思想的来源 ([OpenHarness Introduction](https://docs.open-harness.dev/))。
3. **工具是一等公民、Schema 驱动、权限内建**：统一"JSON Schema + 校验 + 权限 + Hook"原语，使工具接入与模型调用解耦，达成"一次接入、处处调用" ([cloud.tencent – OpenHarness](https://cloud.tencent.com.cn/developer/article/2692900))。
4. **上下文是"受预算约束的工作记忆"而非拼接**：分层（稳定规则/持久记忆/会话连续）、压缩当作预算治理、压缩后须重建运行时语义 ([Harness Engineering: Claude Code 设计指南 · Ch.5](http://harness-books.agentway.dev/en/book1-claude-code/chapter-05-context-memory-compact.html))。
5. **安全是横切拦截（权限 + Hooks），不是工具内硬编码**：把"安全边界"归为 harness 职责，模型与工具都不必关心治理 ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
6. **扩展走"数据 + 标准协议"**：技能=.md、插件=兼容现有生态、外部能力=MCP 标准协议——用最低耦合借力最大生态 ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。
7. **可观测性内建**：Token/成本计数进循环、Dry-run 前置安全预览，把"预算与治理"变成可审核的一等能力 ([HKUDS/OpenHarness](https://github.com/hkuds/openharness))。
8. **轻量 = 剥离企业级臃肿、保留可测试内核**：剔除遥测/OAuth/重型 UI，后端可独立以无头模式运行，使同一内核进终端、进 IM、进 CI ([bestaitool – OpenHarness](https://bestaitool.cc/openharness/))。

---

## 11. 对本项目设计的影响

针对我们要反推的**轻量 Axiom Agent（`packages/core`）**，将上述原则落为具体设计建议（非源码清单，而是"架构决策"）：

### 11.1 模块边界（对应 OpenHarness 子系统，做最小化裁剪）

`packages/core` 建议保留以下内核包，其余（重型 UI、IM Gateway、Dashboard）外置：

| 包 | 职责 | 对应 OpenHarness |
|---|---|---|
| `core/` | Agent Loop 引擎（`run(messages, input) → AsyncIterator<Event>`） | `engine/` |
| `context/` | 上下文构建器 + Auto-Compact（Token 预算） | `prompts/` + `context/` |
| `tools/` | Tool Registry + `BaseTool` + JSON Schema 校验 | `tools/` |
| `permissions/` | 权限模式（default/plan/auto 三模式，非 deny-first）+ 路径/命令规则 + 审批接口 | `permissions/` |
| `hooks/` | Pre/Post ToolUse 生命周期拦截（带 priority） | `hooks/` |
| `memory/` | `MEMORY.md` 持久 + 结构化 schema + 召回索引 + Session Resume | `memory/` |
| `skills/` | Markdown 技能加载器（兼容 `anthropics/skills`） | `skills/` |
| `mcp/` | MCP 客户端（stdio/HTTP/SSE + 自动重连 + schema 推断） | `mcp/` |
| `observability/` | Token 计数（无货币成本）+ 结构化 Trace 事件 + Dry-run 校验 | 内置可观测 |

### 11.2 Agent Loop 契约（事件流接口）

借鉴 TS 同名项目"无状态 Agent + 事件流"，`packages/core` 的 Loop 应暴露：

```
AsyncIterator<Event> where Event ∈ {
  text.delta,          # 流式文本
  tool.call,           # 即将执行工具（含权限判定结果）
  tool.result,         # 工具执行结果（observation）
  compaction,          # 触发压缩
  cost,                # token/成本增量
  done                 # 结束
}
```

调用方持有 `messages` 与状态，**内核不锁死会话状态**——这直接回应第 4 节"Runtime/Context/Application"三分，使 `packages/core` 既可被 CLI 用、也可被 IM/CI 复用。

### 11.3 State Model 落点

- **Runtime**：Loop 内 `messages` 缓冲、并行句柄、重试计数 → 不持久。
- **Context**：由 `context/` 在每次 LLM 调用前，按"CLAUDE.md → History → Memory 召回 → Tool Schema → 压缩"的管线动态组装，受 Token 预算约束。
- **Application**：`CLAUDE.md` / `MEMORY.md` / `settings.json` 落盘，支持 `Session Resume`（历史序列化重放）。

### 11.4 Context Engineering 管线（直接复用 OpenHarness 思路）

1. 注入 `CLAUDE.md`（稳定规则层）；2. 拼接 History（会话连续层）；3. 检索 `MEMORY.md` 结构化条目（持久记忆层，带 TTL/召回索引）；4. 下发 Tool Schema；5. 超预算时触发 Auto-Compact，**压缩后重建运行时语义**（计划/文件/技能/Hook 状态），而非只做摘要。

### 11.5 Tool System 契约

- `BaseTool`：`name` + `description` + `input_model`(Pydantic/JSON Schema) + `async execute(context, input) -> ToolResult`。
- 执行管线强制走 `权限检查 → PreToolUse Hook → 执行 → PostToolUse Hook → 结果`。
- 循环级提供**指数退避重试**与**同轮并行执行**，工具本身无感知。

### 11.6 权限与治理（可插拔策略）

`packages/core` 不内嵌具体规则，而是暴露 **PermissionPolicy 接口**：内置 **default/plan/auto（FULL_AUTO）三模式**（源码核验 OpenHarness 实际仅 3 种、无独立 strict）+ 路径/命令规则，但把"交互式审批""拒绝列表"实现为可替换策略，便于不同部署（本地/企业/CI）注入各自的治理。

### 11.7 扩展与生态兼容

- **Skills**：Markdown + frontmatter，兼容 `anthropics/skills`（低迁移成本）。
- **Plugins**：兼容 `claude-code/plugins` 的 commands/hooks/agents 注册。
- **MCP**：内置客户端，优先 HTTP/SSE + 自动重连 + 输入 schema 自动推断。

### 11.8 Observability（补齐 OpenHarness 缺口）

在复用其"Token/成本计数进循环 + Dry-run 预览"之外，`packages/core` 应**主动补齐 OpenHarness 未见突出的能力**：结构化 Trace 导出（建议 OpenTelemetry 兼容）、Trajectory 记录与回放、以及最小评测钩子（记录每轮 tool_use/observation 供离线分析）。这样把"可观测"从"成本可见"升级到"行为可审计、可评测"。

### 11.9 轻量工程纪律

效仿 OpenHarness"剔除企业级臃肿、保留可测试内核"：单语言栈、后端可无头运行、核心 Loop 与 UI 解耦、用 `uv`/锁文件无关的轻安装；并以单元测试 + E2E 保障"轻"不等于"脆"。

---

## 参考文献（APA 风格）

- HKUDS. (2026). *OpenHarness: Open Agent Harness with a built-in Personal Agent—Ohmo!* [Software]. GitHub. https://github.com/hkuds/openharness （检索于 2026-07-30；含 README、CHANGELOG、RELEASE_NOTES_v0.1.8/v0.1.9，v0.1.0 发布于 2026-04-01，最新 v0.1.9）
- OpenHarness. (n.d.). *Introduction*. docs.open-harness.dev. https://docs.open-harness.dev/ （注：此为基于 Vercel AI SDK 5 的 **TypeScript 同名独立项目**，作类比/对照引用）
- 安全风信子. (2026-06-18). *OpenHarness：Agent 的操作系统——HKUDS 四件套中最被低估的核心运行时*. 腾讯云开发者社区. https://cloud.tencent.com.cn/developer/article/2692900
- AI铺子. (2026). *OpenHarness：港大开源轻量级AI智能体驾驭框架，一键解锁工具调用与多智能体协同*. https://www.aipuzi.cn/ai-news/openharness.html
- 最好用的AI工具. (2026). *OpenHarness – 港大开源的轻量级 AI Agent 框架*. https://bestaitool.cc/openharness/
- openi.cn. (2026). *OpenHarness – 港大开源的轻量级 AI Agent 框架*. https://openi.cn/317034.html
- paooo. (2026). *港大OpenHarness开源：仅1.1万行代码复刻98% Claude Code功能，轻量级AI Agent框架新标杆*. https://paooo.com/aigc-news/10908
- AgentWay. (n.d.). *Harness Engineering: A Design Guide to Claude Code — Chapter 5: Context Governance: Memory, CLAUDE.md, and Compact as a Budgeting Regime*. https://harness-books.agentway.dev/en/book1-claude-code/chapter-05-context-memory-compact.html （设计思想类比参考：OpenHarness 刻意借鉴 Claude Code 的 Harness 设计）

---

## 附：来源充分性自评与未核实项

- **实际来源数量**：共 **8 个**不同来源（1 个第一手 GitHub 仓库 + 1 个 TS 同名项目文档 + 5 个中文科技媒体/评测 + 1 个 Claude Code 设计指南类比）。**满足 ≥5 要求**。
- **类型覆盖**：学术论文/权威报告 0；官方仓库（第一手）1；官方文档（TS 同名）1；行业媒体/评测 5；设计指南（类比）1。类型较集中于"官方+媒体"，**缺少同行评审论文**（Agent Harness 属新兴工程实践，合理）。
- **主要缺口**：(a) 第一手 README 之外的**源码级细节**（如各模块接口签名、压缩算法实现）未逐行核实；(b) **SQLite 持久化 MEMORY.md** 仅见于二手资料，第一手未确认；(c) **Token 预算具体数值（128k→80k）** 为二手报道量级参考；(d) 独立 **Trajectory/Evaluation 框架** 在资料中未见，已诚实标注。
- **事实无法核实、已标注的项**：SQLite 存储、128k→80k 具体预算值、循环步骤/超时默认阈值、并行并发上限——均已在正文对应小节明确标注"未核实/二手/存疑"，未做臆测。
- **两个 OpenHarness 项目的区分**：已在第 0 节明确界定主对象为 HKUDS Python 版，TS 版仅作类比，未混用其细节。

---

## 12. 源码核验补遗（已 clone 仓库逐行核验）

> **核验方式**：2026-07-30 克隆 `github.com/hkuds/openharness`（`--depth 1`），直接阅读 `src/openharness/` 与 `ohmo/` 源码；结论均带 `文件:行` 证据，未修改任何源文件。本节用于校正上文（尤其第二手 / README 营销口径）与源码不符处，供 `packages/core` 设计时采信。

### 12.1 结构澄清：仓库有「两套代码」
- `ohmo/`（约 4,450 行）= 个人 Agent（Ohmo）**适配薄层**，其 `runtime.py` 等只是把 Agent Loop 委派给 `openharness.engine` / `openharness.ui.backend_host`。
- `src/openharness/`（约 46,220 行）= **真正的引擎实现**，Agent Loop、Tool、权限、持久化全部在此。上文引用的 `ohmo/runtime.py` 并非引擎本体。

### 12.2 论断核验结论（A–G）
| 论断 | 结论 | 源码证据 |
|---|---|---|
| A. 43+ schema 驱动工具 | ⚠️ schema 驱动 ✅；**数量推翻**：默认注册 **39** 个（`src/openharness/tools/__init__.py:52-90`），README 自身亦写 43 但特性表仅列 ~35 | `tools/base.py:51-57`（pydantic schema） |
| B. MEMORY.md 用 SQLite 持久化 | ❌ **推翻**：全仓 `grep sqlite` 零匹配；MEMORY.md 实为 Markdown 索引 + Markdown/YAML-frontmatter 记忆文件；session 为 JSON | `memory/schema.py:254-261`；`session_storage.py:63-107` |
| C. 四级权限 + deny-first | ❌ **推翻（级数）/ ✅（Hook）**：权限仅 **3 模式** DEFAULT/PLAN/FULL_AUTO，且**非 deny-first**（默认模式只读工具直接放行） | `permissions/modes.py:8-13`；`permissions/checker.py:133` |
| D. ReAct + 指数退避重试 + 并行工具 + Token/成本计数 | ✅ 基本确认；**成本(钱)计数 ❌**（仅 token） | `engine/query.py:728-880`（ReAct/流式/并行 `:853`）；`api/client.py:32-35`（退避）；`cost_tracker.py` |
| E. CLAUDE.md+MEMORY.md 上下文 + Auto-Compact 128k→80k | ✅ 上下文属实；**阈值推翻**：真实约 **167k**（200k−20k−13k） | `prompts/claudemd.py`；`compact/__init__.py:55,56,79,1090-1092` |
| F. Markdown 技能 + MCP 扩展 | ✅ 确认 | `skills/loader.py:153-206`；`mcp/client.py:29-298` |
| G. 约 11,733 行 Python | ❌ **推翻**：全仓 `.py` 约 **80,970 行**（src 46,220；去 tests/scripts 仍 50,670；ohmo 4,450） | `wc -l` 实测 |

### 12.3 真实架构骨架（一句话）
一个 Claude/Anthropic-API 风格的 **ReAct 流式 Agent 引擎**：`engine/query.py` 主循环（流式 + 同消息多 tool_use 并发 `asyncio.gather`）+ `api/client.py` 指数退避重试（MAX_RETRIES=3）+ **39** 个 pydantic-schema 工具 + **3 级**权限（非 deny-first）+ **10 事件 / 4 类型** Hook + Markdown/SKILL 与 MCP 扩展；**全部状态以 JSON / Markdown 落盘（无任何 SQLite）**。

### 12.4 对本项目（`packages/core`）的采信提示
- **可采信**：流式 ReAct Loop、schema 驱动工具、Hook 事件总线（10 种）、Markdown 技能、MCP 动态适配、JSON/Markdown 落盘。
- **不可直接采信（上文已就地修正）**：工具数「43+」、代码量「1.1 万行」、权限「4 级 + deny-first」、Auto-Compact「128k→80k」、MEMORY.md「SQLite」。
- **设计启示修正**：OpenHarness 的"轻量"应理解为**架构分层清晰 + 核心 Loop 与 UI 解耦**，而非行数少；其权限模型是"3 模式 + 敏感路径硬拒 + 显式 allow/deny 列表"，比"deny-first"更务实，值得 `packages/core` 参考。
