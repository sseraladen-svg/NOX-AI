"use client";

import * as React from "react";
import { useShallow } from "zustand/react/shallow";
import { Code2, FilesIcon, GitCompare, MessageSquare, PanelBottom, Plus, Search, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace-store";
import { useEditorState } from "@/store/editor-state-store";
import { useEditorSettings } from "@/store/editor-settings-store";
import { summarizeChanges } from "@/lib/workspace/agent-exec";
import { WorkspaceExplorer } from "./workspace-explorer";
import { WorkspaceEditor } from "./workspace-editor";
import { WorkspaceTerminal } from "./workspace-terminal";
import { WorkspacePreview } from "./workspace-preview";
import { AgentPanel } from "./agent-panel";
import { SearchPanel } from "./search-panel";
import { ChangesPanel } from "./changes-panel";
import { ProblemsPanel } from "./problems-panel";
import { StatusBar } from "./status-bar";
import { CommandPalette } from "./command-palette";
import { SettingsDialog } from "./settings-dialog";
import { saveActive } from "./commands";

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

const actBtn = (on: boolean) => cn("relative h-10 w-full inline-flex items-center justify-center border-l-2 transition", on ? "border-[#7c5cff] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground");

export function WorkspaceIDE() {
  const { explorerOpen, terminalOpen, toggleExplorer, toggleTerminal, source, dirty, vfs, baseline } = useWorkspace(
    useShallow((s) => ({ explorerOpen: s.explorerOpen, terminalOpen: s.terminalOpen, toggleExplorer: s.toggleExplorer, toggleTerminal: s.toggleTerminal, source: s.source, dirty: s.dirty, vfs: s.vfs, baseline: s.baseline }))
  );
  const ui = useEditorState(useShallow((s) => ({
    sideTab: s.sideTab, setSideTab: s.setSideTab, bottomTab: s.bottomTab, setBottomTab: s.setBottomTab, terminals: s.terminals, activeTerm: s.activeTerm,
    addTerminal: s.addTerminal, closeTerminal: s.closeTerminal, setActiveTerm: s.setActiveTerm, setPalette: s.setPalette, problems: s.problems,
    previewPath: s.previewPath, setPreviewPath: s.setPreviewPath, setSettingsOpen: s.setSettingsOpen,
  })));
  const autoSave = useEditorSettings((s) => s.autoSave);
  const [pane, setPane] = React.useState<"agent" | "code">("agent");
  const [agentW, setAgentW] = React.useState(440);
  const [termH, setTermH] = React.useState(240);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const colRef = React.useRef<HTMLDivElement>(null);
  const changeCount = React.useMemo(() => summarizeChanges(baseline, vfs).length, [baseline, vfs]);
  const errors = ui.problems.filter((p) => p.severity === "error").length;

  React.useEffect(() => {
    void useWorkspace.getState().hydrate();
    useEditorSettings.getState().hydrate();
  }, []);

  // Auto save for real folders (virtual workspaces persist automatically).
  const dirtyKey = Object.keys(dirty).join("|");
  React.useEffect(() => {
    if (autoSave !== "afterDelay" || source.kind !== "folder" || !dirtyKey) return;
    const t = setTimeout(() => void useWorkspace.getState().saveAll(true), 1000);
    return () => clearTimeout(t);
  }, [autoSave, source.kind, dirtyKey, vfs]);

  // VS Code style shortcuts. Monaco handles its own keys first; everything else bubbles here.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const st = useWorkspace.getState();
      const eu = useEditorState.getState();
      if (k === "s" && !e.shiftKey) { e.preventDefault(); void saveActive(); }
      else if (k === "p" && !e.shiftKey) { e.preventDefault(); eu.setPalette("files"); }
      else if (k === "p" && e.shiftKey) { e.preventDefault(); eu.setPalette("commands"); }
      else if (k === "b" && !e.shiftKey) { e.preventDefault(); st.toggleExplorer(); }
      else if (e.key === "`") { e.preventDefault(); st.toggleTerminal(); }
      else if (k === "f" && e.shiftKey) { e.preventDefault(); eu.setSideTab("search"); useWorkspace.setState({ explorerOpen: true }); }
      else if (k === "m" && e.shiftKey) { e.preventDefault(); eu.setBottomTab("problems"); useWorkspace.setState({ terminalOpen: true }); }
      else if (k === "a" && e.shiftKey) { e.preventDefault(); window.dispatchEvent(new CustomEvent("nox:focus-agent")); }
    };
    const toAgent = () => setPane("agent");
    window.addEventListener("keydown", onKey);
    window.addEventListener("nox:focus-agent", toAgent);
    window.addEventListener("nox:agent-draft", toAgent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("nox:focus-agent", toAgent);
      window.removeEventListener("nox:agent-draft", toAgent);
    };
  }, []);

  const dragAgent = useDrag((x) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setAgentW(clamp(r.right - x, 340, Math.max(380, r.width - 480)));
  });
  const dragTerm = useDrag((_x, y) => {
    const r = colRef.current?.getBoundingClientRect();
    if (r) setTermH(clamp(r.bottom - y, 90, Math.max(120, r.height - 160)));
  });

  const clickSide = (t: typeof ui.sideTab) => {
    if (ui.sideTab === t && explorerOpen) toggleExplorer();
    else {
      ui.setSideTab(t);
      if (!explorerOpen) toggleExplorer();
    }
  };

  const seg = (id: "agent" | "code", label: string, icon: React.ReactNode) => (
    <button onClick={() => setPane(id)} className={cn("flex-1 flex items-center justify-center gap-1.5 h-8 text-xs", pane === id ? "bg-muted text-foreground" : "text-muted-foreground")}>{icon}{label}</button>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div ref={rootRef} className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        <div className="lg:hidden flex border-b border-border shrink-0">{seg("agent", "Agent", <MessageSquare className="h-3.5 w-3.5" />)}{seg("code", "Code", <Code2 className="h-3.5 w-3.5" />)}</div>

        {/* Workbench: activity bar | sidebar | editor + panel */}
        <section className={cn("flex-1 min-w-0 min-h-0 flex-row", pane === "agent" ? "hidden lg:flex" : "flex")}>
          <nav className="w-10 shrink-0 border-r border-border bg-card/40 hidden sm:flex flex-col" aria-label="Activity bar">
            <button className={actBtn(explorerOpen && ui.sideTab === "explorer")} onClick={() => clickSide("explorer")} title="Explorer (Ctrl+B)"><FilesIcon className="h-5 w-5" /></button>
            <button className={actBtn(explorerOpen && ui.sideTab === "search")} onClick={() => clickSide("search")} title="Search (Ctrl+Shift+F)"><Search className="h-5 w-5" /></button>
            <button className={actBtn(explorerOpen && ui.sideTab === "changes")} onClick={() => clickSide("changes")} title="Changes">
              <GitCompare className="h-5 w-5" />
              {changeCount > 0 && <span className="absolute bottom-1 right-1 min-w-4 h-4 px-1 rounded-full bg-[#7c5cff] text-[9px] text-white inline-flex items-center justify-center">{changeCount}</span>}
            </button>
            <div className="flex-1" />
            <button className={actBtn(false)} onClick={() => ui.setSettingsOpen(true)} title="Settings"><Settings className="h-5 w-5" /></button>
          </nav>
          {explorerOpen && (
            <aside className="w-60 shrink-0 border-r border-border min-h-0 hidden sm:block">
              {ui.sideTab === "explorer" ? <WorkspaceExplorer /> : ui.sideTab === "search" ? <SearchPanel /> : <ChangesPanel />}
            </aside>
          )}
          <div ref={colRef} className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0">
              <WorkspaceEditor />
            </div>
            {terminalOpen && (
              <>
                <div onPointerDown={dragTerm} className="h-1 cursor-row-resize bg-border hover:bg-foreground/30 shrink-0" role="separator" aria-orientation="horizontal" />
                <div style={{ height: termH }} className="shrink-0 min-h-0 flex flex-col">
                  <div className="flex items-center gap-1 px-2 h-7 border-b border-border bg-card/40 shrink-0 text-[11px] overflow-x-auto nox-scroll">
                    <button onClick={() => ui.setBottomTab("problems")} className={cn("h-5 px-2 rounded uppercase tracking-wider text-[10px]", ui.bottomTab === "problems" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
                      Problems{ui.problems.length > 0 && <span className={cn("ml-1 rounded-full px-1.5", errors ? "bg-red-500/30 text-red-300" : "bg-amber-500/30 text-amber-300")}>{ui.problems.length}</span>}
                    </button>
                    {ui.terminals.map((id) => (
                      <span key={id} className={cn("group inline-flex items-center h-5 rounded", ui.bottomTab === "terminal" && ui.activeTerm === id ? "bg-muted text-foreground" : "text-muted-foreground")}>
                        <button onClick={() => ui.setActiveTerm(id)} className="px-2 uppercase tracking-wider text-[10px]">Terminal {id}</button>
                        {ui.terminals.length > 1 && <button onClick={() => ui.closeTerminal(id)} className="h-4 w-4 inline-flex items-center justify-center opacity-60 hover:opacity-100" aria-label={`Close terminal ${id}`}><X className="h-3 w-3" /></button>}
                      </span>
                    ))}
                    <button onClick={ui.addTerminal} className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground" title="New terminal"><Plus className="h-3.5 w-3.5" /></button>
                    <button onClick={toggleTerminal} className="ml-auto h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground" title="Hide panel (Ctrl+`)"><PanelBottom className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="flex-1 min-h-0 relative">
                    {ui.terminals.map((id) => (
                      <div key={id} className={cn("absolute inset-0", !(ui.bottomTab === "terminal" && ui.activeTerm === id) && "invisible pointer-events-none")}>
                        <WorkspaceTerminal />
                      </div>
                    ))}
                    {ui.bottomTab === "problems" && <div className="absolute inset-0 bg-background"><ProblemsPanel /></div>}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <div onPointerDown={dragAgent} className="hidden lg:block w-1 cursor-col-resize bg-border hover:bg-foreground/30 shrink-0" role="separator" aria-orientation="vertical" />

        {/* Orchestrator agent: everything happens in the editor; this pane only drives it */}
        <aside style={{ ["--agent-w" as string]: `${agentW}px` }} className={cn("min-h-0 min-w-0 flex-col flex-1 lg:flex-none lg:shrink-0 lg:w-[var(--agent-w)]", pane === "code" ? "hidden lg:flex" : "flex")}>
          <div className="flex items-center px-3 h-8 border-b border-border shrink-0 bg-card/30">
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">ORCHESTRATOR · AGENTS WORK IN THE EDITOR</span>
          </div>
          <AgentPanel />
        </aside>
      </div>
      <StatusBar />
      <CommandPalette />
      <SettingsDialog />
      <WorkspacePreview path={ui.previewPath} onClose={() => ui.setPreviewPath(null)} />
    </div>
  );
}
