"use client";

import * as React from "react";
import { useShallow } from "zustand/react/shallow";
import { Check, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace-store";
import { summarizeChanges } from "@/lib/workspace/agent-exec";
import { ChangeReview } from "./change-review";
import { FileIcon } from "./file-icon";

const COLOR = { added: "text-emerald-400", modified: "text-amber-400", deleted: "text-red-400" } as const;
const MARK = { added: "A", modified: "M", deleted: "D" } as const;

/** Source-control style view: everything that differs from the baseline (the state when the workspace was opened or last accepted). */
export function ChangesPanel() {
  const { vfs, baseline, discardChange, acceptBaseline, openFile } = useWorkspace(useShallow((s) => ({ vfs: s.vfs, baseline: s.baseline, discardChange: s.discardChange, acceptBaseline: s.acceptBaseline, openFile: s.openFile })));
  const changes = React.useMemo(() => summarizeChanges(baseline, vfs), [baseline, vfs]);
  const [review, setReview] = React.useState<string | null>(null);
  return (
    <div className="h-full flex flex-col min-h-0 bg-card/40">
      <div className="px-2 h-8 flex items-center justify-between border-b border-border shrink-0">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">CHANGES {changes.length > 0 && `(${changes.length})`}</span>
        {changes.length > 0 && (
          <button className="h-6 px-2 inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60" title="Treat the current state as the new baseline (like a commit)" onClick={acceptBaseline}>
            <Check className="h-3 w-3" />Accept all
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nox-scroll py-1 text-xs">
        {changes.length === 0 && <div className="p-3 text-muted-foreground">No changes since the workspace was opened. Edits by you or the agent will show here.</div>}
        {changes.map((c) => (
          <div key={c.path} className="group flex items-center gap-1.5 px-2 h-6 hover:bg-muted/50 cursor-pointer" onClick={() => setReview(c.path)} title="Open diff">
            <FileIcon path={c.path} />
            <span className="truncate flex-1" onDoubleClick={() => c.status !== "deleted" && openFile(c.path)}>{c.path}</span>
            <button className="hidden group-hover:inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted" title="Discard changes" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Discard changes to ${c.path}?`)) discardChange(c.path); }}><Undo2 className="h-3 w-3" /></button>
            <span className={cn("font-mono font-bold w-3 text-center", COLOR[c.status])}>{MARK[c.status]}</span>
          </div>
        ))}
      </div>
      <ChangeReview open={!!review} onClose={() => setReview(null)} before={baseline} changes={changes} initial={review} />
    </div>
  );
}
