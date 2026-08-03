import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WorkspaceBoundaryError,
  createCodingAgent,
  createCodingTools,
} from "../dist/index.js";
import { AgentHarness } from "../../core/dist/index.js";

async function withWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(), "axiom-agent-coding-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "math.mjs"), "export const add = (a, b) => a + b;\n", "utf8");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function byName(tools, name) {
  const tool = tools.find((candidate) => candidate.definition.name === name);
  assert.ok(tool, `missing tool: ${name}`);
  return tool;
}

const context = { sessionId: "coding-test" };

test("reads line-numbered files and writes existing workspace directories", async () => {
  await withWorkspace(async (root) => {
    const tools = await createCodingTools({ workspace: root, allowedCommands: [] });
    const readTool = byName(tools, "read_file");
    const writeTool = byName(tools, "write_file");

    const before = await readTool.execute({ path: "src/math.mjs" }, context);
    assert.match(before.content, /1 \| export const add/);

    await writeTool.execute({ path: "src/new.mjs", content: "export const value = 42;\n" }, context);
    assert.equal(await readFile(join(root, "src", "new.mjs"), "utf8"), "export const value = 42;\n");
  });
});

test("rejects lexical path traversal", async () => {
  await withWorkspace(async (root) => {
    const tools = await createCodingTools({ workspace: root, allowedCommands: [] });
    await assert.rejects(
      byName(tools, "read_file").execute({ path: "../outside.txt" }, context),
      WorkspaceBoundaryError,
    );
    await assert.rejects(
      byName(tools, "write_file").execute({ path: "../outside.txt", content: "no" }, context),
      WorkspaceBoundaryError,
    );
  });
});

test("rejects writes through a symlinked directory", async (t) => {
  await withWorkspace(async (root) => {
    const outside = await mkdtemp(join(tmpdir(), "axiom-agent-outside-"));
    try {
      try {
        await symlink(outside, join(root, "escape"), "junction");
      } catch (error) {
        if (error?.code === "EPERM") {
          t.skip("symlink creation is not permitted on this system");
          return;
        }
        throw error;
      }
      const tools = await createCodingTools({ workspace: root, allowedCommands: [] });
      await assert.rejects(
        byName(tools, "write_file").execute({ path: "escape/pwned.txt", content: "no" }, context),
        WorkspaceBoundaryError,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("searches workspace text and reports no matches", async () => {
  await withWorkspace(async (root) => {
    const tools = await createCodingTools({ workspace: root, allowedCommands: [] });
    const search = byName(tools, "search");
    const found = await search.execute({ query: "export const add", path: "src" }, context);
    assert.match(found.content, /math\.mjs:1:1:export const add/);
    const missing = await search.execute({ query: "does-not-exist" }, context);
    assert.equal(missing.content, "No matches.");
  });
});

test("runs only allowlisted executables without a shell", async () => {
  await withWorkspace(async (root) => {
    const tools = await createCodingTools({ workspace: root, allowedCommands: [process.execPath] });
    const runCommand = byName(tools, "run_command");
    assert.deepEqual(runCommand.validate({ command: "not-allowed", args: [] }), {
      valid: false,
      error: "command is not allowed: not-allowed",
    });

    const result = await runCommand.execute({
      command: process.execPath,
      args: ["-e", "console.log(process.argv[1])", "hello && echo injected"],
    }, context);
    assert.match(result.content, /hello && echo injected/);
    assert.doesNotMatch(result.content, /\ninjected\n/);
  });
});

test("does not pass application secrets to command children", async () => {
  await withWorkspace(async (root) => {
    process.env.AXIOM_TEST_SECRET = "must-not-leak";
    try {
      const tools = await createCodingTools({ workspace: root, allowedCommands: [process.execPath] });
      const result = await byName(tools, "run_command").execute({
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.env.AXIOM_TEST_SECRET ?? 'missing')"],
      }, context);
      assert.match(result.content, /stdout:\nmissing/);
      assert.doesNotMatch(result.content, /must-not-leak/);
    } finally {
      delete process.env.AXIOM_TEST_SECRET;
    }
  });
});

test("returns non-zero command output as an observation", async () => {
  await withWorkspace(async (root) => {
    const tools = await createCodingTools({ workspace: root, allowedCommands: [process.execPath] });
    const result = await byName(tools, "run_command").execute({
      command: process.execPath,
      args: ["-e", "console.error('test failed'); process.exit(2)"],
    }, context);
    assert.match(result.content, /exitCode: 2/);
    assert.match(result.content, /stderr:\ntest failed/);
  });
});

test("creates a coding AgentDefinition without another runtime layer", async () => {
  await withWorkspace(async (root) => {
    const model = { id: "fake", async *stream() { yield { type: "done", stopReason: "stop" }; } };
    const agent = await createCodingAgent({
      workspace: root,
      allowedCommands: [],
      model,
    });
    assert.deepEqual(agent.tools.map((tool) => tool.definition.name), [
      "read_file",
      "write_file",
      "search",
      "run_command",
    ]);
    assert.match(agent.systemPrompt, /Run the relevant tests/);
  });
});

test("completes a read -> edit -> test coding loop through Core", async () => {
  await withWorkspace(async (root) => {
    await writeFile(join(root, "src", "math.mjs"), `export function add() {\n  throw new Error("TODO");\n}\n`, "utf8");
    await writeFile(join(root, "src", "math.test.mjs"), `
      import assert from "node:assert/strict";
      import test from "node:test";
      import { add } from "./math.mjs";
      test("adds", () => assert.equal(add(2, 3), 5));
    `, "utf8");

    let step = 0;
    const model = {
      id: "scripted-coding-model",
      async *stream() {
        step += 1;
        if (step === 1) {
          yield { type: "tool_call", call: { id: "read", name: "read_file", arguments: { path: "src/math.mjs" } } };
          yield { type: "done", stopReason: "tool_use" };
          return;
        }
        if (step === 2) {
          yield {
            type: "tool_call",
            call: {
              id: "write",
              name: "write_file",
              arguments: {
                path: "src/math.mjs",
                content: "export function add(left, right) {\n  return left + right;\n}\n",
              },
            },
          };
          yield { type: "done", stopReason: "tool_use" };
          return;
        }
        if (step === 3) {
          yield {
            type: "tool_call",
            call: {
              id: "test",
              name: "run_command",
              arguments: { command: process.execPath, args: ["--test", "src/math.test.mjs"] },
            },
          };
          yield { type: "done", stopReason: "tool_use" };
          return;
        }
        yield { type: "text_delta", delta: "Implemented add and tests pass." };
        yield { type: "done", stopReason: "stop" };
      },
    };
    const agent = await createCodingAgent({
      workspace: root,
      allowedCommands: [process.execPath],
      model,
    });
    const harness = new AgentHarness({ agent });
    const events = [];
    for await (const event of harness.run("Implement add and run tests.")) events.push(event);

    const commandResult = events.find(
      (event) => event.type === "tool_execution_end" && event.call.name === "run_command",
    );
    assert.match(commandResult.result.content, /exitCode: 0/);
    assert.match(await readFile(join(root, "src", "math.mjs"), "utf8"), /return left \+ right/);
    assert.equal(events.at(-1).finalMessage.content, "Implemented add and tests pass.");
  });
});
