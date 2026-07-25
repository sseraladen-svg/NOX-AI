import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUsageSummary } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// GET /api/usage/summary?days=30
// Returns aggregated cost + token usage for the logged-in user.
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
    const days = parseInt(url.searchParams.get("days") || "30", 10);
    const summary = await getUsageSummary(user.id, isNaN(days) ? 30 : days);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
