import type {
  ChatMessage,
  ModelAssignment,
  MultiModelConfigDoc,
} from "@/lib/multi-model-types";

export class GuestRequestTooLargeError extends Error {
  constructor() {
    super("Guest request exceeds the allowed size.");
    this.name = "GuestRequestTooLargeError";
  }
}

export async function readGuestJson(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Guest request body is required.");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new GuestRequestTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

const API_PROVIDERS = new Set([
  "openai",
  "openrouter",
  "anthropic",
  "gemini",
  "mistral",
  "groq",
  "zai",
  "auto",
]);
const MODES = new Set(["SINGLE", "MULTI", "ORCHESTRATOR"]);
const FEATURES = new Set([
  "chat",
  "voice",
  "vision",
  "coding",
  "automation",
  "robotics",
]);
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidGuestSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export function sanitizeGuestAssignment(value: unknown): ModelAssignment | null {
  if (!value || typeof value !== "object") return null;
  const assignment = value as Partial<ModelAssignment>;
  if (
    typeof assignment.modelName !== "string" ||
    !assignment.modelName.trim() ||
    assignment.modelName.length > 200
  ) {
    throw new Error("Choose a valid model before using guest mode.");
  }

  if (assignment.connectionType === "API") {
    if (
      typeof assignment.provider !== "string" ||
      !API_PROVIDERS.has(assignment.provider.toLowerCase())
    ) {
      throw new Error("This provider is not available in guest mode.");
    }
    if (
      typeof assignment.apiKey !== "string" ||
      !assignment.apiKey.trim() ||
      assignment.apiKey.length > 8192
    ) {
      throw new Error("Enter an API key for each hosted model in guest mode.");
    }
    if (assignment.apiEndpoint || assignment.endpoint) {
      throw new Error(
        "Custom API endpoints require an account. Guest mode supports built-in provider endpoints."
      );
    }
    return {
      connectionType: "API",
      provider: assignment.provider.toLowerCase(),
      modelName: assignment.modelName.trim(),
      apiKey: assignment.apiKey.trim(),
    };
  }

  if (assignment.connectionType === "LOCAL" && assignment.provider === "ollama") {
    const localEndpoint =
      assignment.localEndpoint || assignment.endpoint || "http://127.0.0.1:11434";
    if (localEndpoint.length > 500) {
      throw new Error("The local Ollama endpoint is too long.");
    }
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(localEndpoint);
    } catch {
      throw new Error("Enter a valid local Ollama endpoint.");
    }
    if (
      !["http:", "https:"].includes(parsedEndpoint.protocol) ||
      parsedEndpoint.username ||
      parsedEndpoint.password
    ) {
      throw new Error("Enter a valid local Ollama endpoint.");
    }
    return {
      connectionType: "LOCAL",
      provider: "ollama",
      modelName: assignment.modelName.trim(),
      localEndpoint: localEndpoint.replace(/\/+$/, ""),
    };
  }

  throw new Error("Guest mode supports hosted providers and local Ollama.");
}

export function sanitizeGuestConfig(
  value: unknown,
  requestedFeature?: keyof NonNullable<MultiModelConfigDoc["featureConfigs"]>
): MultiModelConfigDoc {
  if (requestedFeature && !FEATURES.has(requestedFeature)) {
    throw new Error("The requested guest feature is invalid.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Model configuration is required for guest requests.");
  }
  const config = value as Partial<MultiModelConfigDoc>;
  if (typeof config.mode !== "string" || !MODES.has(config.mode)) {
    throw new Error("Choose a valid mode before using guest mode.");
  }
  if (config.mode === "ORCHESTRATOR") {
    throw new Error("Orchestrator mode requires an account and is unavailable to guests.");
  }

  const timeoutOverrides: MultiModelConfigDoc["timeoutOverrides"] = {};
  for (const type of ["LOCAL", "API"] as const) {
    const timeout = config.timeoutOverrides?.[type];
    if (timeout !== undefined) {
      if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) {
        throw new Error("Model timeouts must be between 1 and 300 seconds.");
      }
      timeoutOverrides[type] = timeout;
    }
  }

  const selectedFeature = requestedFeature || "chat";
  const featureConfigs: MultiModelConfigDoc["featureConfigs"] =
    config.mode === "MULTI"
      ? {
          [selectedFeature]: sanitizeGuestAssignment(
            config.featureConfigs?.[selectedFeature]
          ),
        }
      : undefined;

  return {
    mode: config.mode,
    globalConfig:
      config.mode === "SINGLE"
        ? sanitizeGuestAssignment(config.globalConfig)
        : undefined,
    featureConfigs,
    timeoutOverrides,
  };
}

export function validateGuestMessages(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    return false;
  }
  let totalLength = 0;
  for (const message of value) {
    if (
      !message ||
      typeof message !== "object" ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      message.content.length > 20000
    ) {
      return false;
    }
    totalLength += message.content.length;
    if (message.image) {
      if (
        message.role !== "user" ||
        typeof message.image.data !== "string" ||
        message.image.data.length > 8_000_000 ||
        typeof message.image.mimeType !== "string" ||
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
          message.image.mimeType
        ) ||
        !new RegExp(
          `^data:${message.image.mimeType.replace("/", "\\/")};base64,[A-Za-z0-9+/]+={0,2}$`
        ).test(message.image.data)
      ) {
        return false;
      }
    }
  }
  return totalLength <= 100000;
}

export function hideGuestUsage<T>(result: T): T {
  const usageFields = new Set([
    "apiKey",
    "cost",
    "inputTokens",
    "latencyMs",
    "outputTokens",
    "retries",
    "timedOut",
    "tokens",
    "totalCost",
    "totalTokens",
    "usage",
  ]);
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !usageFields.has(key))
        .map(([key, child]) => [key, redact(child)])
    );
  };
  return redact(result) as T;
}
