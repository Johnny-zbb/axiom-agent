import assert from "node:assert/strict";
import test from "node:test";
import { sum } from "./math.mjs";

test("sums numbers", () => assert.equal(sum([2, 3, 5]), 10));
test("returns zero for an empty list", () => assert.equal(sum([]), 0));
