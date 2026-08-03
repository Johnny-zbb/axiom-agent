---
title: Tool 设计
sidebar_position: 5
---

# Tool System 设计依据

> 聚焦 Tool 子系统：tool schema 契约、registry 与发现、执行模型、错误处理/重试/超时、permission 门控、result 处理与回流。
> 对比 Claude Code / Codex / Pi Agent / OpenHarness，给出 `packages/core` 的 Tool 子系统设计（含 schema 示例与权限策略）。

本文贯彻 [设计综述](core-design-overview.md) 的 Core/Plugin 边界：Tool Registry + 执行管线 + 入口校验属 **Core**；具体工具实现、MCP server 连接、交互式审批 UI 属 **Plugin/Application**。

---

## 1. 统一 Tool 契约（跨四项目共识）

四项目的工具都遵循**统一接口模式**：JSON 工具调用 → （沙箱化）执行 → 以纯文本 `tool_result` 回流（[Claude Code](../research/claude-code.md)、[Codex](../research/codex.md) 同）。统一性带来可预测性与安全。

- **Schema 驱动**：[Claude Code](../research/claude-code.md) 约 48–54 工具 `assembleToolPool` 聚合；[Codex](../research/codex.md) 用 `ToolSpec` 枚举 + JSON Schema + Rust 编译期校验；[Pi Agent](../research/pi.md) 用 TypeBox 单一定义同时生成 JSON Schema（给 LLM）与 TS 类型（给代码）；[OpenHarness](../research/openharness.md) 43+ 工具继承 `BaseTool` + Pydantic 校验 + 自描述 JSON Schema。
- **内置与 MCP 同等待遇**：[Codex](../research/codex.md) MCP 工具与内置同 schema、同沙箱；[Claude Code](../research/claude-code.md) `mcp__<server>__<tool>` 命名约定。

**设计建议**：`packages/core` 的 Tool 契约以"定义（给 LLM）/实现（给执行）"分离的双层结构为基准（借鉴 [Pi Agent](../research/pi.md)）：

```typescript
// ToolDefinition：给 LLM 消费
interface ToolDefinition {
  name: string;                 // 如 "mcp__fs__read"
  description: string;          // 具体、可指导模型选择
  input_schema: JSONSchema;     // 自动从类型生成（TS type / Pydantic）
}

// AgentTool：给运行时消费
interface AgentTool {
  definition: ToolDefinition;
  validate(input): ValidationResult;        // 入口 AJV/JSON Schema 校验
  execute(ctx, input): Promise<ToolResult>; // 环境执行
}
```

---

## 2. Registry 与发现

- **双层注册**：`ToolDefinition`（LLM 可见）→ `AgentTool`（运行时执行），LLM 选工具后 runtime 匹配并调用（[Pi Agent](../research/pi.md)）。
- **Router/Registry 分离**：[Codex](../research/codex.md) `ToolRouter`（解析 内置/MCP/特殊）→ `ToolRegistry`（统一注册查找）→ 执行编排 → Sandbox Executor。
- **默认仅按需加载**：[Claude Code](../research/claude-code.md) 的 Tool Search 默认仅动态加载 MCP 工具，避免占满窗口。

**设计建议**：`packages/core` 提供 `ToolRegistry.register(agentTool)` 与 `ToolRouter.dispatch(call)`；内置工具与 MCP 工具走同一注册表/同一 schema/同一权限策略（对齐 [Codex](../research/codex.md)）。MCP 工具经 `registerTool` 扩展点接入（[Pi Agent](../research/pi.md) 把 MCP 列为可扩展能力），Core 不内置具体 MCP 连接。

---

## 3. 执行模型

执行管线在四项目中高度一致，可归纳为 5 阶段：

```
prepare → beforeToolCall(Hook / 权限) → execute → afterToolCall(Hook) → finalize
```

- **[OpenHarness](../research/openharness.md)**：权限检查 → PreToolUse Hook → 执行 → PostToolUse Hook → 结果。
- **[Pi Agent](../research/pi.md)**：`prepare → beforeToolCall → execute → afterToolCall → finalize`；`beforeToolCall` 可 `block`，`afterToolCall` 可覆盖 `content/details`、设 `isError`、发 `terminate`。
- **同轮并行**：多个 `tool_use` 默认并行（[OpenHarness](../research/openharness.md)、[Pi Agent](../research/pi.md) 默认并行、可 `sequential` 覆盖）。

**设计建议**：`packages/core` 内置该 5 阶段管线；`beforeToolCall` 与 `afterToolCall` 是 Hook 拦截点（见 [runtime-design.md](runtime-design.md)）。并行在单轮内 fan-out，结果按 `call_id` 关联回流（对齐 [Codex](../research/codex.md) rollout 的扁平 `call_id` 关联）。

---

## 4. 错误处理 / 重试 / 超时

- **入口校验失败**：参数非法 → 校验错误回喂模型让其重试（[Pi Agent](../research/pi.md) AJV）。
- **工具失败**：错误信息回灌模型，模型诊断重试（[Codex](../research/codex.md)）；结果应"能指导下一步"而非仅返回失败（[Claude Code](../research/claude-code.md) 好工具标准：名称具体、参数明确、返回只含支持下一步判断的信息、标明风险）。
- **API/工具 API 失败**：指数退避重试（[OpenHarness](../research/openharness.md)；[Claude Code](../research/claude-code.md) 每轮最多 3 次）。
- **超时**：`maxSteps` + 超时控制（[OpenHarness](../research/openharness.md)）。

**设计建议**：重试/退避/并行/计数/压缩均为**循环级横切能力**（见 [runtime-design.md](runtime-design.md)），工具本身无感知。`packages/core` 内置：① API 指数退避；② 同轮并行 + 串行覆盖；③ `maxSteps` 与超时；④ 工具输出截断（默认 `bytes(10_000)`，对齐 [Codex](../research/codex.md)）。

---

## 5. Permission 门控

**门禁位于派发前（Pre-execution）**，横切拦截而非工具内硬编码。

- **默认拒绝立场**：[Claude Code](../research/claude-code.md) deny-first，评估顺序 **deny > ask > allow**，deny 永远优先；七种模式 plan/default/acceptEdits/auto/dontAsk/bypassPermissions/bubble。
- **三态/四态审批**：[Codex](../research/codex.md) untrusted/auto-edit/never；[OpenHarness](../research/openharness.md) Default/Auto/Plan/Strict。
- **权限不跨会话继承**：resume 需重新批准（[Claude Code](../research/claude-code.md)）。
- **Hook 比规则更可靠**：`PreToolUse` 可返回 `deny` 阻断（[Claude Code](../research/claude-code.md)）；`bash(curl *)` 拦不住 `bash(cat .env)`，需配合沙箱或 Hook（[Claude Code](../research/claude-code.md) 真实权衡）。

**设计建议（权限策略）**：`packages/core` 暴露 `PermissionPolicy` 接口，内置四模式 default/plan/auto/strict + 路径/命令规则（deny > ask > allow），但把"交互式审批"与"拒绝列表"实现为可替换策略：

```typescript
interface PermissionPolicy {
  evaluate(call: ToolCall, ctx: Session): Decision; // allow | deny | ask
}
// ask 由 Application 层的交互式审批 UI 承接；Core 只发 decision 事件
```

环境操作（如 SiteAgent 导航/点击）同样走此门禁（[Claude Code](../research/claude-code.md) 对环境操作同门禁），且**权限不跨会话继承**。

---

## 6. Result 处理与回流

- **统一回流形态**：工具结果作为纯文本 `tool_result` 追加进对话历史，下一轮模型全部可见（[Claude Code](../research/claude-code.md)、[Codex](../research/codex.md)）。
- **结构化结果**：`stdout/stderr/文件内容/diff` 结构化输出；`isError` 标志、`details` 供 UI 展示（[Pi Agent](../research/pi.md)）。
- **Surgical 写回**：[Codex](../research/codex.md) 用 `apply_patch` 约束模型产出最小 diff，而非自由输出全文；DOM Grounding 是浏览器版 observation 回流（[Codex](../research/codex.md) 讨论）。

**设计建议**：`packages/core` 的 `ToolResult` 统一为 `{ content, isError?, details?, call_id }`；结果经 `tool.result` 事件回流（见 [runtime-design.md](runtime-design.md) 事件流），并 append 回 messages。若需"写回环境"，提供受控 write-back 信封（类 `apply_patch`），避免模型自由输出全文（[Codex](../research/codex.md) 建议）。

---

## 7. `packages/core` Tool 子系统设计总结

| 维度 | Core 内置 | Plugin/Application 外置 |
|------|-----------|------------------------|
| Schema 契约 | ✅ ToolDefinition/AgentTool 双层 + 入口校验 | ❌ 具体类型定义 |
| Registry/Router | ✅ 统一注册/路由 | ❌ MCP server 连接 |
| 执行管线 | ✅ 5 阶段 + 并行 + 重试/超时 | ❌ 沙箱具体实现 |
| 权限 | ✅ deny-first 门禁 + 四模式 + 路径规则 | ❌ 交互式审批 UI |
| Result 回流 | ✅ 统一 ToolResult + 事件 | ❌ UI 展示细节 |

**一句话**：Tool 是 Agent 的"动作面"，`packages/core` 用"定义/实现双层 + 统一注册路由 + 5 阶段管线 + deny-first 门禁 + 文本结果回流"把它做成即插即用的安全原语；具体工具与 MCP 连接外置，安全默认保守且横切拦截。

---

## 参考来源

- [Claude Code 架构研究](../research/claude-code.md)
- [OpenAI Codex 架构研究](../research/codex.md)
- [Pi Agent 架构研究](../research/pi.md)
- [OpenHarness 架构研究](../research/openharness.md)
