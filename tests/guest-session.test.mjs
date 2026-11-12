import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidGuestSessionId,
} from "../src/lib/guest-session.ts";

test("accepts a canonical guest session UUID", () => {
  assert.equal(isValidGuestSessionId("123e4567-e89b-42d3-a456-426614174000"), true);
});

test("rejects malformed guest session identifiers", () => {
  assert.equal(isValidGuestSessionId("not-a-uuid"), false);
  assert.equal(isValidGuestSessionId("123e4567-e89b-42d3-a456-42661417400z"), false);
  assert.equal(isValidGuestSessionId(null), false);
});
