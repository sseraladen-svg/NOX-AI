import { NextRequest, NextResponse } from "next/server";
import { dispatch, type ChatMessage } from "@/lib/multi-model-service";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/multi-model/dispatch — routes a message through the active mode.
// If ORCHESTRATOR mode detects a multi-agent task and confirmMultiAgent is not
// set, returns confirmationRequired=true along with the per-model limit summary.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }
    const body = (await req.json()) as {
      messages: ChatMessage[];
      confirmMultiAgent?: boolean;
    };
    if (!body?.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { ok: false, error: "Missing messages." },
        { status: 400 }
      );
    }
    const result = await dispatch(user.id, body.messages, {
      confirmMultiAgent: body.confirmMultiAgent,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
