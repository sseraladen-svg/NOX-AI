import { toast } from "sonner";
import { useWorkspace } from "@/store/workspace-store";
import { useEditorState } from "@/store/editor-state-store";
import { useEditorSettings } from "@/store/editor-settings-store";
import { useAgent } from "@/store/agent-store";
import { bridge } from "@/lib/workspace/editor-bridge";
import { runWorkspaceFile } from "./run-actions";

export type Command = { id: string; title: string; group: string; shortcut?: string; run: () => void };

const ws = () => useWorkspace.getState();
const ui = () => useEditorState.getState();
const cfg = () => useEditorSettings.getState();
const action = (id: string) => () => bridge.runAction(id);

export async function saveActive(): Promise<void> {
  const { active, saveFile } = ws();
  if (!active) return;
  if (cfg().formatOnSave) {
    try {
      await bridge.editor?.getAction("editor.action.formatDocument")?.run();
    } catch {
      /* no formatter for this language */
    }
  }
  await saveFile(active);
}

export function focusAgent() {
  window.dispatchEvent(new CustomEvent("nox:focus-agent"));
}

export function buildCommands(): Command[] {
  const isJs = () => !!ws().active && /\.(m?js|cjs)$/i.test(ws().active!);
  const isHtml = () => !!ws().active && /\.html?$/i.test(ws().active!);
  return [
    { id: "file.new", group: "File", title: "New File…", run: () => { const n = window.prompt("New file path (e.g. src/app.ts)"); if (n) ws().createFile(n); } },
    { id: "file.newFolder", group: "File", title: "New Folder…", run: () => { const n = window.prompt("New folder path"); if (n) ws().createDir(n); } },
    { id: "file.openFolder", group: "File", title: "Open Folder from Computer…", run: () => void ws().openFolder() },
    { id: "file.save", group: "File", title: "Save", shortcut: "Ctrl+S", run: () => void saveActive() },
    { id: "file.saveAll", group: "File", title: "Save All", run: () => void ws().saveAll() },
    { id: "file.close", group: "File", title: "Close Editor", run: () => ws().active && ws().closeTab(ws().active!) },
    { id: "file.closeAll", group: "File", title: "Close All Editors", run: () => ws().closeAll() },
    { id: "view.quickOpen", group: "Go", title: "Go to File…", shortcut: "Ctrl+P", run: () => ui().setPalette("files") },
    { id: "view.goto", group: "Go", title: "Go to Line…", shortcut: "Ctrl+G", run: () => ui().setPalette("goto") },
    { id: "view.symbol", group: "Go", title: "Go to Symbol in File…", shortcut: "Ctrl+Shift+O", run: action("editor.action.quickOutline") },
    { id: "view.explorer", group: "View", title: "Toggle Explorer", shortcut: "Ctrl+B", run: () => ws().toggleExplorer() },
    { id: "view.terminal", group: "View", title: "Toggle Terminal", shortcut: "Ctrl+`", run: () => ws().toggleTerminal() },
    { id: "view.newTerminal", group: "View", title: "New Terminal", run: () => { ui().addTerminal(); useWorkspace.setState({ terminalOpen: true }); } },
    { id: "view.problems", group: "View", title: "Show Problems", shortcut: "Ctrl+Shift+M", run: () => { ui().setBottomTab("problems"); useWorkspace.setState({ terminalOpen: true }); } },
    { id: "view.search", group: "View", title: "Find in Files", shortcut: "Ctrl+Shift+F", run: () => { ui().setSideTab("search"); useWorkspace.setState({ explorerOpen: true }); } },
    { id: "view.changes", group: "View", title: "Show Changes", run: () => { ui().setSideTab("changes"); useWorkspace.setState({ explorerOpen: true }); } },
    { id: "view.agent", group: "View", title: "Focus Agent", shortcut: "Ctrl+Shift+A", run: focusAgent },
    { id: "edit.find", group: "Edit", title: "Find", shortcut: "Ctrl+F", run: action("actions.find") },
    { id: "edit.replace", group: "Edit", title: "Replace", shortcut: "Ctrl+H", run: action("editor.action.startFindReplace") },
    { id: "edit.comment", group: "Edit", title: "Toggle Line Comment", shortcut: "Ctrl+/", run: action("editor.action.commentLine") },
    { id: "edit.format", group: "Edit", title: "Format Document", shortcut: "Shift+Alt+F", run: action("editor.action.formatDocument") },
    { id: "edit.occurrences", group: "Edit", title: "Select All Occurrences", shortcut: "Ctrl+Shift+L", run: action("editor.action.selectHighlights") },
    { id: "edit.foldAll", group: "Edit", title: "Fold All", run: action("editor.foldAll") },
    { id: "edit.unfoldAll", group: "Edit", title: "Unfold All", run: action("editor.unfoldAll") },
    { id: "edit.ai", group: "AI", title: "Edit Selection with AI…", shortcut: "Ctrl+K", run: () => ui().setInlineEditOpen(true) },
    { id: "ai.inline", group: "AI", title: "Toggle AI Inline Completions", run: () => { cfg().set({ inlineAI: !cfg().inlineAI }); toast.info(`AI inline completions ${cfg().inlineAI ? "on" : "off"}`); } },
    { id: "prefs.theme", group: "Preferences", title: "Color Theme…", run: () => ui().setPalette("theme") },
    { id: "prefs.settings", group: "Preferences", title: "Editor Settings", run: () => ui().setSettingsOpen(true) },
    { id: "prefs.wrap", group: "Preferences", title: "Toggle Word Wrap", run: () => cfg().set({ wordWrap: !cfg().wordWrap }) },
    { id: "prefs.minimap", group: "Preferences", title: "Toggle Minimap", run: () => cfg().set({ minimap: !cfg().minimap }) },
    { id: "prefs.zoomIn", group: "Preferences", title: "Zoom In (Font Size +)", run: () => cfg().set({ fontSize: Math.min(28, cfg().fontSize + 1) }) },
    { id: "prefs.zoomOut", group: "Preferences", title: "Zoom Out (Font Size −)", run: () => cfg().set({ fontSize: Math.max(9, cfg().fontSize - 1) }) },
    { id: "prefs.zoomReset", group: "Preferences", title: "Reset Zoom", run: () => cfg().set({ fontSize: 13 }) },
    ...(isJs() ? [{ id: "run.file", group: "Run", title: "Run JavaScript File", run: () => { if (ws().active) runWorkspaceFile(ws().active!); } }] : []),
    ...(isHtml() ? [{ id: "run.preview", group: "Run", title: "Preview HTML in Browser Sandbox", run: () => ui().setPreviewPath(ws().active) }] : []),
    { id: "agent.undo", group: "Agent", title: "Undo Last Agent Changes", run: () => useAgent.getState().undo() },
    { id: "agent.clear", group: "Agent", title: "Clear Agent Conversation", run: () => useAgent.getState().clear() },
    { id: "ws.reset", group: "Workspace", title: "Reset Workspace", run: () => { if (window.confirm("Reset the workspace to the starter files?")) ws().resetWorkspace(); } },
  ];
}
