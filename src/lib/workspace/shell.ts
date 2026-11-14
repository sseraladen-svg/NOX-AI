// Pure command interpreter over the virtual file system (the "Virtual" terminal).
import {
  type VfsState, allFilePaths, baseName, copyPath, exists, isDir, isFile, listDir, mkdir,
  movePath, normalizePath, removePath, writeFile,
} from "./vfs.ts";

export type ShellResult = {
  state: VfsState;
  cwd: string;
  out: string;
  clear?: boolean;
  open?: string; // path the UI should open in the editor
  run?: string; // path the UI should execute (sandboxed JS)
};

export const HELP = [
  "Virtual shell commands:",
  "  pwd, cd, ls [-a], tree, cat, mkdir [-p], touch, rm [-r], mv, cp [-r]",
  "  echo text [> file | >> file], grep [-i] pattern [path], find name",
  "  open <file>   open in editor        node <file>   run JavaScript (sandboxed)",
  "  clear, help",
].join("\n");

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  let has = false;
  for (const ch of line) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

function treeLines(s: VfsState, dir: string, prefix = ""): string[] {
  const entries = listDir(s, dir);
  return entries.flatMap((e, i) => {
    const last = i === entries.length - 1;
    const line = `${prefix}${last ? "└── " : "├── "}${e.name}${e.type === "dir" ? "/" : ""}`;
    const child = dir === "/" ? `/${e.name}` : `${dir}/${e.name}`;
    return e.type === "dir" ? [line, ...treeLines(s, child, prefix + (last ? "    " : "│   "))] : [line];
  });
}

export function runCommand(state: VfsState, cwd: string, line: string): ShellResult {
  const tokens = tokenize(line.trim());
  if (tokens.length === 0) return { state, cwd, out: "" };
  const [cmd, ...rest] = tokens;
  const flags = rest.filter((a) => /^-[a-zA-Z]+$/.test(a)).join("");
  const args = rest.filter((a) => !/^-[a-zA-Z]+$/.test(a));
  const abs = (p: string) => normalizePath(p, cwd);
  const res = (out: string, extra: Partial<ShellResult> = {}): ShellResult => ({ state, cwd, out, ...extra });

  try {
    switch (cmd) {
      case "help":
        return res(HELP);
      case "clear":
        return res("", { clear: true });
      case "pwd":
        return res(cwd);
      case "cd": {
        const target = abs(args[0] ?? "/");
        if (!isDir(state, target)) return res(`cd: ${args[0]}: not a directory`);
        return { state, cwd: target, out: "" };
      }
      case "ls": {
        const p = abs(args[0] ?? ".");
        if (isFile(state, p)) return res(baseName(p));
        if (!isDir(state, p)) return res(`ls: ${args[0]}: no such file or directory`);
        const names = listDir(state, p)
          .filter((e) => flags.includes("a") || !e.name.startsWith("."))
          .map((e) => (e.type === "dir" ? e.name + "/" : e.name));
        return res(names.join("  "));
      }
      case "tree": {
        const p = abs(args[0] ?? ".");
        if (!isDir(state, p)) return res(`tree: ${args[0]}: not a directory`);
        return res([p, ...treeLines(state, p)].join("\n"));
      }
      case "cat": {
        if (!args.length) return res("cat: missing file");
        const parts = args.map((a) => {
          const p = abs(a);
          if (!isFile(state, p)) throw new Error(`${a}: no such file`);
          return state.files[p];
        });
        return res(parts.join("\n"));
      }
      case "mkdir": {
        if (!args.length) return res("mkdir: missing operand");
        let s = state;
        for (const a of args) {
          const p = abs(a);
          if (exists(s, p) && !flags.includes("p")) throw new Error(`${a}: already exists`);
          s = mkdir(s, p);
        }
        return { state: s, cwd, out: "" };
      }
      case "touch": {
        if (!args.length) return res("touch: missing file");
        let s = state;
        for (const a of args) {
          const p = abs(a);
          if (!isFile(s, p)) s = writeFile(s, p, "");
        }
        return { state: s, cwd, out: "" };
      }
      case "rm": {
        if (!args.length) return res("rm: missing operand");
        let s = state;
        for (const a of args) s = removePath(s, abs(a), flags.includes("r") || flags.includes("f"));
        return { state: s, cwd, out: "" };
      }
      case "mv":
      case "cp": {
        if (args.length !== 2) return res(`${cmd}: usage: ${cmd} <from> <to>`);
        const from = abs(args[0]);
        let to = abs(args[1]);
        if (isDir(state, to)) to = to === "/" ? `/${baseName(from)}` : `${to}/${baseName(from)}`;
        if (cmd === "cp" && isDir(state, from) && !flags.includes("r")) throw new Error(`${args[0]} is a directory (use cp -r)`);
        const s = cmd === "mv" ? movePath(state, from, to) : copyPath(state, from, to);
        return { state: s, cwd, out: "" };
      }
      case "echo": {
        const gt = rest.findIndex((a) => a === ">" || a === ">>");
        if (gt === -1) return res(rest.join(" "));
        const file = rest[gt + 1];
        if (!file) return res("echo: missing file after redirect");
        const p = abs(file);
        const text = rest.slice(0, gt).join(" ");
        const prev = rest[gt] === ">>" && isFile(state, p) ? state.files[p] + "\n" : "";
        return { state: writeFile(state, p, prev + text), cwd, out: "" };
      }
      case "grep": {
        if (!args.length) return res("grep: usage: grep [-i] pattern [path]");
        const [pat, ...paths] = args;
        const needle = flags.includes("i") ? pat.toLowerCase() : pat;
        const roots = (paths.length ? paths : ["."]).map(abs);
        const hits: string[] = [];
        for (const f of allFilePaths(state)) {
          if (!roots.some((r) => f === r || f.startsWith(r === "/" ? "/" : r + "/"))) continue;
          state.files[f].split("\n").forEach((l, i) => {
            if ((flags.includes("i") ? l.toLowerCase() : l).includes(needle)) hits.push(`${f}:${i + 1}:${l}`);
          });
          if (hits.length > 200) break;
        }
        return res(hits.slice(0, 200).join("\n") || "(no matches)");
      }
      case "find": {
        const q = (args[0] ?? "").toLowerCase();
        const found = allFilePaths(state).filter((f) => f.toLowerCase().includes(q));
        return res(found.slice(0, 200).join("\n") || "(no matches)");
      }
      case "open": {
        const p = abs(args[0] ?? "");
        if (!isFile(state, p)) return res(`open: ${args[0] ?? ""}: no such file`);
        return res("", { open: p });
      }
      case "node":
      case "run": {
        const p = abs(args[0] ?? "");
        if (!isFile(state, p)) return res(`${cmd}: ${args[0] ?? ""}: no such file`);
        return res("", { run: p });
      }
      default:
        return res(`${cmd}: command not found (type 'help'; switch to Local shell for real commands)`);
    }
  } catch (e) {
    return res(`${cmd}: ${(e as Error).message}`);
  }
}
