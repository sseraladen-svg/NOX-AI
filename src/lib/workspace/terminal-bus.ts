// Tiny pub/sub so editor actions (Run, errors) can print into the terminal without prop drilling.
type Line = { text: string; kind: "out" | "err" | "info" };
const subs = new Set<(l: Line) => void>();
export const terminalBus = {
  emit: (text: string, kind: Line["kind"] = "out") => subs.forEach((s) => s({ text, kind })),
  subscribe: (fn: (l: Line) => void) => {
    subs.add(fn);
    return () => { subs.delete(fn); };
  },
};
