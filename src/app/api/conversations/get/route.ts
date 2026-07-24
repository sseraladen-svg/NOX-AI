import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getConversation } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// GET /api/conversations/get?id=<conversationId>
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing id." },
        { status: 400 }
      );
    }
    const item = await getConversation(user.id, id);
    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Conversation not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
