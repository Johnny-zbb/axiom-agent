import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadEvalTask, runEvalTask } from "../dist/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const taskNames = [
  "implement-sum",
  "fix-clamp-boundaries",
  "validate-port",
  "repair-retry",
  "normalize-profile",
];

test("ships five valid, initially failing tasks", async () => {
  const output = await mkdtemp(join(tmpdir(), "axiom-agent-eval-fixtures-"));
  const noOpModel = {
    id: "no-op-baseline",
    async *stream() { yield { type: "done", stopReason: "stop" }; },
  };
  try {
    for (const taskName of taskNames) {
      const task = await loadEvalTask(join(packageRoot, "tasks", taskName));
      assert.equal(task.id, taskName);
      assert.equal(task.expectInitialFailure, true);
      assert.ok(task.immutablePaths.length > 0);
      const result = await runEvalTask({ task, model: noOpModel, artifactsDirectory: output });
      assert.notEqual(result.initialVerification.exitCode, 0, `${taskName} must initially fail`);
      assert.equal(result.status, "verifier_failed");
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("runs a coding task and records reproducible artifacts", async () => {
  const output = await mkdtemp(join(tmpdir(), "axiom-agent-eval-"));
  try {
    let step = 0;
    const model = {
      id: "scripted-eval-model",
      async *stream() {
        step += 1;
        if (step === 1) {
          yield {
            type: "tool_call",
            call: {
              id: "write",
              name: "write_file",
              arguments: {
                path: "math.mjs",
                content: "export function sum(values) {\n  return values.reduce((total, value) => total + value, 0);\n}\n",
              },
            },
          };
          yield { type: "done", stopReason: "tool_use" };
          return;
        }
        if (step === 2) {
          yield {
            type: "tool_call",
            call: {
              id: "test",
              name: "run_command",
              arguments: { command: process.execPath, args: ["--test", "math.test.mjs"] },
            },
          };
          yield { type: "done", stopReason: "tool_use" };
          return;
        }
        yield { type: "text_delta", delta: "Implemented sum and verified the tests." };
        yield { type: "done", stopReason: "stop" };
      },
    };
    const resultsFile = join(output, "results.jsonl");
    const result = await runEvalTask({
      task: await loadEvalTask(join(packageRoot, "tasks", "implement-sum")),
      model,
      artifactsDirectory: join(output, "runs"),
      resultsFile,
    });

    assert.equal(result.status, "passed");
    assert.equal(result.finalVerification.exitCode, 0);
    assert.equal(result.turns, 3);
    assert.equal(result.toolCalls, 2);
    assert.deepEqual(result.immutableChanges, []);
    assert.match(await readFile(resultsFile, "utf8"), /"status":"passed"/);
    assert.match(await readFile(join(result.artifactDirectory, "workspace", "math.mjs"), "utf8"), /reduce/);
    const [sessionFile] = await readdir(join(result.artifactDirectory, "sessions"));
    const [traceFile] = await readdir(join(result.artifactDirectory, "traces"));
    assert.match(await readFile(join(result.artifactDirectory, "sessions", sessionFile), "utf8"), /"role":"tool"/);
    assert.match(await readFile(join(result.artifactDirectory, "traces", traceFile), "utf8"), /"type":"run_end"/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("records a deleted immutable file as an immutable change", async () => {
  const output = await mkdtemp(join(tmpdir(), "axiom-agent-eval-immutable-"));
  try {
    let step = 0;
    const model = {
      id: "scripted-destructive-model",
      async *stream() {
        step += 1;
        if (step === 1) {
          yield {
            type: "tool_call",
            call: {
              id: "delete-test",
              name: "run_command",
              arguments: {
                command: process.execPath,
                args: ["-e", "require('node:fs').unlinkSync('math.test.mjs')"],
              },
            },
          };
          yield { type: "done", stopReason: "tool_use" };
          return;
        }
        yield { type: "text_delta", delta: "Done." };
        yield { type: "done", stopReason: "stop" };
      },
    };

    const result = await runEvalTask({
      task: await loadEvalTask(join(packageRoot, "tasks", "implement-sum")),
      model,
      artifactsDirectory: output,
    });

    assert.equal(result.status, "immutable_changed");
    assert.deepEqual(result.immutableChanges, ["math.test.mjs"]);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
