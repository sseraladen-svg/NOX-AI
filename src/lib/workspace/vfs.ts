// Pure in-memory virtual file system. No React / alias imports so it is unit-testable.

export type VfsState = { files: Record<string, string>; dirs: string[] };
export type TreeNode = { name: string; path: string; type: "file" | "dir"; children?: TreeNode[] };

export const emptyVfs = (): VfsState => ({ files: {}, dirs: [] });

const MAX_PATH = 400;

/** Resolves `p` against `cwd` into a normalized absolute path ("/a/b"). Throws on invalid input. */
export function normalizePath(p: string, cwd = "/"): string {
  if (p.includes("\0")) throw new Error("Invalid path");
  const raw = p.startsWith("/") ? p : `${cwd}/${p}`;
  const out: string[] = [];
  for (const seg of raw.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  const res = "/" + out.join("/");
  if (res.length > MAX_PATH) throw new Error("Path too long");
  return res;
}

export const parentOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
};
export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function isFile(s: VfsState, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(s.files, path);
}

export function isDir(s: VfsState, path: string): boolean {
  if (path === "/") return true;
  const prefix = path + "/";
  return s.dirs.includes(path) || Object.keys(s.files).some((f) => f.startsWith(prefix)) || s.dirs.some((d) => d.startsWith(prefix));
}

export function exists(s: VfsState, path: string): boolean {
  return isFile(s, path) || isDir(s, path);
}

export function listDir(s: VfsState, dir: string): { name: string; type: "file" | "dir" }[] {
  const prefix = dir === "/" ? "/" : dir + "/";
  const seen = new Map<string, "file" | "dir">();
  const add = (full: string, isLeafFile: boolean) => {
    if (!full.startsWith(prefix) || full === dir) return;
    const rest = full.slice(prefix.length);
    const [first, ...more] = rest.split("/");
    if (!first) return;
    seen.set(first, more.length === 0 && isLeafFile ? "file" : "dir");
  };
  for (const f of Object.keys(s.files)) add(f, true);
  for (const d of s.dirs) add(d, false);
  return [...seen.entries()]
    .map(([name, type]) => ({ name, type }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
}

/** Adds `dir` and all its ancestors as explicit directories so they survive when emptied. */
function withDir(dirs: string[], dir: string): string[] {
  const out = [...dirs];
  let d = dir;
  while (d !== "/") {
    if (!out.includes(d)) out.push(d);
    d = parentOf(d);
  }
  return out;
}

export function mkdir(s: VfsState, path: string): VfsState {
  if (isFile(s, path)) throw new Error(`${path} is a file`);
  return { files: s.files, dirs: withDir(s.dirs, path) };
}

export function writeFile(s: VfsState, path: string, content: string): VfsState {
  if (path === "/") throw new Error("Cannot write to /");
  if (isDir(s, path)) throw new Error(`${path} is a directory`);
  // Every ancestor must not be an existing file.
  let anc = parentOf(path);
  while (anc !== "/") {
    if (isFile(s, anc)) throw new Error(`${anc} is a file`);
    anc = parentOf(anc);
  }
  return { files: { ...s.files, [path]: content }, dirs: withDir(s.dirs, parentOf(path)) };
}

export function removePath(s: VfsState, path: string, recursive = false): VfsState {
  if (path === "/") throw new Error("Cannot remove /");
  if (isFile(s, path)) {
    const files = { ...s.files };
    delete files[path];
    return { files, dirs: s.dirs };
  }
  if (!isDir(s, path)) throw new Error(`${path}: no such file or directory`);
  if (!recursive && listDir(s, path).length > 0) throw new Error(`${path} is not empty (use rm -r)`);
  const prefix = path + "/";
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.files)) if (!k.startsWith(prefix)) files[k] = v;
  return { files, dirs: s.dirs.filter((d) => d !== path && !d.startsWith(prefix)) };
}

export function movePath(s: VfsState, from: string, to: string): VfsState {
  if (from === "/" || to === "/") throw new Error("Invalid move");
  if (!exists(s, from)) throw new Error(`${from}: no such file or directory`);
  if (exists(s, to)) throw new Error(`${to} already exists`);
  if (to === from || to.startsWith(from + "/")) throw new Error("Cannot move into itself");
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.files)) {
    if (k === from) files[to] = v;
    else if (k.startsWith(from + "/")) files[to + k.slice(from.length)] = v;
    else files[k] = v;
  }
  const dirs = s.dirs.map((d) => (d === from ? to : d.startsWith(from + "/") ? to + d.slice(from.length) : d));
  return { files, dirs: withDir(dirs, parentOf(to)) };
}

export function copyPath(s: VfsState, from: string, to: string): VfsState {
  if (!exists(s, from)) throw new Error(`${from}: no such file or directory`);
  if (exists(s, to)) throw new Error(`${to} already exists`);
  if (to.startsWith(from + "/")) throw new Error("Cannot copy into itself");
  const files = { ...s.files };
  for (const [k, v] of Object.entries(s.files)) {
    if (k === from) files[to] = v;
    else if (k.startsWith(from + "/")) files[to + k.slice(from.length)] = v;
  }
  const dirs = [...s.dirs];
  for (const d of s.dirs) if (d === from || d.startsWith(from + "/")) dirs.push(to + d.slice(from.length));
  return { files, dirs: withDir(dirs, parentOf(to)) };
}

export function buildTree(s: VfsState, dir = "/"): TreeNode[] {
  return listDir(s, dir).map(({ name, type }) => {
    const path = dir === "/" ? `/${name}` : `${dir}/${name}`;
    return type === "dir" ? { name, path, type, children: buildTree(s, path) } : { name, path, type };
  });
}

export const allFilePaths = (s: VfsState): string[] => Object.keys(s.files).sort();
