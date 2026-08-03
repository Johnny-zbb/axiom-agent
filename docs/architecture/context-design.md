---
title: Context 设计
sidebar_position: 4
---

# Context Engineering 设计依据

> 聚焦 Context 层：context 如何动态构建、压缩与窗口管理策略、何时注入什么、长程记忆如何进入 context。
> 对比 Claude Code / Codex / Pi Agent / OpenHarness，给出 `packages/core` 的 Context 构建管线设计（含阶段与触发条件）。

本文贯彻 [设计综述](core-design-overview.md) 的三分法：此处 **Context State = 每轮实际发送给模型的内容视图**，它是 Runtime 与 Application 状态的投影，受 Token 预算约束，每轮动态重建，不独立持久化。

---

## 1. Context 是首要约束资源

四项目的共识：上下文窗口是**绑定资源约束**，越满性能越退化（"context rot" / 上下文腐烂，[Claude Code](../research/claude-code.md)）。整个上下文工程服务于"在有限窗口内，让模型恰好看到该看的东西"。因此 `packages/core` 的 Context Builder 应以**窗口容量**为第一性资源来设计。

**设计判据**：凡是"稳定、跨轮不变"的内容 → 放前缀；凡是"随轮变化"的内容 → 放尾部；凡是"可省则省"的内容 → 按需加载、绝不常驻。

---

## 2. Context 动态构建的六要素（对比四项目）

| 要素 | Claude Code | Codex | Pi Agent | OpenHarness |
|------|-------------|-------|----------|-------------|
| System Prompt | `prompts.ts`+`CLAUDE.md` 组合 | system + AGENTS.md | `transformContext` 注入 | `prompts/` 组装 |
| History | 扁平历史，5 策略压缩 | `ContextManager.items` 向量 | `AgentMessage[]` + COW | `context/` 历史管理 |
| Compression | 5 策略 + auto-compact | 远端/本地 compaction | 3 阶段（Prepare/Summarize/Replace） | Auto-Compact（Token 预算） |
| Memory 注入 | CLAUDE.md/Rules/Skills/Auto Memory | AGENTS.md/Memories | `context` 事件 + MEMORY.md | MEMORY.md + 结构化 schema |
| Tool Schema | 随请求下发 + Tool Search 按需 | 随请求 + 缓存前缀 | TypeBox→JSON Schema | 43+ 工具 schema 下发 |
| Workspace | 目录/git/subagent roster | 工作目录/沙箱配置 | 工作区文件读写 | FS/Shell/Web/MCP |

**关键共性**：
1. **分层注入**：稳定规则（CLAUDE.md/AGENTS.md）→ 持久记忆（MEMORY.md/Auto Memory）→ 会话连续（History）分离，而非混在一起（[OpenHarness](../research/openharness.md) 借鉴 [Claude Code](../research/claude-code.md) 的"layer long-term rules, persistent memory, session continuity"）。
2. **按需加载优于常驻**：Skills/Rules/Subagents/MCP Tool Search 都"默认不进上下文，触发才加载"（[Claude Code](../research/claude-code.md)）。
3. **稳定前缀缓存纪律**：system + tool schema + 项目指引放前缀且保持稳定，动态内容（tool 结果、用户输入）严格追加尾部，避免缓存失效（[Codex](../research/codex.md) "don't break the cache"）。

---

## 3. 压缩与窗口管理策略

四项目的压缩取向一致：**保留"行动语义"而非"信息量最大"**，压缩后须能继续工作（[OpenHarness](../research/openharness.md) 引 [Claude Code](../research/claude-code.md) 设计指南）。

- **[Claude Code](../research/claude-code.md) 5 策略**：① per-message 尺寸上限 ② 历史裁剪 ③ 缓存感知微压缩 ④ 读取时虚拟投影（非破坏性）⑤ 模型生成完整摘要（最后手段）。
- **[Codex](../research/codex.md)**：远端 `/responses/compact`（加密 `encrypted_content`，客户端不透明）或本地 LLM 摘要（handoff summary：进度/决策/约束/剩余工作）；阈值 `auto_compact_token_limit`，默认 95% 窗口。
- **[Pi Agent](../research/pi.md)**：3 阶段（保留 ≥20k 近期 → LLM 总结并跟踪文件读写 → 写入 compaction 条目）；自动（约 80% 窗口）或手动 `/compact`。
- **[OpenHarness](../research/openharness.md)**：Auto-Compact 基于 Token 预算（二手报道 128k→80k，量级参考）；v0.1.6 起压缩保留任务状态与渠道日志，支持多日会话。

**工具输出截断**：大输出永不全量进 context（[Codex](../research/codex.md) 默认 `bytes(10_000)`；[Pi Agent](../research/pi.md) bash 输出默认截断约 200KB）。

**设计建议（v1 分级）**：`packages/core` v1 先实现"超限摘要（本地 LLM 摘要）"；后续分级：① per-message 上限 ② 历史裁剪 ③ 缓存感知微压缩 ④ 虚拟投影 ⑤ 模型完整摘要。触发阈值可配（默认 80–95% 窗口）。压缩后须**重建运行时语义**（计划/文件/技能/Hook 状态），而非只做摘要（[OpenHarness](../research/openharness.md) §5）。

---

## 4. 何时注入什么（阶段与触发条件）

`packages/core` 的 Context 构建管线按以下阶段顺序执行，每阶段有触发条件：

```
阶段 0  稳定前缀组装（每会话一次，缓存）
        ├─ System Prompt（核心指令）
        ├─ 项目指引 CLAUDE.md / AGENTS.md（分层聚合，子目录追加）
        └─ Tool Schema（全部可见工具，或 Tool Search 按需子集）
阶段 1  持久记忆召回（每轮或按事件）
        └─ MEMORY.md 结构化条目（带 TTL / 召回索引）
阶段 2  会话连续层（每轮）
        └─ History（扁平消息，受 COW/窗口约束）
阶段 3  外部上下文注入（事件驱动，可选）
        └─ `context` 事件钩子允许扩展注入/剥离（[Pi Agent](../research/pi.md)）
阶段 4  压缩（触发条件：≥阈值 / 溢出 / 手动 /compact）
        └─ 超限摘要 → 重建语义 → 写入 compaction 条目
阶段 5  动态尾部追加（每轮）
        └─ 本轮 tool_result / observation（DOM/shell/file）
```

**触发条件判据**：
- 阶段 0 仅在 session 启动 / 配置变更时重建（保缓存）。
- 阶段 1 在 session 启动 + 记忆变更事件时召回。
- 阶段 3 由 `context` 事件处理器在 turn 开始前置触发（"最便宜的工具调用是永不发生的那次"，[Pi Agent](../research/pi.md)）。
- 阶段 4 由预算阈值或显式指令触发。

---

## 5. 长程记忆如何进入 Context

四项目均**不用独立向量库做长程记忆**，而是拆为三件事（[Codex](../research/codex.md) "不必一上来就上 RAG"）：

1. **会话持久化**（JSONL rollout / transcript）：恢复时重放。
2. **项目指引**（CLAUDE.md / AGENTS.md）：跨会话稳定规则，compaction 不丢（[Claude Code](../research/claude-code.md) 外置为数据文件）。
3. **上下文窗口管理**（compaction）：长程信息靠压缩摘要保留。

[OpenHarness](../research/openharness.md) 进一步把 `MEMORY.md` 做成"受治理的资源"：稳定 id + 软删除 + TTL + `usage_index.json` 召回追踪。

**设计建议**：`packages/core` 长期记忆采用**项目级 Markdown 记忆文件 + 结构化 frontmatter 索引**（类 CLAUDE.md / MEMORY.md / Auto Memory），v1 不引入数据库（[Claude Code](../research/claude-code.md) "记忆用文件而非数据库"）。RAG 式检索作为可选 `context` 事件扩展接入，Core 不内置。

---

## 6. `packages/core` Context 构建管线设计总结

- **管线骨架内置（Core）**：阶段 0/2/4/5 + 默认窗口裁剪 + 超限摘要压缩。
- **注入内容外置（Plugin/Application）**：阶段 1 的具体记忆文件、阶段 3 的 RAG 检索后端、具体项目指引文本。
- **缓存纪律**：稳定前缀（system/tool schema/项目指引）与动态尾部（history/tool 结果/observation）严格分离，前缀变更以"追加同格式新消息"处理而非改旧消息（[Codex](../research/codex.md)）。
- **Context/LLM 视角分离**：借鉴 [Pi Agent](../research/pi.md) 的 `convertToLlm` + 声明合并自定义消息类型——UI 通知与模型可见消息解耦，避免把无关 UI 噪声喂给模型。

**一句话**：Context 是"受预算约束的工作记忆"，由 `packages/core` 的分阶段管线动态构建——稳定前缀缓存、持久记忆按需召回、会话历史连续、外部上下文事件注入、超限重建语义压缩；一切以"让模型恰好看到该看的"为目标。

---

## 参考来源

- [Claude Code 架构研究](../research/claude-code.md)
- [OpenAI Codex 架构研究](../research/codex.md)
- [Pi Agent 架构研究](../research/pi.md)
- [OpenHarness 架构研究](../research/openharness.md)
