---
title: Pi Agent 架构调研
sidebar_position: 6
---

# Pi Agent（earendil-works/pi）架构深度研究

> 研究课题：Axiom Agent 业界成熟实现架构调研
> 研究员：谭溯源（topic-researcher-3）｜执行模式：完整（含审稿）｜时效窗口：last_1_year（优先 2025–2026）
> 研究意图：聚焦"为什么这样设计"（架构思想），用于反推一个轻量 Axiom Agent（packages/core）

## 0. 关于「Pi Agent」的界定说明（必读）

公开资料中「Pi Agent」存在指代歧义，本报告在动笔前先做了消歧：

- **指代 A — Inflection AI 的 Pi**：一个主打"高情商陪伴"的个人聊天机器人（Personal AI），由 Inflection-2.5 等自研模型驱动，强调共情、语音、实时联网检索，面向普通消费者 ([Inflection AI, 2024](https://inflection.ai/inflection-2-5))。它**没有工具调用、运行时、harness 等概念**，不属于本研究范畴。
- **指代 B — `earendil-works/pi`**：由 Mario Zechner（@badlogic）维护的 TypeScript monorepo，项目自述为 *"Pi Agent Harness … including our self extensible coding agent"* ([GitHub: earendil-works/pi](https://github.com/earendil-works/pi))，包含统一 LLM API、Agent 运行时、终端 UI、编码 Agent CLI 等包。

**本报告采用指代 B（`earendil-works/pi`）。** 依据：① 项目 README 明确以 "Pi Agent Harness" 为题；② 2025–2026 年多份独立架构拆解一致将其界定为 *agent harness / coding agent runtime*（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）；③ 其 `pi-agent-core` 包正是"轻量 Agent 运行时"的范例，与本课题"反推 packages/core"的目标高度契合。

**诚实标注（缺口/不确定性）：**
1. Pi 处于**高速迭代期**，不同来源在时间点上对"包数量/stars"记录不一致（5 包 vs 7 包、49k–60k stars），本文以被引用最多的 **5 核心包结构**为主干，并标注差异。
2. 仓库 README 仅列出 4 个核心包（`pi-ai / pi-agent-core / pi-coding-agent / pi-tui`），未列 `pi-web-ui`；其余包（`pi-web-ui`、`pi-orchestrator`、`pi-mom`、`pi-pods`、`pi-chat`）在拆解文章与 monorepo 文件树中出现，属同期/衍生包。
3. 包作用域命名历史上从 `@mariozechner/*` 迁移到 `@earendil-works/*`（[latentpatterns 仍用旧名](https://latentpatterns.com/newsletter/pi-mono-architecture)），本文统一采用 `@earendil-works/*` 并注明。
4. 除 GitHub 仓库（一手）外，其余为**基于源码的二手拆解文章**，细节可能随版本漂移；凡涉及具体源码行号/文件均按文章原样引用并标明来源，未做臆测。

---

## 1. 定位

**类型**：Pi 既是"可直接使用的编码智能体（Coding Agent）"，也是"可被上层应用复用的 agent harness（运行时 + LLM 抽象层）"——更准确地说，它是一个**可自定义的终端 AI coding agent harness**（[silenceper, 2026](https://silenceper.github.io/article/2026-05-27-pi-coding-agent-harness)）。`pi-coding-agent` 提供开箱即用的交互式编码 CLI，而 `pi-agent-core` + `pi-ai` 则作为独立可消费的"轻量 Agent 底座"被其他产品复用（例如支持 46 个消息渠道的多渠道助手 OpenClaw 即直接基于这套三层构建，[renlulu, 2026](https://renlulu.com/posts/pi-agent-architecture-deep-dive)）。

**解决什么问题**：主理人/作者的核心判断是——*不要把所有功能都塞进核心，保留足够小的 Agent harness，把扩展点开放出来，让用户按自己的工作流组合*（[silenceper, 2026](https://silenceper.github.io/article/2026-05-27-pi-coding-agent-harness)）。因此 Pi **刻意不内置**子代理、plan mode、MCP、权限系统等，而是把它们归类为"可作为扩展构建"的能力（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。

**面向谁**：主要是**个人开发者（个人使用）**——需要轻量、可脚本化、能嵌进自己终端工作流的 Agent（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。它也有三种运行模式：交互式 TUI、管道友好的 print 模式、用于 IDE 集成的 JSONL RPC 模式（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。

**一句话定位（架构思想）**：*"adapt the tool to your workflow, not the other way around"*——发可组合的积木，而非一个固化形态的产品（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。

---

## 2. Architecture

Pi 的核心是一个 **monorepo + 分层包** 架构。被引用最多的 5 核心包按"依赖单向、层不泄漏"组织（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）：

```text
┌──────────────────────────────────────────────────────────────┐
│ 应用层 / 复用方                                                │
│  pi-coding-agent (CLI/SDK)   pi-web-ui (Lit)   OpenClaw 等     │
│  pi-orchestrator (RPC 子代理编排)                              │
├──────────────────────────────────────────────────────────────┤
│ 运行时层   pi-agent-core                                      │
│   Agent Loop · 工具执行 · 状态 · 事件系统 · Steering/Follow-up │
├──────────────────────────────────────────────────────────────┤
│ LLM 通信层  pi-ai                                             │
│   30+ Provider · 9 种协议 · EventStream 推拉式流式             │
├──────────────────────────────────────────────────────────────┤
│ 基础/UI    pi-tui (零依赖终端 UI) · 环境抽象 (FS / Node.js)    │
└──────────────────────────────────────────────────────────────┘
        每层只知道自己该知道的事（层边界不泄漏）
```

**核心模块与交互（一次请求的主链路）**：

```text
User/TUI
   │ (prompt / steering / follow-up)
   ▼
pi-coding-agent  ── AgentSession (编排/配置/扩展注册)
   │
   ▼
pi-agent-core.agentLoop
   │  ① transformContext  (裁剪/注入)
   │  ② convertToLlm      (过滤自定义类型→标准消息)
   │  ③ 调用 LLM
   ▼
pi-ai.stream(model, messages, opts)  ──EventStream──►  30+ LLM Providers
   │  ◄── text_delta / tool_call / done
   │
   ▼
ExecuteTools (默认并行)  ──►  Environment (文件系统 / Shell / 网络)
   │  ◄── tool_result
   │
   ▼
Update State (COW) → CheckSteering → CheckFollowUp → Continue / Finish
```

**关键架构思想（为什么这样设计）**：

- **层边界不泄漏**（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）：`pi-ai` 不知道 session；`pi-agent-core` 不知道 terminal；`pi-tui` 零内部依赖可独立使用。这样同一套 LLM 通信层与运行时能"长出"完全不同形态的产品（编码 Agent、OpenClaw 多渠道助手）。
- **底层包完全独立、可独立消费**：`pi-ai` 仅依赖 typebox；`pi-tui` 零内部依赖（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
- **锁步版本管理**（lockstep versioning）消除 monorepo 的"钻石依赖"问题（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。
- **供应商懒加载**：provider SDK 按需 `import()` 且缓存 Promise，未使用则不引入（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。

> 注：部分拆解把包记为 7 个（另含 `pi-mom` Slack bot、`pi-pods` vLLM 部署、`pi-chat`），并强调 `pi-orchestrator` 做 RPC 子代理编排（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。本文以 5 包主干为准，衍生包按需提及。

---

## 3. Agent Loop

Pi 的 Agent Loop 是其最被称道的工程创新——**Steering + Follow-up 双队列**结构（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。它把"用户在一次 turn 内打断纠正"与"turn 结束后追加新任务"建模为两个独立队列，这是 Grok Build、OpenCode 等同期的编码 Agent 没有做到的（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。

**一次 turn 的流程（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）**：

```text
外层循环 (Follow-up 队列)
  while (有 follow-up 或首次):
    内层循环 (工具调用 + Steering 队列)
      while (有工具调用 OR pending steering):
        1. ReceivePrompt      接收用户/steering/follow-up 消息
        2. transformContext   裁剪旧消息、注入外部上下文（控窗口）
        3. convertToLlm       过滤自定义类型 → 标准 LLM 消息
        4. StreamResponse     ► pi-ai.stream() 调到 LLM
        5. ExecuteTools       默认并行执行工具调用（可 sequential 覆盖）
        6. Update State       工具结果以 tool_result 消息 append 回历史
        7. CheckSteering      每工具结束后检查 steering 队列
        8. shouldStopAfterTurn 是否终止本批
      end
    9. CheckFollowUp         全部完成后检查 follow-up 队列
  end (无 follow-up → 结束)
```

- **LLM 调用位置**：在 `convertToLlm` 之后、`executeTools` 之前；通过 `pi-ai` 的 `EventStream` 流式返回（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
- **Observation 如何返回**：工具执行结果被封装为 `tool_result` 类型的 `AgentMessage` append 回对话历史，下一轮作为上下文送回 LLM（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
- **何时结束（终止条件）**：① LLM 返回纯文本、无工具调用；② `shouldStopAfterTurn` 钩子返回 true；③ 内层工具循环结束且外层 follow-up 队列为空（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。
- **Steering（转向/打断）**：在当前 turn 内注入，当前工具完成后立即送达、取消剩余工具，让 Agent "立刻看到你的纠正"——这是 mid-turn 打断机制。
- **Follow-up（追加）**：仅在 Agent 全部当前工作完成后送达，排队下一个任务——这是"追加任务"机制（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。

**架构思想**：*Architecture influences interaction design*——Pi 在进程内运行，Agent Loop 与队列同处一个进程空间，天然支持 mid-turn injection；而基于 ACP 协议的网关式 Agent（如 Grok Build）协议层就是"一问一答"，无法在 turn 内注入（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。

---

## 4. State Model

Pi 的状态可拆为几类，并清晰分布在 **Runtime / Context / Application** 三层（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)；[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）：

| 状态成分 | 内容 | 归属层 |
|---|---|---|
| conversation history | `AgentMessage[]`（user / assistant / tool_result / 自定义类型） | **Runtime**（pi-agent-core） |
| task / execution state | 在途工具调用、steering / follow-up 队列、当前 turn 标志 | **Runtime** |
| tool result / observation | 工具执行结果、错误标志、UI `details` | **Runtime** |
| memory / summary | compaction 摘要、注入的外部上下文、MEMORY.md | **Context（动态视图）+ Application（持久化）** |
| session | session id、分支树、配置、provider 注册、扩展注册 | **Application**（pi-coding-agent） |
| UI state | TUI 组件、overlay、footer | **UI（pi-tui）** |

**Runtime 层（pi-agent-core）的边界**：`agentLoop` 维护 `AgentMessage[]` 与执行状态，但**永不就地修改**——采用**写时复制（COW）**：工具与消息数组被原子替换，钩子/扩展获得一致快照（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。

**可扩展消息类型（声明合并）**——这是 Pi 把"应用状态"与"模型上下文"分离的关键设计：标准 LLM 消息只有 user/assistant/toolResult，但真实应用还有文件附件、系统通知、状态更新等。Pi 通过 TypeScript declaration merging 允许应用追加自定义消息类型，`convertToLlm` 决定模型是否可见（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）：

```typescript
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    notification: { role: "notification"; text: string; timestamp: number };
  }
}
agent.appendMessage({ role: "notification", text: "Build succeeded", timestamp: Date.now() });
// convertToLlm 可把 notification 转成 user 消息，或过滤掉——UI 看到的东西模型未必看到
```

**架构思想**：*UI 与 LLM 视角分离*——同一份对话历史里，UI 通知（notification）与模型可见消息被解耦，避免把无关 UI 噪声喂给模型，也避免把内部状态泄漏给用户（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。

---

## 5. Context Engineering

Pi 的上下文工程集中在 `pi-agent-core` 的**消息管线**与**压缩机制**，核心思想是"动态、可订阅地决定模型看到什么"（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。

- **System Prompt / History Management**：消息管线三阶段——`transformContext`（裁剪旧消息、注入外部上下文，控制上下文窗口）→ `convertToLlm`（过滤应用特定消息、把自定义类型转成标准 LLM 消息）→ `Stream`（发给 LLM）（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。
- **Compression / Compaction（压缩）**：三阶段——① Prepare（保留 ≥20k token 近期消息）；② Summarize（用特制 prompt 让 LLM 总结并跟踪文件读写）；③ Replace（写入 `compaction` 会话条目）（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。触发方式：自动（约 80% 窗口或溢出恢复）、手动（`/compact` 可带指令）。
- **Memory Injection**：通过 `context` 事件处理器可修改发送给 LLM 的消息数组，注入/剥离外部上下文（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）；扩展也能在 `session_before_compact` 等事件中定制摘要逻辑（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
- **Tool Schema 注入**：工具参数用 TypeBox 定义，自动生成 JSON Schema 注入到 LLM 的工具定义里（见第 6 节）。
- **Workspace Context**：Agent 通过 `read/write/edit/bash` 等工具读写工作区文件，工作区即"环境上下文"；`bash` 输出默认截断约 200KB 再回传，避免撑爆上下文（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。

**架构思想**：*context rewrites messages before the model sees them*——上下文工程被做成 **harness 层能力**（通过 `context` 事件钩子），而非写死在 prompt 里；"最便宜的工具调用是永不发生的那次"——扩展可以在 turn 开始前把信息注入上下文，省去一次工具往返（[aibuilderclub, 2026](https://www.aibuilderclub.io/blog/pi-agent-extensions-guide)）。

---

## 6. Tool System

Pi 的工具系统遵循 **"定义优先 + 双层注册"**（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）：

- **Tool Schema（类型安全）**：用 TypeBox 单一定义同时生成 **JSON Schema（给 LLM）** 和 **TS 类型（给代码）**；每次工具调用先用 **AJV** 校验，参数非法则把错误回喂模型让它重试（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。
- **Registry（双层）**：`ToolDefinition`（名称/描述/参数 Schema，供 LLM 消费）→ `AgentTool`（validate + execute，供运行时消费）。LLM 选择工具后，runtime 匹配 Definition 并调用对应 AgentTool（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。
- **内置工具**：`pi-coding-agent` 默认仅 4 个工具 `read / write / edit / bash`（可选 `grep / find / ls`），其余（子代理、plan mode、git checkpoint、权限门、MCP）都被归类为"可作为扩展构建"（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。
- **Execution 管线**：`prepare → beforeToolCall → execute → afterToolCall → finalize`。`beforeToolCall` 可 `block`；`afterToolCall` 可覆盖 `content/details`、设 `isError`、发 `terminate` 提前终止（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
- **并行 / 串行**：单次 LLM 响应的多个工具调用**默认并行**；单个工具可用 `executionMode: "sequential"` 覆盖（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
- **Error handling**：`isError` 标志、`terminate` 信号、`details` 供 UI 结构化展示；`bash` 输出写入临时文件并默认截断约 200KB（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。
- **代码层安全守卫（非权限系统）**：`write` 要求先读文件（未读则失败）、`edit` 校验旧字符串唯一、`withFileMutationQueue` 串行化并发文件操作防竞态（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
- **Permission（无内置）**：README 明确 *"Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access"*；强隔离靠外部容器化——Gondolin（Linux 微 VM）、Plain Docker、OpenShell 沙箱（[GitHub: earendil-works/pi](https://github.com/earendil-works/pi)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。权限门也可由扩展在 `tool_call` 事件上拦截实现（[aibuilderclub, 2026](https://www.aibuilderclub.io/blog/pi-agent-extensions-guide)）。

**架构思想**：工具系统把"**定义（给 LLM）**"与"**实现（给执行）**"分离，并用 `before/afterToolCall` 钩子把安全/策略从工具内部抽离到 runtime 扩展层统一处理（[gitcode, 2026](https://gitcode.csdn.net/6a259a7d662f9a54cb7b05f1.html)）。

---

## 7. Memory

Pi 的记忆横跨"短期（上下文内）—长期（持久化）—检索注入"三个层面（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）：

- **短期记忆**：上下文窗口内的 `AgentMessage[]` 对话历史，由 `pi-agent-core` 维护；超出窗口由 Compaction 压缩（见第 5 节）。
- **长期记忆 / 持久化**：会话以 **JSONL 树形追加文件**存储，每条含 `id` 与 `parentId` 形成分支（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。较新版本引入 **SQLite 会话后端**（PR #6594，`packages/session-backend-sqlite`），以 append-only 序列化模拟 jsonl，并用 materialized view 缓存会话信息以快速恢复（[GitHub: earendil-works/pi](https://github.com/earendil-works/pi)）。
- **Session resume / 分支**：支持从历史任意 turn 创建分支并独立发展（`/tree` 跳转）；JSONL 树天然提供 branching、undo、compaction、full history——*"without a database"*（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。Pi 的分支回滚能力被评价为"会话管理灵活度上独树一帜"，Grok Build 与 OpenCode 均不支持分支（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。
- **Retrieval / 注入**：Compaction 摘要在压缩时被注入以保留长程信息；`context` 事件允许 RAG 式外部检索注入；OpenClaw 模式用 `MEMORY.md`（持久记忆）+ `log.jsonl`（全量）/ `context.jsonl`（模型所见）双文件分离，避免上下文浪费（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。
- **Skills 作为持久知识**：Skills（见第 8 节）以 Markdown 模板形式持久化，是可复用的"程序性记忆"（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。

**架构思想**：*JSONL trees are surprisingly powerful*——一个 append-only + parent pointer 的简单结构，零数据库即获得分支、撤销、压缩、全历史（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。

---

## 8. Skills / Extension

Pi 的能力扩展几乎完全依赖**扩展系统（Extension）**与**Skills**，这是其"扩展优先于功能优先"哲学的体现（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。

- **Extension 定义与 API**：扩展是 TypeScript 模块，导出一个接收 `ExtensionAPI` 的默认函数，可 `registerTool / registerCommand / registerKeybinding / registerProvider`，并通过 `subscribe`（或 `pi.on`）订阅 20+ 生命周期事件；还能用 `ctx.ui` 做确认框/通知/状态栏，用 `getSession / getModelRegistry` 读写状态（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)；[founddream, 2026](https://founddream.github.io/pi-mono-master/reference/extensions.html)；[mintlify, 2026](https://mintlify.wiki/badlogic/pi-mono/guides/building-extensions)）。
- **生命周期事件**：涵盖 `session:start/end/fork`、`message:user/assistant/system`、`tool:start/end/error`、`generation:start/end/stream`（含 `event.usage` token）、`compaction:start/end`、`input`、`before_provider_request` 等（[founddream, 2026](https://founddream.github.io/pi-mono-master/reference/extensions.html)；[aibuilderclub, 2026](https://www.aibuilderclub.io/blog/pi-agent-extensions-guide)）。
- **加载位置与热重载**：从 `~/.pi/agent/extensions/`（全局）、`.pi/extensions/`（项目）、settings `extensions` 数组、已安装包中自动发现；支持 **hot reload**（改文件即重载，无需重启会话）（[founddream, 2026](https://founddream.github.io/pi-mono-master/reference/extensions.html)）。
- **Skill 机制**：遵循 **agentskills.io** 标准，模板支持 `{{variables}}`，通过 **Pi Packages** 分发；本质是持久化的"程序性知识"模板（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[xuqi, 2026](https://xuqi2024.github.io/2026/05/15/2026-05-15-pi-agent-harness-architecture-deep-dive)）。
- **Self-extension（自扩展）**：Pi 知道自己的扩展 API，可由用户"对话式"让它编写并 `/reload` 加载扩展——*"A harness that knows its own extension API is a harness that can be edited by talking to it"*，这是与"hooks 式"系统的哲学差异（[aibuilderclub, 2026](https://www.aibuilderclub.io/blog/pi-agent-extensions-guide)）。
- **安全约束**：扩展在**主进程以完整系统权限**运行，与 Pi 同权；官方明确"只安装可信来源的扩展"（[founddream, 2026](https://founddream.github.io/pi-mono-master/reference/extensions.html)）。
- **MCP 支持（诚实标注）**：在 2026-07 的拆解中，Pi 被明确指出**不支持原生 MCP 协议**，MCP server 集成被列为"可作为扩展构建"的能力之一（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。即 MCP 不是一等公民协议，而是通过扩展（如工具内调用 MCP client）间接实现——这点与 Grok Build（MCP+本地工具统一注册）形成对比（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。

**架构思想**：*Extension-first beats feature-first*——核心只发最小的 4 工具；子代理、plan mode、权限门、MCP 都"可作为扩展构建"。这听起来像限制，实则是力量（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。

---

## 9. Observability

Pi 的可观测性建立在**事件流 + 追加式 JSONL 会话**之上，而非集中式 dashboard（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)；[founddream, 2026](https://founddream.github.io/pi-mono-master/reference/extensions.html)）：

- **Trace**：`pi-ai` 的 `EventStream` 发射 `text_delta / toolcall_start|delta|end / thinking_start|delta|end / done` 等细粒度事件；`pi-agent-core` 再发射 20+ 事件（`session_start`、`before_agent_start`、`context`、`message_update`、`tool_execution_start/end`、`session_before_compact` 等）（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
- **Logging / Trajectory**：会话以 JSONL 树记录 `model_change`、`thinking_level_change`、`label`、`branch_summary`、`compaction`、`custom` 等条目，构成可重放的完整轨迹（trajectory）；`/tree` 可导航分支（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。
- **Token usage**：`generation:end` 事件携带 `event.usage`（token 数）；`session.prompt()` 返回 `{ messages, usage }`（[founddream, 2026](https://founddream.github.io/pi-mono-master/reference/extensions.html)；[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
- **Cost**：核心**没有统一计费 API**；成本可由 provider+model+usage 推导，留给扩展/provider 元数据处理（公开资料未提及内建 cost 聚合）。
- **Evaluation**：新增 **Vitest eval harness**（PR #7085）用于 coding-agent 评估；并鼓励把 OSS 编码会话分享到 Hugging Face（`pi-share-hf`），用真实任务而非玩具基准改进 Agent（[GitHub: earendil-works/pi](https://github.com/earendil-works/pi)；[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。

**诚实标注（缺口）**：Pi 无内建集中式可观测面板；trace 主要靠事件流 + JSONL，由上层 TUI/Web/扩展去呈现。这与企业级方案（如带 Skeptic 验证/Doom Loop 检测的 Grok Build）相比，是 Pi 的短板（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。

**架构思想**：把可观测性做成**事件总线**——扩展与 UI 通过订阅事件解耦地消费轨迹、token、压缩等信号，核心不绑定具体展示形态（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。

---

## 10. 对 Axiom Agent 的启发

结合"轻量 Axiom Agent / packages/core"目标，从 Pi 提炼**可落地的设计启发**（非空话）：

1. **三层分离 + 层不泄漏**：把 `LLM 通信层 / Runtime 层 / 应用层`拆开，`packages/core` 只含 runtime，绝不耦合 UI、绝不耦合具体 provider SDK。复用验证：同一套 core 长出编码 Agent 与 OpenClaw 多渠道助手（[renlulu, 2026](https://renlulu.com/posts/pi-agent-architecture-deep-dive)）。
2. **最小内核 = Agent Loop 引擎 + 消息管线 + 事件系统**：`transformContext / convertToLlm` 把"上下文工程"变成 harness 一等公民能力；状态用 COW 不可变更新，钩子拿到一致快照（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
3. **Steering / Follow-up 双队列内建**：把"用户打断纠正"与"任务追加"建模为两个独立队列，是进程内 harness 相对网关协议（ACP）的交互优势，应作为 core 默认能力而非外部协议（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。
4. **工具系统：定义/实现分离 + 入口校验 + 默认并行**：`ToolDefinition`（给 LLM）/ `AgentTool`（给执行）双层；入口用 schema 校验（如 zod/typebox），非法参数回喂模型重试；`before/afterToolCall` 钩子把安全/策略外置（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。
5. **不内置权限，但留拦截点 + 外部沙箱**：core 提供 `beforeToolCall` 拦截与 `tool_call` 事件，安全交给环境（容器/沙箱）或扩展权限门（[aibuilderclub, 2026](https://www.aibuilderclub.io/blog/pi-agent-extensions-guide)；[GitHub: earendil-works/pi](https://github.com/earendil-works/pi)）。
6. **上下文工程做成可订阅事件**：`context`、`session_before_compact` 等事件让应用层决定压缩/注入策略，core 不写死 prompt（[aibuilderclub, 2026](https://www.aibuilderclub.io/blog/pi-agent-extensions-guide)）。
7. **会话 = 追加式 JSONL 树，而非数据库**：append-only + parent pointer 零依赖获得分支/回滚/重放；可选 SQLite 后端加速恢复（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[GitHub: earendil-works/pi](https://github.com/earendil-works/pi)）。
8. **扩展优先于功能优先**：保持 core 小，能力靠注册式扩展；事件总线解耦扩展与核心（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。

---

## 11. 对本项目设计的影响

针对 **packages/core（轻量 Axiom Agent）** 的具体落地清单：

- **模块边界**：`core` 只导出 `agentLoop / AgentMessage / AgentTool / EventStream / Extension hooks`；provider 抽象（多 LLM、流式、OAuth）放独立 `@core/llm` 包，对标 `pi-ai`。core 不依赖任何 UI。
- **状态模型**：明确区分 **Runtime state**（消息历史、双队列、工具结果、执行标志——放在 core，COW 不可变更新）与 **Context 视图**（发送给模型的消息，由 `convertToLlm` 决定），以及 **Application state**（session 配置、分支、扩展/provider 注册——放在上层）。借鉴 Pi 的"声明合并自定义消息类型"实现 UI/model 视角分离（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)）。
- **Agent Loop 接口**：config 含 `model, tools, convertToLlm, beforeToolCall, afterToolCall, shouldStopAfterTurn`，内建 **steering + follow-up 双队列**；终止条件 = 无工具调用 / `shouldStopAfterTurn` / follow-up 空（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)；[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）。
- **工具子系统**：采用 `ToolDefinition`（JSON Schema，给 LLM）+ `ToolRuntime`（validate+execute，给执行）双层；入口统一 schema 校验；**默认并行、可标记串行**；`before/after` 钩子支持 block / override / terminate（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)；[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)）。
- **上下文工程**：提供 `transformContext / convertToLlm` 钩子 + `context` / `session_before_compact` 事件，把压缩与注入策略交给上层，core 默认实现简单的窗口裁剪与 LLM 摘要压缩（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[aibuilderclub, 2026](https://www.aibuilderclub.io/blog/pi-agent-extensions-guide)）。
- **可观测性**：内置统一**事件总线**（≥20 事件类型：session/ message/ tool/ generation/ compaction/ error），事件携带 `usage`；供上层接 TUI、日志、trace。不内置集中面板（[wangjunjian, 2026](https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture)；[founddream, 2026](https://founddream.github.io/pi-mono-master/reference/extensions.html)）。
- **持久化**：默认 append-only JSONL 树（支持 `id/parentId` 分支与 `/tree` 回放），可选 SQLite 后端；不强制数据库（[latentpatterns, 2026](https://latentpatterns.com/newsletter/pi-mono-architecture)；[GitHub: earendil-works/pi](https://github.com/earendil-works/pi)）。
- **明确不内置（通过钩子/扩展/外部实现弥补）**：① 权限系统——提供 `beforeToolCall` 拦截点 + 文档化容器化方案；② MCP——提供 `registerTool` 扩展点，MCP client 作为扩展接入（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)）；③ GUI——纯 core 无 UI。
- **风险规避**：Pi 的短板（无权限、无标准化协议层、无验证系统、扩展以完整权限在主进程运行）提示我们——core 应以"**提供钩子但默认不实现**"的方式预留安全/验证扩展点，避免重蹈"核心膨胀"，同时要在扩展加载处显式声明权限风险（[yesmiracle, 2026](https://www.yesmiracle.net/post/20260719-pi-agent-architecture)；[founddream, 2026](https://founddream.github.io/pi-mono-master/reference/extensions.html)）。

---

## 参考文献（APA 风格）

- Badlogic (Mario Zechner). (2025–2026). *Pi Agent Harness* [Monorepo]. GitHub. https://github.com/earendil-works/pi
- Geoffrey Huntley. (2026, February 17). *Pi: the architecture of an AI coding agent*. Latent Patterns. https://latentpatterns.com/newsletter/pi-mono-architecture
- Wang, J. (2026, May 16). *Pi - AI 编码智能体架构设计文档*. https://wangjunjian.com/posts/2026-05-16-pi-agent-architecture
- YesMiracle. (2026, July 19). *Pi Agent 深度拆解：TypeScript 多包架构下的 Steering + Follow-up 双队列设计*. https://www.yesmiracle.net/post/20260719-pi-agent-architecture
- Renlulu. (2026). *拆解 Pi：一个 23k Star 开源 AI Agent 框架的架构设计*. https://renlulu.com/posts/pi-agent-architecture-deep-dive
- Silenceper. (2026, May 27). *Pi 项目介绍：把 Coding Agent 做成可改造的终端 Harness*. https://silenceper.github.io/article/2026-05-27-pi-coding-agent-harness
- Xu, Q. (2026, May 15). *【earendil-works/pi】模块化 Agent Harness 架构深度解析：Skill、Compaction 与多 Provider 统一抽象*. https://xuqi2024.github.io/2026/05/15/2026-05-15-pi-agent-harness-architecture-deep-dive
- FoundDream. (2026). *Extensions* (Pi reference docs). https://founddream.github.io/pi-mono-master/reference/extensions.html
- AI Builder Club. (2026). *Pi Agent Extensions: Change the Harness, Not Just the Prompt*. https://www.aibuilderclub.io/blog/pi-agent-extensions-guide
- Mintlify. (2026). *Building TypeScript Extensions* (Pi docs). https://mintlify.wiki/badlogic/pi-mono/guides/building-extensions
- GitCode / CSDN. (2026). *从 Pi 学 Coding Agent 架构：Extension 插件系统与 Tree Session 状态树*. https://gitcode.csdn.net/6a259a7d662f9a54cb7b05f1.html
- Yudady. (2026). *Pi Agent Harness - 多層次 AI Agent 工具套件*. https://yudady.github.io/100-InBox/AI/Pi%20Agent%20Harness%20-%20%E5%A4%9A%E5%B1%A4%E6%AC%A1%20AI%20Agent%20%E5%B7%A4%E5%85%B7%E5%A5%97%E4%BB%B6
- Inflection AI. (2024). *Inflection-2.5: meet the world's best personal AI*. https://inflection.ai/inflection-2-5 （用于排除 Inflection 的 Pi 指代）

---

## 12. 源码核验补遗（已 clone 仓库逐行核验）

> **核验方式**：2026-07-30 克隆 `github.com/earendil-works/pi`（`--depth 1`），阅读 `packages/*` 源码；结论带 `文件:行` 证据。本文档对 Pi 的描述**基本站得住**，仅个别处需修正。

### 12.1 论断核验结论（A–G）
| 论断 | 结论 | 源码证据 |
|---|---|---|
| A. Steering + Follow-up 双队列 Loop | ✅ 确认（实为 **steering + followUp + nextTurn 三队列**，loop 内合并为 `pendingMessages`） | `axiom-agent.ts:192/194/196`、`:707/713/719`、`agent-loop.ts:167/259/263` |
| B. Runtime/Context/Application 三层状态 | ✅ 确认（代码命名 `AgentHarnessTurnState`/`AgentContext`/`Session`；COW 成立） | `axiom-agent.ts:153,389`、`session.ts`、`agent-loop.ts:104` |
| C. 工具定义/实现分离 + 按名注册路由 | ✅ 确认 | `harness/types.ts:99-112`、`pi-ai/src/types.ts:480`、`axiom-agent.ts:190`、`agent-loop.ts:607` |
| D. JSONL 树记忆（append-only + 可分支） | ✅ 确认（默认实现在 `packages/agent/src/harness/session/`，**非** `packages/storage`） | `jsonl-storage.ts:15-23,278-287`、`session.ts:219-227` |
| E. 扩展优先（register≠expose） | ✅ 确认 | `extensions/types.ts:1185`、`axiom-agent.ts:191/360-362/389-398` |
| F. 无原生 MCP，可作扩展构建 | ✅ 确认（源码包无 MCP server/client 实现，仅 lockfile 依赖 `@modelcontextprotocol/sdk`） | `packages/coding-agent/README.md:495` |
| G. 5 个核心包 | ⚠️ **修正**：实际 **7 个** workspace 包（`agent/ai/coding-agent/server/evals/tui/storage-sqlite-node`）；`storage` 是 `storage/sqlite-node` 子包（可选后端），非平铺 `packages/storage` | `package.json` workspaces |

### 12.2 两点提示
- **队列是「三」不是「双」**：harness 内另有 `nextTurnQueue`（turn 前预排消息），loop 内三者并入单个 `pendingMessages`（见第 3 节）。
- **storage 包位置**：默认 JSONL 树实现在 `packages/agent/src/harness/session/`，`packages/storage/sqlite-node` 只是可选 SQLite 后端；设计文档 `state-model.md` 若按"packages/storage 为核心"表述应据实修正。
- `docs/architecture/*` 中以 `RuntimeState`/`ContextView`/`ApplicationState` 等命名的是**设计建议书的接口草图**，并非 Pi 的真实类名（真实为 `AgentHarnessTurnState`/`AgentContext`/`Session`），不可混用。
