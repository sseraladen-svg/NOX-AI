// The agent loop (plan → build → review). All side effects come in through `deps`, so the
// whole pipeline is unit-testable with a fake model.
import { type VfsState } from "./vfs.ts";
import { type AgentAction, parseAgentReply, stripActions } from "./agent-protocol.ts";
import { type ActionResult, applyAction, summarizeChanges, type FileChange } from "./agent-exec.ts";
import { type Issue, formatIssues, validateFiles } from "./validators.ts";
import { detectProjectKind, playbookFor } from "./playbooks.ts";
import { AUTOMATION_HINT, BUILDER_SYSTEM, PLANNER_SYSTEM, REVIEWER_SYSTEM, type AgentRole, type ContextInput, buildWorkspaceContext, shouldPlan } from "./agent-prompts.ts";

export type AgentMsg = { role: "user" | "assistant"; content: string };
export type Phase = "plan" | "build" | "review";
export type CallBudget = { ctx: number; maxOut: number };

export type AgentEvent =
  | { type: "phase"; phase: Phase; role: AgentRole }
  | { type: "text"; phase: Phase; text: string }
  | { type: "action"; action: AgentAction; result: ActionResult }
  | { type: "verify"; issues: Issue[]; passed: boolean; round: number }
  | { type: "warning"; message: string }
  | { type: "error"; message: string };

export interface AgentDeps {
  callModel(role: AgentRole, system: string, messages: AgentMsg[], onToken?: (t: string) => void, budget?: CallBudget): Promise<string>;
  getVfs(): VfsState;
  commit(next: VfsState): void;
  context(): ContextInput;
  runFile(path: string): Promise<string>;
  runShell(command: string): Promise<string>; // throws if unavailable or declined
  validate?(paths: string[]): Promise<Issue[]>; // extra checks, e.g. the editor's diagnostics
  emit(e: AgentEvent): void;
  onToken?(t: string): void;
  signal?: AbortSignal;
}

export interface AgentOptions {
  plan: "auto" | "always" | "never";
  review: boolean;
  maxSteps: number; // model calls in the build phase
  readOnly: boolean; // answer only: file changes are rejected
  planOnly: boolean; // stop after the plan
  autoFinish: boolean; // finish after a clean write-only batch without another model call
  buildRole: AgentRole;
  budget?: CallBudget;
  modifying: boolean; // changing existing code (vs creating new)
  playbook: boolean; // add the creation playbook to the first message
  fixRounds: number; // automatic check → fix rounds after building
}

export const DEFAULT_OPTIONS: AgentOptions = { plan: "auto", review: true, maxSteps: 10, readOnly: false, planOnly: false, autoFinish: false, buildRole: "coding", modifying: false, playbook: true, fixRounds: 1 };

export type AgentRunResult = {
  status: "done" | "stopped" | "error" | "limit" | "chat";
  summary: string;
  before: VfsState;
  after: VfsState;
  changes: FileChange[];
  calls: number;
};

const MAX_FEEDBACK_CHARS = 20_000;
const MUTATING = new Set(["write", "edit", "delete", "rename", "mkdir"]);

class Stopped extends Error {}

// ---------- token diet ----------

const FILE_BLOCK = /\n--- (\/[^\n]+?)(?: \(active file\))? ---\n[\s\S]*?(?=\n--- \/|\nSelected text|$)/g;

/** Drops embedded bodies of files the agent already changed (they are stale and costly). */
export function dropFileBodies(text: string, paths: Set<string>): string {
  if (paths.size === 0) return text;
  return text.replace(FILE_BLOCK, (block, p: string) => (paths.has(p) ? `\n--- ${p} ---\n[changed by the agent; use <nox:read> for the current content]` : block));
}

/** Messages as sent to the model: old write bodies and old tool results are shortened. */
export function compactMessages(messages: AgentMsg[], touched: Set<string>, keepLast = 4, firstIdx = 0): AgentMsg[] {
  const cut = messages.length - keepLast;
  return messages.map((m, i) => {
    if (i === firstIdx && m.role === "user") return touched.size ? { ...m, content: dropFileBodies(m.content, touched) } : m;
    if (i >= cut) return m;
    if (m.role === "assistant") {
      return { ...m, content: m.content.replace(/(<nox:write\s+path="[^"]+"[^>]*>)([\s\S]*?)(<\/nox:write>)/g, (_a, open: string, body: string, close: string) => `${open}\n[content omitted: ${body.split("\n").length} lines, file saved]\n${close}`) };
    }
    if (m.content.startsWith("Results:") && m.content.length > 700) return { ...m, content: m.content.slice(0, 600) + "\n…[older results trimmed]" };
    return m;
  });
}

// ---------- handoff between agents ----------

export type Handoff = { plan: string; summary: string; changes: FileChange[]; runLog: string[]; issues: string[] };

export function formatHandoff(task: string, h: Handoff, vfs: VfsState): string {
  const files = h.changes
    .filter((c) => c.status !== "deleted")
    .map((c) => `--- ${c.path} (${c.status}) ---\n${vfs.files[c.path].slice(0, 5000)}`)
    .join("\n\n")
    .slice(0, 16_000);
  return [
    `Request: ${task}`,
    h.plan ? `Plan that was followed:\n${h.plan}` : "",
    `Builder summary: ${h.summary || "(none)"}`,
    `Changed: ${h.changes.map((c) => `${c.status} ${c.path}`).join(", ") || "(nothing)"}`,
    h.runLog.length ? `Run output (latest):\n${h.runLog.join("\n---\n")}` : "",
    h.issues.length ? `Open issues:\n- ${h.issues.join("\n- ")}` : "",
    `Final file contents:\n${files}`,
  ].filter(Boolean).join("\n\n");
}

export async function runAgent(task: string, history: AgentMsg[], deps: AgentDeps, options: Partial<AgentOptions> = {}): Promise<AgentRunResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const before = deps.getVfs();
  let status: AgentRunResult["status"] = "done";
  let summary = "";
  let reviewNote = "";
  let nudged = false;
  let calls = 0;
  let planText = "";
  const touched = new Set<string>();
  const runLog: string[] = [];
  const issues: string[] = [];
  let runFailed = false;

  const check = () => {
    if (deps.signal?.aborted) throw new Stopped();
  };
  const call = async (role: AgentRole, system: string, messages: AgentMsg[], firstIdx = 0) => {
    calls++;
    return deps.callModel(role, system, compactMessages(messages, touched, 4, firstIdx), deps.onToken, opts.budget);
  };

  // One acting loop: the model replies with actions, we apply them, feed results back, repeat.
  async function actLoop(phase: Phase, role: AgentRole, system: string, messages: AgentMsg[], maxSteps: number, firstIdx = 0): Promise<"done" | "limit" | "chat"> {
    for (let step = 0; step < maxSteps; step++) {
      check();
      deps.emit({ type: "phase", phase, role });
      const reply = await call(role, system, messages, firstIdx);
      check();
      messages.push({ role: "assistant", content: reply });
      const prose = stripActions(reply);
      if (prose) deps.emit({ type: "text", phase, text: prose });
      const parsed = parseAgentReply(reply);

      if (parsed.truncated) {
        deps.emit({ type: "warning", message: "The model's reply was cut off; asking it to continue in smaller steps." });
        messages.push({ role: "user", content: "Your reply was cut off before a <nox:write> or <nox:edit> was closed, so that block was NOT applied. Continue in smaller steps: one file per reply, using <nox:edit> for existing files." });
        continue;
      }
      if (parsed.actions.length === 0) {
        // Small models often paste code in chat instead of using actions: nudge once.
        if (step === 0 && !nudged && !opts.readOnly && /```[\s\S]{40,}```/.test(reply)) {
          nudged = true;
          deps.emit({ type: "warning", message: "The model wrote code in chat; asking it to save it to files." });
          messages.push({ role: "user", content: "That code was NOT saved because it was not in an action. Save it now with <nox:write path=\"/file\">full content</nox:write> (use a sensible file name), then reply with <nox:done>." });
          continue;
        }
        if (step === 0 && !summary) summary = prose;
        return step === 0 ? "chat" : "done";
      }

      const feedback: string[] = [];
      let finished = false;
      let cleanWritesOnly = true;
      for (const action of parsed.actions) {
        check();
        if (action.type === "done") {
          if (phase === "review") reviewNote = action.summary;
          else summary = action.summary || prose || "Done.";
          finished = true;
          break;
        }
        let result: ActionResult;
        if (opts.readOnly && MUTATING.has(action.type)) {
          result = { ok: false, message: "This is a read-only request: files cannot be changed. Answer in text." };
        } else if (action.type === "run") {
          cleanWritesOnly = false;
          try {
            const out = await deps.runFile(action.path);
            result = { ok: true, message: `Ran ${action.path}`, output: out || "(no output)" };
            runLog.push(`${action.path}: ${out.slice(0, 1200)}`);
            if (runLog.length > 2) runLog.shift();
            if (out.includes("[error]")) runFailed = true;
          } catch (e) {
            runFailed = true;
            result = { ok: false, message: `Could not run ${action.path}: ${(e as Error).message}` };
          }
        } else if (action.type === "shell") {
          cleanWritesOnly = false;
          try {
            const out = await deps.runShell(action.command);
            result = { ok: true, message: `Ran: ${action.command}`, output: out || "(no output)" };
          } catch (e) {
            result = { ok: false, message: `Shell command not run: ${(e as Error).message}` };
          }
        } else {
          const applied = applyAction(deps.getVfs(), action);
          if (applied.state !== deps.getVfs()) deps.commit(applied.state);
          result = applied.result;
          if (result.changed) for (const p of result.changed) touched.add(p);
          if (!MUTATING.has(action.type)) cleanWritesOnly = false;
        }
        if (!result.ok) {
          cleanWritesOnly = false;
          issues.push(result.message);
          if (issues.length > 5) issues.shift();
        }
        deps.emit({ type: "action", action, result });
        feedback.push(`${result.ok ? "OK" : "ERROR"}: ${result.message}${result.output ? "\n" + result.output : ""}`);
      }
      if (finished) return "done";
      // Efficiency: a small task whose batch was only successful writes/edits needs no extra call.
      if (opts.autoFinish && phase === "build" && cleanWritesOnly && parsed.actions.some((a) => MUTATING.has(a.type))) {
        if (!summary) summary = prose || `Updated ${parsed.actions.filter((a) => MUTATING.has(a.type)).length} file(s).`;
        return "done";
      }
      messages.push({ role: "user", content: ("Results:\n" + feedback.join("\n\n")).slice(0, MAX_FEEDBACK_CHARS) + "\n\nContinue with the next actions, or reply with <nox:done> if the task is complete." });
    }
    return "limit";
  }

  try {
    const ctxInput = deps.context();
    if (opts.planOnly || shouldPlan(task, opts.plan)) {
      deps.emit({ type: "phase", phase: "plan", role: "planning" });
      // The planner only needs the file tree, not file bodies.
      const treeCtx = buildWorkspaceContext(deps.getVfs(), ctxInput, { bodies: false });
      planText = (await call("planning", PLANNER_SYSTEM, [{ role: "user", content: `${treeCtx}\n\nTask: ${task}` }])).trim();
      check();
      if (planText) deps.emit({ type: "text", phase: "plan", text: planText });
      if (opts.planOnly) {
        summary = planText;
        status = "chat";
      }
    }

    if (!opts.planOnly) {
      const ctx = buildWorkspaceContext(deps.getVfs(), ctxInput);
      const readOnlyNote = opts.readOnly ? "\n\nThis is a READ-ONLY request: answer in plain text; do not use write/edit/delete/rename/mkdir." : "";
      const book = opts.playbook && !opts.readOnly ? `\n\n${playbookFor(detectProjectKind(task, deps.getVfs()), task, opts.modifying)}` : "";
      const first = `${ctx}${book}\n\nTask: ${task}${readOnlyNote}${planText ? `\n\nFollow this plan:\n${planText}` : ""}`;
      const messages: AgentMsg[] = [...history, { role: "user", content: first }];
      const system = BUILDER_SYSTEM + (opts.buildRole === "automation" ? AUTOMATION_HINT : "");
      const outcome = await actLoop("build", opts.buildRole, system, messages, opts.maxSteps, history.length);
      if (outcome === "limit") {
        status = "limit";
        deps.emit({ type: "warning", message: `Stopped after ${opts.maxSteps} steps. Send a follow-up to continue.` });
      } else if (outcome === "chat") {
        status = "chat";
      }

      // Test / verify → fix → re-check (zero-token checks first, then the builder fixes what they found).
      if (!opts.readOnly && outcome !== "chat") {
        for (let round = 0; ; round++) {
          check();
          const changed = summarizeChanges(before, deps.getVfs()).filter((c) => c.status !== "deleted").map((c) => c.path);
          if (changed.length === 0) break;
          const found = [...validateFiles(deps.getVfs(), changed), ...((await deps.validate?.(changed)) ?? [])];
          const errors = found.filter((i) => i.severity === "error");
          deps.emit({ type: "verify", issues: found, passed: errors.length === 0, round });
          if (errors.length === 0 || round >= opts.fixRounds) {
            if (errors.length) issues.push(...errors.map((e) => `${e.path}: ${e.message}`).slice(0, 3));
            break;
          }
          messages.push({ role: "user", content: `Automatic checks found problems:\n${formatIssues(errors)}\n\nFix them with actions (prefer <nox:edit>), then reply with <nox:done>.` });
          await actLoop("build", opts.buildRole, system, messages, 2, history.length);
        }
      }

      const changedNow = summarizeChanges(before, deps.getVfs());
      if (opts.review && !opts.readOnly && outcome === "done" && (changedNow.length >= 2 || runFailed)) {
        const packet = formatHandoff(task, { plan: planText, summary, changes: changedNow, runLog, issues }, deps.getVfs());
        const r = await actLoop("review", "engineering", REVIEWER_SYSTEM, [{ role: "user", content: packet }], 3);
        if (r === "limit") deps.emit({ type: "warning", message: "Review stopped after 3 steps." });
      }
    }
  } catch (e) {
    if (e instanceof Stopped) status = "stopped";
    else {
      status = "error";
      deps.emit({ type: "error", message: (e as Error).message });
    }
  }

  const after = deps.getVfs();
  if (reviewNote) summary = `${summary}${summary ? "\n\n" : ""}Review: ${reviewNote}`;
  return { status, summary, before, after, changes: summarizeChanges(before, after), calls };
}
