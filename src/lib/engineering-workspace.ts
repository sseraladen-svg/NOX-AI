import "server-only";

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";
import type { VerificationResult } from "@/lib/multi-model-types";

const execFileAsync = promisify(execFile);
const IGNORED = new Set([".git", ".next", "node_modules", "dist", "build", "coverage"]);
const MAX_FILES = 250;
const MAX_READ_BYTES = 30_000;
const MAX_OUTPUT = 8_000;

function workspaceRoot(): string {
  return process.cwd();
}

function safePath(filePath: string): string | null {
  const root = resolve(workspaceRoot());
  const target = resolve(root, filePath);
  return target === root || target.startsWith(`${root}\\`) || target.startsWith(`${root}/`) ? target : null;
}

function walk(dir: string, output: string[]): void {
  if (output.length >= MAX_FILES) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else output.push(relative(workspaceRoot(), full));
    if (output.length >= MAX_FILES) return;
  }
}

export function listWorkspaceFiles(): string[] {
  const files: string[] = [];
  walk(workspaceRoot(), files);
  return files;
}

export function searchWorkspace(query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return listWorkspaceFiles().filter((file) => {
    const full = safePath(file);
    if (!full) return false;
    try {
      return readFileSync(full, "utf8").toLowerCase().includes(needle);
    } catch {
      return false;
    }
  }).slice(0, 30);
}

export function readWorkspaceFiles(files: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of files.slice(0, 8)) {
    const full = safePath(file);
    if (!full || !existsSync(full) || !statSync(full).isFile()) continue;
    try {
      result[file] = readFileSync(full, "utf8").slice(0, MAX_READ_BYTES);
    } catch {
      // A file can disappear between listing and reading; omit it from context.
    }
  }
  return result;
}

export function extractRequestedFiles(prompt: string): string[] {
  const candidates = prompt.match(/(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|json|css|md|prisma)/g) || [];
  return [...new Set(candidates)].filter((file) => Boolean(safePath(file))).slice(0, 8);
}

export async function runEngineeringVerification(): Promise<VerificationResult[]> {
  const commands = [
    { command: "npx tsc --noEmit", executable: "npx", args: ["tsc", "--noEmit"] },
    { command: "npm run lint", executable: "npm", args: ["run", "lint"] },
    { command: "npm run build", executable: "npm", args: ["run", "build"] },
  ];
  const results: VerificationResult[] = [];
  for (const item of commands) {
    let finalResult: VerificationResult | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const started = Date.now();
      try {
        const executable = process.platform === "win32" ? `${item.executable}.cmd` : item.executable;
        const result = await execFileAsync(executable, item.args, {
          cwd: workspaceRoot(),
          timeout: 180_000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        });
        finalResult = { command: item.command, ok: true, output: `Attempt ${attempt}\n${result.stdout}${result.stderr}`.slice(-MAX_OUTPUT), durationMs: Date.now() - started };
        break;
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; message?: string };
        finalResult = { command: item.command, ok: false, output: `Attempt ${attempt}\n${failure.stdout || ""}${failure.stderr || failure.message || ""}`.slice(-MAX_OUTPUT), durationMs: Date.now() - started };
      }
    }
    if (finalResult) results.push(finalResult);
  }
  return results;
}

export function applyApprovedPatches(
  patches: Array<{ path?: unknown; content?: unknown }>
): string[] {
  const changed: string[] = [];
  for (const patch of patches.slice(0, 20)) {
    if (typeof patch.path !== "string" || typeof patch.content !== "string") continue;
    const target = safePath(patch.path);
    if (!target || target === workspaceRoot()) throw new Error(`Unsafe engineering patch path: ${patch.path}`);
    writeFileSync(target, patch.content, "utf8");
    changed.push(relative(workspaceRoot(), target));
  }
  return changed;
}

export function buildEngineeringContext(prompt: string): string {
  const requested = extractRequestedFiles(prompt);
  const matches = searchWorkspace(prompt.split(/\s+/).filter((word) => word.length > 4)[0] || "");
  const files = [...new Set([...requested, ...matches])];
  const contents = readWorkspaceFiles(files);
  return [
    "ENGINEERING WORKSPACE (read-only inspection before approval)",
    `Repository root: ${workspaceRoot()}`,
    `Files: ${listWorkspaceFiles().slice(0, 80).join(", ")}`,
    `Relevant files: ${Object.keys(contents).join(", ") || "(none found)"}`,
    ...Object.entries(contents).map(([file, content]) => `--- ${file} ---\n${content}`),
  ].join("\n");
}
