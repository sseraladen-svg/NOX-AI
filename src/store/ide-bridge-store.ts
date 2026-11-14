import { create } from "zustand";

// Lets chat messages (markdown code blocks) talk to the editor without importing it.
type Bridge = {
  active: boolean;
  /** Applies a code block; returns the path it landed in, or null if it could not. */
  apply: ((code: string, lang: string) => string | null) | null;
  register: (apply: (code: string, lang: string) => string | null) => void;
  unregister: () => void;
};

export const useIdeBridge = create<Bridge>((set) => ({
  active: false,
  apply: null,
  register: (apply) => set({ active: true, apply }),
  unregister: () => set({ active: false, apply: null }),
}));
