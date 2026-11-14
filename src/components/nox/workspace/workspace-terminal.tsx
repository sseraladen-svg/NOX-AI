"use client";

import * as React from "react";
import "@xterm/xterm/css/xterm.css";
import { useTheme } from "next-themes";
import { Eraser, TerminalSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace-store";
import { runCommand } from "@/lib/workspace/shell";
import { terminalBus } from "@/lib/workspace/terminal-bus";
import { type RunHandle } from "@/lib/workspace/run-js";
import { runWorkspaceFile } from "./run-actions";

type Mode = "virtual" | "local";
type Info = { enabled: boolean; reason?: string; root?: string };

const C = { green: "\x1b[32m", blue: "\x1b[34m", magenta: "\x1b[35m", red: "\x1b[31m", gray: "\x1b[90m", reset: "\x1b[0m" };

export function WorkspaceTerminal() {
  const { resolvedTheme } = useTheme();
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [mode, setMode] = React.useState<Mode>("virtual");
  const [info, setInfo] = React.useState<Info>({ enabled: false, reason: "Checking…" });
  const api = React.useRef<{ clear: () => void; setMode: (m: Mode) => void } | null>(null);

  React.useEffect(() => {
    fetch("/api/workspace/exec")
      .then((r) => r.json())
      .then((j: Info) => setInfo(j))
      .catch(() => setInfo({ enabled: false, reason: "Local shell unavailable." }));
  }, []);

  React.useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !hostRef.current) return;
      const dark = resolvedTheme !== "light";
      const term = new Terminal({
        convertEol: true, fontSize: 12, cursorBlink: true, scrollback: 3000, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        theme: dark ? { background: "#0d0b14", foreground: "#e5e5e5" } : { background: "#fafafa", foreground: "#1a1a1a", cursor: "#1a1a1a", selectionBackground: "#cde" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      const doFit = () => { try { fit.fit(); } catch { /* hidden */ } };
      doFit();
      const ro = new ResizeObserver(doFit);
      ro.observe(hostRef.current);

      let modeNow: Mode = "virtual";
      let vcwd = "/";
      let lcwd = "";
      let buf = "";
      let busy = false;
      let stop: (() => void) | null = null;
      const history: string[] = [];
      let hIdx = 0;

      const prompt = () =>
        modeNow === "virtual" ? `${C.green}nox${C.reset}:${C.blue}${vcwd}${C.reset}$ ` : `${C.magenta}local${C.reset}:${C.blue}/${lcwd}${C.reset}$ `;
      const showPrompt = () => term.write(`\r\n${prompt()}`);
      const color = (t: string, k: "out" | "err" | "info") => (k === "err" ? C.red + t + C.reset : k === "info" ? C.gray + t + C.reset : t);
      // Print text that arrives while the user may be mid-line, then redraw the prompt + typed text.
      const printAsync = (t: string, k: "out" | "err" | "info") => {
        term.write(`\r\x1b[K${color(t, k)}\r\n${busy ? "" : prompt() + buf}`);
      };

      term.writeln(`${C.gray}NOX terminal. Virtual shell works on the workspace files; type 'help'.${C.reset}`);
      term.write(prompt());

      const unsub = terminalBus.subscribe((l) => printAsync(l.text, l.kind));

      async function runLocal(line: string) {
        busy = true;
        const ctl = new AbortController();
        stop = () => ctl.abort();
        try {
          const res = await fetch("/api/workspace/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: line, cwd: lcwd }), signal: ctl.signal });
          if (!res.ok || !res.body) {
            const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            term.write(color(`\r\n${j.error ?? "Failed"}`, "err"));
          } else {
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let carry = "";
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              carry += dec.decode(value, { stream: true });
              const lines = carry.split("\n");
              carry = lines.pop() ?? "";
              for (const raw of lines) {
                if (!raw) continue;
                const e = JSON.parse(raw) as { t: string; d?: string; code?: number };
                if (e.t === "out") term.write(e.d ?? "");
                else if (e.t === "err") term.write(color(e.d ?? "", "err"));
                else if (e.t === "cwd") lcwd = e.d ?? "";
                else if (e.t === "exit" && e.code) term.write(`${C.gray}[exit ${e.code}]${C.reset}`);
              }
            }
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") term.write(`${C.gray}^C${C.reset}`);
          else term.write(color(`\r\n${(e as Error).message}`, "err"));
        }
        busy = false;
        stop = null;
        showPrompt();
      }

      function submit(line: string) {
        const ws = useWorkspace.getState();
        if (line.trim()) { history.push(line); hIdx = history.length; }
        if (!line.trim()) return showPrompt();
        if (modeNow === "local") { void runLocal(line); return; }
        const r = runCommand(ws.vfs, vcwd, line);
        if (r.state !== ws.vfs) ws.commit(r.state);
        vcwd = r.cwd;
        if (r.clear) term.clear();
        if (r.out) term.write(`\r\n${r.out}`);
        if (r.open) ws.openFile(r.open);
        if (r.run) {
          busy = true;
          const h: RunHandle | null = runWorkspaceFile(r.run);
          if (!h) { busy = false; return showPrompt(); }
          stop = () => h.stop();
          void h.done.then(() => { busy = false; stop = null; showPrompt(); });
          return;
        }
        showPrompt();
      }

      const dataSub = term.onData((data) => {
        if (busy) { if (data === "\x03") stop?.(); return; }
        if (data === "\x1b[A" || data === "\x1b[B") {
          hIdx = Math.max(0, Math.min(history.length, hIdx + (data === "\x1b[A" ? -1 : 1)));
          buf = history[hIdx] ?? "";
          term.write(`\r\x1b[K${prompt()}${buf}`);
          return;
        }
        if (data.startsWith("\x1b")) return;
        for (const ch of data) {
          if (ch === "\r") { const l = buf; buf = ""; term.write("\r\n"); submit(l); }
          else if (ch === "\x7f") { if (buf) { buf = buf.slice(0, -1); term.write("\b \b"); } }
          else if (ch === "\x03") { buf = ""; term.write("^C"); showPrompt(); }
          else if (ch === "\x0c") { term.clear(); term.write(`\r${prompt()}${buf}`); }
          else if (ch >= " ") { buf += ch; term.write(ch); }
        }
      });

      api.current = {
        clear: () => { term.clear(); term.write(`\r${prompt()}${buf}`); },
        setMode: (m) => { modeNow = m; term.write(`\r\n${C.gray}— ${m === "virtual" ? "Virtual shell (workspace files)" : "Local shell (real commands on your machine)"} —${C.reset}`); showPrompt(); },
      };
      cleanup = () => { unsub(); dataSub.dispose(); ro.disconnect(); stop?.(); term.dispose(); api.current = null; };
    })();
    return () => { disposed = true; cleanup(); };
    // Terminal is created once; theme changes apply on next mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchMode = (m: Mode) => {
    if (m === "local" && !info.enabled) return;
    setMode(m);
    api.current?.setMode(m);
  };

  return (
    <div className="h-full flex flex-col min-h-0 bg-card/40">
      <div className="flex items-center gap-1 px-2 h-7 border-b border-border shrink-0">
        <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground mr-2">TERMINAL</span>
        {(["virtual", "local"] as const).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            disabled={m === "local" && !info.enabled}
            title={m === "local" ? (info.enabled ? `Real shell in ${info.root ?? "workspace root"}` : info.reason) : "Commands over the workspace files"}
            className={cn("h-5 px-2 rounded text-[10px] transition", mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground")}
          >
            {m === "virtual" ? "Virtual" : "Local shell"}
          </button>
        ))}
        <button className="ml-auto h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60" title="Clear" onClick={() => api.current?.clear()}>
          <Eraser className="h-3 w-3" />
        </button>
      </div>
      <div ref={hostRef} className="flex-1 min-h-0 px-2 py-1 overflow-hidden" />
    </div>
  );
}
