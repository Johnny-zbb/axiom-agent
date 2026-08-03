import assert from "node:assert/strict";
import test from "node:test";
import { clamp } from "./clamp.mjs";

test("keeps an in-range value", () => assert.equal(clamp(5, 0, 10), 5));
test("uses the lower boundary", () => assert.equal(clamp(-1, 0, 10), 0));
test("uses the upper boundary", () => assert.equal(clamp(11, 0, 10), 10));
