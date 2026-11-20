"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace-store";
import { useEditorState } from "@/store/editor-state-store";
import { useEditorSettings } from "@/store/editor-settings-store";
import { allFilePaths, baseName } from "@/lib/workspace/vfs";
import { fuzzyFilter } from "@/lib/workspace/fuzzy";
import { THEMES } from "@/lib/workspace/themes";
import { bridge } from "@/lib/workspace/editor-bridge";
import { buildCommands } from "./commands";
import { FileIcon } from "./file-icon";

type Row = { key: string; title: string; hint?: string; path?: string; run: () => void; positions: number[] };

/** Ctrl+P quick open, Ctrl+Shift+P commands (type ">" in quick open), ":" go to line. */
export function CommandPalette() {
  const mode = useEditorState((s) => s.palette);
  const setPalette = useEditorState((s) => s.setPalette);
  const vfs = useWorkspace((s) => s.vfs);
  const openFile = useWorkspace((s) => s.openFile);
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setQ(mode === "commands" ? ">" : mode === "goto" ? ":" : "");
    setIdx(0);
  }, [mode]);

  const effective: "files" | "commands" | "goto" | "theme" = mode === "theme" ? "theme" : q.startsWith(">") ? "commands" : q.startsWith(":") ? "goto" : "files";
  const term = effective === "commands" || effective === "goto" ? q.slice(1) : q;

  const rows: Row[] = React.useMemo(() => {
    if (!mode) return [];
    if (effective === "files") {
      return fuzzyFilter(allFilePaths(vfs), term, (p) => p, 40).map(({ item, match }) => ({ key: item, title: baseName(item), hint: item, path: item, positions: match.positions, run: () => openFile(item) }));
    }
    if (effective === "commands") {
      return fuzzyFilter(buildCommands(), term, (c) => `${c.group}: ${c.title}`, 40).map(({ item, match }) => ({ key: item.id, title: `${item.group}: ${item.title}`, hint: item.shortcut, positions: match.positions, run: item.run }));
    }
    if (effective === "theme") {
      return fuzzyFilter(THEMES, term, (t) => t.label, 20).map(({ item }) => ({ key: item.id, title: item.label, positions: [], run: () => useEditorSettings.getState().set({ theme: item.id }) }));
    }
    const n = parseInt(term, 10);
    return Number.isFinite(n) ? [{ key: "goto", title: `Go to line ${n}`, positions: [], run: () => { bridge.editor?.revealLineInCenter(n); bridge.editor?.setPosition({ lineNumber: n, column: 1 }); bridge.focus(); } }] : [{ key: "goto", title: "Type a line number", positions: [], run: () => {} }];
  }, [mode, effective, term, vfs, openFile]);

  React.useEffect(() => setIdx(0), [q]);
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const choose = (r?: Row) => {
    if (!r) return;
    setPalette(null);
    setTimeout(r.run, 0); // after the dialog closes so focus returns to the editor first
  };

  const hl = (text: string, pos: number[], offset = 0) =>
    [...text].map((ch, i) => (pos.includes(i + offset) ? <b key={i} className="text-amber-300">{ch}</b> : <React.Fragment key={i}>{ch}</React.Fragment>));

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && setPalette(null)}>
      <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 max-w-xl p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(rows.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(rows[idx]); }
          }}
          placeholder={effective === "files" ? "Search files by name (type > for commands, : for line)" : effective === "commands" ? "Type a command" : effective === "theme" ? "Pick a color theme" : "Line number"}
          className="w-full h-11 bg-transparent border-b border-border px-4 text-sm outline-none"
        />
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {rows.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">No matches</div>}
          {rows.map((r, i) => (
            <button key={r.key} data-i={i} onMouseEnter={() => setIdx(i)} onClick={() => choose(r)} className={cn("w-full flex items-center gap-2 px-4 h-8 text-sm text-left", i === idx ? "bg-muted" : "hover:bg-muted/50")}>
              {r.path && <FileIcon path={r.path} />}
              <span className="truncate">{effective === "files" ? hl(r.title, r.positions, (r.hint?.length ?? 0) - r.title.length) : effective === "commands" ? hl(r.title, r.positions) : r.title}</span>
              {r.hint && <span className={cn("ml-auto text-[11px] text-muted-foreground truncate", effective === "files" && "max-w-[55%]")}>{r.hint}</span>}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
