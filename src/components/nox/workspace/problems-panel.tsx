"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorState } from "@/store/editor-state-store";
import { bridge } from "@/lib/workspace/editor-bridge";
import { FileIcon } from "./file-icon";

export function ProblemsPanel() {
  const problems = useEditorState((s) => s.problems);
  const [filter, setFilter] = React.useState<"all" | "error" | "warning">("all");
  const list = problems.filter((p) => filter === "all" || p.severity === filter);
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  return (
    <div className="h-full flex flex-col min-h-0 bg-card/40">
      <div className="flex items-center gap-2 px-3 h-7 border-b border-border text-[11px] shrink-0">
        {(["all", "error", "warning"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("px-2 h-5 rounded", filter === f ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {f === "all" ? `All (${problems.length})` : f === "error" ? `Errors (${errors})` : `Warnings (${warnings})`}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nox-scroll text-xs">
        {list.length === 0 && <div className="p-4 flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-400" />No problems detected in the workspace.</div>}
        {list.map((p, i) => (
          <button key={i} onClick={() => bridge.reveal(p.path, p.line, p.col)} className="w-full flex items-start gap-2 px-3 py-1 text-left hover:bg-muted/50">
            {p.severity === "error" ? <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" /> : p.severity === "warning" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" /> : <Info className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />}
            <span className="flex-1 min-w-0">{p.message}{p.source && <span className="text-muted-foreground"> {p.source}{p.code ? `(${p.code})` : ""}</span>}</span>
            <span className="flex items-center gap-1 text-muted-foreground shrink-0"><FileIcon path={p.path} />{p.path}:{p.line}:{p.col}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
