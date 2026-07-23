import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getConfig, saveConfig, type MultiModelConfigDoc } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// GET /api/multi-model/config — returns the active config (masked) for the logged-in user.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }
    const doc = await getConfig(user.id);
    return NextResponse.json({ ok: true, config: doc });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

// PUT /api/multi-model/config — saves the config (encrypts keys at rest).
export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }
    const body = (await req.json()) as { config: MultiModelConfigDoc };
    if (!body?.config || !body.config.mode) {
      return NextResponse.json(
        { ok: false, error: "Missing config or mode." },
        { status: 400 }
      );
    }
    await saveConfig(user.id, body.config);
    const fresh = await getConfig(user.id);
    return NextResponse.json({ ok: true, config: fresh });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
