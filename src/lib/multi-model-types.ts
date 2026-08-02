// ───────────────────────────────────────────────────────────────────────────
// NOX AI — Multi-Model types & constants (shared, client-safe)
//
// This file is imported by both client and server code. It MUST NOT import
// anything server-only (no db, no z-ai-web-dev-sdk, no fs, no crypto).
// All runtime logic lives in multi-model-service.ts (server-only).
// ───────────────────────────────────────────────────────────────────────────

export type ConnectionType = "LOCAL" | "API";
export type Mode = "SINGLE" | "MULTI" | "ORCHESTRATOR";

export type FeatureId =
  | "chat"
  | "voice"
  | "vision"
  | "coding"
  | "automation"
  | "robotics";

export type SpecialistId =
  | "planning"
  | "coding"
  | "vision"
  | "automation"
  | "robotics";

export interface ModelAssignment {
  connectionType: ConnectionType;
  provider: string;
  modelName: string;
  apiKey?: string;
  endpoint?: string;
  cliPath?: string;
  cliArgs?: string;
  status?: "untested" | "ready" | "error";
  statusMessage?: string;
  version?: string;
}

export interface MultiModelConfigDoc {
  mode: Mode;
  globalConfig?: ModelAssignment | null;
  featureConfigs?: Partial<Record<FeatureId, ModelAssignment>>;
  hostConfig?: ModelAssignment | null;
  specialistConfigs?: Partial<Record<SpecialistId, ModelAssignment>>;
  timeoutOverrides?: {
    LOCAL?: number;
    API?: number;
  };
}

export interface TestResult {
  ok: boolean;
  status: "ready" | "error";
  message: string;
  reason?: string;
  fixSteps?: string[];
  version?: string;
  latencyMs?: number;
}

export interface ModelLimit {
  id: string;
  label: string;
  connectionType: ConnectionType;
  provider: string;
  modelName: string;
  remainingQuota?: number;
  rateLimitPerMin?: number;
  remainingTokens?: number;
  busy?: boolean;
  estimatedCapacity?: number;
  canFinish: boolean;
  reason?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  // Optional image attachment (base64 data URL) for vision-capable models.
  // When present, the provider call functions format this as a multimodal
  // request (text + image) for OpenAI/Anthropic/Gemini.
  image?: {
    data: string;    // base64-encoded data (no data: prefix)
    mimeType: string; // e.g. "image/jpeg", "image/png"
  };
}

export interface DispatchStep {
  role: string;
  model: string;
  provider: string;
  connectionType: ConnectionType;
  intent?: string;
  input: string;
  output: string;
  latencyMs: number;
  retries: number;
  timedOut: boolean;
  lastError?: string;
  // Heartbeat extensions (LOCAL calls only): number of times the timeout
  // was reset because the model was still actively producing output.
  heartbeats?: number;
  // Cost tracking (populated when connectionType === "API" and the provider
  // returns usage metadata; LOCAL models have no cost)
  tokens?: TokenUsage;
  cost?: CostBreakdown;
}

// Token usage returned by the provider after a successful call.
export interface TokenUsage {
  input: number;   // prompt tokens
  output: number;  // completion tokens
  total: number;   // input + output
}

// Cost breakdown for a single model call (in USD).
export interface CostBreakdown {
  input: number;   // $ for input tokens
  output: number;  // $ for output tokens
  total: number;   // input + output
}

// Pricing for a model — USD per 1 million tokens.
export interface ModelPricing {
  inputPer1M: number;   // $ per 1M input tokens
  outputPer1M: number;  // $ per 1M output tokens
}

// Result of the Host model's intent classification call.
// The Host analyzes the user's message and outputs this as JSON.
export interface IntentClassification {
  specialist: SpecialistId | "none";
  confidence: number;   // 0.0 - 1.0
  reasoning: string;    // one sentence explaining the routing decision
}

export interface DispatchResult {
  ok: boolean;
  mode: Mode;
  steps: DispatchStep[];
  finalReply: string;
  multiAgent: boolean;
  confirmationRequired: boolean;
  limits?: ModelLimit[];
  // When the Host classified the intent, this is included so the
  // confirmation dialog can show WHY it routed to a specialist.
  classification?: IntentClassification;
  error?: string;
}

// ─── Catalogs ──────────────────────────────────────────────────────────────

export const FEATURES: {
  id: FeatureId;
  label: string;
  description: string;
}[] = [
  { id: "chat", label: "Chat", description: "General conversation & Q&A." },
  {
    id: "voice",
    label: "Voice",
    description: "Speech-to-text & text-to-speech.",
  },
  {
    id: "vision",
    label: "Vision",
    description: "Image understanding & OCR.",
  },
  { id: "coding", label: "Coding", description: "Code generation & review." },
  {
    id: "automation",
    label: "Automation",
    description: "Workflow & task chaining.",
  },
  {
    id: "robotics",
    label: "Robotics",
    description: "Physical/motion control plans.",
  },
];

export const SPECIALISTS: {
  id: SpecialistId;
  label: string;
  description: string;
}[] = [
  {
    id: "planning",
    label: "Planning",
    description: "Decomposes goals into steps.",
  },
  { id: "coding", label: "Coding", description: "Writes & reviews code." },
  {
    id: "vision",
    label: "Vision",
    description: "Interprets images / diagrams.",
  },
  {
    id: "automation",
    label: "Automation",
    description: "Chains tools & APIs.",
  },
  {
    id: "robotics",
    label: "Robotics",
    description: "Plans physical actions.",
  },
];

export const PROVIDERS = [
  {
    id: "auto",
    label: "Auto-detect",
    connectionType: "API" as ConnectionType,
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini"],
  },
  {
    id: "openai",
    label: "OpenAI",
    connectionType: "API" as ConnectionType,
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-mini"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    connectionType: "API" as ConnectionType,
    defaultModel: "openai/gpt-4o-mini",
    models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-exp"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    connectionType: "API" as ConnectionType,
    defaultModel: "claude-3-5-sonnet-latest",
    models: [
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-opus-latest",
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    connectionType: "API" as ConnectionType,
    defaultModel: "mistral-large-latest",
    models: ["mistral-large-latest", "mistral-small-latest"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    connectionType: "API" as ConnectionType,
    defaultModel: "gemini-1.5-flash",
    models: [
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
      "gemini-1.5-pro",
      "gemini-2.0-flash",
      "gemini-2.0-flash-exp",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ],
  },
  {
    id: "groq",
    label: "Groq",
    connectionType: "API" as ConnectionType,
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  },
  {
    id: "zai",
    label: "Z.ai (Built-in, No Key Needed)",
    connectionType: "API" as ConnectionType,
    defaultModel: "glm-4-flash",
    models: ["glm-4-flash", "glm-4"],
  },
  {
    id: "ollama",
    label: "Ollama (Local CLI)",
    connectionType: "LOCAL" as ConnectionType,
    defaultModel: "llama3.1:8b",
    models: ["llama3.1:8b", "llama3.1:70b", "qwen2.5:7b", "mistral-nemo"],
  },
  {
    id: "llamacpp",
    label: "llama.cpp (Local CLI)",
    connectionType: "LOCAL" as ConnectionType,
    defaultModel: "local-model.gguf",
    models: ["local-model.gguf"],
  },
  {
    id: "llamafile",
    label: "llamafile (Local CLI)",
    connectionType: "LOCAL" as ConnectionType,
    defaultModel: "local-model.llamafile",
    models: ["local-model.llamafile"],
  },
];

export const DEFAULT_TIMEOUTS = {
  LOCAL: 120_000,
  API: 30_000,
} as const;

export const MAX_RETRY = 2;

// ─── Pricing table ─────────────────────────────────────────────────────────
//
// USD per 1 million tokens. Sourced from each provider's public pricing page.
// LOCAL models (ollama, llamacpp, llamafile) have zero marginal cost.
//
// When a provider returns token usage, we multiply by these rates to compute
// the cost of each call. Unknown models fall back to a sane default.
//
// IMPORTANT: keep this updated as providers change pricing. The fallback for
// unknown models is intentionally conservative (median API price).
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI — https://openai.com/api/pricing/
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4-turbo": { inputPer1M: 10, outputPer1M: 30 },
  "o1-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },

  // Anthropic — https://www.anthropic.com/pricing
  "claude-3-5-sonnet-latest": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-haiku-latest": { inputPer1M: 0.8, outputPer1M: 4 },
  "claude-3-opus-latest": { inputPer1M: 15, outputPer1M: 75 },

  // Google Gemini — https://ai.google.dev/pricing
  "gemini-1.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
  "gemini-1.5-flash-8b": { inputPer1M: 0.0375, outputPer1M: 0.15 },
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gemini-2.0-flash-exp": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
  "gemini-2.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },

  // Mistral — https://mistral.ai/products/la-plateforme#pricing
  "mistral-large-latest": { inputPer1M: 2, outputPer1M: 6 },
  "mistral-small-latest": { inputPer1M: 0.2, outputPer1M: 0.6 },

  // Groq — https://groq.com/pricing/
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "llama-3.1-8b-instant": { inputPer1M: 0.05, outputPer1M: 0.08 },

  // Z.ai — built-in, very low cost
  "glm-4-flash": { inputPer1M: 0.01, outputPer1M: 0.01 },
  "glm-4": { inputPer1M: 0.1, outputPer1M: 0.1 },
};

// Fallback for unknown models — conservative median API price.
export const DEFAULT_PRICING: ModelPricing = {
  inputPer1M: 1,
  outputPer1M: 3,
};

// Look up pricing for a model name. Returns DEFAULT_PRICING if unknown.
export function getPricing(modelName: string): ModelPricing {
  return MODEL_PRICING[modelName] || DEFAULT_PRICING;
}

// Compute cost (USD) from token usage + model name.
export function computeCost(
  tokens: TokenUsage,
  modelName: string
): CostBreakdown {
  const pricing = getPricing(modelName);
  const input = (tokens.input / 1_000_000) * pricing.inputPer1M;
  const output = (tokens.output / 1_000_000) * pricing.outputPer1M;
  return {
    input: Math.round(input * 1_000_000) / 1_000_000, // 6 decimal places
    output: Math.round(output * 1_000_000) / 1_000_000,
    total: Math.round((input + output) * 1_000_000) / 1_000_000,
  };
}
