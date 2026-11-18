"use client";

import * as React from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useEditorState } from "@/store/editor-state-store";
import { bridge } from "@/lib/workspace/editor-bridge";
import { requestEdit } from "@/lib/workspace/inline-ai";

/** Cursor-style Ctrl+K: describe a change, the Coding model rewrites the selection in place (Ctrl+Z undoes it). */
export function InlineEditBar() {
  const open = useEditorState((s) => s.inlineEditOpen);
  const setOpen = useEditorState((s) => s.setInlineEditOpen);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const ctl = React.useRef<AbortController | null>(null);
  const ed = bridge.editor;
  const sel = open ? ed?.getSelection() : null;
  const hasSel = !!sel && !sel.isEmpty();
  const lines = hasSel ? sel!.endLineNumber - sel!.startLineNumber + 1 : ed?.getModel()?.getLineCount() ?? 0;

  React.useEffect(() => {
    if (open) setText("");
    else ctl.current?.abort();
  }, [open]);

  if (!open || !ed) return null;

  const run = async () => {
    const model = ed.getModel();
    if (!model || !text.trim() || busy) return;
    const range = hasSel ? sel! : model.getFullModelRange();
    if (!hasSel && lines > 200) { toast.error("Select the code to change first (the file is long)."); return; }
    setBusy(true);
    ctl.current = new AbortController();
    try {
      const out = await requestEdit(text.trim(), model.getValueInRange(range), model.getLanguageId(), ctl.current.signal);
      if (!out) throw new Error("The model returned nothing.");
      ed.pushUndoStop();
      ed.executeEdits("nox-inline-ai", [{ range, text: out, forceMoveMarkers: true }]);
      ed.pushUndoStop();
      toast.success("Applied. Press Ctrl+Z to undo.");
      setOpen(false);
      ed.focus();
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute z-20 top-2 left-1/2 -translate-x-1/2 w-[min(560px,92%)] rounded-lg border border-border bg-card shadow-xl flex items-center gap-2 px-3 py-2">
      <Sparkles className="h-4 w-4 text-fuchsia-400 shrink-0" />
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void run(); else if (e.key === "Escape") { setOpen(false); ed.focus(); } }}
        placeholder={hasSel ? `Edit ${lines} selected line${lines > 1 ? "s" : ""}… (Enter)` : "Edit the whole file… (Enter)"}
        className="flex-1 min-w-0 bg-transparent text-sm outline-none"
        disabled={busy}
      />
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>}
    </div>
  );
}
