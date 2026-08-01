import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listConversations } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// GET /api/conversations/list
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }
    const items = await listConversations(user.id);
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
