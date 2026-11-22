// Applies agent actions to the virtual file system. Pure: returns a new state plus a result
// message the model sees on its next turn. run / shell / done are handled by the runner.
import {
  type VfsState, allFilePaths, exists, isDir, isFile, listDir, mkdir, movePath, normalizePath, removePath, writeFile,
} from "./vfs.ts";
import { type AgentAction, isSensitivePath } from "./agent-protocol.ts";

export type ActionResult = {
  ok: boolean;
  message: string; // short line shown in the UI and sent back to the model
  output?: string; // read / list / search payload for the model
  changed?: string[]; // paths whose content or existence changed
};

export const MAX_FILE_BYTES = 512 * 1024;
const MAX_READ_CHARS = 12_000;

const lines = (s: string) => (s === "" ? 0 : s.split("\n").length);
const fail = (message: string): ActionResult => ({ ok: false, message });

function listing(s: VfsState, dir: string, depth = 0, out: string[] = []): string[] {
  for (const e of listDir(s, dir)) {
    if (out.length >= 300) return out;
    const p = dir === "/" ? `/${e.name}` : `${dir}/${e.name}`;
    if (isSensitivePath(p)) continue;
    out.push(`${"  ".repeat(depth)}${e.name}${e.type === "dir" ? "/" : ""}`);
    if (e.type === "dir" && depth < 4) listing(s, p, depth + 1, out);
  }
  return out;
}

export function applyAction(state: VfsState, action: AgentAction): { state: VfsState; result: ActionResult } {
  const done = (s: VfsState, r: ActionResult) => ({ state: s, result: r });
  try {
    switch (action.type) {
      case "write": {
        const path = normalizePath(action.path);
        if (isSensitivePath(path)) return done(state, fail(`Refused: ${path} is a protected file.`));
        if (action.content.length > MAX_FILE_BYTES) return done(state, fail(`${path} is too large (over 512 KB).`));
        const existed = isFile(state, path);
        const next = writeFile(state, path, action.content);
        return done(next, { ok: true, message: `${existed ? "Updated" : "Created"} ${path} (${lines(action.content)} lines)`, changed: [path] });
      }
      case "edit": {
        const path = normalizePath(action.path);
        if (isSensitivePath(path)) return done(state, fail(`Refused: ${path} is a protected file.`));
        if (!isFile(state, path)) return done(state, fail(`Cannot edit ${path}: file does not exist. Use write to create it.`));
        if (!action.find) return done(state, fail("Edit needs a non-empty <find> text."));
        const crlf = state.files[path].includes("\r\n");
        const text = state.files[path].replace(/\r\n/g, "\n");
        const stripLinePrefix = (block: string) => {
          const ls = block.split("\n");
          const hasPrefix = ls.some((l) => /^\s*\d+\s*\|\s?/.test(l));
          return hasPrefix ? ls.map((l) => l.replace(/^\s*\d+\s*\|\s?/, "")).join("\n") : block;
        };
        let find = action.find.replace(/\r\n/g, "\n");
        let rep = action.replace.replace(/\r\n/g, "\n");
        let count = text.split(find).length - 1;
        if (count === 0) {
          const strippedFind = stripLinePrefix(find);
          if (strippedFind !== find) {
            find = strippedFind;
            rep = stripLinePrefix(rep);
            count = text.split(find).length - 1;
          }
        }
        let out: string | null = null;
        if (count === 1) {
          out = text.replace(find, () => rep);
        } else if (count > 1) {
          return done(state, fail(`Edit failed in ${path}: <find> matches ${count} places. Include more surrounding lines to make it unique.`));
        } else {
          // Whitespace-trimmed line-block fallback when local models shift indentation
          const norm = (l: string) => l.replace(/\s+/g, " ").trim();
          const fileLines = text.split("\n");
          const findLines = find.split("\n");
          const targetNorm = findLines.map(norm);
          const matches: number[] = [];
          if (findLines.length > 0 && targetNorm.some((l) => l.length > 0)) {
            for (let i = 0; i <= fileLines.length - findLines.length; i++) {
              let ok = true;
              for (let j = 0; j < findLines.length; j++) {
                if (norm(fileLines[i + j]) !== targetNorm[j]) { ok = false; break; }
              }
              if (ok) matches.push(i);
            }
          }
          if (matches.length === 1) {
            const idx = matches[0];
            fileLines.splice(idx, findLines.length, ...rep.split("\n"));
            out = fileLines.join("\n");
          } else if (matches.length > 1) {
            return done(state, fail(`Edit failed in ${path}: <find> matches ${matches.length} places. Include more surrounding lines to make it unique.`));
          } else {
            return done(state, fail(`Edit failed in ${path}: <find> text not found. Read the file again and copy the exact text.`));
          }
        }
        if (crlf) out = out.replace(/\n/g, "\r\n");
        return done(writeFile(state, path, out), { ok: true, message: `Edited ${path}`, changed: [path] });
      }
      case "delete": {
        const path = normalizePath(action.path);
        if (isSensitivePath(path)) return done(state, fail(`Refused: ${path} is a protected file.`));
        if (isDir(state, path) && !isFile(state, path)) return done(state, fail(`${path} is a folder. Delete its files one by one.`));
        if (!isFile(state, path)) return done(state, fail(`Cannot delete ${path}: no such file.`));
        return done(removePath(state, path, false), { ok: true, message: `Deleted ${path}`, changed: [path] });
      }
      case "rename": {
        const from = normalizePath(action.from);
        const to = normalizePath(action.to);
        if (isSensitivePath(from) || isSensitivePath(to)) return done(state, fail("Refused: protected file."));
        if (!exists(state, from)) return done(state, fail(`Cannot rename ${from}: not found.`));
        const moved = Object.keys(state.files).filter((f) => f === from || f.startsWith(from + "/"));
        return done(movePath(state, from, to), { ok: true, message: `Renamed ${from} → ${to}`, changed: [...moved, ...moved.map((m) => to + m.slice(from.length))] });
      }
      case "mkdir": {
        const path = normalizePath(action.path);
        if (isSensitivePath(path)) return done(state, fail(`Refused: ${path} is protected.`));
        return done(mkdir(state, path), { ok: true, message: `Created folder ${path}` });
      }
      case "read": {
        const path = normalizePath(action.path);
        if (isSensitivePath(path)) return done(state, fail(`Refused: ${path} is a protected file and cannot be read.`));
        if (!isFile(state, path)) return done(state, fail(`Cannot read ${path}: no such file.`));
        const c = state.files[path];
        const body = c.length > MAX_READ_CHARS ? c.slice(0, MAX_READ_CHARS) + "\n… (truncated)" : c;
        return done(state, { ok: true, message: `Read ${path} (${lines(c)} lines)`, output: `--- ${path} ---\n${body}` });
      }
      case "list": {
        const path = normalizePath(action.path);
        if (!isDir(state, path)) return done(state, fail(`Cannot list ${path}: not a folder.`));
        const out = listing(state, path);
        return done(state, { ok: true, message: `Listed ${path} (${out.length} entries)`, output: out.join("\n") || "(empty)" });
      }
      case "search": {
        const q = action.query.toLowerCase();
        const hits: string[] = [];
        for (const f of allFilePaths(state)) {
          if (isSensitivePath(f)) continue;
          state.files[f].split("\n").forEach((l, i) => {
            if (hits.length < 50 && l.toLowerCase().includes(q)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 160)}`);
          });
        }
        return done(state, { ok: true, message: `Searched "${action.query}" (${hits.length} matches)`, output: hits.join("\n") || "(no matches)" });
      }
      default:
        return done(state, fail(`Action ${action.type} is handled by the runner.`));
    }
  } catch (e) {
    return done(state, fail((e as Error).message));
  }
}

export type FileChange = { path: string; status: "added" | "modified" | "deleted" };

export function summarizeChanges(before: VfsState, after: VfsState): FileChange[] {
  const out: FileChange[] = [];
  for (const p of Object.keys(after.files)) {
    if (!(p in before.files)) out.push({ path: p, status: "added" });
    else if (before.files[p] !== after.files[p]) out.push({ path: p, status: "modified" });
  }
  for (const p of Object.keys(before.files)) if (!(p in after.files)) out.push({ path: p, status: "deleted" });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Undoes only the files the agent changed (user edits to other files are kept). */
export function revertChanges(current: VfsState, before: VfsState, changes: FileChange[]): VfsState {
  let s = current;
  for (const c of changes) {
    if (c.status === "added") {
      if (c.path in s.files) s = removePath(s, c.path, false);
    } else if (c.path in before.files) {
      s = writeFile(s, c.path, before.files[c.path]);
    }
  }
  return s;
}
