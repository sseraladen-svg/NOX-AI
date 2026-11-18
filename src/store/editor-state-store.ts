import { create } from "zustand";

export type Problem = { path: string; line: number; col: number; severity: "error" | "warning" | "info"; message: string; source?: string; code?: string };
export type SideTab = "explorer" | "search" | "changes";
export type BottomTab = "terminal" | "problems";
export type PaletteMode = "files" | "commands" | "goto" | "theme" | null;

interface EditorState {
  cursor: { line: number; col: number; selected: number };
  problems: Problem[];
  sideTab: SideTab;
  bottomTab: BottomTab;
  palette: PaletteMode;
  settingsOpen: boolean;
  inlineEditOpen: boolean;
  previewPath: string | null;
  terminals: number[];
  activeTerm: number;
  addTerminal: () => void;
  closeTerminal: (id: number) => void;
  setActiveTerm: (id: number) => void;
  setCursor: (c: EditorState["cursor"]) => void;
  setProblems: (p: Problem[]) => void;
  setSideTab: (t: SideTab) => void;
  setBottomTab: (t: BottomTab) => void;
  setPalette: (m: PaletteMode) => void;
  setSettingsOpen: (o: boolean) => void;
  setInlineEditOpen: (o: boolean) => void;
  setPreviewPath: (p: string | null) => void;
}

export const useEditorState = create<EditorState>((set) => ({
  cursor: { line: 1, col: 1, selected: 0 },
  problems: [],
  sideTab: "explorer",
  bottomTab: "terminal",
  palette: null,
  settingsOpen: false,
  inlineEditOpen: false,
  previewPath: null,
  terminals: [1],
  activeTerm: 1,
  addTerminal: () => set((st) => { const id = Math.max(0, ...st.terminals) + 1; return st.terminals.length >= 5 ? st : { terminals: [...st.terminals, id], activeTerm: id, bottomTab: "terminal" }; }),
  closeTerminal: (id) => set((st) => { if (st.terminals.length <= 1) return st; const terminals = st.terminals.filter((t) => t !== id); return { terminals, activeTerm: st.activeTerm === id ? terminals[terminals.length - 1] : st.activeTerm }; }),
  setActiveTerm: (activeTerm) => set({ activeTerm, bottomTab: "terminal" }),
  setCursor: (cursor) => set({ cursor }),
  setProblems: (problems) => set({ problems }),
  setSideTab: (sideTab) => set({ sideTab }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setPalette: (palette) => set({ palette }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setInlineEditOpen: (inlineEditOpen) => set({ inlineEditOpen }),
  setPreviewPath: (previewPath) => set({ previewPath }),
}));
