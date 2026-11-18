import { authFetch } from "@/lib/auth-fetch";
import { getGuestSessionId } from "@/lib/local-storage";
import { listOllamaModels, normalizeEndpoint } from "@/lib/local-ollama";
import { useMultiModel } from "@/store/multi-model-store";
import type { ModelAssignment } from "@/lib/multi-model-types";
import type { AgentMsg, CallBudget } from "./agent-runner.ts";
import type { AgentRole } from "./agent-prompts.ts";
import { type Availability, type Complexity, type Intent, type Source, modelQuality } from "./agent-routing.ts";
import { HOST_CLASSIFY_SYSTEM, parseHostClassification } from "./classify.ts";

type Resolved = { source: Source; assignment: ModelAssignment; label: string };

const FALLBACK: Record<AgentRole, Source[]> = {
  planning: ["planning", "coding", "host"],
  coding: ["coding", "automation", "host", "engineering", "planning"],
  automation: ["automation", "coding", "host", "engineering", "planning"],
  engineering: ["engineering", "coding", "planning", "host"],
};

const assignmentFor = (s: Source): ModelAssignment | null | undefined => {
  const { hostConfig, specialistConfigs } = useMultiModel.getState();
  return s === "host" ? hostConfig : specialistConfigs?.[s];
};

function usable(a: ModelAssignment | null | undefined, guest: boolean): a is ModelAssignment {
  if (!a) return false;
  if (a.connectionType === "LOCAL") return a.provider === "ollama" && !!(a.localModelName || a.modelName);
  return !guest && !!a.apiKey;
}

export const modelOf = (a: ModelAssignment) => (a.connectionType === "LOCAL" ? a.localModelName || a.modelName : a.modelName);

/** The configured model for a role (or the user's chosen source), falling back down the chain. */
export function resolveRole(role: AgentRole, source?: Source | null): Resolved {
  const guest = Boolean(getGuestSessionId());
  const order = source ? [source, ...FALLBACK[role]] : FALLBACK[role];
  for (const s of order) {
    const a = assignmentFor(s);
    if (usable(a, guest) && (a.connectionType !== "LOCAL" || modelQuality(modelOf(a)).ok || s === source)) {
      return { source: s, assignment: a, label: `${s === role ? "" : `${s} → `}${modelOf(a)}` };
    }
  }
  throw new Error("No usable model for the agent. Open Advanced settings and set Coding to a local Ollama model (Local CLI) or an API model with a key, then Save.");
}

export const describeRole = (role: AgentRole, source?: Source | null): string => {
  try {
    return resolveRole(role, source).label;
  } catch {
    return "no model";
  }
};

/** Live check of every agent model: configured? reachable? installed? suitable? */
export async function checkAvailability(): Promise<Availability[]> {
  const guest = Boolean(getGuestSessionId());
  const sources: Source[] = ["host", "planning", "coding", "automation", "engineering"];
  const cache = new Map<string, string[]>();
  const out: Availability[] = [];
  for (const source of sources) {
    const a = assignmentFor(source);
    if (!a) {
      out.push({ source, model: "—", kind: "none", status: "unavailable", note: "Not configured." });
      continue;
    }
    const model = modelOf(a) || "—";
    if (a.connectionType === "API") {
      out.push(guest
        ? { source, model, kind: "api", status: "unavailable", note: "Sign in to use API models in the agent." }
        : a.apiKey
          ? { source, model, kind: "api", status: "ready", note: "API key is set (not tested here)." }
          : { source, model, kind: "api", status: "unavailable", note: "No API key saved." });
      continue;
    }
    if (a.provider !== "ollama") {
      out.push({ source, model, kind: "unsupported", status: "unavailable", note: `${a.provider} cannot be used by the Agent tab. Use Ollama or an API model.` });
      continue;
    }
    const endpoint = normalizeEndpoint(a.localEndpoint || a.endpoint || "http://127.0.0.1:11434");
    if (!cache.has(endpoint)) cache.set(endpoint, await listOllamaModels(endpoint));
    const installed = cache.get(endpoint)!;
    if (installed.length === 0) {
      out.push({ source, model, kind: "ollama", status: "unavailable", installed, note: `Ollama is not reachable at ${endpoint}. Is it running, and is OLLAMA_ORIGINS set to this site?` });
      continue;
    }
    const has = installed.some((n) => n === model || n === `${model}:latest` || n.replace(/:latest$/, "") === model);
    if (!has) {
      out.push({ source, model, kind: "ollama", status: "unavailable", installed, note: `Model not installed. Run: ollama pull ${model}` });
      continue;
    }
    const q = modelQuality(model);
    out.push({ source, model, kind: "ollama", status: q.ok ? "ready" : "warn", caution: !!q.warn, installed, note: q.warn ?? "Installed and reachable." });
  }
  return out;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) c.abort();
    else s.addEventListener("abort", () => c.abort(), { once: true });
  }
  return c.signal;
}

// Context window sized to the real prompt (plus room for the answer) so nothing is silently cut off.
function ctxFor(chars: number, budget?: CallBudget): number {
  const need = Math.ceil(chars / 3.2) + (budget?.maxOut ?? 4096);
  return [4096, 8192, 16384, 32768].find((c) => c >= need && c >= (budget?.ctx ?? 0)) ?? 32768;
}

async function ollamaChat(a: ModelAssignment, system: string, messages: AgentMsg[], onToken?: (t: string) => void, signal?: AbortSignal, budget?: CallBudget): Promise<string> {
  const base = normalizeEndpoint(a.localEndpoint || a.endpoint || "http://127.0.0.1:11434");
  const timeout = AbortSignal.timeout(10 * 60_000);
  const chars = system.length + messages.reduce((n, m) => n + m.content.length, 0);
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelOf(a),
        stream: true,
        messages: [{ role: "system", content: system }, ...messages],
        options: { num_ctx: ctxFor(chars, budget), temperature: 0.2, num_predict: budget?.maxOut ?? 4096 },
      }),
      signal: signal ? anySignal([signal, timeout]) : timeout,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Could not reach Ollama at ${base}. Is it running, and is OLLAMA_ORIGINS set to this site's URL?`);
  }
  if (!res.ok || !res.body) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let carry = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    carry += dec.decode(value, { stream: true });
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const j = JSON.parse(line) as { message?: { content?: string }; error?: string };
      if (j.error) throw new Error(`Ollama: ${j.error}`);
      const t = j.message?.content;
      if (t) {
        text += t;
        onToken?.(t);
      }
    }
  }
  return text;
}

async function invoke(r: Resolved, system: string, messages: AgentMsg[], onToken?: (t: string) => void, signal?: AbortSignal, budget?: CallBudget): Promise<string> {
  if (r.assignment.connectionType === "LOCAL") return ollamaChat(r.assignment, system, messages, onToken, signal, budget);
  const res = await authFetch("/api/workspace/agent-turn", { method: "POST", signal, body: { role: r.source, system, messages, maxTokens: budget?.maxOut ?? 4096 } });
  const j = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null;
  if (!res.ok || !j?.ok) throw new Error(j?.error ?? `Model request failed (HTTP ${res.status})`);
  onToken?.(j.text ?? "");
  return j.text ?? "";
}

export async function callAgentModel(
  role: AgentRole,
  system: string,
  messages: AgentMsg[],
  onToken?: (t: string) => void,
  signal?: AbortSignal,
  opts: { source?: Source | null; budget?: CallBudget } = {}
): Promise<string> {
  return invoke(resolveRole(role, opts.source), system, messages, onToken, signal, opts.budget);
}

/** Optional fallback when the rules are unsure: one tiny Host call. Returns null if the Host is missing or unsuitable. */
export async function classifyWithHost(task: string, signal?: AbortSignal): Promise<{ intent: Intent; complexity: Complexity; model: string } | null> {
  const a = assignmentFor("host");
  if (!usable(a, Boolean(getGuestSessionId())) || !modelQuality(modelOf(a)).ok) return null;
  try {
    const text = await invoke({ source: "host", assignment: a, label: "host" }, HOST_CLASSIFY_SYSTEM, [{ role: "user", content: task.slice(0, 600) }], undefined, signal, { ctx: 2048, maxOut: 60 });
    const parsed = parseHostClassification(text);
    return parsed ? { ...parsed, model: modelOf(a) } : null;
  } catch {
    return null;
  }
}
