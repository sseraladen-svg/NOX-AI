import { NextRequest, NextResponse } from "next/server";
import { dispatch, saveUsage, type ChatMessage, type FeatureId, type IntentClassification } from "@/lib/multi-model-service";
import { getCurrentUser } from "@/lib/auth";
import { isRateLimited, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

// POST /api/multi-model/dispatch — routes a message through the active mode.
// Body: { messages, confirmMultiAgent?, feature?, conversationId? }
//
// `feature` is sent from the active tab in multi-mode-page.tsx and tells the
// backend which feature's model to use in MULTI mode (instead of guessing from
// keywords). SINGLE and ORCHESTRATOR modes ignore it.
//
// `conversationId` (optional) — if provided, usage records are linked to this
// conversation for the cost dashboard's drill-down.
//
// After a successful dispatch, each step in the trace is saved as a
// UsageRecord row (for cost tracking + the dashboard).
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }

    // Rate limit: 30 dispatches per minute per IP (prevents API abuse).
    const ip = getClientIp(req.headers);
    if (isRateLimited(ip, "dispatch", RATE_LIMITS.DISPATCH.limit, RATE_LIMITS.DISPATCH.windowMs)) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Wait a minute and try again." },
        { status: 429 }
      );
    }
    const body = (await req.json()) as {
      messages: ChatMessage[];
      confirmMultiAgent?: boolean;
      feature?: FeatureId;
      conversationId?: string;
      skipSpecialist?: boolean;
      cachedClassification?: IntentClassification;
    };
    if (!body?.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { ok: false, error: "Missing messages." },
        { status: 400 }
      );
    }
    const result = await dispatch(user.id, body.messages, {
      confirmMultiAgent: body.confirmMultiAgent,
      feature: body.feature,
      skipSpecialist: body.skipSpecialist,
      cachedClassification: body.cachedClassification,
    });

    // Save usage records for cost tracking (only if dispatch produced steps
    // — i.e. it actually ran, not just returned a confirmation request).
    if (result.ok && result.steps.length > 0) {
      try {
        await saveUsage(
          user.id,
          result.steps.map((step) => ({
            conversationId: body.conversationId,
            mode: result.mode,
            role: step.role,
            provider: step.provider,
            model: step.model,
            connectionType: step.connectionType,
            tokens: step.tokens,
            cost: step.cost,
            latencyMs: step.latencyMs,
            retries: step.retries,
            timedOut: step.timedOut,
            error: !!step.lastError,
          }))
        );
      } catch (usageErr) {
        // Usage-save failure shouldn't fail the dispatch — log and continue.
        console.error("[nox] Failed to save usage records:", usageErr);
      }
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
