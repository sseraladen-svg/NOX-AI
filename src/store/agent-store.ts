import { create } from "zustand";
import { toast } from "sonner";
import { useWorkspace } from "@/store/workspace-store";
import { runAgent, type AgentEvent, type AgentMsg, type Phase } from "@/lib/workspace/agent-runner";
import { type Analysis, type Availability, type Source, analyzeTask } from "@/lib/workspace/agent-routing";
import { type AgentAction } from "@/lib/workspace/agent-protocol";
import { type FileChange, revertChanges } from "@/lib/workspace/agent-exec";
import { type VfsState } from "@/lib/workspace/vfs";
import { callAgentModel, checkAvailability, describeRole } from "@/lib/workspace/agent-model";
import { execLocalCommand } from "@/lib/workspace/local-shell-client";
import { runFileCaptured } from "@/components/nox/workspace/run-actions";

export type Item =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "phase"; phase: string; label: string }
  | { id: number; kind: "text"; phase: string; text: string }
  | { id: number; kind: "action"; action: AgentAction; ok: boolean; message: string; output?: string }
  | { id: number; kind: "warning" | "error" | "info"; text: string }
  | { id: number; kind: "summary"; status: string; text: string; changes: FileChange[] };

type NewItem<T = Item> = T extends Item ? Omit<T, "id"> : never;

export type Confirm = "always" | "complex" | "never";
export type Settings = { confirm: Confirm; allowShell: boolean };
export type Pending = { task: string; analysis: Analysis; availability: Availability[] | null };
/** What the user chose in the mission popup. */
export type Edits = { enabled: Partial<Record<Phase, boolean>>; sources: Partial<Record<Phase, Source | null>> };

interface AgentState {
  items: Item[];
  running: boolean;
  streaming: string;
  draft: string;
  settings: Settings;
  pending: Pending | null;
  history: AgentMsg[];
  checkpoint: { before: VfsState; changes: FileChange[] } | null;
  setDraft: (t: string) => void;
  setSettings: (s: Partial<Settings>) => void;
  start: (task: string) => Promise<void>;
  confirmRun: (edits: Edits) => Promise<void>;
  execute: (task: string, analysis: Analysis, edits: Edits) => Promise<void>;
  cancelPending: () => void;
  stop: () => void;
  undo: () => void;
  keep: () => void;
  clear: () => void;
}

let seq = 0;
let controller: AbortController | null = null;
const MAX_HISTORY = 12;

export const useAgent = create<AgentState>((set, get) => ({
  items: [],
  running: false,
  streaming: "",
  draft: "",
  settings: { confirm: "always", allowShell: false },
  pending: null,
  history: [],
  checkpoint: null,

  setDraft: (draft) => set({ draft }),
  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
  stop: () => controller?.abort(),
  keep: () => set({ checkpoint: null }),
  clear: () => set({ items: [], history: [], checkpoint: null, streaming: "" }),

  undo: () => {
    const cp = get().checkpoint;
    if (!cp) return;
    const ws = useWorkspace.getState();
    ws.commit(revertChanges(ws.vfs, cp.before, cp.changes));
    set((st) => ({ checkpoint: null, items: [...st.items, { id: ++seq, kind: "info", text: `Reverted ${cp.changes.length} file change(s).` }] }));
    toast.success("Agent changes reverted");
  },

  cancelPending: () => set({ pending: null }),

  start: async (task) => {
    const text = task.trim();
    if (!text || get().running || get().pending) return;
    const analysis = analyzeTask(text, { fileCount: Object.keys(useWorkspace.getState().vfs.files).length });
    const { confirm } = get().settings;
    if (confirm === "never" || (confirm === "complex" && analysis.complexity === "small")) {
      await get().execute(text, analysis, { enabled: {}, sources: {} });
      return;
    }
    set({ pending: { task: text, analysis, availability: null }, draft: "" });
    void checkAvailability()
      .then((availability) => set((st) => (st.pending?.task === text ? { pending: { ...st.pending, availability } } : st)))
      .catch(() => set((st) => (st.pending?.task === text ? { pending: { ...st.pending, availability: [] } } : st)));
  },

  confirmRun: async (edits) => {
    const p = get().pending;
    if (!p) return;
    set({ pending: null });
    await get().execute(p.task, p.analysis, edits);
  },

  execute: async (task, analysis, edits) => {
    const text = task.trim();
    const stepOn = (id: Phase) => edits.enabled[id] ?? analysis.steps.find((s) => s.id === id)?.enabled ?? false;
    const hasStep = (id: Phase) => analysis.steps.some((s) => s.id === id);
    const sourceFor = (role: string): Source | null | undefined => (role === "planning" ? edits.sources.plan : role === "engineering" ? edits.sources.review : edits.sources.build);
    const push = (i: NewItem) => set((st) => ({ items: [...st.items, { ...i, id: ++seq } as Item] }));
    push({ kind: "user", text });
    set({ running: true, streaming: "", draft: "", checkpoint: null });
    controller = new AbortController();
    const signal = controller.signal;
    const settings = get().settings;
    const ws = () => useWorkspace.getState();

    const onEvent = (e: AgentEvent) => {
      if (e.type === "phase") push({ kind: "phase", phase: e.phase, label: describeRole(e.role, sourceFor(e.role)) });
      else if (e.type === "text") push({ kind: "text", phase: e.phase, text: e.text });
      else if (e.type === "action") push({ kind: "action", action: e.action, ok: e.result.ok, message: e.result.message, output: e.action.type === "run" || e.action.type === "shell" ? e.result.output : undefined });
      else if (e.type === "warning") push({ kind: "warning", text: e.message });
      else push({ kind: "error", text: e.message });
    };

    const result = await runAgent(
      text,
      get().history,
      {
        callModel: async (role, system, messages, _onToken, budget) => {
          set({ streaming: "" });
          try {
            return await callAgentModel(role, system, messages, (t) => set((st) => ({ streaming: st.streaming + t })), signal, { source: sourceFor(role), budget });
          } finally {
            set({ streaming: "" });
          }
        },
        getVfs: () => ws().vfs,
        commit: (next) => ws().commit(next),
        context: () => ({ active: ws().active, tabs: ws().tabs, selection: ws().selection }),
        runFile: runFileCaptured,
        runShell: async (command) => {
          if (!settings.allowShell) throw new Error("shell commands are turned off in the agent settings");
          const info = (await fetch("/api/workspace/exec").then((r) => r.json())) as { enabled?: boolean; reason?: string };
          if (!info.enabled) throw new Error(info.reason ?? "Local shell is not available");
          if (!window.confirm(`The agent wants to run this command on your computer:\n\n${command}\n\nAllow?`)) throw new Error("declined by the user");
          return execLocalCommand(command);
        },
        emit: onEvent,
        signal,
      },
      {
        plan: hasStep("plan") && stepOn("plan") ? "always" : "never",
        review: hasStep("review") && stepOn("review"),
        maxSteps: analysis.maxSteps,
        readOnly: analysis.readOnly,
        planOnly: analysis.planOnly,
        autoFinish: analysis.autoFinish,
        buildRole: analysis.steps.find((s) => s.id === "build")?.role ?? "coding",
        budget: analysis.budget,
      }
    ).catch((e: Error) => {
      push({ kind: "error", text: e.message });
      return null;
    });

    controller = null;
    if (result) {
      push({ kind: "summary", status: result.status, text: result.summary, changes: result.changes });
      push({ kind: "info", text: `${result.calls} model call${result.calls === 1 ? "" : "s"} used` });
      set((st) => ({
        history: [...st.history, { role: "user" as const, content: text }, { role: "assistant" as const, content: result.summary || "(no summary)" }].slice(-MAX_HISTORY),
        checkpoint: result.changes.length ? { before: result.before, changes: result.changes } : null,
      }));
    }
    set({ running: false, streaming: "" });
  },
}));
