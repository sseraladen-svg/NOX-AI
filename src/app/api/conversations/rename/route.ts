import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { renameConversation } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// POST /api/conversations/rename?id=<conversationId>
// Body: { title: string }
export async function POST(req: NextRequest) {
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
    const body = (await req.json()) as { title?: string };
    if (!body.title || !body.title.trim()) {
      return NextResponse.json(
        { ok: false, error: "Missing title." },
        { status: 400 }
      );
    }
    await renameConversation(user.id, id, body.title.trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
