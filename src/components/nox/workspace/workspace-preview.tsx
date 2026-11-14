"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/store/workspace-store";
import { inlineAssets } from "@/lib/workspace/preview";
import { parentOf } from "@/lib/workspace/vfs";

/** Sandboxed HTML preview: scripts run, but with no access to the app's cookies or storage. */
export function WorkspacePreview({ path, onClose }: { path: string | null; onClose: () => void }) {
  const vfs = useWorkspace((s) => s.vfs);
  const html = React.useMemo(
    () => (path && path in vfs.files ? inlineAssets(vfs.files[path], vfs, parentOf(path)) : ""),
    [path, vfs]
  );
  return (
    <Dialog open={!!path} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl w-[95vw] h-[80vh] flex flex-col gap-2 p-3">
        <DialogHeader>
          <DialogTitle className="text-sm font-mono">{path} — preview</DialogTitle>
        </DialogHeader>
        <iframe title="Preview" sandbox="allow-scripts allow-forms allow-modals" srcDoc={html} className="flex-1 w-full rounded-md border border-border bg-white" />
      </DialogContent>
    </Dialog>
  );
}
