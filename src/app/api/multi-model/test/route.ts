import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { testAssignment, getConfigInternal, isMaskedApiKey, type ModelAssignment } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// POST /api/multi-model/test - validates a single model assignment.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as { id?: string; assignment?: ModelAssignment } | null;
    if (!body?.assignment) {
      return NextResponse.json(
        { ok: false, error: "Missing assignment." },
        { status: 400 }
      );
    }

    let assignment = body.assignment;

    // If the key is masked, resolve the real key from storage using the role id.
    if (isMaskedApiKey(assignment.apiKey) && body.id) {
      const real = await getConfigInternal(user.id);
      const resolved =
        body.id === "global" ? real.globalConfig :
        body.id === "host" ? real.hostConfig :
        real.featureConfigs?.[body.id] || real.specialistConfigs?.[body.id];

      if (resolved?.apiKey) {
        assignment = { ...assignment, apiKey: resolved.apiKey };
      } else {
        return NextResponse.json({
          ok: true,
          result: { ok: false, status: "error", message: "No saved key found for this role. Please enter your API key." },
        });
      }
    }

    const result = await testAssignment(assignment);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
