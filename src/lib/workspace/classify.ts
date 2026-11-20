import type { Complexity, Intent } from "./agent-routing.ts";

/** Tiny prompt for the optional Host-model fallback (used only when the rules are unsure). */
export const HOST_CLASSIFY_SYSTEM = `You classify coding requests for an editor assistant. Reply with ONE line of JSON and nothing else:
{"intent":"explain|create|modify|cleanup|automation|plan","size":"small|medium|large"}
explain = question about code; create = new files/app; modify = change/fix existing code; cleanup = delete/remove; automation = workflow/script chaining; plan = only a plan. size: small = one file or tiny change, medium = a few files, large = a full app or many files.`;

const INTENTS = new Set(["explain", "create", "modify", "cleanup", "automation", "plan"]);
const SIZES = new Set(["small", "medium", "large"]);

export function parseHostClassification(text: string): { intent: Intent; complexity: Complexity } | null {
  const m = /\{[^{}]*\}/.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { intent?: string; size?: string };
    if (!j.intent || !j.size || !INTENTS.has(j.intent) || !SIZES.has(j.size)) return null;
    return { intent: j.intent as Intent, complexity: j.size as Complexity };
  } catch {
    return null;
  }
}
