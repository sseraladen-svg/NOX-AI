import { NextRequest, NextResponse } from "next/server";
import {
  checkLimits,
  getConfigInternal,
  type ModelAssignment,
} from "@/lib/multi-model-service";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/multi-model/limits — per-model limit summary for the active mode.
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }
    const body = (await req.json().catch(() => ({}))) as {
      taskSize?: "small" | "medium" | "large";
    };
    const taskSize = body.taskSize || "medium";
    const doc = await getConfigInternal(user.id);

    const assignments: {
      id: string;
      label: string;
      assignment: ModelAssignment;
    }[] = [];

    if (doc.mode === "SINGLE") {
      if (doc.globalConfig) {
        assignments.push({
          id: "global",
          label: "Single Model",
          assignment: doc.globalConfig,
        });
      }
    } else if (doc.mode === "MULTI") {
      for (const [id, a] of Object.entries(doc.featureConfigs || {})) {
        if (a) assignments.push({ id, label: id, assignment: a });
      }
    } else {
      // ORCHESTRATOR
      if (doc.hostConfig) {
        assignments.push({
          id: "host",
          label: "Host",
          assignment: doc.hostConfig,
        });
      }
      for (const [id, a] of Object.entries(doc.specialistConfigs || {})) {
        if (a) assignments.push({ id, label: id, assignment: a });
      }
    }

    const limits = await checkLimits(user.id, assignments, taskSize);
    return NextResponse.json({ ok: true, limits, mode: doc.mode });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
