import { create } from "zustand";

export type ThemeId = "nox-dark" | "vs-dark" | "vs" | "hc-black" | "dracula" | "monokai" | "github-dark" | "solarized-dark";

export interface EditorSettings {
  theme: ThemeId;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: "on" | "off" | "relative";
  bracketColors: boolean;
  stickyScroll: boolean;
  formatOnSave: boolean;
  autoSave: "off" | "afterDelay";
  inlineAI: boolean; // ghost-text completions from your Coding model (uses tokens on every pause)
}

const DEFAULTS: EditorSettings = {
  theme: "nox-dark", fontSize: 13, tabSize: 2, wordWrap: true, minimap: true, lineNumbers: "on",
  bracketColors: true, stickyScroll: true, formatOnSave: false, autoSave: "afterDelay", inlineAI: false,
};

const KEY = "nox-editor-settings";

interface Store extends EditorSettings {
  hydrate: () => void;
  set: (p: Partial<EditorSettings>) => void;
  reset: () => void;
}

const persist = (s: EditorSettings) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
};

const pick = (s: EditorSettings): EditorSettings => ({
  theme: s.theme, fontSize: s.fontSize, tabSize: s.tabSize, wordWrap: s.wordWrap, minimap: s.minimap, lineNumbers: s.lineNumbers,
  bracketColors: s.bracketColors, stickyScroll: s.stickyScroll, formatOnSave: s.formatOnSave, autoSave: s.autoSave, inlineAI: s.inlineAI,
});

export const useEditorSettings = create<Store>((set, get) => ({
  ...DEFAULTS,
  hydrate: () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) set({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<EditorSettings>) });
    } catch {
      /* ignore corrupt settings */
    }
  },
  set: (p) => {
    set(p);
    persist(pick({ ...get(), ...p }));
  },
  reset: () => {
    set(DEFAULTS);
    persist(DEFAULTS);
  },
}));
