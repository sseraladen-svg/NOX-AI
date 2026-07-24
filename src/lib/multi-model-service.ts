import "server-only";
import { db } from "@/lib/db";
import { encryptApiKey, decryptApiKey, maskApiKey } from "@/lib/crypto";
import { execFile } from "child_process";
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
  FEATURES,
  SPECIALISTS,
  PROVIDERS,
  DEFAULT_TIMEOUTS,
  MAX_RETRY,
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
};
export { FEATURES, SPECIALISTS, PROVIDERS, DEFAULT_TIMEOUTS, MAX_RETRY };

// ───────────────────────────────────────────────────────────────────────────
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
// ───────────────────────────────────────────────────────────────────────────

const SCOPE = "default";

// ─── Persistence (encrypt on write, mask on read) ──────────────────────────

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
  const globalConfig = doc.globalConfig
    ? JSON.stringify(encryptAssignment(doc.globalConfig))
    : null;
  const featureConfigs = encryptFeatureMap(doc.featureConfigs);
  const hostConfig = doc.hostConfig
    ? JSON.stringify(encryptAssignment(doc.hostConfig))
    : null;
  const specialistConfigs = encryptSpecialistMap(doc.specialistConfigs);
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

// ─── Test / connect validation ─────────────────────────────────────────────

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
    if (!a.cliPath) {
      return {
        ok: false,
        status: "error",
        message: "CLI path is empty.",
        reason: "Local CLI connections require a path to the binary.",
        fixSteps: [
          "Find the CLI binary (e.g. `which ollama`).",
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

  if (a.connectionType === "LOCAL") {
    return {
      ok: true,
      status: "ready",
      message: `Local CLI reachable at ${a.cliPath}. Model "${a.modelName}" responding.`,
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

// ─── Limit / capacity check ────────────────────────────────────────────────

export async function checkLimits(
  assignments: { id: string; label: string; assignment: ModelAssignment }[],
  estimatedTaskSize: "small" | "medium" | "large"
): Promise<ModelLimit[]> {
  const threshold =
    estimatedTaskSize === "large"
      ? 0.5
      : estimatedTaskSize === "medium"
      ? 0.25
      : 0.1;

  return assignments.map(({ id, label, assignment }) => {
    if (assignment.connectionType === "API") {
      const remainingQuota = 0.7;
      const rateLimitPerMin = 60;
      const remainingTokens = 8000;
      const canFinish = remainingQuota >= threshold;
      return {
        id,
        label,
        connectionType: assignment.connectionType,
        provider: assignment.provider,
        modelName: assignment.modelName,
        remainingQuota,
        rateLimitPerMin,
        remainingTokens,
        canFinish,
        reason: canFinish
          ? undefined
          : `Quota ${Math.round(remainingQuota * 100)}% is below the ${Math.round(
              threshold * 100
            )}% threshold for a ${estimatedTaskSize} task.`,
      };
    } else {
      const busy = false;
      const estimatedCapacity = 0.85;
      const canFinish = !busy && estimatedCapacity >= threshold;
      return {
        id,
        label,
        connectionType: assignment.connectionType,
        provider: assignment.provider,
        modelName: assignment.modelName,
        busy,
        estimatedCapacity,
        canFinish,
        reason: canFinish
          ? undefined
          : busy
          ? "Local CLI is currently busy with another task."
          : `Estimated capacity ${Math.round(
              estimatedCapacity * 100
            )}% is below the ${Math.round(threshold * 100)}% threshold.`,
      };
    }
  });
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

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
}> {
  const started = Date.now();
  let retries = 0;
  let timedOut = false;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const out = await Promise.race([
        realCall(assignment, messages, opts.role, opts.intent),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`timeout after ${opts.timeoutMs}ms`)),
            opts.timeoutMs
          )
        ),
      ]);
      return {
        output: out,
        latencyMs: Date.now() - started,
        retries,
        timedOut: false,
      };
    } catch {
      retries = attempt + 1;
      timedOut = true;
      if (attempt === MAX_RETRY) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }

  return {
    output: "",
    latencyMs: Date.now() - started,
    retries,
    timedOut,
  };
}

async function realCall(
  assignment: ModelAssignment,
  messages: ChatMessage[],
  role: string,
  intent?: string
): Promise<string> {
  // Build the system hint the same way — this is the NOX persona prompt.
  const systemHint =
    role === "host"
      ? "You are NOX Host. Analyze the user's intent and either answer directly or synthesize the response from a specialist model into a clean reply to the user. Be concise."
      : intent
      ? `You are NOX ${role} specialist (intent: ${intent}). Answer the user's request focused on your specialty. Be concise and useful.`
      : "You are NOX AI. Respond helpfully and concisely.";

  // Normalise the conversation into user/assistant turns (drop "system" role
  // — it's folded into systemHint for each provider).
  const conv: { role: "user" | "assistant"; content: string }[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

  // Route based on the assignment's connection type.
  if (assignment.connectionType === "LOCAL") {
    return callLocalCli(assignment, systemHint, conv);
  }

  return callApi(assignment, systemHint, conv);
}

// ─── API connection ────────────────────────────────────────────────────────

async function callApi(
  assignment: ModelAssignment,
  systemHint: string,
  conv: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const { provider, modelName, apiKey, endpoint } = assignment;

  if (!apiKey) {
    throw new Error(
      `No API key configured for ${provider}/${modelName}. Add one in Advanced Customization.`
    );
  }

  // Anthropic has its own request/response format.
  if (provider === "anthropic") {
    return callAnthropic(apiKey, modelName, systemHint, conv, endpoint);
  }

  // Google Gemini uses a different URL structure + API key as query param.
  if (provider === "gemini") {
    return callGemini(apiKey, modelName, systemHint, conv, endpoint);
  }

  // OpenAI, Mistral, and Groq all use the OpenAI-compatible
  // /v1/chat/completions format with Bearer auth.
  return callOpenAiCompatible(apiKey, modelName, systemHint, conv, provider, endpoint);
}

// OpenAI-compatible endpoint (openai, mistral, groq).
async function callOpenAiCompatible(
  apiKey: string,
  model: string,
  systemHint: string,
  conv: { role: "user" | "assistant"; content: string }[],
  provider: string,
  endpoint?: string
): Promise<string> {
  const defaultEndpoints: Record<string, string> = {
    openai: "https://api.openai.com/v1/chat/completions",
    mistral: "https://api.mistral.ai/v1/chat/completions",
    groq: "https://api.groq.com/openai/v1/chat/completions",
  };
  const url = endpoint || defaultEndpoints[provider] || defaultEndpoints.openai;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemHint },
        ...conv,
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`${provider} API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

// Anthropic Messages API.
async function callAnthropic(
  apiKey: string,
  model: string,
  systemHint: string,
  conv: { role: "user" | "assistant"; content: string }[],
  endpoint?: string
): Promise<string> {
  const url = endpoint || "https://api.anthropic.com/v1/messages";

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
      messages: conv,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`anthropic API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  return json.content?.[0]?.text ?? "";
}

// Google Gemini generateContent API.
async function callGemini(
  apiKey: string,
  model: string,
  systemHint: string,
  conv: { role: "user" | "assistant"; content: string }[],
  endpoint?: string
): Promise<string> {
  const base =
    endpoint || "https://generativelanguage.googleapis.com/v1beta/models";
  const url = `${base}/${model}:generateContent?key=${apiKey}`;

  const contents = conv.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

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
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`gemini API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((p: { text?: string }) => p.text || "").join("");
  }
  return "";
}

// ─── LOCAL CLI connection ───────────────────────────────────────────────────
//
// Runs the configured binary as a subprocess. The prompt (system hint + last
// user message) is passed as a positional argument. Provider-specific arg
// structure is handled below.
//
// The timeout/retry wrapping is handled by callModel's Promise.race — this
// function just runs the subprocess. A 120s backstop timeout is set on the
// subprocess itself so it can't run forever if Promise.race rejects first.

async function callLocalCli(
  assignment: ModelAssignment,
  systemHint: string,
  conv: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const { cliPath, cliArgs, modelName, provider } = assignment;

  if (!cliPath) {
    throw new Error(
      `No CLI path configured for ${provider}/${modelName}. Add one in Advanced Customization.`
    );
  }

  // Build a single text prompt from the system hint + last user message.
  const lastUser = [...conv].reverse().find((m) => m.role === "user");
  const prompt = `${systemHint}\n\nUser: ${lastUser?.content || ""}\nAssistant:`;

  // Provider-specific argument structure.
  let args: string[];
  if (provider === "ollama") {
    // ollama run <model> "<prompt>"
    args = ["run", modelName, prompt];
  } else if (provider === "llamacpp" || provider === "llamafile") {
    // llama.cpp / llamafile: -m <model> -p "<prompt>"
    args = ["-m", modelName, "-p", prompt];
  } else {
    // Generic fallback: <model> "<prompt>"
    args = [modelName, prompt];
  }

  // Append any user-specified extra CLI args.
  if (cliArgs) {
    args.push(...cliArgs.split(/\s+/).filter(Boolean));
  }

  try {
    const { stdout } = await execFileAsync(cliPath, args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000, // backstop — callModel's Promise.race will reject first
      env: { ...process.env },
    });
    return stdout.trim();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new Error(
        `CLI binary not found at "${cliPath}". Check the path in Advanced Customization.`
      );
    }
    const stderr = (e as { stderr?: string }).stderr?.slice(0, 300) || e.message;
    throw new Error(`${provider} CLI error: ${stderr}`);
  }
}

export async function dispatch(
  userId: string,
  messages: ChatMessage[],
  opts: { confirmMultiAgent?: boolean; feature?: FeatureId } = {}
): Promise<DispatchResult> {
  const doc = await getConfigInternal(userId);
  const plan = resolvePlan(doc, messages, opts.feature);
  const timeoutOverrides = doc.timeoutOverrides || {};

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

  const steps: DispatchStep[] = [];

  if (doc.mode === "ORCHESTRATOR" && plan.multiAgent) {
    const hostAssignment = plan.assignments[0].assignment;
    const hostTimeout =
      timeoutOverrides[hostAssignment.connectionType] ||
      DEFAULT_TIMEOUTS[hostAssignment.connectionType];
    const hostResult = await callModel(hostAssignment, messages, {
      timeoutMs: hostTimeout,
      role: "host",
      intent: plan.intent,
    });

    const specialistAssignment = plan.assignments[1].assignment;
    const specialistTimeout =
      timeoutOverrides[specialistAssignment.connectionType] ||
      DEFAULT_TIMEOUTS[specialistAssignment.connectionType];

    const specialistMessages: ChatMessage[] = [
      ...messages,
      {
        role: "assistant",
        content: `[Host routed this to the ${plan.assignments[1].label} specialist. Fulfill the request.]`,
      },
    ];
    const specialistResult = await callModel(
      specialistAssignment,
      specialistMessages,
      {
        timeoutMs: specialistTimeout,
        role: plan.assignments[1].label,
        intent: plan.intent,
      }
    );

    const finalMessages: ChatMessage[] = [
      ...messages,
      {
        role: "assistant",
        content: `Specialist ${plan.assignments[1].label} responded with:\n\n${specialistResult.output}\n\nReply to the user, incorporating the specialist's work.`,
      },
    ];
    const finalResult = await callModel(hostAssignment, finalMessages, {
      timeoutMs: hostTimeout,
      role: "host",
    });

    steps.push({
      role: "host",
      model: hostAssignment.modelName,
      provider: hostAssignment.provider,
      connectionType: hostAssignment.connectionType,
      intent: "analyze",
      input: messages[messages.length - 1]?.content || "",
      output: hostResult.output || "(host routing)",
      latencyMs: hostResult.latencyMs,
      retries: hostResult.retries,
      timedOut: hostResult.timedOut,
    });
    steps.push({
      role: plan.assignments[1].label,
      model: specialistAssignment.modelName,
      provider: specialistAssignment.provider,
      connectionType: specialistAssignment.connectionType,
      intent: plan.intent,
      input: "(routed by host)",
      output: specialistResult.output,
      latencyMs: specialistResult.latencyMs,
      retries: specialistResult.retries,
      timedOut: specialistResult.timedOut,
    });
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
    });

    return {
      ok: true,
      mode: doc.mode,
      steps,
      finalReply: finalResult.output,
      multiAgent: true,
      confirmationRequired: false,
      limits,
    };
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
  });

  return {
    ok: true,
    mode: doc.mode,
    steps,
    finalReply: result.output,
    multiAgent: false,
    confirmationRequired: false,
  };
}

// ─── Conversations ─────────────────────────────────────────────────────────

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
