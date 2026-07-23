import { NextResponse } from "next/server";
import { PROVIDERS, FEATURES, SPECIALISTS } from "@/lib/multi-model-service";

export const runtime = "nodejs";

// GET /api/multi-model/providers
// Returns the provider catalog and the feature/specialist manifests.
export async function GET() {
  return NextResponse.json({
    ok: true,
    providers: PROVIDERS,
    features: FEATURES,
    specialists: SPECIALISTS,
    defaults: {
      LOCAL: 60_000,
      API: 30_000,
      maxRetry: 2,
    },
  });
}
