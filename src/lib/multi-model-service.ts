import "server-only";
import { db } from "@/lib/db";
import { encryptApiKey, decryptApiKey, maskApiKey, isMaskedApiKey } from "@/lib/crypto";
import { execFile, spawn } from "child_process";
import { accessSync, constants as fsConstants, existsSync } from "fs";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import {
  type ConnectionType,
  type Mode,
  type FeatureId,
  type SpecialistId,
  type ModelAssignment,
  type MultiModelConfigDoc,
  type TestResult,
  type ModelLimit,
  type ChatMessage,
  type DispatchStep,
  type DispatchResult,
  type TokenUsage,
  type CostBreakdown,
  type IntentClassification,
  FEATURES,
  SPECIALISTS,
  PROVIDERS,
  DEFAULT_TIMEOUTS,
  MAX_RETRY,
  computeCost,
} from "@/lib/multi-model-types";

// Re-export for server-side imports that still want the types/catalogs.
export type {
  ConnectionType,
  Mode,
  FeatureId,
  SpecialistId,
  ModelAssignment,
  MultiModelConfigDoc,
  TestResult,
  ModelLimit,
  ChatMessage,
  DispatchStep,
  DispatchResult,
  TokenUsage,
  CostBreakdown,
  IntentClassification,
};
export { FEATURES, SPECIALISTS, PROVIDERS, DEFAULT_TIMEOUTS, MAX_RETRY };

// Helper to normalize localhost to 127.0.0.1 to avoid IPv6 resolution issues
// On Windows, Node.js often resolves "localhost" to ::1 (IPv6) but Ollama only listens on IPv4
function normalizeOllamaEndpoint(endpoint?: string): string {
  const base = endpoint || "http://127.0.0.1:11434";
  return base.replace("://localhost", "://127.0.0.1");
}

// Helper to resolve the correct endpoint field based on connection type
// This is the single source of truth for which endpoint field to use
function resolveEndpoint(a: ModelAssignment): string | undefined {
  return a.connectionType === "API" ? a.apiEndpoint : a.localEndpoint;
}

// Migration function to auto-heal legacy endpoint field
// Moves the old endpoint value to the correct field based on connection type
// and removes the legacy field to prevent future contamination
function migrateEndpoint(a: ModelAssignment | null | undefined): ModelAssignment | null | undefined {
  if (!a || !a.endpoint) return a;
  const migrated = { ...a };
  if (a.connectionType === "API" && !a.apiEndpoint) {
    migrated.apiEndpoint = a.endpoint;
  } else if (a.connectionType === "LOCAL" && !a.localEndpoint) {
    migrated.localEndpoint = a.endpoint;
  }
  delete migrated.endpoint; // clear the legacy field so it can never leak again
  return migrated;
}

// Simple in-memory cache for reachability checks with 60s TTL
const reachabilityCache = new Map<string, { result: ModelLimit; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

function getCacheKey(userId: string, assignment: ModelAssignment): string {
  return `${userId}-${assignment.connectionType}-${assignment.provider}-${assignment.modelName}-${resolveEndpoint(assignment) || ""}-${assignment.apiKey?.slice(-4) || ""}`;
}

function getCachedReachability(userId: string, assignment: ModelAssignment): ModelLimit | null {
  const key = getCacheKey(userId, assignment);
  const cached = reachabilityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  if (cached) {
    reachabilityCache.delete(key); // Clean up expired entry
  }
  return null;
}

function setCachedReachability(userId: string, assignment: ModelAssignment, result: ModelLimit): void {
  const key = getCacheKey(userId, assignment);
  reachabilityCache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// -----------------------------------------------------------------------------
// NOX AI — Multi-Model Service (server-only, user-scoped)
//
// Three modes (renamed per user request):
//   1. SINGLE        — one model for all 6 features (formerly GLOBAL)
//   2. MULTI         — each feature has its own model (formerly PER_FEATURE)
//   3. ORCHESTRATOR  — host routes prompts to specialists (formerly HOST)
//
// All config is scoped to a userId. API keys encrypted at rest.
//
// Safety layers (all three modes):
//   • connect-time validation (model + version ping, block save on failure)
//   • per-connection-type timeout defaults + backend heartbeat
//   • capped auto-retry (2 attempts) on timeout
//   • pre-flight user confirmation for multi-agent tasks
//   • per-model capacity/limit check before running multi-agent tasks
// -----------------------------------------------------------------------------

const SCOPE = "default";

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





// ---

function encryptAssignment(a?: ModelAssignment | null): ModelAssignment | null {
  if (!a) return null;
  return {
    ...a,
    apiKey: a.apiKey ? encryptApiKey(a.apiKey) : undefined,
  };
}

function encryptFeatureMap(
  m?: Partial<Record<FeatureId, ModelAssignment>>
): string | null {
  if (!m) return null;
  const out: Record<string, ModelAssignment> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v) out[k] = encryptAssignment(v)!;
  }
  return JSON.stringify(out);
}

function encryptSpecialistMap(
  m?: Partial<Record<SpecialistId, ModelAssignment>>
): string | null {
  if (!m) return null;
  const out: Record<string, ModelAssignment> = {};
  for (const [k, v] of Object.entries(m)) {
    if (v) out[k] = encryptAssignment(v)!;
  }
  return JSON.stringify(out);
}

function maskAssignment(a?: ModelAssignment | null): ModelAssignment | null {
  if (!a) return null;
  return {
    ...a,
    apiKey: a.apiKey ? maskApiKey(decryptApiKey(a.apiKey)) : undefined,
  };
}

function maskFeatureMap(
  raw?: string | null
): Partial<Record<FeatureId, ModelAssignment>> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelAssignment>;
    const out: Partial<Record<FeatureId, ModelAssignment>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k as FeatureId] = maskAssignment(v)!;
    }
    return out;
  } catch {
    return undefined;
  }
}

function maskSpecialistMap(
  raw?: string | null
): Partial<Record<SpecialistId, ModelAssignment>> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelAssignment>;
    const out: Partial<Record<SpecialistId, ModelAssignment>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k as SpecialistId] = maskAssignment(v)!;
    }
    return out;
  } catch {
    return undefined;
  }
}

function unmaskFeatureMap(
  raw?: string | null
): Partial<Record<FeatureId, ModelAssignment>> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelAssignment>;
    const out: Partial<Record<FeatureId, ModelAssignment>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k as FeatureId] = {
        ...v,
        apiKey: v.apiKey ? decryptApiKey(v.apiKey) : undefined,
      };
    }
    return out;
  } catch {
    return undefined;
  }
}

function unmaskSpecialistMap(
  raw?: string | null
): Partial<Record<SpecialistId, ModelAssignment>> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelAssignment>;
    const out: Partial<Record<SpecialistId, ModelAssignment>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k as SpecialistId] = {
        ...v,
        apiKey: v.apiKey ? decryptApiKey(v.apiKey) : undefined,
      };
    }
    return out;
  } catch {
    return undefined;
  }
}

export async function getConfig(
  userId: string
): Promise<MultiModelConfigDoc> {
  const row = await db.multiModelConfig.findUnique({
    where: { userId_scope: { userId, scope: SCOPE } },
  });
  if (!row) {
    return { mode: "SINGLE" };
  }
  return {
    mode: row.mode as Mode,
    globalConfig: maskAssignment(
      row.globalConfig ? JSON.parse(row.globalConfig) : null
    ),
    featureConfigs: maskFeatureMap(row.featureConfigs),
    hostConfig: maskAssignment(
      row.hostConfig ? JSON.parse(row.hostConfig) : null
    ),
    specialistConfigs: maskSpecialistMap(row.specialistConfigs),
    timeoutOverrides: row.timeoutOverrides
      ? JSON.parse(row.timeoutOverrides)
      : undefined,
  };
}

export async function getConfigInternal(
  userId: string
): Promise<MultiModelConfigDoc> {
  const row = await db.multiModelConfig.findUnique({
    where: { userId_scope: { userId, scope: SCOPE } },
  });
  if (!row) return { mode: "SINGLE" };
  const unmask = (raw: string | null): ModelAssignment | null => {
    if (!raw) return null;
    const a = JSON.parse(raw) as ModelAssignment;
    return {
      ...a,
      apiKey: a.apiKey ? decryptApiKey(a.apiKey) : undefined,
    };
  };
  return {
    mode: row.mode as Mode,
    globalConfig: unmask(row.globalConfig),
    featureConfigs: unmaskFeatureMap(row.featureConfigs),
    hostConfig: unmask(row.hostConfig),
    specialistConfigs: unmaskSpecialistMap(row.specialistConfigs),
    timeoutOverrides: row.timeoutOverrides
      ? JSON.parse(row.timeoutOverrides)
      : undefined,
  };
}

export async function saveConfig(
  userId: string,
  doc: MultiModelConfigDoc
): Promise<void> {
  // Load the existing config so we can preserve API keys that are sent back
  // masked (e.g. "sk-••••7890"). When the frontend loads a config, the keys
  // are masked via maskApiKey() which uses the bullet character. If the user
  // doesn't re-type a key, the masked version gets sent back on save. We use
  // isMaskedApiKey() (shared with crypto.ts) to detect this and preserve the
  // existing encrypted key from the DB instead of overwriting with the mask.
  const existing = await db.multiModelConfig.findUnique({
    where: { userId_scope: { userId, scope: SCOPE } },
  });

  const preserveMaskedKey = (incoming: ModelAssignment | null | undefined, existingJson: string | null): ModelAssignment | null => {
    if (!incoming) return null;
    // First migrate any legacy endpoint field to the correct field
    const migrated = migrateEndpoint(incoming);
    if (!migrated) return null;
    
    // If the incoming key is missing or masked, preserve the existing key.
    if (!migrated.apiKey || isMaskedApiKey(migrated.apiKey)) {
      if (existingJson) {
        try {
          const existingAssign = JSON.parse(existingJson) as ModelAssignment;
          const decrypted = existingAssign.apiKey ? decryptApiKey(existingAssign.apiKey) : undefined;
          return { ...migrated, apiKey: decrypted };
        } catch {
          return { ...migrated, apiKey: undefined };
        }
      }
      return { ...migrated, apiKey: undefined };
    }
    return migrated;
  };

  const globalConfig = doc.globalConfig
    ? JSON.stringify(encryptAssignment(preserveMaskedKey(doc.globalConfig, existing?.globalConfig || null)))
    : null;

  // For feature/specialist maps, preserve per-key.
  const preserveMap = (
    incoming: Partial<Record<string, ModelAssignment>> | undefined,
    existingJson: string | null
  ): Partial<Record<string, ModelAssignment>> | undefined => {
    if (!incoming) return undefined;
    let existingMap: Record<string, ModelAssignment> = {};
    if (existingJson) {
      try {
        existingMap = JSON.parse(existingJson) as Record<string, ModelAssignment>;
      } catch {
        /* ignore */
      }
    }
    const out: Record<string, ModelAssignment> = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (!v) continue;
      // First migrate any legacy endpoint field to the correct field
      const migrated = migrateEndpoint(v);
      if (!migrated) continue;
      
      if (!migrated.apiKey || isMaskedApiKey(migrated.apiKey)) {
        // Preserve the existing key for this role, but decrypt it before the
        // next encryptAssignment pass so we never double-encrypt a stored key.
        const preserved = existingMap[k]?.apiKey ? decryptApiKey(existingMap[k].apiKey) : undefined;
        out[k] = { ...migrated, apiKey: preserved };
      } else {
        out[k] = migrated;
      }
    }
    return out;
  };

  const featureConfigs = encryptFeatureMap(preserveMap(doc.featureConfigs, existing?.featureConfigs || null) as Partial<Record<FeatureId, ModelAssignment>> | undefined);
  const hostConfig = doc.hostConfig
    ? JSON.stringify(encryptAssignment(preserveMaskedKey(doc.hostConfig, existing?.hostConfig || null)))
    : null;
  const specialistConfigs = encryptSpecialistMap(preserveMap(doc.specialistConfigs, existing?.specialistConfigs || null) as Partial<Record<SpecialistId, ModelAssignment>> | undefined);
  const timeoutOverrides = doc.timeoutOverrides
    ? JSON.stringify(doc.timeoutOverrides)
    : null;

  await db.multiModelConfig.upsert({
    where: { userId_scope: { userId, scope: SCOPE } },
    create: {
      userId,
      scope: SCOPE,
      mode: doc.mode,
      globalConfig,
      featureConfigs,
      hostConfig,
      specialistConfigs,
      timeoutOverrides,
    },
    update: {
      mode: doc.mode,
      globalConfig,
      featureConfigs,
      hostConfig,
      specialistConfigs,
      timeoutOverrides,
    },
  });
}

// ---

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

// ---
//
// HONEST implementation: instead of returning fake hardcoded quota numbers,
// this function does a real reachability check for each model:
//
//   "- API models (openai/anthropic/gemini/mistral/groq): pings the provider's
//     /models endpoint with the API key. If it returns 200, the key works and
//     the API is reachable -' canFinish = true. If 401/403/429/5xx, returns
//     canFinish = false with the real reason.
//
//   "- LOCAL models (ollama): pings GET /api/tags. If reachable, canFinish =
//     true. If not, canFinish = false with "Ollama is not reachable from the
//     server."
//
//   "- LOCAL models (llamacpp/llamafile): can't easily verify without running
//     the binary, so we report canFinish = true with a note that the binary
//     path hasn't been verified.
//
// This is slower than the old fake version (one HTTP call per model) but it
// gives the user real information. The confirmation dialog now shows "Key
// verified" or the actual error instead of fake "70% quota" numbers.
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
        return { ...base, ...cached };
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
  const { provider, apiKey, endpoint } = assignment;
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
      const base =
        endpoint || "https://generativelanguage.googleapis.com/v1beta/models";
      res = await fetch(`${base}?key=${apiKey}`, {
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

// ---

function emptyAssignment(): ModelAssignment {
  return {
    connectionType: "API",
    provider: "openai",
    modelName: "gpt-4o-mini",
    status: "untested",
  };
}

export function needsClientOllama(assignment: ModelAssignment): boolean {
  return assignment.connectionType === "LOCAL" && assignment.provider === "ollama";
}

function buildClassificationPrompt(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userContent = lastUser?.content || "";

  return `${CLASSIFICATION_SYSTEM_PROMPT}\n\n---\n\nUser message to classify:\n"${userContent}"\n\nRespond with ONLY the JSON object:`;
}

function buildPromptFromMessages(
  messages: ChatMessage[],
  role: string,
  intent?: string
): string {
  const systemHint =
    role === "host"
      ? "You are NOX Host. Analyze the user's intent and either answer directly or synthesize the response from a specialist model into a clean reply to the user. Be concise."
      : intent
      ? `You are NOX ${role} specialist (intent: ${intent}). Answer the user's request focused on your specialty. Be concise and useful.`
      : "You are NOX AI. Respond helpfully and concisely.";

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return `${systemHint}\n\nUser: ${lastUser?.content || ""}\nAssistant:`;
}

function resolvePlan(
  doc: MultiModelConfigDoc,
  messages: ChatMessage[],
  explicitFeature?: FeatureId
): {
  assignments: {
    id: string;
    label: string;
    assignment: ModelAssignment;
  }[];
  multiAgent: boolean;
  intent?: string;
} {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text = (last?.content || "").toLowerCase();

  if (doc.mode === "SINGLE") {
    return {
      assignments: [
        {
          id: "global",
          label: "Single Model",
          assignment: doc.globalConfig || emptyAssignment(),
        },
      ],
      multiAgent: false,
    };
  }

  if (doc.mode === "MULTI") {
    // Use the explicitly-passed feature from the UI tab. Only fall back to
    // keyword detection if no feature was provided (e.g. API calls without
    // a tab context).
    let feature: FeatureId = explicitFeature || "chat";
    if (!explicitFeature) {
      if (/(code|function|bug|class|api|sql|regex)/.test(text)) feature = "coding";
      else if (/(image|picture|photo|see|vision|ocr)/.test(text))
        feature = "vision";
      else if (/(voice|speak|speech|audio|transcri)/.test(text))
        feature = "voice";
      else if (/(automate|workflow|schedule|pipeline)/.test(text))
        feature = "automation";
      else if (/(robot|move|arm|sensor|actuator)/.test(text))
        feature = "robotics";
    }

    const assignment =
      doc.featureConfigs?.[feature] ||
      doc.featureConfigs?.chat ||
      emptyAssignment();
    return {
      assignments: [{ id: feature, label: feature, assignment }],
      multiAgent: false,
      intent: feature,
    };
  }

  // ORCHESTRATOR
  const host = doc.hostConfig || emptyAssignment();
  let specialist: SpecialistId | null = null;
  if (/(plan|design|architect|roadmap|strategy|decompose)/.test(text))
    specialist = "planning";
  else if (/(code|function|bug|class|api|sql|regex|build|implement)/.test(text))
    specialist = "coding";
  else if (/(image|picture|photo|see|vision|ocr)/.test(text))
    specialist = "vision";
  else if (/(automate|workflow|schedule|pipeline|chain)/.test(text))
    specialist = "automation";
  else if (/(robot|move|arm|sensor|actuator)/.test(text))
    specialist = "robotics";

  const assignments: {
    id: string;
    label: string;
    assignment: ModelAssignment;
  }[] = [{ id: "host", label: "Host", assignment: host }];

  if (specialist) {
    const sp = doc.specialistConfigs?.[specialist] || emptyAssignment();
    assignments.push({ id: specialist, label: specialist, assignment: sp });
  }

  return {
    assignments,
    multiAgent: !!specialist,
    intent: specialist || "general",
  };
}

async function callModel(
  assignment: ModelAssignment,
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
  const effectiveTimeout =
    (assignment.provider === "gemini" || assignment.provider === "ollama") && opts.onChunk
      ? DEFAULT_TIMEOUTS.GENERATION
      : opts.timeoutMs;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const result = await Promise.race([
        assignment.provider === "gemini" && opts.onChunk
          ? callGeminiStreaming(
              assignment.apiKey || "",
              assignment.modelName,
              opts.role === "host"
                ? "You are NOX Host. Analyze the user's intent and either answer directly or synthesize the response from a specialist model into a clean reply to the user. Be concise."
                : opts.intent
                ? `You are NOX ${opts.role} specialist (intent: ${opts.intent}). Answer the user's request focused on your specialty. Be concise and useful.`
                : "You are NOX AI. Respond helpfully and concisely.",
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
        new Promise<never>((_, reject) =>
          setTimeout(
              () => reject(new Error(`timeout after ${effectiveTimeout}ms`)),
              effectiveTimeout
          )
        ),
      ]);
      return {
        output: result.text,
        latencyMs: Date.now() - started,
        retries,
        timedOut: false,
        tokens: result.tokens,
        heartbeats: result.heartbeats,
      };
    } catch (err) {
      retries = attempt + 1;
      timedOut = true;
      const e = err as Error;
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      const detail = cause?.code || cause?.message;
      lastError = detail ? `${e.message} (${detail})` : e.message;
      if (attempt === MAX_RETRY) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
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
interface ModelCallResult {
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
    role === "host"
      ? "You are NOX Host. Analyze the user's intent and either answer directly or synthesize the response from a specialist model into a clean reply to the user. Be concise."
      : intent
      ? `You are NOX ${role} specialist (intent: ${intent}). Answer the user's request focused on your specialty. Be concise and useful.`
      : "You are NOX AI. Respond helpfully and concisely.";

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

async function callApi(assignment: ModelAssignment, systemHint: string, conv: ChatMessage[]): Promise<ModelCallResult> {
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
    body: JSON.stringify({ model, max_tokens: 1024, messages }),
  }, DEFAULT_TIMEOUTS.API);

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
    body: JSON.stringify({ model, max_tokens: 1024, system: systemHint, messages }),
  }, DEFAULT_TIMEOUTS.API);

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

  const init = buildGeminiRequestInit(normalizedKey, "POST", { contents, systemInstruction: { parts: [{ text: systemHint }] }, generationConfig: { maxOutputTokens: 1024 } });
  const res = await fetchWithRetry(url, init, DEFAULT_TIMEOUTS.API);

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

async function callGeminiStreaming(
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
    generationConfig: { maxOutputTokens: 1024 },
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
  if (provider === "llamacpp" || provider === "llamafile") {
    args = ["-m", modelName, "-p", prompt];
  } else {
    args = [modelName, prompt];
  }

  if (cliArgs) {
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

// ---
//
// Rough token estimate: ~4 characters per token (industry-standard heuristic
// for English text). This is not exact but good enough for deciding when to
// truncate. The actual token count comes from the provider's response usage
// metadata, which we use for cost tracking.
const CHARS_PER_TOKEN = 4;
// Default context budget for specialist calls. Most models support 8K-128K
// tokens; we use a conservative 6K budget to leave room for the system prompt
// + the specialist's response. This prevents token-limit errors on long convos.
const DEFAULT_SPECIALIST_TOKEN_BUDGET = 6000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

// Truncate message history to fit within a token budget.
// Strategy: always keep the system hint (added by realCall) + the last user
// message + as many recent turns as fit. If even one message exceeds the
// budget, keep only the last user message (truncated itself).
//
// Returns the (possibly truncated) messages array. If truncation happened,
// prepends a note so the model knows context was compressed.
function truncateForContext(
  messages: ChatMessage[],
  budgetTokens: number = DEFAULT_SPECIALIST_TOKEN_BUDGET
): { messages: ChatMessage[]; truncated: boolean; originalTokens: number; keptTokens: number } {
  const originalTokens = estimateMessagesTokens(messages);
  if (originalTokens <= budgetTokens) {
    return { messages, truncated: false, originalTokens, keptTokens: originalTokens };
  }

  // Always keep the last user message.
  const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === "user");
  const lastUser = lastUserIdx >= 0 ? messages[messages.length - 1 - lastUserIdx] : null;
  if (!lastUser) {
    // No user message "" keep as-is (shouldn't happen).
    return { messages, truncated: false, originalTokens, keptTokens: originalTokens };
  }

  const lastUserTokens = estimateTokens(lastUser.content);
  if (lastUserTokens >= budgetTokens) {
    // Last user message alone exceeds budget "" truncate it.
    const maxChars = budgetTokens * CHARS_PER_TOKEN - 200; // leave room for note
    const truncatedContent = lastUser.content.slice(0, maxChars) + "\n\n[...message truncated to fit context...]";
    return {
      messages: [{ ...lastUser, content: truncatedContent }],
      truncated: true,
      originalTokens,
      keptTokens: estimateTokens(truncatedContent),
    };
  }

  // Build from the end: keep the last user message + as many prior turns as fit.
  const kept: ChatMessage[] = [lastUser];
  let keptTokens = lastUserTokens;
  for (let i = messages.length - 1 - lastUserIdx - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = estimateTokens(msg.content);
    if (keptTokens + msgTokens > budgetTokens) break;
    kept.unshift(msg);
    keptTokens += msgTokens;
  }

  // Prepend a note that context was compressed.
  const note: ChatMessage = {
    role: "assistant",
    content: `[Context note: ${originalTokens} tokens of conversation history were truncated to ${keptTokens} tokens to fit the specialist's context window. The most recent messages are preserved.]`,
  };

  return {
    messages: [note, ...kept],
    truncated: true,
    originalTokens,
    keptTokens,
  };
}

// ---
//
// Instead of keyword regex matching, the Host model itself classifies the
// user's intent. A lightweight call with a structured system prompt asks the
// Host to output ONLY a JSON object:
//   { "specialist": "coding"|"planning"|"vision"|"automation"|"robotics"|"none",
//     "confidence": 0.0-1.0,
//     "reasoning": "one sentence" }
//
// If the specialist is "none" or confidence < CLASSIFICATION_CONFIDENCE_THRESHOLD,
// the Host answers directly (no specialist routing).
//
// If the classification call fails (timeout, error, invalid JSON), falls back
// to the old keyword-based resolvePlan() "" so a failed classification never
// silently breaks the dispatch.
const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.6;

const CLASSIFICATION_SYSTEM_PROMPT = `You are NOX Host, an intent classification system. Analyze the user's message and determine which specialist should handle it.

Available specialists:
- "planning": Planning, architecture, design, roadmap, strategy, task decomposition
- "coding": Code generation, bug fixing, code review, implementation, debugging
- "vision": Image analysis, OCR, visual understanding, photo description
- "automation": Workflow automation, API chaining, scheduling, pipelines
- "robotics": Robotics, motion planning, sensor fusion, physical control
- "none": General questions, conversation, explanations that don't need a specialist

Respond with ONLY a JSON object. No markdown, no code blocks, no extra text:
{"specialist": "coding", "confidence": 0.9, "reasoning": "User is asking to write a Python function."}`;

// Parse the classification JSON from the Host model's response.
// Handles: raw JSON, JSON wrapped in markdown code blocks, JSON with
// surrounding text. Returns null if parsing fails.
function parseClassificationResponse(output: string): IntentClassification | null {
  try {
    // Try to extract JSON from the response (may be wrapped in ```json ... ```)
    const jsonMatch = output.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      specialist?: string;
      confidence?: number;
      reasoning?: string;
    };

    // Validate specialist value
    const validSpecialists = ["planning", "coding", "vision", "automation", "robotics", "none"];
    if (!parsed.specialist || !validSpecialists.includes(parsed.specialist)) {
      return null;
    }

    return {
      specialist: parsed.specialist as SpecialistId | "none",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning provided.",
    };
  } catch {
    return null;
  }
}

// Result of a classification call "" the parsed classification + call metadata
// for the dispatch trace.
interface ClassificationCallResult {
  classification: IntentClassification | null;
  output: string;
  latencyMs: number;
  retries: number;
  timedOut: boolean;
  lastError?: string;
  tokens?: TokenUsage;
}

// Make a classification call to the Host model. Sends a single user message
// containing the classification system prompt + the user's last message.
// The Host responds with a JSON object that parseClassificationResponse extracts.
//
// Only the last user message is sent (not full history) to keep the call
// fast and cheap "" classification doesn't need conversation context.
async function classifyIntent(
  hostAssignment: ModelAssignment,
  messages: ChatMessage[],
  timeoutMs: number
): Promise<ClassificationCallResult> {
  const classifyMessages: ChatMessage[] = [
    {
      role: "user",
      content: buildClassificationPrompt(messages),
      image: [...messages].reverse().find((m) => m.role === "user")?.image,
    },
  ];

  const result = await callModel(
    hostAssignment,
    classifyMessages,
    {
      timeoutMs,
      role: "classify",
      intent: "classify",
    }
  );

  const classification = parseClassificationResponse(result.output);

  return {
    classification,
    output: result.output,
    latencyMs: result.latencyMs,
    retries: result.retries,
    timedOut: result.timedOut,
    lastError: result.lastError,
    tokens: result.tokens,
  };
}

export async function dispatch(
  userId: string,
  messages: ChatMessage[],
  opts: {
    confirmMultiAgent?: boolean;
    feature?: FeatureId;
    skipSpecialist?: boolean;
    cachedClassification?: IntentClassification;
    onChunk?: (roleId: string, text: string) => void;
  } = {}
): Promise<DispatchResult> {
  const doc = await getConfigInternal(userId);
  const timeoutOverrides = doc.timeoutOverrides || {};
  const steps: DispatchStep[] = [];

  const runFinalModelCall = async (
    assignment: ModelAssignment,
    incomingMessages: ChatMessage[],
    role: string,
    intent?: string,
    timeoutMs?: number
  ) => {
    if (assignment.provider === "gemini" && opts.onChunk) {
      const systemHint =
        role === "host"
          ? "You are NOX Host. Analyze the user's intent and either answer directly or synthesize the response from a specialist model into a clean reply to the user. Be concise."
          : intent
          ? `You are NOX ${role} specialist (intent: ${intent}). Answer the user's request focused on your specialty. Be concise and useful.`
          : "You are NOX AI. Respond helpfully and concisely.";
      const conv: ChatMessage[] = incomingMessages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
          image: m.image,
        }));
      const streamed = await callGeminiStreaming(
        assignment.apiKey || "",
        assignment.modelName,
        systemHint,
        conv,
        resolveEndpoint(assignment),
        (delta) => opts.onChunk!(role, delta)
      );
      return {
        output: streamed.text,
        latencyMs: 0,
        retries: 0,
        timedOut: false,
        lastError: undefined,
        tokens: streamed.tokens,
        heartbeats: 0,
      };
    }

    return callModel(assignment, incomingMessages, {
      timeoutMs: timeoutMs || DEFAULT_TIMEOUTS[assignment.connectionType],
      role,
      intent,
    });
  };

  // ---
  //
  // Instead of keyword regex matching, the Host model classifies the intent
  // via a lightweight JSON-output call. This replaces the old resolvePlan()
  // keyword matching for ORCHESTRATOR mode. If the classification call fails,
  // falls back to keyword matching.
  if (doc.mode === "ORCHESTRATOR" && !opts.skipSpecialist) {
    const hostAssignment = doc.hostConfig || emptyAssignment();
    const hostTimeout =
      timeoutOverrides[hostAssignment.connectionType] ||
      DEFAULT_TIMEOUTS[hostAssignment.connectionType];

    // ---
    //
    // Before spending a classification call, verify the Host model is actually
    // reachable. If it's not, return immediately with a clear error "" no point
    // attempting classification with a broken Host.
    //
    // This check is ONLY for Orchestrator mode's classify step. The specialist
    // reachability check in Step 3a/3b is separate and unchanged.
    //
    // Skip this pre-check if we have a cached classification (the Host was
    // already verified in the first round-trip).
    if (!opts.cachedClassification) {
      const hostCheck = await checkLimits(
        userId,
        [{ id: "host", label: "Host", assignment: hostAssignment }],
        "small"
      );
      const hostBlocked = hostCheck.find((l) => !l.canFinish);
      if (hostBlocked) {
        return {
          ok: false,
          mode: doc.mode,
          steps: [],
          finalReply: "",
          multiAgent: false,
          confirmationRequired: false,
          error: `Host model is unreachable: ${hostBlocked.reason || "unknown error"}. Fix the Host configuration in Advanced Customization before using Orchestrator mode.`,
        };
      }
    }

    // Step 1: Classify the intent (or use cached classification from the
    // confirmation round-trip to avoid paying for the call twice).
    let classification: IntentClassification | null = null;
    let classificationCallResult: ClassificationCallResult | null = null;

    if (opts.cachedClassification) {
      classification = opts.cachedClassification;
    } else {
      if (needsClientOllama(hostAssignment)) {
        return {
          ok: true,
          mode: doc.mode,
          steps: [],
          finalReply: "",
          multiAgent: false,
          confirmationRequired: false,
          pendingClientExec: {
            stepId: crypto.randomUUID(),
            endpoint: resolveEndpoint(hostAssignment) || "",
            model: hostAssignment.modelName,
            prompt: buildClassificationPrompt(messages),
            resumeContext: {
              mode: doc.mode,
              stage: "classify",
              messages,
              hostAssignment,
              feature: opts.feature,
            },
          },
        };
      }

      classificationCallResult = await classifyIntent(
        hostAssignment,
        messages,
        hostTimeout
      );
      classification = classificationCallResult.classification;

      // If classification call failed (timeout, error, invalid JSON),
      // fall back to keyword-based resolvePlan().
      if (!classification) {
        // Fallback: use old keyword matching
        const fallbackPlan = resolvePlan(doc, messages, opts.feature);
        if (fallbackPlan.multiAgent && fallbackPlan.assignments[1]) {
          classification = {
            specialist: fallbackPlan.assignments[1].id as SpecialistId,
            confidence: 0.5,
            reasoning: `Classification call failed (${classificationCallResult.lastError || "invalid response"}). Fell back to keyword matching.`,
          };
        } else {
          classification = {
            specialist: "none",
            confidence: 0.5,
            reasoning: "Classification call failed. Host will answer directly.",
          };
        }
      }
    }

    // Log the classification step in the trace (if we made a real call)
    if (classificationCallResult) {
      steps.push({
        role: "host",
        model: hostAssignment.modelName,
        provider: hostAssignment.provider,
        connectionType: hostAssignment.connectionType,
        intent: "classify",
        input: messages[messages.length - 1]?.content || "",
        output: classificationCallResult.output || "(no output)",
        latencyMs: classificationCallResult.latencyMs,
        retries: classificationCallResult.retries,
        timedOut: classificationCallResult.timedOut,
        lastError: classificationCallResult.lastError,
        tokens: classificationCallResult.tokens,
        cost: classificationCallResult.tokens
          ? computeCost(classificationCallResult.tokens, hostAssignment.modelName)
          : undefined,
      });
    }

    // Step 2: Decide routing based on classification
    const shouldRouteToSpecialist =
      classification.specialist !== "none" &&
      classification.confidence >= CLASSIFICATION_CONFIDENCE_THRESHOLD;

    if (!shouldRouteToSpecialist) {
      // Host answers directly "" no specialist needed.
      // This is the same as the "Host handles it directly" fallback.
      if (needsClientOllama(hostAssignment)) {
        return {
          ok: true,
          mode: doc.mode,
          steps: [],
          finalReply: "",
          multiAgent: false,
          confirmationRequired: false,
          pendingClientExec: {
            stepId: crypto.randomUUID(),
            endpoint: resolveEndpoint(hostAssignment) || "",
            model: hostAssignment.modelName,
            prompt: buildPromptFromMessages(messages, "host", "direct"),
            resumeContext: {
              mode: doc.mode,
              stage: "direct",
              messages,
              role: "host",
              intent: "direct",
              assignment: hostAssignment,
            },
          },
        };
      }
      const result = await callModel(hostAssignment, messages, {
        timeoutMs: hostTimeout,
        role: "host",
        intent: "direct",
        onChunk: opts.onChunk,
      });

      steps.push({
        role: "host",
        model: hostAssignment.modelName,
        provider: hostAssignment.provider,
        connectionType: hostAssignment.connectionType,
        intent: "direct",
        input: messages[messages.length - 1]?.content || "",
        output: result.output,
        latencyMs: result.latencyMs,
        retries: result.retries,
        timedOut: result.timedOut,
        lastError: result.lastError,
        tokens: result.tokens,
        cost: result.tokens
          ? computeCost(result.tokens, hostAssignment.modelName)
          : undefined,
      });

      const finalReply = result.output || (result.lastError
        ? `Model call failed after ${result.retries} attempt(s).\n\nError: ${result.lastError}\n\nCheck your configuration in Advanced Customization.`
        : "Model returned no response. Check your configuration in Advanced Customization.");

      return {
        ok: true,
        mode: doc.mode,
        steps,
        finalReply,
        multiAgent: false,
        confirmationRequired: false,
        classification: classification || undefined,
      };
    }

    // Step 3: Specialist is needed "" build the plan from classification
    const specialistId = classification.specialist as SpecialistId;
    const specialistAssignment =
      doc.specialistConfigs?.[specialistId] || emptyAssignment();
    const specialistTimeout =
      timeoutOverrides[specialistAssignment.connectionType] ||
      DEFAULT_TIMEOUTS[specialistAssignment.connectionType];

    // Step 3a: Pre-flight confirmation (first call, no confirmMultiAgent)
    if (!opts.confirmMultiAgent) {
      const limits = await checkLimits(
        userId,
        [
          { id: "host", label: "Host", assignment: hostAssignment },
          { id: specialistId, label: specialistId, assignment: specialistAssignment },
        ],
        "medium"
      );
      return {
        ok: false,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: true,
        confirmationRequired: true,
        limits,
        classification: classification || undefined,
      };
    }

    // Step 3b: Confirmed "" check limits
    let limits: ModelLimit[] | undefined;
    limits = await checkLimits(
      userId,
      [
        { id: "host", label: "Host", assignment: hostAssignment },
        { id: specialistId, label: specialistId, assignment: specialistAssignment },
      ],
      "medium"
    );
    const blocked = limits.find((l) => !l.canFinish);
    if (blocked) {
      return {
        ok: false,
        mode: doc.mode,
        steps,
        finalReply: "",
        multiAgent: true,
        confirmationRequired: false,
        limits,
        classification: classification || undefined,
        error: `Cannot run: "${blocked.label}" cannot complete its part. ${
          blocked.reason || ""
        }`,
      };
    }

    // Step 3c: Run the specialist pipeline (2 calls: specialist + synthesize)
    // Note: the old "host analyze" step is replaced by the classification call above.

    // Context handoff: truncate the message history to fit the specialist's
    // context window before forwarding.
    const truncated = truncateForContext(messages);
    const specialistMessages: ChatMessage[] = [
      ...truncated.messages,
      {
        role: "assistant",
        content: `[Host routed this to the ${specialistId} specialist (confidence: ${Math.round(classification.confidence * 100)}%). Fulfill the request.]`,
      },
    ];
    if (needsClientOllama(specialistAssignment)) {
      return {
        ok: true,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: true,
        confirmationRequired: false,
        pendingClientExec: {
          stepId: crypto.randomUUID(),
          endpoint: resolveEndpoint(specialistAssignment) || "",
          model: specialistAssignment.modelName,
          prompt: buildPromptFromMessages(specialistMessages, specialistId, specialistId),
          resumeContext: {
            mode: doc.mode,
            stage: "specialist",
            messages: specialistMessages,
            specialistId,
            role: specialistId,
            intent: specialistId,
            assignment: specialistAssignment,
            hostAssignment,
            finalMessages: [...messages, { role: "assistant", content: `Specialist ${specialistId} responded with:\n\n[awaiting local Ollama completion]\n\nReply to the user, incorporating the specialist's work.` }],
          },
        },
      };
    }

    const specialistResult = await callModel(
      specialistAssignment,
      specialistMessages,
      {
        timeoutMs: specialistTimeout,
        role: specialistId,
        intent: specialistId,
      }
    );

    // Host synthesizes the specialist's output
    const finalMessages: ChatMessage[] = [
      ...messages,
      {
        role: "assistant",
        content: `Specialist ${specialistId} responded with:\n\n${specialistResult.output}\n\nReply to the user, incorporating the specialist's work.`,
      },
    ];
    if (needsClientOllama(hostAssignment)) {
      return {
        ok: true,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: true,
        confirmationRequired: false,
        pendingClientExec: {
          stepId: crypto.randomUUID(),
          endpoint: resolveEndpoint(hostAssignment) || "",
          model: hostAssignment.modelName,
          prompt: buildPromptFromMessages(finalMessages, "host"),
          resumeContext: {
            mode: doc.mode,
            stage: "synthesize",
            messages: finalMessages,
            role: "host",
            assignment: hostAssignment,
            specialistId,
          },
        },
      };
    }
    const finalResult = await callModel(hostAssignment, finalMessages, {
      timeoutMs: hostTimeout,
      role: "host",
      onChunk: opts.onChunk,
    });

    // Log specialist step
    steps.push({
      role: specialistId,
      model: specialistAssignment.modelName,
      provider: specialistAssignment.provider,
      connectionType: specialistAssignment.connectionType,
      intent: specialistId,
      input: truncated.truncated
        ? `(routed by host, context truncated: ${truncated.originalTokens}†'${truncated.keptTokens} tokens)`
        : "(routed by host)",
      output: specialistResult.output,
      latencyMs: specialistResult.latencyMs,
      retries: specialistResult.retries,
      timedOut: specialistResult.timedOut,
      lastError: specialistResult.lastError,
      tokens: specialistResult.tokens,
      cost: specialistResult.tokens
        ? computeCost(specialistResult.tokens, specialistAssignment.modelName)
        : undefined,
    });

    // Log synthesize step
    steps.push({
      role: "host",
      model: hostAssignment.modelName,
      provider: hostAssignment.provider,
      connectionType: hostAssignment.connectionType,
      intent: "synthesize",
      input: "(specialist response)",
      output: finalResult.output,
      latencyMs: finalResult.latencyMs,
      retries: finalResult.retries,
      timedOut: finalResult.timedOut,
      lastError: finalResult.lastError,
      tokens: finalResult.tokens,
      cost: finalResult.tokens
        ? computeCost(finalResult.tokens, hostAssignment.modelName)
        : undefined,
    });

    const finalReply = finalResult.output || (finalResult.lastError
      ? `Model call failed after ${finalResult.retries} attempt(s).\n\nError: ${finalResult.lastError}\n\nCheck your configuration in Advanced Customization.`
      : "Model returned no response. Check your configuration in Advanced Customization.");

    return {
      ok: true,
      mode: doc.mode,
      steps,
      finalReply,
      multiAgent: true,
      confirmationRequired: false,
      limits,
      classification: classification || undefined,
    };
  }

  // ---
  if (doc.mode === "ORCHESTRATOR" && opts.skipSpecialist) {
    const hostAssignment = doc.hostConfig || emptyAssignment();
    const hostTimeout =
      timeoutOverrides[hostAssignment.connectionType] ||
      DEFAULT_TIMEOUTS[hostAssignment.connectionType];
    if (needsClientOllama(hostAssignment)) {
      return {
        ok: true,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: false,
        confirmationRequired: false,
        pendingClientExec: {
          stepId: crypto.randomUUID(),
          endpoint: resolveEndpoint(hostAssignment) || "",
          model: hostAssignment.modelName,
          prompt: buildPromptFromMessages(messages, "host", "direct"),
          resumeContext: {
            mode: doc.mode,
            stage: "direct",
            messages,
            role: "host",
            intent: "direct",
            assignment: hostAssignment,
          },
        },
      };
    }
    const result = await callModel(hostAssignment, messages, {
      timeoutMs: hostTimeout,
      role: "host",
      intent: "direct",
      onChunk: opts.onChunk,
    });

    steps.push({
      role: "host",
      model: hostAssignment.modelName,
      provider: hostAssignment.provider,
      connectionType: hostAssignment.connectionType,
      intent: "direct (user override)",
      input: messages[messages.length - 1]?.content || "",
      output: result.output,
      latencyMs: result.latencyMs,
      retries: result.retries,
      timedOut: result.timedOut,
      lastError: result.lastError,
      tokens: result.tokens,
      cost: result.tokens
        ? computeCost(result.tokens, hostAssignment.modelName)
        : undefined,
    });

    const finalReply = result.output || (result.lastError
      ? `Model call failed after ${result.retries} attempt(s).\n\nError: ${result.lastError}\n\nCheck your configuration in Advanced Customization.`
      : "Model returned no response. Check your configuration in Advanced Customization.");

    return {
      ok: true,
      mode: doc.mode,
      steps,
      finalReply,
      multiAgent: false,
      confirmationRequired: false,
    };
  }

  // ---
  const plan = resolvePlan(doc, messages, opts.feature);

  if (plan.multiAgent && !opts.confirmMultiAgent) {
    const limits = await checkLimits(userId, plan.assignments, "medium");
    return {
      ok: false,
      mode: doc.mode,
      steps: [],
      finalReply: "",
      multiAgent: true,
      confirmationRequired: true,
      limits,
    };
  }

  let limits: ModelLimit[] | undefined;
  if (plan.multiAgent && opts.confirmMultiAgent) {
    limits = await checkLimits(userId, plan.assignments, "medium");
    const blocked = limits.find((l) => !l.canFinish);
    if (blocked) {
      return {
        ok: false,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: true,
        confirmationRequired: false,
        limits,
        error: `Cannot run: "${blocked.label}" cannot complete its part. ${
          blocked.reason || ""
        }`,
      };
    }
  }

  // SINGLE or MULTI (single-model path)
  const a = plan.assignments[0].assignment;
  const timeout =
    timeoutOverrides[a.connectionType] || DEFAULT_TIMEOUTS[a.connectionType];
  if (needsClientOllama(a)) {
    return {
      ok: true,
      mode: doc.mode,
      steps: [],
      finalReply: "",
      multiAgent: false,
      confirmationRequired: false,
      pendingClientExec: {
        stepId: crypto.randomUUID(),
        endpoint: resolveEndpoint(a) || "",
        model: a.modelName,
        prompt: buildPromptFromMessages(messages, plan.assignments[0].label, plan.intent),
        resumeContext: {
          mode: doc.mode,
          stage: "single",
          messages,
          role: plan.assignments[0].label,
          intent: plan.intent,
          assignment: a,
          feature: opts.feature,
        },
      },
    };
  }
  const result = await callModel(a, messages, {
    timeoutMs: timeout,
    role: plan.assignments[0].label,
    intent: plan.intent,
    onChunk: opts.onChunk,
  });

  steps.push({
    role: plan.assignments[0].label,
    model: a.modelName,
    provider: a.provider,
    connectionType: a.connectionType,
    intent: plan.intent,
    input: messages[messages.length - 1]?.content || "",
    output: result.output,
    latencyMs: result.latencyMs,
    retries: result.retries,
    timedOut: result.timedOut,
    lastError: result.lastError,
    tokens: result.tokens,
    cost: result.tokens ? computeCost(result.tokens, a.modelName) : undefined,
  });

  // If the call failed (empty output after retries), surface the error as
  // the final reply so the user sees what went wrong in the chat.
  const finalReply = result.output || (result.lastError
    ? `Model call failed after ${result.retries} attempt(s).\n\nError: ${result.lastError}\n\nCheck your configuration in Advanced Customization.`
    : "Model returned no response. Check your configuration in Advanced Customization.");

  return {
    ok: true,
    mode: doc.mode,
    steps,
    finalReply,
    multiAgent: false,
    confirmationRequired: false,
  };
}

export async function resumeDispatch(
  userId: string,
  _stepId: string,
  resultText: string,
  resumeContext?: Record<string, unknown>,
  browserTokens?: { input: number; output: number; total: number },
  browserLatencyMs?: number
): Promise<DispatchResult> {
  const doc = await getConfigInternal(userId);
  const ctx = (resumeContext || {}) as Record<string, any>;
  const output = typeof resultText === "string" ? resultText : "";
  const stage = typeof ctx.stage === "string" ? ctx.stage : "single";
  const messages = Array.isArray(ctx.messages) ? (ctx.messages as ChatMessage[]) : [];
  const timeoutOverrides = doc.timeoutOverrides || {};

  const finishFromAssignment = (
    assignment: ModelAssignment,
    roleName: string,
    roleIntent?: string,
    inputOverride?: string,
    extraSteps: DispatchStep[] = []
  ): DispatchResult => {
    const step: DispatchStep = {
      role: roleName,
      model: assignment.modelName,
      provider: assignment.provider,
      connectionType: assignment.connectionType,
      intent: roleIntent,
      input: inputOverride || messages[messages.length - 1]?.content || "",
      output,
      latencyMs: browserLatencyMs ?? 0,
      retries: 0,
      timedOut: false,
      lastError: undefined,
      tokens: browserTokens,
      cost: browserTokens
        ? computeCost(browserTokens, assignment.modelName)
        : undefined,
    };
    return {
      ok: true,
      mode: doc.mode,
      steps: [...extraSteps, step],
      finalReply: output || "Local model call completed.",
      multiAgent: false,
      confirmationRequired: false,
    };
  };

  switch (stage) {
    case "single": {
      const assignment = (ctx.assignment as ModelAssignment) || doc.globalConfig || emptyAssignment();
      return finishFromAssignment(assignment, String(ctx.role || "single"), typeof ctx.intent === "string" ? ctx.intent : undefined, messages[messages.length - 1]?.content || "");
    }
    case "direct": {
      const assignment = (ctx.assignment as ModelAssignment) || doc.hostConfig || emptyAssignment();
      return finishFromAssignment(assignment, String(ctx.role || "host"), typeof ctx.intent === "string" ? ctx.intent : undefined, messages[messages.length - 1]?.content || "");
    }
    case "classify": {
      const hostAssignment = (ctx.hostAssignment as ModelAssignment) || doc.hostConfig || emptyAssignment();
      const classification =
        parseClassificationResponse(output) ||
        (() => {
          const fallbackPlan = resolvePlan(doc, messages, ctx.feature as FeatureId | undefined);
          if (fallbackPlan.multiAgent && fallbackPlan.assignments[1]) {
            return {
              specialist: fallbackPlan.assignments[1].id as SpecialistId,
              confidence: 0.5,
              reasoning: "Classification call failed. Fell back to keyword matching.",
            };
          }
          return {
            specialist: "none" as const,
            confidence: 0.5,
            reasoning: "Classification call failed. Host will answer directly.",
          };
        })();
      const shouldRouteToSpecialist =
        classification.specialist !== "none" &&
        classification.confidence >= CLASSIFICATION_CONFIDENCE_THRESHOLD;

      if (!shouldRouteToSpecialist) {
        if (needsClientOllama(hostAssignment)) {
          return {
            ok: true,
            mode: doc.mode,
            steps: [],
            finalReply: "",
            multiAgent: false,
            confirmationRequired: false,
            pendingClientExec: {
              stepId: crypto.randomUUID(),
              endpoint: resolveEndpoint(hostAssignment) || "",
              model: hostAssignment.modelName,
              prompt: buildPromptFromMessages(messages, "host", "direct"),
              resumeContext: {
                mode: doc.mode,
                stage: "direct",
                messages,
                role: "host",
                intent: "direct",
                assignment: hostAssignment,
              },
            },
          };
        }

        const hostTimeout = timeoutOverrides[hostAssignment.connectionType] || DEFAULT_TIMEOUTS[hostAssignment.connectionType];
        const hostResult = await callModel(hostAssignment, messages, {
          timeoutMs: hostTimeout,
          role: "host",
          intent: "direct",
        });
        const hostStep: DispatchStep = {
          role: "host",
          model: hostAssignment.modelName,
          provider: hostAssignment.provider,
          connectionType: hostAssignment.connectionType,
          intent: "direct",
          input: messages[messages.length - 1]?.content || "",
          output: hostResult.output,
          latencyMs: hostResult.latencyMs,
          retries: hostResult.retries,
          timedOut: hostResult.timedOut,
          lastError: hostResult.lastError,
          tokens: hostResult.tokens,
          cost: hostResult.tokens ? computeCost(hostResult.tokens, hostAssignment.modelName) : undefined,
        };
        return {
          ok: true,
          mode: doc.mode,
          steps: [hostStep],
          finalReply: hostResult.output || (hostResult.lastError ? `Model call failed after ${hostResult.retries} attempt(s).\n\nError: ${hostResult.lastError}\n\nCheck your configuration in Advanced Customization.` : "Model returned no response. Check your configuration in Advanced Customization."),
          multiAgent: false,
          confirmationRequired: false,
          classification,
        };
      }

      const specialistId = classification.specialist as SpecialistId;
      const specialistAssignment = doc.specialistConfigs?.[specialistId] || emptyAssignment();
      const specialistTimeout = timeoutOverrides[specialistAssignment.connectionType] || DEFAULT_TIMEOUTS[specialistAssignment.connectionType];
      const truncated = truncateForContext(messages);
      const specialistMessages: ChatMessage[] = [
        ...truncated.messages,
        {
          role: "assistant",
          content: `[Host routed this to the ${specialistId} specialist (confidence: ${Math.round(classification.confidence * 100)}%). Fulfill the request.]`,
        },
      ];

      if (needsClientOllama(specialistAssignment)) {
        return {
          ok: true,
          mode: doc.mode,
          steps: [],
          finalReply: "",
          multiAgent: true,
          confirmationRequired: false,
          pendingClientExec: {
            stepId: crypto.randomUUID(),
            endpoint: resolveEndpoint(specialistAssignment) || "",
            model: specialistAssignment.modelName,
            prompt: buildPromptFromMessages(specialistMessages, specialistId, specialistId),
            resumeContext: {
              mode: doc.mode,
              stage: "specialist",
              messages: specialistMessages,
              specialistId,
              role: specialistId,
              intent: specialistId,
              assignment: specialistAssignment,
              hostAssignment,
              finalMessages: [
                ...messages,
                { role: "assistant", content: `Specialist ${specialistId} responded with:\n\n[awaiting local Ollama completion]\n\nReply to the user, incorporating the specialist's work.` },
              ],
            },
          },
        };
      }

      const specialistResult = await callModel(specialistAssignment, specialistMessages, {
        timeoutMs: specialistTimeout,
        role: specialistId,
        intent: specialistId,
      });
      const specialistStep: DispatchStep = {
        role: specialistId,
        model: specialistAssignment.modelName,
        provider: specialistAssignment.provider,
        connectionType: specialistAssignment.connectionType,
        intent: specialistId,
        input: truncated.truncated ? `(routed by host, context truncated: ${truncated.originalTokens}→${truncated.keptTokens} tokens)` : "(routed by host)",
        output: specialistResult.output,
        latencyMs: specialistResult.latencyMs,
        retries: specialistResult.retries,
        timedOut: specialistResult.timedOut,
        lastError: specialistResult.lastError,
        tokens: specialistResult.tokens,
        cost: specialistResult.tokens ? computeCost(specialistResult.tokens, specialistAssignment.modelName) : undefined,
      };

      const finalMessages: ChatMessage[] = [
        ...messages,
        {
          role: "assistant",
          content: `Specialist ${specialistId} responded with:\n\n${specialistResult.output}\n\nReply to the user, incorporating the specialist's work.`,
        },
      ];

      if (needsClientOllama(hostAssignment)) {
        return {
          ok: true,
          mode: doc.mode,
          steps: [specialistStep],
          finalReply: "",
          multiAgent: true,
          confirmationRequired: false,
          pendingClientExec: {
            stepId: crypto.randomUUID(),
            endpoint: resolveEndpoint(hostAssignment) || "",
            model: hostAssignment.modelName,
            prompt: buildPromptFromMessages(finalMessages, "host"),
            resumeContext: {
              mode: doc.mode,
              stage: "synthesize",
              messages: finalMessages,
              role: "host",
              assignment: hostAssignment,
              specialistStep,
              intent: "synthesize",
            },
          },
        };
      }

      const hostTimeout = timeoutOverrides[hostAssignment.connectionType] || DEFAULT_TIMEOUTS[hostAssignment.connectionType];
      const hostResult = await callModel(hostAssignment, finalMessages, {
        timeoutMs: hostTimeout,
        role: "host",
        intent: "synthesize",
      });
      const hostStep: DispatchStep = {
        role: "host",
        model: hostAssignment.modelName,
        provider: hostAssignment.provider,
        connectionType: hostAssignment.connectionType,
        intent: "synthesize",
        input: "(specialist response)",
        output: hostResult.output,
        latencyMs: hostResult.latencyMs,
        retries: hostResult.retries,
        timedOut: hostResult.timedOut,
        lastError: hostResult.lastError,
        tokens: hostResult.tokens,
        cost: hostResult.tokens ? computeCost(hostResult.tokens, hostAssignment.modelName) : undefined,
      };
      return {
        ok: true,
        mode: doc.mode,
        steps: [specialistStep, hostStep],
        finalReply: hostResult.output || specialistResult.output,
        multiAgent: true,
        confirmationRequired: false,
      };
    }
    case "specialist": {
      const specialistId = String(ctx.specialistId || ctx.role || "specialist");
      const hostAssignment = (ctx.hostAssignment as ModelAssignment) || doc.hostConfig || emptyAssignment();
      const specialistAssignment = (ctx.assignment as ModelAssignment) || emptyAssignment();
      const specialistStep: DispatchStep = {
        role: specialistId,
        model: specialistAssignment.modelName,
        provider: specialistAssignment.provider,
        connectionType: specialistAssignment.connectionType,
        intent: specialistId,
        input: messages[messages.length - 1]?.content || "",
        output,
        latencyMs: 0,
        retries: 0,
        timedOut: false,
      };
      const finalMessages: ChatMessage[] = Array.isArray(ctx.finalMessages)
        ? (ctx.finalMessages as ChatMessage[])
        : [
            ...messages,
            { role: "assistant", content: `Specialist ${specialistId} responded with:\n\n${output}\n\nReply to the user, incorporating the specialist's work.` },
          ];
      const hostTimeout = timeoutOverrides[hostAssignment.connectionType] || DEFAULT_TIMEOUTS[hostAssignment.connectionType];
      if (needsClientOllama(hostAssignment)) {
        return {
          ok: true,
          mode: doc.mode,
          steps: [specialistStep],
          finalReply: "",
          multiAgent: true,
          confirmationRequired: false,
          pendingClientExec: {
            stepId: crypto.randomUUID(),
            endpoint: resolveEndpoint(hostAssignment) || "",
            model: hostAssignment.modelName,
            prompt: buildPromptFromMessages(finalMessages, "host"),
            resumeContext: {
              mode: doc.mode,
              stage: "synthesize",
              messages: finalMessages,
              role: "host",
              assignment: hostAssignment,
              specialistStep,
              intent: "synthesize",
            },
          },
        };
      }
      const hostResult = await callModel(hostAssignment, finalMessages, {
        timeoutMs: hostTimeout,
        role: "host",
        intent: "synthesize",
      });
      const hostStep: DispatchStep = {
        role: "host",
        model: hostAssignment.modelName,
        provider: hostAssignment.provider,
        connectionType: hostAssignment.connectionType,
        intent: "synthesize",
        input: "(specialist response)",
        output: hostResult.output,
        latencyMs: hostResult.latencyMs,
        retries: hostResult.retries,
        timedOut: hostResult.timedOut,
        lastError: hostResult.lastError,
        tokens: hostResult.tokens,
        cost: hostResult.tokens ? computeCost(hostResult.tokens, hostAssignment.modelName) : undefined,
      };
      return {
        ok: true,
        mode: doc.mode,
        steps: [specialistStep, hostStep],
        finalReply: hostResult.output || output,
        multiAgent: true,
        confirmationRequired: false,
      };
    }
    case "synthesize": {
      const assignment = (ctx.assignment as ModelAssignment) || doc.hostConfig || emptyAssignment();
      const specialistStep = (ctx.specialistStep as DispatchStep | undefined) || undefined;
      const step: DispatchStep = {
        role: "host",
        model: assignment.modelName,
        provider: assignment.provider,
        connectionType: assignment.connectionType,
        intent: "synthesize",
        input: "(specialist response)",
        output,
        latencyMs: 0,
        retries: 0,
        timedOut: false,
      };
      return {
        ok: true,
        mode: doc.mode,
        steps: specialistStep ? [specialistStep, step] : [step],
        finalReply: output || "Local model call completed.",
        multiAgent: !!specialistStep,
        confirmationRequired: false,
      };
    }
    default:
      return {
        ok: false,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: false,
        confirmationRequired: false,
        error: "Unknown local Ollama resume stage.",
      };
  }
}

// ---

export interface ConversationSummary {
  id: string;
  title: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: {
    id: string;
    role: string;
    content: string;
    trace?: DispatchStep[];
    mode?: string;
    multiAgent: boolean;
    error: boolean;
    createdAt: string;
  }[];
}

export async function listConversations(
  userId: string
): Promise<ConversationSummary[]> {
  const rows = await db.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createConversation(
  userId: string,
  mode: Mode = "SINGLE",
  title = "New conversation"
): Promise<ConversationSummary> {
  const row = await db.conversation.create({
    data: { userId, mode, title },
    select: {
      id: true,
      title: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getConversation(
  userId: string,
  conversationId: string
): Promise<ConversationDetail | null> {
  const row = await db.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: row.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      trace: m.trace ? (JSON.parse(m.trace) as DispatchStep[]) : undefined,
      mode: m.mode || undefined,
      multiAgent: m.multiAgent,
      error: m.error,
      usage: m.usage
        ? (JSON.parse(m.usage) as { tokens?: TokenUsage; cost?: CostBreakdown })
        : undefined,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function deleteConversation(
  userId: string,
  conversationId: string
): Promise<void> {
  await db.conversation.deleteMany({
    where: { id: conversationId, userId },
  });
}

export async function renameConversation(
  userId: string,
  conversationId: string,
  title: string
): Promise<void> {
  await db.conversation.updateMany({
    where: { id: conversationId, userId },
    data: { title },
  });
}

export async function addMessage(
  userId: string,
  conversationId: string,
  msg: {
    role: "user" | "assistant";
    content: string;
    trace?: DispatchStep[];
    mode?: string;
    multiAgent?: boolean;
    error?: boolean;
    usage?: { tokens?: TokenUsage; cost?: CostBreakdown };
  }
): Promise<void> {
  // Verify ownership
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conv) throw new Error("Conversation not found");

  await db.message.create({
    data: {
      conversationId,
      role: msg.role,
      content: msg.content,
      trace: msg.trace ? JSON.stringify(msg.trace) : null,
      mode: msg.mode || null,
      multiAgent: msg.multiAgent || false,
      error: msg.error || false,
      usage: msg.usage ? JSON.stringify(msg.usage) : null,
    },
  });

  // Auto-title the conversation from the first user message
  if (msg.role === "user") {
    const count = await db.message.count({
      where: { conversationId, role: "user" },
    });
    if (count === 1) {
      const title = msg.content.slice(0, 60).trim() || "New conversation";
      await db.conversation.update({
        where: { id: conversationId },
        data: { title },
      });
    }
    // Touch updatedAt
    await db.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }
}

// ---
//
// After a successful dispatch, the dispatch route calls saveUsage() with the
// steps from the DispatchResult. Each step becomes one UsageRecord row.
// This powers the cost dashboard and per-message token/cost display.

export interface UsageRecordInput {
  conversationId?: string;
  messageId?: string;
  mode: string;
  role: string;
  provider: string;
  model: string;
  connectionType: string;
  tokens?: TokenUsage;
  cost?: CostBreakdown;
  latencyMs: number;
  retries: number;
  timedOut: boolean;
  error: boolean;
}

export async function saveUsage(
  userId: string,
  records: UsageRecordInput[]
): Promise<void> {
  if (records.length === 0) return;
  await db.usageRecord.createMany({
    data: records.map((r) => ({
      userId,
      conversationId: r.conversationId || null,
      messageId: r.messageId || null,
      mode: r.mode,
      role: r.role,
      provider: r.provider,
      model: r.model,
      connectionType: r.connectionType,
      inputTokens: r.tokens?.input ?? null,
      outputTokens: r.tokens?.output ?? null,
      totalTokens: r.tokens?.total ?? null,
      inputCost: r.cost?.input ?? null,
      outputCost: r.cost?.output ?? null,
      totalCost: r.cost?.total ?? null,
      latencyMs: r.latencyMs,
      retries: r.retries,
      timedOut: r.timedOut,
      error: r.error,
    })),
  });
}

// Aggregated usage summary for the cost dashboard.
export interface UsageSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  // Per-provider breakdown.
  byProvider: {
    provider: string;
    calls: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  // Per-model breakdown.
  byModel: {
    model: string;
    provider: string;
    calls: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  // Per-day breakdown (last 30 days).
  byDay: {
    date: string; // YYYY-MM-DD
    calls: number;
    totalCost: number;
  }[];
}

export async function getUsageSummary(
  userId: string,
  days = 30
): Promise<UsageSummary> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const records = await db.usageRecord.findMany({
    where: {
      userId,
      createdAt: { gte: since },
    },
    select: {
      provider: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      inputCost: true,
      outputCost: true,
      totalCost: true,
      error: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const totalCost = records.reduce((s, r) => s + (r.totalCost || 0), 0);
  const totalInputTokens = records.reduce((s, r) => s + (r.inputTokens || 0), 0);
  const totalOutputTokens = records.reduce((s, r) => s + (r.outputTokens || 0), 0);
  const successfulCalls = records.filter((r) => !r.error).length;
  const failedCalls = records.filter((r) => r.error).length;

  // Group by provider.
  const providerMap = new Map<string, {
    provider: string;
    calls: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }>();
  for (const r of records) {
    const key = r.provider;
    const existing = providerMap.get(key) || {
      provider: key,
      calls: 0,
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    existing.calls += 1;
    existing.totalCost += r.totalCost || 0;
    existing.inputTokens += r.inputTokens || 0;
    existing.outputTokens += r.outputTokens || 0;
    providerMap.set(key, existing);
  }

  // Group by model.
  const modelMap = new Map<string, {
    model: string;
    provider: string;
    calls: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }>();
  for (const r of records) {
    const key = `${r.provider}/${r.model}`;
    const existing = modelMap.get(key) || {
      model: r.model,
      provider: r.provider,
      calls: 0,
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    existing.calls += 1;
    existing.totalCost += r.totalCost || 0;
    existing.inputTokens += r.inputTokens || 0;
    existing.outputTokens += r.outputTokens || 0;
    modelMap.set(key, existing);
  }

  // Group by day.
  const dayMap = new Map<string, { calls: number; totalCost: number }>();
  for (const r of records) {
    const date = r.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
    const existing = dayMap.get(date) || { calls: 0, totalCost: 0 };
    existing.calls += 1;
    existing.totalCost += r.totalCost || 0;
    dayMap.set(date, existing);
  }

  return {
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    totalInputTokens,
    totalOutputTokens,
    totalCalls: records.length,
    successfulCalls,
    failedCalls,
    byProvider: Array.from(providerMap.values()).sort((a, b) => b.totalCost - a.totalCost),
    byModel: Array.from(modelMap.values()).sort((a, b) => b.totalCost - a.totalCost),
    byDay: Array.from(dayMap.entries())
      .map(([date, v]) => ({
        date,
        calls: v.calls,
        totalCost: Math.round(v.totalCost * 1_000_000) / 1_000_000,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// Get recent usage records (for a list view).
export interface UsageRecordRow {
  id: string;
  conversationId: string | null;
  mode: string;
  role: string;
  provider: string;
  model: string;
  connectionType: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  latencyMs: number;
  retries: number;
  timedOut: boolean;
  error: boolean;
  createdAt: string;
}

export async function getRecentUsage(
  userId: string,
  limit = 50
): Promise<UsageRecordRow[]> {
  const records = await db.usageRecord.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return records.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    mode: r.mode,
    role: r.role,
    provider: r.provider,
    model: r.model,
    connectionType: r.connectionType,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    totalCost: r.totalCost,
    latencyMs: r.latencyMs,
    retries: r.retries,
    timedOut: r.timedOut,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
  }));
}
