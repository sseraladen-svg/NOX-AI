"use client";

import * as React from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAgent, type Edits } from "@/store/agent-store";
import { type Availability, type PlannedStep, type Source, effectiveSource, suggestAlternative } from "@/lib/workspace/agent-routing";

const SOURCES: Source[] = ["host", "planning", "coding", "automation", "engineering"];
const INTENT_LABEL: Record<string, string> = {
  explain: "Question about the code", create: "Create something new", modify: "Change existing code", cleanup: "Delete / clean up",
  automation: "Automation / workflow", plan: "Planning only", vision: "Image task", general: "General task",
};

function Pill({ a }: { a: Availability | undefined }) {
  if (!a) return <span className="text-[10px] text-muted-foreground">checking…</span>;
  const cls = a.status === "ready" && !a.caution ? "text-emerald-400" : a.status === "unavailable" ? "text-red-400" : "text-amber-400";
  const Icon = a.status === "ready" && !a.caution ? CheckCircle2 : a.status === "unavailable" ? XCircle : AlertTriangle;
  return <span className={cn("inline-flex items-center gap-1 text-[10px]", cls)}><Icon className="h-3 w-3" />{a.status === "unavailable" ? "Unavailable" : a.caution || a.status === "warn" ? "Caution" : "Ready"}</span>;
}

/** Shown after the request is analysed and before any agent runs: pick agents, see availability and alternatives. */
export function MissionDialog() {
  const { pending, confirmRun, cancelPending, settings, setSettings } = useAgent(
    useShallow((s) => ({ pending: s.pending, confirmRun: s.confirmRun, cancelPending: s.cancelPending, settings: s.settings, setSettings: s.setSettings }))
  );
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>({});
  const [sources, setSources] = React.useState<Record<string, Source | "auto">>({});
  const [quiet, setQuiet] = React.useState(false);

  React.useEffect(() => {
    if (pending) {
      setEnabled(Object.fromEntries(pending.analysis.steps.map((s) => [s.id, s.enabled])));
      setSources({});
      setQuiet(false);
    }
  }, [pending?.task]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pending) return null;
  const { analysis, availability } = pending;
  const classifying = pending.classifying;
  const av = availability ?? [];
  const byS = (s: Source) => av.find((a) => a.source === s);
  const activeSteps = analysis.steps.filter((s) => enabled[s.id] ?? s.enabled);
  const resolved = (s: PlannedStep): Source | null => (availability ? effectiveSource(s.role, sources[s.id] && sources[s.id] !== "auto" ? (sources[s.id] as Source) : null, av) : null);
  const canRun = !classifying && !!availability && activeSteps.every((s) => resolved(s) !== null);

  const run = () => {
    const edits: Edits = { enabled: {}, sources: {} };
    for (const s of analysis.steps) {
      edits.enabled[s.id] = enabled[s.id] ?? s.enabled;
      edits.sources[s.id] = resolved(s);
    }
    if (quiet) setSettings({ confirm: "complex" });
    void confirmRun(edits);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && cancelPending()}>
      <DialogContent className="max-w-2xl w-[96vw] max-h-[88vh] overflow-y-auto gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">Plan check — before the agents run</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
          <div className="text-xs text-muted-foreground mb-1">Your request</div>
          <div className="line-clamp-3 whitespace-pre-wrap">{pending.task}</div>
          <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
            <span className="rounded bg-muted px-2 py-0.5">{INTENT_LABEL[analysis.intent] ?? analysis.intent}</span>
            <span className="rounded bg-muted px-2 py-0.5">Size: {analysis.complexity}</span>
            <span className="rounded bg-muted px-2 py-0.5">Match: {Math.round(analysis.confidence * 100)}%</span>
            <span className="rounded bg-muted px-2 py-0.5">{classifying ? "Asking the Host model…" : pending.classifiedBy ? `Classified by Host model (${pending.classifiedBy})` : "Classified by rules"}</span>
            {analysis.readOnly && <span className="rounded bg-sky-500/20 text-sky-300 px-2 py-0.5">Read-only</span>}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            Agents needed {!availability && <span className="inline-flex items-center gap-1 font-normal"><Loader2 className="h-3 w-3 animate-spin" />checking your models…</span>}
          </div>
          {analysis.steps.map((s) => {
            const on = enabled[s.id] ?? s.enabled;
            const chosen = sources[s.id] && sources[s.id] !== "auto" ? (sources[s.id] as Source) : null;
            const eff = resolved(s);
            const effAv = eff ? byS(eff) : undefined;
            const sug = availability ? suggestAlternative(s.role, av) : null;
            return (
              <div key={s.id} className={cn("rounded-md border border-border px-3 py-2 space-y-1.5", !on && "opacity-50")}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={on} disabled={s.required} onChange={(e) => setEnabled((x) => ({ ...x, [s.id]: e.target.checked }))} className="accent-foreground" aria-label={`Use ${s.label}`} />
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 uppercase tracking-wide">{s.role}</span>
                  {s.required && <span className="text-[10px] text-muted-foreground">required</span>}
                  <span className="ml-auto"><Pill a={effAv} /></span>
                </div>
                <div className="text-xs text-muted-foreground">{s.reason}</div>
                {on && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0">Model</span>
                    <select
                      value={chosen ?? "auto"}
                      onChange={(e) => setSources((x) => ({ ...x, [s.id]: e.target.value as Source | "auto" }))}
                      className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1"
                    >
                      <option value="auto">Auto{eff ? ` → ${eff}: ${byS(eff)?.model ?? ""}` : ""}</option>
                      {SOURCES.map((src) => {
                        const a = byS(src);
                        return <option key={src} value={src}>{src}: {a?.model ?? "…"}{a && a.status === "unavailable" ? " (unavailable)" : ""}</option>;
                      })}
                    </select>
                  </div>
                )}
                {on && availability && effAv && (effAv.status !== "ready" || effAv.caution) && <div className="text-[11px] text-amber-400">{effAv.note}</div>}
                {on && availability && !eff && (
                  <div className="text-[11px] rounded bg-red-500/10 border border-red-500/30 text-red-300 px-2 py-1.5 space-y-1">
                    <div>{chosen ? `${byS(chosen)?.note ?? "That model is not usable."}` : "No model is available for this step."}</div>
                    {sug && <div className="text-foreground/80">{sug.message}</div>}
                    {sug?.source && <button className="underline" onClick={() => setSources((x) => ({ ...x, [s.id]: sug.source as Source }))}>Use {sug.source}</button>}
                  </div>
                )}
                {on && availability && eff && chosen === null && eff !== s.role && (
                  <div className="text-[11px] text-sky-300">Using the {eff} model instead because the {s.role} model is not ready.</div>
                )}
              </div>
            );
          })}
        </div>

        {analysis.notes.map((n) => <div key={n} className="flex gap-2 text-xs text-amber-400"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{n}</div>)}

        <div className="text-[11px] text-muted-foreground">
          Estimated {analysis.estimate} · up to {analysis.maxSteps} build steps · {analysis.budget.ctx / 1024}k context. Everything the agents change can be undone.
        </div>

        <div className="flex items-center gap-3 pt-1">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} className="accent-foreground" />
            Only ask for bigger tasks next time {settings.confirm === "complex" && "(on)"}
          </label>
          <div className="ml-auto flex gap-2">
            <button onClick={cancelPending} className="h-8 px-3 rounded-md border border-border text-sm hover:bg-muted/50">Cancel</button>
            <button onClick={run} disabled={!canRun} className="h-8 px-4 rounded-md bg-foreground text-background text-sm font-medium disabled:opacity-40">Run agents</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
