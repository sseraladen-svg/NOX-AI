// Zero-token quality checks run on files the agent created or changed. Problems are sent back to
// the agent (Test/Verify → fix → pass). Pure; the editor adds its own diagnostics on top.
import { type VfsState, isFile, normalizePath, parentOf } from "./vfs.ts";

export type Issue = { path: string; line?: number; message: string; severity: "error" | "warning" };

const PLACEHOLDER = /(\.\.\.\s*(rest of|remaining|existing|other)\b|\brest of (the )?(file|code|function)\b|\/\/\s*\.\.\.\s*$|your code here|TODO:?\s*implement|implement (this|me)\s*$|<!--\s*\.\.\.\s*-->)/im;
const MAX_CHECK_BYTES = 400 * 1024;

const exists = (vfs: VfsState, from: string, ref: string, exts: string[] = []): boolean => {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(ref)) return true; // external or anchor
  try {
    const base = normalizePath(ref.split(/[?#]/)[0], parentOf(from));
    return [base, ...exts.map((e) => base + e), ...exts.map((e) => base + "/index" + e)].some((p) => isFile(vfs, p));
  } catch {
    return false;
  }
};

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

export function validateFiles(vfs: VfsState, paths: string[]): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, severity: Issue["severity"], message: string, line?: number) => issues.push({ path, severity, message, line });
  for (const path of paths) {
    const code = vfs.files[path];
    if (code === undefined || code.length > MAX_CHECK_BYTES) continue;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (code.trim() === "" && !/\.(gitkeep|txt|md)$/i.test(path)) add(path, "warning", "File is empty.");
    const ph = PLACEHOLDER.exec(code);
    if (ph && ext !== "md") add(path, "error", `Contains a placeholder ("${ph[0].trim().slice(0, 40)}"). Write the complete file.`, lineOf(code, ph.index));

    if (ext === "json") {
      try {
        JSON.parse(code);
      } catch (e) {
        add(path, "error", `Invalid JSON: ${(e as Error).message}`);
      }
    } else if (ext === "html" || ext === "htm") {
      if (!/<!doctype html/i.test(code)) add(path, "warning", "Missing <!doctype html>.");
      if (!/<title>[^<]+<\/title>/i.test(code)) add(path, "warning", "Missing <title>.");
      if (!/<meta[^>]+viewport/i.test(code)) add(path, "warning", 'Missing <meta name="viewport"> (not mobile friendly).');
      for (const m of code.matchAll(/<(?:script|img|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']|<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
        const ref = m[1] ?? m[2];
        if (ref && !exists(vfs, path, ref)) add(path, "error", `References "${ref}" but that file does not exist.`, lineOf(code, m.index ?? 0));
      }
    } else if (ext === "css") {
      const open = (code.replace(/\/\*[\s\S]*?\*\//g, "").match(/{/g) ?? []).length;
      const close = (code.replace(/\/\*[\s\S]*?\*\//g, "").match(/}/g) ?? []).length;
      if (open !== close) add(path, "error", `Unbalanced braces in CSS (${open} "{" vs ${close} "}").`);
    } else if (["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(ext)) {
      const isModule = /^\s*(import|export)\s/m.test(code);
      if (!isModule && ["js", "cjs"].includes(ext)) {
        try {
          new Function(code);
        } catch (e) {
          add(path, "error", `Syntax error: ${(e as Error).message}`);
        }
      }
      for (const m of code.matchAll(/(?:from\s+|import\s+|require\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        if (!exists(vfs, path, m[1], [".js", ".mjs", ".ts", ".tsx", ".jsx", ".json", ".css"])) add(path, "error", `Imports "${m[1]}" but that file does not exist.`, lineOf(code, m.index ?? 0));
      }
    }
  }
  return issues;
}

export const formatIssues = (issues: Issue[]): string =>
  issues.map((i) => `- ${i.severity.toUpperCase()} ${i.path}${i.line ? `:${i.line}` : ""}: ${i.message}`).join("\n");

export function formatIssuesWithContext(issues: Issue[], vfs: VfsState, radius = 8): string {
  return issues
    .map((issue) => {
      const header = `- ${issue.severity.toUpperCase()} ${issue.path}${issue.line ? `:${issue.line}` : ""}: ${issue.message}`;
      const content = vfs.files[issue.path];
      if (!content || !issue.line || issue.line < 1) return header;
      const fileLines = content.replace(/\r\n/g, "\n").split("\n");
      const start = Math.max(1, issue.line - radius);
      const end = Math.min(fileLines.length, issue.line + radius);
      const snippet = fileLines
        .slice(start - 1, end)
        .map((l, idx) => `  ${start + idx} | ${l}`)
        .join("\n");
      return `${header}\n${snippet}`;
    })
    .join("\n\n");
}
