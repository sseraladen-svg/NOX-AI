import { create } from "zustand";
import { toast } from "sonner";
import {
  type VfsState, allFilePaths, baseName, emptyVfs, exists, isDir, isFile, mkdir, movePath,
  normalizePath, removePath, writeFile,
} from "@/lib/workspace/vfs";
import { extractPathHint } from "@/lib/workspace/code-blocks";
import { extensionFor } from "@/lib/workspace/language";
import { idbGet, idbSet } from "@/lib/workspace/idb";
import { type DirHandle, fsaSupported, mirrorDiff, pickFolder, readTree, writeFileAt } from "@/lib/workspace/fsa";

type Source = { kind: "virtual" } | { kind: "folder"; name: string; connected: boolean };

interface Snapshot {
  vfs: VfsState;
  baseline?: VfsState;
  tabs: string[];
  active: string | null;
  source: Source;
}

const SEED: VfsState = writeFile(
  writeFile(
    emptyVfs(),
    "/README.md",
    "# NOX Workspace\n\nEdit files here, run `node hello.js` in the terminal, or ask the Host to build something.\nThe Host and specialists can see your open files. Code they return can be applied with one click.\n\nTip: use **Open folder** to work on a real folder on your computer (Chrome / Edge).\n"
  ),
  "/hello.js",
  'const names = ["NOX", "Host", "Specialists"];\nfor (const n of names) console.log(`Hello, ${n}!`);\n'
);

// Non-serializable disk handle lives outside the store (and is not persisted).
let rootHandle: DirHandle | null = null;

interface WorkspaceState {
  vfs: VfsState;
  /** Reference tree for the Changes view (like the last git commit). */
  baseline: VfsState;
  tabs: string[];
  active: string | null;
  dirty: Record<string, true>;
  source: Source;
  hydrated: boolean;
  selection: string;
  contextEnabled: boolean;
  explorerOpen: boolean;
  terminalOpen: boolean;
  hydrate: () => Promise<void>;
  setContent: (path: string, content: string) => void;
  openFile: (path: string) => void;
  closeTab: (path: string) => void;
  closeOthers: (path: string) => void;
  closeAll: () => void;
  reorderTabs: (from: number, to: number) => void;
  discardChange: (path: string) => void;
  acceptBaseline: () => void;
  setActive: (path: string) => void;
  /** Applies a structural change (create/delete/rename/shell) to the tree and the connected folder. */
  commit: (next: VfsState) => void;
  createFile: (path: string, content?: string) => void;
  createDir: (path: string) => void;
  remove: (path: string) => void;
  rename: (from: string, to: string) => void;
  saveFile: (path: string, silent?: boolean) => Promise<void>;
  saveAll: (silent?: boolean) => Promise<void>;
  openFolder: () => Promise<void>;
  importFiles: (files: FileList) => Promise<void>;
  applyCode: (code: string, lang: string) => string | null;
  setSelection: (s: string) => void;
  setContextEnabled: (v: boolean) => void;
  toggleExplorer: () => void;
  toggleTerminal: () => void;
  resetWorkspace: () => void;
}

const safe = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    toast.error((e as Error).message);
  }
};

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  vfs: SEED,
  baseline: SEED,
  tabs: ["/README.md"],
  active: "/README.md",
  dirty: {},
  source: { kind: "virtual" },
  hydrated: false,
  selection: "",
  contextEnabled: true,
  explorerOpen: true,
  terminalOpen: true,

  hydrate: async () => {
    if (get().hydrated) return;
    const snap = await idbGet<Snapshot>("snapshot");
    if (snap?.vfs && Object.keys(snap.vfs.files).length + snap.vfs.dirs.length > 0) {
      const source: Source = snap.source?.kind === "folder" ? { ...snap.source, connected: false } : { kind: "virtual" };
      set({ vfs: snap.vfs, baseline: snap.baseline ?? snap.vfs, tabs: snap.tabs.filter((t) => t in snap.vfs.files), active: snap.active && snap.active in snap.vfs.files ? snap.active : null, source, hydrated: true });
    } else {
      set({ hydrated: true });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    useWorkspace.subscribe((s, prev) => {
      if (s.vfs === prev.vfs && s.tabs === prev.tabs && s.active === prev.active && s.source === prev.source && s.baseline === prev.baseline) return;
      clearTimeout(timer);
      timer = setTimeout(() => void idbSet("snapshot", { vfs: s.vfs, baseline: s.baseline, tabs: s.tabs, active: s.active, source: s.source } satisfies Snapshot), 600);
    });
  },

  setContent: (path, content) =>
    set((s) => {
      if (s.vfs.files[path] === content) return s;
      const dirty = s.source.kind === "folder" ? { ...s.dirty, [path]: true as const } : s.dirty;
      return { vfs: { files: { ...s.vfs.files, [path]: content }, dirs: s.vfs.dirs }, dirty };
    }),

  openFile: (path) =>
    set((s) => (isFile(s.vfs, path) ? { tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path], active: path } : s)),

  closeTab: (path) =>
    set((s) => {
      const i = s.tabs.indexOf(path);
      if (i === -1) return s;
      const tabs = s.tabs.filter((t) => t !== path);
      const active = s.active === path ? (tabs[i] ?? tabs[i - 1] ?? null) : s.active;
      const dirty = { ...s.dirty };
      delete dirty[path];
      return { tabs, active, dirty };
    }),

  closeOthers: (path) => set((s) => ({ tabs: s.tabs.filter((t) => t === path), active: path, dirty: Object.fromEntries(Object.entries(s.dirty).filter(([p]) => p === path)) as Record<string, true> })),
  closeAll: () => set({ tabs: [], active: null, dirty: {} }),
  reorderTabs: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.tabs.length || to >= s.tabs.length) return s;
      const tabs = s.tabs.slice();
      const [m] = tabs.splice(from, 1);
      tabs.splice(to, 0, m);
      return { tabs };
    }),
  discardChange: (path) => {
    const { vfs, baseline } = get();
    const next = path in baseline.files ? writeFile(vfs, path, baseline.files[path]) : path in vfs.files ? removePath(vfs, path, false) : vfs;
    get().commit(next);
  },
  acceptBaseline: () => set((s) => ({ baseline: s.vfs })),

  setActive: (path) => set({ active: path }),

  commit: (next) => {
    const prev = get().vfs;
    if (next === prev) return;
    set((s) => {
      const tabs = s.tabs.filter((t) => t in next.files);
      const dirty = Object.fromEntries(Object.entries(s.dirty).filter(([p]) => p in next.files)) as Record<string, true>;
      return { vfs: next, tabs, active: s.active && s.active in next.files ? s.active : (tabs[0] ?? null), dirty };
    });
    if (rootHandle) {
      mirrorDiff(rootHandle, prev, next).catch((e) => toast.error(`Could not update folder on disk: ${(e as Error).message}`));
    }
  },

  createFile: (path, content = "") =>
    safe(() => {
      const p = normalizePath(path);
      if (exists(get().vfs, p)) throw new Error(`${p} already exists`);
      get().commit(writeFile(get().vfs, p, content));
      get().openFile(p);
    }),

  createDir: (path) => safe(() => get().commit(mkdir(get().vfs, normalizePath(path)))),

  remove: (path) => safe(() => get().commit(removePath(get().vfs, path, true))),

  rename: (from, to) =>
    safe(() => {
      const dest = normalizePath(to);
      const moved = (p: string) => (p === from ? dest : p.startsWith(from + "/") ? dest + p.slice(from.length) : p);
      const { tabs, active } = get();
      get().commit(movePath(get().vfs, from, dest));
      set({ tabs: tabs.map(moved), active: active ? moved(active) : null });
    }),

  saveFile: async (path, silent = false) => {
    const s = get();
    if (!isFile(s.vfs, path)) return;
    if (s.source.kind === "folder") {
      if (!rootHandle) {
        toast.error("Folder is disconnected. Use Open folder to reconnect, then save again.");
        return;
      }
      try {
        await writeFileAt(rootHandle, path, s.vfs.files[path]);
      } catch (e) {
        toast.error(`Save failed: ${(e as Error).message}`);
        return;
      }
    }
    set((st) => {
      const dirty = { ...st.dirty };
      delete dirty[path];
      return { dirty };
    });
    if (!silent) toast.success(`Saved ${baseName(path)}`);
  },

  saveAll: async (silent = false) => {
    for (const p of Object.keys(get().dirty)) await get().saveFile(p, silent);
  },

  openFolder: async () => {
    if (!fsaSupported()) {
      toast.error("Opening real folders needs Chrome or Edge. You can still use the virtual workspace and upload files.");
      return;
    }
    try {
      const handle = await pickFolder();
      const { vfs, skipped, truncated } = await readTree(handle);
      rootHandle = handle;
      set({ vfs, baseline: vfs, tabs: [], active: null, dirty: {}, source: { kind: "folder", name: handle.name, connected: true } });
      const first = allFilePaths(vfs).find((p) => /readme/i.test(p)) ?? allFilePaths(vfs)[0];
      if (first) get().openFile(first);
      toast.success(`Opened ${handle.name} (${Object.keys(vfs.files).length} files${skipped ? `, ${skipped} skipped` : ""})`);
      if (truncated) toast.warning("Folder is large — only the first files were loaded.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error(`Could not open folder: ${(e as Error).message}`);
    }
  },

  importFiles: async (files) => {
    let next = get().vfs;
    let added = 0;
    for (const f of Array.from(files)) {
      if (f.size > 512 * 1024) { toast.warning(`${f.name} skipped (over 512 KB)`); continue; }
      const text = await f.text();
      if (text.includes("\0")) { toast.warning(`${f.name} skipped (binary)`); continue; }
      let p = `/${f.name}`;
      for (let i = 1; exists(next, p); i++) p = `/${i}-${f.name}`;
      next = writeFile(next, p, text);
      added++;
    }
    if (added) {
      get().commit(next);
      toast.success(`Imported ${added} file${added > 1 ? "s" : ""}`);
    }
  },

  applyCode: (code, lang) => {
    const s = get();
    const hint = extractPathHint(code);
    try {
      let path = hint.path;
      if (!path) {
        if (s.active) path = s.active;
        else {
          let i = 1;
          path = `/untitled-${i}.${extensionFor(lang)}`;
          while (exists(s.vfs, path)) path = `/untitled-${++i}.${extensionFor(lang)}`;
        }
      }
      if (isDir(s.vfs, path)) throw new Error(`${path} is a folder`);
      const body = hint.path ? hint.code : code;
      get().commit(writeFile(s.vfs, path, body));
      get().openFile(path);
      toast.success(`Applied to ${path}`);
      return path;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    }
  },

  setSelection: (selection) => set({ selection }),
  setContextEnabled: (contextEnabled) => set({ contextEnabled }),
  toggleExplorer: () => set((s) => ({ explorerOpen: !s.explorerOpen })),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),

  resetWorkspace: () => {
    rootHandle = null;
    set({ vfs: SEED, baseline: SEED, tabs: ["/README.md"], active: "/README.md", dirty: {}, source: { kind: "virtual" }, selection: "" });
  },
}));

