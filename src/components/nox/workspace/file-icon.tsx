import { File, FileCode2, FileJson, FileText, Hash, Terminal, Database } from "lucide-react";
import { cn } from "@/lib/utils";

const MAP: Record<string, [typeof File, string]> = {
  js: [FileCode2, "text-yellow-300"], mjs: [FileCode2, "text-yellow-300"], cjs: [FileCode2, "text-yellow-300"], jsx: [FileCode2, "text-sky-300"],
  ts: [FileCode2, "text-sky-400"], tsx: [FileCode2, "text-sky-300"], json: [FileJson, "text-amber-300"], html: [FileCode2, "text-orange-400"],
  htm: [FileCode2, "text-orange-400"], css: [Hash, "text-blue-400"], scss: [Hash, "text-pink-400"], md: [FileText, "text-slate-300"],
  py: [FileCode2, "text-emerald-300"], sh: [Terminal, "text-green-400"], ps1: [Terminal, "text-blue-300"], sql: [Database, "text-fuchsia-300"],
  yml: [FileText, "text-rose-300"], yaml: [FileText, "text-rose-300"], txt: [FileText, "text-muted-foreground"],
};

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const [Icon, color] = MAP[ext] ?? [File, "text-muted-foreground"];
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", color, className)} />;
}
