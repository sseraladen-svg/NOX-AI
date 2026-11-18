// Cursor-style AI helpers: ghost-text completions and Ctrl+K inline edits, using the Coding model.
import { callAgentModel } from "./agent-model";

const stripFences = (s: string) => s.replace(/^```[\w+-]*\n?/, "").replace(/\n?```\s*$/, "");

const COMPLETE_SYSTEM = `You are a code completion engine. You get code with the marker <CURSOR>. Output ONLY the text to insert at <CURSOR>: no explanations, no markdown fences, no repeating existing code. Keep it short (at most 5 lines) and match the file's style. If nothing sensible fits, output nothing.`;

export async function requestCompletion(before: string, after: string, lang: string, signal: AbortSignal): Promise<string> {
  const out = await callAgentModel("coding", COMPLETE_SYSTEM, [{ role: "user", content: `Language: ${lang}\n${before.slice(-1800)}<CURSOR>${after.slice(0, 500)}` }], undefined, signal, { budget: { ctx: 4096, maxOut: 96 } });
  return stripFences(out).split("\n").slice(0, 6).join("\n").replace(/\s+$/, "");
}

const EDIT_SYSTEM = `You edit code. You get an instruction and the exact code to change. Output ONLY the full replacement for that code: no explanations, no markdown fences. Keep the same indentation and style, and change only what the instruction needs.`;

export async function requestEdit(instruction: string, code: string, lang: string, signal: AbortSignal): Promise<string> {
  const out = await callAgentModel("coding", EDIT_SYSTEM, [{ role: "user", content: `Language: ${lang}\nInstruction: ${instruction}\n\nCode:\n${code}` }], undefined, signal, { budget: { ctx: 8192, maxOut: 2048 } });
  return stripFences(out.replace(/^\n+/, "")).replace(/\s+$/, "");
}
