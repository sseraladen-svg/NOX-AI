"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace-store";
import { languageFor } from "@/lib/workspace/language";
import type { FileChange } from "@/lib/workspace/agent-exec";
import type { VfsState } from "@/lib/workspace/vfs";

const Diff = dynamic(() => import("@monaco-editor/react").then((m) => m.DiffEditor), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Loading diff…</div>,
});

const COLOR = { added: "text-emerald-400", modified: "text-amber-400", deleted: "text-red-400" } as const;
const MARK = { added: "A", modified: "M", deleted: "D" } as const;

/** Side-by-side diff of what the agent changed (before vs. now). */
export function ChangeReview({ open, onClose, before, changes }: { open: boolean; onClose: () => void; before: VfsState | null; changes: FileChange[] }) {
  const { resolvedTheme } = useTheme();
  const vfs = useWorkspace((s) => s.vfs);
  const [sel, setSel] = React.useState<string | null>(null);
  const current = sel ?? changes[0]?.path ?? null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl w-[96vw] h-[82vh] flex flex-col gap-2 p-3">
        <DialogHeader>
          <DialogTitle className="text-sm">Review changes ({changes.length} file{changes.length === 1 ? "" : "s"})</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex gap-2">
          <ul className="w-56 shrink-0 overflow-y-auto border border-border rounded-md text-xs">
            {changes.map((c) => (
              <li key={c.path}>
                <button onClick={() => setSel(c.path)} className={cn("w-full text-left px-2 py-1.5 flex items-center gap-2 hover:bg-muted/50", c.path === current && "bg-muted/70")}>
                  <span className={cn("font-mono font-bold", COLOR[c.status])}>{MARK[c.status]}</span>
                  <span className="truncate" title={c.path}>{c.path}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex-1 min-w-0 border border-border rounded-md overflow-hidden">
            {current && (
              <Diff
                original={before?.files[current] ?? ""}
                modified={vfs.files[current] ?? ""}
                language={languageFor(current)}
                theme={resolvedTheme === "light" ? "light" : "vs-dark"}
                options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false }}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
