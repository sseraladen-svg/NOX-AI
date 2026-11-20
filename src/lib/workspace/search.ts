// Find / replace across the virtual workspace (VS Code "Search" panel). Pure.
import { type VfsState, allFilePaths, baseName } from "./vfs.ts";

export interface SearchOptions {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  include?: string; // comma separated globs, e.g. "*.js, src/**"
  exclude?: string;
}
export type Match = { line: number; start: number; end: number; text: string };
export type FileMatches = { path: string; matches: Match[] };
export type SearchResult = { results: FileMatches[]; total: number; truncated: boolean; error?: string };

export function compileQuery(o: SearchOptions): RegExp {
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (o.wholeWord) src = `\\b(?:${src})\\b`;
  return new RegExp(src, o.caseSensitive ? "g" : "gi");
}

export function globToRegExp(glob: string): RegExp {
  const g = glob.trim().replace(/^\.?\//, "");
  const re = g
    .replace(/\/\*\*$/, "\u0001")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, "(?:/.*)?");
  return new RegExp(g.includes("/") ? `^/?${re}(?:/.*)?$` : `(?:^|/)${re}$`);
}

const globs = (s?: string) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(globToRegExp);

function allowed(path: string, inc: RegExp[], exc: RegExp[]): boolean {
  if (exc.some((r) => r.test(path))) return false;
  return inc.length === 0 || inc.some((r) => r.test(path));
}

export function searchFiles(vfs: VfsState, o: SearchOptions, maxMatches = 2000): SearchResult {
  if (!o.query) return { results: [], total: 0, truncated: false };
  let re: RegExp;
  try {
    re = compileQuery(o);
  } catch (e) {
    return { results: [], total: 0, truncated: false, error: (e as Error).message };
  }
  const inc = globs(o.include);
  const exc = globs(o.exclude);
  const results: FileMatches[] = [];
  let total = 0;
  let truncated = false;
  for (const path of allFilePaths(vfs)) {
    if (!allowed(path, inc, exc)) continue;
    const matches: Match[] = [];
    vfs.files[path].split("\n").forEach((line, i) => {
      re.lastIndex = 0;
      for (let m = re.exec(line); m; m = re.exec(line)) {
        if (m[0] === "") { re.lastIndex++; continue; }
        if (total >= maxMatches) { truncated = true; return; }
        matches.push({ line: i + 1, start: m.index, end: m.index + m[0].length, text: line.slice(0, 300) });
        total++;
      }
    });
    if (matches.length) results.push({ path, matches });
    if (truncated) break;
  }
  return { results, total, truncated };
}

/** Replaces in all matching files (or only `paths`). Returns the new tree and how many replacements were made. */
export function replaceInFiles(vfs: VfsState, o: SearchOptions, replacement: string, paths?: string[]): { vfs: VfsState; count: number; files: string[] } {
  if (!o.query) return { vfs, count: 0, files: [] };
  const re = compileQuery(o);
  const inc = globs(o.include);
  const exc = globs(o.exclude);
  const files: Record<string, string> = { ...vfs.files };
  let count = 0;
  const changed: string[] = [];
  for (const path of paths ?? allFilePaths(vfs)) {
    if (!(path in files) || !allowed(path, inc, exc)) continue;
    let n = 0;
    const next = files[path].replace(re, (...args) => {
      n++;
      return o.regex ? args[0].replace(new RegExp(re.source, re.flags.replace("g", "")), replacement) : replacement;
    });
    if (n > 0 && next !== files[path]) {
      files[path] = next;
      count += n;
      changed.push(path);
    }
  }
  return { vfs: { files, dirs: vfs.dirs }, count, files: changed };
}

export const displayName = baseName;
