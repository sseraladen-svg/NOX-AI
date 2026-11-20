import type { Monaco } from "@monaco-editor/react";
import type { ThemeId } from "@/store/editor-settings-store";

export const THEMES: { id: ThemeId; label: string; dark: boolean }[] = [
  { id: "nox-dark", label: "NOX Dark", dark: true },
  { id: "vs-dark", label: "Dark+ (VS Code)", dark: true },
  { id: "vs", label: "Light+ (VS Code)", dark: false },
  { id: "hc-black", label: "High Contrast", dark: true },
  { id: "dracula", label: "Dracula", dark: true },
  { id: "monokai", label: "Monokai", dark: true },
  { id: "github-dark", label: "GitHub Dark", dark: true },
  { id: "solarized-dark", label: "Solarized Dark", dark: true },
];

type P = { bg: string; line: string; cursor: string; comment: string; keyword: string; string: string; number: string; type: string; sel: string };
const PALETTES: Record<string, P> = {
  "nox-dark": { bg: "#0b0912", line: "#15121f", cursor: "#c792ea", comment: "6a737d", keyword: "c792ea", string: "c3e88d", number: "f78c6c", type: "ffcb6b", sel: "#3b2f5c" },
  dracula: { bg: "#282a36", line: "#2f3142", cursor: "#f8f8f2", comment: "6272a4", keyword: "ff79c6", string: "f1fa8c", number: "bd93f9", type: "8be9fd", sel: "#44475a" },
  monokai: { bg: "#272822", line: "#3e3d32", cursor: "#f8f8f0", comment: "75715e", keyword: "f92672", string: "e6db74", number: "ae81ff", type: "66d9ef", sel: "#49483e" },
  "github-dark": { bg: "#0d1117", line: "#161b22", cursor: "#58a6ff", comment: "8b949e", keyword: "ff7b72", string: "a5d6ff", number: "79c0ff", type: "ffa657", sel: "#264f78" },
  "solarized-dark": { bg: "#002b36", line: "#073642", cursor: "#93a1a1", comment: "586e75", keyword: "859900", string: "2aa198", number: "d33682", type: "b58900", sel: "#073642" },
};

export function defineThemes(monaco: Monaco) {
  for (const [id, p] of Object.entries(PALETTES)) {
    monaco.editor.defineTheme(id, {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: p.comment, fontStyle: "italic" },
        { token: "keyword", foreground: p.keyword },
        { token: "string", foreground: p.string },
        { token: "number", foreground: p.number },
        { token: "type", foreground: p.type },
        { token: "tag", foreground: p.keyword },
        { token: "attribute.name", foreground: p.type },
        { token: "attribute.value", foreground: p.string },
      ],
      colors: {
        "editor.background": p.bg,
        "editor.lineHighlightBackground": p.line,
        "editorCursor.foreground": p.cursor,
        "editor.selectionBackground": p.sel,
        "editorGutter.background": p.bg,
        "minimap.background": p.bg,
      },
    });
  }
}
