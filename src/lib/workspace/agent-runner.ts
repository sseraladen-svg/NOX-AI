// The agent loop (plan → build → review). All side effects come in through `deps`, so the
// whole pipeline is unit-testable with a fake model.
import { type VfsState } from "./vfs.ts";
import { type AgentAction, parseAgentReply, stripActions } from "./agent-protocol.ts";
import { type ActionResult, applyAction, summarizeChanges, type FileChange } from "./agent-exec.ts";
import { BUILDER_SYSTEM, PLANNER_SYSTEM, REVIEWER_SYSTEM, type AgentRole, type ContextInput, buildWorkspaceContext, shouldPlan } from "./agent-prompts.ts";

export type AgentMsg = { role: "user" | "assistant"; content: string };
export type Phase = "plan" | "build" | "review";

export type AgentEvent =
  | { type: "phase"; phase: Phase; role: AgentRole }
  | { type: "text"; phase: Phase; text: string }
  | { type: "action"; action: AgentAction; result: ActionResult }
  | { type: "warning"; message: string }
  | { type: "error"; message: string };

export interface AgentDeps {
  callModel(role: AgentRole, system: string, messages: AgentMsg[], onToken?: (t: string) => void): Promise<string>;
  getVfs(): VfsState;
  commit(next: VfsState): void;
  context(): ContextInput;
  runFile(path: string): Promise<string>;
  runShell(command: string): Promise<string>; // throws if unavailable or declined
  emit(e: AgentEvent): void;
  onToken?(t: string): void;
  signal?: AbortSignal;
}

export interface AgentOptions {
  plan: "auto" | "always" | "never";
  review: boolean;
  maxSteps: number; // model calls in the build phase
}

export const DEFAULT_OPTIONS: AgentOptions = { plan: "auto", review: true, maxSteps: 10 };

export type AgentRunResult = {
  status: "done" | "stopped" | "error" | "limit" | "chat";
  summary: string;
  before: VfsState;
  after: VfsState;
  changes: FileChange[];
};

const MAX_FEEDBACK_CHARS = 20_000;

class Stopped extends Error {}

export async function runAgent(task: string, history: AgentMsg[], deps: AgentDeps, options: Partial<AgentOptions> = {}): Promise<AgentRunResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const before = deps.getVfs();
  let status: AgentRunResult["status"] = "done";
  let summary = "";
  let runFailed = false;
  let reviewNote = "";
  let nudged = false;

  const check = () => {
    if (deps.signal?.aborted) throw new Stopped();
  };

  // One acting loop: the model replies with actions, we apply them, feed results back, repeat.
  async function actLoop(phase: Phase, role: AgentRole, system: string, messages: AgentMsg[], maxSteps: number): Promise<"done" | "limit" | "chat"> {
    for (let step = 0; step < maxSteps; step++) {
      check();
      deps.emit({ type: "phase", phase, role });
      const reply = await deps.callModel(role, system, messages, deps.onToken);
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
        if (step === 0 && !nudged && /```[\s\S]{40,}```/.test(reply)) {
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
      for (const action of parsed.actions) {
        check();
        if (action.type === "done") {
          if (phase === "review") reviewNote = action.summary;
          else summary = action.summary || prose || "Done.";
          finished = true;
          break;
        }
        let result: ActionResult;
        if (action.type === "run") {
          try {
            const out = await deps.runFile(action.path);
            result = { ok: true, message: `Ran ${action.path}`, output: out || "(no output)" };
          } catch (e) {
            runFailed = true;
            result = { ok: false, message: `Could not run ${action.path}: ${(e as Error).message}` };
          }
          if ((result.output ?? "").includes("[error]")) runFailed = true;
        } else if (action.type === "shell") {
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
        }
        deps.emit({ type: "action", action, result });
        feedback.push(`${result.ok ? "OK" : "ERROR"}: ${result.message}${result.output ? "\n" + result.output : ""}`);
      }
      if (finished) return "done";
      messages.push({ role: "user", content: ("Results:\n" + feedback.join("\n\n")).slice(0, MAX_FEEDBACK_CHARS) + "\n\nContinue with the next actions, or reply with <nox:done> if the task is complete." });
    }
    return "limit";
  }

  try {
    const ctx = buildWorkspaceContext(deps.getVfs(), deps.context());
    let planText = "";
    if (shouldPlan(task, opts.plan)) {
      deps.emit({ type: "phase", phase: "plan", role: "planning" });
      planText = (await deps.callModel("planning", PLANNER_SYSTEM, [{ role: "user", content: `${ctx}\n\nTask: ${task}` }], deps.onToken)).trim();
      check();
      if (planText) deps.emit({ type: "text", phase: "plan", text: planText });
    }

    const first = `${ctx}\n\nTask: ${task}${planText ? `\n\nFollow this plan:\n${planText}` : ""}`;
    const messages: AgentMsg[] = [...history, { role: "user", content: first }];
    const outcome = await actLoop("build", "coding", BUILDER_SYSTEM, messages, opts.maxSteps);
    if (outcome === "limit") {
      status = "limit";
      deps.emit({ type: "warning", message: `Stopped after ${opts.maxSteps} steps. Send a follow-up to continue.` });
    } else if (outcome === "chat") {
      status = "chat";
    }

    const changedNow = summarizeChanges(before, deps.getVfs());
    if (opts.review && outcome === "done" && (changedNow.length >= 2 || runFailed)) {
      const files = changedNow
        .filter((c) => c.status !== "deleted")
        .map((c) => `--- ${c.path} (${c.status}) ---\n${deps.getVfs().files[c.path].slice(0, 6000)}`)
        .join("\n\n")
        .slice(0, 24_000);
      const reviewMsgs: AgentMsg[] = [{ role: "user", content: `Request: ${task}\n\nBuilder summary: ${summary}\n\nChanged files:\n${files}` }];
      const r = await actLoop("review", "engineering", REVIEWER_SYSTEM, reviewMsgs, 3);
      if (r === "limit") deps.emit({ type: "warning", message: "Review stopped after 3 steps." });
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
  return { status, summary, before, after, changes: summarizeChanges(before, after) };
}
