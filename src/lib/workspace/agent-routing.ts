// Rules-based analysis of a task (no model call): what is being asked, how big it is, and which
// agents are needed. Also availability/alternative logic for the confirmation popup. Pure.
import type { AgentRole } from "./agent-prompts.ts";

export type Source = "host" | "planning" | "coding" | "automation" | "engineering" | "vision";
export type Intent = "explain" | "create" | "modify" | "cleanup" | "automation" | "plan" | "vision" | "general";
export type Complexity = "small" | "medium" | "large";

export interface PlannedStep {
  id: "plan" | "build" | "review";
  role: AgentRole;
  label: string;
  required: boolean;
  enabled: boolean;
  reason: string;
}

export interface Analysis {
  intent: Intent;
  complexity: Complexity;
  confidence: number;
  readOnly: boolean;
  planOnly: boolean;
  autoFinish: boolean;
  steps: PlannedStep[];
  maxSteps: number;
  budget: { ctx: number; maxOut: number };
  estimate: string;
  notes: string[];
}

const RE = {
  explain: /\b(explain|what does|what is|how does|how do|why|summari[sz]e|describe|walk me through|understand|tell me about)\b/,
  create: /\b(create|build|make|generate|write|implement|add|scaffold|set up|develop)\b/,
  modify: /\b(fix|bug|error|broken|refactor|change|update|rename|improve|optimi[sz]e|convert|migrate|replace|simplify|clean ?up code)\b/,
  cleanup: /\b(delete|remove|drop|get rid|unused|clean ?up)\b/,
  automation: /\b(automat\w*|workflow|pipeline|schedule|cron|batch|webhook|integrat\w*)\b/,
  plan: /\b(plan|roadmap|architecture|design|strategy|break ?down|steps (to|for))\b/,
  vision: /\b(image|screenshot|photo|picture|ocr|diagram|mockup)\b/,
  big: /\b(app|application|project|website|full[- ]?stack|system|api|backend|frontend|multiple|several|whole|entire|all files|platform)\b/,
};

export function analyzeTask(task: string, ctx: { fileCount: number }): Analysis {
  const t = task.toLowerCase();
  const hit = (r: RegExp) => (t.match(new RegExp(r.source, "g")) ?? []).length;
  const scores: [Intent, number][] = [
    ["modify", hit(RE.modify)],
    ["create", hit(RE.create)],
    ["explain", hit(RE.explain)],
    ["cleanup", hit(RE.cleanup) && !RE.create.test(t) ? hit(RE.cleanup) : 0],
    ["automation", hit(RE.automation)],
    ["plan", RE.plan.test(t) && !RE.create.test(t) && !RE.modify.test(t) ? hit(RE.plan) : 0],
  ];
  // Questions about the code beat generic verbs ("why does this fail" is a question).
  if (/^(why|what|how|explain|describe|summari[sz]e|tell me)\b/.test(t.trim()) && !RE.create.test(t)) scores.push(["explain", 3]);
  scores.sort((a, b) => b[1] - a[1]);
  const [top, second] = [scores[0], scores[1]];
  const notes: string[] = [];
  let intent: Intent = top[1] > 0 ? top[0] : "general";
  if (intent === "general") intent = ctx.fileCount > 0 ? "modify" : "create";
  const confidence = top[1] === 0 ? 0.4 : Math.min(0.95, Math.max(0.45, 0.5 + 0.15 * top[1] - 0.1 * second[1]));
  if (RE.vision.test(t)) notes.push("Mentions an image or diagram. The Agent tab cannot analyse images; use the Host chat with a Vision model for that part.");

  const bigWords = RE.big.test(t);
  let complexity: Complexity = task.length > 220 || (bigWords && task.length > 60) ? "large" : task.length > 90 || ctx.fileCount > 12 || hit(RE.create) + hit(RE.modify) > 1 ? "medium" : "small";
  if ((intent === "explain" || intent === "plan") && complexity === "large") complexity = "medium";

  const readOnly = intent === "explain" || intent === "plan";
  const planOnly = intent === "plan";
  const buildRole: AgentRole = intent === "automation" ? "automation" : "coding";
  const steps: PlannedStep[] = [];
  if (planOnly || complexity === "large") {
    steps.push({ id: "plan", role: "planning", label: "Plan", required: planOnly, enabled: true, reason: planOnly ? "You asked for a plan." : "Large task: a short plan first avoids rework." });
  }
  if (!planOnly) {
    steps.push({
      id: "build",
      role: buildRole,
      label: readOnly ? "Answer" : intent === "automation" ? "Build (automation)" : "Build",
      required: true,
      enabled: true,
      reason: readOnly ? "Reads the files and answers; changes nothing." : "Creates and edits the files, runs JavaScript to check, fixes errors.",
    });
    if (!readOnly && complexity !== "small") {
      steps.push({ id: "review", role: "engineering", label: "Review", required: false, enabled: true, reason: "Runs only if 2+ files changed or a run failed; checks imports and bugs." });
    }
  }
  const maxSteps = readOnly ? 3 : complexity === "small" ? 4 : complexity === "medium" ? 8 : 12;
  const budget = { ctx: complexity === "small" && ctx.fileCount <= 8 ? 4096 : 8192, maxOut: complexity === "small" ? 2048 : 4096 };
  const calls = (steps.some((s) => s.id === "plan") ? 1 : 0) + (planOnly ? 0 : readOnly ? 1 : complexity === "small" ? 2 : complexity === "medium" ? 3 : 5) + (steps.some((s) => s.id === "review") ? 1 : 0);
  if (intent === "cleanup") notes.push("This can delete files. Every change can be undone afterwards.");
  return {
    intent, complexity, confidence, readOnly, planOnly,
    autoFinish: !readOnly && complexity === "small",
    steps, maxSteps, budget,
    estimate: `about ${calls}${calls > 1 ? "–" + (calls + 2) : ""} model call${calls > 1 ? "s" : ""}`,
    notes,
  };
}

// ---------- availability + alternatives ----------

export type Availability = {
  source: Source;
  model: string;
  kind: "ollama" | "api" | "none" | "unsupported";
  status: "ready" | "warn" | "unavailable";
  note: string;
  caution?: boolean; // usable, but with a quality warning
  installed?: string[];
};

const NOT_CODE = /(moondream|llava|bakllava|minicpm-v|embed|nomic|whisper|clip)/i;
const CODER = /(coder|codellama|codestral|starcoder|deepseek-coder|granite-code)/i;
const STRONG = /(qwen|llama3\.[13]|llama-3|mistral|gemma2?|phi4|deepseek|command-r|gpt-oss)/i;

export function paramsB(name: string): number | null {
  const m = /[:\-_](\d+(?:\.\d+)?)b\b/i.exec(name);
  if (m) return parseFloat(m[1]);
  if (/llama3\.2(?!:\d)/i.test(name)) return 3;
  if (/(phi3|phi-3)/i.test(name)) return 4;
  return null;
}

/** Quality hint for using a model as a coding agent. */
export function modelQuality(name: string): { ok: boolean; warn?: string } {
  if (NOT_CODE.test(name)) return { ok: false, warn: "This is an image/embedding model, not a chat or coding model." };
  const b = paramsB(name);
  if (b !== null && b < 7 && !CODER.test(name)) return { ok: true, warn: "Small model (under 7B): it often breaks the file-edit format. A coder model of 7B or more works much better." };
  return { ok: true };
}

/** Best-first list of installed Ollama models for agent work. */
export function rankModels(installed: string[]): string[] {
  const score = (n: string) => {
    if (NOT_CODE.test(n)) return -1;
    const b = paramsB(n) ?? 7;
    return (CODER.test(n) ? 30 : STRONG.test(n) ? 20 : 10) + Math.min(b, 34) / 2;
  };
  return installed.filter((n) => score(n) >= 0).sort((a, b) => score(b) - score(a));
}

const CHAIN: Record<AgentRole, Source[]> = {
  planning: ["planning", "coding", "host", "engineering", "automation"],
  coding: ["coding", "automation", "host", "engineering", "planning"],
  automation: ["automation", "coding", "host", "engineering", "planning"],
  engineering: ["engineering", "coding", "planning", "host", "automation"],
};

export type Suggestion = { source: Source | null; pull?: string; message: string };

/** What to use when a step's own model is not ready. */
export function suggestAlternative(role: AgentRole, av: Availability[]): Suggestion {
  const by = (s: Source) => av.find((a) => a.source === s);
  const own = by(CHAIN[role][0]);
  if (own?.status === "ready") return { source: own.source, message: "Ready." };
  const alt = CHAIN[role].slice(1).map(by).find((a): a is Availability => !!a && a.status !== "unavailable" && modelQuality(a.model).ok);
  if (alt) return { source: alt.source, message: `Use the ${alt.source} model (${alt.model}) instead.` };
  const reach = av.find((a) => a.kind === "ollama" && a.installed && a.installed.length > 0);
  const best = reach ? rankModels(reach.installed!)[0] : undefined;
  if (best) return { source: null, message: `Set this agent to your installed model ${best} in Advanced settings.` };
  return { source: null, pull: "qwen2.5-coder:7b", message: "No usable model found. Install one with: ollama pull qwen2.5-coder:7b, then set it in Advanced settings." };
}

/** Which source will really run `role`: the user's override if usable, else the best available. */
export function effectiveSource(role: AgentRole, override: Source | null | undefined, av: Availability[]): Source | null {
  if (override) {
    const a = av.find((x) => x.source === override);
    return a && a.status !== "unavailable" && modelQuality(a.model).ok ? override : null;
  }
  return suggestAlternative(role, av).source;
}
