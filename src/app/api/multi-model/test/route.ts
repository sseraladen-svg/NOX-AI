import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { testAssignment, type ModelAssignment } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// POST /api/multi-model/test — validates a single model assignment.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as { assignment?: ModelAssignment } | null;
    if (!body?.assignment) {
      return NextResponse.json(
        { ok: false, error: "Missing assignment." },
        { status: 400 }
      );
    }

    const result = await testAssignment(body.assignment);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
