"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useShallow } from "zustand/react/shallow";
import { Bug, FileCode2, Globe, Play, Save, Sparkles, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace-store";
import { baseName } from "@/lib/workspace/vfs";
import { languageFor } from "@/lib/workspace/language";
import { runWorkspaceFile } from "./run-actions";

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Loading editor…</div>,
});

const tbtn = "inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition disabled:opacity-40";

export function WorkspaceEditor({ onAsk, onPreview }: { onAsk: (text: string) => void; onPreview: (path: string) => void }) {
  const { resolvedTheme } = useTheme();
  const { vfs, tabs, active, dirty, setActive, closeTab, setContent, saveFile, setSelection, openFile } = useWorkspace(
    useShallow((s) => ({
      vfs: s.vfs, tabs: s.tabs, active: s.active, dirty: s.dirty, setActive: s.setActive, closeTab: s.closeTab,
      setContent: s.setContent, saveFile: s.saveFile, setSelection: s.setSelection, openFile: s.openFile,
    }))
  );
  const activeRef = React.useRef(active);
  React.useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const content = active ? vfs.files[active] : undefined;
  const isJs = !!active && /\.(m?js|cjs)$/i.test(active);
  const isHtml = !!active && /\.html?$/i.test(active);

  const askAbout = (verb: string) => {
    if (!active) return;
    onAsk(`${verb} ${useWorkspace.getState().selection ? "the selected code" : "this file"} (${active}).`);
  };

  const close = (p: string) => {
    if (dirty[p] && !window.confirm(`${baseName(p)} has unsaved changes. Close anyway?`)) return;
    closeTab(p);
  };

  return (
    <div className="h-full flex flex-col min-h-0 min-w-0">
      <div className="flex items-stretch border-b border-border bg-card/40 shrink-0 overflow-x-auto nox-scroll">
        {tabs.map((p) => (
          <div
            key={p}
            onClick={() => setActive(p)}
            onAuxClick={() => close(p)}
            className={cn("group flex items-center gap-1.5 pl-3 pr-1.5 h-8 text-xs cursor-pointer border-r border-border shrink-0", p === active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-muted/40")}
            title={p}
          >
            <FileCode2 className="h-3 w-3" />
            <span className="max-w-[140px] truncate">{baseName(p)}</span>
            {dirty[p] ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}
            <button className="h-4 w-4 inline-flex items-center justify-center rounded hover:bg-muted/70 opacity-60 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); close(p); }} aria-label={`Close ${baseName(p)}`}>
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {active && content !== undefined ? (
        <>
          <div className="flex items-center gap-0.5 px-2 h-7 border-b border-border shrink-0 overflow-x-auto nox-scroll">
            <span className="text-[11px] text-muted-foreground font-mono truncate mr-2">{active}</span>
            <button className={tbtn} onClick={() => void saveFile(active)} title="Save (Ctrl/Cmd+S)"><Save className="h-3 w-3" />Save</button>
            {isJs && <button className={tbtn} onClick={() => runWorkspaceFile(active)} title="Run in sandbox"><Play className="h-3 w-3 text-emerald-400" />Run</button>}
            {isHtml && <button className={tbtn} onClick={() => onPreview(active)} title="Preview in sandbox"><Globe className="h-3 w-3 text-sky-400" />Preview</button>}
            <span className="mx-1 h-3 w-px bg-border" />
            <button className={tbtn} onClick={() => askAbout("Explain")} title="Ask the Host to explain"><Sparkles className="h-3 w-3" />Explain</button>
            <button className={tbtn} onClick={() => askAbout("Find and fix bugs in")} title="Ask the Host to fix bugs"><Bug className="h-3 w-3" />Fix</button>
            <button className={tbtn} onClick={() => askAbout("Refactor and simplify")} title="Ask the Host to refactor"><Wand2 className="h-3 w-3" />Refactor</button>
          </div>
          <div className="flex-1 min-h-0">
            <Monaco
              path={active}
              language={languageFor(active)}
              value={content}
              theme={resolvedTheme === "light" ? "light" : "vs-dark"}
              onChange={(v) => activeRef.current && setContent(activeRef.current, v ?? "")}
              onMount={(editor, monaco) => {
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                  if (activeRef.current) void useWorkspace.getState().saveFile(activeRef.current);
                });
                editor.onDidChangeCursorSelection(() => {
                  const sel = editor.getSelection();
                  const model = editor.getModel();
                  setSelection(sel && model && !sel.isEmpty() ? model.getValueInRange(sel) : "");
                });
              }}
              options={{ fontSize: 13, minimap: { enabled: false }, automaticLayout: true, wordWrap: "on", tabSize: 2, scrollBeyondLastLine: false, padding: { top: 8 } }}
            />
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-6 text-muted-foreground">
          <FileCode2 className="h-8 w-8 opacity-50" />
          <p className="text-sm">No file open</p>
          <p className="text-xs max-w-xs">Pick a file in the explorer, or ask the Host to build something and press Apply on its code.</p>
          <button className="text-xs underline" onClick={() => openFile("/README.md")}>Open README.md</button>
        </div>
      )}
    </div>
  );
}
