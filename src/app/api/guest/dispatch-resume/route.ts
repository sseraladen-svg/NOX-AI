import { NextRequest, NextResponse } from "next/server";
import { resumeDispatch } from "@/lib/multi-model-service";
import {
  hideGuestUsage,
  GuestRequestTooLargeError,
  isValidGuestBrowserTokens,
  isValidGuestSessionId,
  readGuestJson,
  sanitizeGuestConfig,
} from "@/lib/guest-session";
import { getClientIp, isRateLimited, RATE_LIMITS } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

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
        "guest/dispatch-resume",
        RATE_LIMITS.GUEST.limit,
        RATE_LIMITS.GUEST.windowMs
      )
    ) {
      return NextResponse.json(
        { ok: false, error: "Too many guest requests. Wait a minute and try again." },
        { status: 429 }
      );
    }

    const body = await readGuestJson(req, 1_000_000);
    if (
      !isValidGuestSessionId(body?.guestSessionId) ||
      !isValidGuestSessionId(body?.stepId) ||
      typeof body.resultText !== "string" ||
      body.resultText.length > 20000 ||
      !body.resumeContext ||
      typeof body.resumeContext !== "object" ||
      JSON.stringify(body.resumeContext).length > 100_000
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid guest dispatch continuation." },
        { status: 400 }
      );
    }

    const browserTokens = body.browserTokens;
    if (
      browserTokens !== undefined &&
      !isValidGuestBrowserTokens(browserTokens)
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid guest model usage data." },
        { status: 400 }
      );
    }
    if (
      body.browserLatencyMs !== undefined &&
      (typeof body.browserLatencyMs !== "number" ||
        !Number.isFinite(body.browserLatencyMs) ||
        body.browserLatencyMs < 0 ||
        body.browserLatencyMs > 300_000)
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid guest model response time." },
        { status: 400 }
      );
    }

    const config = sanitizeGuestConfig(body.config);
    const result = await resumeDispatch(
      `guest:${body.guestSessionId}`,
      body.stepId,
      body.resultText,
      body.resumeContext as Record<string, unknown>,
      browserTokens,
      body.browserLatencyMs,
      config
    );
    return NextResponse.json({ ok: true, result: hideGuestUsage(result) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Guest continuation failed.",
      },
      { status: error instanceof GuestRequestTooLargeError ? 413 : 400 }
    );
  }
}
