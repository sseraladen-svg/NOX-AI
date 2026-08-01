import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { addMessage, type DispatchStep, type TokenUsage, type CostBreakdown } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// POST /api/conversations/save-message
// Body: {
//   conversationId: string,
//   role: "user" | "assistant",
//   content: string,
//   trace?: DispatchStep[],
//   mode?: string,
//   multiAgent?: boolean,
//   error?: boolean,
//   usage?: { tokens?: TokenUsage, cost?: CostBreakdown },
// }
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
      conversationId: string;
      role: "user" | "assistant";
      content: string;
      trace?: DispatchStep[];
      mode?: string;
      multiAgent?: boolean;
      error?: boolean;
      usage?: { tokens?: TokenUsage; cost?: CostBreakdown };
    };
    if (!body.conversationId || !body.role || typeof body.content !== "string") {
      return NextResponse.json(
        { ok: false, error: "Missing required fields." },
        { status: 400 }
      );
    }
    await addMessage(user.id, body.conversationId, {
      role: body.role,
      content: body.content,
      trace: body.trace,
      mode: body.mode,
      multiAgent: body.multiAgent,
      error: body.error,
      usage: body.usage,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
