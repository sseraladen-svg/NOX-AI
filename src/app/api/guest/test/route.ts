import { NextRequest, NextResponse } from "next/server";
import { testAssignment } from "@/lib/multi-model-service";
import {
  GuestRequestTooLargeError,
  isValidGuestSessionId,
  readGuestJson,
  sanitizeGuestAssignment,
} from "@/lib/guest-session";
import { getClientIp, isRateLimited, RATE_LIMITS } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    if (await getCurrentUser()) {
      return NextResponse.json(
        { ok: false, error: "Use the signed-in test route for account sessions." },
        { status: 403 }
      );
    }

    const ip = getClientIp(req.headers);
    if (
      isRateLimited(
        ip,
        "guest/test",
        RATE_LIMITS.GUEST.limit,
        RATE_LIMITS.GUEST.windowMs
      )
    ) {
      return NextResponse.json(
        { ok: false, error: "Too many guest tests. Wait a minute and try again." },
        { status: 429 }
      );
    }

    const body = await readGuestJson(req, 32_000);
    if (!isValidGuestSessionId(body?.guestSessionId)) {
      return NextResponse.json(
        { ok: false, error: "A valid guest session is required." },
        { status: 400 }
      );
    }
    const assignment = sanitizeGuestAssignment(body?.assignment);
    if (!assignment) {
      return NextResponse.json(
        { ok: false, error: "A model assignment is required." },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      result: await testAssignment(assignment),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Guest model test failed.",
      },
      { status: error instanceof GuestRequestTooLargeError ? 413 : 400 }
    );
  }
}
