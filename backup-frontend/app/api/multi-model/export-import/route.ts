import { NextRequest, NextResponse } from "next/server";
import {
  getConfig,
  saveConfig,
  type MultiModelConfigDoc,
} from "@/lib/multi-model-service";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/multi-model/export-import?action=export|import|reset
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
    const action = url.searchParams.get("action") || "import";

    if (action === "export") {
      const config = await getConfig(user.id);
      return NextResponse.json({ ok: true, config });
    }

    if (action === "reset") {
      const blank: MultiModelConfigDoc = { mode: "SINGLE" };
      await saveConfig(user.id, blank);
      return NextResponse.json({ ok: true, config: blank });
    }

    // import
    const body = (await req.json()) as { config: MultiModelConfigDoc };
    if (!body?.config?.mode) {
      return NextResponse.json(
        { ok: false, error: "Missing config." },
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
