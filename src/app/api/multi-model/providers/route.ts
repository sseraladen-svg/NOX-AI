import { NextResponse } from "next/server";
import { PROVIDERS,FEATURES,SPECIALISTS,DEFAULT_TIMEOUTS,MAX_RETRY } from "@/lib/multi-model-service";

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
      // Report what dispatch really uses, not made-up numbers.
      LOCAL: DEFAULT_TIMEOUTS.LOCAL,
      API: DEFAULT_TIMEOUTS.GENERATION,
      maxRetry: MAX_RETRY,
    },
  });
}
