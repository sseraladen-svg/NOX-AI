import { authFetch } from "@/lib/auth-fetch";
import { getGuestSessionId } from "@/lib/local-storage";
import { normalizeEndpoint } from "@/lib/local-ollama";
import { useMultiModel } from "@/store/multi-model-store";
import type { ModelAssignment } from "@/lib/multi-model-types";
import type { AgentMsg } from "./agent-runner.ts";
import type { AgentRole } from "./agent-prompts.ts";

type Resolved = { role: AgentRole | "host"; assignment: ModelAssignment; label: string };

const FALLBACK: Record<AgentRole, (AgentRole | "host")[]> = {
  planning: ["planning", "coding", "host"],
  coding: ["coding", "host", "engineering", "planning"],
  engineering: ["engineering", "coding", "planning", "host"],
};

function usable(a: ModelAssignment | null | undefined, guest: boolean): a is ModelAssignment {
  if (!a) return false;
  if (a.connectionType === "LOCAL") return a.provider === "ollama" && !!(a.localModelName || a.modelName);
  return !guest && !!a.apiKey;
}

const modelOf = (a: ModelAssignment) => (a.connectionType === "LOCAL" ? a.localModelName || a.modelName : a.modelName);

/** Picks the configured model for a role, falling back (coding → host …) when one is unusable. */
export function resolveRole(role: AgentRole): Resolved {
  const { hostConfig, specialistConfigs } = useMultiModel.getState();
  const guest = Boolean(getGuestSessionId());
  for (const r of FALLBACK[role]) {
    const a = r === "host" ? hostConfig : specialistConfigs?.[r];
    if (usable(a, guest)) return { role: r, assignment: a, label: `${r === role ? "" : `${r} → `}${modelOf(a)}` };
  }
  throw new Error(
    "No usable model for the agent. Open Advanced settings and set Coding to a local Ollama model (Local CLI) or to an API model with a key, then Save."
  );
}

export const describeRole = (role: AgentRole): string => {
  try {
    return resolveRole(role).label;
  } catch {
    return "no model";
  }
};

function anySignal(signals: AbortSignal[]): AbortSignal {
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) c.abort();
    else s.addEventListener("abort", () => c.abort(), { once: true });
  }
  return c.signal;
}

async function ollamaChat(a: ModelAssignment, system: string, messages: AgentMsg[], onToken?: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const base = normalizeEndpoint(a.localEndpoint || a.endpoint || "http://127.0.0.1:11434");
  const timeout = AbortSignal.timeout(10 * 60_000);
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelOf(a),
        stream: true,
        messages: [{ role: "system", content: system }, ...messages],
        // Larger context than Ollama's default so the file tree + files fit; low temperature for precise edits.
        options: { num_ctx: 8192, temperature: 0.2, num_predict: 4096 },
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

export async function callAgentModel(role: AgentRole, system: string, messages: AgentMsg[], onToken?: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const r = resolveRole(role);
  if (r.assignment.connectionType === "LOCAL") return ollamaChat(r.assignment, system, messages, onToken, signal);
  const res = await authFetch("/api/workspace/agent-turn", { method: "POST", signal, body: { role: r.role, system, messages } });
  const j = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null;
  if (!res.ok || !j?.ok) throw new Error(j?.error ?? `Model request failed (HTTP ${res.status})`);
  onToken?.(j.text ?? "");
  return j.text ?? "";
}
