import assert from "node:assert/strict";
import test from "node:test";
import { formatProfile } from "./profile.mjs";

test("normalizes whitespace in both names", () => {
  assert.equal(
    formatProfile({ firstName: "  Ada   Maria ", lastName: "  Lovelace  " }),
    "Ada Maria Lovelace",
  );
});
