import assert from "node:assert/strict";
import test from "node:test";
import {
  GuestRequestTooLargeError,
  isValidGuestBrowserTokens,
  isValidGuestSessionId,
  hideGuestUsage,
  readGuestJson,
  sanitizeGuestAssignment,
  sanitizeGuestConfig,
  validateGuestMessages,
} from "../src/lib/guest-session.ts";

test("accepts valid guest browser token totals", () => {
  assert.equal(
    isValidGuestBrowserTokens({ input: 12, output: 8, total: 20 }),
    true
  );
});

test("rejects missing and malformed guest browser token totals", () => {
  for (const value of [null, [], {}, { input: 1, output: 2 }]) {
    assert.equal(isValidGuestBrowserTokens(value), false);
  }
});

test("rejects negative and non-integer guest browser token totals", () => {
  for (const invalidTotal of [-1, 1.5, NaN, Infinity]) {
    assert.equal(
      isValidGuestBrowserTokens({
        input: invalidTotal,
        output: 0,
        total: 0,
      }),
      false
    );
  }
});

test("enforces the guest browser token maximum", () => {
  assert.equal(
    isValidGuestBrowserTokens({
      input: 10_000_001,
      output: 0,
      total: 0,
    }),
    false
  );
  assert.equal(
    isValidGuestBrowserTokens({
      input: 10_000_000,
      output: 10_000_000,
      total: 10_000_000,
    }),
    true
  );
});

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

test("enforces the hosted guest model name length limit", () => {
  const assignment = {
    connectionType: "API",
    provider: "openai",
    apiKey: "test-key",
  };
  assert.equal(
    sanitizeGuestAssignment({
      ...assignment,
      modelName: "m".repeat(200),
    }).modelName.length,
    200
  );
  assert.throws(
    () =>
      sanitizeGuestAssignment({
        ...assignment,
        modelName: "m".repeat(201),
      }),
    /Choose a valid model/
  );
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

test("rejects unsafe and oversized guest Ollama endpoints", () => {
  for (const localEndpoint of [
    "ftp://localhost:11434",
    `http://localhost/${"x".repeat(500)}`,
  ]) {
    assert.throws(
      () =>
        sanitizeGuestAssignment({
          connectionType: "LOCAL",
          provider: "ollama",
          modelName: "llama3",
          localEndpoint,
        }),
      /local Ollama endpoint/
    );
  }
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

test("accepts valid user image data URLs and rejects malformed images", () => {
  assert.equal(
    validateGuestMessages([
      {
        role: "user",
        content: "describe this",
        image: {
          data: "data:image/png;base64,aGVsbG8=",
          mimeType: "image/png",
        },
      },
    ]),
    true
  );
  assert.equal(
    validateGuestMessages([
      {
        role: "user",
        content: "",
        image: { data: "data:image/png;base64,###", mimeType: "image/png" },
      },
    ]),
    false
  );
  assert.equal(
    validateGuestMessages([
      {
        role: "assistant",
        content: "image",
        image: {
          data: "data:image/png;base64,aGVsbG8=",
          mimeType: "image/png",
        },
      },
    ]),
    false
  );
});

test("redacts guest usage metrics and secrets recursively", () => {
  const result = hideGuestUsage({
    finalReply: "response",
    steps: [
      {
        model: "model",
        tokens: { input: 10, output: 5, total: 15 },
        cost: { total: 0.01 },
        latencyMs: 200,
        nested: { apiKey: "secret", retries: 1 },
      },
    ],
  });
  assert.deepEqual(result, {
    finalReply: "response",
    steps: [{ model: "model", nested: {} }],
  });
});

test("parses guest JSON objects and rejects non-object bodies", async () => {
  const parsed = await readGuestJson(
    new Request("http://localhost/api/guest", {
      method: "POST",
      body: JSON.stringify({ guestSessionId: "test" }),
    }),
    100
  );
  assert.deepEqual(parsed, { guestSessionId: "test" });

  await assert.rejects(
    readGuestJson(
      new Request("http://localhost/api/guest", {
        method: "POST",
        body: JSON.stringify(["not", "an", "object"]),
      }),
      100
    ),
    /must be a JSON object/
  );
});

test("rejects guest request bodies that exceed the configured byte limit", async () => {
  await assert.rejects(
    readGuestJson(
      new Request("http://localhost/api/guest", {
        method: "POST",
        body: JSON.stringify({ message: "x".repeat(200) }),
      }),
      100
    ),
    GuestRequestTooLargeError
  );
});

test("rejects guest requests without a body", async () => {
  await assert.rejects(
    readGuestJson(new Request("http://localhost/api/guest"), 100),
    /body is required/
  );
});

test("rejects malformed guest JSON bodies", async () => {
  await assert.rejects(
    readGuestJson(
      new Request("http://localhost/api/guest", {
        method: "POST",
        body: "{invalid",
      }),
      100
    ),
    SyntaxError
  );
});

test("accepts guest JSON bodies exactly at the byte limit", async () => {
  const body = JSON.stringify({ message: "valid" });
  const maxBytes = new TextEncoder().encode(body).byteLength;
  const parsed = await readGuestJson(
    new Request("http://localhost/api/guest", {
      method: "POST",
      body,
    }),
    maxBytes
  );
  assert.deepEqual(parsed, { message: "valid" });
});

test("rejects primitive guest JSON values", async () => {
  for (const body of ["null", '"text"', "42", "true"]) {
    await assert.rejects(
      readGuestJson(
        new Request("http://localhost/api/guest", {
          method: "POST",
          body,
        }),
        100
      ),
      /must be a JSON object/
    );
  }
});
