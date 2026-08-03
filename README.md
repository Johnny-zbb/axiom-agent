# Axiom Agent

![Axiom Agent 项目横幅](website/static/img/axiom-agent-banner.png)

一个轻量级 Axiom Agent 的探索与实现。

本项目旨在探索如何通过工程系统将大语言模型（LLM）的能力转化为更加可靠、可执行的 Agent 系统。

主要探索方向：

- Agent Runtime
- Context Engineering（上下文工程）
- Tool Runtime（工具运行时）
- Memory（记忆系统）
- Skills（技能系统）
- Evaluation（评估体系）


## 背景

LLM 本身并不是 Agent。

一个可靠的 Agent 系统需要额外的工程层来管理：

- Context（上下文）
- State（状态）
- Tools（工具）
- Memory（记忆）
- Feedback Loop（反馈循环）

这个项目希望探索并实现这一层工程能力，即 Axiom Agent。


## 目标

本项目通过实现一个轻量级 Agent Runtime，探索 Axiom Agent 的核心设计与工程实践：

- Agent Loop 如何运行
- 状态如何管理
- 上下文如何构建
- 工具如何调度
- 记忆如何影响决策
- 如何通过评估持续优化 Agent

并在 Browser Agent、Coding Agent 等实际场景中进行验证。

## 文档站点

- 在线文档：https://johnny-zbb.github.io/axiom-agent/
- 文档内容：`docs/`
- Docusaurus 站点：`website/`

本地启动：

```bash
pnpm install
pnpm dev
```

## 当前实现

- [`@axiom-agent/core`](packages/core)：Agent Loop、Harness、Session、Context、Tools 和 Event Stream
- [`@axiom-agent/openai-compatible`](packages/providers/openai-compatible)：OpenAI-compatible Chat Completions Provider
- [`@axiom-agent/session-jsonl`](packages/session-jsonl)：可恢复的 append-only JSONL SessionStore
- [`@axiom-agent/coding-agent`](packages/coding-agent)：工作区边界与四个最小 Coding Tools
- [`@axiom-agent/trace-jsonl`](packages/trace-jsonl)：可检查、可重放的 Event Stream 记录
- [`@axiom-agent/eval`](packages/eval)：隔离 fixture、独立 verifier 与可复现产物的 Coding Agent 评测

无需 API Key 体验 Session 恢复：

```bash
pnpm --filter @axiom-agent/example-resumable-session start demo first
pnpm --filter @axiom-agent/example-resumable-session start demo second
```

真实模型与 calculator tool 示例见 [`examples/tokenrhythm-calculator`](examples/tokenrhythm-calculator)。
真实文件修改与测试闭环见 [`examples/coding-agent`](examples/coding-agent)。
评测结果界面见 [`examples/astryx-eval-dashboard`](examples/astryx-eval-dashboard)，交互式 Coding Agent 界面见 [`examples/coding-agent-gui`](examples/coding-agent-gui)。

- [v0.1 实现架构](docs/architecture/implemented-v0.1.md)
- [真实 Coding Agent 验证记录](docs/decisions/002-real-coding-agent-proof.md)
- [评测基线](docs/decisions/003-evaluation-baseline.md)
- [Coding Agent GUI 决策](docs/decisions/004-coding-agent-gui.md)
