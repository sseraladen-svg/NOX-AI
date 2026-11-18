"use client";

import * as React from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, Bot, Check, CheckCircle2, ChevronRight, FilePen, FilePlus2, FileSearch, FolderPlus, Loader2, Play, Send, Square, Terminal, Trash2, Undo2, XCircle, ArrowRightLeft, Eye, ListTree, Search, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgent, type Item } from "@/store/agent-store";
import { useWorkspace } from "@/store/workspace-store";
import { describeStreaming, stripActions, type AgentAction } from "@/lib/workspace/agent-protocol";
import { ChangeReview } from "./change-review";
import { MissionDialog } from "./mission-dialog";

const EXAMPLES = ["Create a simple calculator in HTML, CSS and JS", "Add a README that explains this project", "Explain what this project does"];

function actionIcon(a: AgentAction) {
  const c = "h-3.5 w-3.5 shrink-0";
  switch (a.type) {
    case "write": return <FilePlus2 className={cn(c, "text-emerald-400")} />;
    case "edit": return <FilePen className={cn(c, "text-amber-400")} />;
    case "delete": return <Trash2 className={cn(c, "text-red-400")} />;
    case "rename": return <ArrowRightLeft className={cn(c, "text-sky-400")} />;
    case "mkdir": return <FolderPlus className={cn(c, "text-amber-300")} />;
    case "read": return <Eye className={cn(c, "text-muted-foreground")} />;
    case "list": return <ListTree className={cn(c, "text-muted-foreground")} />;
    case "search": return <Search className={cn(c, "text-muted-foreground")} />;
    case "run": return <Play className={cn(c, "text-emerald-400")} />;
    case "shell": return <Terminal className={cn(c, "text-fuchsia-400")} />;
    default: return <FileSearch className={c} />;
  }
}

const targetPath = (a: AgentAction) => ("path" in a ? a.path : a.type === "rename" ? a.to : null);

function Row({ item }: { item: Item }) {
  const openFile = useWorkspace((s) => s.openFile);
  switch (item.kind) {
    case "user":
      return <div className="ml-8 rounded-lg bg-primary/10 border border-border px-3 py-2 text-sm whitespace-pre-wrap">{item.text}</div>;
    case "phase":
      return (
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground pt-1">
          <Bot className="h-3 w-3" />
          {item.phase === "plan" ? "Planning" : item.phase === "review" ? "Reviewing" : "Working"} · <span className="normal-case tracking-normal font-mono">{item.label}</span>
        </div>
      );
    case "text":
      return <div className={cn("text-sm whitespace-pre-wrap text-foreground/90", item.phase === "plan" && "rounded-md border border-border bg-muted/30 px-3 py-2 text-xs")}>{item.text}</div>;
    case "action": {
      const p = targetPath(item.action);
      return (
        <div className="text-xs">
          <button
            disabled={!p || !item.ok || item.action.type === "delete"}
            onClick={() => p && openFile(p)}
            className={cn("flex items-center gap-2 w-full text-left rounded px-2 py-1 hover:bg-muted/40 disabled:hover:bg-transparent", !item.ok && "text-red-400")}
          >
            {actionIcon(item.action)}
            <span className="truncate flex-1 font-mono">{item.message}</span>
            {item.ok ? <Check className="h-3 w-3 text-emerald-400 shrink-0" /> : <XCircle className="h-3 w-3 shrink-0" />}
          </button>
          {item.output && <pre className="mx-2 mt-1 max-h-32 overflow-auto rounded bg-black/40 px-2 py-1 text-[11px] font-mono whitespace-pre-wrap">{item.output}</pre>}
        </div>
      );
    }
    case "verify": {
      const errs = item.issues.filter((i) => i.severity === "error");
      const warns = item.issues.length - errs.length;
      return (
        <div className={cn("rounded border px-2 py-1.5 text-xs", item.passed ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-200")}>
          <div className="flex items-center gap-1.5 font-medium">
            {item.passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {item.passed ? `Checks passed${warns ? ` (${warns} warning${warns > 1 ? "s" : ""})` : ""}` : `Checks found ${errs.length} problem${errs.length > 1 ? "s" : ""}${item.round === 0 ? " — sending them back to fix" : ""}`}
          </div>
          {!item.passed && <ul className="mt-1 space-y-0.5 font-mono text-[11px]">{errs.slice(0, 4).map((i, n) => <li key={n} className="truncate" title={i.message}>{i.path}{i.line ? `:${i.line}` : ""} — {i.message}</li>)}</ul>}
        </div>
      );
    }
    case "warning":
      return <div className="flex gap-2 text-xs text-amber-400"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{item.text}</div>;
    case "error":
      return <div className="flex gap-2 text-xs text-red-400 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5"><XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{item.text}</div>;
    case "info":
      return <div className="text-xs text-muted-foreground">{item.text}</div>;
    case "summary":
      return (
        <div className="rounded-lg border border-border bg-card/60 px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {item.status === "done" || item.status === "chat" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
            {item.status === "done" ? "Done" : item.status === "chat" ? "Answer" : item.status === "stopped" ? "Stopped" : item.status === "limit" ? "Step limit reached" : "Failed"}
            {item.changes.length > 0 && <span className="text-muted-foreground font-normal">· {item.changes.length} file{item.changes.length > 1 ? "s" : ""} changed</span>}
          </div>
          {item.text && <div className="text-sm whitespace-pre-wrap">{item.text}</div>}
        </div>
      );
  }
}

export function AgentPanel() {
  const { items, running, streaming, draft, settings, checkpoint, setDraft, setSettings, start, stop, undo, keep, clear } = useAgent(
    useShallow((s) => ({
      items: s.items, running: s.running, streaming: s.streaming, draft: s.draft, settings: s.settings, checkpoint: s.checkpoint,
      setDraft: s.setDraft, setSettings: s.setSettings, start: s.start, stop: s.stop, undo: s.undo, keep: s.keep, clear: s.clear,
    }))
  );
  const [review, setReview] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const live = React.useMemo(() => describeStreaming(streaming) || stripActions(streaming).slice(-300), [streaming]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length, live, running]);

  React.useEffect(() => {
    const onDraft = (e: Event) => {
      setDraft((e as CustomEvent<string>).detail);
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    const onFocus = () => setTimeout(() => inputRef.current?.focus(), 50);
    window.addEventListener("nox:agent-draft", onDraft);
    window.addEventListener("nox:focus-agent", onFocus);
    return () => {
      window.removeEventListener("nox:agent-draft", onDraft);
      window.removeEventListener("nox:focus-agent", onFocus);
    };
  }, [setDraft]);

  const submit = () => {
    if (!draft.trim() || running) return;
    void start(draft);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-[10px] text-muted-foreground shrink-0 flex-wrap">
        <label className="flex items-center gap-1">Ask before running
          <select value={settings.confirm} onChange={(e) => setSettings({ confirm: e.target.value as typeof settings.confirm })} className="bg-transparent border border-border rounded px-1 py-0.5 text-foreground">
            <option value="always">always</option><option value="complex">bigger tasks</option><option value="never">never</option>
          </select>
        </label>
        <label className="flex items-center gap-1 cursor-pointer" title="Lets the agent propose terminal commands (needs Local shell; asks before each command)"><input type="checkbox" checked={settings.allowShell} onChange={(e) => setSettings({ allowShell: e.target.checked })} className="accent-foreground" />Shell</label>
        {items.length > 0 && <button onClick={() => { if (!running) clear(); }} className="ml-auto hover:text-foreground">Clear</button>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto nox-scroll px-3 py-3 space-y-2">
        {items.length === 0 && (
          <div className="text-center text-muted-foreground pt-6 space-y-3">
            <Wand2 className="h-7 w-7 mx-auto opacity-60" />
            <p className="text-sm text-foreground">Tell the agent what to build.</p>
            <p className="text-xs max-w-xs mx-auto">It creates, edits, reads and deletes files in your workspace directly, runs JavaScript to check its work, and shows every step. You can undo all of it.</p>
            <div className="flex flex-col gap-1.5 items-center pt-1">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => setDraft(e)} className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-muted/50">{e}</button>
              ))}
            </div>
          </div>
        )}
        {items.map((i) => <Row key={i.id} item={i} />)}
        {running && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 mt-0.5" />
            <span className="whitespace-pre-wrap break-words min-w-0">{live || "Thinking…"}</span>
          </div>
        )}
        {!running && checkpoint && (
          <div className="flex items-center gap-2 pt-1">
            <button onClick={keep} className="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-emerald-600/20 text-emerald-300 text-xs hover:bg-emerald-600/30"><Check className="h-3.5 w-3.5" />Keep</button>
            <button onClick={undo} className="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-red-600/20 text-red-300 text-xs hover:bg-red-600/30"><Undo2 className="h-3.5 w-3.5" />Undo</button>
            <button onClick={() => setReview(true)} className="inline-flex items-center gap-1 h-7 px-3 rounded-md border border-border text-xs hover:bg-muted/50"><ChevronRight className="h-3.5 w-3.5" />Review changes</button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-border p-2 flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={2}
          placeholder={running ? "Agent is working…" : "Describe what to build or change (Enter to send)"}
          disabled={running}
          className="flex-1 resize-none rounded-md bg-muted/30 border border-border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-foreground/30 disabled:opacity-60"
        />
        {running ? (
          <button onClick={stop} className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-red-600/80 text-white hover:bg-red-600" title="Stop"><Square className="h-4 w-4" /></button>
        ) : (
          <button onClick={submit} disabled={!draft.trim()} className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-foreground text-background disabled:opacity-40" title="Send"><Send className="h-4 w-4" /></button>
        )}
      </div>
      <MissionDialog />
      <ChangeReview open={review} onClose={() => setReview(false)} before={checkpoint?.before ?? null} changes={checkpoint?.changes ?? []} />
    </div>
  );
}
