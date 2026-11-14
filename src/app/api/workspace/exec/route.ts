import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { statSync } from "fs";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// LOCAL SHELL. Runs commands as the user running the server, so it is opt-in and never
// available on hosted deployments: needs NOX_LOCAL_TERMINAL=1, a signed-in user, a
// localhost Host header, and no VERCEL environment.
const MAX_OUTPUT = 1_000_000;
const TIMEOUT_MS = 120_000;
const HIDDEN_ENV = ["AUTH_SECRET", "NOX_AI_SECRET", "DATABASE_URL", "POSTGRES_URL", "ELEVENLABS_API_KEY"];

const root = () => path.resolve(process.env.NOX_WORKSPACE_ROOT || process.cwd());

function gate(req: NextRequest): string | null {
  if (process.env.VERCEL) return "Local shell is disabled on hosted deployments.";
  if (process.env.NOX_LOCAL_TERMINAL !== "1") return "Set NOX_LOCAL_TERMINAL=1 in .env and run the app on your own machine to enable it.";
  const host = (req.headers.get("host") || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) return "Local shell only accepts requests addressed to localhost.";
  return null;
}

function resolveInside(rel: string): string | null {
  const full = path.resolve(root(), rel || ".");
  const r = root();
  return full === r || full.startsWith(r + path.sep) ? full : null;
}

const toRel = (abs: string) => path.relative(root(), abs).split(path.sep).join("/");

function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    /* already exited */
  }
}

export async function GET(req: NextRequest) {
  const blocked = gate(req);
  const user = blocked ? null : await getCurrentUser();
  if (blocked || !user) {
    return Response.json({ enabled: false, reason: blocked ?? "Sign in to use the local shell." });
  }
  return Response.json({ enabled: true, root: path.basename(root()), platform: process.platform });
}

export async function POST(req: NextRequest) {
  const blocked = gate(req);
  if (blocked) return Response.json({ ok: false, error: blocked }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (await isRateLimited(getClientIp(req.headers), "exec", 60, 60_000)) {
    return Response.json({ ok: false, error: "Too many commands. Slow down." }, { status: 429 });
  }

  let body: { command?: unknown; cwd?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const command = typeof body.command === "string" ? body.command.trim() : "";
  const relCwd = typeof body.cwd === "string" ? body.cwd : "";
  if (!command || command.length > 4000) return Response.json({ ok: false, error: "Command must be 1-4000 characters." }, { status: 400 });
  const cwd = resolveInside(relCwd);
  if (!cwd) return Response.json({ ok: false, error: "Working directory is outside the workspace root." }, { status: 400 });

  const enc = new TextEncoder();
  const line = (o: unknown) => enc.encode(JSON.stringify(o) + "\n");
  const headers = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" };

  // `cd` is handled here so the working directory persists between requests.
  const cd = /^cd(?:\s+(.+))?$/.exec(command);
  if (cd) {
    const target = resolveInside(path.join(relCwd, (cd[1] ?? "").replace(/^["']|["']$/g, "")));
    let ok = false;
    try {
      ok = !!target && statSync(target).isDirectory();
    } catch {
      ok = false;
    }
    const events = ok ? [{ t: "cwd", d: toRel(target!) }, { t: "exit", code: 0 }] : [{ t: "err", d: "cd: no such directory inside the workspace\n" }, { t: "exit", code: 1 }];
    return new Response(events.map((e) => new TextDecoder().decode(line(e))).join(""), { headers });
  }

  const env = { ...process.env };
  for (const k of HIDDEN_ENV) delete env[k];

  let childPid: number | undefined;
  const stream = new ReadableStream({
    // Client disconnected (tab closed, Ctrl+C): stop the command.
    cancel() {
      killTree(childPid);
    },
    start(controller) {
      let bytes = 0;
      let closed = false;
      const child = spawn(command, { shell: true, cwd, env, windowsHide: true, detached: process.platform !== "win32" });
      childPid = child.pid;
      const finish = (code: number | null) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        try {
          controller.enqueue(line({ t: "exit", code: code ?? 1 }));
          controller.close();
        } catch {
          /* client went away */
        }
      };
      const send = (t: "out" | "err", d: Buffer) => {
        bytes += d.length;
        if (bytes > MAX_OUTPUT) {
          killTree(child.pid);
          controller.enqueue(line({ t: "err", d: "\n[output limit reached, command stopped]\n" }));
          return;
        }
        if (!closed) controller.enqueue(line({ t, d: d.toString("utf8") }));
      };
      child.stdout.on("data", (d: Buffer) => send("out", d));
      child.stderr.on("data", (d: Buffer) => send("err", d));
      child.on("error", (e) => {
        controller.enqueue(line({ t: "err", d: `${e.message}\n` }));
        finish(1);
      });
      child.on("close", finish);
      const timer = setTimeout(() => {
        killTree(child.pid);
        controller.enqueue(line({ t: "err", d: "\n[timed out after 120s]\n" }));
      }, TIMEOUT_MS);
      req.signal.addEventListener("abort", () => {
        killTree(child.pid);
        finish(130);
      });
      logger.info("local shell command", { user: user.id, cwd: toRel(cwd) || ".", length: command.length });
    },
  });
  return new Response(stream, { headers });
}
