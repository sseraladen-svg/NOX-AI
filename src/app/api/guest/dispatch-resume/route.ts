import { NextRequest, NextResponse } from "next/server";
import { resumeDispatch } from "@/lib/multi-model-service";
import {
  hideGuestUsage,
  isValidGuestSessionId,
  sanitizeGuestConfig,
} from "@/lib/guest-session";
import { getClientIp, isRateLimited, RATE_LIMITS } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    if (await getCurrentUser()) {
      return NextResponse.json(
        { ok: false, error: "Use the signed-in dispatch route for account sessions." },
        { status: 403 }
      );
    }

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > 1_000_000) {
      return NextResponse.json(
        { ok: false, error: "Guest continuations must be smaller than 1 MB." },
        { status: 413 }
      );
    }

    const ip = getClientIp(req.headers);
    if (
      isRateLimited(
        ip,
        "guest/dispatch-resume",
        RATE_LIMITS.DISPATCH.limit,
        RATE_LIMITS.DISPATCH.windowMs
      )
    ) {
      return NextResponse.json(
        { ok: false, error: "Too many guest requests. Wait a minute and try again." },
        { status: 429 }
      );
    }

    const body = await req.json();
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
      (!browserTokens ||
        !["input", "output", "total"].every(
          (key) =>
            Number.isInteger(browserTokens[key]) &&
            browserTokens[key] >= 0 &&
            browserTokens[key] <= 10_000_000
        ))
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid guest model usage data." },
        { status: 400 }
      );
    }
    if (
      body.browserLatencyMs !== undefined &&
      (!Number.isFinite(body.browserLatencyMs) ||
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
      body.resumeContext,
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
      { status: 400 }
    );
  }
}
