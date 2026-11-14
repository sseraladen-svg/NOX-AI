// Real-folder access through the browser File System Access API (Chromium browsers).
import { emptyVfs, parentOf, type VfsState, writeFile, mkdir } from "./vfs.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type DirHandle = any;

const IGNORE = new Set(["node_modules", ".git", ".next", "dist", "build", ".turbo", ".vercel", "__pycache__", ".venv", ".idea", ".vscode"]);
const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|rar|7z|woff2?|ttf|otf|eot|mp[34]|mov|avi|wasm|exe|dll|so|dylib|bin|class|jar|sqlite|db)$/i;
export const MAX_FILES = 2000;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export const fsaSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function pickFolder(): Promise<DirHandle> {
  return (window as any).showDirectoryPicker({ mode: "readwrite" });
}

export async function readTree(root: DirHandle): Promise<{ vfs: VfsState; skipped: number; truncated: boolean }> {
  let vfs = emptyVfs();
  let skipped = 0;
  let count = 0;
  let total = 0;
  let truncated = false;
  async function walk(dir: DirHandle, path: string): Promise<void> {
    for await (const [name, handle] of dir.entries() as AsyncIterable<[string, any]>) {
      if (truncated) return;
      const p = `${path === "/" ? "" : path}/${name}`;
      if (handle.kind === "directory") {
        if (IGNORE.has(name)) { skipped++; continue; }
        vfs = mkdir(vfs, p);
        await walk(handle, p);
      } else {
        if (BINARY.test(name)) { skipped++; continue; }
        const file: File = await handle.getFile();
        if (file.size > MAX_FILE_BYTES) { skipped++; continue; }
        if (count >= MAX_FILES || total + file.size > MAX_TOTAL_BYTES) { truncated = true; return; }
        const text = await file.text();
        if (text.includes("\0")) { skipped++; continue; }
        vfs = writeFile(vfs, p, text);
        count++;
        total += file.size;
      }
    }
  }
  await walk(root, "/");
  return { vfs, skipped, truncated };
}

async function dirAt(root: DirHandle, path: string, create: boolean): Promise<DirHandle> {
  let cur = root;
  for (const seg of path.split("/").filter(Boolean)) cur = await cur.getDirectoryHandle(seg, { create });
  return cur;
}

export async function writeFileAt(root: DirHandle, path: string, content: string): Promise<void> {
  const dir = await dirAt(root, parentOf(path), true);
  const fh = await dir.getFileHandle(path.slice(path.lastIndexOf("/") + 1), { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

export async function mkdirAt(root: DirHandle, path: string): Promise<void> {
  await dirAt(root, path, true);
}

export async function removeAt(root: DirHandle, path: string): Promise<void> {
  try {
    const dir = await dirAt(root, parentOf(path), false);
    await dir.removeEntry(path.slice(path.lastIndexOf("/") + 1), { recursive: true });
  } catch {
    /* already gone */
  }
}

/** Mirrors the difference between two virtual trees onto the connected folder. */
export async function mirrorDiff(root: DirHandle, prev: VfsState, next: VfsState): Promise<void> {
  for (const d of next.dirs) if (!prev.dirs.includes(d)) await mkdirAt(root, d);
  for (const [p, c] of Object.entries(next.files)) if (prev.files[p] !== c) await writeFileAt(root, p, c);
  for (const p of Object.keys(prev.files)) if (!(p in next.files)) await removeAt(root, p);
  for (const d of prev.dirs) if (!next.dirs.includes(d)) await removeAt(root, d);
}
