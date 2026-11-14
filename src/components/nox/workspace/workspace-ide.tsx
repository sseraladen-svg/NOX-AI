"use client";

import * as React from "react";
import { useShallow } from "zustand/react/shallow";
import { MessageSquare, PanelLeft, PanelBottom, Code2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace-store";
import { useIdeBridge } from "@/store/ide-bridge-store";
import { setEditorContextProvider } from "@/lib/workspace/editor-context";
import { allFilePaths, baseName } from "@/lib/workspace/vfs";
import { WorkspaceExplorer } from "./workspace-explorer";
import { WorkspaceEditor } from "./workspace-editor";
import { WorkspaceTerminal } from "./workspace-terminal";
import { WorkspacePreview } from "./workspace-preview";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Pointer-drag helper: calls onMove with the pointer position while dragging. */
function useDrag(onMove: (x: number, y: number) => void) {
  return (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => onMove(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

export function WorkspaceIDE({ chatPane, onAsk }: { chatPane: React.ReactNode; onAsk: (text: string) => void }) {
  const { explorerOpen, terminalOpen, contextEnabled, toggleExplorer, toggleTerminal, setContextEnabled, active, fileCount } = useWorkspace(
    useShallow((s) => ({
      explorerOpen: s.explorerOpen, terminalOpen: s.terminalOpen, contextEnabled: s.contextEnabled, toggleExplorer: s.toggleExplorer,
      toggleTerminal: s.toggleTerminal, setContextEnabled: s.setContextEnabled, active: s.active, fileCount: Object.keys(s.vfs.files).length,
    }))
  );
  const [pane, setPane] = React.useState<"chat" | "code">("chat");
  const [chatW, setChatW] = React.useState(440);
  const [termH, setTermH] = React.useState(240);
  const [preview, setPreview] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const colRef = React.useRef<HTMLDivElement>(null);

  // Connect the workspace to the chat: context provider + "Apply" button target.
  React.useEffect(() => {
    void useWorkspace.getState().hydrate();
    useIdeBridge.getState().register((code, lang) => useWorkspace.getState().applyCode(code, lang));
    setEditorContextProvider(() => {
      const s = useWorkspace.getState();
      if (!s.contextEnabled) return null;
      const activeFile = s.active && s.active in s.vfs.files ? { path: s.active, content: s.vfs.files[s.active], selection: s.selection || undefined } : undefined;
      return { paths: allFilePaths(s.vfs), openTabs: s.tabs, active: activeFile };
    });
    return () => {
      useIdeBridge.getState().unregister();
      setEditorContextProvider(null);
    };
  }, []);

  const dragChat = useDrag((x) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setChatW(clamp(r.right - x, 320, Math.max(360, r.width - 420)));
  });
  const dragTerm = useDrag((_x, y) => {
    const r = colRef.current?.getBoundingClientRect();
    if (r) setTermH(clamp(r.bottom - y, 90, Math.max(120, r.height - 140)));
  });

  const seg = (id: "chat" | "code", label: string, icon: React.ReactNode) => (
    <button onClick={() => setPane(id)} className={cn("flex-1 flex items-center justify-center gap-1.5 h-8 text-xs", pane === id ? "bg-muted text-foreground" : "text-muted-foreground")}>
      {icon}{label}
    </button>
  );

  return (
    <div ref={rootRef} className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
      <div className="lg:hidden flex border-b border-border shrink-0">{seg("chat", "Host chat", <MessageSquare className="h-3.5 w-3.5" />)}{seg("code", "Code", <Code2 className="h-3.5 w-3.5" />)}</div>

      {/* Workbench: explorer | editor + terminal */}
      <section className={cn("flex-1 min-w-0 min-h-0 flex-row", pane === "chat" ? "hidden lg:flex" : "flex")}>
        {explorerOpen && (
          <aside className="w-52 shrink-0 border-r border-border min-h-0 hidden sm:block">
            <WorkspaceExplorer />
          </aside>
        )}
        <div ref={colRef} className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="flex items-center gap-1 px-2 h-7 border-b border-border shrink-0 bg-card/30">
            <button className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground" onClick={toggleExplorer} title="Toggle explorer"><PanelLeft className="h-3.5 w-3.5" /></button>
            <button className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground" onClick={toggleTerminal} title="Toggle terminal"><PanelBottom className="h-3.5 w-3.5" /></button>
            <span className="text-[10px] text-muted-foreground ml-1 truncate">{active ? baseName(active) : "No file"} · {fileCount} files</span>
          </div>
          <div className="flex-1 min-h-0">
            <WorkspaceEditor onAsk={(t) => { onAsk(t); setPane("chat"); }} onPreview={setPreview} />
          </div>
          {terminalOpen && (
            <>
              <div onPointerDown={dragTerm} className="h-1 cursor-row-resize bg-border hover:bg-foreground/30 shrink-0" role="separator" aria-orientation="horizontal" />
              <div style={{ height: termH }} className="shrink-0 min-h-0">
                <WorkspaceTerminal />
              </div>
            </>
          )}
        </div>
      </section>

      <div onPointerDown={dragChat} className="hidden lg:block w-1 cursor-col-resize bg-border hover:bg-foreground/30 shrink-0" role="separator" aria-orientation="vertical" />

      {/* Orchestrator chat */}
      <aside
        style={{ ["--chat-w" as string]: `${chatW}px` }}
        className={cn("min-h-0 min-w-0 flex-col flex-1 lg:flex-none lg:shrink-0 lg:w-[var(--chat-w)]", pane === "code" ? "hidden lg:flex" : "flex")}
      >
        <div className="flex items-center justify-between gap-2 px-3 h-7 border-b border-border shrink-0 bg-card/30">
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground flex items-center gap-1"><FileText className="h-3 w-3" />HOST &amp; SPECIALISTS</span>
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none" title="Send your open file, selection and file list with each message">
            <input type="checkbox" checked={contextEnabled} onChange={(e) => setContextEnabled(e.target.checked)} className="accent-foreground" />
            Editor context
          </label>
        </div>
        {chatPane}
      </aside>

      <WorkspacePreview path={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
