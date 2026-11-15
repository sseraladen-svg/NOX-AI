import { isSensitivePath } from "./agent-protocol.ts";

// Bridges the open workspace to the chat: the IDE registers a provider, the chat hook appends
// the snapshot to the latest user message (API payload only, never shown or stored).

export type EditorSnapshot = {
  paths: string[];
  openTabs: string[];
  active?: { path: string; content: string; selection?: string };
};

let provider: (() => EditorSnapshot | null) | null = null;
export const setEditorContextProvider = (fn: (() => EditorSnapshot | null) | null) => {
  provider = fn;
};

const MAX_FILE_CHARS = 16_000;
const MAX_SELECTION_CHARS = 6_000;
const MAX_PATHS = 150;

export function formatEditorContext(s: EditorSnapshot): string {
  const lines: string[] = [
    "[Workspace context from the user's code editor. Use these exact paths.",
    "To create or change a file, reply with the FULL new content in a fenced code block whose first line is a comment `file: <path>` (for example `// file: /src/app.ts`); the user applies it with one click.]",
    `Files (${s.paths.length}):`,
    ...s.paths.filter((p) => !isSensitivePath(p)).slice(0, MAX_PATHS).map((p) => `- ${p}`),
  ];
  if (s.paths.length > MAX_PATHS) lines.push(`- … ${s.paths.length - MAX_PATHS} more`);
  if (s.openTabs.length) lines.push(`Open tabs: ${s.openTabs.join(", ")}`);
  if (s.active && isSensitivePath(s.active.path)) {
    lines.push(`Active file: ${s.active.path} (contents hidden: protected file)`);
  } else if (s.active) {
    const c = s.active.content;
    lines.push(`Active file: ${s.active.path}`, "```", c.length > MAX_FILE_CHARS ? c.slice(0, MAX_FILE_CHARS) + "\n… (truncated)" : c, "```");
    if (s.active.selection) {
      const sel = s.active.selection;
      lines.push("Selected text:", "```", sel.length > MAX_SELECTION_CHARS ? sel.slice(0, MAX_SELECTION_CHARS) + "\n… (truncated)" : sel, "```");
    }
  }
  return lines.join("\n");
}

/** Appends the workspace snapshot to the last user message. No-op when no editor is open. */
export function injectEditorContext<T extends { role: string; content: string }>(messages: T[]): T[] {
  const snap = provider?.();
  if (!snap) return messages;
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") { idx = i; break; }
  if (idx === -1) return messages;
  const out = messages.slice();
  out[idx] = { ...out[idx], content: `${out[idx].content}\n\n${formatEditorContext(snap)}` };
  return out;
}
