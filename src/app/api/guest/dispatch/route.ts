import { NextRequest, NextResponse } from "next/server";
import { dispatch } from "@/lib/multi-model-service";
import type { FeatureId, IntentClassification } from "@/lib/multi-model-types";
import {
  hideGuestUsage,
  isValidGuestSessionId,
  GuestRequestTooLargeError,
  readGuestJson,
  sanitizeGuestConfig,
  validateGuestMessages,
} from "@/lib/guest-session";
import { getClientIp, isRateLimited, RATE_LIMITS } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;
const FEATURES = new Set([
  "chat",
  "voice",
  "vision",
  "coding",
  "automation",
  "robotics",
]);

export async function POST(req: NextRequest) {
  try {
    if (await getCurrentUser()) {
      return NextResponse.json(
        { ok: false, error: "Use the signed-in dispatch route for account sessions." },
        { status: 403 }
      );
    }

    const ip = getClientIp(req.headers);
    if (
      await isRateLimited(
        ip,
        "guest/dispatch",
        RATE_LIMITS.GUEST.limit,
        RATE_LIMITS.GUEST.windowMs
      )
    ) {
      return NextResponse.json(
        { ok: false, error: "Too many guest requests. Wait a minute and try again." },
        { status: 429 }
      );
    }

    const body = await readGuestJson(req, 10_000_000);
    if (!isValidGuestSessionId(body?.guestSessionId)) {
      return NextResponse.json(
        { ok: false, error: "A valid guest session is required." },
        { status: 400 }
      );
    }
    if (!validateGuestMessages(body.messages)) {
      return NextResponse.json(
        { ok: false, error: "Guest requests must include valid, bounded messages." },
        { status: 400 }
      );
    }
    if (
      body.feature !== undefined &&
      (typeof body.feature !== "string" || !FEATURES.has(body.feature))
    ) {
      return NextResponse.json(
        { ok: false, error: "The requested guest feature is invalid." },
        { status: 400 }
      );
    }

    const feature =
      typeof body.feature === "string"
        ? (body.feature as FeatureId)
        : undefined;
    const config = sanitizeGuestConfig(body.config, feature);
    const result = await dispatch(
      `guest:${body.guestSessionId}`,
      body.messages,
      {
        config,
        skipLimits: true,
        confirmMultiAgent: body.confirmMultiAgent === true,
        approveHighImpact: body.approveHighImpact === true,
        approvalId:
          typeof body.approvalId === "string" ? body.approvalId : undefined,
        feature,
        skipSpecialist: body.skipSpecialist === true,
        cachedClassification:
          body.cachedClassification as IntentClassification | undefined,
      }
    );

    return NextResponse.json({ ok: true, result: hideGuestUsage(result) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Guest request failed.",
      },
      { status: error instanceof GuestRequestTooLargeError ? 413 : 400 }
    );
  }
}
