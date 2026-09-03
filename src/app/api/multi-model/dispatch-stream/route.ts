import { NextRequest } from "next/server";
import { dispatch, saveUsage, type ChatMessage, type FeatureId, type IntentClassification } from "@/lib/multi-model-service";
import { getCurrentUser } from "@/lib/auth";
import { isRateLimited, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

// POST /api/multi-model/dispatch-stream
//
// Same as /api/multi-model/dispatch but returns the result as a Server-Sent
// Events stream so the frontend can show the response progressively.
//
// SSE format:
//   data: {"type":"thinking","mode":"SINGLE"}\n\n
//   data: {"type":"step","step":{...}}\n\n
//   data: {"type":"done","result":{...}}\n\n
//   data: {"type":"error","error":"..."}\n\n
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Not authenticated." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const ip = getClientIp(req.headers);
    if (isRateLimited(ip, "dispatch", RATE_LIMITS.DISPATCH.limit, RATE_LIMITS.DISPATCH.windowMs)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Too many requests." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
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
      return new Response(
        JSON.stringify({ ok: false, error: "Missing messages." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create a ReadableStream for SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // Send "thinking" event so the UI shows a spinner
          send({ type: "thinking" });

          const result = await dispatch(user.id, body.messages, {
            confirmMultiAgent: body.confirmMultiAgent,
            feature: body.feature,
            skipSpecialist: body.skipSpecialist,
            cachedClassification: body.cachedClassification,
            onChunk: (role, text) => send({ type: "chunk", text, role }),
          });

          if (result.pendingClientExec) {
            send({ type: "pendingClientExec", pendingClientExec: result.pendingClientExec });
            controller.close();
            return;
          }

          // If confirmation is required, send that
          if (result.confirmationRequired) {
            send({
              type: "confirmationRequired",
              limits: result.limits,
              classification: result.classification,
            });
            controller.close();
            return;
          }

          // If there's an error, send it
          if (result.error) {
            send({ type: "error", error: result.error });
            controller.close();
            return;
          }

          // Send each step's output progressively
          for (const step of result.steps) {
            send({ type: "step", step });
            const alreadyStreamed = step.provider === "gemini";
            if (!alreadyStreamed && step.output && step.output.length > 0) {
              send({ type: "chunk", text: step.output, role: step.role });
            }
          }

          // Save usage records
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
            } catch {
              // ignore usage save errors
            }
          }

          // Send the final result
          send({ type: "done", result });
          controller.close();
        } catch (err) {
          send({ type: "error", error: (err as Error).message });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
