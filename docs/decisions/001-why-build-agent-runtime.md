# 为什么实现自己的 Agent Runtime？

## 背景

随着 LLM Agent 的发展，越来越多的 Agent Framework 出现，例如：

* LangGraph
* AutoGen
* Semantic Kernel
* OpenAI Agents SDK

这些框架提供了丰富的能力，可以帮助开发者快速构建 Agent 应用。

在实际使用过程中，框架能够解决大量工程问题，例如：

* Agent 编排
* Tool Calling
* 状态管理
* Workflow 执行

但是，对于学习 Axiom Agent Engineering 来说，仅仅使用框架可能无法深入理解 Agent 内部运行机制：

* Agent Loop 如何设计？
* 状态如何管理？
* Context 如何构建？
* Tool 调用如何控制？
* Memory 如何影响下一步决策？
* 如何记录 Agent 执行轨迹？

因此，本项目尝试实现一个轻量级 Agent Runtime，用于学习和探索 Axiom Agent 的核心设计。

---

# 为什么不用现有 Framework？

并不是因为 Framework 不好。

实际上，在快速验证想法时，使用成熟 Framework 是非常合理的选择。

例如：

* 快速搭建 Demo
* 验证 Agent Workflow
* 快速接入模型能力

Framework 可以帮助开发者避免重复实现大量基础能力。

---

但是，如果目标是学习 Agent Runtime 的设计，那么自己实现核心部分有几个价值：

## 1. 理解 Agent Loop

很多 Agent Framework 将执行流程封装起来。

使用时可能只需要：

```ts
agent.invoke()
```

但是隐藏了：

* 状态如何变化
* 消息如何传递
* Tool 如何执行
* 什么时候继续循环
* 什么时候结束

自己实现 Runtime，可以直接理解：

```
User Task

↓

Agent Loop

↓

LLM

↓

Tool

↓

Observation

↓

Next Step
```

---

## 2. 理解 Context Engineering

Agent 的效果不仅取决于模型能力，也取决于：

> 模型每一次看到什么信息。

Runtime 需要考虑：

* 历史消息
* Memory
* Tool Result
* Environment State
* Token Budget

通过自己实现 Context Builder，可以更深入理解：

为什么 Context 是 Agent 的核心能力。

---

## 3. 理解 Tool Runtime

简单 Tool Calling：

```ts
tool(args)
```

只是表层。

真实 Agent 需要考虑：

* 参数校验
* 错误处理
* 超时
* 重试
* 结果压缩
* 轨迹记录

这些都是 Harness 的重要组成。

---

# 学习目标

这个项目不是为了替代 LangGraph 等成熟框架。

目标是：

> 通过实现一个最小可运行 Agent Runtime，理解现代 Agent 系统背后的工程抽象。

主要探索：

* Agent Loop
* State Management
* Context Engineering
* Tool Runtime
* Memory
* Evaluation
* Trajectory

---

# 实现策略

采用：

## 复用成熟能力

例如：

* LLM API Client
* Tokenizer
* Parser

## 自己实现核心逻辑

例如：

* Runtime Loop
* State Model
* Context Builder
* Tool Execution
* Memory Strategy

原因：

这些部分更接近 Axiom Agent 的核心。

---

# 预期产出

最终希望形成：

```
Agent Runtime

├── Runtime Core

├── Context Engine

├── Memory System

├── Tool System

├── Evaluation

└── Experiments
```

并通过实际案例验证：

* Browser Agent
* Coding Agent
* Cloud Agent

---

# 总结

实现自己的 Agent Runtime，不是因为现有 Framework 不够好。

而是：

> 在学习 Axiom Agent 的过程中，通过重新实现核心机制，加深对 Agent 系统设计的理解。

成熟 Framework 帮助我们快速构建 Agent。

而 Runtime 实现帮助我们理解 Agent 为什么能够工作。

---

我觉得这个定位更符合你现在的阶段。

因为你的目标不是马上造一个 LangGraph 替代品，而是：

1. **补齐 Agent Infra 思维**
2. **把 SiteAgent / ConsoleAgent 经验抽象出来**
3. **为 DeepSeek Harness 岗准备作品**

所以仓库应该像：

```
Axiom Agent Lab
```

而不是：

```
Production Agent Framework
```

这两个定位差别很大。你现在选择“学习型工程仓库”反而更容易做深。
