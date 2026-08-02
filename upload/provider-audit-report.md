# Provider runtime audit and hardening report

## Scope
- Hardened the multi-model runtime so provider detection, auth headers, endpoint selection, retries, and error handling are handled centrally.
- Updated Gemini validation to accept the newer AI Studio key formats while still validating the key through the real provider API.

## Files updated
- [src/lib/multi-model-service.ts](src/lib/multi-model-service.ts)
- [src/lib/multi-model-types.ts](src/lib/multi-model-types.ts)
- [src/components/nox/model-config-fields.tsx](src/components/nox/model-config-fields.tsx)

## What changed
1. Added shared runtime helpers for provider normalization, default endpoint selection, timeout/retry behavior, and actionable error classification.
2. Routed API dispatch, testing, and reachability checks through those helpers for Gemini, Anthropic, OpenAI-compatible providers, and the shared multi-provider flow.
3. Expanded the provider catalog to include Auto-detect and OpenRouter.
4. Updated the UI placeholder/help text to show the supported Gemini and Anthropic key formats.

## Key validation behavior
- Gemini now accepts API keys starting with `AIza...` and `AQ...`.
- Validation now distinguishes between malformed input and runtime/provider-side failures.
- API calls use official endpoints and retries for transient network failures.

## Verification
- `npm run build` ✅
- `npm run lint` ✅
