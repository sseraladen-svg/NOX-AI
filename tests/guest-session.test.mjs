import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidGuestSessionId,
  sanitizeGuestAssignment,
} from "../src/lib/guest-session.ts";

test("accepts a canonical guest session UUID", () => {
  assert.equal(isValidGuestSessionId("123e4567-e89b-42d3-a456-426614174000"), true);
});

test("rejects malformed guest session identifiers", () => {
  assert.equal(isValidGuestSessionId("not-a-uuid"), false);
  assert.equal(isValidGuestSessionId("123e4567-e89b-42d3-a456-42661417400z"), false);
  assert.equal(isValidGuestSessionId(null), false);
});

test("normalizes allowed hosted provider assignments", () => {
  assert.deepEqual(
    sanitizeGuestAssignment({
      connectionType: "API",
      provider: "OpenAI",
      modelName: "  gpt-4o-mini ",
      apiKey: " test-key ",
      status: "ready",
    }),
    {
      connectionType: "API",
      provider: "openai",
      modelName: "gpt-4o-mini",
      apiKey: "test-key",
    }
  );
});

test("rejects hosted providers that are not enabled for guests", () => {
  assert.throws(
    () =>
      sanitizeGuestAssignment({
        connectionType: "API",
        provider: "unknown-provider",
        modelName: "model",
        apiKey: "test-key",
      }),
    /not available in guest mode/
  );
});

test("requires a non-empty API key for hosted guest assignments", () => {
  for (const apiKey of [undefined, "", "   "]) {
    assert.throws(
      () =>
        sanitizeGuestAssignment({
          connectionType: "API",
          provider: "openai",
          modelName: "model",
          apiKey,
        }),
      /Enter an API key/
    );
  }
});

test("rejects custom endpoints for hosted guest providers", () => {
  for (const endpointField of ["apiEndpoint", "endpoint"]) {
    assert.throws(
      () =>
        sanitizeGuestAssignment({
          connectionType: "API",
          provider: "openai",
          modelName: "model",
          apiKey: "test-key",
          [endpointField]: "https://example.test/v1",
        }),
      /Custom API endpoints require an account/
    );
  }
});
