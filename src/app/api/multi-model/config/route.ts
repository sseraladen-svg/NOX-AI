import { NextRequest, NextResponse } from "next/server";
import {
  getConfig,
  saveConfig,
  type MultiModelConfigDoc,
} from "@/lib/multi-model-service";

export const runtime = "nodejs";

// GET /api/multi-model/config
// Returns the active config. API keys are masked (never plaintext).
export async function GET() {
  try {
    const doc = await getConfig();
    return NextResponse.json({ ok: true, config: doc });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

// PUT /api/multi-model/config
// Saves the config. API keys are encrypted at rest by the service layer.
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { config: MultiModelConfigDoc };
    if (!body?.config || !body.config.mode) {
      return NextResponse.json(
        { ok: false, error: "Missing config or mode." },
        { status: 400 }
      );
    }
    await saveConfig(body.config);
    const fresh = await getConfig();
    return NextResponse.json({ ok: true, config: fresh });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
