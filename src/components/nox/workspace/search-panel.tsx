"use client";

import * as React from "react";
import { CaseSensitive, Regex, Replace, ReplaceAll, WholeWord } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace-store";
import { type SearchOptions, replaceInFiles, searchFiles } from "@/lib/workspace/search";
import { bridge } from "@/lib/workspace/editor-bridge";
import { FileIcon } from "./file-icon";

const tog = (on: boolean) => cn("h-6 w-6 inline-flex items-center justify-center rounded border text-muted-foreground hover:text-foreground", on ? "bg-muted border-foreground/40 text-foreground" : "border-transparent");

export function SearchPanel() {
  const vfs = useWorkspace((s) => s.vfs);
  const commit = useWorkspace((s) => s.commit);
  const [q, setQ] = React.useState("");
  const [rep, setRep] = React.useState("");
  const [cs, setCs] = React.useState(false);
  const [ww, setWw] = React.useState(false);
  const [re, setRe] = React.useState(false);
  const [inc, setInc] = React.useState("");
  const [exc, setExc] = React.useState("");
  const [debounced, setDebounced] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  const opts: SearchOptions = { query: debounced, caseSensitive: cs, wholeWord: ww, regex: re, include: inc, exclude: exc };
  const res = React.useMemo(() => searchFiles(vfs, opts), [vfs, debounced, cs, ww, re, inc, exc]); // eslint-disable-line react-hooks/exhaustive-deps

  const replaceAll = (paths?: string[]) => {
    if (!q) return;
    const n = paths ? res.results.filter((r) => paths.includes(r.path)).reduce((a, r) => a + r.matches.length, 0) : res.total;
    if (!window.confirm(`Replace ${n} occurrence(s) of "${q}" with "${rep}"${paths ? " in this file" : ` in ${res.results.length} file(s)`}?`)) return;
    const out = replaceInFiles(vfs, opts, rep, paths);
    if (out.count) {
      commit(out.vfs);
      toast.success(`Replaced ${out.count} occurrence(s) in ${out.files.length} file(s)`);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0 bg-card/40">
      <div className="px-2 h-8 flex items-center border-b border-border shrink-0">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">SEARCH</span>
      </div>
      <div className="p-2 space-y-1.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="flex-1 min-w-0 h-7 rounded bg-muted/30 border border-border px-2 text-xs outline-none focus:ring-1 focus:ring-foreground/30" />
          <button className={tog(cs)} title="Match case" onClick={() => setCs(!cs)}><CaseSensitive className="h-3.5 w-3.5" /></button>
          <button className={tog(ww)} title="Whole word" onClick={() => setWw(!ww)}><WholeWord className="h-3.5 w-3.5" /></button>
          <button className={tog(re)} title="Regular expression" onClick={() => setRe(!re)}><Regex className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex items-center gap-1">
          <input value={rep} onChange={(e) => setRep(e.target.value)} placeholder="Replace" className="flex-1 min-w-0 h-7 rounded bg-muted/30 border border-border px-2 text-xs outline-none focus:ring-1 focus:ring-foreground/30" />
          <button className={tog(false)} title="Replace all" disabled={!res.total} onClick={() => replaceAll()}><ReplaceAll className="h-3.5 w-3.5" /></button>
        </div>
        <input value={inc} onChange={(e) => setInc(e.target.value)} placeholder="files to include (*.js, src/**)" className="w-full h-6 rounded bg-muted/20 border border-border px-2 text-[11px] outline-none" />
        <input value={exc} onChange={(e) => setExc(e.target.value)} placeholder="files to exclude" className="w-full h-6 rounded bg-muted/20 border border-border px-2 text-[11px] outline-none" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nox-scroll text-xs">
        {res.error && <div className="p-3 text-red-400">{res.error}</div>}
        {debounced && !res.error && <div className="px-3 py-1.5 text-muted-foreground">{res.total} result{res.total === 1 ? "" : "s"} in {res.results.length} file{res.results.length === 1 ? "" : "s"}{res.truncated ? " (truncated)" : ""}</div>}
        {res.results.map((f) => (
          <div key={f.path}>
            <div className="group flex items-center gap-1.5 px-2 py-1 bg-muted/20 sticky top-0">
              <FileIcon path={f.path} />
              <span className="truncate flex-1 font-medium" title={f.path}>{f.path}</span>
              <span className="text-[10px] text-muted-foreground">{f.matches.length}</span>
              <button className="hidden group-hover:inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted" title="Replace in this file" onClick={() => replaceAll([f.path])}><Replace className="h-3 w-3" /></button>
            </div>
            {f.matches.map((m, i) => {
              const lead = m.text.length - m.text.trimStart().length;
              return (
                <button key={i} onClick={() => bridge.reveal(f.path, m.line, m.start + 1)} className="w-full text-left px-3 py-0.5 font-mono text-[11px] hover:bg-muted/50 truncate">
                  <span className="text-muted-foreground mr-2">{m.line}</span>
                  {m.text.slice(lead, m.start)}<mark className="bg-amber-500/40 text-foreground rounded-sm">{m.text.slice(m.start, m.end)}</mark>{m.text.slice(m.end)}
                </button>
              );
            })}
          </div>
        ))}
        {!debounced && <div className="p-3 text-muted-foreground">Type to search all files in the workspace.</div>}
      </div>
    </div>
  );
}
