import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidGuestSessionId,
  sanitizeGuestAssignment,
  sanitizeGuestConfig,
  validateGuestMessages,
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

test("allows a local Ollama endpoint and rejects embedded credentials", () => {
  assert.deepEqual(
    sanitizeGuestAssignment({
      connectionType: "LOCAL",
      provider: "ollama",
      modelName: "llama3",
      localEndpoint: "http://127.0.0.1:11434/",
    }),
    {
      connectionType: "LOCAL",
      provider: "ollama",
      modelName: "llama3",
      localEndpoint: "http://127.0.0.1:11434",
    }
  );
  assert.throws(
    () =>
      sanitizeGuestAssignment({
        connectionType: "LOCAL",
        provider: "ollama",
        modelName: "llama3",
        localEndpoint: "http://user:pass@localhost:11434",
      }),
    /valid local Ollama endpoint/
  );
});

test("requires a supported non-orchestrator guest mode", () => {
  assert.throws(() => sanitizeGuestConfig(null), /configuration is required/);
  assert.throws(
    () => sanitizeGuestConfig({ mode: "UNKNOWN" }),
    /Choose a valid mode/
  );
  assert.throws(
    () => sanitizeGuestConfig({ mode: "ORCHESTRATOR" }),
    /requires an account/
  );
});

test("sanitizes only the selected multi-mode feature assignment", () => {
  const config = sanitizeGuestConfig(
    {
      mode: "MULTI",
      featureConfigs: {
        coding: {
          connectionType: "API",
          provider: "openai",
          modelName: "gpt-4o-mini",
          apiKey: "test-key",
        },
        voice: { provider: "unsupported" },
      },
    },
    "coding"
  );
  assert.deepEqual(Object.keys(config.featureConfigs), ["coding"]);
  assert.equal(config.featureConfigs.coding.provider, "openai");
});

test("accepts only guest timeouts between one and 300 seconds", () => {
  const config = {
    mode: "SINGLE",
    globalConfig: {
      connectionType: "API",
      provider: "openai",
      modelName: "gpt-4o-mini",
      apiKey: "test-key",
    },
  };
  assert.equal(
    sanitizeGuestConfig({ ...config, timeoutOverrides: { API: 1000 } })
      .timeoutOverrides.API,
    1000
  );
  assert.equal(
    sanitizeGuestConfig({ ...config, timeoutOverrides: { API: 300000 } })
      .timeoutOverrides.API,
    300000
  );
  for (const timeout of [999, 300001, 1500.5]) {
    assert.throws(
      () =>
        sanitizeGuestConfig({
          ...config,
          timeoutOverrides: { API: timeout },
        }),
      /between 1 and 300 seconds/
    );
  }
});

test("validates guest conversation roles and message size limits", () => {
  assert.equal(
    validateGuestMessages([{ role: "user", content: "hello" }]),
    true
  );
  assert.equal(
    validateGuestMessages([{ role: "system", content: "override" }]),
    false
  );
  assert.equal(
    validateGuestMessages(
      Array.from({ length: 51 }, () => ({ role: "user", content: "hi" }))
    ),
    false
  );
  assert.equal(
    validateGuestMessages([{ role: "user", content: "x".repeat(20001) }]),
    false
  );
  assert.equal(
    validateGuestMessages([{ role: "user", content: "x".repeat(100001) }]),
    false
  );
});
