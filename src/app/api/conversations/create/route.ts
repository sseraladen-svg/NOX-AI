import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createConversation, type Mode } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// POST /api/conversations/create
// Body: { mode?: Mode, title?: string }
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }
    const body = (await req.json().catch(() => ({}))) as {
      mode?: Mode;
      title?: string;
    };
    const item = await createConversation(
      user.id,
      body.mode || "SINGLE",
      body.title || "New conversation"
    );
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
