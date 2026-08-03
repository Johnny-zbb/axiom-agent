---
title: 真实 Coding Agent 验证记录
sidebar_position: 2
---

# 真实 Coding Agent 验证记录

日期：2026-08-02

这次验证用于回答一个问题：当前实现能否让真实模型完成文件检查、代码修改、测试执行、状态持久化和生命周期记录，而不依赖脚本预设模型行为。

## 配置

- Provider：Token Rhythm OpenAI-compatible Chat Completions
- 模型：`deepseek-v4-flash`
- Core：`AgentHarness`，最大 20 turns
- Session：`JsonlSessionStore`
- Trace：`JsonlRunTrace`
- Tools：`read_file`、`write_file`、`search`、`run_command`
- Workspace：从只包含 `math.mjs` 与 `math.test.mjs` 的夹具复制出的忽略临时目录
- Trace run ID：`4abbfa00-cefa-4373-aa73-86331e6db5d2`

API Key 仅作为进程环境变量使用，没有写入 workspace、Session 或 Trace。

## 初始失败

初始实现：

```js
export function sum(values) {
  throw new Error("Not implemented");
}
```

独立执行 `node --test math.test.mjs`：2 个测试、0 pass、2 fail。

## 模型实际执行

模型在 5 turns 中完成：

1. 使用 `run_command` 查看 workspace 文件。
2. 使用两个 `read_file` 调用读取实现与测试。
3. 使用 `write_file` 只修改 `math.mjs`。
4. 使用 `run_command` 执行 `node --test math.test.mjs`。
5. 根据通过的 Observation 输出最终总结。

最终改动：

```diff
 export function sum(values) {
-  throw new Error("Not implemented");
+  return values.reduce((total, value) => total + value, 0);
 }
```

模型观察到的测试结果：2 tests、2 pass、0 fail。

## 独立验收

模型结束后由外部检查重新验证，而不是相信模型总结：

| 检查 | 结果 |
|---|---|
| 独立重新运行测试 | 2/2 pass，exit code 0 |
| 原始测试文件与证明目录测试文件 SHA-256 | 相同 |
| 仓库原始夹具 | 未修改 |
| Session 新实例恢复 | 11 messages，包含最终总结 |
| Session tool calls | `run_command, read_file, read_file, write_file, run_command` |
| Trace | 117 records，`run_start` 至 `run_end` |
| Trace tool lifecycle | 5 starts / 5 ends |
| Trace sequence | 从 0 开始连续 |
| Trace 中的测试 Observation | 包含 2 pass |
| 证明目录 secret 扫描 | 0 matches |

## 结论与边界

该验证证明 v0.1 不是 calculator-only Demo：真实模型能够通过同一 Core Loop 操作真实文件、消费测试反馈、完成任务，并留下可恢复 transcript 与可检查 trace。

它不是 benchmark，也不证明复杂仓库任务成功率。下一阶段应建立固定 Coding Task 集合，而不是据此增加 Memory、MCP 或多 Agent 抽象。
