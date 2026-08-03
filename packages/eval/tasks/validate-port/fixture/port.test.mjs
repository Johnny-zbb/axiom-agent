import assert from "node:assert/strict";
import test from "node:test";
import { parsePort } from "./port.mjs";

test("parses a valid port", () => assert.equal(parsePort("3000"), 3000));
for (const invalid of ["0", "65536", "3.5", "abc", ""]) {
  test(`rejects ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => parsePort(invalid), RangeError);
  });
}
