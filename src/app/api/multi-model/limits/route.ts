import { NextRequest, NextResponse } from "next/server";
import {
  checkLimits,
  getConfigInternal,
  type ModelAssignment,
} from "@/lib/multi-model-service";

export const runtime = "nodejs";

// POST /api/multi-model/limits
// Body: { taskSize?: "small" | "medium" | "large" }
// Returns a per-model limit summary for the assignments involved in the
// current mode. Used by the pre-flight confirmation dialog.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      taskSize?: "small" | "medium" | "large";
    };
    const taskSize = body.taskSize || "medium";
    const doc = await getConfigInternal();

    const assignments: {
      id: string;
      label: string;
      assignment: ModelAssignment;
    }[] = [];

    if (doc.mode === "GLOBAL") {
      if (doc.globalConfig) {
        assignments.push({
          id: "global",
          label: "Global Model",
          assignment: doc.globalConfig,
        });
      }
    } else if (doc.mode === "PER_FEATURE") {
      for (const [id, a] of Object.entries(doc.featureConfigs || {})) {
        if (a) assignments.push({ id, label: id, assignment: a });
      }
    } else {
      // HOST
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

    const limits = await checkLimits(assignments, taskSize);
    return NextResponse.json({ ok: true, limits, mode: doc.mode });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
