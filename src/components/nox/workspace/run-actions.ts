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

/** Runs a JS file in the sandbox and resolves with its output (for the agent). Also prints to the terminal. */
export async function runFileCaptured(path: string): Promise<string> {
  const code = useWorkspace.getState().vfs.files[path];
  if (code === undefined) throw new Error("file not found");
  if (!/\.(m?js|cjs)$/i.test(path)) throw new Error("only .js files can run in the sandbox");
  useWorkspace.setState({ terminalOpen: true });
  terminalBus.emit(`▶ node ${path} (agent)`, "info");
  const lines: string[] = [];
  const h = runJs(code, (t, k) => {
    lines.push(k === "err" ? `[error] ${t}` : t);
    terminalBus.emit(t, k);
  });
  await h.done;
  terminalBus.emit("■ finished", "info");
  return lines.join("\n").slice(0, 8000);
}
