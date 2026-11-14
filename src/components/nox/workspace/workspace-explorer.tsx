"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, File as FileIcon, FilePlus, Folder, FolderOpen, FolderPlus, Pencil, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace-store";
import { buildTree, type TreeNode } from "@/lib/workspace/vfs";

const btn = "h-6 w-6 inline-flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition";

function Row({ node, depth, open, toggle }: { node: TreeNode; depth: number; open: Set<string>; toggle: (p: string) => void }) {
  const { active, dirty, openFile, createFile, remove, rename } = useWorkspace(
    useShallow((s) => ({ active: s.active, dirty: s.dirty, openFile: s.openFile, createFile: s.createFile, remove: s.remove, rename: s.rename }))
  );
  const isOpen = open.has(node.path);
  const isDirNode = node.type === "dir";
  return (
    <>
      <div
        className={cn("group flex items-center gap-1 pr-1 h-6 text-xs cursor-pointer rounded-sm hover:bg-muted/50", active === node.path && "bg-muted/70 text-foreground")}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => (isDirNode ? toggle(node.path) : openFile(node.path))}
        title={node.path}
      >
        {isDirNode ? (isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />) : <span className="w-3 shrink-0" />}
        {isDirNode ? <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400/80" /> : <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate flex-1">{node.name}</span>
        {dirty[node.path] && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved" />}
        <span className="hidden group-hover:flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
          {isDirNode && (
            <button className={btn} title="New file here" onClick={() => { const n = window.prompt("File name"); if (n) createFile(`${node.path}/${n}`); }}>
              <FilePlus className="h-3 w-3" />
            </button>
          )}
          <button className={btn} title="Rename" onClick={() => { const n = window.prompt("New path", node.path); if (n && n !== node.path) rename(node.path, n); }}>
            <Pencil className="h-3 w-3" />
          </button>
          <button className={btn} title="Delete" onClick={() => { if (window.confirm(`Delete ${node.path}?`)) remove(node.path); }}>
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      </div>
      {isDirNode && isOpen && node.children?.map((c) => <Row key={c.path} node={c} depth={depth + 1} open={open} toggle={toggle} />)}
    </>
  );
}

export function WorkspaceExplorer() {
  const { vfs, source, dirty, createFile, createDir, openFolder, importFiles, saveAll, resetWorkspace } = useWorkspace(
    useShallow((s) => ({
      vfs: s.vfs, source: s.source, dirty: s.dirty, createFile: s.createFile, createDir: s.createDir, openFolder: s.openFolder,
      importFiles: s.importFiles, saveAll: s.saveAll, resetWorkspace: s.resetWorkspace,
    }))
  );
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const upload = React.useRef<HTMLInputElement>(null);
  const tree = React.useMemo(() => buildTree(vfs), [vfs]);
  const toggle = (p: string) => setOpen((o) => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="h-full flex flex-col min-h-0 bg-card/40">
      <div className="flex items-center justify-between px-2 h-8 border-b border-border shrink-0">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">EXPLORER</span>
        <div className="flex items-center">
          <button className={btn} title="New file" onClick={() => { const n = window.prompt("New file path (e.g. src/app.ts)"); if (n) createFile(n); }}><FilePlus className="h-3.5 w-3.5" /></button>
          <button className={btn} title="New folder" onClick={() => { const n = window.prompt("New folder path"); if (n) createDir(n); }}><FolderPlus className="h-3.5 w-3.5" /></button>
          <button className={btn} title="Open folder from your computer (Chrome / Edge)" onClick={() => void openFolder()}><FolderOpen className="h-3.5 w-3.5" /></button>
          <button className={btn} title="Upload files" onClick={() => upload.current?.click()}><Upload className="h-3.5 w-3.5" /></button>
          {dirtyCount > 0 && <button className={cn(btn, "text-amber-400")} title={`Save ${dirtyCount} file(s) to disk`} onClick={() => void saveAll()}><Save className="h-3.5 w-3.5" /></button>}
        </div>
        <input ref={upload} type="file" multiple hidden onChange={(e) => { if (e.target.files) void importFiles(e.target.files); e.target.value = ""; }} />
      </div>
      <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border truncate shrink-0">
        {source.kind === "folder" ? (
          <span title={source.connected ? "Edits save to this folder on disk" : "Reopen the folder to save to disk"}>
            📁 {source.name} {source.connected ? "· live" : "· disconnected"}
          </span>
        ) : (
          "Virtual workspace · stored in this browser"
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nox-scroll py-1">
        {tree.length === 0 ? <div className="px-3 py-4 text-xs text-muted-foreground">Empty. Create a file or open a folder.</div> : tree.map((n) => <Row key={n.path} node={n} depth={0} open={open} toggle={toggle} />)}
      </div>
      <button
        className="flex items-center gap-1.5 px-2 h-7 text-[10px] text-muted-foreground hover:text-foreground border-t border-border shrink-0"
        onClick={() => { if (window.confirm("Reset the workspace to the starter files? Files in the browser will be lost (a connected folder on disk is not touched).")) resetWorkspace(); }}
      >
        <RotateCcw className="h-3 w-3" /> Reset workspace
      </button>
    </div>
  );
}
