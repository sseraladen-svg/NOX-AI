import { NextRequest, NextResponse } from "next/server";
import { dispatch, type ChatMessage } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// POST /api/multi-model/dispatch
// Body: { messages: ChatMessage[], confirmMultiAgent?: boolean }
//
// Routes a message through the active mode. If the mode is HOST and the host
// detects a multi-agent task, this endpoint returns confirmationRequired=true
// along with a per-model limit summary — unless confirmMultiAgent=true is
// already set, in which case the task runs.
export async function POST(req: NextRequest) {
  try {
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
    const result = await dispatch(body.messages, {
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
