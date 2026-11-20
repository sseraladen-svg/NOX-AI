"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEditorState } from "@/store/editor-state-store";
import { type ThemeId, useEditorSettings } from "@/store/editor-settings-store";
import { THEMES } from "@/lib/workspace/themes";

const row = "flex items-center justify-between gap-3 py-1.5 border-b border-border/50 text-sm";
const input = "h-7 rounded bg-muted/30 border border-border px-2 text-xs outline-none";

export function SettingsDialog() {
  const open = useEditorState((s) => s.settingsOpen);
  const setOpen = useEditorState((s) => s.setSettingsOpen);
  const st = useEditorSettings();
  const toggle = (k: "wordWrap" | "minimap" | "bracketColors" | "stickyScroll" | "formatOnSave" | "inlineAI", label: string, hint?: string) => (
    <label key={k} className={row}>
      <span>{label}{hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}</span>
      <input type="checkbox" checked={st[k]} onChange={(e) => st.set({ [k]: e.target.checked })} className="accent-foreground h-4 w-4" />
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editor settings</DialogTitle></DialogHeader>
        <div>
          <label className={row}>Color theme
            <select value={st.theme} onChange={(e) => st.set({ theme: e.target.value as ThemeId })} className={input}>{THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          </label>
          <label className={row}>Font size<input type="number" min={9} max={28} value={st.fontSize} onChange={(e) => st.set({ fontSize: Math.min(28, Math.max(9, Number(e.target.value) || 13)) })} className={`${input} w-16`} /></label>
          <label className={row}>Tab size<input type="number" min={1} max={8} value={st.tabSize} onChange={(e) => st.set({ tabSize: Math.min(8, Math.max(1, Number(e.target.value) || 2)) })} className={`${input} w-16`} /></label>
          <label className={row}>Line numbers
            <select value={st.lineNumbers} onChange={(e) => st.set({ lineNumbers: e.target.value as "on" | "off" | "relative" })} className={input}><option value="on">on</option><option value="relative">relative</option><option value="off">off</option></select>
          </label>
          <label className={row}>Auto save
            <select value={st.autoSave} onChange={(e) => st.set({ autoSave: e.target.value as "off" | "afterDelay" })} className={input}><option value="afterDelay">after 1 second (real folders)</option><option value="off">off (Ctrl+S)</option></select>
          </label>
          {toggle("wordWrap", "Word wrap")}
          {toggle("minimap", "Minimap")}
          {toggle("bracketColors", "Bracket pair colors")}
          {toggle("stickyScroll", "Sticky scroll")}
          {toggle("formatOnSave", "Format on save", "Uses the built-in formatter for JS/TS, JSON, CSS and HTML")}
          {toggle("inlineAI", "AI inline completions (Tab)", "Ghost-text suggestions from your Coding model after you pause typing. Uses tokens each time.")}
        </div>
        <button onClick={st.reset} className="text-xs text-muted-foreground hover:text-foreground underline self-start">Reset to defaults</button>
      </DialogContent>
    </Dialog>
  );
}
