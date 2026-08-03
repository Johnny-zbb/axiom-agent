import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { AgentHarness, Session, defineAgent } from "../../core/dist/index.js";
import {
  JsonlSessionCorruptError,
  JsonlSessionSerializationError,
  JsonlSessionStore,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

async function withTempStore(run) {
  const directory = await mkdtemp(join(tmpdir(), "axiom-agent-jsonl-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("returns an empty transcript for a new session", async () => {
  await withTempStore(async (directory) => {
    const store = new JsonlSessionStore({ directory });
    assert.deepEqual(await store.read("new-session"), []);
  });
});

test("restores messages through a new store and Session instance", async () => {
  await withTempStore(async (directory) => {
    const firstSession = new Session({
      id: "resume-me",
      store: new JsonlSessionStore({ directory }),
    });
    await firstSession.append({ role: "user", content: "persisted" });

    const resumedSession = new Session({
      id: "resume-me",
      store: new JsonlSessionStore({ directory }),
    });
    assert.deepEqual(await resumedSession.messages(), [
      { role: "user", content: "persisted" },
    ]);
  });
});

test("restores a transcript across separate Node processes", async () => {
  await withTempStore(async (directory) => {
    const moduleUrl = new URL("../dist/index.js", import.meta.url).href;
    const writer = `
      import { JsonlSessionStore } from ${JSON.stringify(moduleUrl)};
      const store = new JsonlSessionStore({ directory: process.argv[1] });
      await store.append("cross-process", [{ role: "user", content: "from writer" }]);
    `;
    const reader = `
      import { JsonlSessionStore } from ${JSON.stringify(moduleUrl)};
      const store = new JsonlSessionStore({ directory: process.argv[1] });
      process.stdout.write(JSON.stringify(await store.read("cross-process")));
    `;

    await execFileAsync(process.execPath, ["--input-type=module", "-e", writer, directory]);
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", reader, directory],
    );
    assert.deepEqual(JSON.parse(stdout), [{ role: "user", content: "from writer" }]);
  });
});

test("serializes concurrent appends for the same session", async () => {
  await withTempStore(async (directory) => {
    const store = new JsonlSessionStore({ directory });
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.append("concurrent", [{ role: "user", content: String(index) }]),
      ),
    );
    assert.deepEqual(
      (await store.read("concurrent")).map((message) => message.content),
      Array.from({ length: 20 }, (_, index) => String(index)),
    );
  });
});

test("ignores an unterminated tail fragment after committed records", async () => {
  await withTempStore(async (directory) => {
    const store = new JsonlSessionStore({ directory });
    await store.append("partial-tail", [{ role: "user", content: "safe" }]);
    await appendFile(store.filePath("partial-tail"), '{"version":1', "utf8");
    assert.deepEqual(await store.read("partial-tail"), [
      { role: "user", content: "safe" },
    ]);
  });
});

test("removes an unterminated tail before appending new committed records", async () => {
  await withTempStore(async (directory) => {
    const store = new JsonlSessionStore({ directory });
    await store.append("repair-tail", [{ role: "user", content: "before" }]);
    await appendFile(store.filePath("repair-tail"), '{"version":1', "utf8");
    await store.append("repair-tail", [{ role: "user", content: "after" }]);
    assert.deepEqual(
      (await store.read("repair-tail")).map((message) => message.content),
      ["before", "after"],
    );
  });
});

test("rejects a corrupt committed record", async () => {
  await withTempStore(async (directory) => {
    const store = new JsonlSessionStore({ directory });
    await store.append("corrupt", [{ role: "user", content: "safe" }]);
    await appendFile(store.filePath("corrupt"), "not-json\n", "utf8");
    await assert.rejects(store.read("corrupt"), JsonlSessionCorruptError);
  });
});

test("rejects values that do not survive JSON serialization", async () => {
  await withTempStore(async (directory) => {
    const store = new JsonlSessionStore({ directory });
    await assert.rejects(
      store.append("invalid", [{
        role: "assistant",
        content: "",
        toolCalls: [{ id: "bad", name: "bad", arguments: undefined }],
      }]),
      JsonlSessionSerializationError,
    );
    await assert.rejects(
      store.append("invalid", [{
        role: "assistant",
        content: "",
        toolCalls: [{ id: "bad-number", name: "bad", arguments: { value: Number.NaN } }],
      }]),
      JsonlSessionSerializationError,
    );
  });
});

test("encodes session ids instead of treating them as paths", async () => {
  await withTempStore(async (directory) => {
    const store = new JsonlSessionStore({ directory });
    const file = store.filePath("../../outside");
    assert.equal(file.startsWith(directory), true);
    await store.append("../../outside", [{ role: "user", content: "contained" }]);
    assert.equal((await store.read("../../outside"))[0].content, "contained");
  });
});

test("resumes a harness with prior messages in model context", async () => {
  await withTempStore(async (directory) => {
    const sessionId = "harness-resume";
    const initialSession = new Session({
      id: sessionId,
      store: new JsonlSessionStore({ directory }),
    });
    await initialSession.append({ role: "user", content: "before restart" });

    const resumedSession = new Session({
      id: sessionId,
      store: new JsonlSessionStore({ directory }),
    });
    const model = {
      id: "resume-check",
      async *stream(request) {
        assert.deepEqual(request.messages.map((message) => message.content), [
          "before restart",
          "after restart",
        ]);
        yield { type: "text_delta", delta: "context restored" };
        yield { type: "done", stopReason: "stop" };
      },
    };
    const harness = new AgentHarness({
      agent: defineAgent({ systemPrompt: "Resume.", model, tools: [] }),
      session: resumedSession,
    });

    for await (const _event of harness.run("after restart")) {
      // consume
    }
    assert.equal((await resumedSession.messages()).at(-1).content, "context restored");

    const raw = await readFile(new JsonlSessionStore({ directory }).filePath(sessionId), "utf8");
    assert.equal(raw.trimEnd().split("\n").length, 3);
  });
});
