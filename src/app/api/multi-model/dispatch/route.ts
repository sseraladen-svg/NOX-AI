import { NextRequest, NextResponse } from "next/server";
import { dispatch, type ChatMessage, type FeatureId } from "@/lib/multi-model-service";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/multi-model/dispatch — routes a message through the active mode.
// Body: { messages, confirmMultiAgent?, feature? }
//
// `feature` is sent from the active tab in multi-mode-page.tsx and tells the
// backend which feature's model to use in MULTI mode (instead of guessing from
// keywords). SINGLE and ORCHESTRATOR modes ignore it.
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
      feature?: FeatureId;
    };
    if (!body?.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { ok: false, error: "Missing messages." },
        { status: 400 }
      );
    }
    const result = await dispatch(user.id, body.messages, {
      confirmMultiAgent: body.confirmMultiAgent,
      feature: body.feature,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
