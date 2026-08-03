import assert from "node:assert/strict";
import test from "node:test";
import { retry } from "./retry.mjs";

test("can succeed on the final allowed attempt", async () => {
  let attempts = 0;
  const value = await retry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error(`failure ${attempts}`);
    return "ok";
  }, 3);
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
});

test("throws the final failure", async () => {
  let attempts = 0;
  await assert.rejects(
    retry(async () => { attempts += 1; throw new Error(`failure ${attempts}`); }, 2),
    /failure 2/,
  );
});
