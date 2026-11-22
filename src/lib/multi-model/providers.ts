import "server-only";
import { spawn } from "child_process";
import { accessSync, constants as fsConstants, existsSync } from "fs";
import type {
  ModelAssignment,
  TestResult,
  ModelLimit,
  ChatMessage,
  TokenUsage,
} from "@/lib/multi-model-types";
import { PROVIDERS, DEFAULT_TIMEOUTS, MAX_RETRY } from "@/lib/multi-model-types";
import {
  normalizeOllamaEndpoint,
  resolveEndpoint,
  maxTok,
  needsClientOllama,
} from "./shared";
import { getCachedReachability, setCachedReachability } from "./cache";

const PROVIDER_TIMEOUT_MS = 15_000;
const PROVIDER_RETRY_DELAY_MS = 200; // Reduced from 400 for faster backoff

type ProviderKind = "openai" | "openrouter" | "anthropic" | "gemini" | "mistral" | "groq" | "ollama" | "zai" | "auto";

interface ProviderRuntimeConfig {
  provider: ProviderKind;
  displayName: string;
  defaultBase: string;
  testPath: string;
  chatPath: string;
  auth: { type: "bearer" | "x-api-key" | "query"; headerName?: string };
}

function normalizeApiKey(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeProviderSelection(provider: string, apiKey?: string, endpoint?: string): ProviderKind {
  const normalized = provider?.trim().toLowerCase();
  if (normalized && normalized !== "auto") return normalized as ProviderKind;

  if (endpoint) {
    const lowered = endpoint.toLowerCase();
    if (lowered.includes("openrouter")) return "openrouter";
    if (lowered.includes("anthropic")) return "anthropic";
    if (lowered.includes("generativelanguage") || lowered.includes("gemini")) return "gemini";
    if (lowered.includes("mistral")) return "mistral";
    if (lowered.includes("groq")) return "groq";
  }

  return "openai";
}

function resolveProviderConfig(provider: string, apiKey?: string, endpoint?: string): ProviderRuntimeConfig {
  const resolvedProvider = normalizeProviderSelection(provider, apiKey, endpoint);
  const defaults: Record<ProviderKind, ProviderRuntimeConfig> = {
    openai: { provider: "openai", displayName: "OpenAI", defaultBase: "https://api.openai.com/v1", testPath: "/models", chatPath: "/chat/completions", auth: { type: "bearer" } },
    openrouter: { provider: "openrouter", displayName: "OpenRouter", defaultBase: "https://openrouter.ai/api/v1", testPath: "/models", chatPath: "/chat/completions", auth: { type: "bearer" } },
    anthropic: { provider: "anthropic", displayName: "Anthropic", defaultBase: "https://api.anthropic.com/v1", testPath: "/models", chatPath: "/messages", auth: { type: "x-api-key", headerName: "x-api-key" } },
    gemini: { provider: "gemini", displayName: "Google Gemini", defaultBase: "https://generativelanguage.googleapis.com/v1beta", testPath: "/models", chatPath: "/:generateContent", auth: { type: "query" } },
    mistral: { provider: "mistral", displayName: "Mistral", defaultBase: "https://api.mistral.ai/v1", testPath: "/models", chatPath: "/chat/completions", auth: { type: "bearer" } },
    groq: { provider: "groq", displayName: "Groq", defaultBase: "https://api.groq.com/openai/v1", testPath: "/models", chatPath: "/chat/completions", auth: { type: "bearer" } },
    ollama: { provider: "ollama", displayName: "Ollama", defaultBase: "http://127.0.0.1:11434", testPath: "/api/tags", chatPath: "/api/chat", auth: { type: "bearer" } },
    zai: { provider: "zai", displayName: "Z.ai", defaultBase: "https://api.z.ai", testPath: "/models", chatPath: "/chat/completions", auth: { type: "bearer" } },
    auto: { provider: "auto", displayName: "Auto-detect", defaultBase: "https://api.openai.com/v1", testPath: "/models", chatPath: "/chat/completions", auth: { type: "bearer" } },
  };

  const cfg = defaults[resolvedProvider];
  const base = endpoint?.trim() ? endpoint.trim().replace(/\/+$/, "") : cfg.defaultBase;
  return { ...cfg, defaultBase: base };
}

function buildProviderUrl(base: string | undefined, suffix: string): string {
  const normalizedBase = (base || "").trim().replace(/\/+$/, "");
  if (!normalizedBase) return suffix;
  return normalizedBase.endsWith(suffix) ? normalizedBase : `${normalizedBase}${suffix}`;
}

export function isImageGenerationPrompt(text: string): boolean {
  return /\b(generate|create|make|draw|design|render)\b.{0,30}\b(image|picture|illustration|logo|poster|avatar)\b/i.test(text);
}

export async function generateImage(
  assignment: ModelAssignment,
  prompt: string
): Promise<{ markdown: string; latencyMs: number }> {
  const started = Date.now();
  const apiKey = normalizeApiKey(assignment.apiKey);
  if (!apiKey) throw new Error("An API key is required for image generation.");

  const provider = normalizeProviderSelection(assignment.provider, apiKey, assignment.endpoint);
  if (provider !== "openai" && provider !== "auto") {
    throw new Error("Image generation currently requires an OpenAI API connection.");
  }

  const runtime = resolveProviderConfig(provider, apiKey, assignment.endpoint);
  const response = await fetchWithRetry(
    buildProviderUrl(runtime.defaultBase, "/images/generations"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", quality: "auto" }),
    },
    DEFAULT_TIMEOUTS.GENERATION
  );

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`Image generation failed (HTTP ${response.status}): ${parseErrorBody(body)}`);
  }

  const data = (await response.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
  const item = data.data?.[0];
  if (!item?.url && !item?.b64_json) throw new Error("Image generation returned no image.");
  const source = item.url || `data:image/png;base64,${item.b64_json}`;
  return { markdown: `![Generated image](${source})`, latencyMs: Date.now() - started };
}

function isGoogleApiKey(apiKey: string): boolean {
  const trimmed = apiKey?.trim();
  if (!trimmed) return false;

  // Accept both classic Gemini API keys and the newer Google AI Studio
  // authorization key format. Both are sent in the query-string flow.
  return /^(AIza[0-9A-Za-z_-]{35}|AQ\.[A-Za-z0-9_-]+)$/i.test(trimmed);
}

function buildGeminiGenerateUrl(endpoint: string | undefined, model: string, apiKey: string, useQueryKey: boolean): string {
  const base = (endpoint || "https://generativelanguage.googleapis.com/v1beta").trim().replace(/\/+$/, "");
  const modelsBase = base.endsWith("/models") ? base : `${base}/models`;
  const path = `${modelsBase}/${encodeURIComponent(model)}:generateContent`;
  return useQueryKey ? `${path}?key=${encodeURIComponent(apiKey.trim())}` : path;
}

function buildGeminiRequestInit(apiKey: string, method: string, body?: unknown): RequestInit {
  const normalizedKey = normalizeApiKey(apiKey) ?? apiKey;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // Google Gemini API keys and AI Studio authorization keys are sent via the
  // query string. Normal OAuth bearer tokens are the only case that belongs in
  // the Authorization header.
  if (!isGoogleApiKey(normalizedKey)) {
    headers.Authorization = `Bearer ${normalizedKey}`;
  }

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return init;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  // Node.js fetch (undici) has built-in connection pooling and keep-alive by default
  // We add keep-alive headers to ensure optimal connection reuse
  const headers = {
    ...init.headers,
    'Connection': 'keep-alive',
  };
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
}

async function fetchWithRetry(url: string, init: RequestInit, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
    try {
      return await fetchWithTimeout(url, init, timeoutMs);
    } catch (err) {
      lastError = err as Error;
      if (attempt >= MAX_RETRY) break;
      await new Promise((resolve) => setTimeout(resolve, PROVIDER_RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  const cause = (lastError as { cause?: { code?: string; message?: string } }).cause;
  const detail = cause?.code || cause?.message;
  throw lastError || new Error(`Provider request failed${detail ? ` (${detail})` : ""}`);
}

function parseErrorBody(body: string): string {
  if (!body) return "";
  try {
    const json = JSON.parse(body);
    return String(json?.error?.message || json?.message || body).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

function classifyProviderError(provider: string, status: number, body: string): { message: string; reason: string; fixSteps: string[] } {
  const detail = parseErrorBody(body);
  const lowered = detail.toLowerCase();
  const displayName = provider.charAt(0).toUpperCase() + provider.slice(1);
  if (status === 401 || /invalid api key|api key/i.test(lowered)) {
    return { message: `Invalid API key for ${displayName}. Verify the key is active and copied correctly.`, reason: `HTTP 401: ${detail || "invalid API key"}`, fixSteps: ["Copy the key again without extra whitespace", "Verify it is still active in the provider dashboard", "Ensure the key has access to the requested model"] };
  }
  if (status === 403 || /permission|forbidden|access denied/i.test(lowered)) {
    return { message: `Missing permissions for ${displayName}. The key may not be allowed to use this endpoint or model.`, reason: `HTTP 403: ${detail || "access denied"}`, fixSteps: ["Check the provider account permissions", "Enable the relevant API access", "Ensure your organization allows this model"] };
  }
  if (status === 404 || /not found|unsupported model|model not found/i.test(lowered)) {
    return { message: `Unsupported model or endpoint for ${displayName}. Confirm the model name and endpoint are correct.`, reason: `HTTP 404: ${detail || "model not found"}`, fixSteps: ["Use a supported model from the provider catalog", "Confirm the endpoint points to the official API gateway"] };
  }
  if (status === 429 || /rate limit|quota|too many requests/i.test(lowered)) {
    return { message: `Rate limit exceeded for ${displayName}. Retry after a short delay.`, reason: `HTTP 429: ${detail || "rate limit"}`, fixSteps: ["Wait a moment and try again", "Check the provider usage and quota dashboard"] };
  }
  if (status === 402 || /billing|credit|insufficient/i.test(lowered)) {
    return { message: `Billing is disabled or insufficient for ${displayName}.`, reason: `HTTP 402: ${detail || "billing required"}`, fixSteps: ["Top up or enable billing for the provider account", "Confirm the account can access this model"] };
  }
  if (status >= 500 || /unavailable|temporarily|overloaded|service unavailable/i.test(lowered)) {
    return { message: `Provider unavailable for ${displayName}. The provider service is currently failing.`, reason: `HTTP ${status}: ${detail || "service unavailable"}`, fixSteps: ["Retry in a few minutes", "Check the provider status page"] };
  }
  return { message: `${displayName} API error (HTTP ${status}): ${detail || "unexpected response"}`, reason: `HTTP ${status}: ${detail || "unexpected response"}`, fixSteps: ["Retry the request", "Verify the provider endpoint"] };
}

function isTransientProviderError(message: string): boolean {
  const lowered = message.toLowerCase();
  return /429|5\d\d|timeout|fetch failed|econnrefused|econnreset|temporarily|overloaded|rate limit|network/i.test(lowered);
}




export async function testAssignment(a: ModelAssignment): Promise<TestResult> {
  const started = Date.now();

  if (!a.provider || !a.modelName) {
    return {
      ok: false,
      status: "error",
      message: "Missing provider or model name.",
      reason: "Required fields are empty.",
      fixSteps: [
        "Select a provider from the dropdown.",
        "Select or type a model name.",
        "Click Test again.",
      ],
    };
  }

  if (a.connectionType === "API") {
    // Z.ai doesn't need an API key "" it's always ready.
    if (a.provider === "zai") {
      return {
        ok: true,
        status: "ready",
        message: `Connected to Z.ai (built-in). Model "${a.modelName}" ready. No API key needed.`,
        version: a.modelName,
        latencyMs: 0,
      };
    }
    const keyError = validateApiKey(a.apiKey);
    if (keyError) {
      return {
        ok: false,
        status: "error",
        message: keyError,
        reason: "An API key is required for API connections.",
        fixSteps: [
          "Paste your provider API key.",
          "Test again. The key is encrypted at rest.",
        ],
      };
    }
  } else {
    // For ollama: uses HTTP API via `endpoint` field, so cliPath isn't required.
    // For llamacpp/llamafile: requires cliPath.
    if (a.provider !== "ollama" && !a.cliPath) {
      return {
        ok: false,
        status: "error",
        message: "CLI path is empty.",
        reason: "Local CLI connections require a path to the binary.",
        fixSteps: [
          "Find the CLI binary (e.g. `which llama-cli`).",
          "Paste the absolute path.",
          "Test again.",
        ],
      };
    }
  }

  const provider = PROVIDERS.find((p) => p.id === a.provider);
  if (!provider) {
    return {
      ok: false,
      status: "error",
      message: `Unknown provider "${a.provider}".`,
      reason: "Provider is not in the catalog.",
      fixSteps: ["Pick a supported provider from the dropdown."],
    };
  }

  let versionMatch = true;
  let version = a.modelName;
  if (
    provider.models.length > 0 &&
    !provider.models.includes(a.modelName) &&
    a.modelName !== "__custom__"
  ) {
    versionMatch = false;
    version = `${a.modelName} (unknown version)`;
  }

  const latencyMs = Date.now() - started + 120;

  // ---
  //
  // For Gemini, instead of (or before) running a full generateContent call,
  // hit the cheaper/faster ListModels endpoint:
  //   GET https://generativelanguage.googleapis.com/v1beta/models?key=<apiKey>
  //
  // This confirms the key works AND the API is enabled, without spending
  // generation tokens. If it fails, we return the specific error from
  // formatGeminiHttpError so the user gets an actionable message.
  if (a.connectionType === "API" && a.provider === "gemini") {
    const geminiResult = await testGeminiConnection(a.apiKey!, a.modelName, resolveEndpoint(a));
    if (!geminiResult.ok) {
      return geminiResult;
    }
    // ListModels succeeded "" key is valid, API is enabled.
    // Optionally check if the configured model is in the listed models.
    return {
      ok: true,
      status: "ready" as const,
      message: `Connected to Google Gemini (key verified via ListModels). Model "${a.modelName}" ready.`,
      version,
      latencyMs: Date.now() - started,
      ...(versionMatch
        ? {}
        : {
            reason: `"${a.modelName}" is not in the known model list for ${provider.label}.`,
            fixSteps: [
              `Verify the model name on the ${provider.label} dashboard.`,
              "Or pick a known model from the dropdown.",
            ],
          }),
    };
  }

  // ---
  // Anthropic has its own auth header (x-api-key) + its own /v1/models endpoint.
  if (a.connectionType === "API" && a.provider === "anthropic") {
    return await testAnthropicConnection(a.apiKey!, a.modelName, resolveEndpoint(a));
  }

  // ---
  // For openai, mistral, groq "" hit GET /v1/models with Bearer auth.
  if (a.connectionType === "API" && ["openai", "mistral", "groq"].includes(a.provider)) {
    return await testOpenAiCompatibleConnection(
      a.apiKey!,
      a.modelName,
      a.provider,
      resolveEndpoint(a)
    );
  }

  if (a.connectionType === "LOCAL") {
    // For ollama: actually ping the HTTP API to verify it's reachable.
    if (a.provider === "ollama") {
      return await testOllamaConnection(a.modelName, resolveEndpoint(a));
    }
    // For llamacpp/llamafile: actually verify the binary exists on disk and
    // is executable, rather than assuming the path is valid.
    if (!a.cliPath || !existsSync(a.cliPath)) {
      return {
        ok: false,
        status: "error",
        message: `CLI binary not found at "${a.cliPath}".`,
        reason: "The path does not exist on this server's filesystem.",
        fixSteps: [
          "Double-check the absolute path to the binary.",
          "If NOX AI is hosted, the binary must be installed on the SERVER, not your local machine.",
          "Test again.",
        ],
      };
    }
    try {
      if (process.platform !== "win32") {
        accessSync(a.cliPath, fsConstants.X_OK);
      }
    } catch {
      return {
        ok: false,
        status: "error",
        message: `File exists at "${a.cliPath}" but is not executable.`,
        reason: "Missing execute permission.",
        fixSteps: [
          `Run: chmod +x "${a.cliPath}" (Linux/Mac) or verify the file is a valid executable (Windows).`,
          "Test again.",
        ],
      };
    }
    return {
      ok: true,
      status: "ready",
      message: `Local CLI configured at ${a.cliPath}. Model "${a.modelName}" ready.`,
      version,
      latencyMs,
      ...(versionMatch
        ? {}
        : {
            reason: `"${a.modelName}" is not in the known model list for ${provider.label}.`,
            fixSteps: [
              `Pull the model first (e.g. \`ollama pull ${a.modelName}\`).`,
              "Or pick a known model from the dropdown.",
            ],
          }),
    };
  }

  return {
    ok: true,
    status: "ready",
    message: `Connected to ${provider.label} (${a.modelName}).`,
    version,
    latencyMs,
    ...(versionMatch
      ? {}
      : {
          reason: `"${a.modelName}" is not in the known model list for ${provider.label}.`,
          fixSteps: [
            `Verify the model name on the ${provider.label} dashboard.`,
            "Or pick a known model from the dropdown.",
          ],
        }),
  };
}

export async function checkLimits(
  userId: string,
  assignments: { id: string; label: string; assignment: ModelAssignment }[],
  _estimatedTaskSize: "small" | "medium" | "large"
): Promise<ModelLimit[]> {
  const results = await Promise.all(
    assignments.map(async ({ id, label, assignment }) => {
      const base: ModelLimit = {
        id,
        label,
        connectionType: assignment.connectionType,
        provider: assignment.provider,
        modelName: assignment.modelName,
        canFinish: true,
      };

      // Check cache first for all assignment types
      const cached = getCachedReachability(userId, assignment);
      if (cached) {
        // The cache is keyed by model + key, so two roles sharing a model share
        // an entry. Keep this role's own id/label instead of the cached one.
        return { ...cached, id: base.id, label: base.label };
      }

      if (needsClientOllama(assignment)) {
        const result = {
          ...base,
          canFinish: true,
          reason: "Local Ollama will be verified in the browser at runtime.",
        };
        setCachedReachability(userId, assignment, result);
        return result;
      }

      // For LOCAL CLI models (llamacpp/llamafile), we can't easily verify
      // without running the binary. Assume OK with a note.
      if (
        assignment.connectionType === "LOCAL" &&
        assignment.provider !== "ollama"
      ) {
        const result = {
          ...base,
          canFinish: true,
          // No fake capacity number "" just a note that it's unverified.
        };
        setCachedReachability(userId, assignment, result);
        return result;
      }

      // For API models: ping the provider's /models endpoint.
      if (assignment.connectionType === "API") {
        const testResult = await quickApiReachabilityCheck(userId, assignment);
        const result = {
          ...base,
          canFinish: testResult.canFinish,
          reason: testResult.reason,
        };
        setCachedReachability(userId, assignment, result);
        return result;
      }

      return base;
    })
  );
  return results;
}

// Quick reachability check for API providers "" used by checkLimits.
// Returns canFinish=true if the key works + API is reachable, false otherwise.
// This is a lighter check than the full testAssignment() "" it just answers
// "can we reach this provider with this key right now?"
// Uses the same caching mechanism as checkLimits for efficiency.
async function quickApiReachabilityCheck(
  userId: string,
  assignment: ModelAssignment
): Promise<{ canFinish: boolean; reason?: string }> {
  const { provider, apiKey } = assignment;
  // Use the saved apiEndpoint (the legacy `endpoint` field is stripped on save).
  let endpoint: string | undefined;
  try {
    endpoint = resolveEndpoint(assignment) ?? assignment.endpoint;
  } catch (err) {
    return { canFinish: false, reason: (err as Error).message };
  }
  // Z.ai is always reachable "" it uses the built-in SDK.
  if (provider === "zai") {
    return { canFinish: true };
  }
  if (!apiKey) {
    return { canFinish: false, reason: "API key is required." };
  }

  // Check cache first
  const cached = getCachedReachability(userId, assignment);
  if (cached) {
    return { canFinish: cached.canFinish, reason: cached.reason };
  }

  const endpoints: Record<string, string> = {
    openai: "https://api.openai.com/v1/models",
    mistral: "https://api.mistral.ai/v1/models",
    groq: "https://api.groq.com/openai/v1/models",
    anthropic: "https://api.anthropic.com/v1/models",
    openrouter: "https://openrouter.ai/api/v1/models",
  };

  try {
    let res: Response;
    if (provider === "anthropic") {
      const url = endpoint
        ? `${endpoint.replace(/\/$/, "")}/models`
        : endpoints.anthropic;
      res = await fetch(url, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(8_000),
      });
    } else if (provider === "gemini") {
      // Gemini uses key as query param.
      const root = (endpoint || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
      const base = root.endsWith("/models") ? root : `${root}/models`;
      res = await fetch(`${base}?key=${encodeURIComponent(apiKey)}`, {
        method: "GET",
        signal: AbortSignal.timeout(8_000),
      });
    } else {
      // OpenAI-compatible.
      const url = endpoint
        ? `${endpoint.replace(/\/$/, "")}/models`
        : endpoints[provider] || endpoints.openai;
      res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
    }

    if (res.ok) {
      const result = { canFinish: true };
      setCachedReachability(userId, assignment, { id: "cached", label: "cached", connectionType: assignment.connectionType, provider: assignment.provider, modelName: assignment.modelName, canFinish: true });
      return result;
    }
    if (res.status === 401) {
      const result = { canFinish: false, reason: `${provider} rejected the API key (401).` };
      setCachedReachability(userId, assignment, { id: "cached", label: "cached", connectionType: assignment.connectionType, provider: assignment.provider, modelName: assignment.modelName, canFinish: false, reason: result.reason });
      return result;
    }
    if (res.status === 403) {
      const result = {
        canFinish: false,
        reason: `${provider} blocked the request (403) - likely a region restriction or quota issue.`,
      };
      setCachedReachability(userId, assignment, { id: "cached", label: "cached", connectionType: assignment.connectionType, provider: assignment.provider, modelName: assignment.modelName, canFinish: false, reason: result.reason });
      return result;
    }
    if (res.status === 429) {
      const result = { canFinish: false, reason: `${provider} rate limit hit (429).` };
      setCachedReachability(userId, assignment, { id: "cached", label: "cached", connectionType: assignment.connectionType, provider: assignment.provider, modelName: assignment.modelName, canFinish: false, reason: result.reason });
      return result;
    }
    const result = {
      canFinish: false,
      reason: `${provider} returned HTTP ${res.status}.`,
    };
    setCachedReachability(userId, assignment, { id: "cached", label: "cached", connectionType: assignment.connectionType, provider: assignment.provider, modelName: assignment.modelName, canFinish: false, reason: result.reason });
    return result;
  } catch (err) {
    const e = err as Error;
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code || cause?.message;
    const isConn =
      e.message.includes("fetch failed") ||
      e.message.includes("aborted") ||
      e.message.includes("ECONNREFUSED");
    const baseReason = isConn
      ? `Cannot reach ${provider} from the server (network/region block).`
      : `${provider} error: ${e.message}`;
    const reason = detail ? `${baseReason} (${detail})` : baseReason;
    const result = {
      canFinish: false,
      reason,
    };
    setCachedReachability(userId, assignment, { id: "cached", label: "cached", connectionType: assignment.connectionType, provider: assignment.provider, modelName: assignment.modelName, canFinish: false, reason: result.reason });
    return result;
  }
}

export async function callModel(
  rawAssignment: ModelAssignment,
  messages: ChatMessage[],
  opts: {
    timeoutMs: number;
    role: string;
    intent?: string;
    onChunk?: (text: string) => void;
  }
): Promise<{
  output: string;
  latencyMs: number;
  retries: number;
  timedOut: boolean;
  lastError?: string;
  tokens?: TokenUsage;
  heartbeats?: number;
}> {
  const started = Date.now();
  let retries = 0;
  let timedOut = false;
  let lastError: string | undefined;
  let tokens: TokenUsage | undefined;
  // Saved configs only keep apiEndpoint / localEndpoint (the legacy `endpoint`
  // field is stripped on save), so resolve it again here. Otherwise a custom
  // endpoint is silently ignored and requests go to the provider default.
  let assignment = rawAssignment;
  const effectiveTimeout =
    (assignment.provider === "gemini" || assignment.provider === "ollama") && opts.onChunk
      ? DEFAULT_TIMEOUTS.GENERATION
      : opts.timeoutMs;
  const systemPrompt =
    messages.find((message) => message.role === "system")?.content ||
    (opts.role === "host"
      ? "You are NOX Host. Analyze the user's intent and either answer directly or synthesize the response from a specialist model into a clean reply to the user. Be concise."
      : opts.intent
        ? `You are NOX ${opts.role} specialist (intent: ${opts.intent}). Answer the user's request focused on your specialty. Be concise and useful.`
        : "You are NOX AI. Respond helpfully and concisely.");

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      assignment = {
        ...rawAssignment,
        endpoint: resolveEndpoint(rawAssignment) ?? rawAssignment.endpoint,
      };
      const result = await Promise.race([
        assignment.provider === "gemini" && opts.onChunk
          ? callGeminiStreaming(
              assignment.apiKey || "",
              assignment.modelName,
              systemPrompt,
              messages.filter((m) => m.role !== "system"),
              assignment.endpoint,
              opts.onChunk
            )
          : realCall(
              assignment,
              messages,
              opts.role,
              opts.intent,
              effectiveTimeout,
              opts.onChunk
            ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timeout after ${effectiveTimeout}ms`)),
            effectiveTimeout
          );
        }),
      ]);
      return {
        output: result.text,
        latencyMs: Date.now() - started,
        retries,
        timedOut: false,
        tokens: result.tokens,
        heartbeats: "heartbeats" in result && typeof result.heartbeats === "number"
          ? result.heartbeats
          : 0,
      };
    } catch (err) {
      retries = attempt + 1;
      const e = err as Error;
      // Only real timeouts count as timed out; auth/quota errors do not.
      timedOut = /timeout|timed out|aborted/i.test(e.message);
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      const detail = cause?.code || cause?.message;
      lastError = detail ? `${e.message} (${detail})` : e.message;
      if (attempt === MAX_RETRY) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    output: "",
    latencyMs: Date.now() - started,
    retries,
    timedOut,
    lastError,
    tokens,
    heartbeats: 0,
  };
}

// Result of a single model call "" text + token usage (when available).
export interface ModelCallResult {
  text: string;
  tokens?: TokenUsage;
  heartbeats?: number;
}

async function realCall(
  assignment: ModelAssignment,
  messages: ChatMessage[],
  role: string,
  intent?: string,
  timeoutMs?: number,
  onChunk?: (text: string) => void
): Promise<ModelCallResult> {
  // Build the system hint the same way "" this is the NOX persona prompt.
  const systemHint =
    messages.find((message) => message.role === "system")?.content ||
    (role === "host"
      ? "You are NOX Host. Analyze the user's intent and either answer directly or synthesize the response from a specialist model into a clean reply to the user. Be concise."
      : intent
        ? `You are NOX ${role} specialist (intent: ${intent}). Answer the user's request focused on your specialty. Be concise and useful.`
        : "You are NOX AI. Respond helpfully and concisely.");

  // Normalise the conversation "" preserve image attachments for vision.
  const conv: ChatMessage[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
      image: m.image,
    }));

  // Route based on the assignment's connection type.
  if (assignment.connectionType === "LOCAL") {
    return callLocalCli(assignment, systemHint, conv, timeoutMs, onChunk);
  }

  return callApi(assignment, systemHint, conv);
}

// ---

export async function callApi(assignment: ModelAssignment, systemHint: string, conv: ChatMessage[]): Promise<ModelCallResult> {
  const { provider, modelName, apiKey, endpoint } = assignment;
  const normalizedKey = normalizeApiKey(apiKey);

  if (provider !== "zai") {
    const keyError = validateApiKey(normalizedKey);
    if (keyError) {
      throw new Error(keyError);
    }
  }

  const resolvedProvider = normalizeProviderSelection(provider, normalizedKey, endpoint);
  if (resolvedProvider === "anthropic") {
    return callAnthropic(normalizedKey ?? "", modelName, systemHint, conv, endpoint);
  }

  if (resolvedProvider === "zai") {
    return callZai(modelName, systemHint, conv);
  }

  if (resolvedProvider === "gemini") {
    return callGemini(normalizedKey ?? "", modelName, systemHint, conv, endpoint);
  }

  return callOpenAiCompatible(normalizedKey ?? "", modelName, systemHint, conv, resolvedProvider, endpoint);
}

// OpenAI-compatible endpoint (openai, mistral, groq).
// Supports multimodal (image) input for vision-capable models.
async function callOpenAiCompatible(
  apiKey: string,
  model: string,
  systemHint: string,
  conv: ChatMessage[],
  provider: string,
  endpoint?: string
): Promise<ModelCallResult> {
  const normalizedKey = normalizeApiKey(apiKey);
  const keyError = validateApiKey(normalizedKey);
  if (keyError) {
    throw new Error(keyError);
  }

  const runtime = resolveProviderConfig(provider, normalizedKey, endpoint);
  const url = buildProviderUrl(runtime.defaultBase, runtime.chatPath);
  const safeKey = normalizedKey ?? "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (runtime.auth.type === "bearer") {
    headers.Authorization = `Bearer ${safeKey}`;
  } else if (runtime.auth.type === "x-api-key") {
    headers[runtime.auth.headerName || "x-api-key"] = safeKey;
    headers["anthropic-version"] = "2023-06-01";
  }

  const messages: Array<{ role: string; content: string | unknown[] }> = [
    { role: "system", content: systemHint },
    ...conv.map((m) => {
      if (m.image) {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: `data:${m.image.mimeType};base64,${m.image.data}` } },
          ],
        };
      }
      return { role: m.role, content: m.content };
    }),
  ];

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, max_tokens: maxTok(), messages }),
  }, DEFAULT_TIMEOUTS.GENERATION);

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(classifyProviderError(runtime.displayName.toLowerCase(), res.status, body).message);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  const usage = json.usage;
  const tokens: TokenUsage | undefined = usage ? { input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0, total: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0) } : undefined;
  return { text, tokens };
}

// Z.ai "" built-in SDK provider. No API key needed.
// Uses the z-ai-web-dev-sdk which is pre-installed and works from any region.
// If the SDK config file is missing, falls back to a direct HTTP call to the
// Z.ai API using the config from /etc/.z-ai-config or environment variables.
async function callZai(
  model: string,
  systemHint: string,
  conv: ChatMessage[]
): Promise<ModelCallResult> {
  // Try the SDK first "" it handles auth automatically if the config file exists.
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();

    const completion = await zai.chat.completions.create({
      model,
      messages: [
        { role: "assistant", content: systemHint },
        ...conv.map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
      ],
      thinking: { type: "disabled" },
    } as any);

    const text = completion.choices[0]?.message?.content || "";
    const usage = (completion as any).usage;
    const tokens: TokenUsage | undefined = usage
      ? {
          input: usage.prompt_tokens || usage.input_tokens || 0,
          output: usage.completion_tokens || usage.output_tokens || 0,
          total: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
        }
      : undefined;

    return { text, tokens };
  } catch (sdkErr) {
    // SDK failed "" likely missing .z-ai-config file.
    // Fall back to direct HTTP call to Z.ai API.
    const fallbackResult = await callZaiHttpFallback(model, systemHint, conv);
    if (fallbackResult) return fallbackResult;

    // If fallback also fails, throw the original SDK error
    throw new Error(
      `Z.ai SDK error: ${(sdkErr as Error).message}. ` +
      `On your local machine, create a .z-ai-config file in your home directory. ` +
      `Run: z-ai chat --prompt "test" to auto-generate it, or use a different provider.`
    );
  }
}

// Fallback: call Z.ai API directly via HTTP.
// Reads the config from /etc/.z-ai-config, ~/.z-ai-config, or ./.z-ai-config.
async function callZaiHttpFallback(
  model: string,
  systemHint: string,
  conv: ChatMessage[]
): Promise<ModelCallResult | null> {
  const fs = await import("fs");
  const path = await import("path");
  const os = await import("os");

  // Try to find the config file
  const configPaths = [
    "/etc/.z-ai-config",
    path.join(/* turbopackIgnore: true */ os.default.homedir(), ".z-ai-config"),
    ".z-ai-config",
  ];

  let config: { baseUrl?: string; apiKey?: string; token?: string } | null = null;
  for (const p of configPaths) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      config = JSON.parse(raw);
      break;
    } catch {
      // file doesn't exist at this path
    }
  }

  if (!config) {
    return null; // No config found "" caller will show the error
  }

  const baseUrl = config.baseUrl || "https://internal-api.z.ai/v1";
  const url = `${baseUrl}/chat/completions`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey || "Z.ai"}`,
        ...(config.token ? { "X-Chat-Token": config.token } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemHint },
          ...conv.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return null;
    }

    const json = await res.json();
    const text = json.choices?.[0]?.message?.content || "";
    const usage = json.usage;
    const tokens: TokenUsage | undefined = usage
      ? {
          input: usage.prompt_tokens || 0,
          output: usage.completion_tokens || 0,
          total: usage.total_tokens || 0,
        }
      : undefined;

    return { text, tokens };
  } catch {
    return null;
  }
}

// Anthropic Messages API.
// Supports multimodal (image) input for vision-capable Claude models.
async function callAnthropic(
  apiKey: string,
  model: string,
  systemHint: string,
  conv: ChatMessage[],
  endpoint?: string
): Promise<ModelCallResult> {
  const normalizedKey = normalizeApiKey(apiKey);
  const keyError = validateApiKey(normalizedKey);
  if (keyError) {
    throw new Error(keyError);
  }

  const runtime = resolveProviderConfig("anthropic", normalizedKey, endpoint);
  const url = buildProviderUrl(runtime.defaultBase, runtime.chatPath);
  const safeKey = normalizedKey ?? "";
  const messages: Array<{ role: string; content: string | unknown[] }> = conv.map((m) => {
    if (m.image) {
      return {
        role: m.role,
        content: [
          { type: "image", source: { type: "base64", media_type: m.image.mimeType, data: m.image.data } },
          { type: "text", text: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": safeKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTok(), system: systemHint, messages }),
  }, DEFAULT_TIMEOUTS.GENERATION);

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(classifyProviderError(runtime.displayName.toLowerCase(), res.status, body).message);
  }

  const json = await res.json();
  const text = json.content?.[0]?.text ?? "";
  const usage = json.usage;
  const tokens: TokenUsage | undefined = usage ? { input: usage.input_tokens || 0, output: usage.output_tokens || 0, total: (usage.input_tokens || 0) + (usage.output_tokens || 0) } : undefined;
  return { text, tokens };
}

// Google Gemini generateContent API.
//
// SECURITY: API credentials are never included in error messages, trace
// objects, or logs. Google API keys use the query-string form expected by the
// provider, while bearer tokens are sent in the Authorization header.
async function callGemini(
  apiKey: string,
  model: string,
  systemHint: string,
  conv: ChatMessage[],
  endpoint?: string
): Promise<ModelCallResult> {
  const keyError = validateApiKey(apiKey);
  if (keyError) {
    throw new Error(keyError);
  }

  const normalizedKey = normalizeApiKey(apiKey)!;
  const runtime = resolveProviderConfig("gemini", normalizedKey, endpoint);
  const useQueryKey = isGoogleApiKey(normalizedKey);
  const url = buildGeminiGenerateUrl(runtime.defaultBase, model, normalizedKey, useQueryKey);
  const contents = conv.map((m) => {
    const parts: unknown[] = [{ text: m.content }];
    if (m.image) {
      parts.push({ inline_data: { mime_type: m.image.mimeType, data: m.image.data } });
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  const init = buildGeminiRequestInit(normalizedKey, "POST", { contents, systemInstruction: { parts: [{ text: systemHint }] }, generationConfig: { maxOutputTokens: maxTok() } });
  const res = await fetchWithRetry(url, init, DEFAULT_TIMEOUTS.GENERATION);

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(classifyProviderError(runtime.displayName.toLowerCase(), res.status, body).message);
  }

  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text || "").join("") : "";
  const usage = json.usageMetadata;
  const tokens: TokenUsage | undefined = usage ? { input: usage.promptTokenCount || 0, output: usage.candidatesTokenCount || 0, total: usage.totalTokenCount || 0 } : undefined;
  return { text, tokens };
}

export async function callGeminiStreaming(
  apiKey: string,
  model: string,
  systemHint: string,
  conv: ChatMessage[],
  endpoint: string | undefined,
  onChunk: (text: string) => void
): Promise<{ text: string; tokens?: TokenUsage }> {
  const keyError = validateApiKey(apiKey);
  if (keyError) throw new Error(keyError);

  const normalizedKey = normalizeApiKey(apiKey)!;
  const runtime = resolveProviderConfig("gemini", normalizedKey, endpoint);
  const useQueryKey = isGoogleApiKey(normalizedKey);

  const base = (runtime.defaultBase || "https://generativelanguage.googleapis.com/v1beta").trim().replace(/\/+$/, "");
  const modelsBase = base.endsWith("/models") ? base : `${base}/models`;
  let url = `${modelsBase}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  if (useQueryKey) url += `&key=${encodeURIComponent(normalizedKey.trim())}`;

  const contents = conv.map((m) => {
    const parts: unknown[] = [{ text: m.content }];
    if (m.image) parts.push({ inline_data: { mime_type: m.image.mimeType, data: m.image.data } });
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  const init = buildGeminiRequestInit(normalizedKey, "POST", {
    contents,
    systemInstruction: { parts: [{ text: systemHint }] },
    generationConfig: { maxOutputTokens: maxTok() },
  });

  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(DEFAULT_TIMEOUTS.GENERATION) });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(classifyProviderError("gemini", res.status, body).message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let tokens: TokenUsage | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const chunk = JSON.parse(line.slice(6));
        const text = chunk.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
        if (text) {
          fullText += text;
          onChunk(text);
        }
        if (chunk.usageMetadata) {
          const u = chunk.usageMetadata;
          tokens = { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0, total: u.totalTokenCount || 0 };
        }
      } catch {
        // partial line, keep buffering
      }
    }
  }

  return { text: fullText, tokens };
}

function validateApiKey(apiKey: string | undefined): string | null {
  const trimmed = apiKey?.trim();
  return trimmed ? null : "API key is required.";
}

// Lightweight Gemini connection test "" hits the ListModels endpoint instead
// of running a full generateContent call. Cheaper, faster, and confirms the
// key works + the Generative Language API is enabled on the project.
//
// SECURITY: Google API keys use the query-string form expected by the API when
// needed, bearer tokens are sent via the Authorization header, and neither is
// exposed in the returned TestResult message/reason.
export async function testGeminiConnection(
  apiKey: string,
  model: string,
  endpoint?: string
): Promise<TestResult> {
  const started = Date.now();
  const keyError = validateApiKey(apiKey);
  if (keyError) {
    return {
      ok: false,
      status: "error",
      message: keyError,
      reason: "An API key is required for API connections.",
      fixSteps: ["Paste your provider API key", "Try again after saving the key"],
      latencyMs: Date.now() - started,
    };
  }

  const normalizedKey = normalizeApiKey(apiKey)!;
  const runtime = resolveProviderConfig("gemini", normalizedKey, endpoint);
  const useQueryKey = isGoogleApiKey(normalizedKey);
  const baseUrl = buildProviderUrl(runtime.defaultBase, runtime.testPath);
  const url = useQueryKey
    ? `${baseUrl}?key=${encodeURIComponent(normalizedKey)}&pageSize=100`
    : `${baseUrl}?pageSize=100`;
  const init: RequestInit = useQueryKey ? { method: "GET" } : { method: "GET", headers: { Authorization: `Bearer ${normalizedKey}` } };

  try {
    const res = await fetchWithRetry(url, init, 10_000);
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      const classified = classifyProviderError(runtime.displayName.toLowerCase(), res.status, body);
      return { ok: false, status: "error", message: classified.message, reason: classified.reason, fixSteps: classified.fixSteps, latencyMs: Date.now() - started };
    }

    const json = await res.json();
    const listedModels: string[] = (json.models || []).map((m: { name?: string }) => (m.name || "").replace(/^models\//, ""));
    const modelAvailable = listedModels.length === 0 || listedModels.includes(model);
    const latencyMs = Date.now() - started;
    if (!modelAvailable) {
      return { ok: false, status: "error", message: `Model '${model}' is not available for Gemini right now.`, reason: `ListModels succeeded but '${model}' is not in the list of available models.`, fixSteps: ["Pick a known model from the dropdown", "Confirm the model is enabled in AI Studio"], latencyMs };
    }

    return { ok: true, status: "ready", message: `Connected to Google Gemini (key verified via official API). Model "${model}" ready.`, version: model, latencyMs };
  } catch (err) {
    const e = err as Error;
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code || cause?.message;
    const baseMessage = isTransientProviderError(e.message) ? `Could not reach Google's Gemini API: ${e.message}` : `Gemini error: ${e.message}`;
    const message = detail ? `${baseMessage} (${detail})` : baseMessage;
    return { ok: false, status: "error", message, reason: e.message, fixSteps: ["Check your network connection", "Verify the Gemini endpoint", "Retry in a moment"], latencyMs: Date.now() - started };
  }
}


// Test an OpenAI-compatible API connection (openai, mistral, groq).
// Hits GET /v1/models with the Bearer token "" lightweight, no tokens spent.
// Verifies: key is valid, API is reachable from the server, key has access.
export async function testOpenAiCompatibleConnection(
  apiKey: string,
  model: string,
  provider: string,
  endpoint?: string
): Promise<TestResult> {
  const started = Date.now();
  const normalizedKey = normalizeApiKey(apiKey);
  const keyError = validateApiKey(normalizedKey);
  if (keyError) {
    return { ok: false, status: "error", message: keyError, reason: "An API key is required for API connections.", fixSteps: ["Paste the provider API key", "Try again"] };
  }

  const runtime = resolveProviderConfig(provider, normalizedKey, endpoint);
  const url = buildProviderUrl(runtime.defaultBase, runtime.testPath);
  const safeKey = normalizedKey ?? "";
  const headers: Record<string, string> = {};
  if (runtime.auth.type === "bearer") {
    headers.Authorization = `Bearer ${safeKey}`;
  } else if (runtime.auth.type === "x-api-key") {
    headers[runtime.auth.headerName || "x-api-key"] = safeKey;
    headers["anthropic-version"] = "2023-06-01";
  }

  try {
    const res = await fetchWithRetry(url, { method: "GET", headers }, 10_000);
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      const classified = classifyProviderError(runtime.displayName.toLowerCase(), res.status, body);
      return { ok: false, status: "error", message: classified.message, reason: classified.reason, fixSteps: classified.fixSteps, latencyMs: Date.now() - started };
    }

    const json = await res.json();
    const modelCount = Array.isArray(json.data) ? json.data.length : 0;
    return { ok: true, status: "ready", message: `Connected to ${runtime.displayName} (official API). ${modelCount} models available. Model "${model}" ready.`, version: model, latencyMs: Date.now() - started };
  } catch (err) {
    const e = err as Error;
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code || cause?.message;
    const baseMessage = isTransientProviderError(e.message) ? `Could not reach ${runtime.displayName}'s API from the server.` : `${runtime.displayName} error: ${e.message}`;
    const message = detail ? `${baseMessage} (${detail})` : baseMessage;
    return { ok: false, status: "error", message, reason: e.message, fixSteps: ["Check your network connection", "Verify the provider endpoint", "Retry in a moment"], latencyMs: Date.now() - started };
  }
}

// Test an Anthropic API connection by hitting GET /v1/models with x-api-key.
// Verifies: key is valid, API is reachable from the server, key has access.
// Anthropic uses a different auth header (x-api-key + anthropic-version) than
// the OpenAI-compatible providers, so it needs its own test function.
export async function testAnthropicConnection(
  apiKey: string,
  model: string,
  endpoint?: string
): Promise<TestResult> {
  const started = Date.now();
  const normalizedKey = normalizeApiKey(apiKey);
  const keyError = validateApiKey(normalizedKey);
  if (keyError) {
    return { ok: false, status: "error", message: keyError, reason: "An API key is required for API connections.", fixSteps: ["Paste the Anthropic API key", "Try again"] };
  }

  const runtime = resolveProviderConfig("anthropic", normalizedKey, endpoint);
  const url = buildProviderUrl(runtime.defaultBase, runtime.testPath);
  const safeKey = normalizedKey ?? "";
  try {
    const res = await fetchWithRetry(url, { method: "GET", headers: { "x-api-key": safeKey, "anthropic-version": "2023-06-01" } }, 10_000);
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      const classified = classifyProviderError(runtime.displayName.toLowerCase(), res.status, body);
      return { ok: false, status: "error", message: classified.message, reason: classified.reason, fixSteps: classified.fixSteps, latencyMs: Date.now() - started };
    }

    const json = await res.json();
    const modelCount = Array.isArray(json.data) ? json.data.length : 0;
    return { ok: true, status: "ready", message: `Connected to Anthropic (official API). ${modelCount} models available. Model "${model}" ready.`, version: model, latencyMs: Date.now() - started };
  } catch (err) {
    const e = err as Error;
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code || cause?.message;
    const baseMessage = isTransientProviderError(e.message) ? `Could not reach Anthropic's API from the server.` : `Anthropic error: ${e.message}`;
    const message = detail ? `${baseMessage} (${detail})` : baseMessage;
    return { ok: false, status: "error", message, reason: e.message, fixSteps: ["Check your network connection", "Verify the Anthropic endpoint", "Retry in a moment"], latencyMs: Date.now() - started };
  }
}

// Test ollama connection by hitting the HTTP API.
// Pings GET /api/tags to verify ollama is running and reachable, then
// optionally checks if the configured model is available.
export async function testOllamaConnection(
  model: string,
  endpoint?: string
): Promise<TestResult> {
  const started = Date.now();
  const base = normalizeOllamaEndpoint(endpoint);

  try {
    // Step 1: ping /api/tags to verify ollama is running.
    const res = await fetch(`${base}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return {
        ok: false,
        status: "error",
        message: `Ollama HTTP ${res.status} at ${base}. Check Ollama is running.`,
        reason: `Ollama responded with HTTP ${res.status}.`,
        fixSteps: [
          `Verify Ollama is running at ${base}`,
          "Check the Endpoint field matches your Ollama host",
          "If NOX AI is hosted, 127.0.0.1 refers to the server - set Endpoint to a reachable host",
        ],
      };
    }

    // Step 2: check if the configured model is available.
    const json = await res.json();
    const availableModels: string[] = (json.models || []).map(
      (m: { name?: string }) => m.name || ""
    );
    const modelAvailable =
      availableModels.length === 0 ||
      availableModels.includes(model);

    const latencyMs = Date.now() - started;
    if (!modelAvailable) {
      return {
        ok: false,
        status: "error",
        message: `Model "${model}" not found in Ollama. Available models: ${availableModels.slice(0, 5).join(", ")}${availableModels.length > 5 ? "..." : ""}`,
        reason: `Model not pulled yet. Ollama is running but "${model}" is not installed.`,
        fixSteps: [
          `Run: ollama pull ${model}`,
          `Or pick from: ${availableModels.slice(0, 5).join(", ")}`,
        ],
        latencyMs,
      };
    }

    return {
      ok: true,
      status: "ready",
      message: `Connected to Ollama at ${base}. Model "${model}" ready.`,
      version: model,
      latencyMs,
    };
  } catch (err) {
    const e = err as Error;
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code || cause?.message;
    const isConnRefused =
      e.message.includes("ECONNREFUSED") ||
      e.message.includes("fetch failed") ||
      e.message.includes("aborted");
    const baseMessage = isConnRefused
      ? `Could not connect to Ollama at ${base}. If NOX AI is hosted, 127.0.0.1 refers to the SERVER, not your machine. Set the Endpoint field to a publicly reachable Ollama host.`
      : `Ollama error: ${e.message}`;
    const message = detail ? `${baseMessage} (${detail})` : baseMessage;
    const baseReason = isConnRefused
      ? "Connection refused - Ollama is not running at this address from the server's perspective. (Note: localhost is automatically resolved to 127.0.0.1 to avoid IPv6 issues)"
      : e.message;
    const reason = detail ? `${baseReason} (${detail})` : baseReason;
    return {
      ok: false,
      status: "error",
      message,
      reason,
      fixSteps: isConnRefused
        ? [
            "If running locally: ensure Ollama is started (ollama serve)",
            "If NOX AI is hosted: set Endpoint to a public Ollama host",
            "Check firewall settings allow access to port 11434",
            "Note: localhost is automatically resolved to 127.0.0.1 to avoid IPv6 issues",
          ]
        : ["Check Ollama logs for errors", "Verify the endpoint URL is correct"],
    };
  }
}

// ---
//
// spawnWithHeartbeat: runs a CLI binary via spawn() and monitors stdout for
// incoming data. Each time new stdout data arrives, the timeout clock resets
// (extends by the original timeoutMs). This prevents slow-but-working local
// models from being killed mid-generation while still protecting against truly
// stuck processes.
//
// Hard ceiling: 3x the configured timeout (HEARTBEAT_MAX_EXTENSIONS = 3).
// If the process exceeds this total wall time, it's killed.
const HEARTBEAT_MAX_EXTENSIONS = 3;

function spawnWithHeartbeat(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv },
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; heartbeats: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let heartbeats = 0;
    let extensionsUsed = 0;
    const maxTotalMs = timeoutMs * (1 + HEARTBEAT_MAX_EXTENSIONS);
    const startedAt = Date.now();

    // Initial timeout timer.
    let timer: NodeJS.Timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timeout after ${timeoutMs}ms (no stdout for ${timeoutMs}ms, ${heartbeats} heartbeats received)`));
    }, timeoutMs);

    // Hard ceiling timer "" kills even if heartbeats keep coming.
    const hardCeilingTimer = setTimeout(() => {
      clearTimeout(timer);
      child.kill("SIGTERM");
      reject(new Error(`hard timeout after ${maxTotalMs}ms (${heartbeats} heartbeats, ceiling reached)`));
    }, maxTotalMs);

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();

      // Heartbeat: reset the idle timer (if we haven't hit the ceiling).
      if (extensionsUsed < HEARTBEAT_MAX_EXTENSIONS) {
        clearTimeout(timer);
        extensionsUsed++;
        heartbeats++;
        timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`timeout after ${timeoutMs}ms idle (extended ${heartbeats} times, ${Date.now() - startedAt}ms total)`));
        }, timeoutMs);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      clearTimeout(hardCeilingTimer);
      reject(err);
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      clearTimeout(hardCeilingTimer);
      if (code === 0) {
        resolve({ stdout, stderr, heartbeats });
      } else {
        reject(new Error(`Process exited with code ${code}. ${stderr.slice(0, 300)}`));
      }
    });
  });
}

// ---
//
// For ollama: uses the HTTP API (POST /api/generate) instead of spawning a
// subprocess. This is faster, more reliable, and supports remote ollama
// instances via the `endpoint` field (default: http://127.0.0.1:11434).
//
// For llamacpp/llamafile: spawns the binary as a subprocess with the prompt
// as a CLI argument.
//
// The timeout/retry wrapping is handled by callModel's Promise.race.

async function callLocalCli(
  assignment: ModelAssignment,
  systemHint: string,
  conv: ChatMessage[],
  timeoutMs?: number,
  onChunk?: (text: string) => void
): Promise<ModelCallResult> {
  const { provider, modelName, cliPath, cliArgs, endpoint } = assignment;

  // Ollama: use HTTP API (no subprocess needed).
  if (provider === "ollama") {
    return callOllamaHttp(modelName, systemHint, conv, endpoint, timeoutMs, onChunk);
  }

  // llamacpp / llamafile: subprocess call.
  if (!cliPath) {
    throw new Error(
      `No CLI path configured for ${provider}/${modelName}. Add one in Advanced Customization.`
    );
  }

  // Build a single text prompt from the system hint + last user message.
  const lastUser = [...conv].reverse().find((m) => m.role === "user");
  const prompt = `${systemHint}\n\nUser: ${lastUser?.content || ""}\nAssistant:`;
  const images = conv
    .filter((m) => m.image)
    .map((m) => m.image?.data)
    .filter((data): data is string => Boolean(data));

  let args: string[];
  if (provider === "qwen-code") {
    args = [
      ...(cliArgs?.split(/\s+/).filter(Boolean) || []),
      "-p",
      prompt,
    ];
  } else if (provider === "llamacpp" || provider === "llamafile") {
    args = ["-m", modelName, "-p", prompt];
  } else {
    args = [modelName, prompt];
  }

  if (cliArgs && provider !== "qwen-code") {
    args.push(...cliArgs.split(/\s+/).filter(Boolean));
  }

  try {
    // Use spawn() instead of execFile() so we can monitor stdout for heartbeat
    // signals. Each time new stdout data arrives, the timeout clock resets
    // (up to a hard ceiling of 3x the configured timeout).
    const result = await spawnWithHeartbeat(cliPath, args, {
      env: { ...process.env },
    }, timeoutMs || DEFAULT_TIMEOUTS.LOCAL);
    // LOCAL CLI models don't return token usage "" return text only.
    return { text: result.stdout.trim(), heartbeats: result.heartbeats };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new Error(
        `CLI binary not found at "${cliPath}". The server cannot find this path "" if you're running NOX AI in a hosted environment, the binary must be installed on the SERVER, not your local machine.`
      );
    }
    const stderr = (e as { stderr?: string }).stderr?.slice(0, 300) || e.message;
    throw new Error(`${provider} CLI error: ${stderr}`);
  }
}

// Call ollama via its HTTP API (POST /api/generate).
// Uses `endpoint` as the ollama host (default: http://127.0.0.1:11434).
// Uses streaming mode (stream: true) so each NDJSON chunk acts as a heartbeat
// signal "" the timeout clock resets on each chunk, up to 3x the configured
// timeout. This prevents slow-but-working local models from being killed
// mid-generation.
async function callOllamaHttp(
  model: string,
  systemHint: string,
  conv: ChatMessage[],
  endpoint?: string,
  timeoutMs?: number,
  onChunk?: (text: string) => void
): Promise<ModelCallResult> {
  const base = normalizeOllamaEndpoint(endpoint);
  const url = `${base}/api/generate`;
  const effectiveTimeout = timeoutMs || DEFAULT_TIMEOUTS.LOCAL;
  const maxTotalMs = effectiveTimeout * (1 + HEARTBEAT_MAX_EXTENSIONS);

  // Build the prompt: system hint + conversation turns.
  const lastUser = [...conv].reverse().find((m) => m.role === "user");
  const prompt = `${systemHint}\n\nUser: ${lastUser?.content || ""}\nAssistant:`;
  const images = conv
    .filter((m) => m.image)
    .map((m) => m.image?.data)
    .filter((data): data is string => Boolean(data))
    .map((data) => data.replace(/^data:image\/[^;]+;base64,/, ""));

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: true, // streaming mode "" each chunk is a heartbeat
        ...(images.length > 0 ? { images } : {}),
        options: {
          num_predict: 1024,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    // Read the streaming response (NDJSON "" one JSON object per line per chunk).
    // Each chunk resets the idle timer. Hard ceiling = 3x the timeout.
    let text = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let heartbeats = 0;
    let extensionsUsed = 0;

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("Ollama response had no readable body stream");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const startedAt = Date.now();

    // Read chunks with heartbeat-based timeout extension.
    while (true) {
      // Set up the idle timeout for this chunk read.
      const chunkPromise = reader.read();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(
            `Ollama stream timeout after ${effectiveTimeout}ms idle (${heartbeats} heartbeats, ${Date.now() - startedAt}ms total)`
          ));
        }, effectiveTimeout);
      });

      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        const result = await Promise.race([chunkPromise, timeoutPromise]);
        done = result.done;
        value = result.value;
      } catch (err) {
        // Idle timeout "" no data for effectiveTimeout ms.
        throw err;
      }

      if (done) break;

      // Got a chunk "" this is a heartbeat. Reset the idle timer.
      if (extensionsUsed < HEARTBEAT_MAX_EXTENSIONS) {
        extensionsUsed++;
        heartbeats++;
      }

      // Check hard ceiling.
      if (Date.now() - startedAt > maxTotalMs) {
        throw new Error(`Ollama hard timeout after ${maxTotalMs}ms (${heartbeats} heartbeats, ceiling reached)`);
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete NDJSON lines.
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.response) {
            text += chunk.response;
            onChunk?.(chunk.response);
          }
          // Token counts come in the final chunk.
          if (typeof chunk.prompt_eval_count === "number") {
            inputTokens = chunk.prompt_eval_count;
          }
          if (typeof chunk.eval_count === "number") {
            outputTokens = chunk.eval_count;
          }
        } catch {
          // Incomplete JSON "" skip, will be in buffer.
        }
      }
    }

    // Process any remaining buffer.
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer);
        if (chunk.response) {
          text += chunk.response;
        }
        if (typeof chunk.prompt_eval_count === "number") {
          inputTokens = chunk.prompt_eval_count;
        }
        if (typeof chunk.eval_count === "number") {
          outputTokens = chunk.eval_count;
        }
      } catch {
        // ignore
      }
    }

    const tokens: TokenUsage | undefined =
      typeof inputTokens === "number" && typeof outputTokens === "number"
        ? {
            input: inputTokens,
            output: outputTokens,
            total: inputTokens + outputTokens,
          }
        : undefined;
    return { text, tokens, heartbeats };
  } catch (err) {
    const e = err as Error;
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code || cause?.message;
    if (e.message.includes("ECONNREFUSED") || e.message.includes("fetch failed")) {
      const baseMessage = `Could not connect to Ollama at ${base}. The server cannot reach this address - if NOX AI is hosted, 127.0.0.1 refers to the SERVER, not your machine. Either install Ollama on the server, or set the Endpoint field to a publicly reachable Ollama host.`;
      const message = detail ? `${baseMessage} (${detail})` : baseMessage;
      throw new Error(message);
    }
    const message = detail ? `Ollama error: ${e.message} (${detail})` : `Ollama error: ${e.message}`;
    throw new Error(message);
  }
}
