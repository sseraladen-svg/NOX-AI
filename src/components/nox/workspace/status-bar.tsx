"use client";

import * as React from "react";
import { useShallow } from "zustand/react/shallow";
import { AlertTriangle, GitCompare, Loader2, Settings, XCircle } from "lucide-react";
import { useWorkspace } from "@/store/workspace-store";
import { useEditorState } from "@/store/editor-state-store";
import { useEditorSettings } from "@/store/editor-settings-store";
import { useAgent } from "@/store/agent-store";
import { summarizeChanges } from "@/lib/workspace/agent-exec";
import { languageFor } from "@/lib/workspace/language";

const item = "h-full px-2 inline-flex items-center gap-1 hover:bg-white/10 transition";

export function StatusBar() {
  const { active, source, vfs, baseline } = useWorkspace(useShallow((s) => ({ active: s.active, source: s.source, vfs: s.vfs, baseline: s.baseline })));
  const { cursor, problems, setSideTab, setBottomTab, setSettingsOpen, setPalette } = useEditorState(useShallow((s) => ({ cursor: s.cursor, problems: s.problems, setSideTab: s.setSideTab, setBottomTab: s.setBottomTab, setSettingsOpen: s.setSettingsOpen, setPalette: s.setPalette })));
  const tabSize = useEditorSettings((s) => s.tabSize);
  const running = useAgent((s) => s.running);
  const changes = React.useMemo(() => summarizeChanges(baseline, vfs).length, [baseline, vfs]);
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  const lang = active ? languageFor(active) : "";
  return (
    <div className="h-6 shrink-0 flex items-center justify-between text-[11px] bg-[#5b3fd1] text-white select-none overflow-hidden">
      <div className="flex items-center h-full min-w-0">
        <button className={item} onClick={() => setSideTab("explorer")} title="Workspace">{source.kind === "folder" ? `📁 ${source.name}${source.connected ? "" : " (disconnected)"}` : "Virtual workspace"}</button>
        <button className={item} onClick={() => setSideTab("changes")} title="Changes since baseline"><GitCompare className="h-3 w-3" />{changes}</button>
        <button className={item} onClick={() => setBottomTab("problems")} title="Problems"><XCircle className="h-3 w-3" />{errors}<AlertTriangle className="h-3 w-3 ml-1" />{warnings}</button>
        {running && <span className={item}><Loader2 className="h-3 w-3 animate-spin" />Agent working…</span>}
      </div>
      <div className="flex items-center h-full">
        {active && <button className={item} onClick={() => setPalette("goto")} title="Go to line (Ctrl+G)">Ln {cursor.line}, Col {cursor.col}{cursor.selected > 0 ? ` (${cursor.selected} selected)` : ""}</button>}
        {active && <span className={item}>Spaces: {tabSize}</span>}
        {active && <span className={item}>{lang}</span>}
        <span className={item}>UTF-8</span>
        <span className={item}>LF</span>
        <button className={item} onClick={() => setSettingsOpen(true)} title="Editor settings"><Settings className="h-3 w-3" /></button>
      </div>
    </div>
  );
}
