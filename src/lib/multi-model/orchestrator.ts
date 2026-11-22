import "server-only";
import { consumeApproval, rememberApproval, markStepConsumed } from "@/lib/ephemeral-state";
import {
  applyApprovedPatches,
  buildEngineeringContext,
  runEngineeringVerification,
} from "@/lib/engineering-workspace";
import {
  type FeatureId,
  type SpecialistId,
  type ModelAssignment,
  type MultiModelConfigDoc,
  type ModelLimit,
  type ChatMessage,
  type TokenUsage,
  type DispatchStep,
  type DispatchResult,
  type IntentClassification,
  type AgentWorkspace,
  normalizeFeatureId,
  FEATURES,
  SPECIALISTS,
  DEFAULT_TIMEOUTS,
  computeCost,
} from "@/lib/multi-model-types";
import {
  FEATURE_BUILTIN_RULES,
  tokenBudget,
  emptyAssignment,
  needsClientOllama,
  resolveEndpoint,
  migrateEndpoint,
  truncateForContext,
} from "./shared";
import { getConfigInternal } from "./config-repo";
import { callModel, checkLimits, callApi, callGeminiStreaming, generateImage, isImageGenerationPrompt } from "./providers";

function buildClassificationPrompt(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userContent = lastUser?.content || "";

  return `${CLASSIFICATION_SYSTEM_PROMPT}\n\n---\n\nUser message to classify:\n"${userContent}"\n\nRespond with ONLY the JSON object:`;
}

function buildPromptFromMessages(
  messages: ChatMessage[],
  role: string,
  intent?: string,
  featureSystemPrompt?: string
): string {
  const systemHint =
    featureSystemPrompt ||
    (role === "host"
      ? "You are NOX Host. Analyze the user's intent and either answer directly or synthesize the response from a specialist model into a clean reply to the user. Be concise."
      : intent
        ? `You are NOX ${role} specialist (intent: ${intent}). Answer the user's request focused on your specialty. Be concise and useful.`
        : "You are NOX AI. Respond helpfully and concisely.");

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return `${systemHint}\n\nUser: ${lastUser?.content || ""}\nAssistant:`;
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
    const feature: FeatureId = explicitFeature || "deep-analysis";
    const assignment = doc.featureConfigs?.[feature] || emptyAssignment();
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
  else if (/(engineer|full[- ]stack|frontend|backend|database|refactor|deploy|test|debug)/.test(text))
    specialist = "engineering";

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

const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.6;

const CLASSIFICATION_SYSTEM_PROMPT = `You are NOX Host, an intent classification system. Analyze the user's message and determine which specialist should handle it.

Available specialists:
- "planning": Planning, architecture, design, roadmap, strategy, task decomposition
- "coding": Code generation, bug fixing, code review, implementation, debugging
- "vision": Image analysis, OCR, visual understanding, photo description
- "automation": Workflow automation, API chaining, scheduling, pipelines
- "engineering": Full-stack software engineering, architecture, implementation, testing, debugging
- "none": General questions, conversation, explanations that don't need a specialist

Respond with ONLY a JSON object. No markdown, no code blocks, no extra text:
{"specialist":"coding","confidence":0.9,"reasoning":"User is asking to write a Python function.","plan":["Understand the request","Implement the change","Verify the result"],"capabilities":["Code generation","Code review"],"externalActions":[],"destructiveActions":[],"expectedOutput":["Working code","Verification summary"]}`;

// Parse the classification JSON from the Host model's response.
// Handles: raw JSON, JSON wrapped in markdown code blocks, JSON with
// surrounding text. Returns null if parsing fails.
function parseClassificationResponse(output: string): IntentClassification | null {
  try {
    const start = output.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < output.length; i += 1) {
      const char = output[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") quoted = false;
        continue;
      }
      if (char === "\"") quoted = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return null;
    const candidate = output.slice(start, end + 1)
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":');

    const parsed = JSON.parse(candidate) as {
      specialist?: string;
      confidence?: number;
      reasoning?: string;
      plan?: unknown;
      capabilities?: unknown;
      externalActions?: unknown;
      destructiveActions?: unknown;
      expectedOutput?: unknown;
    };

    // Validate specialist value
    const validSpecialists = ["planning", "coding", "vision", "automation", "engineering", "none"];
    if (!parsed.specialist || !validSpecialists.includes(parsed.specialist)) {
      return null;
    }

    return {
      specialist: parsed.specialist as SpecialistId | "none",
      confidence: typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning provided.",
      plan: Array.isArray(parsed.plan) ? parsed.plan.filter((item): item is string => typeof item === "string") : undefined,
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities.filter((item): item is string => typeof item === "string") : undefined,
      externalActions: Array.isArray(parsed.externalActions) ? parsed.externalActions.filter((item): item is string => typeof item === "string") : undefined,
      destructiveActions: Array.isArray(parsed.destructiveActions) ? parsed.destructiveActions.filter((item): item is string => typeof item === "string") : undefined,
      expectedOutput: Array.isArray(parsed.expectedOutput) ? parsed.expectedOutput.filter((item): item is string => typeof item === "string") : undefined,
    };
  } catch {
    return null;
  }
}

function buildWorkspace(
  specialist: SpecialistId,
  classification: IntentClassification
): AgentWorkspace {
  const plan = classification.plan?.length
    ? classification.plan
    : ["Inspect the request and relevant context", "Perform the specialist work", "Return the result to Host"];
  const files = specialist === "engineering" || specialist === "coding"
    ? ["Relevant project files identified by the specialist"]
    : [];
  const execution = specialist === "engineering" || specialist === "coding"
    ? ["Apply the requested implementation or code review"]
    : ["Execute the specialist analysis"];
  const verification = classification.expectedOutput?.length
    ? classification.expectedOutput
    : ["Check the specialist result for completeness", "Report remaining risks or follow-up work"];
  return { plan, files, execution, verification };
}

function detectHighImpactActions(
  messages: ChatMessage[],
  classification: IntentClassification
): string[] {
  const prompt = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  const actions = new Set(
    (classification.destructiveActions || []).filter((action) => action.trim())
  );
  if (classification.specialist === "engineering") {
    actions.add("Engineering workspace access and command execution");
  }
  if (/\b(delete|remove|drop|destroy|reset|overwrite|replace|migrate|deploy|publish)\b/i.test(prompt)) {
    actions.add("Destructive or irreversible change requested");
  }
  if (/\b(edit|modify|write|patch|fix|refactor|implement|create|update)\b/i.test(prompt) &&
      (classification.specialist === "engineering" || classification.specialist === "coding")) {
    actions.add("Project files may be modified");
  }
  if (/\b(run|execute|install|test|build|lint|typecheck)\b/i.test(prompt)) {
    actions.add("Local commands may execute in the agent workspace");
  }
  return [...actions];
}

function parseEngineeringPatches(output: string): Array<{ path: string; content: string }> {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(output.slice(start, end + 1)) as { patches?: unknown };
    if (!Array.isArray(parsed.patches)) return [];
    return parsed.patches.filter((patch): patch is { path: string; content: string } => {
      return Boolean(
        patch &&
        typeof patch === "object" &&
        typeof (patch as { path?: unknown }).path === "string" &&
        typeof (patch as { content?: unknown }).content === "string"
      );
    });
  } catch {
    return [];
  }
}

// Result of a classification call "" the parsed classification + call metadata
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
// fast and cheap "" classification doesn't need conversation context.
async function classifyIntent(
  hostAssignment: ModelAssignment,
  messages: ChatMessage[],
  timeoutMs: number
): Promise<ClassificationCallResult> {
  const classifyMessages: ChatMessage[] = [
    {
      role: "user",
      content: buildClassificationPrompt(messages),
      image: [...messages].reverse().find((m) => m.role === "user")?.image,
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
    approveHighImpact?: boolean;
    approvalId?: string;
    feature?: FeatureId;
    skipSpecialist?: boolean;
    cachedClassification?: IntentClassification;
    onChunk?: (roleId: string, text: string) => void;
    config?: MultiModelConfigDoc;
    skipLimits?: boolean;
  } = {}
): Promise<DispatchResult> {
  const doc = opts.config || await getConfigInternal(userId);
  const timeoutOverrides = doc.timeoutOverrides || {};
  const steps: DispatchStep[] = [];

  const runFinalModelCall = async (
    assignment: ModelAssignment,
    incomingMessages: ChatMessage[],
    role: string,
    intent?: string,
    timeoutMs?: number
  ) => {
    if (assignment.provider === "gemini" && opts.onChunk) {
      const systemHint =
        role === "host"
          ? "You are NOX Host. Analyze the user's intent and either answer directly or synthesize the response from a specialist model into a clean reply to the user. Be concise."
          : intent
          ? `You are NOX ${role} specialist (intent: ${intent}). Answer the user's request focused on your specialty. Be concise and useful.`
          : "You are NOX AI. Respond helpfully and concisely.";
      const conv: ChatMessage[] = incomingMessages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
          image: m.image,
        }));
      const streamed = await callGeminiStreaming(
        assignment.apiKey || "",
        assignment.modelName,
        systemHint,
        conv,
        resolveEndpoint(assignment),
        (delta) => opts.onChunk!(role, delta)
      );
      return {
        output: streamed.text,
        latencyMs: 0,
        retries: 0,
        timedOut: false,
        lastError: undefined,
        tokens: streamed.tokens,
        heartbeats: 0,
      };
    }

    return callModel(assignment, incomingMessages, {
      timeoutMs: timeoutMs || DEFAULT_TIMEOUTS[assignment.connectionType],
      role,
      intent,
    });
  };

  // ---
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

    // ---
    //
    // Before spending a classification call, verify the Host model is actually
    // reachable. If it's not, return immediately with a clear error "" no point
    // attempting classification with a broken Host.
    //
    // This check is ONLY for Orchestrator mode's classify step. The specialist
    // reachability check in Step 3a/3b is separate and unchanged.
    //
    // Skip this pre-check if we have a cached classification (the Host was
    // already verified in the first round-trip).
    if (!opts.cachedClassification && !opts.skipLimits) {
      const hostCheck = await checkLimits(
        userId,
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
    let classificationMethod: "model" | "fallback" = "model";
    let classificationCallResult: ClassificationCallResult | null = null;

    if (opts.cachedClassification) {
      classification = opts.cachedClassification;
    } else {
      if (needsClientOllama(hostAssignment)) {
        return {
          ok: true,
          mode: doc.mode,
          steps: [],
          finalReply: "",
          multiAgent: false,
          confirmationRequired: false,
          pendingClientExec: {
            stepId: crypto.randomUUID(),
            endpoint: resolveEndpoint(hostAssignment) || "",
            model: hostAssignment.modelName,
            prompt: buildClassificationPrompt(messages),
            resumeContext: {
              mode: doc.mode,
              stage: "classify",
              messages,
              hostAssignment,
              feature: opts.feature,
            },
          },
        };
      }

      classificationCallResult = await classifyIntent(
        hostAssignment,
        messages,
        hostTimeout
      );
      classification = classificationCallResult.classification;

      // If classification call failed (timeout, error, invalid JSON),
      // fall back to keyword-based resolvePlan().
      if (!classification) {
        classificationMethod = "fallback";
        // Fallback: use old keyword matching
        const fallbackPlan = resolvePlan(doc, messages, opts.feature);
        if (fallbackPlan.multiAgent && fallbackPlan.assignments[1]) {
          classification = {
            specialist: fallbackPlan.assignments[1].id as SpecialistId,
            confidence: 0.6,
            reasoning: `Classification call failed (${classificationCallResult.lastError || "invalid response"}). Fell back to keyword matching.`,
          };
        } else {
          classification = {
            specialist: "none",
            confidence: 0.6,
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
      // Host answers directly "" no specialist needed.
      // This is the same as the "Host handles it directly" fallback.
      if (needsClientOllama(hostAssignment)) {
        return {
          ok: true,
          mode: doc.mode,
          steps: [],
          finalReply: "",
          multiAgent: false,
          confirmationRequired: false,
          pendingClientExec: {
            stepId: crypto.randomUUID(),
            endpoint: resolveEndpoint(hostAssignment) || "",
            model: hostAssignment.modelName,
            prompt: buildPromptFromMessages(messages, "host", "direct"),
            resumeContext: {
              mode: doc.mode,
              stage: "direct",
              messages,
              role: "host",
              intent: "direct",
              assignment: hostAssignment,
            },
          },
        };
      }
      const result = await callModel(hostAssignment, messages, {
        timeoutMs: hostTimeout,
        role: "host",
        intent: "direct",
        onChunk: opts.onChunk ? (text) => opts.onChunk!("host", text) : undefined,
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
        ? `Model call failed after ${result.retries} attempt(s).\n\nError: ${result.lastError}\n\nCheck your configuration in Advanced Customization.`
        : "Model returned no response. Check your configuration in Advanced Customization.");

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

    // Step 3: Specialist is needed "" build the plan from classification
    const specialistId = classification.specialist as SpecialistId;
    const specialistDescription =
      SPECIALISTS.find((item) => item.id === specialistId)?.description ||
      "Specialized task execution";
    classification = {
      ...classification,
      specialistDescription,
      plan: classification.plan?.length
        ? classification.plan
        : [
            "Inspect the request and relevant context",
            "Perform the specialist analysis",
            "Return the specialist result to Host",
            "Synthesize the final response",
          ],
      capabilities: classification.capabilities?.length
        ? classification.capabilities
        : [
            "Read conversation context",
            "Use the configured specialist model",
            "Report execution details",
          ],
      externalActions: classification.externalActions || [],
      destructiveActions: classification.destructiveActions || [],
      expectedOutput: classification.expectedOutput?.length
        ? classification.expectedOutput
        : ["Specialist result", "Host-synthesized response"],
    };
    let workspace = buildWorkspace(specialistId, classification);
    const specialistAssignment =
      doc.specialistConfigs?.[specialistId] || emptyAssignment();
    const specialistTimeout =
      timeoutOverrides[specialistAssignment.connectionType] ||
      DEFAULT_TIMEOUTS[specialistAssignment.connectionType];
    const highImpactActions = detectHighImpactActions(messages, classification);

    // Step 3a: Pre-flight confirmation (first call, no confirmMultiAgent)
    if (!opts.confirmMultiAgent) {
      const limits = opts.skipLimits
        ? []
        : await checkLimits(
            userId,
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
        classificationMethod,
        orchestrationState: "waiting_confirmation",
        orchestrationStage: "confirmation",
        workspace,
      };
    }

    if (opts.approveHighImpact) {
      const approved = opts.approvalId ? await consumeApproval(opts.approvalId, userId) : false;
      if (!approved) {
        return {
          ok: false,
          mode: doc.mode,
          steps,
          finalReply: "",
          multiAgent: true,
          confirmationRequired: false,
          orchestrationState: "error",
          orchestrationStage: "confirmation",
          error: "High-impact approval is missing or expired. Start the confirmation flow again.",
        };
      }
    } else if (highImpactActions.length > 0) {
      const approvalId = crypto.randomUUID();
      await rememberApproval(approvalId, userId);
      return {
        ok: false,
        mode: doc.mode,
        steps,
        finalReply: "",
        multiAgent: true,
        confirmationRequired: false,
        destructiveConfirmationRequired: true,
        approvalId,
        highImpactActions,
        classification,
        classificationMethod,
        orchestrationState: "waiting_confirmation",
        orchestrationStage: "confirmation",
        workspace,
      };
    }

    // Step 3b: Confirmed "" check limits
    let limits: ModelLimit[] | undefined;
    limits = opts.skipLimits
      ? []
      : await checkLimits(
          userId,
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
        classificationMethod,
        orchestrationState: "error",
        orchestrationStage: "routing",
        workspace,
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
    const engineeringContext = specialistId === "engineering"
      ? buildEngineeringContext(messages[messages.length - 1]?.content || "")
      : "";
    const specialistMessages: ChatMessage[] = [
      ...truncated.messages,
      {
        role: "assistant",
        content: `[Host routed this to the ${specialistId} specialist (confidence: ${Math.round(classification.confidence * 100)}%). Fulfill the request through this workspace pipeline:
1. PLAN: state the concrete steps.
2. FILES: identify files or inputs involved; do not claim files were changed unless tools actually changed them.
3. EXECUTION: perform or describe the specialist work.
4. VERIFICATION: check the result and list remaining risks.
Return these sections clearly so Host can verify and synthesize the result.]`,
      },
      ...(engineeringContext
        ? [{
            role: "assistant" as const,
            content: `${engineeringContext}\n\nFor Engineering tasks, return a JSON object when proposing file changes: {"summary":"...","patches":[{"path":"relative/path","content":"complete new file content"}]}. Do not claim a patch was applied unless the workspace reports it.`,
          }]
        : []),
    ];
    if (needsClientOllama(specialistAssignment)) {
      return {
        ok: true,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: true,
        confirmationRequired: false,
        orchestrationState: "processing",
        orchestrationStage: "agent_workspace",
        workspace,
        pendingClientExec: {
          stepId: crypto.randomUUID(),
          endpoint: resolveEndpoint(specialistAssignment) || "",
          model: specialistAssignment.modelName,
          prompt: buildPromptFromMessages(specialistMessages, specialistId, specialistId),
          resumeContext: {
            mode: doc.mode,
            stage: "specialist",
            messages: specialistMessages,
            specialistId,
            role: specialistId,
            intent: specialistId,
            assignment: specialistAssignment,
            hostAssignment,
            classification,
            highImpactApproved: true,
            finalMessages: [...messages, { role: "assistant", content: `Specialist ${specialistId} responded with:\n\n[awaiting local Ollama completion]\n\nReply to the user, incorporating the specialist's work.` }],
          },
        },
      };
    }

    const specialistResult = await callModel(
      specialistAssignment,
      specialistMessages,
      {
        timeoutMs: specialistTimeout,
        role: specialistId,
        intent: specialistId,
      }
    );
    if (specialistId === "engineering") {
      const patches = parseEngineeringPatches(specialistResult.output);
      const changedFiles = opts.approveHighImpact && patches.length > 0
        ? applyApprovedPatches(patches)
        : [];
      const verificationResults = await runEngineeringVerification();
      workspace = {
        ...workspace,
        changedFiles,
        commands: verificationResults.map((result) => result.command),
        verificationResults,
        files: [
          ...workspace.files,
          ...(changedFiles.length > 0 ? [`Changed files: ${changedFiles.join(", ")}`] : []),
        ],
      };
    }

    // Host synthesizes the specialist's output
    const finalMessages: ChatMessage[] = [
      ...messages,
      {
        role: "assistant",
        content: `Specialist ${specialistId} responded with:\n\n${specialistResult.output}\n\n${
          specialistId === "engineering"
            ? `Engineering workspace report:\nChanged files: ${workspace.changedFiles?.join(", ") || "(none)"}\nVerification:\n${workspace.verificationResults?.map((result) => `${result.ok ? "PASS" : "FAIL"} ${result.command}\n${result.output}`).join("\n") || "Not run"}`
            : ""
        }\nReply to the user, incorporating the specialist's work. Never claim verification passed unless the report contains PASS for that exact command.`,
      },
    ];
    if (needsClientOllama(hostAssignment)) {
      return {
        ok: true,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: true,
        confirmationRequired: false,
        pendingClientExec: {
          stepId: crypto.randomUUID(),
          endpoint: resolveEndpoint(hostAssignment) || "",
          model: hostAssignment.modelName,
          prompt: buildPromptFromMessages(finalMessages, "host"),
          resumeContext: {
            mode: doc.mode,
            stage: "synthesize",
            messages: finalMessages,
            role: "host",
            assignment: hostAssignment,
            specialistId,
            workspace,
          },
        },
      };
    }
    const finalResult = await callModel(hostAssignment, finalMessages, {
      timeoutMs: hostTimeout,
      role: "host",
      onChunk: opts.onChunk ? (text) => opts.onChunk!("host", text) : undefined,
    });

    // Log specialist step
    steps.push({
      role: specialistId,
      model: specialistAssignment.modelName,
      provider: specialistAssignment.provider,
      connectionType: specialistAssignment.connectionType,
      intent: specialistId,
      input: truncated.truncated
        ? `(routed by host, context truncated: ${truncated.originalTokens}†'${truncated.keptTokens} tokens)`
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
      ? `Model call failed after ${finalResult.retries} attempt(s).\n\nError: ${finalResult.lastError}\n\nCheck your configuration in Advanced Customization.`
      : "Model returned no response. Check your configuration in Advanced Customization.");

    return {
      ok: true,
      mode: doc.mode,
      steps,
      finalReply,
      multiAgent: true,
      confirmationRequired: false,
      limits,
      classification: classification || undefined,
      classificationMethod,
      orchestrationState: "completed",
      orchestrationStage: "final",
      workspace,
    };
  }

  // ---
  if (doc.mode === "ORCHESTRATOR" && opts.skipSpecialist) {
    const hostAssignment = doc.hostConfig || emptyAssignment();
    const hostTimeout =
      timeoutOverrides[hostAssignment.connectionType] ||
      DEFAULT_TIMEOUTS[hostAssignment.connectionType];
    if (needsClientOllama(hostAssignment)) {
      return {
        ok: true,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: false,
        confirmationRequired: false,
        pendingClientExec: {
          stepId: crypto.randomUUID(),
          endpoint: resolveEndpoint(hostAssignment) || "",
          model: hostAssignment.modelName,
          prompt: buildPromptFromMessages(messages, "host", "direct"),
          resumeContext: {
            mode: doc.mode,
            stage: "direct",
            messages,
            role: "host",
            intent: "direct",
            assignment: hostAssignment,
          },
        },
      };
    }
    const result = await callModel(hostAssignment, messages, {
      timeoutMs: hostTimeout,
      role: "host",
      intent: "direct",
      onChunk: opts.onChunk ? (text) => opts.onChunk!("host", text) : undefined,
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
      ? `Model call failed after ${result.retries} attempt(s).\n\nError: ${result.lastError}\n\nCheck your configuration in Advanced Customization.`
      : "Model returned no response. Check your configuration in Advanced Customization.");

    return {
      ok: true,
      mode: doc.mode,
      steps,
      finalReply,
      multiAgent: false,
      confirmationRequired: false,
    };
  }

  // ---
  let dispatchFeature = opts.feature;
  if (doc.mode === "MULTI") {
    dispatchFeature =
      opts.feature === undefined
        ? "deep-analysis"
        : normalizeFeatureId(opts.feature) || undefined;
    if (!dispatchFeature) {
      return {
        ok: false,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: false,
        confirmationRequired: false,
        error: "Choose a valid Multi Mode feature before sending a request.",
      };
    }

    const assignment = doc.featureConfigs?.[dispatchFeature];
    if (!assignment) {
      return {
        ok: false,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: false,
        confirmationRequired: false,
        error: `No model is configured for ${dispatchFeature}. Configure that feature before sending a request.`,
      };
    }
    if (
      assignment.systemPrompt !== undefined &&
      assignment.systemPrompt.length > 4000
    ) {
      return {
        ok: false,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: false,
        confirmationRequired: false,
        error: "Feature system prompts must be 4,000 characters or fewer.",
      };
    }
    if (!messages.some((message) => message.role === "system")) {
      messages = [
        {
          role: "system",
          content:
            assignment.systemPrompt?.trim() ||
            FEATURE_BUILTIN_RULES[dispatchFeature],
        },
        ...messages,
      ];
    }
  }

  const plan = resolvePlan(
    doc,
    messages,
    doc.mode === "MULTI" ? dispatchFeature : opts.feature
  );

  // Explicit image requests in SINGLE mode use the image generation endpoint
  // instead of asking the text model to describe an image.
  if (doc.mode === "SINGLE" && !opts.confirmMultiAgent) {
    const prompt = messages[messages.length - 1]?.content || "";
    const assignment = plan.assignments[0].assignment;
    if (isImageGenerationPrompt(prompt)) {
      try {
        const generated = await generateImage(assignment, prompt);
        const step: DispatchStep = {
          role: plan.assignments[0].label,
          model: "gpt-image-1",
          provider: assignment.provider,
          connectionType: assignment.connectionType,
          intent: "image-generation",
          input: prompt,
          output: generated.markdown,
          latencyMs: generated.latencyMs,
          retries: 0,
          timedOut: false,
        };
        return {
          ok: true,
          mode: doc.mode,
          steps: [step],
          finalReply: generated.markdown,
          multiAgent: false,
          confirmationRequired: false,
        };
      } catch (err) {
        return {
          ok: false,
          mode: doc.mode,
          steps: [],
          finalReply: "",
          multiAgent: false,
          confirmationRequired: false,
          error: (err as Error).message,
        };
      }
    }
  }

  if (plan.multiAgent && !opts.confirmMultiAgent) {
    const limits = opts.skipLimits
      ? []
      : await checkLimits(userId, plan.assignments, "medium");
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
    limits = opts.skipLimits
      ? []
      : await checkLimits(userId, plan.assignments, "medium");
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
  // Real generations need the long timeout. DEFAULT_TIMEOUTS.API (15s) is only
  // meant for quick reachability checks and cut off normal answers.
  const timeout =
    timeoutOverrides[a.connectionType] ||
    (a.connectionType === "API" ? DEFAULT_TIMEOUTS.GENERATION : DEFAULT_TIMEOUTS.LOCAL);
  if (needsClientOllama(a)) {
    return {
      ok: true,
      mode: doc.mode,
      steps: [],
      finalReply: "",
      multiAgent: false,
      confirmationRequired: false,
      pendingClientExec: {
        stepId: crypto.randomUUID(),
        endpoint: resolveEndpoint(a) || "",
        model: a.modelName,
        prompt: buildPromptFromMessages(
          messages,
          plan.assignments[0].label,
          plan.intent,
          doc.mode === "MULTI"
            ? messages.find((message) => message.role === "system")?.content
            : undefined
        ),
        resumeContext: {
          mode: doc.mode,
          stage: "single",
          messages,
          role: plan.assignments[0].label,
          intent: plan.intent,
          assignment: a,
          feature: doc.mode === "MULTI" ? dispatchFeature : opts.feature,
        },
      },
    };
  }
  const result = await callModel(a, messages, {
    timeoutMs: timeout,
    role: plan.assignments[0].label,
    intent: plan.intent,
    onChunk: opts.onChunk ? (text) => opts.onChunk!(plan.assignments[0].label, text) : undefined,
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
    ? `Model call failed after ${result.retries} attempt(s).\n\nError: ${result.lastError}\n\nCheck your configuration in Advanced Customization.`
    : "Model returned no response. Check your configuration in Advanced Customization.");

  return {
    ok: true,
    mode: doc.mode,
    steps,
    finalReply,
    multiAgent: false,
    confirmationRequired: false,
  };
}

export async function resumeDispatch(
  userId: string,
  _stepId: string,
  resultText: string,
  resumeContext?: Record<string, unknown>,
  browserTokens?: { input: number; output: number; total: number },
  browserLatencyMs?: number,
  config?: MultiModelConfigDoc
): Promise<DispatchResult> {
  if (!(await markStepConsumed(userId, _stepId))) {
    throw new Error("This dispatch-resume step has already been consumed.");
  }
  const doc = config || await getConfigInternal(userId);
  const ctx = (resumeContext || {}) as Record<string, any>;
  const isGuestDispatch = userId.startsWith("guest:");
  const contextAssignment = (
    contextKey: string,
    fallback: ModelAssignment | null | undefined
  ) =>
    isGuestDispatch
      ? fallback || emptyAssignment()
      : (ctx[contextKey] as ModelAssignment) || fallback || emptyAssignment();
  const output = typeof resultText === "string" ? resultText : "";
  const stage = typeof ctx.stage === "string" ? ctx.stage : "single";
  if (isGuestDispatch && stage !== "single" && stage !== "direct") {
    throw new Error("This guest continuation is not available.");
  }
  const messages = Array.isArray(ctx.messages) ? (ctx.messages as ChatMessage[]) : [];
  const timeoutOverrides = doc.timeoutOverrides || {};

  const finishFromAssignment = (
    assignment: ModelAssignment,
    roleName: string,
    roleIntent?: string,
    inputOverride?: string,
    extraSteps: DispatchStep[] = []
  ): DispatchResult => {
    const step: DispatchStep = {
      role: roleName,
      model: assignment.modelName,
      provider: assignment.provider,
      connectionType: assignment.connectionType,
      intent: roleIntent,
      input: inputOverride || messages[messages.length - 1]?.content || "",
      output,
      latencyMs: browserLatencyMs ?? 0,
      retries: 0,
      timedOut: false,
      lastError: undefined,
      tokens: browserTokens,
      cost: browserTokens
        ? computeCost(browserTokens, assignment.modelName)
        : undefined,
    };
    return {
      ok: true,
      mode: doc.mode,
      steps: [...extraSteps, step],
      finalReply: output || "Local model call completed.",
      multiAgent: false,
      confirmationRequired: false,
    };
  };

  switch (stage) {
    case "single": {
      // Guests don't trust the client-sent assignment, so pick it from their own
      // config. In MULTI mode that is the feature's model, not globalConfig.
      const ctxFeature = FEATURES.find((f) => f.id === ctx.feature)?.id;
      const singleFallback =
        doc.mode === "MULTI"
          ? (ctxFeature && doc.featureConfigs?.[ctxFeature]) ||
            doc.globalConfig
          : doc.globalConfig;
      const assignment = contextAssignment("assignment", singleFallback);
      return finishFromAssignment(assignment, String(ctx.role || "single"), typeof ctx.intent === "string" ? ctx.intent : undefined, messages[messages.length - 1]?.content || "");
    }
    case "direct": {
      const assignment = contextAssignment("assignment", doc.hostConfig);
      return finishFromAssignment(assignment, String(ctx.role || "host"), typeof ctx.intent === "string" ? ctx.intent : undefined, messages[messages.length - 1]?.content || "");
    }
    case "classify": {
      const hostAssignment = contextAssignment("hostAssignment", doc.hostConfig);
      const classification =
        parseClassificationResponse(output) ||
        (() => {
          const fallbackPlan = resolvePlan(doc, messages, ctx.feature as FeatureId | undefined);
          if (fallbackPlan.multiAgent && fallbackPlan.assignments[1]) {
            return {
              specialist: fallbackPlan.assignments[1].id as SpecialistId,
              confidence: 0.6,
              reasoning: "Classification call failed. Fell back to keyword matching.",
            };
          }
          return {
            specialist: "none" as const,
            confidence: 0.6,
            reasoning: "Classification call failed. Host will answer directly.",
          };
        })();
      const shouldRouteToSpecialist =
        classification.specialist !== "none" &&
        classification.confidence >= CLASSIFICATION_CONFIDENCE_THRESHOLD;

      if (!shouldRouteToSpecialist) {
        if (needsClientOllama(hostAssignment)) {
          return {
            ok: true,
            mode: doc.mode,
            steps: [],
            finalReply: "",
            multiAgent: false,
            confirmationRequired: false,
            pendingClientExec: {
              stepId: crypto.randomUUID(),
              endpoint: resolveEndpoint(hostAssignment) || "",
              model: hostAssignment.modelName,
              prompt: buildPromptFromMessages(messages, "host", "direct"),
              resumeContext: {
                mode: doc.mode,
                stage: "direct",
                messages,
                role: "host",
                intent: "direct",
                assignment: hostAssignment,
              },
            },
          };
        }

        const hostTimeout = timeoutOverrides[hostAssignment.connectionType] || DEFAULT_TIMEOUTS[hostAssignment.connectionType];
        const hostResult = await callModel(hostAssignment, messages, {
          timeoutMs: hostTimeout,
          role: "host",
          intent: "direct",
        });
        const hostStep: DispatchStep = {
          role: "host",
          model: hostAssignment.modelName,
          provider: hostAssignment.provider,
          connectionType: hostAssignment.connectionType,
          intent: "direct",
          input: messages[messages.length - 1]?.content || "",
          output: hostResult.output,
          latencyMs: hostResult.latencyMs,
          retries: hostResult.retries,
          timedOut: hostResult.timedOut,
          lastError: hostResult.lastError,
          tokens: hostResult.tokens,
          cost: hostResult.tokens ? computeCost(hostResult.tokens, hostAssignment.modelName) : undefined,
        };
        return {
          ok: true,
          mode: doc.mode,
          steps: [hostStep],
          finalReply: hostResult.output || (hostResult.lastError ? `Model call failed after ${hostResult.retries} attempt(s).\n\nError: ${hostResult.lastError}\n\nCheck your configuration in Advanced Customization.` : "Model returned no response. Check your configuration in Advanced Customization."),
          multiAgent: false,
          confirmationRequired: false,
          classification,
        };
      }

      const specialistId = classification.specialist as SpecialistId;
      const specialistAssignment = doc.specialistConfigs?.[specialistId] || emptyAssignment();
      const specialistTimeout = timeoutOverrides[specialistAssignment.connectionType] || DEFAULT_TIMEOUTS[specialistAssignment.connectionType];
      const workspace = buildWorkspace(specialistId, classification);
      const truncated = truncateForContext(messages);
      const specialistMessages: ChatMessage[] = [
        ...truncated.messages,
        {
          role: "assistant",
          content: `[Host routed this to the ${specialistId} specialist (confidence: ${Math.round(classification.confidence * 100)}%). Fulfill the request through this workspace pipeline:
1. PLAN: state the concrete steps.
2. FILES: identify files or inputs involved; do not claim files were changed unless tools actually changed them.
3. EXECUTION: perform or describe the specialist work.
4. VERIFICATION: check the result and list remaining risks.
Return these sections clearly so Host can verify and synthesize the result.]`,
        },
      ];

      if (needsClientOllama(specialistAssignment)) {
        return {
          ok: true,
          mode: doc.mode,
          steps: [],
          finalReply: "",
          multiAgent: true,
          confirmationRequired: false,
          orchestrationState: "processing",
          orchestrationStage: "agent_workspace",
          workspace,
          pendingClientExec: {
            stepId: crypto.randomUUID(),
            endpoint: resolveEndpoint(specialistAssignment) || "",
            model: specialistAssignment.modelName,
            prompt: buildPromptFromMessages(specialistMessages, specialistId, specialistId),
            resumeContext: {
              mode: doc.mode,
              stage: "specialist",
              messages: specialistMessages,
              specialistId,
              role: specialistId,
              intent: specialistId,
              assignment: specialistAssignment,
              hostAssignment,
              finalMessages: [
                ...messages,
                { role: "assistant", content: `Specialist ${specialistId} responded with:\n\n[awaiting local Ollama completion]\n\nReply to the user, incorporating the specialist's work.` },
              ],
            },
          },
        };
      }

      const specialistResult = await callModel(specialistAssignment, specialistMessages, {
        timeoutMs: specialistTimeout,
        role: specialistId,
        intent: specialistId,
      });
      const specialistStep: DispatchStep = {
        role: specialistId,
        model: specialistAssignment.modelName,
        provider: specialistAssignment.provider,
        connectionType: specialistAssignment.connectionType,
        intent: specialistId,
        input: truncated.truncated ? `(routed by host, context truncated: ${truncated.originalTokens}→${truncated.keptTokens} tokens)` : "(routed by host)",
        output: specialistResult.output,
        latencyMs: specialistResult.latencyMs,
        retries: specialistResult.retries,
        timedOut: specialistResult.timedOut,
        lastError: specialistResult.lastError,
        tokens: specialistResult.tokens,
        cost: specialistResult.tokens ? computeCost(specialistResult.tokens, specialistAssignment.modelName) : undefined,
      };

      const finalMessages: ChatMessage[] = [
        ...messages,
        {
          role: "assistant",
          content: `Specialist ${specialistId} responded with:\n\n${specialistResult.output}\n\nReply to the user, incorporating the specialist's work.`,
        },
      ];

      if (needsClientOllama(hostAssignment)) {
        return {
          ok: true,
          mode: doc.mode,
          steps: [specialistStep],
          finalReply: "",
          multiAgent: true,
          confirmationRequired: false,
          pendingClientExec: {
            stepId: crypto.randomUUID(),
            endpoint: resolveEndpoint(hostAssignment) || "",
            model: hostAssignment.modelName,
            prompt: buildPromptFromMessages(finalMessages, "host"),
            resumeContext: {
              mode: doc.mode,
              stage: "synthesize",
              messages: finalMessages,
              role: "host",
              assignment: hostAssignment,
              specialistStep,
              workspace,
              intent: "synthesize",
            },
          },
        };
      }

      const hostTimeout = timeoutOverrides[hostAssignment.connectionType] || DEFAULT_TIMEOUTS[hostAssignment.connectionType];
      const hostResult = await callModel(hostAssignment, finalMessages, {
        timeoutMs: hostTimeout,
        role: "host",
        intent: "synthesize",
      });
      const hostStep: DispatchStep = {
        role: "host",
        model: hostAssignment.modelName,
        provider: hostAssignment.provider,
        connectionType: hostAssignment.connectionType,
        intent: "synthesize",
        input: "(specialist response)",
        output: hostResult.output,
        latencyMs: hostResult.latencyMs,
        retries: hostResult.retries,
        timedOut: hostResult.timedOut,
        lastError: hostResult.lastError,
        tokens: hostResult.tokens,
        cost: hostResult.tokens ? computeCost(hostResult.tokens, hostAssignment.modelName) : undefined,
      };
      return {
        ok: true,
        mode: doc.mode,
        steps: [specialistStep, hostStep],
        finalReply: hostResult.output || specialistResult.output,
        multiAgent: true,
        confirmationRequired: false,
        orchestrationState: "completed",
        orchestrationStage: "final",
        workspace,
      };
    }
    case "specialist": {
      const specialistId = String(ctx.specialistId || ctx.role || "specialist");
      const hostAssignment = contextAssignment("hostAssignment", doc.hostConfig);
      const specialistAssignment = contextAssignment(
        "assignment",
        doc.specialistConfigs?.[specialistId as SpecialistId]
      );
      const specialistStep: DispatchStep = {
        role: specialistId,
        model: specialistAssignment.modelName,
        provider: specialistAssignment.provider,
        connectionType: specialistAssignment.connectionType,
        intent: specialistId,
        input: messages[messages.length - 1]?.content || "",
        output,
        latencyMs: 0,
        retries: 0,
        timedOut: false,
      };
      let workspace = buildWorkspace(
        specialistId as SpecialistId,
        (ctx.classification as IntentClassification) || {
          specialist: specialistId as SpecialistId,
          confidence: 1,
          reasoning: "Approved specialist execution",
        }
      );
      if (specialistId === "engineering") {
        const patches = parseEngineeringPatches(output);
        const changedFiles = ctx.highImpactApproved && patches.length > 0
          ? applyApprovedPatches(patches)
          : [];
        const verificationResults = await runEngineeringVerification();
        workspace = {
          ...workspace,
          changedFiles,
          commands: verificationResults.map((result) => result.command),
          verificationResults,
        };
      }
      let finalMessages: ChatMessage[] = Array.isArray(ctx.finalMessages)
        ? (ctx.finalMessages as ChatMessage[])
        : [
            ...messages,
            {
              role: "assistant",
              content: `Specialist ${specialistId} responded with:\n\n${output}\n\n${
                specialistId === "engineering"
                  ? `Engineering workspace report:\nChanged files: ${workspace.changedFiles?.join(", ") || "(none)"}\nVerification:\n${workspace.verificationResults?.map((result) => `${result.ok ? "PASS" : "FAIL"} ${result.command}\n${result.output}`).join("\n") || "Not run"}`
                  : ""
              }\nReply to the user, incorporating the specialist's work. Never claim verification passed unless the report contains PASS for that exact command.`,
            },
          ];
      if (specialistId === "engineering") {
        finalMessages = [
          ...finalMessages,
          {
            role: "assistant",
            content: `Engineering workspace report:\nChanged files: ${workspace.changedFiles?.join(", ") || "(none)"}\nVerification:\n${workspace.verificationResults?.map((result) => `${result.ok ? "PASS" : "FAIL"} ${result.command}\n${result.output}`).join("\n") || "Not run"}\nNever claim verification passed unless the report contains PASS for that exact command.`,
          },
        ];
      }
      const hostTimeout = timeoutOverrides[hostAssignment.connectionType] || DEFAULT_TIMEOUTS[hostAssignment.connectionType];
      if (needsClientOllama(hostAssignment)) {
        return {
          ok: true,
          mode: doc.mode,
          steps: [specialistStep],
          finalReply: "",
          multiAgent: true,
          confirmationRequired: false,
          orchestrationState: "processing",
          orchestrationStage: "verification",
          workspace,
          pendingClientExec: {
            stepId: crypto.randomUUID(),
            endpoint: resolveEndpoint(hostAssignment) || "",
            model: hostAssignment.modelName,
            prompt: buildPromptFromMessages(finalMessages, "host"),
            resumeContext: {
              mode: doc.mode,
              stage: "synthesize",
              messages: finalMessages,
              role: "host",
              assignment: hostAssignment,
              specialistStep,
              intent: "synthesize",
            },
          },
        };
      }
      const hostResult = await callModel(hostAssignment, finalMessages, {
        timeoutMs: hostTimeout,
        role: "host",
        intent: "synthesize",
      });
      const hostStep: DispatchStep = {
        role: "host",
        model: hostAssignment.modelName,
        provider: hostAssignment.provider,
        connectionType: hostAssignment.connectionType,
        intent: "synthesize",
        input: "(specialist response)",
        output: hostResult.output,
        latencyMs: hostResult.latencyMs,
        retries: hostResult.retries,
        timedOut: hostResult.timedOut,
        lastError: hostResult.lastError,
        tokens: hostResult.tokens,
        cost: hostResult.tokens ? computeCost(hostResult.tokens, hostAssignment.modelName) : undefined,
      };
      return {
        ok: true,
        mode: doc.mode,
        steps: [specialistStep, hostStep],
        finalReply: hostResult.output || output,
        multiAgent: true,
        confirmationRequired: false,
        orchestrationState: "completed",
        orchestrationStage: "final",
        workspace,
      };
    }
    case "synthesize": {
      const assignment = contextAssignment("assignment", doc.hostConfig);
      const specialistStep = (ctx.specialistStep as DispatchStep | undefined) || undefined;
      const workspace = (ctx.workspace as AgentWorkspace | undefined) || buildWorkspace(
        String(ctx.specialistId || "specialist") as SpecialistId,
        (ctx.classification as IntentClassification | undefined) || {
          specialist: String(ctx.specialistId || "specialist") as SpecialistId,
          confidence: 1,
          reasoning: "Approved specialist execution",
        }
      );
      const step: DispatchStep = {
        role: "host",
        model: assignment.modelName,
        provider: assignment.provider,
        connectionType: assignment.connectionType,
        intent: "synthesize",
        input: "(specialist response)",
        output,
        latencyMs: 0,
        retries: 0,
        timedOut: false,
      };
      return {
        ok: true,
        mode: doc.mode,
        steps: specialistStep ? [specialistStep, step] : [step],
        finalReply: output || "Local model call completed.",
        multiAgent: !!specialistStep,
        confirmationRequired: false,
      };
    }
    default:
      return {
        ok: false,
        mode: doc.mode,
        steps: [],
        finalReply: "",
        multiAgent: false,
        confirmationRequired: false,
        error: "Unknown local Ollama resume stage.",
      };
  }
}

export async function agentComplete(
  userId: string,
  role: "host" | SpecialistId,
  system: string,
  messages: ChatMessage[],
  maxTokens = 4096
): Promise<{ text: string; tokens?: TokenUsage; provider: string; model: string }> {
  const doc = await getConfigInternal(userId);
  const configured = role === "host" ? doc.hostConfig : doc.specialistConfigs?.[role];
  if (!configured) throw new Error(`No model is configured for ${role}.`);
  const base = migrateEndpoint(configured) ?? configured;
  if (base.connectionType !== "API") throw new Error("This role uses a local model, which runs from the browser.");
  const assignment: ModelAssignment = { ...base, endpoint: resolveEndpoint(base) };
  const result = await tokenBudget.run(maxTokens, () =>
    callApi(assignment, system, messages.filter((m) => m.role !== "system"))
  );
  return { text: result.text, tokens: result.tokens, provider: assignment.provider, model: assignment.modelName };
}
