import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resumeDispatch, saveUsage } from "@/lib/multi-model-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as {
      stepId?: string;
      resultText?: string;
      resumeContext?: Record<string, unknown>;
      browserTokens?: { input: number; output: number; total: number };
      browserLatencyMs?: number;
      approveHighImpact?: boolean;
      approvalId?: string;
    };

    if (!body?.stepId || typeof body.resultText !== "string") {
      return NextResponse.json({ ok: false, error: "Missing stepId or resultText." }, { status: 400 });
    }

    const result = await resumeDispatch(
      user.id,
      body.stepId,
      body.resultText,
      body.resumeContext,
      body.browserTokens,
      body.browserLatencyMs
    );

    if (result.ok && result.steps.length > 0) {
      try {
        await saveUsage(
          user.id,
          result.steps.map((step) => ({
            conversationId: undefined,
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
      } catch {
        // ignore usage errors for browser-executed local Ollama results
      }
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
