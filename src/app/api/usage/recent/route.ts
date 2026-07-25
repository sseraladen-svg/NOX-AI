import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRecentUsage } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// GET /api/usage/recent?limit=50
// Returns the most recent usage records for the logged-in user.
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
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const records = await getRecentUsage(user.id, isNaN(limit) ? 50 : limit);
    return NextResponse.json({ ok: true, records });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
