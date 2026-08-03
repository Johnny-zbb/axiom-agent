---
title: Hermes Agent 架构调研
sidebar_position: 4
---

# Hermes Agent 架构深度研究

> 本文聚焦「为什么这样设计」（架构思想），用于反推一个轻量 Axiom Agent（`packages/core`）的设计。所有事实性陈述均带 Markdown 超链接引用；带「（观点）」字样者为主理人/来源作者的解读而非可证事实。

## 界定说明（Hermes Agent 指什么）

本研究采用 **Nous Research 开源的 Hermes Agent** 作为研究对象。判断依据如下，优先级由高到低：

1. **官方一手资料自证**：官方文档明确写道「The self-improving AI agent built by Nous Research」([Hermes Agent 官方文档](https://hermes-agent.nousresearch.com/docs))，GitHub 仓库为 `github.com/NousResearch/hermes-agent`([GitHub 仓库](https://github.com/NousResearch/hermes-agent))，MIT 许可，Python 82.4% / TypeScript 13.6%，截至检索时最新发布为 v0.16.0（2026‑06‑05），贡献者 1,444 人。
2. **权威第三方源码级分析指向同一对象**：Arize（可观测性厂商）直接阅读实现后发表《How Hermes implements an open source agent harness architecture》，开篇即「Hermes from NousResearch」([Arize 架构分析](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/))。
3. **多份独立深度拆解一致**：watermelonwater、CSDN「系列02」、canopywave 等第三方长文均围绕同一 Nous Research 项目，模块名（`agent_init.py` / `conversation_loop.py` / `tools/registry.py`）高度互证。
4. **发布时间吻合**：多源一致称其于 2026 年 2 月发布，定位为「自主 / 个人智能体」，前身为 OpenClaw（安装向导可一键迁移 OpenClaw 配置）。

检索中还出现 `hermes-agent.org`、`hermes-ai.net`、`hermesagent.org.cn`、`hermes-agent.ai` 等站点——经比对，它们均为该 Nous Research 项目的镜像、社区文档或 how‑to 站，并非不同实现，故统一归入同一对象。

**缺口诚实标注**：Hermes Agent 仍处 v0.x 快速迭代期，部分细节（确切 GitHub Star 数、某些内部计数器阈值、RL 奖励权重）在不同来源间存在冲突或仅见诸单一博客，文中已逐条标注可信度。

---

## 1. 定位

**类型**：Hermes 定位于 **Personal / 通用持久型（Persistent General）智能体**，而非绑定 IDE 的 Coding Copilot，也非单一 API 的聊天外壳 ([官方文档](https://hermes-agent.nousresearch.com/docs))。官方文档原话：「It's not a coding copilot tethered to an IDE or a chatbot wrapper around a single API. It's an autonomous agent that gets more capable the longer it runs.」

**解决的核心问题**：传统 AI 助手「无记忆、无成长、强绑定（特定模型/平台）」三大痛点 ([CSDN 深度解析](https://blog.csdn.net/m0_37055174/article/details/160289397))。Hermes 的闭环是：任务 → 执行 → 自动创建 Skill → 下次复用 → 定期优化 → 越用越强 ([CSDN 深度解析](https://blog.csdn.net/m0_37055174/article/details/160289397))。

**面向谁**：想要「长期陪伴、越用越好用」的个人 AI 助手的用户，而非搭建 Agent 工作流的开发者 ([CSDN SUNNY_SHUN](https://blog.csdn.net/SUNNY_SHUN/article/details/159826276))。它强调「自托管、零锁定、廉价部署」（$5 VPS / 本地 / GPU 集群 / serverless），支持 20+ 模型提供商一键切换 ([官方文档](https://hermes-agent.nousresearch.com/docs))。

**为什么这样设计（观点）**：把 Agent 当作「住在你机器上、跨会话持续积累」的数字员工，意味着架构必须把「状态、记忆、权限、恢复」当作一等公民，而不是把智能完全押在单次对话的 prompt 上。这解释了后续所有围绕持久化与运行时管控的设计选择。

---

## 2. Architecture

Hermes 采用「多入口、单运行时」分层：平台层只负责输入输出、权限、展示与消息路由；思考、工具、状态、压缩、插件都下沉到统一 `AIAgent` runtime ([CSDN 系列02](https://agent.csdn.net/6a17f83d10ee7a33f2761541.html))。

```
┌──────────────────────────────────────────────────────────────┐
│ 入口层 Entry Points（thin：仅 I/O、路由、权限、展示）            │
│  CLI │ TUI │ Messaging Gateway(20+平台) │ ACP Adapter │ Batch  │
└───────────────────────────────┬──────────────────────────────┘
                                 │ 统一内部消息对象
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│ 核心引擎 AIAgent (run_agent.py)  — 稳定门面(facade)            │
│  ├─ agent.agent_init.init_agent()  真实装配中心(~1400行)        │
│  └─ agent.conversation_loop.run_conversation()  预算受控主循环 │
│        │                                                       │
│        ├─ Provider Adapters（chat_completions/anthropic/       │
│        │   codex_responses/bedrock，归一化 tool-call 格式）     │
│        ├─ Context Builder（stable/context/volatile 三层组装）   │
│        ├─ Tool Registry + Toolset（注册≠暴露）                 │
│        ├─ Tool Executor（并发/串行、checkpoint、guardrail）     │
│        ├─ Memory Store / Manager（SQLite FTS5 + 外部 provider）│
│        ├─ Context Compressor（比例阈值 + 父子 lineage）         │
│        └─ Lifecycle Hooks（plugin 进程内 + filesystem 网关）    │
└───────────────────────────────┬──────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
  Terminal Backends        Session Store            Subagents / Cron
  (local/Docker/SSH/       (SQLite WAL +            (delegate_task,
   Daytona/Singularity/     parent-child            RPC execute_code,
   Modal)                    lineage)                durable jobs)
```

**架构要点与「为什么」**：
- **多入口共用一个 runtime**：避免「Telegram 一套逻辑、CLI 一套逻辑、TUI 一套逻辑」的失控 ([CSDN 系列02](https://agent.csdn.net/6a17f83d10ee7a33f2761541.html))。平台差异在入口层被挡在核心之外，模型只需吐统一媒体协议再经网关转回 ([WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6))。
- **`AIAgent` 是稳定门面**：真实初始化在 `agent_init.init_agent`、真实循环在 `agent.conversation_loop.run_conversation`，门面仅作转发——便于兼容演进而不破坏调用方 ([CSDN 系列02](https://agent.csdn.net/6a17f83d10ee7a33f2761541.html))。
- **九组件 Harness 模型全覆盖**：Arize 用「outer loop / context / skills+tools / subagent / pre-packaged skills / session persistence / system-prompt assembly / lifecycle hooks / permission」九维框架分析，认为 Hermes 实现了全部九项，且强在「provider 抽象、注册与暴露分离、会话即基础设施、压缩产生 lineage」([Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/))。
- **依赖面刻意拆小**：`pyproject.toml` 将核心依赖与 optional 分离，核心依赖大量精确 pin，以降低供应链攻击面——因为 Agent runtime 会执行代码/读写文件/连外部服务，供应链风险比普通应用更敏感 ([CSDN 系列02](https://agent.csdn.net/6a17f83d10ee7a33f2761541.html))。

---

## 3. Agent Loop

主循环是经典 **ReAct（Reasoning + Acting）** 状态机：Observation → Reasoning → Action → Loop ([canopywave](https://canopywave.com/blog/hermes-agent-comprehensive-deep-dive-on-technical-architecture-and-user-modeling))。

一次 turn 的流程（综合 CSDN 系列02 与 WMW）：

```
用户输入
  → 入口收敛为内部消息对象
  → run_conversation：恢复 system prompt + 注入 memory/plugin
  → 上下文压缩检查（超阈值则异步压缩）
  → LLM 调用（provider adapter 归一化）
       │
       ├─ 若返回 tool_calls：
       │     1) 工具名校验（∈ valid_tool_names）
       │     2) JSON 参数校验
       │     3) Guardrail 拦截？
       │     4) 插件 hook（可 block）
       │     5) Checkpoint（高风险前自动快照）
       │     6) 并发/串行执行（thread pool）
       │     → 结果 append 为 role="tool" 消息
       │     → 回到 LLM 调用（OBSERVATION 回灌）
       │
       └─ 若返回最终回答 / 预算耗尽 / 用户中断 / 不可恢复错误 → 结束
```

**关键设计思想**：
- **预算受控**：循环条件 `while (api_call_count < max_iterations and iteration_budget.remaining > 0)`。父 Agent 上限 **90 轮**、子 Agent **50 轮**（每轮不论并行调几个工具都只计 1 次），预算耗尽强制退出——防止幻觉/错误循环烧 token ([WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6))。
- **级联中断（为什么不是抛异常）**：父 Agent 每 **30 秒**给子 Agent 发心跳；父被中断/挂掉 → 心跳断 → 子连锁停，避免用户 Ctrl+C 后台仍烧 token ([WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%B8harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6))。中断时用 `break` 跳出循环并持久化结果，返回 `interrupted=True`；若某 tool call 已追加但未执行，系统**补一条伪造的 error tool result**，保证消息结构对 API 合法、下次恢复不被 Provider 拒绝 ([WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6))。
- **Observation 如何返回**：工具结果作为 `role="tool"` 消息回灌上下文，下一轮 LLM 调用即携带该 observation ([CSDN 系列02](https://agent.csdn.net/6a17f83d10ee7a33f2761541.html))。
- **结束条件**：最终文本回复、预算耗尽、用户中断、或不可恢复错误四类 ([WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6))。

---

## 4. State Model

Hermes 把状态明确分层，且**区分 Runtime / Context / Application** 三类归属（基于 Arize 与 CSDN 系列02 的模块归属推断）：

| 状态 | 内容 | 归属 |
|------|------|------|
| Conversation history | `_session_messages`、tool/observation 消息 | Runtime（Session Store） |
| Task/execution state | `iteration_budget`、`_interrupt_requested`、`_pending_steer`、`_tool_worker_threads` | Runtime |
| Tool result | `role="tool"` 消息 + 大结果落盘引用 | Context（本次上下文） |
| Memory | `MEMORY.md`/`USER.md`、SQLite FTS5、Honcho 用户模型 | Application（跨会话持久） |
| Session | `session_id`、`_session_db`(SQLite WAL)、parent-child lineage | Runtime（基础设施级） |
| Profile / config | `HERMES_HOME` 隔离根、enabled toolsets、credentials | Application/Runtime |

**核心思想**：
- **Session 即基础设施，而非仅用于 resume 的 transcript**：会话状态存 SQLite（FTS5 全文检索 + WAL 日志，对不支持 WAL 的文件系统有 fallback），记录 turn 的 source tag、压缩拆分的父子 lineage、网关路由所需的元数据 ([Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/))。CLI、消息平台、定时任务都挂在同一 session plane 上，消息在推理前即可路由到正确 session。
- **`HERMES_HOME` 做隔离**：profile 是一个隔离的 agent root，同机两个 profile 在状态与 footprint 上如同两个不同 agent ([Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/)；[WMW 解释为何依赖 HERMES_HOME](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6))。
- **记忆在会话开始冻结成快照**：避免中途用户偏好变化污染当前上下文一致性（代价是偏好变更可能要到下一轮会话才生效）——这是「用一致性换性能」的显式权衡 ([WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%B8harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6))。

---

## 5. Context Engineering

Hermes 把 system prompt **显式分三层组装**（stable / context / volatile），且这种分层在代码中是显式的，便于推理不变量 ([Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/))：

- **Stable 层**：身份（`SOUL.md`）、仅对「已启用工具」的工具指引、skills 索引、环境提示（Tmux/容器检测）、平台提示。
- **Context 层**：从 cwd 读取项目文件（`AGENTS.md`/`CLAUDE.md`/`.cursorrules`），加载前做 **prompt-injection 扫描**。
- **Volatile 层**：记忆快照、用户画像素材、外部 memory-provider 块、带 model/provider 元数据的时间戳行。

**为什么分层**：stable 永远稳定、context 永远来自 cwd、volatile 每轮变化；prompt 重建绑定压缩与相关失效点，使 prompt 前缀对缓存友好（cache-friendly）([Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/))。

**动态构建的其他手段**：
- **异构模型适配的补丁**：针对 GPT 系列强制注入「必须用工具、禁止仅口头描述 + 操作后验证」；针对 Gemini 注入「强制绝对路径 + 批量并行」([CSDN 玄姐](https://blog.csdn.net/musicml/article/details/160608645))。
- **比例阈值压缩**（非绝对 token 数）：监控上下文占模型总窗口比例（阈值 ~50%），触发即异步压缩；解耦对具体 Context Window 的依赖，使同一套架构可在 32K 轻量模型与 200K 旗舰模型间游走 ([CSDN 玄姐](https://blog.csdn.net/musicml/article/details/160608645)；[SUNNY_SHUN 记 50% 触发](https://blog.csdn.net/SUNNY_SHUN/article/details/159826276))。Arize 补充：旧 turn 由辅助模型摘要，头尾受 token budget 保护，过旧的工具输出先 prune；摘要预算约压缩内容的 20%，下限 2k、上限 12k token ([Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/))。
- **压缩产生 lineage 而非改写历史**：压缩时关闭当前 SQLite session 行、以 summary 为种子开 child session、轮换 session id、记录父子 lineage，并通知 plugin context engine 与 memory provider 边界移动 ([Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/))。WMW 特别指出「压缩后新开 session、旧 session 作 parent 保留」是区别于多数 harness 的罕见设计 ([WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6))。
- **@ 语法资源预挂载**：`@file:main.py:10-20`、`@diff` 把「多轮工具调用」前置为「单轮上下文预加载」，降低推理延迟与 token 消耗 ([CSDN 玄姐](https://blog.csdn.net/musicml/article/details/160608645))。

---

## 6. Tool System

**注册 ≠ 暴露**（最关键的设计分离，[Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/)）：
- `tools/registry.py` 的 `ToolRegistry.register()` 在 import 时统一注册 handler/schema/toolset/availability check（`check_fn`）([CSDN 系列02](https://agent.csdn.net/6a17f83d10ee7a33f2761541.html))。
- `toolsets.py` 决定某次 run 实际暴露哪些能力，按 platform/scenario 收窄，delegated run 再进一步收窄；profile 有自己独立的启用 footprint。
- `model_tools.py` 负责 schema 生成与调用分发；`agent/tool_executor.py` 真实执行（thread pool 并发、按 `tool_call_id` 顺序 append、执行前查 interrupt/checkpoint、插件可 block、guardrail 可拦、危险命令审批、大结果落盘）([CSDN 系列02](https://agent.csdn.net/6a17f83d10ee7a33f2761541.html))。

**为什么分离**：可保留庞大的已装工具库，同时让单次 run 的模型可见面足够小，兼顾 token 成本与安全 ([Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/))。

**Capability Gating（模型不能直接调 Python 函数，须经 6 步）**([CSDN 系列02](https://agent.csdn.net/6a17f83d10ee7a33f2761541.html))：① 工具名校验（∈ `valid_tool_names`）② JSON 参数校验 ③ Guardrail 拦截 ④ 插件 hook（可 block）⑤ Checkpoint（高风险前自动保护文件系统）⑥ 并发/串行执行。

**错误处理与重试（分类器与循环解耦）**：`FailoverReason` 枚举将 API/工具/文件系统/网络错误归为 **14 类**，封装为 `ClassifiedError`，只带 4 个布尔恢复标记：`retryable` / `should_compress` / `should_rotate_credential` / `should_fallback` ([WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6)；[玄姐也提到 14 类标准异常](https://blog.csdn.net/musicml/article/details/160608645))。主循环只看这 4 个标记决定下一步，不做字符串匹配。典型对比：HTTP **429**（临时限流，退避重试同一 Key）vs **402**（额度耗尽，必须立即换 Key）——不区分会在一个没钱 Key 上退避到天荒地老 ([WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6))。这与微服务的重试/熔断/降级同构，只是错误来源更杂。

**Permission / 审批**：危险命令（如 `rm -rf`、`curl|sh`、`sudo`、强推/删分支）需显式审批；支持三种模式 `manual`/`smart`(辅助 LLM 评估)/`off`，`cron_mode: deny|approve` 控制无人值守时的行为 ([官方安全文档](https://hermes-agent.nousresearch.com/docs/user-guide/security))。

---

## 7. Memory

Hermes 实现 **5 层持久化记忆**（由 ephemeral 到 permanent，[canopywave](https://canopywave.com/blog/hermes-agent-comprehensive-deep-dive-on-technical-architecture-and-user-modeling)）：
1. **短期推理记忆**：当前会话 transformer 上下文，重启即失。
2. **持久记忆文件**：`MEMORY.md`（~2,200 字符上限）、`USER.md`（~1,375 字符），跨会话存活；写满时合并/丢弃低信号事实以维持上限，而非默默丢最新信息。
3. **技能记忆（程序性）**：`~/.hermes/skills/` 下的 `SKILL.md`，捕获整套工作流解法（见 §8）。
4. **Honcho 辩证式用户建模**：与 Plastic Labs 的 Honcho 集成，后台推理模型从日志派生结构化用户结论（「用户偏好 TS」而非「第 47 条消息说偏好 TS」），只存结论不存原文（官方文档亦列 Honcho 为特性，[官方文档](https://hermes-agent.nousresearch.com/docs)）。
5. **FTS5 全文检索**：SQLite 可检索数据库 + LLM 摘要，支持跨会话时间维度召回（「上周二我干了啥」）。

**Session resume / retrieval / storage**：
- Storage：SQLite（FTS5 + WAL），fallback 文件系统 ([Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/))。
- Retrieval：不仅有静态注入，还把 `session_search` 工具暴露给模型，让「上下文管理决策」进入模型循环本身（模型主动召回历史 session）([Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/))。
- 外部记忆总线：原生插件化接入 Mem0、Honcho、Supermemory 等，实现跨会话向量级语义召回 ([CSDN 玄姐](https://blog.csdn.net/musicml/article/details/160608645))。

**为什么这样设计（观点）**：记忆不是把所有聊天记录塞回 system prompt（易失控），而是按「眼前要用的→完整记录→稳定偏好/事实→可复用流程」分流到上下文/数据库/记忆/技能四层，混在一起只会越来越乱 ([WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6))。

---

## 8. Skills / Extension

**Skill 定义**：遵循 `agentskills.io` 开放标准——含 YAML frontmatter（`name`/`description` 必填，正文 Markdown 少于 5,000 token）+ 可选 `scripts/ references/ assets/` 子目录 ([canopywave](https://canopywave.com/blog/hermes-agent-comprehensive-deep-dive-on-technical-architecture-and-user-modeling)；[juejin](https://juejin.cn/post/7665258484977123328))。`SKILL.md` 应写明「When to Use / Procedure / Pitfalls / Verification」([juejin](https://juejin.cn/post/7665258484977123328))。

**渐进式披露（省 token）**：Level 0 `skills_list()` 仅返回名称+描述+分类（约 3k token 索引）；Level 1 `skill_view(name)` 加载全文；Level 2 `skill_view(name, path)` 仅读特定参考文件。只有被调用的 skill 才展开全文 ([juejin](https://juejin.cn/post/7665258484977123328))。

**条件激活**：frontmatter 的 `fallback_for_toolsets` / `requires_toolsets` 让 skill 按当前可用工具自动显隐（如 duckduckgo-search 在 web toolset 缺失时作 fallback 出现）([juejin](https://juejin.cn/post/7665258484977123328)；[canopywave](https://canopywave.com/blog/hermes-agent-comprehensive-deep-dive-on-technical-architecture-and-user-modeling))。

**Agent 自创 Skill（程序性记忆闭环）**：通过 `skill_manage` 工具 create/patch/edit/delete，`patch` 为首选（只传变更文本更省 token）。触发时机：成功完成复杂任务（**5+ 工具调用**）、遇错找到出路、用户纠正、发现非平凡工作流 ([juejin](https://juejin.cn/post/7665258484977123328)；[canopywave](https://canopywave.com/blog/hermes-agent-comprehensive-deep-dive-on-technical-architecture-and-user-modeling))。另有后台审查 Agent 异步复盘轨迹、抽象可复用 skill（具体 `_iters_since_skill` 计数器阈值仅见于单一博客 [玄姐](https://blog.csdn.net/musicml/article/details/160608645))。

**Skills Hub / 可移植性**：集成 Skills Hub、skills.sh、well-known、GitHub、直接 URL；信任分级 builtin/official/trusted/community；安装前安全扫描 ([juejin](https://juejin.cn/post/7665258484977123328))。截至 2026‑03 已有 11+ 工具（Claude Code、Cursor、Copilot、Gemini CLI、Codex 等）采用 agentskills.io，skill 跨框架可移植 ([canopywave](https://canopywave.com/blog/hermes-agent-comprehensive-deep-dive-on-technical-architecture-and-user-modeling))。

**Plugin / Extension API**：`~/.hermes/plugins/` 放 Python 文件即可加自定义工具、命令、钩子、仪表盘 tab、网关平台、provider 后端，无需 fork ([CSDN qq_34004131](https://blog.csdn.net/qq_34004131/article/details/161088390))。

**MCP 支持**：原生 MCP——`hermes mcp add` 连任意 MCP server；`mcp_servers` 配置于 `config.yaml`；支持工具过滤、安全扩展；v0.6.0 起 `hermes mcp serve` 把 Hermes 会话暴露给任意 MCP 客户端（Claude Desktop/Cursor/VS Code）([canopywave](https://canopywave.com/blog/hermes-agent-comprehensive-deep-dive-on-technical-architecture-and-user-modeling)；[hermes-agent.ai](https://hermes-agent.ai/how-to/add-tools-to-hermes))。**Skill vs MCP 的本质区别**：MCP 扩展「能做什么」（可执行工具），Skill 扩展「知道怎么做」（知识文档）([juejin](https://juejin.cn/post/7665258484977123328))。

---

## 9. Observability

**原生观测的局限（诚实的自陈）**：引入统一可观测前，排障依赖零散日志 + 本地 `~/.hermes/state.db`（SQLite），缺乏统一结构，且未覆盖工具耗时分布、失败类型分类、分阶段耗时等维度 ([火山引擎 TLS 文章](https://developer.volcengine.com/articles/7633006149323161636))。

**原生自带**：
- 每次 session 在 SQLite 中生成结构化 trajectory 数据（observation/tool call/response 全序列），供 RL 使用 ([hermes-agent.ai RL](https://hermes-agent.ai/features/reinforcement-learning))。
- `save_trajectories` 参数、CLI 的 `/usage`、`/insights [--days N]`、ShareGPT 轨迹导出、批处理轨迹生成（并行 worker + checkpoint）([CSDN 系列02](https://agent.csdn.net/6a17f83d10ee7a33f2761541.html)；[hermes-agent.ai RL](https://hermes-agent.ai/features/reinforcement-learning))。
- 内置 Atropos RL 训练框架（RLHF/DPO + 自定义 reward）、YCBench 长程 benchmark、轨迹压缩 ([canopywave](https://canopywave.com/blog/hermes-agent-comprehensive-deep-dive-on-technical-architecture-and-user-modeling)；[hermes-agent.ai RL](https://hermes-agent.ai/features/reinforcement-learning))。

**第三方可观测方案（说明生态补足方向）**：
- 火山引擎 TLS 插件：成本归因（按 model/provider/platform 拆 Token）、性能拆解（P50/P90/P99 各阶段耗时）、稳定性监控（每工具/provider 失败率按天聚合）、Trace 链路追踪（按时间串联模型/工具调用节点，标注 token、耗时、成败）([火山引擎 TLS](https://developer.volcengine.com/articles/7633006149323161636))。
- 阿里云 OpenTelemetry 自动埋点（`hermes-cms` 插件，启动时 `OpenTelemetry auto-instrumentation initialized`），可看 LLM 调用轮数、各阶段（AGENT/LLM/TOOL）耗时、完整 Trace ([头条文章](https://www.toutiao.com/article/7631779628444713507))。

**为什么重要（观点）**：把 Agent 运行从「黑盒回复器」变为「可展开、可追踪、可分析的运行系统」——Trace 不仅用于排障，也是评估效果、反哺模型/工具选型的数据基础 ([火山引擎 TLS](https://developer.volcengine.com/articles/7633006149323161636))。

---

## 10. 对 Axiom Agent 的启发

以下原则是从 Hermes 的「为什么」中抽出的、与具体语言/项目无关的 Harness 架构共识：

1. **工具注册与暴露分离**：保留大工具库，但让单次 run 的模型可见面小，同时服务 token 成本与安全（[Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/)）。
2. **会话即基础设施**：SQLite + 父子 lineage，让 resume、路由、跨会话召回都能进入模型循环，而非仅当 transcript（[Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/)）。
3. **上下文显式分层（stable/context/volatile）**：稳定内容靠前以保缓存前缀友好，并让不变量可推理（[Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/)）。
4. **压缩产生 lineage 而非就地改写**：保留历史、可审计、可多轮压缩成链（[Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/)）。
5. **错误分类器与循环解耦**：用布尔恢复标记（retry/compress/rotate/fallback）而非字符串匹配，主循环只做分发（[WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6)）。
6. **生命周期钩子分两个信任级**：进程内 plugin hook（可 block/rewrite）+ 文件系统 gateway hook，使策略/审计/主机副作用独立于模型配合（[Arize](https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/)）。
7. **迭代预算 + 心跳级联中断**：防 token 烧穿与孤儿子 Agent；中断用 break+伪造 tool result 而非抛异常，保证消息结构合法可恢复（[WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6)）。
8. **记忆分层 + 技能渐进式披露**：按「眼前/记录/偏好/流程」分流，skill 索引常驻、全文按需（[WMW](https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6)；[juejin](https://juejin.cn/post/7665258484977123328)）。
9. **多入口共一个 runtime**：平台层做薄，思考/工具/状态/压缩/插件全沉运行时（[CSDN 系列02](https://agent.csdn.net/6a17f83d10ee7a33f2761541.html)）。
10. **可观测要内建事件流**：即便不做完整 dashboard，也应从第一天 emit 结构化事件（model_call/tool_call/token_usage），否则后期只能人肉查日志（[火山引擎 TLS](https://developer.volcengine.com/articles/7633006149323161636)）。

---

## 11. 对本项目设计的影响（`packages/core` 轻量 Axiom Agent）

本项目要反推的是一个**轻量** Axiom Agent（`packages/core`）。据此，Hermes 给 `core` 的落地建议是「**抄其骨架，砍其外围**」——core 只承载上面第 10 节里 1–10 的「引擎部分」，把 gateway/cron/profile/MCP server/插件文件系统/RL 训练全部外置为扩展点。

**`core` 应提供的模块（对应 Hermes 模块）：**

| 能力 | `packages/core` 建议模块 | 对应 Hermes |
|------|--------------------------|-------------|
| 预算受控 ReAct 主循环 | `core/agent_loop.ts`（`IterationBudget`） | `agent.conversation_loop.run_conversation` |
| Provider 归一化 | `core/provider/`（`chat_completions`/`anthropic`/`openai-wire` adapter） | provider adapters |
| 工具注册 | `core/tool_registry.ts`（`register(handler, schema, toolset, checkFn)`） | `tools/registry.py` |
| 工具暴露 | `core/toolset.ts`（`expose(validToolNames)`） | `toolsets.py` |
| Schema 生成/分发 | `core/tool_schema.ts`（JSON Schema→各 provider 格式） | `model_tools.py` |
| 上下文组装 | `core/context.ts`（stable/volatile 分层 + 可插拔 compressor） | Context Builder + `ContextCompressor` |
| 会话/状态 | `core/session.ts`（接口）+ `MemorySessionStore`（默认内存，可选 SQLite） | SQLite WAL session |
| 错误分类 | `core/errors.ts`（`ErrorClassifier` → `ClassifiedError{retryable,shouldCompress,shouldRotateCred,shouldFallback}`） | `FailoverReason`/`ClassifiedError` |
| 记忆接口 | `core/memory.ts`（`MemoryProvider`：short/long，可插 Mem0/Honcho） | `MemoryStore`/`MemoryManager` |
| 生命周期钩子 | `core/hooks.ts`（`preToolCall`/`postToolCall`/`preCompress` 进程内 hook 点） | plugin lifecycle hooks |
| 可观测 | `core/events.ts`（emit typed events：model_call/tool_call/token_usage/error；host 自行接 tracer） | trajectory + 第三方 TLS/OTel |
| 权限/审批 | `core/permission.ts`（`Policy` 回调：默认 permissive 或 manual；**不内置容器隔离**） | approval mode |

**应砍掉、仅留扩展点的外围（不在 core）：** Messaging Gateway（20+ 平台）、cron 子系统、profile 隔离根、`~/.hermes/plugins` 文件系统钩子、MCP server 进程管理、Atropos RL 训练、Skills Hub 市场。这些应作为「host 应用」或「插件」实现，core 只定义接口（如 `MCPClient` 接口、`Plugin` 接口、`Scheduler` 接口）。

**三条最该直接搬的设计：**
1. **注册 ≠ 暴露**：core 默认只把 `toolset` 选定的工具 schema 给模型——这是「轻量且安全」的免费收益。
2. **`ClassifiedError` 四标记模式**：core 主循环完全不碰字符串匹配，错误恢复策略可外部替换（如换 Key、降级模型、压缩后重试）。
3. **`IterationBudget` + 级联中断**：core 主循环条件即 `api_call_count < budget && remaining>0`；提供 `interrupt()` 与 `onInterrupt` 钩子，并约定「中断时补一条合法 tool result」以保证可恢复——这是 Hermes 反复踩坑沉淀的硬经验。

**一条要克制借鉴的（观点）**：Hermes 的 5 层记忆 + 自创 Skill + Honcho 用户建模非常重，对 `core` 而言过重。core 应只定义 `MemoryProvider` 接口与「短期上下文 / 长期存储」两层最小契约，把 Skill 自动生成、用户建模留给上层——否则 core 会重新膨胀成另一个 Hermes。

---

## 参考文献（APA 风格）

Arize AI. (2026, June 1). *How Hermes implements an open source agent harness architecture*. https://arize.com/blog/how-hermes-implements-an-open-source-agent-harness/

Nous Research. (2026). *Hermes Agent* [Computer software]. GitHub. https://github.com/NousResearch/hermes-agent

Nous Research. (2026). *Hermes Agent documentation*. https://hermes-agent.nousresearch.com/docs

Nous Research. (2026). *Security*. Hermes Agent Docs. https://hermes-agent.nousresearch.com/docs/user-guide/security

WatermelonWater Tech. (2026, May 2). *Hermes Agent Harness 架构深度解析：权限控制、上下文管理与经验沉淀*. https://watermelonwater.tech/insights/hermes%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84harness%E6%9D%83%E9%99%90%E6%8E%A7%E5%88%B6

CSDN（系列02）. (2026). *熬夜部署的 Hermes Agent 究竟是何方神圣？*. https://agent.csdn.net/6a17f83d10ee7a33f2761541.html

CanopyWave. (2026). *Hermes Agent: Comprehensive Deep Dive on Technical Architecture and User Modeling*. https://canopywave.com/blog/hermes-agent-comprehensive-deep-dive-on-technical-architecture-and-user-modeling

Juejin. (2026). *Hermes Agent 技能系统——智能体自创自复用的程序性记忆*. https://juejin.cn/post/7665258484977123328

Hermes Agents Network. (2026). *Hermes Agent's security model: container isolation, command approval, and what's not protected*. https://hermesagents.net/blog/hermes-security-model-deep-dive

Volcengine（火山引擎）. (2026). *一键开启 Hermes Agent 可观测：成本归因、性能拆解与稳定性治理*. https://developer.volcengine.com/articles/7633006149323161636

Nous Research. (2026). *Reinforcement Learning — Train Hermes on Your Feedback*. https://hermes-agent.ai/features/reinforcement-learning

CSDN（m0_37055174）. (2026). *Hermes Agent 深度解析：越用越强的自进化 AI 智能体*. https://blog.csdn.net/m0_37055174/article/details/160289397

CSDN（SUNNY_SHUN）. (2026). *$5 部署一个会自我进化的私人 Agent——NousResearch 开源 Hermes Agent*. https://blog.csdn.net/SUNNY_SHUN/article/details/159826276

CSDN（musicml/玄姐）. (2026). *深度解析 Hermes Agent 架构：双驱"自进化"机制与 Harness 工程实践*. https://blog.csdn.net/musicml/article/details/160608645

Hermes Agent. (2026). *Add Custom Tools to Hermes Agent*. https://hermes-agent.ai/how-to/add-tools-to-hermes

---

## 事实核实与可信度备注

- **高可信（多源互证/一手）**：定位、多入口单 runtime、AIAgent 门面、`conversation_loop`/`agent_init`/`tools/registry.py` 等模块名、预算 90/50 轮、30s 心跳级联中断、伪造 tool result、SQLite+FTS5+WAL 会话、stable/context/volatile 三层、注册≠暴露、14 类错误+4 布尔标记、7 层安全模型、MCP 原生支持、agentskills.io 兼容、渐进式披露、Atropos RL 集成。
- **单源/需谨慎**：GitHub Star 数在不同来源差异极大（检索快照显示 ~195k；2026‑03 分析文称 ~17.4k），本文未采用具体数字，仅以「高人气 MIT 项目、1,444 贡献者、v0.16.0」表述。具体 `_iters_since_skill` 计数器阈值（默认 10 轮）、子 Agent「最大 3 并发 / 最大 2 层」、GRPO 奖励权重（Correctness 2.0 等）、Honcho「$5.4M pre-seed」融资细节、每任务成本（$0.30）等，仅见于单一博客，属二次来源，建议落地设计时不直接引用为事实。
- **未找到独立一手资料**：Hermes 内部 `ContextCompressor` 具体摘要算法阈值（20% 预算/2k 下限/12k 上限）来自 Arize 单一分析；如用于生产决策，建议直接读 `github.com/NousResearch/hermes-agent` 源码复核。
