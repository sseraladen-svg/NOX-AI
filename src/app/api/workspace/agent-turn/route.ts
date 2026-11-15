import { NextRequest } from "next/server";
import { agentComplete } from "@/lib/multi-model-service";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROLES = new Set(["host", "planning", "coding", "vision", "automation", "engineering"]);
const MAX_MESSAGES = 60;
const MAX_CHARS = 150_000;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in to use API models in the agent." }, { status: 401 });
  if (await isRateLimited(getClientIp(req.headers), "agent-turn", 120, 60_000)) {
    return Response.json({ ok: false, error: "Too many requests. Slow down." }, { status: 429 });
  }
  let body: { role?: unknown; system?: unknown; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const role = typeof body.role === "string" ? body.role : "";
  const system = typeof body.system === "string" ? body.system : "";
  const raw = Array.isArray(body.messages) ? body.messages : [];
  if (!ROLES.has(role) || !system || system.length > 30_000 || raw.length === 0 || raw.length > MAX_MESSAGES) {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const messages = raw.map((m) => ({
    role: (m as { role?: string }).role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: String((m as { content?: unknown }).content ?? ""),
  }));
  if (messages.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) {
    return Response.json({ ok: false, error: "Conversation too large." }, { status: 413 });
  }
  try {
    const r = await agentComplete(user.id, role as Parameters<typeof agentComplete>[1], system, messages);
    return Response.json({ ok: true, text: r.text, tokens: r.tokens, provider: r.provider, model: r.model });
  } catch (e) {
    logger.error("agent-turn failed", e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
