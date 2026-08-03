import assert from "node:assert/strict";
import test from "node:test";

import { sum } from "./math.mjs";

test("sums positive and negative numbers", () => {
  assert.equal(sum([5, -2, 4]), 7);
});

test("returns zero for an empty array", () => {
  assert.equal(sum([]), 0);
});
