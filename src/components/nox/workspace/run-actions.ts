import { toast } from "sonner";
import { useWorkspace } from "@/store/workspace-store";
import { runJs, type RunHandle } from "@/lib/workspace/run-js";
import { terminalBus } from "@/lib/workspace/terminal-bus";

/** Runs a workspace JS file in the sandbox and prints to the terminal. Returns the handle (for Ctrl+C). */
export function runWorkspaceFile(path: string): RunHandle | null {
  const code = useWorkspace.getState().vfs.files[path];
  if (code === undefined) {
    toast.error(`${path} not found`);
    return null;
  }
  if (!/\.(m?js|cjs)$/i.test(path)) {
    toast.error("Only .js files can run here. Use the Local shell for other languages.");
    return null;
  }
  useWorkspace.setState({ terminalOpen: true });
  terminalBus.emit(`▶ node ${path}`, "info");
  const handle = runJs(code, (t, k) => terminalBus.emit(t, k));
  void handle.done.then(() => terminalBus.emit("■ finished", "info"));
  return handle;
}
