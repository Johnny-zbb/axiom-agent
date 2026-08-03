---
title: Claude Code 架构调研
sidebar_position: 2
---

# Claude Code 架构深度研究：一个成熟 Axiom Agent 的实现思想

> 研究课题：Axiom Agent 业界成熟实现架构调研
> 研究对象：Claude Code（Anthropic）
> 时效窗口：last_1_year（优先 2025–2026 资料）
> 研究视角：**为什么这样设计**（架构思想），用于反推一个轻量 Axiom Agent（packages/core）
> 撰写：课题研究员（谭溯源）

---

## 1. 定位

**Claude Code 是一个终端原生的、以"模型即节点、Harness 即工作台"为核心理念的 Agentic Coding 工具**[Anthropic: Best practices for Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices)。它不是一个聊天机器人，而是一个把大语言模型（Claude）封装成"能读代码、能改文件、能跑命令、能自主推进任务"的编码 Agent 的运行时外壳（Harness）。

- **Agent 类型**：Coding Agent（编码型），但也通过 MCP 与 Subagent 机制泛化为 General-purpose Agent 平台[Anthropic: Best practices for Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices)；[Fast.io: Claude Code API & Agent SDK](https://fast.io/resources/claude-code-api-sdk-guide)。
- **解决什么问题**：传统补全式工具（如早期 Copilot）只生成文本，不验证结果。Claude Code 关闭了"代码是否真的能跑"这一环——它读取、行动、验证，循环直到任务完成[Kondasamy: How Claude Code Works Under the Hood](https://kondasamy.com/blog/2026/how-claude-code-works)。其官方定位是"低层级、不预设工作流（low-level, unopinionated），提供接近原生模型的访问能力，同时可定制、可脚本化、安全"[Anthropic: Best practices for Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices)。
- **面向谁**：开发者、工程团队；通过 Agent SDK 也成为构建生产级 Agent 的库[LobeHub: Claude Agent SDK reference](https://lobehub.com/tr/skills/anexileddev-codeforge-claude-agent-sdk)。
- **关键设计立场**：*所有智能在模型侧，所有副作用在客户端侧*。模型从不直接触碰文件系统，它只能推理与请求工具；客户端机械地执行这些请求，并在客户端强制安全边界[Kondasamy: How Claude Code Works Under the Hood](https://kondasamy.com/blog/2026/how-claude-code-works)。这一定位是后续所有架构决策的总纲——它解释了为什么权限、上下文、工具执行、会话持久化全部落在 Harness 而非模型里。

**对反推轻量 Harness 的启示**：定位决定了边界。一个轻量 Harness 也应把"推理"留给模型、"执行与管控"留给运行时，而不是把业务规则硬编码进调用逻辑里。

---

## 2. Architecture

Claude Code 的本质是一个**围绕单一主循环（master loop）组织的基础设施层**。社区对其做了一份六层心智模型拆解：中央循环、上下文系统、工具、扩展、并行工作、可观测性；并明确指出"这只是一个心智模型，不代表 Anthropic 内部一定按这些模块名或边界实现"[Agentway: Claude Code 架构](https://agentway.dev/zh/claudecode/architecture)。一份第三方源码级剖析进一步把系统拆为 7 个组件：User、Interfaces（交互式 CLI / headless CLI / Agent SDK / IDE）、Agent Loop（`queryLoop`）、Permission System、Tools、State & Persistence、Execution Environment[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)。

核心架构图如下（ASCII）：

```
                         ┌──────────────────────────────────────────┐
   用户 / 接口层          │            Agent Runtime (queryLoop)        │
  (CLI / SDK /            │                                            │
   IDE / Web)             │   ┌────────────────┐    ┌───────────────┐  │
        │ prompt          │   │ Context Builder │───▶│  LLM (Claude) │  │
        │ approve         │   │ (组装上下文)     │    │ tool_call?    │  │
        ▼                 │   └───────┬────────┘    └───────┬───────┘  │
  ┌─────────────┐        │           │ observation        │ tool_use   │
  │ Permission   │◀───────┤  State /  │◀───────────────────┤            │
  │ Gate          │       │  Transcript│                    │            │
  │ (deny-first)  │       │  (JSONL)   │    ┌───────────────▼────────┐  │
  └──────┬───────┘       │            │    │ Tool Execution Engine  │  │
        │ allow          │            │    │ (Tools/MCP/Subagents/   │  │
        ▼                │            │    │  Hooks)                 │  │
  ┌─────────────┐        │            │    └───────────────┬────────┘  │
  │ Environment   │◀───────┤            │                    │ result     │
  │ Shell/FS/Web/ │       │            └────────────────────┘            │
  │ MCP servers   │       └──────────────────────────────────────────┘
  └─────────────┘
```

**图注（核心架构图）**：图中箭头语义如下——`prompt / approve`：用户或接口层向 Agent Runtime 的输入与人工审批流；`tool_call? → tool_use`：模型在每轮推理后可能返回的调用请求；`observation`：工具执行结果回流进上下文（State / Transcript）；`allow`：权限门禁（deny-first）放行后的执行授权；`result`：工具执行引擎将结果写回。Permission Gate 在工具派发前拦截，Environment 承载 Shell / FS / Web / MCP 等真实副作用。该图系依据社区六层心智模型与第三方源码剖析归纳，**非 Anthropic 官方架构图**。

**为什么这样设计**：
1. **所有界面收敛到同一个 `queryLoop`**。交互式 CLI、headless（`claude -p`）、SDK、IDE 共用同一条代码路径——`QueryEngine` 只是会话包装，而非引擎本身[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)。这避免了"每个界面一套循环"带来的行为分叉，极大简化了维护与一致性保障。
2. **模型只是循环中的一个节点**。真正的工程能力来自外围几层：上下文加载、权限、工具、skills、MCP、hooks、subagents、worktrees、会话状态[Agentway: Claude Code 架构](https://agentway.dev/zh/claudecode/architecture)。"模型很重要，但它只是循环中的一个节点"——这是 Harness 设计的第一性原理。
3. **基础设施占比极高**。一份第三方剖析估算"约 1.6% 是 AI 决策逻辑，98.4% 是基础设施"[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)。该数字为社区估算，非官方披露，但方向性结论（智能在模型、工程在外壳）与官方"low-level / unopinionated"定位一致。
4. **分层而非微服务**。源码结构体现清晰模块化（`query/`、`tools/`、`services/`、`skills/`、`plugins/`、`state/`、`context/`、`memdir/` 等），每个目录职责单一、边界明确[Takeshell: Claude Code 源码揭秘](https://takeshell.com/2026/04/07/claude-code-architecture-overview)；[Juejin: Claude Code 源码分析报告](https://juejin.cn/post/7623311375617720330)，但整体仍是单进程内的分层而非分布式。

---

## 3. Agent Loop

**一次 turn 的流程**可概括为：组装上下文 → 模型推理 →（可能）工具调用 → 权限门禁 → 工具执行 → 结果回填 → 继续 / 结束。

第三方源码剖析把每个 turn 拆为 9 步流水线：① 设置解析 → ② 状态初始化 → ③ 上下文组装 → ④ 五次"模型前整形" → ⑤ 模型调用 → ⑥ 工具派发 → ⑦ 权限门禁 → ⑧ 工具执行 → ⑨ 停止条件检查[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)。

官方"How Claude Code works"给出更口语化的三阶段循环：**收集上下文 → 采取行动 → 验证结果**，三者相互交织、不断循环（claudecode.jp, docs）。

```
用户请求
   │
   ▼
[收集上下文] 读取文件 / 搜索代码库 / 了解当前状态
   │
   ▼
[采取行动]   编辑文件 / 运行命令 / 调用工具 ( → 权限门禁 → 执行 )
   │
   ▼
[验证结果]   运行测试 / 检查错误 / 对比输出
   │
   ▼
未完成? ──yes──▶ 回到"收集上下文"（循环）
   │
  no
   ▼
返回最终响应，将控制权交还用户
```

**LLM 调用位置**：在 `queryLoop` 的每一轮，上下文组装完成后调用一次 Claude API（流式）。模型返回文本块或工具调用块（`tool_use`）；若返回 `tool_use`，外层 `while` 循环继续，否则自然终止[PromptLayer: Master agent loop](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop)；[Kondasamy: How Claude Code Works Under the Hood](https://kondasamy.com/blog/2026/how-claude-code-works)。即经典模式：`while(tool_call) { execute; feed result; }`[PromptLayer: Master agent loop](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop)。

**Observation 如何返回**：工具结果（stdout / stderr / 文件内容 / diff）作为纯文本 `tool_result` 块追加进对话历史，下一轮模型基于它全部可见信息做下一步决策[Kondasamy: How Claude Code Works Under the Hood](https://kondasamy.com/blog/2026/how-claude-code-works)。一条典型调试链可能含 8 次工具调用而无需人类介入。

**何时结束**：
- 模型产出纯文本响应（无 `tool_use`）→ 循环终止，等待下一次用户输入；
- 或显式遇到停止条件（如 plan 模式禁止编辑、或达到最大轮次）；
- 或验证检查（如测试通过）满足而模型主动结束（[Anthropic: Best practices for Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices) 的 best practices 强调"给 Claude 一个可运行的检查项，让 loop 自行关闭"）。

**为什么这样设计**：
- **单线程主循环 + 扁平消息历史**：不使用复杂的状态图或 swarms。Anthropic 明确选择此方案以换取**可调试性与可靠性**[PromptLayer: Master agent loop](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop)。对比：LangGraph 用显式状态图、Devin 用多步规划器。
- **实时转向（steering）**：异步双缓冲队列（社区代号 `h2A`）支持暂停/恢复与中途注入新指令，使 Claude 可从"批处理器"变成"真正的协作伙伴"[PromptLayer: Master agent loop](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop)。这解释了为什么用户能随时打断、纠正方向——循环本身不强制一次性跑完。

---

## 4. State Model

Claude Code 的状态可拆为三类，对应 Harness 设计的三个层次（本文据此反推 packages/core 的边界）：

| 状态类别 | 包含什么 | 归属层 | 生命周期 |
|---|---|---|---|
| **Runtime State** | 对话转录（append-only JSONL）、本次会话的工具结果流、循环控制变量、流式状态 | Harness 运行时 | 会话级，落盘于 `~/.claude/projects/.../history.jsonl`[Kent Gigger: Resume & manage conversations](https://kentgigger.com/posts/claude-code-conversation-history) |
| **Context State** | 实际发送给模型的内容：system prompt、对话历史、CLAUDE.md、已加载 skills、可见工具 schema、工作区上下文 | 上下文组装层 | 每轮动态重建，受 compaction 影响 |
| **Application State** | 任务状态、领域对象（如 git 状态、worktree、DOM 快照）、subagent roster、用户配置 | 应用/领域层 | 跨会话（配置）、跨任务（子代理） |

> **注**：上表 Runtime State / Context State / Application State 三类划分系本文作者归纳的分析框架，用于反推 `packages/core` 边界，**非 Anthropic 官方定义**。

**关键事实与设计选择**：
- **会话是目录绑定的，不是分支绑定的**（claudecode.jp, docs）[DevOps-Monk: Session Management](https://blog.devops-monk.com/2026/06/claude-code-session-management)。`claude` 启动于某目录即开启一个与该目录绑定的会话；切换 git 分支时，对话历史保留、Claude 读取新分支文件。这一选择意味着"并行工作必须靠 git worktree 创建独立目录"。
- **会话可恢复 / 可分叉**：`claude --continue` / `--resume` 按同一 session id 续写；`--fork-session` 保留历史但生成新 id（claudecode.jp, docs）[DevOps-Monk: Session Management](https://blog.devops-monk.com/2026/06/claude-code-session-management)。恢复时**全量历史还原，但会话级权限不继承**（需重新批准）——这是刻意的安全设计（权限不跨会话边界）。
- **自动记忆（auto memory，2.1.32+）**：Claude 自动记录并召回跨会话记忆（会话摘要、关键结果、工作日志），提供被动的跨会话连续性[Athola: Session Management SKILL](https://github.com/athola/claude-night-market/blob/master/plugins/sanctum/skills/session-management/SKILL.md)。
- **Subagent 拥有独立状态**：每个 subagent 启动于全新隔离上下文，不继承父对话历史/已加载 skills/已读文件；仅返回最终消息 + 元数据（[Anthropic Docs: Agent SDK — Sub-agents (fr)](https://docs.anthropic.com/fr/docs/claude-code/sub-agents)）。

**为什么这样设计**：把"会变化的运行时状态"（transcript）与"每轮重建的上下文状态"（context）分离，使 compaction、resume、subagent 隔离都能在各自边界内独立处理，互不污染。对轻量 Harness 而言，这是最值得复用的边界划分。

---

## 5. Context Engineering

上下文窗口是 Claude Code 的**绑定资源约束**（早期约 200K，后升级到 1M token，[Anthropic: Using Claude Code (session mgmt & 1M context)](https://claude.com/blog/using-claude-code-session-management-and-1m-context)）。上下文越满，性能越退化（"context rot" / 上下文腐烂：注意力被更多 token 摊薄，早期无关内容干扰当前任务，[Anthropic: Using Claude Code (session mgmt & 1M context)](https://claude.com/blog/using-claude-code-session-management-and-1m-context)）。因此整个上下文工程体系都服务于"在有限窗口内，让模型恰好看到该看的东西"。

**动态构建机制**：

1. **System Prompt 组装**：由 `prompts.ts` + `context.ts` + `CLAUDE.md` 等组合而成[Takeshell: Claude Code 源码揭秘](https://takeshell.com/2026/04/07/claude-code-architecture-overview)。
2. **History Management**：扁平消息历史；接近上限时自动清理较早的工具输出，必要时摘要（claudecode.jp, docs）。第三方剖析描述"每次模型调用前跑 5 种压缩策略"：① per-message 尺寸上限 ② 历史裁剪（HISTORY_SNIP）③ 缓存感知的微压缩 ④ 读取时的虚拟投影（CONTEXT_COLLAPSE，非破坏性）⑤ 模型生成的完整摘要（auto-compact，最后手段）[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)。
3. **Memory Injection**：
   - **CLAUDE.md 层级**：根目录 / 子目录 / 用户级 `~/.claude/CLAUDE.md` / 托管策略；建议少于 200 行；子目录 CLAUDE.md 按需加载（[Anthropic: Steering Claude Code](https://claude.com/de/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)；[Anthropic: Best practices for Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices)）。
   - **Rules（`.claude/rules/`）**：带 `paths` frontmatter 的路径作用域规则，仅在匹配文件被读取时加载，节省上下文（[Anthropic: Steering Claude Code](https://claude.com/de/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)）。
   - **Skills**：仅 name + description 在会话启动时加载，完整 body 在调用时加载（[Anthropic: Steering Claude Code](https://claude.com/de/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)）。
   - **Auto Memory**：跨会话被动召回（[Athola: Session Management SKILL](https://github.com/athola/claude-night-market/blob/master/plugins/sanctum/skills/session-management/SKILL.md)）。
4. **Tool Schema 注入**：MCP 服务器为每个请求添加工具定义；多个 server 会显著消耗上下文。故提供 **Tool Search**：默认仅按需动态加载 MCP 工具，避免占满窗口（[McKay Zhao: Claude Code 配置指南](https://blog.mckayzhao.com/ai/241/)）。
5. **Workspace Context**：当前目录文件、git 状态、Subagent roster 等（[Anthropic Docs: Agent SDK — Sub-agents (fr)](https://docs.anthropic.com/fr/docs/claude-code/sub-agents)）。

**为什么这样设计**：
- **"做最简单的事"**：用正则（ripgrep）而非向量库 / embedding 做代码检索；用 Markdown 文件而非数据库做记忆（[PromptLayer: Master agent loop](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop)；[Kondasamy: How Claude Code Works Under the Hood](https://kondasamy.com/blog/2026/how-claude-code-works)）。Anthropic 早期试验过本地向量库 RAG，但因编码 Agent 持续改文件导致 chunk embedding 失准而放弃——文件式检索永远读磁盘上当前文件，无索引漂移（[Kondasamy: How Claude Code Works Under the Hood](https://kondasamy.com/blog/2026/how-claude-code-works)）。
- **按需加载优于全量常驻**：skills、rules、subagents、MCP tool search 都遵循"默认不进上下文，触发才加载"，把对窗口的压力降到最低。
- **持久规则放 CLAUDE.md，而非依赖对话历史**：compaction 可能丢失早期指令，故把稳定指令外置为数据文件（claudecode.jp, docs）。

---

## 6. Tool System

工具是 Agent 的"手"。Claude Code 的工具遵循**统一接口模式**：JSON 工具调用 → 沙箱化执行环境 → 以纯文本返回结果（[PromptLayer: Master agent loop](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop)）。统一性带来可预测性与安全性。

**核心维度**：

- **Tool Schema / Registry**：内置约 48–54 个工具（不同版本口径，[Takeshell: Claude Code 源码揭秘](https://takeshell.com/2026/04/07/claude-code-architecture-overview)；[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)），涵盖五类：文件操作（Read/Edit/Write）、搜索（Grep/Glob/LS）、执行（Bash/git/tests）、Web（WebSearch/WebFetch）、代码智能（通过 MCP/LSP 插件）。工具通过 `assembleToolPool` 聚合（[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)）。MCP 工具命名约定 `mcp__<server>__<tool>`（[McKay Zhao: Claude Code 配置指南](https://blog.mckayzhao.com/ai/241/)；[LobeHub: Claude Agent SDK reference](https://lobehub.com/tr/skills/anexileddev-codeforge-claude-agent-sdk)）。
- **Execution**：本地进程内执行；Bash 可进入沙箱（文件系统 + 网络隔离）（[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)）。
- **Permission（见下）**：deny-first 权限门禁位于派发前。
- **Error Handling / Retry**：
  - 最大输出 token 升级（每轮最多 3 次重试）；
  - 响应式压缩（每轮至多触发一次）；
  - prompt-too-long 时依次尝试 context-collapse 溢出 → 响应式压缩 → 终止；
  - 流式降级与回退模型切换（[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)）。
- **Result Processing**：结构化输出（stdout/stderr/文件内容/diff）追加进上下文；错误应"能指导下一步"而非仅返回失败（[CSDN Devpress: Claude Code 架构拆解](https://devpress.csdn.net/v1/article/detail/161850105) 的"好工具标准"：名称具体、参数明确、返回只含支持下一步判断的信息、标明风险、错误可指导下一步）。

**权限系统（重点）**：
- **七种权限模式**（[Anthropic Docs: Agent SDK — Permissions (zh-CN)](https://docs.anthropic.com/zh-CN/api/agent-sdk/permissions)；[McKay Zhao: Claude Code 配置指南](https://blog.mckayzhao.com/ai/241/)）：`plan`（只读探索）/ `default`（交互确认）/ `acceptEdits`（自动接受文件编辑）/ `auto`（模型分类器判定）/ `dontAsk`（白名单外直接拒绝）/ `bypassPermissions`（跳过检查，危险操作仍保留）/ `bubble`（内部：子代理升级到父级）。
- **规则语法**：`allow` / `deny` / `ask`，评估顺序 **deny > ask > allow**，deny 永远优先（[McKay Zhao: Claude Code 配置指南](https://blog.mckayzhao.com/ai/241/)；[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)）。
- **七层安全**（[Claude-Wiki: Architecture Deep Dive](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)）：① 工具预过滤（denied 工具从模型视野移除）② deny-first 规则 ③ 权限模式约束 ④ auto-mode ML 分类器（独立 LLM 调用评估安全）⑤ shell 沙箱 ⑥ 恢复时不继承权限 ⑦ hook 拦截（PreToolUse 可修改或阻断）。
- **deny 规则的脆弱性**：`Bash(curl *)` 拦不住 `Bash(cat .env)`，故可靠防护需配合沙箱或 PreToolUse Hook（[McKay Zhao: Claude Code 配置指南](https://blog.mckayzhao.com/ai/241/)）——这是真实的设计权衡。

**为什么这样设计**：工具即"动作面"，统一 schema 让模型以同一种方式作用于世界；权限的 deny-first 默认保守立场把安全边界放在客户端而非模型承诺上；把易出错、需重试的逻辑（输出溢出、上下文过长）放在 Harness 而非模型侧，保证 loop 的韧性。

---

## 7. Memory

Claude Code 的记忆分短期与长期，并辅以会话级持久化。

- **短期记忆（会话内）**：即对话历史 + 文件状态 + 工具结果，全部在上下文窗口内；随 `/compact` 摘要或 `/clear` 重置（claudecode.jp, docs；[Anthropic: Using Claude Code (session mgmt & 1M context)](https://claude.com/blog/using-claude-code-session-management-and-1m-context)）。每个 turn 都是分支点：`/continue`、`/rewind`（Esc Esc 跳回某条消息重来）、`/clear`、`/compact`、`subagents` 五选一管理上下文（[Anthropic: Using Claude Code (session mgmt & 1M context)](https://claude.com/blog/using-claude-code-session-management-and-1m-context)）。
- **长期记忆（跨会话）**：
  - **CLAUDE.md / Rules**：用户显式写入的持久指令（[Anthropic: Best practices for Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices)）。
  - **Auto Memory（2.1.32+）**：自动记录并召回会话摘要、关键结果、工作日志，提供被动连续性（[Athola: Session Management SKILL](https://github.com/athola/claude-night-market/blob/master/plugins/sanctum/skills/session-management/SKILL.md)）。
  - **Subagent memory**：通过 `memory` 字段给子代理持久目录（`~/.claude/agent-memory/<name>` 用户级 / `.claude/agent-memory/` 项目级 / `-local` 不入库），系统提示注入 `MEMORY.md` 前 200 行或 25KB，子代理可主动积累知识库（[Anthropic Docs: Agent SDK — Sub-agents (fr)](https://docs.anthropic.com/fr/docs/claude-code/sub-agents)；[Claude Code Docs: Sub-agents (zh-CN)](http://code.claude.com/docs/zh-CN/sub-agents)）。
- **Session Resume / Retrieval / Storage**：
  - 存储：转录以 append-only JSONL 落盘于 `~/.claude/projects/.../history.jsonl`，可 `/export` 导出（[Kent Gigger: Resume & manage conversations](https://kentgigger.com/posts/claude-code-conversation-history)）。
  - 恢复：`--resume` / `--continue` / `--fork-session`；2.1.30+ 对 `--resume` 做基于 stat 的会话加载 + 渐进式富化，内存占用降 68%（[Athola: Session Management SKILL](https://github.com/athola/claude-night-market/blob/master/plugins/sanctum/skills/session-management/SKILL.md)）。
  - 检索：会话选择器支持按名称/项目/分支过滤；`/resume` 内可搜索（www.cnblogs.com/quqiboke）。
- **Compaction（压缩即"记忆蒸馏"）**：模型把对话摘要成更小描述后在新窗口继续；可 `/compact focus on X` 引导保留重点（[Anthropic: Using Claude Code (session mgmt & 1M context)](https://claude.com/blog/using-claude-code-session-management-and-1m-context)）。坏压缩多发生在"模型无法预测工作走向"时（[Anthropic: Using Claude Code (session mgmt & 1M context)](https://claude.com/blog/using-claude-code-session-management-and-1m-context)）。

**为什么这样设计**：记忆以**文件（Markdown）而非数据库**承载——简单、可版本化、可被模型直接读写。跨会话连续性靠"数据文件 + 自动召回"而非复杂向量检索，再次体现"做简单的事"。对轻量 Harness，这意味着长期记忆可以是一个 `.md` 文件体系，而非引入数据库。

---

## 8. Skills / Extension

Claude Code 用 7 种方法定制行为：CLAUDE.md、Rules、Skills、Subagents、Hooks、Output Styles、追加 system prompt（[Anthropic: Steering Claude Code](https://claude.com/de/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)）。本文聚焦 Skills / Extension 三件套：Skills、Subagents、MCP，外加 Hooks 与 Plugins。

- **Skills**：位于 `.claude/skills/` 的文件夹，含 `SKILL.md`（name/description/body）。仅 name+description 在会话启动加载，完整 body 在调用时（斜杠命令 `/` 或自动匹配）加载；compaction 时按共享预算重新注入，旧的先丢弃（[Anthropic: Steering Claude Code](https://claude.com/de/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)）。`context: fork` 可在隔离上下文运行 skill（claude-wiki.com/extend）。规则：可复用、程序化工作流（部署、审查清单）放 skill，而非 CLAUDE.md（[Anthropic: Steering Claude Code](https://claude.com/de/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)）。
- **Subagents**：`.claude/agents/` 下的 markdown + YAML frontmatter（name/description/model/tools），经 Agent tool 调用。完全上下文隔离，仅返回摘要；可嵌套至 5 层；可 `memory` 持久化；可 `skills` 预加载；可经 SendMessage 恢复（[Anthropic Docs: Agent SDK — Sub-agents (fr)](https://docs.anthropic.com/fr/docs/claude-code/sub-agents)；[Anthropic: How and when to use subagents](https://claude.com/blog/subagents-in-claude-code)）。适用：研究密集、多独立子任务、需要新鲜视角验证（[Anthropic: How and when to use subagents](https://claude.com/blog/subagents-in-claude-code)）。
- **Hooks**：用户定义命令 / HTTP 端点 / LLM 提示，在生命周期事件（PreToolUse、PostToolUse、SessionStart、Stop、SubagentStart/Stop 等约 12+ 事件）触发，提供确定性控制（[Anthropic: Steering Claude Code](https://claude.com/de/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)；[Claude-Codex.fr: Observability & Monitoring](https://claude-codex.fr/en/advanced/observabilite-monitoring)）。PreToolUse 可返回 `permissionDecision: deny` 阻断，比 deny 规则更可靠（[McKay Zhao: Claude Code 配置指南](https://blog.mckayzhao.com/ai/241/)）。
- **MCP（Model Context Protocol）**：连接外部工具/服务（DB、浏览器、Figma、GitHub）。支持 stdio / SSE / HTTP（streamable）三种传输（[LobeHub: Claude Agent SDK reference](https://lobehub.com/tr/skills/anexileddev-codeforge-claude-agent-sdk)；[Team400: Claude Agent SDK TypeScript](https://team400.ai/blog/2026-04-claude-agent-sdk-typescript-building-production-agents)）。内置 `createSdkMcpServer` 把工具包装为进程内 MCP server（[Team400: Claude Agent SDK TypeScript](https://team400.ai/blog/2026-04-claude-agent-sdk-typescript-building-production-agents)）。Tool Search 默认按需加载避免上下文膨胀（[McKay Zhao: Claude Code 配置指南](https://blog.mckayzhao.com/ai/241/)）。
- **Plugins**：把 commands/agents/MCP/hooks/skills 打包分发（[CSDN Devpress: Claude Code 架构拆解](https://devpress.csdn.net/v1/article/detail/161850105)）；官方市场与第三方市场并存（claude-wiki.com/extend）。
- **Worktrees / Agent Teams**：git worktree 隔离文件变更做并行开发；Agent teams 是多独立 Claude Code 会话协作（[CSDN Devpress: Claude Code 架构拆解](https://devpress.csdn.net/v1/article/detail/161850105)；[Claude-Codex.fr: Observability & Monitoring](https://claude-codex.fr/en/advanced/observabilite-monitoring)）。

**为什么这样设计**：扩展点的核心矛盾是"指令何时加载 / 是否跨 compaction 保留 / 权威度多大"。Skills（按需）、Subagents（隔离+并行）、Hooks（确定性拦截）、MCP（外部能力协议）各解决不同维度，使 Harness 保持"low-level"却能无限扩展。对轻量 Harness，MCP 应作为**统一工具协议**，Subagent 作为并行/隔离原语。

---

## 9. Observability

Claude Code 自 2025 起内建 OpenTelemetry 支持，一个环境变量 `CLAUDE_CODE_ENABLE_TELEMETRY=1` 即可把 metrics / logs / traces 推送到任意 OTLP 后端（Prometheus / Grafana / Datadog / Jaeger 等，[Claude-Codex.fr: Observability & Monitoring](https://claude-codex.fr/en/advanced/observabilite-monitoring)；[Juejin: 可观测性与成本控制](https://juejin.cn/post/7649222180199268371)）。

- **Metrics（指标）**（[Anthropic Docs: Monitoring usage](https://docs.anthropic.com/en/docs/claude-code/monitoring-usage)）：`claude_code.session.count`、`claude_code.lines_of_code.count`、`claude_code.pull_request.count`、`claude_code.commit.count`、`claude_code.cost.usage`（USD）、`claude_code.token.usage`（分 input/output/cacheRead/cacheCreation）、`claude_code.code_edit_tool.decision`、`claude_code.active_time.total`。带标准属性 `session.id`、`app.version`、`organization.id`、`user.account_uuid` 等。token 按类型拆分是因为缓存读写单价不同（cache_read 约 1/10，cache_creation 约 1.25 倍）（[Juejin: 可观测性与成本控制](https://juejin.cn/post/7649222180199268371)）。
- **Events / Logs**：`user_prompt` / `api_request` / `tool_result` 等，由 `prompt.id` 关联同一次用户提示触发的所有事件（[Claude-Wiki: Monitoring](https://claude-wiki.com/monitoring.html)）。
- **Traces（链路，beta）**：设 `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` 后，每个 loop 步成为 span：`claude_code.interaction`（单轮）→ 内含 `claude_code.llm_request`、`claude_code.tool`（含 `blocked_on_user` 与 `execution` 子 span）、`claude_code.hook`；subagent 经 Task tool 派生的 span 嵌套于父 tool 下（[Claude-Wiki: Observability](https://claude-wiki.com/observability-with-opentelemetry.html)；[Claude-Codex.fr: Observability & Monitoring](https://claude-codex.fr/en/advanced/observabilite-monitoring)）。
- **敏感数据控制**：默认只记录时长/模型名/工具名，不记读写内容；`OTEL_LOG_USER_PROMPTS` / `OTEL_LOG_TOOL_DETAILS` / `OTEL_LOG_TOOL_CONTENT` 三变量按需开启（[Claude-Wiki: Observability](https://claude-wiki.com/observability-with-opentelemetry.html)）。
- **Lifecycle Hooks 作为细粒度可观测**：12+ 事件可写 SQLite 或推 HTTP，回答"确切何时发生"（[Claude-Codex.fr: Observability & Monitoring](https://claude-codex.fr/en/advanced/observabilite-monitoring)）。
- **社区看板**：claude-hud、abtop、Claude-Code-Agent-Monitor 等开源终端/多 agent 看板（[Claude-Codex.fr: Observability & Monitoring](https://claude-codex.fr/en/advanced/observabilite-monitoring)）。
- **Evaluation 雏形**：best practices 提出用 `/goal` 条件、Stop hook 作为确定性门禁、验证 subagent"第二意见"来让无人值守运行正确结束（[Anthropic: Best practices for Claude Code](https://www.anthropic.com/engineering/claude-code-best-practices)）——这已是 Agent 评估/验证的雏形。

**为什么这样设计**：可观测性以**标准协议（OTel）而非私有方案**输出，使团队能直接复用既有监控栈；span 层级精确映射 Agent Loop 结构，使"一次用户提示如何级联成 LLM 调用、工具调用、hook"完全可视。对轻量 Harness，这提示"从第一天就定义统一 trace/event 契约"，而非事后补埋点。

---

## 10. 对 Axiom Agent 的启发

综合上述，对**通用轻量 Axiom Agent** 的可落地启发：

1. **模型即节点，Harness 即工作台**：把推理留给模型、把执行/管控/持久化留给运行时。不要把业务规则硬编码进调用逻辑；用指令文件（CLAUDE.md 类）而非代码分支来表达"该怎么做"。
2. **单线程主循环 + 扁平历史**：用 `while(tool_call)` 的极简循环换取可调试性与可靠性，而非一上来就上状态图/swarm。并行交给显式的 subagent 原语，且**默认一次只派生有限分支**（避免失控蔓延）。
3. **上下文是首要约束**：以"窗口容量"为第一性资源，围绕它设计按需加载（skills/rules/MCP tool search）、compaction、subagent 隔离三件套。默认不把任何东西常驻上下文。
4. **工具统一接口 + Deny-first 权限**：所有动作走同一种 JSON 工具调用 → 执行 → 文本结果；安全默认保守（deny > ask > allow），且权限**不跨会话继承**。把易错的重试/溢出逻辑放在 Harness。
5. **记忆用文件而非数据库**：短期=窗口内历史+compaction；长期=Markdown 指令文件 + 自动召回。简单、可版本化、模型可读写。
6. **扩展靠原语而非硬编码**：Skills（按需程序化工作流）、Subagents（隔离+并行）、Hooks（确定性拦截）、MCP（外部能力协议）、Plugins（打包分发）。Harness 保持 low-level，能力靠组合涌现。
7. **可观测性从第一天内置**：以标准协议（OTel 类）输出 trace/metric/event，span 精确映射 loop 结构；敏感数据默认不采集。
8. **验证闭环**：给 Agent 一个可运行的"检查项"（测试/构建/截图 diff），让 loop 自行关闭；用 Stop hook / 验证 subagent 实现无人值守正确结束——这是 Agent 评估的雏形。

---

## 11. 对本项目设计的影响

结合本项目已有资产——**ConsoleAgent（终端 Agent）/ SiteAgent（浏览器 Agent）/ MCP·Tool 调用 / DOM Grounding / Agent Trace·Evaluation**——对 `packages/core` 的具体影响：

1. **core 只承载"运行时三件套"**：`queryLoop`（单线程主循环）、`ContextBuilder`（每轮组装 system+history+memory+tool schema）、`StateStore`（append-only transcript + 会话级状态）。ConsoleAgent / SiteAgent 作为**应用层 Agent 实现**，不污染 core。这与 §4 的 Runtime/Context/Application 三分法直接对应。
2. **统一 Tool 接口 = MCP 优先**：本项目已有 MCP·Tool 调用经验，应把 MCP 作为 core 的**一等工具协议**（stdio/SSE/HTTP），内置工具与 SiteAgent 的浏览器工具都通过同一 schema/registry/permission/result 管线；沿用 `mcp__<server>__<tool>` 命名与 Tool Search 按需加载，避免上下文膨胀。
3. **SiteAgent 即"环境特化的 Subagent"**：浏览器任务本质是需要**自身上下文隔离 + DOM Grounding** 的子代理。复用 Claude Code 的 subagent 思想——SiteAgent 在独立 context 工作、仅返回摘要；其 DOM Grounding 是"把工具结果锚定到真实环境状态（DOM 而非文件）"的特化，对应 Claude Code 用 checkpoint 把文件变更锚定到真实 FS 状态。core 应提供 subagent 派发 + 隔离 + 恢复（resume by id）原语，SiteAgent/ConsoleAgent 皆为其实例。
4. **DOM Grounding ↔ Checkpoint 对齐**：Claude Code 用 checkpoint 快照文件以可逆编辑；浏览器侧用 DOM 快照做可回溯的操作锚点。core 的 StateStore 应记录"环境状态快照"，使任意 Agent 的行动可审计、可回滚——这同时服务于 Agent Trace·Evaluation。
5. **Memory 轻量化**：短期靠 compaction（可借鉴 5 策略分级，但 v1 先实现"超限摘要"）；长期用项目级 Markdown 记忆文件（类 CLAUDE.md / auto memory），不引入数据库；subagent 记忆用独立 `agent-memory/` 目录。
6. **Observability 直接复用 Agent Trace·Evaluation**：把本项目的 Agent Trace 对齐到 §9 的 span 层级（`interaction → llm_request / tool / hook`），使其能映射 ConsoleAgent 与 SiteAgent 的多 agent 视图；默认不采集环境读写内容，提供 opt-in 开关。Evaluation 用 §9 的"验证 subagent / Stop hook 门禁"模式实现无人值守闭环。
7. **权限与安全**：core 提供 deny-first 权限模式（default/plan/acceptEdits/auto/dontAsk）与 PreToolUse hook 拦截；对环境操作（如 SiteAgent 的导航/点击）同样走权限门禁，且**权限不跨会话继承**。

> 一句话总结：`packages/core` 应是一个"单线程主循环 + 上下文组装 + 统一 MCP 工具 + 文件式记忆 + 内置可观测"的最小运行时；ConsoleAgent 与 SiteAgent 作为应用层 Subagent 实例跑在它之上，DOM Grounding 是浏览器环境的"状态锚点"特化，Agent Trace·Evaluation 是其天然的可观测/验证层。

---

## 参考文献（APA 风格）

> **来源说明**：本列表含官方文档与社区/第三方整理资料。标注「社区来源」的条目（如 GitHub 社区镜像 code-yeongyu/claude-code、claudecode.jp 文档镜像、claude-wiki.com/extend 等）为第三方/社区整理，**未经 Anthropic 官方背书**，引用时请自行甄别。正文中 `（claudecode.jp, docs）`、`（www.cnblogs.com/quqiboke）`、`（claude-wiki.com/extend）` 三项因文末无对应 URL，保留原始括号引用、未转换为超链接。

Anthropic. (2025). *Best practices for Claude Code*. Anthropic Engineering. [https://www.anthropic.com/engineering/claude-code-best-practices](https://www.anthropic.com/engineering/claude-code-best-practices)

Anthropic. (2025). *Using Claude Code: session management and 1M context*. Claude Blog. [https://claude.com/blog/using-claude-code-session-management-and-1m-context](https://claude.com/blog/using-claude-code-session-management-and-1m-context)

Anthropic. (2025). *How and when to use subagents in Claude Code*. Claude Blog. [https://claude.com/blog/subagents-in-claude-code](https://claude.com/blog/subagents-in-claude-code)

Anthropic. (2025). *Steering Claude Code: skills, hooks, rules, subagents and more*. Claude Blog. [https://claude.com/de/blog/steering-claude-code-skills-hooks-rules-subagents-and-more](https://claude.com/de/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)

Anthropic. (n.d.). *Claude Code documentation: Monitoring usage*. [https://docs.anthropic.com/en/docs/claude-code/monitoring-usage](https://docs.anthropic.com/en/docs/claude-code/monitoring-usage)

Anthropic. (n.d.). *Claude Code Agent SDK: Permissions / Sub-agents / Memory*. [https://docs.anthropic.com/zh-CN/api/agent-sdk/permissions](https://docs.anthropic.com/zh-CN/api/agent-sdk/permissions) ； [https://docs.anthropic.com/fr/docs/claude-code/sub-agents](https://docs.anthropic.com/fr/docs/claude-code/sub-agents) ； [http://code.claude.com/docs/zh-CN/sub-agents](http://code.claude.com/docs/zh-CN/sub-agents)

Agentway. (2025). *Claude Code 架构*. [https://agentway.dev/zh/claudecode/architecture](https://agentway.dev/zh/claudecode/architecture)

Claude-Wiki. (2025). *Dive into Claude Code — Architecture Deep Dive*. [https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html](https://claude-wiki.com/dive-into-claude-code-architecture-deep-dive.html)

Claude-Wiki. (2025). *Monitoring / Observability with OpenTelemetry*. [https://claude-wiki.com/monitoring.html](https://claude-wiki.com/monitoring.html) ； [https://claude-wiki.com/observability-with-opentelemetry.html](https://claude-wiki.com/observability-with-opentelemetry.html)

PromptLayer. (n.d.). *Claude Code: Behind-the-scenes of the master agent loop*. [https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop)

Kondasamy. (2026). *How Claude Code Actually Works Under the Hood*. [https://kondasamy.com/blog/2026/how-claude-code-works](https://kondasamy.com/blog/2026/how-claude-code-works)

Claude-Codex.fr. (2026). *Observability and monitoring for Claude Code*. [https://claude-codex.fr/en/advanced/observabilite-monitoring](https://claude-codex.fr/en/advanced/observabilite-monitoring)

Juejin. (2025). *Claude Code 源码分析报告*. [https://juejin.cn/post/7623311375617720330](https://juejin.cn/post/7623311375617720330)

Juejin. (2025). *深度拆解 Claude Code 系列(七):可观测性与成本控制*. [https://juejin.cn/post/7649222180199268371](https://juejin.cn/post/7649222180199268371)

Takeshell. (2026). *Claude Code 源码揭秘:整体架构概览*. [https://takeshell.com/2026/04/07/claude-code-architecture-overview](https://takeshell.com/2026/04/07/claude-code-architecture-overview)

McKay Zhao. (n.d.). *Claude Code 配置文件指南: MCP / 推理等级 / 授权 / 全局配置 / 项目配置*. [https://blog.mckayzhao.com/ai/241/](https://blog.mckayzhao.com/ai/241/)

DevOps-Monk. (2026). *Claude Code Session Management: Parallel Work and Persistent Context*. [https://blog.devops-monk.com/2026/06/claude-code-session-management](https://blog.devops-monk.com/2026/06/claude-code-session-management)

LobeHub / ClawHub. (2026). *Claude Agent SDK (TypeScript/Python) reference*. [https://lobehub.com/tr/skills/anexileddev-codeforge-claude-agent-sdk](https://lobehub.com/tr/skills/anexileddev-codeforge-claude-agent-sdk) ； [https://clawhub.ai/openlark/claude-code-agent-sdk](https://clawhub.ai/openlark/claude-code-agent-sdk)

Team400. (2026). *Claude Agent SDK TypeScript — Building Production AI Agents*. [https://team400.ai/blog/2026-04-claude-agent-sdk-typescript-building-production-agents](https://team400.ai/blog/2026-04-claude-agent-sdk-typescript-building-production-agents)

Fast.io. (2026). *How to Use the Claude Code API and Agent SDK*. [https://fast.io/resources/claude-code-api-sdk-guide](https://fast.io/resources/claude-code-api-sdk-guide)

Kent Gigger. (n.d.). *How to resume, search, and manage Claude Code conversations*. [https://kentgigger.com/posts/claude-code-conversation-history](https://kentgigger.com/posts/claude-code-conversation-history)

Athola (claude-night-market). (n.d.). *Session Management SKILL (auto memory, resume, agent persistence)*. [https://github.com/athola/claude-night-market/blob/master/plugins/sanctum/skills/session-management/SKILL.md](https://github.com/athola/claude-night-market/blob/master/plugins/sanctum/skills/session-management/SKILL.md)

CSDN Devpress. (n.d.). *Claude Code 架构拆解:它到底是怎么把大模型变成编程 Agent 的*. [https://devpress.csdn.net/v1/article/detail/161850105](https://devpress.csdn.net/v1/article/detail/161850105)

GitHub (mirror). (2026). *anthropics/claude-code source (community mirror)*. [https://github.com/code-yeongyu/claude-code](https://github.com/code-yeongyu/claude-code)
