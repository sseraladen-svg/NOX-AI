// Module-level handle to the live Monaco editor so commands, the status bar, search results and
// the agent can drive it without prop drilling.
import type { Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useEditorState, type Problem } from "@/store/editor-state-store";
import { useWorkspace } from "@/store/workspace-store";
import { languageFor } from "./language";
import type { Issue } from "./validators";

type Ed = MonacoEditor.IStandaloneCodeEditor;
let editor: Ed | null = null;
let monaco: Monaco | null = null;

export const bridge = {
  set(e: Ed | null, m: Monaco | null) {
    editor = e;
    monaco = m;
  },
  get editor() {
    return editor;
  },
  get monaco() {
    return monaco;
  },
  focus() {
    editor?.focus();
  },
  runAction(id: string) {
    void editor?.getAction(id)?.run();
  },
  /** Opens a file and moves the cursor (used by search results and Problems). */
  reveal(path: string, line = 1, col = 1) {
    useWorkspace.getState().openFile(path);
    const go = () => {
      editor?.revealLineInCenter(line);
      editor?.setPosition({ lineNumber: line, column: col });
      editor?.focus();
    };
    setTimeout(go, 60);
    setTimeout(go, 350); // after the model switch finishes
  },
};

const LANG_OK = new Set(["typescript", "javascript", "json", "css", "html"]);
const MAX_MODELS = 300;

/** Mirrors the workspace into Monaco models so IntelliSense and diagnostics work across files. */
export function syncModels(m: Monaco, files: Record<string, string>, activePath: string | null) {
  let n = 0;
  for (const [path, content] of Object.entries(files)) {
    const lang = languageFor(path);
    if (!LANG_OK.has(lang) || content.length > 200_000 || ++n > MAX_MODELS) continue;
    const uri = m.Uri.file(path);
    const model = m.editor.getModel(uri);
    if (!model) m.editor.createModel(content, lang, uri);
    else if (path !== activePath && model.getValue() !== content) model.setValue(content);
  }
  for (const model of m.editor.getModels()) {
    if (model.uri.scheme === "file" && !(model.uri.path in files) && model.uri.path !== activePath) model.dispose();
  }
}

const IGNORED_CODES = new Set(["2307", "2792", "7016", "2580", "2591", "2688"]); // missing modules/types: noise in a sandbox

export function readProblems(m: Monaco): Problem[] {
  return m.editor
    .getModelMarkers({})
    .filter((k) => k.resource.scheme === "file")
    .map((k) => ({
      path: k.resource.path,
      line: k.startLineNumber,
      col: k.startColumn,
      severity: k.severity >= 8 ? ("error" as const) : k.severity >= 4 ? ("warning" as const) : ("info" as const),
      message: k.message,
      source: k.source,
      code: typeof k.code === "string" ? k.code : (k.code as { value?: string } | undefined)?.value,
    }))
    .filter((p) => !(p.code && IGNORED_CODES.has(p.code)))
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

export function watchMarkers(m: Monaco): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = m.editor.onDidChangeMarkers(() => {
    clearTimeout(t);
    t = setTimeout(() => useEditorState.getState().setProblems(readProblems(m)), 200);
  });
  return () => {
    clearTimeout(t);
    d.dispose();
  };
}

/** Editor diagnostics (errors only) for the agent's verify step. Empty if the editor is not ready. */
export async function collectDiagnostics(paths: string[]): Promise<Issue[]> {
  if (!monaco) return [];
  const m = monaco;
  syncModels(m, useWorkspace.getState().vfs.files, useWorkspace.getState().active);
  await new Promise<void>((resolve) => {
    let settled = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(settleTimer);
      clearTimeout(maxTimer);
      sub.dispose();
      resolve();
    };
    const sub = m.editor.onDidChangeMarkers(() => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(done, 250);
    });
    const maxTimer = setTimeout(done, 1200);
    settleTimer = setTimeout(done, 350);
  });
  const set = new Set(paths);
  return readProblems(monaco)
    .filter((p) => set.has(p.path) && p.severity === "error")
    .slice(0, 12)
    .map((p) => ({ path: p.path, line: p.line, severity: "error" as const, message: p.message }));
}
