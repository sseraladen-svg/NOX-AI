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
}

export interface DispatchResult {
  ok: boolean;
  mode: Mode;
  steps: DispatchStep[];
  finalReply: string;
  multiAgent: boolean;
  confirmationRequired: boolean;
  limits?: ModelLimit[];
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
    id: "openai",
    label: "OpenAI",
    connectionType: "API" as ConnectionType,
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-mini"],
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
  LOCAL: 60_000,
  API: 30_000,
} as const;

export const MAX_RETRY = 2;
