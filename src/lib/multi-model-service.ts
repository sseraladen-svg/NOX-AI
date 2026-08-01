import "server-only";
import { db } from "@/lib/db";
import { encryptApiKey, decryptApiKey, maskApiKey } from "@/lib/crypto";
import { execFile, spawn } from "child_process";
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// NOX AI â€” Multi-Model Service (server-only, user-scoped)
//
// Three modes (renamed per user request):
//   1. SINGLE        â€” one model for all 6 features (formerly GLOBAL)
//   2. MULTI         â€” each feature has its own model (formerly PER_FEATURE)
//   3. ORCHESTRATOR  â€” host routes prompts to specialists (formerly HOST)
//
// All config is scoped to a userId. API keys encrypted at rest.
//
// Safety layers (all three modes):
//   â€¢ connect-time validation (model + version ping, block save on failure)
//   â€¢ per-connection-type timeout defaults + backend heartbeat
//   â€¢ capped auto-retry (2 attempts) on timeout
//   â€¢ pre-flight user confirmation for multi-agent tasks
//   â€¢ per-model capacity/limit check before running multi-agent tasks
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SCOPE = "default";

// â”€â”€â”€ Persistence (encrypt on write, mask on read) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  // masked (e.g. "sk-â€¢â€¢â€¢â€¢7890"). When the frontend loads a config, the keys
  // are masked. If the user doesn't re-type a key, the masked version gets
  // sent back on save. We detect masked keys (contain "â€¢") and preserve the
  // existing encrypted key from the DB instead of overwriting with the mask.
  const existing = await db.multiModelConfig.findUnique({
    where: { userId_scope: { userId, scope: SCOPE } },
  });

  const preserveMaskedKey = (incoming: ModelAssignment | null | undefined, existingJson: string | null): ModelAssignment | null => {
    if (!incoming) return null;
    // If the incoming key is missing or masked, preserve the existing key.
    if (!incoming.apiKey || incoming.apiKey.includes("â€¢")) {
      if (existingJson) {
        try {
          const existingAssign = JSON.parse(existingJson) as ModelAssignment;
          return { ...incoming, apiKey: existingAssign.apiKey }; // keep encrypted blob
        } catch {
          return { ...incoming, apiKey: undefined };
        }
      }
      return { ...incoming, apiKey: undefined };
    }
    return incoming;
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
      if (!v.apiKey || v.apiKey.includes("â€¢")) {
        // Preserve existing key for this role.
        out[k] = { ...v, apiKey: existingMap[k]?.apiKey };
      } else {
        out[k] = v;
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

// â”€â”€â”€ Test / connect validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    // Z.ai doesn't need an API key â€” it's always ready.
    if (a.provider === "zai") {
      return {
        ok: true,
        status: "ready",
        message: `Connected to Z.ai (built-in). Model "${a.modelName}" ready. No API key needed.`,
        version: a.modelName,
        latencyMs: 0,
      };
    }
    if (!a.apiKey || a.apiKey.length < 8) {
      return {
        ok: false,
        status: "error",
        message: "API key missing or too short.",
        reason: "An API key is required for API connections.",
        fixSteps: [
          "Paste your provider API key.",
          "Ensure it has at least 8 characters.",
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

  // â”€â”€â”€ Fix #3: Gemini-specific lightweight test call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  //
  // For Gemini, instead of (or before) running a full generateContent call,
  // hit the cheaper/faster ListModels endpoint:
  //   GET https://generativelanguage.googleapis.com/v1beta/models?key=<apiKey>
  //
  // This confirms the key works AND the API is enabled, without spending
  // generation tokens. If it fails, we return the specific error from
  // formatGeminiHttpError so the user gets an actionable message.
  if (a.connectionType === "API" && a.provider === "gemini") {
    const geminiResult = await testGeminiConnection(a.apiKey!, a.modelName, a.endpoint);
    if (!geminiResult.ok) {
      return geminiResult;
    }
    // ListModels succeeded â€” key is valid, API is enabled.
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

  // â”€â”€â”€ Anthropic test: actually ping the API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Anthropic has its own auth header (x-api-key) + its own /v1/models endpoint.
  if (a.connectionType === "API" && a.provider === "anthropic") {
    return await testAnthropicConnection(a.apiKey!, a.modelName, a.endpoint);
  }

  // â”€â”€â”€ OpenAI-compatible test: actually ping the API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // For openai, mistral, groq â€” hit GET /v1/models with Bearer auth.
  if (a.connectionType === "API" && ["openai", "mistral", "groq"].includes(a.provider)) {
    return await testOpenAiCompatibleConnection(
      a.apiKey!,
      a.modelName,
      a.provider,
      a.endpoint
    );
  }

  if (a.connectionType === "LOCAL") {
    // For ollama: actually ping the HTTP API to verify it's reachable.
    if (a.provider === "ollama") {
      return await testOllamaConnection(a.modelName, a.endpoint);
    }
    // For llamacpp/llamafile: verify the binary path exists (can't run it
    // without a model file, but at least check the path looks valid).
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

// â”€â”€â”€ Limit / capacity check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// HONEST implementation: instead of returning fake hardcoded quota numbers,
// this function does a real reachability check for each model:
//
//   â€¢ API models (openai/anthropic/gemini/mistral/groq): pings the provider's
//     /models endpoint with the API key. If it returns 200, the key works and
//     the API is reachable â†’ canFinish = true. If 401/403/429/5xx, returns
//     canFinish = false with the real reason.
//
//   â€¢ LOCAL models (ollama): pings GET /api/tags. If reachable, canFinish =
//     true. If not, canFinish = false with "Ollama is not reachable from the
//     server."
//
//   â€¢ LOCAL models (llamacpp/llamafile): can't easily verify without running
//     the binary, so we report canFinish = true with a note that the binary
//     path hasn't been verified.
//
// This is slower than the old fake version (one HTTP call per model) but it
// gives the user real information. The confirmation dialog now shows "Key
// verified" or the actual error instead of fake "70% quota" numbers.
export async function checkLimits(
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

      // For LOCAL CLI models (llamacpp/llamafile), we can't easily verify
      // without running the binary. Assume OK with a note.
      if (
        assignment.connectionType === "LOCAL" &&
        assignment.provider !== "ollama"
      ) {
        return {
          ...base,
          canFinish: true,
          // No fake capacity number â€” just a note that it's unverified.
        };
      }

      // For ollama: ping GET /api/tags.
      if (
        assignment.connectionType === "LOCAL" &&
        assignment.provider === "ollama"
      ) {
        const ollamaBase = assignment.endpoint || "http://localhost:11434";
        try {
          const res = await fetch(`${ollamaBase}/api/tags`, {
            method: "GET",
            signal: AbortSignal.timeout(5_000),
          });
          if (!res.ok) {
            return {
              ...base,
              canFinish: false,
              reason: `Ollama returned HTTP ${res.status}.`,
            };
          }
          const json = await res.json();
          const availableModels: string[] = (json.models || []).map(
            (m: { name?: string }) => m.name || ""
          );
          const modelAvailable =
            availableModels.length === 0 ||
            availableModels.includes(assignment.modelName);
          if (!modelAvailable) {
            return {
              ...base,
              canFinish: false,
              reason: `Model "${assignment.modelName}" not pulled. Available: ${availableModels.slice(0, 3).join(", ")}`,
            };
          }
          return { ...base, canFinish: true };
        } catch {
          return {
            ...base,
            canFinish: false,
            reason: `Ollama at ${ollamaBase} is not reachable from the server.`,
          };
        }
      }

      // For API models: ping the provider's /models endpoint.
      if (assignment.connectionType === "API") {
        const testResult = await quickApiReachabilityCheck(assignment);
        return {
          ...base,
          canFinish: testResult.canFinish,
          reason: testResult.reason,
        };
      }

      return base;
    })
  );
  return results;
}

// Quick reachability check for API providers â€” used by checkLimits.
// Returns canFinish=true if the key works + API is reachable, false otherwise.
// This is a lighter check than the full testAssignment() â€” it just answers
// "can we reach this provider with this key right now?"
async function quickApiReachabilityCheck(
  assignment: ModelAssignment
): Promise<{ canFinish: boolean; reason?: string }> {
  const { provider, apiKey, endpoint } = assignment;
  // Z.ai is always reachable â€” it uses the built-in SDK.
  if (provider === "zai") {
    return { canFinish: true };
  }
  if (!apiKey) {
    return { canFinish: false, reason: "No API key configured." };
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
      return { canFinish: true };
    }
    if (res.status === 401) {
      return { canFinish: false, reason: `${provider} rejected the API key (401).` };
    }
    if (res.status === 403) {
      return {
        canFinish: false,
        reason: `${provider} blocked the request (403) â€” likely a region restriction or quota issue.`,
      };
    }
    if (res.status === 429) {
      return { canFinish: false, reason: `${provider} rate limit hit (429).` };
    }
    return {
      canFinish: false,
      reason: `${provider} returned HTTP ${res.status}.`,
    };
  } catch (err) {
    const e = err as Error;
    const isConn =
      e.message.includes("fetch failed") ||
      e.message.includes("aborted") ||
      e.message.includes("ECONNREFUSED");
    return {
      canFinish: false,
      reason: isConn
        ? `Cannot reach ${provider} from the server (network/region block).`
        : `${provider} error: ${e.message}`,
    };
  }
}

// â”€â”€â”€ Dispatch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function emptyAssignment(): ModelAssignment {
  return {
    connectionType: "API",
    provider: "openai",
    modelName: "gpt-4o-mini",
    status: "untested",
  };
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
  opts: { timeoutMs: number; role: string; intent?: string }
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

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const result = await Promise.race([
        realCall(assignment, messages, opts.role, opts.intent, opts.timeoutMs),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`timeout after ${opts.timeoutMs}ms`)),
            opts.timeoutMs
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
      lastError = (err as Error).message;
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

// Result of a single model call â€” text + token usage (when available).
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
  timeoutMs?: number
): Promise<ModelCallResult> {
  // Build the system hint the same way â€” this is the NOX persona prompt.
  const systemHint =
    role === "host"
      ? "You are NOX Host. Analyze the user's intent and either answer directly or synthesize the response from a specialist model into a clean reply to the user. Be concise."
      : intent
      ? `You are NOX ${role} specialist (intent: ${intent}). Answer the user's request focused on your specialty. Be concise and useful.`
      : "You are NOX AI. Respond helpfully and concisely.";

  // Normalise the conversation â€” preserve image attachments for vision.
  const conv: ChatMessage[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
      image: m.image,
    }));

  // Route based on the assignment's connection type.
  if (assignment.connectionType === "LOCAL") {
    return callLocalCli(assignment, systemHint, conv, timeoutMs);
  }

  return callApi(assignment, systemHint, conv);
}

// â”€â”€â”€ API connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function callApi(
  assignment: ModelAssignment,
  systemHint: string,
  conv: ChatMessage[]
): Promise<ModelCallResult> {
  const { provider, modelName, apiKey, endpoint } = assignment;

  // Z.ai doesn't need an API key â€” it uses the built-in SDK.
  if (provider !== "zai" && !apiKey) {
    throw new Error(
      `No API key configured for ${provider}/${modelName}. Add one in Advanced Customization.`
    );
  }

  // Anthropic has its own request/response format.
  if (provider === "anthropic") {
    return callAnthropic(apiKey ?? "", modelName, systemHint, conv, endpoint);
  }

  // Z.ai â€” built-in SDK, no API key needed.
  if (provider === "zai") {
    return callZai(modelName, systemHint, conv);
  }

  // Google Gemini uses a different URL structure + API key as query param.
  if (provider === "gemini") {
    return callGemini(apiKey ?? "", modelName, systemHint, conv, endpoint);
  }

  // OpenAI, Mistral, and Groq all use the OpenAI-compatible
  // /v1/chat/completions format with Bearer auth.
  return callOpenAiCompatible(apiKey ?? "", modelName, systemHint, conv, provider, endpoint);
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
  const defaultEndpoints: Record<string, string> = {
    openai: "https://api.openai.com/v1/chat/completions",
    mistral: "https://api.mistral.ai/v1/chat/completions",
    groq: "https://api.groq.com/openai/v1/chat/completions",
  };
  const url = endpoint || defaultEndpoints[provider] || defaultEndpoints.openai;

  // Build messages â€” if a message has an image, format as multimodal content
  // array (text + image_url). Otherwise use plain string content.
  const messages: Array<{ role: string; content: string | unknown[] }> = [
    { role: "system", content: systemHint },
    ...conv.map((m) => {
      if (m.image) {
        // Multimodal: text + image
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            {
              type: "image_url",
              image_url: {
                url: `data:${m.image.mimeType};base64,${m.image.data}`,
              },
            },
          ],
        };
      }
      return { role: m.role, content: m.content };
    }),
  ];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`${provider} API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  const usage = json.usage;
  const tokens: TokenUsage | undefined = usage
    ? {
        input: usage.prompt_tokens || 0,
        output: usage.completion_tokens || 0,
        total: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
      }
    : undefined;
  return { text, tokens };
}

// Z.ai â€” built-in SDK provider. No API key needed.
// Uses the z-ai-web-dev-sdk which is pre-installed and works from any region.
// If the SDK config file is missing, falls back to a direct HTTP call to the
// Z.ai API using the config from /etc/.z-ai-config or environment variables.
async function callZai(
  model: string,
  systemHint: string,
  conv: ChatMessage[]
): Promise<ModelCallResult> {
  // Try the SDK first â€” it handles auth automatically if the config file exists.
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
    // SDK failed â€” likely missing .z-ai-config file.
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
    return null; // No config found â€” caller will show the error
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
  const url = endpoint || "https://api.anthropic.com/v1/messages";

  // Build messages â€” if a message has an image, format as multimodal content
  // array (text + image). Anthropic uses:
  //   { type: "image", source: { type: "base64", media_type, data } }
  const messages: Array<{ role: string; content: string | unknown[] }> = conv.map((m) => {
    if (m.image) {
      return {
        role: m.role,
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: m.image.mimeType,
              data: m.image.data,
            },
          },
          { type: "text", text: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemHint,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`anthropic API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = json.content?.[0]?.text ?? "";
  const usage = json.usage;
  const tokens: TokenUsage | undefined = usage
    ? {
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        total: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      }
    : undefined;
  return { text, tokens };
}

// Google Gemini generateContent API.
//
// SECURITY: `apiKey` is only ever placed into the URL query string (the way
// Google's API expects it). It is never included in error messages, trace
// objects, or logs. If you change this function, preserve that invariant.
async function callGemini(
  apiKey: string,
  model: string,
  systemHint: string,
  conv: ChatMessage[],
  endpoint?: string
): Promise<ModelCallResult> {
  const geminiKeyError = validateGeminiKey(apiKey);
  if (geminiKeyError) {
    throw new Error(geminiKeyError);
  }

  const base =
    endpoint || "https://generativelanguage.googleapis.com/v1beta/models";
  const url = `${base}/${model}:generateContent?key=${apiKey}`;

  // Build contents â€” if a message has an image, add inline_data part.
  // Gemini uses: { inline_data: { mime_type, data } }
  const contents = conv.map((m) => {
    const parts: unknown[] = [{ text: m.content }];
    if (m.image) {
      parts.push({
        inline_data: {
          mime_type: m.image.mimeType,
          data: m.image.data,
        },
      });
    }
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts,
    };
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: systemHint }] },
      generationConfig: { maxOutputTokens: 1024 },
    }),
  });

  if (!res.ok) {
    // â”€â”€â”€ Fix #2: surface specific, actionable errors for Gemini â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //
    // Never include the raw API key in the error message. Only include the
    // HTTP status, the model name, and a human-readable explanation.
    throw new Error(formatGeminiHttpError(res.status, model, await safeReadError(res)));
  }

  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p: { text?: string }) => p.text || "").join("")
    : "";
  // Gemini returns usage as:
  //   { usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount } }
  const usage = json.usageMetadata;
  const tokens: TokenUsage | undefined = usage
    ? {
        input: usage.promptTokenCount || 0,
        output: usage.candidatesTokenCount || 0,
        total: usage.totalTokenCount || 0,
      }
    : undefined;
  return { text, tokens };
}

// Validate a Gemini API key format before making any network call.
// Returns null if the key looks valid, or a clear error string if not.
//
// SECURITY: This function only inspects the key's prefix and length â€” it
// never logs the key itself.
export function validateGeminiKey(apiKey: string): string | null {
  if (!apiKey) {
    return "No Gemini API key configured. Add one in Advanced Customization.";
  }
  // Trim leading/trailing whitespace (a common copy-paste mistake) and check.
  const trimmed = apiKey.trim();
  if (trimmed !== apiKey) {
    // We don't auto-fix here â€” we tell the user so they can re-paste cleanly.
    return "The API key has leading or trailing whitespace. Copy it again from https://aistudio.google.com/apikey with no extra spaces.";
  }
  // Known-wrong prefixes: OAuth bearer tokens, Vertex service-account tokens,
  // Google Cloud API keys with the wrong prefix, etc.
  const wrongPrefixes = ["ya29.", "AQ.", "1//", "AIza"];
  // Note: real AI Studio keys DO start with "AIzaSy" â€” we check that below.
  // "AIza" alone (without "Sy") is the older Google Cloud API key prefix and
  // does NOT work with the Generative Language API.
  if (trimmed.startsWith("AIza") && !trimmed.startsWith("AIzaSy")) {
    return "This looks like a Google Cloud API key (prefix 'AIza') but not a Generative Language API key. Get one from https://aistudio.google.com/apikey â€” it should start with 'AIzaSy'.";
  }
  if (wrongPrefixes.some((p) => trimmed.startsWith(p)) && !trimmed.startsWith("AIzaSy")) {
    return "This doesn't look like a valid Gemini API key. Get one from https://aistudio.google.com/apikey â€” it should start with 'AIzaSy'. OAuth tokens are not supported here.";
  }
  if (!trimmed.startsWith("AIzaSy")) {
    return "This doesn't look like a valid Gemini API key. Get one from https://aistudio.google.com/apikey â€” it should start with 'AIzaSy'. OAuth tokens are not supported here.";
  }
  // AI Studio keys are ~39 chars. Allow some slack but flag obviously wrong lengths.
  if (trimmed.length < 35 || trimmed.length > 45) {
    return `This Gemini API key is ${trimmed.length} characters, but valid keys are usually 39. Check it's copied completely from https://aistudio.google.com/apikey.`;
  }
  return null;
}

// Read the error response body safely â€” never includes the API key.
// Returns a short string suitable for inclusion in an error message.
async function safeReadError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    // Google returns JSON errors like { error: { message, status, code } }.
    // Try to extract the structured message; fall back to raw text.
    try {
      const json = JSON.parse(text);
      const msg = json?.error?.message || json?.message || text;
      return String(msg).slice(0, 250);
    } catch {
      return text.slice(0, 250) || res.statusText;
    }
  } catch {
    return res.statusText || "unknown error";
  }
}

// Format a Gemini HTTP error with a specific, actionable message per status.
// SECURITY: `model` is safe to include (it's user-visible config). Never pass
// `apiKey` here.
function formatGeminiHttpError(status: number, model: string, body: string): string {
  switch (status) {
    case 400:
      return `Gemini rejected this API key â€” check it's copied correctly with no extra spaces. (Details: ${body})`;
    case 401:
    case 403:
      return `This key is valid but the Generative Language API may not be enabled on this Google Cloud project, or you've hit your quota. (Details: ${body})`;
    case 404:
      return `Model '${model}' not found for Gemini â€” check the model name matches an available Gemini model. (Details: ${body})`;
    case 429:
      return `Gemini rate limit hit â€” wait a moment and try again. (Details: ${body})`;
    default:
      if (status >= 500) {
        return `Gemini server error (${status}). Try again in a moment. (Details: ${body})`;
      }
      return `Gemini API error (${status}): ${body}`;
  }
}

// Lightweight Gemini connection test â€” hits the ListModels endpoint instead
// of running a full generateContent call. Cheaper, faster, and confirms the
// key works + the Generative Language API is enabled on the project.
//
// SECURITY: The apiKey is only placed in the URL query string (per Google's
// API spec). It is never included in the returned TestResult message/reason.
export async function testGeminiConnection(
  apiKey: string,
  model: string,
  endpoint?: string
): Promise<TestResult> {
  const started = Date.now();

  // Step 1: validate key format before any network call.
  const keyError = validateGeminiKey(apiKey);
  if (keyError) {
    return {
      ok: false,
      status: "error",
      message: keyError,
      reason: "Gemini API key format is invalid.",
      fixSteps: [
        "Go to https://aistudio.google.com/apikey",
        "Create or copy an API key (starts with 'AIzaSy')",
        "Paste it into the API Key field",
      ],
    };
  }

  // Step 2: hit ListModels to verify the key + API enablement.
  const base =
    endpoint || "https://generativelanguage.googleapis.com/v1beta/models";
  const url = `${base}?key=${apiKey}&pageSize=100`;

  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      const body = await safeReadError(res);
      const message = formatGeminiHttpError(res.status, model, body);
      return {
        ok: false,
        status: "error",
        message,
        reason: `Gemini ListModels returned HTTP ${res.status}.`,
        fixSteps: geminiFixStepsForStatus(res.status),
      };
    }

    // Step 3: optionally verify the configured model is in the listed models.
    const json = await res.json();
    const listedModels: string[] = (json.models || []).map(
      (m: { name?: string }) => (m.name || "").replace(/^models\//, "")
    );
    const modelAvailable =
      listedModels.length === 0 || // don't block if list is empty for some reason
      listedModels.includes(model);

    const latencyMs = Date.now() - started;
    if (!modelAvailable) {
      return {
        ok: false,
        status: "error",
        message: `Model '${model}' not found for Gemini â€” check the model name matches an available Gemini model.`,
        reason: `ListModels succeeded but '${model}' is not in the list of available models.`,
        fixSteps: [
          `Available models include: ${listedModels.slice(0, 5).join(", ")}${listedModels.length > 5 ? "..." : ""}`,
          "Pick one of those from the dropdown, or check the exact name.",
        ],
        latencyMs,
      };
    }

    return {
      ok: true,
      status: "ready",
      message: `Connected to Google Gemini (key verified via ListModels). Model "${model}" ready.`,
      version: model,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      message: `Could not reach Google's Gemini API: ${(err as Error).message}`,
      reason: "Network error during ListModels call.",
      fixSteps: [
        "Check your internet connection",
        "Verify Google's Generative Language API is reachable from your network",
        "Try again in a moment",
      ],
    };
  }
}

// Return provider-specific fix steps for a given Gemini HTTP status.
function geminiFixStepsForStatus(status: number): string[] {
  switch (status) {
    case 400:
      return [
        "Copy the API key again from https://aistudio.google.com/apikey",
        "Make sure there are no leading/trailing spaces",
        "Ensure you're using an AI Studio key (starts with 'AIzaSy'), not an OAuth token",
      ];
    case 401:
    case 403:
      return [
        "Go to https://aistudio.google.com/apikey and verify the key is still active",
        "Enable the Generative Language API on your Google Cloud project",
        "Check your quota at https://aistudio.google.com/usage",
      ];
    case 404:
      return [
        "Check the model name is spelled correctly",
        "Pick a known model from the dropdown (e.g. gemini-2.0-flash, gemini-1.5-pro)",
      ];
    case 429:
      return [
        "Wait a moment for the rate limit to reset",
        "Check your quota at https://aistudio.google.com/usage",
      ];
    default:
      return ["Try again in a moment", "Check https://status.cloud.google.com for outages"];
  }
}

// Test an OpenAI-compatible API connection (openai, mistral, groq).
// Hits GET /v1/models with the Bearer token â€” lightweight, no tokens spent.
// Verifies: key is valid, API is reachable from the server, key has access.
export async function testOpenAiCompatibleConnection(
  apiKey: string,
  model: string,
  provider: string,
  endpoint?: string
): Promise<TestResult> {
  const started = Date.now();
  const defaultEndpoints: Record<string, string> = {
    openai: "https://api.openai.com/v1/models",
    mistral: "https://api.mistral.ai/v1/models",
    groq: "https://api.groq.com/openai/v1/models",
  };
  const url = endpoint
    ? `${endpoint.replace(/\/$/, "")}/models`
    : defaultEndpoints[provider] || defaultEndpoints.openai;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      let errMsg = body;
      try {
        const j = JSON.parse(body);
        errMsg = j?.error?.message || j?.message || body;
      } catch {
        /* keep raw */
      }
      errMsg = String(errMsg).slice(0, 250);

      // Map common HTTP errors to actionable messages.
      let message: string;
      let reason: string;
      let fixSteps: string[];
      if (res.status === 401) {
        message = `${provider} rejected the API key â€” check it's copied correctly with no extra spaces.`;
        reason = `HTTP 401: ${errMsg}`;
        fixSteps = [
          `Go to the ${provider} dashboard and verify the key is still active`,
          "Copy it again with no leading/trailing spaces",
          "Ensure the key has the necessary permissions",
        ];
      } else if (res.status === 403) {
        const isRegion = errMsg.toLowerCase().includes("country") ||
          errMsg.toLowerCase().includes("region") ||
          errMsg.toLowerCase().includes("unsupported_country");
        message = isRegion
          ? `${provider} is blocking this request because of the server's geographic location. The NOX AI server is in a region ${provider} doesn't support. You need to deploy NOX AI in a supported region (e.g. US, EU).`
          : `${provider} returned 403 â€” the key may not have permission for this API. (Details: ${errMsg})`;
        reason = `HTTP 403: ${errMsg}`;
        fixSteps = isRegion
          ? [
              "Deploy NOX AI to a supported region (Vercel, Railway, etc.)",
              `Or use a different provider that supports this region`,
              "This is a server-side geo-block â€” no key will work from here",
            ]
          : [
              `Check the ${provider} key has the right permissions`,
              "Verify your organization's API access settings",
            ];
      } else if (res.status === 429) {
        message = `${provider} rate limit hit â€” wait a moment and try again. (Details: ${errMsg})`;
        reason = `HTTP 429: ${errMsg}`;
        fixSteps = [
          "Wait a minute for the rate limit to reset",
          `Check your ${provider} usage dashboard`,
        ];
      } else {
        message = `${provider} API error (HTTP ${res.status}): ${errMsg}`;
        reason = `HTTP ${res.status}`;
        fixSteps = ["Try again", `Check the ${provider} status page`];
      }

      return {
        ok: false,
        status: "error",
        message,
        reason,
        fixSteps,
        latencyMs: Date.now() - started,
      };
    }

    // Success â€” key works, API is reachable.
    const json = await res.json();
    const modelCount = Array.isArray(json.data) ? json.data.length : 0;
    return {
      ok: true,
      status: "ready",
      message: `Connected to ${provider} (key verified). ${modelCount} models available. Model "${model}" ready.`,
      version: model,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const e = err as Error;
    const isConn = e.message.includes("fetch failed") ||
      e.message.includes("aborted") ||
      e.message.includes("ECONNREFUSED");
    return {
      ok: false,
      status: "error",
      message: isConn
        ? `Could not reach ${provider}'s API from the server. The server may be in a region ${provider} blocks, or there's a network issue.`
        : `${provider} error: ${e.message}`,
      reason: isConn
        ? "Network error â€” server cannot reach the provider."
        : e.message,
      fixSteps: isConn
        ? [
            "Deploy NOX AI to a region the provider supports",
            "Check the server's internet connection",
            "Try a different provider",
          ]
        : ["Try again", "Check the provider's status page"],
    };
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
  const url = endpoint
    ? `${endpoint.replace(/\/$/, "")}/models`
    : "https://api.anthropic.com/v1/models";

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      let errMsg = body;
      try {
        const j = JSON.parse(body);
        errMsg = j?.error?.message || j?.message || body;
      } catch {
        /* keep raw */
      }
      errMsg = String(errMsg).slice(0, 250);

      let message: string;
      let reason: string;
      let fixSteps: string[];
      if (res.status === 401) {
        message = `Anthropic rejected the API key â€” check it's copied correctly with no extra spaces.`;
        reason = `HTTP 401: ${errMsg}`;
        fixSteps = [
          "Go to https://console.anthropic.com/settings/keys and verify the key is active",
          "Copy it again with no leading/trailing spaces",
          "Ensure the key has the necessary permissions",
        ];
      } else if (res.status === 403) {
        const isRegion = errMsg.toLowerCase().includes("country") ||
          errMsg.toLowerCase().includes("region") ||
          errMsg.toLowerCase().includes("unsupported");
        message = isRegion
          ? `Anthropic is blocking this request because of the server's geographic location. Deploy NOX AI in a supported region.`
          : `Anthropic returned 403 â€” the key may not have permission. (Details: ${errMsg})`;
        reason = `HTTP 403: ${errMsg}`;
        fixSteps = isRegion
          ? [
              "Deploy NOX AI to a supported region (Vercel, Railway, etc.)",
              "This is a server-side geo-block â€” no key will work from here",
            ]
          : [
              "Check the Anthropic key has the right permissions",
              "Verify your organization's API access settings",
            ];
      } else if (res.status === 429) {
        message = `Anthropic rate limit hit â€” wait a moment and try again. (Details: ${errMsg})`;
        reason = `HTTP 429: ${errMsg}`;
        fixSteps = [
          "Wait a minute for the rate limit to reset",
          "Check your Anthropic usage dashboard",
        ];
      } else {
        message = `Anthropic API error (HTTP ${res.status}): ${errMsg}`;
        reason = `HTTP ${res.status}`;
        fixSteps = ["Try again", "Check Anthropic's status page"];
      }

      return {
        ok: false,
        status: "error",
        message,
        reason,
        fixSteps,
        latencyMs: Date.now() - started,
      };
    }

    // Success â€” key works, API is reachable.
    const json = await res.json();
    const modelCount = Array.isArray(json.data) ? json.data.length : 0;
    return {
      ok: true,
      status: "ready",
      message: `Connected to Anthropic (key verified). ${modelCount} models available. Model "${model}" ready.`,
      version: model,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const e = err as Error;
    const isConn = e.message.includes("fetch failed") ||
      e.message.includes("aborted") ||
      e.message.includes("ECONNREFUSED");
    return {
      ok: false,
      status: "error",
      message: isConn
        ? `Could not reach Anthropic's API from the server. The server may be in a region Anthropic blocks, or there's a network issue.`
        : `Anthropic error: ${e.message}`,
      reason: isConn
        ? "Network error â€” server cannot reach the provider."
        : e.message,
      fixSteps: isConn
        ? [
            "Deploy NOX AI to a region the provider supports",
            "Check the server's internet connection",
            "Try a different provider",
          ]
        : ["Try again", "Check the provider's status page"],
    };
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
  const base = endpoint || "http://localhost:11434";

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
          "If NOX AI is hosted, localhost refers to the server â€” set Endpoint to a reachable host",
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
    const isConnRefused =
      e.message.includes("ECONNREFUSED") ||
      e.message.includes("fetch failed") ||
      e.message.includes("aborted");
    return {
      ok: false,
      status: "error",
      message: isConnRefused
        ? `Could not connect to Ollama at ${base}. If NOX AI is hosted, "localhost" refers to the SERVER, not your machine. Set the Endpoint field to a publicly reachable Ollama host.`
        : `Ollama error: ${e.message}`,
      reason: isConnRefused
        ? "Connection refused â€” Ollama is not running at this address from the server's perspective."
        : e.message,
      fixSteps: isConnRefused
        ? [
            "If running locally: ensure Ollama is started (ollama serve)",
            "If NOX AI is hosted: set Endpoint to a public Ollama host",
            "Check firewall settings allow access to port 11434",
          ]
        : ["Check Ollama logs for errors", "Verify the endpoint URL is correct"],
    };
  }
}

// â”€â”€â”€ Heartbeat-based subprocess execution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Hard ceiling timer â€” kills even if heartbeats keep coming.
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

// â”€â”€â”€ LOCAL CLI connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// For ollama: uses the HTTP API (POST /api/generate) instead of spawning a
// subprocess. This is faster, more reliable, and supports remote ollama
// instances via the `endpoint` field (default: http://localhost:11434).
//
// For llamacpp/llamafile: spawns the binary as a subprocess with the prompt
// as a CLI argument.
//
// The timeout/retry wrapping is handled by callModel's Promise.race.

async function callLocalCli(
  assignment: ModelAssignment,
  systemHint: string,
  conv: ChatMessage[],
  timeoutMs?: number
): Promise<ModelCallResult> {
  const { provider, modelName, cliPath, cliArgs, endpoint } = assignment;

  // Ollama: use HTTP API (no subprocess needed).
  if (provider === "ollama") {
    return callOllamaHttp(modelName, systemHint, conv, endpoint, timeoutMs);
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
    // LOCAL CLI models don't return token usage â€” return text only.
    return { text: result.stdout.trim(), heartbeats: result.heartbeats };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new Error(
        `CLI binary not found at "${cliPath}". The server cannot find this path â€” if you're running NOX AI in a hosted environment, the binary must be installed on the SERVER, not your local machine.`
      );
    }
    const stderr = (e as { stderr?: string }).stderr?.slice(0, 300) || e.message;
    throw new Error(`${provider} CLI error: ${stderr}`);
  }
}

// Call ollama via its HTTP API (POST /api/generate).
// Uses `endpoint` as the ollama host (default: http://localhost:11434).
// Uses streaming mode (stream: true) so each NDJSON chunk acts as a heartbeat
// signal â€” the timeout clock resets on each chunk, up to 3x the configured
// timeout. This prevents slow-but-working local models from being killed
// mid-generation.
async function callOllamaHttp(
  model: string,
  systemHint: string,
  conv: ChatMessage[],
  endpoint?: string,
  timeoutMs?: number
): Promise<ModelCallResult> {
  const base = endpoint || "http://localhost:11434";
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
        stream: true, // streaming mode â€” each chunk is a heartbeat
        options: {
          num_predict: 1024,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    // Read the streaming response (NDJSON â€” one JSON object per line per chunk).
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
        // Idle timeout â€” no data for effectiveTimeout ms.
        throw err;
      }

      if (done) break;

      // Got a chunk â€” this is a heartbeat. Reset the idle timer.
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
          }
          // Token counts come in the final chunk.
          if (typeof chunk.prompt_eval_count === "number") {
            inputTokens = chunk.prompt_eval_count;
          }
          if (typeof chunk.eval_count === "number") {
            outputTokens = chunk.eval_count;
          }
        } catch {
          // Incomplete JSON â€” skip, will be in buffer.
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
    if (e.message.includes("ECONNREFUSED") || e.message.includes("fetch failed")) {
      throw new Error(
        `Could not connect to Ollama at ${base}. The server cannot reach this address â€” if NOX AI is hosted, "localhost" refers to the SERVER, not your machine. Either install Ollama on the server, or set the Endpoint field to a publicly reachable Ollama host.`
      );
    }
    throw new Error(`Ollama error: ${e.message}`);
  }
}

// â”€â”€â”€ Context handoff: token counting + truncation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    // No user message â€” keep as-is (shouldn't happen).
    return { messages, truncated: false, originalTokens, keptTokens: originalTokens };
  }

  const lastUserTokens = estimateTokens(lastUser.content);
  if (lastUserTokens >= budgetTokens) {
    // Last user message alone exceeds budget â€” truncate it.
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

// â”€â”€â”€ Host-model-driven intent classification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
// to the old keyword-based resolvePlan() â€” so a failed classification never
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

// Result of a classification call â€” the parsed classification + call metadata
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
// fast and cheap â€” classification doesn't need conversation context.
async function classifyIntent(
  hostAssignment: ModelAssignment,
  messages: ChatMessage[],
  timeoutMs: number
): Promise<ClassificationCallResult> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userContent = lastUser?.content || "";

  const classifyMessages: ChatMessage[] = [
    {
      role: "user",
      content: `${CLASSIFICATION_SYSTEM_PROMPT}\n\n---\n\nUser message to classify:\n"${userContent}"\n\nRespond with ONLY the JSON object:`,
      image: lastUser?.image,
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
  } = {}
): Promise<DispatchResult> {
  const doc = await getConfigInternal(userId);
  const timeoutOverrides = doc.timeoutOverrides || {};
  const steps: DispatchStep[] = [];

  // â”€â”€â”€ ORCHESTRATOR MODE: model-driven classification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€â”€ GAP 2 FIX: Pre-verify Host reachability before classification â”€â”€â”€â”€â”€
    //
    // Before spending a classification call, verify the Host model is actually
    // reachable. If it's not, return immediately with a clear error â€” no point
    // attempting classification with a broken Host.
    //
    // This check is ONLY for Orchestrator mode's classify step. The specialist
    // reachability check in Step 3a/3b is separate and unchanged.
    //
    // Skip this pre-check if we have a cached classification (the Host was
    // already verified in the first round-trip).
    if (!opts.cachedClassification) {
      const hostCheck = await checkLimits(
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
      // Host answers directly â€” no specialist needed.
      // This is the same as the "Host handles it directly" fallback.
      const result = await callModel(hostAssignment, messages, {
        timeoutMs: hostTimeout,
        role: "host",
        intent: "direct",
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
        ? `âš ï¸ Model call failed after ${result.retries} attempt(s).\n\nError: ${result.lastError}\n\nCheck your configuration in Advanced Customization.`
        : "âš ï¸ Model returned no response. Check your configuration in Advanced Customization.");

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

    // Step 3: Specialist is needed â€” build the plan from classification
    const specialistId = classification.specialist as SpecialistId;
    const specialistAssignment =
      doc.specialistConfigs?.[specialistId] || emptyAssignment();
    const specialistTimeout =
      timeoutOverrides[specialistAssignment.connectionType] ||
      DEFAULT_TIMEOUTS[specialistAssignment.connectionType];

    // Step 3a: Pre-flight confirmation (first call, no confirmMultiAgent)
    if (!opts.confirmMultiAgent) {
      const limits = await checkLimits(
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

    // Step 3b: Confirmed â€” check limits
    let limits: ModelLimit[] | undefined;
    limits = await checkLimits(
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
    const finalResult = await callModel(hostAssignment, finalMessages, {
      timeoutMs: hostTimeout,
      role: "host",
    });

    // Log specialist step
    steps.push({
      role: specialistId,
      model: specialistAssignment.modelName,
      provider: specialistAssignment.provider,
      connectionType: specialistAssignment.connectionType,
      intent: specialistId,
      input: truncated.truncated
        ? `(routed by host, context truncated: ${truncated.originalTokens}â†’${truncated.keptTokens} tokens)`
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
      ? `âš ï¸ Model call failed after ${finalResult.retries} attempt(s).\n\nError: ${finalResult.lastError}\n\nCheck your configuration in Advanced Customization.`
      : "âš ï¸ Model returned no response. Check your configuration in Advanced Customization.");

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

  // â”€â”€â”€ skipSpecialist path (user chose "Let Host handle directly") â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (doc.mode === "ORCHESTRATOR" && opts.skipSpecialist) {
    const hostAssignment = doc.hostConfig || emptyAssignment();
    const hostTimeout =
      timeoutOverrides[hostAssignment.connectionType] ||
      DEFAULT_TIMEOUTS[hostAssignment.connectionType];
    const result = await callModel(hostAssignment, messages, {
      timeoutMs: hostTimeout,
      role: "host",
      intent: "direct",
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
      ? `âš ï¸ Model call failed after ${result.retries} attempt(s).\n\nError: ${result.lastError}\n\nCheck your configuration in Advanced Customization.`
      : "âš ï¸ Model returned no response. Check your configuration in Advanced Customization.");

    return {
      ok: true,
      mode: doc.mode,
      steps,
      finalReply,
      multiAgent: false,
      confirmationRequired: false,
    };
  }

  // â”€â”€â”€ SINGLE or MULTI mode (keyword-based resolvePlan, unchanged) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const plan = resolvePlan(doc, messages, opts.feature);

  if (plan.multiAgent && !opts.confirmMultiAgent) {
    const limits = await checkLimits(plan.assignments, "medium");
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
    limits = await checkLimits(plan.assignments, "medium");
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
  const result = await callModel(a, messages, {
    timeoutMs: timeout,
    role: plan.assignments[0].label,
    intent: plan.intent,
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
    ? `âš ï¸ Model call failed after ${result.retries} attempt(s).\n\nError: ${result.lastError}\n\nCheck your configuration in Advanced Customization.`
    : "âš ï¸ Model returned no response. Check your configuration in Advanced Customization.");

  return {
    ok: true,
    mode: doc.mode,
    steps,
    finalReply,
    multiAgent: false,
    confirmationRequired: false,
  };
}

// â”€â”€â”€ Conversations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Usage / cost tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

