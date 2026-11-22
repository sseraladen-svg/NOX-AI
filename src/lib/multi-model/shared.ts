import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { assertSafeEndpoint } from "@/lib/endpoint-guard";
import type { ChatMessage, FeatureId, ModelAssignment } from "@/lib/multi-model-types";

export const SCOPE = "default";
export const tokenBudget = new AsyncLocalStorage<number>();
export const maxTok = () => tokenBudget.getStore() ?? 1024;

export const FEATURE_BUILTIN_RULES: Record<FeatureId, string> = {
  "deep-analysis":
    "You are an expert analyst. Provide comprehensive, structured analysis. Break down complex problems. Cite evidence. Identify assumptions. Output in clear sections with headers. Be thorough but concise. Provide a concise rationale summary and key steps rather than private internal reasoning.",
  coding:
    "Output ONLY valid, production-ready code in markdown blocks. Do not provide explanations or conversational fluff unless explicitly asked.",
  vision:
    "Output structured, objective, and concise visual analysis. Prioritize defect detection and spatial relationships. No fluff. End with a fenced nox-vision JSON block containing {\"regions\":[{\"label\":\"...\",\"kind\":\"defect|object\",\"x\":0,\"y\":0,\"width\":0,\"height\":0}]}; use normalized coordinates from 0 to 1, and include only regions you can visually ground. Return an empty regions array when coordinates are uncertain.",
  voice:
    "Output concise, natural language suitable for text-to-speech conversion. Keep sentences short.",
  robotics:
    "Output precise, low-level motion or control instructions. Prioritize safety constraints and efficiency. End with a fenced nox-robotics JSON block containing {\"units\":\"mm\",\"waypoints\":[{\"label\":\"...\",\"x\":0,\"y\":0,\"z\":0}],\"safetyWarnings\":[]}; coordinates must be finite and physically justified, and uncertain values must be called out rather than invented. This is a plan only, not hardware control.",
};

// Helper to normalize localhost to 127.0.0.1 to avoid IPv6 resolution issues
// On Windows, Node.js often resolves "localhost" to ::1 (IPv6) but Ollama only listens on IPv4
function normalizeOllamaEndpoint(endpoint?: string): string {
  const base = endpoint || "http://127.0.0.1:11434";
  return base.replace("://localhost", "://127.0.0.1");
}

// Helper to resolve the correct endpoint field based on connection type
// This is the single source of truth for which endpoint field to use
function resolveEndpoint(a: ModelAssignment): string | undefined {
  const raw = a.connectionType === "API" ? a.apiEndpoint : a.localEndpoint;
  // LOCAL endpoints (Ollama bridge) legitimately use 127.0.0.1; only API endpoints must be public.
  return raw ? assertSafeEndpoint(raw, a.connectionType === "API") : raw;
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


// Rough token estimate: ~4 characters per token (industry-standard heuristic
// for English text). This is not exact but good enough for deciding when to
// truncate. The actual token count comes from the provider's response usage
// metadata, which we use for cost tracking.
const CHARS_PER_TOKEN = 4;
// Default context budget for specialist calls. Most models support 8K-128K
// tokens; we use a conservative 6K budget to leave room for the system prompt
// + the specialist's response. This prevents token-limit errors on long convos.
export const DEFAULT_SPECIALIST_TOKEN_BUDGET = 6000;

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


export { normalizeOllamaEndpoint, resolveEndpoint, migrateEndpoint, emptyAssignment, estimateTokens, estimateMessagesTokens, truncateForContext };
