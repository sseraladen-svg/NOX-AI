"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import type { BeforeMount, OnMount } from "@monaco-editor/react";
import { Bug, Command as CommandIcon, Globe, Play, Save, Sparkles, WandSparkles, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace-store";
import { useEditorSettings } from "@/store/editor-settings-store";
import { useEditorState } from "@/store/editor-state-store";
import { baseName } from "@/lib/workspace/vfs";
import { languageFor } from "@/lib/workspace/language";
import { defineThemes } from "@/lib/workspace/themes";
import { bridge, syncModels, watchMarkers } from "@/lib/workspace/editor-bridge";
import { requestCompletion } from "@/lib/workspace/inline-ai";
import { runWorkspaceFile } from "./run-actions";
import { saveActive } from "./commands";
import { FileIcon } from "./file-icon";
import { InlineEditBar } from "./inline-edit-bar";

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Loading editor…</div>,
});

const tbtn = "inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition disabled:opacity-40 shrink-0";

type MenuState = { x: number; y: number; path: string } | null;

const SHORTCUTS: [string, string][] = [
  ["Go to file", "Ctrl+P"], ["Command palette", "Ctrl+Shift+P"], ["Edit selection with AI", "Ctrl+K"], ["Find in files", "Ctrl+Shift+F"],
  ["Toggle terminal", "Ctrl+`"], ["Toggle sidebar", "Ctrl+B"], ["Ask the agent", "Ctrl+Shift+A"], ["Format document", "Shift+Alt+F"],
];

const beforeMount: BeforeMount = (monaco) => {
  defineThemes(monaco);
  const ts = monaco.languages.typescript;
  const opts = { target: ts.ScriptTarget.ES2020, allowNonTsExtensions: true, moduleResolution: ts.ModuleResolutionKind.NodeJs, module: ts.ModuleKind.ESNext, allowJs: true, jsx: ts.JsxEmit.Preserve, esModuleInterop: true };
  ts.javascriptDefaults.setCompilerOptions(opts);
  ts.typescriptDefaults.setCompilerOptions(opts);
};

export function WorkspaceEditor() {
  const { vfs, tabs, active, dirty, setActive, closeTab, closeOthers, closeAll, reorderTabs, setContent, saveFile, setSelection, openFile } = useWorkspace(
    useShallow((s) => ({
      vfs: s.vfs, tabs: s.tabs, active: s.active, dirty: s.dirty, setActive: s.setActive, closeTab: s.closeTab, closeOthers: s.closeOthers,
      closeAll: s.closeAll, reorderTabs: s.reorderTabs, setContent: s.setContent, saveFile: s.saveFile, setSelection: s.setSelection, openFile: s.openFile,
    }))
  );
  const settings = useEditorSettings(useShallow((s) => ({
    theme: s.theme, fontSize: s.fontSize, tabSize: s.tabSize, wordWrap: s.wordWrap, minimap: s.minimap, lineNumbers: s.lineNumbers, bracketColors: s.bracketColors, stickyScroll: s.stickyScroll,
  })));
  const { setCursor, setPalette, setInlineEditOpen, setPreviewPath } = useEditorState(useShallow((s) => ({ setCursor: s.setCursor, setPalette: s.setPalette, setInlineEditOpen: s.setInlineEditOpen, setPreviewPath: s.setPreviewPath })));
  const activeRef = React.useRef(active);
  React.useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const [menu, setMenu] = React.useState<MenuState>(null);
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const disposers = React.useRef<(() => void)[]>([]);
  const content = active ? vfs.files[active] : undefined;
  const isJs = !!active && /\.(m?js|cjs)$/i.test(active);
  const isHtml = !!active && /\.html?$/i.test(active);

  // Keep Monaco's models in step with the workspace so IntelliSense and diagnostics see every file.
  React.useEffect(() => {
    const t = setTimeout(() => bridge.monaco && syncModels(bridge.monaco, vfs.files, active), 300);
    return () => clearTimeout(t);
  }, [vfs.files, active]);

  React.useEffect(() => {
    const off = () => setMenu(null);
    window.addEventListener("click", off);
    return () => window.removeEventListener("click", off);
  }, []);

  React.useEffect(
    () => () => {
      disposers.current.forEach((d) => d());
      disposers.current = [];
      bridge.set(null, null);
    },
    []
  );

  const close = (p: string) => {
    if (dirty[p] && !window.confirm(`${baseName(p)} has unsaved changes. Close anyway?`)) return;
    closeTab(p);
  };

  const askAgent = (verb: string) => {
    if (!active) return;
    const text = `${verb} ${useWorkspace.getState().selection ? "the selected code" : "this file"} (${active}).`;
    window.dispatchEvent(new CustomEvent("nox:agent-draft", { detail: text }));
  };

  const onMount: OnMount = (editor, monaco) => {
    bridge.set(editor, monaco);
    disposers.current.push(watchMarkers(monaco));
    syncModels(monaco, useWorkspace.getState().vfs.files, useWorkspace.getState().active);
    // Ctrl+K is a chord prefix in Monaco; take it over for Cursor-style "edit with AI".
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => setInlineEditOpen(true));
    const cursorSub = editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      const model = editor.getModel();
      setSelection(sel && model && !sel.isEmpty() ? model.getValueInRange(sel) : "");
      const pos = editor.getPosition();
      setCursor({ line: pos?.lineNumber ?? 1, col: pos?.column ?? 1, selected: sel && model && !sel.isEmpty() ? model.getValueInRange(sel).length : 0 });
    });
    disposers.current.push(() => cursorSub.dispose());
    // Ghost-text completions (opt-in in Settings): registered once per Monaco instance.
    const m = monaco as unknown as { __noxInline?: boolean };
    if (!m.__noxInline) {
      m.__noxInline = true;
      monaco.languages.registerInlineCompletionsProvider({ pattern: "**" }, {
        provideInlineCompletions: async (model, position, _ctx, token) => {
          if (!useEditorSettings.getState().inlineAI) return { items: [] };
          await new Promise((r) => setTimeout(r, 650));
          if (token.isCancellationRequested) return { items: [] };
          const before = model.getValueInRange({ startLineNumber: Math.max(1, position.lineNumber - 40), startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
          if (before.trim().length < 3) return { items: [] };
          const after = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 15), endColumn: 1000 });
          const ctl = new AbortController();
          token.onCancellationRequested(() => ctl.abort());
          try {
            const text = await requestCompletion(before, after, model.getLanguageId(), ctl.signal);
            if (!text || token.isCancellationRequested) return { items: [] };
            return { items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
          } catch {
            return { items: [] };
          }
        },
        freeInlineCompletions: () => {},
      });
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0 min-w-0 relative">
      <div className="flex items-stretch border-b border-border bg-card/40 shrink-0 overflow-x-auto nox-scroll">
        {tabs.map((p, i) => (
          <div
            key={p}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragFrom !== null) reorderTabs(dragFrom, i); setDragFrom(null); }}
            onClick={() => setActive(p)}
            onAuxClick={() => close(p)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, path: p }); }}
            className={cn("group flex items-center gap-1.5 pl-3 pr-1.5 h-8 text-xs cursor-pointer border-r border-border shrink-0", p === active ? "bg-background text-foreground border-t-2 border-t-[#7c5cff]" : "text-muted-foreground hover:bg-muted/40", dragFrom === i && "opacity-50")}
            title={p}
          >
            <FileIcon path={p} />
            <span className="max-w-[140px] truncate">{baseName(p)}</span>
            {dirty[p] ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}
            <button className="h-4 w-4 inline-flex items-center justify-center rounded hover:bg-muted/70 opacity-60 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); close(p); }} aria-label={`Close ${baseName(p)}`}>
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {menu && (
        <div className="fixed z-50 min-w-40 rounded-md border border-border bg-popover shadow-lg py-1 text-xs" style={{ left: menu.x, top: menu.y }}>
          {[
            ["Close", () => close(menu.path)],
            ["Close Others", () => closeOthers(menu.path)],
            ["Close All", () => closeAll()],
            ["Copy Path", () => void navigator.clipboard?.writeText(menu.path)],
          ].map(([label, fn]) => (
            <button key={label as string} className="w-full text-left px-3 py-1.5 hover:bg-muted" onClick={(fn as () => void)}>{label as string}</button>
          ))}
        </div>
      )}

      {active && content !== undefined ? (
        <>
          <div className="flex items-center gap-0.5 px-2 h-7 border-b border-border shrink-0 overflow-x-auto nox-scroll">
            <span className="text-[11px] text-muted-foreground font-mono truncate mr-2">{active.split("/").filter(Boolean).join(" › ")}</span>
            <button className={tbtn} onClick={() => void saveFile(active)} title="Save (Ctrl+S)"><Save className="h-3 w-3" />Save</button>
            {isJs && <button className={tbtn} onClick={() => runWorkspaceFile(active)} title="Run in sandbox"><Play className="h-3 w-3 text-emerald-400" />Run</button>}
            {isHtml && <button className={tbtn} onClick={() => setPreviewPath(active)} title="Preview in sandbox"><Globe className="h-3 w-3 text-sky-400" />Preview</button>}
            <button className={tbtn} onClick={() => bridge.runAction("editor.action.formatDocument")} title="Format document (Shift+Alt+F)"><WandSparkles className="h-3 w-3" />Format</button>
            <span className="mx-1 h-3 w-px bg-border" />
            <button className={tbtn} onClick={() => setInlineEditOpen(true)} title="Edit with AI (Ctrl+K)"><Sparkles className="h-3 w-3 text-fuchsia-400" />Ctrl+K</button>
            <button className={tbtn} onClick={() => askAgent("Explain")} title="Ask the agent to explain"><Sparkles className="h-3 w-3" />Explain</button>
            <button className={tbtn} onClick={() => askAgent("Find and fix bugs in")} title="Ask the agent to fix bugs"><Bug className="h-3 w-3" />Fix</button>
            <button className={tbtn} onClick={() => askAgent("Refactor and simplify")} title="Ask the agent to refactor"><Wand2 className="h-3 w-3" />Refactor</button>
            <button className={cn(tbtn, "ml-auto")} onClick={() => setPalette("commands")} title="Command palette (Ctrl+Shift+P)"><CommandIcon className="h-3 w-3" /></button>
          </div>
          <div className="flex-1 min-h-0 relative">
            <InlineEditBar />
            <Monaco
              path={active}
              language={languageFor(active)}
              value={content}
              theme={settings.theme}
              beforeMount={beforeMount}
              onChange={(v) => activeRef.current && setContent(activeRef.current, v ?? "")}
              onMount={onMount}
              options={{
                fontSize: settings.fontSize, tabSize: settings.tabSize, wordWrap: settings.wordWrap ? "on" : "off", minimap: { enabled: settings.minimap },
                lineNumbers: settings.lineNumbers, bracketPairColorization: { enabled: settings.bracketColors }, stickyScroll: { enabled: settings.stickyScroll },
                automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 8 }, smoothScrolling: true, cursorSmoothCaretAnimation: "on",
                renderWhitespace: "selection", guides: { bracketPairs: true, indentation: true }, formatOnPaste: true, inlineSuggest: { enabled: true },
                linkedEditing: true, mouseWheelZoom: true, fontLigatures: true, folding: true, suggestOnTriggerCharacters: true, quickSuggestions: true,
              }}
            />
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-6 text-muted-foreground overflow-auto">
          <FileIcon path="x.ts" className="h-10 w-10 opacity-40" />
          <div>
            <p className="text-sm text-foreground">NOX Workspace</p>
            <p className="text-xs mt-1">Open a file, or ask the agent to build something.</p>
          </div>
          <div className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1.5 text-xs text-left">
            {SHORTCUTS.map(([a, k]) => (<React.Fragment key={a}><span>{a}</span><kbd className="font-mono text-[11px] rounded bg-muted px-1.5 py-0.5 text-foreground">{k}</kbd></React.Fragment>))}
          </div>
          <button className="text-xs underline" onClick={() => openFile("/README.md")}>Open README.md</button>
        </div>
      )}
    </div>
  );
}

export { saveActive };
