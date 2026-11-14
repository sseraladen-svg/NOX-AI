import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeEndpoint } from "../src/lib/endpoint-guard.ts";

test("allows public https endpoints", () => {
  assert.equal(assertSafeEndpoint("https://api.openai.com/v1", true, "production"), "https://api.openai.com/v1");
});

test("blocks cloud metadata hosts regardless of type", () => {
  assert.throws(() => assertSafeEndpoint("http://169.254.169.254/latest", false, "development"));
  assert.throws(() => assertSafeEndpoint("http://metadata.google.internal/", true, "production"));
});

test("blocks private and loopback hosts for API endpoints in production", () => {
  for (const u of ["http://127.0.0.1:11434", "http://localhost:8080", "http://10.0.0.5", "http://192.168.1.2", "http://172.20.0.1", "http://[::1]:11434"]) {
    assert.throws(() => assertSafeEndpoint(u, true, "production"), u);
  }
});

test("allows loopback for LOCAL endpoints and in development", () => {
  assert.equal(assertSafeEndpoint("http://127.0.0.1:11434", false, "production"), "http://127.0.0.1:11434");
  assert.equal(assertSafeEndpoint("http://localhost:11434", true, "development"), "http://localhost:11434");
});

test("rejects bad protocols, credentials and invalid URLs", () => {
  assert.throws(() => assertSafeEndpoint("file:///etc/passwd", false));
  assert.throws(() => assertSafeEndpoint("ftp://example.com", false));
  assert.throws(() => assertSafeEndpoint("https://user:pw@example.com", false));
  assert.throws(() => assertSafeEndpoint("not a url", false));
});
